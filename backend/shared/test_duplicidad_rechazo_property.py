# backend/shared/test_duplicidad_rechazo_property.py
# Pruebas basadas en propiedades (pytest + Hypothesis) de validar_y_ajustar.
#
# Property 7: No duplicidad de habilidades
# Validates: Requirements 5.5
#
#   Para CUALQUIER campeon cuyas habilidades contengan al menos un duplicado
#   (habilidades repetidas tomadas del catalogo), validar_y_ajustar SHALL
#   rechazar el campeon con un error descriptivo en español y SHALL no emitir ni
#   almacenar un campeon invalido. Es decir, la validacion NUNCA devuelve un
#   campeon con habilidades repetidas.
#
# Property 8: Rechazo de campeones invalidos o incompletos
# Validates: Requirements 3.8, 4.1, 4.3, 4.4, 5.4, 10.7, 19.4
#
#   Para CUALQUIER JSON de campeon que no cumpla la estructura esperada (nombre
#   ausente, vacio o superior a 30 caracteres; numero incorrecto de estadisticas
#   o habilidades; una habilidad fuera del catalogo; numero incorrecto de colores;
#   estructura que no es un dict), validar_y_ajustar SHALL rechazar el campeon con
#   un error descriptivo en español y SHALL no emitir ni almacenar un campeon
#   invalido. Cuando el motivo del rechazo es una habilidad no reconocida, el
#   mensaje de error SHALL nombrar la habilidad invalida.
#
# Nota de estrategia: ambos generadores construyen deliberadamente campeones
# INVALIDOS (a diferencia de las Properties 2/3/5/6, que generan campeones
# validos). Cada caso invalido parte de un campeon base valido y se "rompe" en
# una sola dimension a la vez, de forma que el motivo del rechazo quede claro y
# el generador cubra cada rama de rechazo descrita en el diseño. La no-emision
# se comprueba exigiendo que validar_y_ajustar lance CampeonInvalidoError (y, por
# tanto, no retorne ningun campeon) en todos estos casos.

import copy

from hypothesis import assume, given, settings, strategies as st
from hypothesis.database import InMemoryExampleDatabase
import pytest

