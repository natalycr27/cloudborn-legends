# backend/shared/test_rangos_estadisticas_property.py
# Pruebas basadas en propiedades (pytest + Hypothesis) de validar_y_ajustar.
#
# Property 3: Invariante de rangos de estadisticas
# Validates: Requirements 3.5, 4.7
#
# Para CUALQUIER campeon valido con estadisticas en CUALQUIER rango (dentro o
# fuera de los limites fijos, incluyendo valores negativos y muy grandes),
# validar_y_ajustar SHALL devolver un campeon cuyas cuatro estadisticas quedan
# dentro de sus rangos fijos:
#   vida      in [800, 1200]
#   dano      in [50, 150]
#   velocidad in [200, 400]
#   armadura  in [10, 50]
#
# Nota de estrategia: el generador construye SOLO campeones validos en cuanto a
# estructura (nombre, habilidades y colores) porque esta propiedad describe la
# invariante de RANGOS del resultado; las estadisticas se generan deliberadamente
# en un rango muy amplio (enteros y flotantes, muy por debajo y por encima de los
# limites) para ejercitar el ajuste/clamp en ambos extremos y en el interior.

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


# --- Generadores inteligentes de campeones validos -------------------------

# Nombre de 1 a 30 caracteres. La validacion solo mira longitud y que no este
# vacio, no el contenido, por eso basta un alfabeto acotado de caracteres visibles.
_NOMBRE_ALFABETO = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 áéíóúñ"
_nombre = st.text(alphabet=_NOMBRE_ALFABETO, min_size=1, max_size=NOMBRE_MAX).filter(
    lambda n: n != ""
)

# Valores de estadisticas en CUALQUIER rango: enteros y flotantes que van muy por
# debajo del minimo (incluidos negativos) hasta muy por encima del maximo, para
# forzar el clamp en ambos extremos y tambien valores que ya caen dentro de rango.
_valor_estadistica = st.one_of(
    st.integers(min_value=-1000, max_value=3000),
    st.floats(
        min_value=-1000.0,
        max_value=3000.0,
        allow_nan=False,
        allow_infinity=False,
    ),
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


@st.composite
def campeon_estadisticas_arbitrarias(draw):
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


# --- Property 3: invariante de rangos de estadisticas -----------------------


@settings(max_examples=MAX_EXAMPLES, database=_DB)
@given(campeon=campeon_estadisticas_arbitrarias())
def test_rangos_estadisticas_invariante(campeon):
    """Para todo campeon valido, las estadisticas del resultado caen en su rango fijo."""
    resultado = validar_y_ajustar(campeon)

    estadisticas = resultado["estadisticas"]

    # Cada estadistica del resultado debe estar dentro de su rango fijo [min, max].
    for clave, (minimo, maximo) in RANGOS_ESTADISTICAS.items():
        valor = estadisticas[clave]
        assert minimo <= valor <= maximo, (
            f"La estadística '{clave}' = {valor} está fuera del rango "
            f"[{minimo}, {maximo}] tras validar_y_ajustar."
        )
