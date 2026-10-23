# backend/shared/test_validar_campeon_property.py
# Pruebas basadas en propiedades (pytest + Hypothesis) de validar_y_ajustar.
#
# Property 2: Invariante de estructura del campeon
# Validates: Requirements 3.3, 5.2, 5.3, 2.6
#
# Para CUALQUIER campeon de ENTRADA valido (nombre de 1 a 30 caracteres,
# estadisticas numericas arbitrarias dentro o fuera de rango, entre 2 y 3
# habilidades DISTINTAS del catalogo predefinido, y los dos colores como texto
# no vacio), validar_y_ajustar SHALL devolver un dict cuya estructura cumple la
# invariante del campeon: exactamente un nombre valido (1-30 chars), exactamente
# las cuatro claves de estadisticas (vida, dano, velocidad, armadura), entre 2 y
# 3 habilidades, todas del catalogo y sin duplicados, y los campos colorPrincipal
# y colorSecundario presentes.
#
# Nota de estrategia: el generador construye SOLO campeones validos, porque esta
# propiedad describe la estructura garantizada del resultado para entradas
# validas (el rechazo de entradas invalidas lo cubre la Property 8). Las
# estadisticas se generan deliberadamente en un rango amplio (dentro y fuera de
# los limites) para no asumir que el ajuste/clamp cambia la ESTRUCTURA.

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

# Claves de estadisticas esperadas, derivadas de la fuente de verdad del modulo.
_CLAVES_ESTADISTICAS = frozenset(RANGOS_ESTADISTICAS)

# Catalogo como tupla ordenada para muestrear habilidades de forma determinista.
_CATALOGO = tuple(sorted(CATALOGO_HABILIDADES))


# --- Generadores inteligentes de campeones validos -------------------------

# Nombre de 1 a 30 caracteres. Se usa un alfabeto acotado de caracteres visibles
# (la validacion solo mira longitud y que no este vacio, no el contenido).
_NOMBRE_ALFABETO = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 áéíóúñ"
_nombre = st.text(alphabet=_NOMBRE_ALFABETO, min_size=1, max_size=NOMBRE_MAX).filter(
    lambda n: n != ""
)

# Valores de estadisticas en un rango amplio que cubre tanto dentro como fuera
# de los limites fijos, para no acoplar la propiedad al comportamiento de clamp.
_valor_estadistica = st.integers(min_value=0, max_value=2000)

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


@st.composite
def campeon_valido(draw):
    """Construye un campeon de entrada valido para validar_y_ajustar."""
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


# --- Property 2: invariante de estructura del campeon -----------------------


@settings(max_examples=MAX_EXAMPLES, database=_DB)
@given(campeon=campeon_valido())
def test_estructura_del_campeon_invariante(campeon):
    """Para todo campeon valido, el resultado cumple la estructura del campeon."""
    resultado = validar_y_ajustar(campeon)

    # 1. El resultado es un diccionario.
    assert isinstance(resultado, dict)

    # 2. Nombre: presente, texto, de 1 a 30 caracteres.
    nombre = resultado.get("nombre")
    assert isinstance(nombre, str)
    assert 1 <= len(nombre) <= NOMBRE_MAX

    # 3. Estadisticas: exactamente las cuatro claves esperadas, ni mas ni menos.
    estadisticas = resultado.get("estadisticas")
    assert isinstance(estadisticas, dict)
    assert set(estadisticas) == set(_CLAVES_ESTADISTICAS)

    # 4. Habilidades: entre 2 y 3, todas del catalogo y sin duplicados.
    habilidades = resultado.get("habilidades")
    assert isinstance(habilidades, list)
    assert HABILIDADES_MIN <= len(habilidades) <= HABILIDADES_MAX
    assert all(habilidad in CATALOGO_HABILIDADES for habilidad in habilidades)
    assert len(set(habilidades)) == len(habilidades)

    # 5. Dos colores: colorPrincipal y colorSecundario presentes como texto.
    assert isinstance(resultado.get("colorPrincipal"), str)
    assert resultado["colorPrincipal"] != ""
    assert isinstance(resultado.get("colorSecundario"), str)
    assert resultado["colorSecundario"] != ""
