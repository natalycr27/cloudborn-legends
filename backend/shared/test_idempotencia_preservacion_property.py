# backend/shared/test_idempotencia_preservacion_property.py
# Pruebas basadas en propiedades (pytest + Hypothesis) de validar_y_ajustar.
#
# Property 5: Idempotencia de la validacion
# Validates: Requirements 4.6
#
#   Para CUALQUIER campeon valido, validar el campeon DOS veces SHALL producir
#   valores identicos en todos los campos (nombre, estadisticas, habilidades y
#   colores) que validarlo una sola vez. Es decir, el ajuste (clamp) ya dejo
#   cada estadistica dentro de su rango en la primera pasada, por lo que una
#   segunda pasada no cambia nada: f(f(x)) == f(x).
#
# Property 6: El ajuste preserva los campos no-estadisticas
# Validates: Requirements 4.9
#
#   Para CUALQUIER campeon cuyas estadisticas son ajustadas por la validacion
#   (al menos una estadistica fuera de rango que obliga a un clamp), los campos
#   distintos a las estadisticas (nombre, habilidades y colores) SHALL permanecer
#   identicos a los del campeon original: la validacion solo toca el bloque de
#   estadisticas.
#
# Nota de estrategia: ambos generadores construyen campeones validos en cuanto a
# estructura (nombre, 2-3 habilidades distintas del catalogo y dos colores no
# vacios). Como validar_y_ajustar ajusta las estadisticas IN-PLACE y devuelve el
# mismo dict, las pruebas trabajan sobre copias profundas independientes para no
# contaminar el campeon de referencia con el que se compara.
#   - Property 5 genera estadisticas en un rango amplio (dentro y fuera de los
#     limites) para ejercitar la idempotencia tanto con clamp como sin clamp.
#   - Property 6 fuerza al menos una estadistica fuera de rango (y puede dejar
#     otras dentro) de modo que la validacion siempre realiza un ajuste real.

import copy

from hypothesis import given, settings, strategies as st
from hypothesis.database import InMemoryExampleDatabase

from shared.validar_campeon import (
    validar_y_ajustar,
    CATALOGO_HABILIDADES,
    RANGOS_ESTADISTICAS,
    NOMBRE_MAX,
    HABILIDADES_MIN,
    HABILIDADES_MAX,
)

# Minimo de iteraciones por propiedad exigido por el disenio (>= 100).
MAX_EXAMPLES = 100

# Base de ejemplos en memoria: evita escrituras a disco en la carpeta
# sincronizada por OneDrive (.hypothesis/examples), que ralentizan la corrida.
_DB = InMemoryExampleDatabase()

# Catalogo como tupla ordenada para muestrear habilidades de forma determinista.
_CATALOGO = tuple(sorted(CATALOGO_HABILIDADES))


# --- Generadores inteligentes de partes del campeon ------------------------

# Nombre de 1 a 30 caracteres. La validacion solo mira longitud y que no este
# vacio, no el contenido, por eso basta un alfabeto acotado de caracteres visibles.
_NOMBRE_ALFABETO = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 áéíóúñ"
_nombre = st.text(alphabet=_NOMBRE_ALFABETO, min_size=1, max_size=NOMBRE_MAX).filter(
    lambda n: n != ""
)

# Colores: texto no vacio (la validacion exige str no vacio, no un formato hex).
_color = st.text(
    alphabet="abcdefghijklmnopqrstuvwxyz#0123456789", min_size=1, max_size=12
).filter(lambda c: c != "")


@st.composite
def _habilidades_validas(draw):
    """Lista de 2 o 3 habilidades DISTINTAS tomadas del catalogo predefinido."""
    cantidad = draw(st.integers(min_value=HABILIDADES_MIN, max_value=HABILIDADES_MAX))
    # sampled_from + unique garantiza seleccion distinta dentro del catalogo.
    return draw(
        st.lists(
            st.sampled_from(_CATALOGO),
            min_size=cantidad,
            max_size=cantidad,
            unique=True,
        )
    )


# Valores de estadisticas en CUALQUIER rango (dentro o fuera de los limites,
# incluidos negativos y muy grandes), enteros y flotantes, para ejercitar la
# idempotencia tanto cuando hay clamp como cuando no lo hay.
_valor_estadistica = st.one_of(
    st.integers(min_value=-1000, max_value=3000),
    st.floats(
        min_value=-1000.0,
        max_value=3000.0,
        allow_nan=False,
        allow_infinity=False,
    ),
)


@st.composite
def campeon_valido(draw):
    """Campeon valido en estructura con estadisticas en un rango arbitrario amplio."""
    return {
        "nombre": draw(_nombre),
        "estadisticas": {
            "vida": draw(_valor_estadistica),
            "dano": draw(_valor_estadistica),
            "velocidad": draw(_valor_estadistica),
            "armadura": draw(_valor_estadistica),
        },
        "habilidades": draw(_habilidades_validas()),
        "colorPrincipal": draw(_color),
        "colorSecundario": draw(_color),
    }


def _valor_fuera(minimo, maximo):
    """Estrategia de valores FUERA del rango [minimo, maximo] (fuerza clamp)."""
    por_debajo = st.one_of(
        st.integers(min_value=minimo - 5000, max_value=minimo - 1),
        st.floats(
            min_value=float(minimo - 5000),
            max_value=float(minimo) - 0.5,
            allow_nan=False,
            allow_infinity=False,
        ),
    )
    por_encima = st.one_of(
        st.integers(min_value=maximo + 1, max_value=maximo + 5000),
        st.floats(
            min_value=float(maximo) + 0.5,
            max_value=float(maximo + 5000),
            allow_nan=False,
            allow_infinity=False,
        ),
    )
    return st.one_of(por_debajo, por_encima)


