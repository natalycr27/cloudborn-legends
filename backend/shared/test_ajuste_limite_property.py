# backend/shared/test_ajuste_limite_property.py
# Pruebas basadas en propiedades (pytest + Hypothesis) de validar_y_ajustar.
#
# Property 4: Ajuste de estadisticas al limite mas cercano
# Validates: Requirements 4.2, 4.8, 4.5
#
# Dos mitades de la misma propiedad:
#   (a) Para CUALQUIER campeon con una estadistica FUERA de su rango fijo, la
#       validacion SHALL ajustar el valor al limite valido mas cercano del
#       rango (clamp): si el valor original esta por debajo del minimo, el
#       resultado es el minimo; si esta por encima del maximo, el resultado es
#       el maximo (Requirements 4.2, 4.8).
#   (b) Para CUALQUIER campeon con TODAS las estadisticas DENTRO del rango, la
#       validacion SHALL dejar las estadisticas sin cambios (Requirement 4.5).
#
# Nota de estrategia: ambos generadores construyen campeones validos en cuanto
# a estructura (nombre, habilidades y colores) porque esta propiedad describe el
# comportamiento del AJUSTE de estadisticas. Para la mitad (a) se generan
# estadisticas deliberadamente fuera de rango por debajo o por encima (enteros y
# flotantes) de modo que se conoce de antemano el limite esperado; para la mitad
# (b) se generan estadisticas estrictamente dentro de [min, max] para comprobar
# que el valor original se preserva intacto (sin clamp).

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


def _valor_dentro(minimo, maximo):
    """Estrategia de valores estrictamente DENTRO del rango [minimo, maximo].

    Mezcla enteros y flotantes acotados a [minimo, maximo], incluyendo los
    propios limites (que tambien deben quedar sin cambios).
    """
    return st.one_of(
        st.integers(min_value=minimo, max_value=maximo),
        st.floats(
            min_value=float(minimo),
            max_value=float(maximo),
            allow_nan=False,
            allow_infinity=False,
        ),
    )


def _valor_fuera(minimo, maximo):
    """Estrategia de valores FUERA del rango [minimo, maximo].

    Produce valores estrictamente por debajo del minimo (incluidos negativos) o
    estrictamente por encima del maximo, con enteros y flotantes, de modo que el
    limite esperado tras el ajuste es conocido: el minimo o el maximo.
    """
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


@st.composite
def campeon_estadisticas_dentro(draw):
    """Campeon valido cuyas cuatro estadisticas estan DENTRO de su rango fijo."""
    estadisticas = {
        clave: draw(_valor_dentro(minimo, maximo))
        for clave, (minimo, maximo) in RANGOS_ESTADISTICAS.items()
    }
    return {
        "nombre": draw(_nombre),
        "estadisticas": estadisticas,
        "habilidades": draw(_habilidades_validas()),
        "colorPrincipal": draw(_color),
        "colorSecundario": draw(_color),
    }


@st.composite
def campeon_estadisticas_fuera(draw):
    """Campeon valido cuyas cuatro estadisticas estan FUERA de su rango fijo.

    Se conserva el valor original de cada estadistica en 'originales' para poder
    calcular el limite mas cercano esperado tras el ajuste.
    """
    originales = {
        clave: draw(_valor_fuera(minimo, maximo))
        for clave, (minimo, maximo) in RANGOS_ESTADISTICAS.items()
    }
    campeon = {
        "nombre": draw(_nombre),
        "estadisticas": dict(originales),
        "habilidades": draw(_habilidades_validas()),
        "colorPrincipal": draw(_color),
        "colorSecundario": draw(_color),
    }
    return campeon, originales


# --- Property 4 (a): estadisticas fuera de rango se ajustan al limite mas cercano


@settings(max_examples=MAX_EXAMPLES, database=_DB)
@given(datos=campeon_estadisticas_fuera())
def test_ajuste_al_limite_mas_cercano(datos):
    """Una estadistica fuera de rango se ajusta al limite valido mas cercano."""
    campeon, originales = datos

    resultado = validar_y_ajustar(campeon)
    estadisticas = resultado["estadisticas"]

    for clave, (minimo, maximo) in RANGOS_ESTADISTICAS.items():
        original = originales[clave]
        ajustado = estadisticas[clave]

        # El limite mas cercano al valor original: minimo si cayo por debajo,
        # maximo si cayo por encima (el generador garantiza que esta fuera).
        esperado = minimo if original < minimo else maximo

        assert ajustado == esperado, (
            f"La estadística '{clave}' original = {original} (fuera de "
            f"[{minimo}, {maximo}]) debió ajustarse a {esperado}, "
            f"pero fue {ajustado}."
        )
        # El valor ajustado es el limite mas cercano: su distancia al original
        # no es mayor que la del otro extremo del rango.
        assert abs(ajustado - original) <= abs(
            (maximo if esperado == minimo else minimo) - original
        )


# --- Property 4 (b): estadisticas dentro de rango no se modifican -----------


@settings(max_examples=MAX_EXAMPLES, database=_DB)
@given(campeon=campeon_estadisticas_dentro())
def test_estadisticas_dentro_no_se_modifican(campeon):
    """Si todas las estadisticas estan dentro del rango, no cambian."""
    # Copia de los valores originales antes de validar (el ajuste es in-place).
    originales = dict(campeon["estadisticas"])

    resultado = validar_y_ajustar(campeon)
    estadisticas = resultado["estadisticas"]

    for clave in RANGOS_ESTADISTICAS:
        assert estadisticas[clave] == originales[clave], (
            f"La estadística '{clave}' estaba dentro de rango con valor "
            f"{originales[clave]} y no debió modificarse, pero fue "
            f"{estadisticas[clave]}."
        )