from shared.validar_campeon import (
    validar_y_ajustar,
    CampeonInvalidoError,
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


# --- Generadores base de partes VALIDAS del campeon ------------------------

# Nombre valido de 1 a 30 caracteres. La validacion solo mira longitud y que no
# este vacio, por eso basta un alfabeto acotado de caracteres visibles.
_NOMBRE_ALFABETO = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 áéíóúñ"
_nombre = st.text(alphabet=_NOMBRE_ALFABETO, min_size=1, max_size=NOMBRE_MAX).filter(
    lambda n: n != ""
)

# Colores: texto no vacio (la validacion exige str no vacio, no un formato hex).
_color = st.text(
    alphabet="abcdefghijklmnopqrstuvwxyz#0123456789", min_size=1, max_size=12
).filter(lambda c: c != "")

# Estadisticas validas en cualquier rango (la estructura no depende del valor).
_valor_estadistica = st.integers(min_value=-1000, max_value=3000)


def _estadisticas_validas():
    """Diccionario de estadisticas con exactamente las cuatro claves esperadas."""
    return st.fixed_dictionaries(
        {clave: _valor_estadistica for clave in RANGOS_ESTADISTICAS}
    )


@st.composite
def _habilidades_validas(draw):
    """Lista de 2 o 3 habilidades DISTINTAS tomadas del catalogo predefinido."""
    cantidad = draw(st.integers(min_value=HABILIDADES_MIN, max_value=HABILIDADES_MAX))
    return draw(
        st.lists(
            st.sampled_from(_CATALOGO),
            min_size=cantidad,
            max_size=cantidad,
            unique=True,
        )
    )


@st.composite
def _campeon_base_valido(draw):
    """Campeon totalmente valido; sirve de punto de partida para "romperlo"."""
    return {
        "nombre": draw(_nombre),
        "estadisticas": draw(_estadisticas_validas()),
        "habilidades": draw(_habilidades_validas()),
        "colorPrincipal": draw(_color),
        "colorSecundario": draw(_color),
    }


# --- Property 7: generador de habilidades CON duplicados -------------------


@st.composite
def _habilidades_con_duplicado(draw):
    """Lista de 2 o 3 habilidades del catalogo con AL MENOS un duplicado.

    Se elige una habilidad base del catalogo, se repite y se completa la lista
    hasta la longitud deseada con cualquier habilidad del catalogo (que puede
    coincidir o no), garantizando que siempre haya al menos una repeticion.
    """
    longitud = draw(st.integers(min_value=HABILIDADES_MIN, max_value=HABILIDADES_MAX))
    repetida = draw(st.sampled_from(_CATALOGO))
    # Dos copias de la habilidad repetida garantizan el duplicado.
    habilidades = [repetida, repetida]
    # Se rellena el resto (si longitud == 3) con cualquier habilidad del catalogo.
    while len(habilidades) < longitud:
        habilidades.append(draw(st.sampled_from(_CATALOGO)))
    # Se baraja para que el duplicado no quede siempre al inicio.
    indices = draw(st.permutations(list(range(len(habilidades)))))
    mezcladas = [habilidades[i] for i in indices]
    return mezcladas


@st.composite
def campeon_habilidades_duplicadas(draw):
    """Campeon valido salvo porque sus habilidades contienen un duplicado."""
    campeon = draw(_campeon_base_valido())
    campeon["habilidades"] = draw(_habilidades_con_duplicado())
    return campeon


@settings(max_examples=MAX_EXAMPLES, database=_DB)
@given(campeon=campeon_habilidades_duplicadas())
def test_rechaza_habilidades_duplicadas(campeon):
    """Un campeon con habilidades duplicadas es rechazado y no se emite.

    Property 7: las habilidades deben ser distintas. Si hay duplicados, la
    validacion lanza CampeonInvalidoError (en español) y por tanto no retorna
    ningun campeon (no emision ni almacenamiento de un campeon invalido).
    """
    # Precondicion del generador: realmente hay al menos un duplicado.
    assume(len(set(campeon["habilidades"])) < len(campeon["habilidades"]))

    with pytest.raises(CampeonInvalidoError) as exc_info:
        validar_y_ajustar(copy.deepcopy(campeon))

    # El error debe ser descriptivo (mensaje no vacio, en español).
    assert str(exc_info.value).strip() != ""


# --- Property 8: generadores de campeones INVALIDOS por cada motivo ---------


@st.composite
def _campeon_nombre_invalido(draw):
    """Campeon con nombre ausente, vacio, no-texto o de mas de 30 caracteres."""
    campeon = draw(_campeon_base_valido())
    modo = draw(st.sampled_from(["ausente", "vacio", "no_texto", "demasiado_largo"]))
    if modo == "ausente":
        del campeon["nombre"]
    elif modo == "vacio":
        campeon["nombre"] = ""
    elif modo == "no_texto":
        campeon["nombre"] = draw(st.one_of(st.integers(), st.none(), st.booleans()))
    else:  # demasiado_largo: estrictamente mas de NOMBRE_MAX caracteres.
        campeon["nombre"] = draw(
            st.text(alphabet="abcdefg", min_size=NOMBRE_MAX + 1, max_size=NOMBRE_MAX + 50)
        )
    return campeon


@st.composite
def _campeon_estadisticas_invalidas(draw):
    """Campeon con numero incorrecto de estadisticas, clave errada o no-numerico."""
    campeon = draw(_campeon_base_valido())
    claves = list(RANGOS_ESTADISTICAS)
    modo = draw(st.sampled_from(["falta", "sobra", "renombrada", "no_numerico", "no_dict"]))
    if modo == "falta":
        # Elimina una estadistica -> quedan menos de cuatro.
        del campeon["estadisticas"][draw(st.sampled_from(claves))]
    elif modo == "sobra":
        # Agrega una clave extra -> mas de cuatro.
        campeon["estadisticas"]["extra"] = draw(_valor_estadistica)
    elif modo == "renombrada":
        # Cambia una clave valida por otra desconocida -> conjunto de claves != esperado.
        clave = draw(st.sampled_from(claves))
        campeon["estadisticas"]["desconocida"] = campeon["estadisticas"].pop(clave)
    elif modo == "no_numerico":
        clave = draw(st.sampled_from(claves))
        campeon["estadisticas"][clave] = draw(
            st.one_of(st.text(min_size=1, max_size=5), st.none(), st.booleans())
        )
    else:  # no_dict: estadisticas no es un diccionario.
        campeon["estadisticas"] = draw(
            st.one_of(st.lists(st.integers(), max_size=4), st.none(), st.integers())
        )
    return campeon


@st.composite
def _campeon_habilidades_invalidas(draw):
    """Campeon con numero incorrecto de habilidades, lista no-lista o fuera de catalogo."""
    campeon = draw(_campeon_base_valido())
    modo = draw(st.sampled_from(["pocas", "muchas", "no_lista", "fuera_de_catalogo"]))
    if modo == "pocas":
        # Menos de HABILIDADES_MIN (0 o 1 habilidad).
        campeon["habilidades"] = draw(
            st.lists(
                st.sampled_from(_CATALOGO),
                min_size=0,
                max_size=HABILIDADES_MIN - 1,
                unique=True,
            )
        )
    elif modo == "muchas":
        # Mas de HABILIDADES_MAX habilidades distintas del catalogo.
        campeon["habilidades"] = draw(
            st.lists(
                st.sampled_from(_CATALOGO),
                min_size=HABILIDADES_MAX + 1,
                max_size=len(_CATALOGO),
                unique=True,
            )
        )
    elif modo == "no_lista":
        campeon["habilidades"] = draw(
            st.one_of(st.none(), st.text(max_size=5), st.integers())
        )
    else:  # fuera_de_catalogo: una habilidad desconocida se marca para verificar el nombre.
        desconocida = draw(
            st.text(alphabet="abcdefghijklmnop_", min_size=1, max_size=15).filter(
                lambda h: h not in CATALOGO_HABILIDADES and h != ""
            )
        )
        valida = draw(st.sampled_from(_CATALOGO))
        habilidades = [valida, desconocida]
        # Se baraja para no asumir posicion de la invalida.
        indices = draw(st.permutations([0, 1]))
        campeon["habilidades"] = [habilidades[i] for i in indices]
        campeon["_habilidad_desconocida"] = desconocida
    return campeon


@st.composite
def _campeon_colores_invalidos(draw):
    """Campeon con un color ausente, vacio o no-texto."""
    campeon = draw(_campeon_base_valido())
    campo = draw(st.sampled_from(["colorPrincipal", "colorSecundario"]))
    modo = draw(st.sampled_from(["ausente", "vacio", "no_texto"]))
    if modo == "ausente":
        del campeon[campo]
    elif modo == "vacio":
        campeon[campo] = ""
    else:
        campeon[campo] = draw(st.one_of(st.integers(), st.none(), st.booleans()))
    return campeon


@st.composite
def _campeon_no_dict(draw):
    """Estructura que ni siquiera es un diccionario (JSON de raiz invalida)."""
    return draw(
        st.one_of(
            st.none(),
            st.integers(),
            st.text(max_size=10),
            st.lists(st.integers(), max_size=4),
        )
    )


@st.composite
def campeon_invalido(draw):
    """Union de todas las formas de campeon invalido para la Property 8."""
    return draw(
        st.one_of(
            _campeon_nombre_invalido(),
            _campeon_estadisticas_invalidas(),
            _campeon_habilidades_invalidas(),
            _campeon_colores_invalidos(),
            _campeon_no_dict(),
        )
    )


@settings(max_examples=MAX_EXAMPLES, database=_DB)
@given(campeon=campeon_invalido())
def test_rechaza_campeones_invalidos_o_incompletos(campeon):
    """Todo campeon invalido o incompleto es rechazado y no se emite ni almacena.

    Property 8: validar_y_ajustar lanza CampeonInvalidoError (en español) para
    cualquier estructura invalida, por lo que no retorna ningun campeon. Cuando
    el motivo es una habilidad fuera del catalogo, el mensaje nombra la habilidad.
    """
    # Metadato interno del generador: habilidad desconocida esperada en el mensaje.
    habilidad_desconocida = None
    if isinstance(campeon, dict):
        habilidad_desconocida = campeon.pop("_habilidad_desconocida", None)

    with pytest.raises(CampeonInvalidoError) as exc_info:
        validar_y_ajustar(copy.deepcopy(campeon))

    mensaje = str(exc_info.value)

    # El error debe ser descriptivo: mensaje no vacio.
    assert mensaje.strip() != ""

    # Si el rechazo es por una habilidad fuera del catalogo, el mensaje la nombra.
    if habilidad_desconocida is not None:
        assert habilidad_desconocida in mensaje, (
            "El mensaje de error debe nombrar la habilidad invalida "
            f"{habilidad_desconocida!r}, pero fue: {mensaje!r}"
        )