def _valor_dentro(minimo, maximo):
    """Estrategia de valores DENTRO del rango [minimo, maximo] (sin clamp)."""
    return st.one_of(
        st.integers(min_value=minimo, max_value=maximo),
        st.floats(
            min_value=float(minimo),
            max_value=float(maximo),
            allow_nan=False,
            allow_infinity=False,
        ),
    )


@st.composite
def campeon_con_estadistica_ajustada(draw):
    """Campeon valido con AL MENOS una estadistica fuera de rango (habra ajuste).

    Cada estadistica puede estar dentro o fuera de su rango, pero al menos una
    se fuerza fuera para garantizar que la validacion realiza un clamp real y la
    propiedad de preservacion de los demas campos tiene algo que preservar.
    """
    claves = list(RANGOS_ESTADISTICAS)
    # Al menos una estadistica obligatoriamente fuera de rango.
    clave_forzada = draw(st.sampled_from(claves))

    estadisticas = {}
    for clave in claves:
        minimo, maximo = RANGOS_ESTADISTICAS[clave]
        if clave == clave_forzada:
            estadisticas[clave] = draw(_valor_fuera(minimo, maximo))
        else:
            # Las demas pueden estar dentro o fuera indistintamente.
            estadisticas[clave] = draw(
                st.one_of(_valor_dentro(minimo, maximo), _valor_fuera(minimo, maximo))
            )

    return {
        "nombre": draw(_nombre),
        "estadisticas": estadisticas,
        "habilidades": draw(_habilidades_validas()),
        "colorPrincipal": draw(_color),
        "colorSecundario": draw(_color),
    }


# --- Property 5: idempotencia de la validacion -----------------------------


@settings(max_examples=MAX_EXAMPLES, database=_DB)
@given(campeon=campeon_valido())
def test_idempotencia_de_la_validacion(campeon):
    """Validar dos veces produce el mismo resultado que validar una sola vez.

    f(f(x)) == f(x) en todos los campos: nombre, estadisticas, habilidades y
    colores. Como el ajuste es in-place y devuelve el mismo dict, se parte de
    dos copias profundas independientes para comparar sin contaminacion cruzada.
    """
    # Una sola aplicacion sobre una copia independiente.
    una_vez = validar_y_ajustar(copy.deepcopy(campeon))

    # Dos aplicaciones encadenadas sobre otra copia independiente.
    dos_veces = validar_y_ajustar(validar_y_ajustar(copy.deepcopy(campeon)))

    # Los dict completos deben ser identicos en todos sus campos.
    assert dos_veces == una_vez, (
        "validar_y_ajustar no es idempotente: aplicarlo dos veces difiere de "
        f"aplicarlo una vez.\nuna_vez={una_vez}\ndos_veces={dos_veces}"
    )

    # Verificacion explicita campo a campo para un mensaje de error mas claro.
    assert dos_veces["nombre"] == una_vez["nombre"]
    assert dos_veces["estadisticas"] == una_vez["estadisticas"]
    assert dos_veces["habilidades"] == una_vez["habilidades"]
    assert dos_veces["colorPrincipal"] == una_vez["colorPrincipal"]
    assert dos_veces["colorSecundario"] == una_vez["colorSecundario"]


# --- Property 6: el ajuste preserva los campos no-estadisticas --------------


@settings(max_examples=MAX_EXAMPLES, database=_DB)
@given(campeon=campeon_con_estadistica_ajustada())
def test_ajuste_preserva_campos_no_estadisticas(campeon):
    """Al ajustar estadisticas, nombre, habilidades y colores no cambian.

    El generador garantiza que al menos una estadistica esta fuera de rango, de
    modo que la validacion realiza un ajuste (clamp) real; aun asi, los campos
    distintos a 'estadisticas' deben quedar identicos a los del campeon original.
    """
    # Snapshot de los campos no-estadisticas ANTES de validar (el ajuste es in-place).
    nombre_original = campeon["nombre"]
    habilidades_originales = copy.deepcopy(campeon["habilidades"])
    color_principal_original = campeon["colorPrincipal"]
    color_secundario_original = campeon["colorSecundario"]
    estadisticas_originales = copy.deepcopy(campeon["estadisticas"])

    resultado = validar_y_ajustar(campeon)

    # Se confirma que efectivamente hubo un ajuste: alguna estadistica cambio.
    assert resultado["estadisticas"] != estadisticas_originales, (
        "El generador debia forzar al menos un ajuste de estadistica, pero "
        f"ninguna cambio.\noriginales={estadisticas_originales}\n"
        f"resultado={resultado['estadisticas']}"
    )

    # Los campos no-estadisticas permanecen identicos a los del campeon original.
    assert resultado["nombre"] == nombre_original, (
        f"El nombre cambio tras el ajuste: {nombre_original!r} -> "
        f"{resultado['nombre']!r}."
    )
    assert resultado["habilidades"] == habilidades_originales, (
        f"Las habilidades cambiaron tras el ajuste: {habilidades_originales} -> "
        f"{resultado['habilidades']}."
    )
    assert resultado["colorPrincipal"] == color_principal_original, (
        f"colorPrincipal cambio tras el ajuste: {color_principal_original!r} -> "
        f"{resultado['colorPrincipal']!r}."
    )
    assert resultado["colorSecundario"] == color_secundario_original, (
        f"colorSecundario cambio tras el ajuste: {color_secundario_original!r} -> "
        f"{resultado['colorSecundario']!r}."
    )
