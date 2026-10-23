# backend/crear_campeon/test_app_property.py
# Pruebas basadas en propiedades (pytest + Hypothesis) de la Lambda crear_campeon.
#
# Property 1: Validacion de descripcion rechaza entradas invalidas sin invocar Bedrock
# Validates: Requirements 3.2, 2.5, 10.3, 10.5
#
# Para CUALQUIER descripcion de texto cuya longitud (tras strip) sea menor a 10,
# mayor a 500, o compuesta unicamente de espacios en blanco, el handler SHALL
# responder HTTP 400 con un mensaje en espaniol y SHALL NO invocar Bedrock.
#
# Estrategia de mock: se parchea app._bedrock.converse con un Mock. Si el handler
# invocara Bedrock para una entrada invalida, el Mock registraria la llamada y la
# asercion assert_not_called fallaria. El Mock ademas evita cualquier llamada real
# al servicio durante las pruebas.

import json

from unittest.mock import patch, MagicMock

from hypothesis import given, settings, strategies as st
from hypothesis.database import InMemoryExampleDatabase

import crear_campeon.app as app

# Minimo de iteraciones por propiedad exigido por el disenio (>= 100).
MAX_EXAMPLES = 100

# Base de ejemplos en memoria: evita escrituras a disco en la carpeta
# sincronizada por OneDrive (.hypothesis/examples), que ralentizan la corrida.
_DB = InMemoryExampleDatabase()


# Caracteres de espacio en blanco reconocidos por str.strip() en Python.
# strip() sin argumentos elimina todo caracter cuyo str.isspace() sea True.
ESPACIOS = " \t\n\r\x0b\x0c\u00a0\u2003"


def _invocar_handler(descripcion):
    """Invoca lambda_handler con un body que contiene la descripcion dada.

    Devuelve (respuesta, mock_converse) para poder comprobar el status, el cuerpo
    y que Bedrock no fue invocado. El cliente Bedrock se sustituye por un Mock.
    """
    event = {"body": json.dumps({"descripcion": descripcion})}

    mock_bedrock = MagicMock()
    with patch.object(app, "_bedrock", mock_bedrock):
        resultado = app.lambda_handler(event, None)

    return resultado, mock_bedrock.converse


def _afirmar_rechazo_sin_bedrock(resultado, mock_converse):
    """Comprueba HTTP 400, mensaje de error en espaniol y que Bedrock no se invoco."""
    # 1. Debe ser un rechazo HTTP 400.
    assert resultado["statusCode"] == 400

    # 2. El cuerpo es JSON con un campo 'error' no vacio (mensaje en espaniol).
    cuerpo = json.loads(resultado["body"])
    assert "error" in cuerpo
    assert isinstance(cuerpo["error"], str) and cuerpo["error"].strip() != ""
    # Los mensajes del handler estan en espaniol: "descripción".
    assert "descripci" in cuerpo["error"].lower()

    # 3. Bedrock NUNCA fue invocado para una entrada invalida.
    mock_converse.assert_not_called()


# --- Generadores inteligentes de descripciones invalidas --------------------
#
# Se usa un alfabeto acotado de caracteres visibles (letras latinas, acentos y
# algunos signos) en lugar de todo el espacio Unicode: eso mantiene la
# generacion y el shrinking rapidos sin perder cobertura, ya que la validacion
# solo mira la longitud tras strip, no el contenido.

# Caracteres visibles (no espacios) para el nucleo de la descripcion.
_VISIBLES = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789áéíóúñ.,;:!?-"
_visible = st.text(alphabet=_VISIBLES, min_size=1, max_size=1)

# Relleno de espacios en blanco opcional alrededor del nucleo (hasta 5).
_relleno_espacios = st.text(alphabet=ESPACIOS, min_size=0, max_size=5)

# Cadenas compuestas unicamente de espacios en blanco (incluye la cadena vacia).
_solo_espacios = st.text(alphabet=ESPACIOS, min_size=0, max_size=20)


@st.composite
def descripcion_corta(draw):
    """Descripcion cuyo contenido tras strip tiene entre 1 y 9 caracteres."""
    longitud = draw(st.integers(min_value=1, max_value=9))
    nucleo = "".join(draw(_visible) for _ in range(longitud))
    izq = draw(_relleno_espacios)
    der = draw(_relleno_espacios)
    return izq + nucleo + der


@st.composite
def descripcion_larga(draw):
    """Descripcion cuyo contenido tras strip tiene mas de 500 caracteres."""
    longitud = draw(st.integers(min_value=501, max_value=600))
    relleno = draw(_visible)
    # Nucleo con bordes visibles para que strip() no reduzca su longitud.
    nucleo = "A" + relleno * (longitud - 2) + "Z"
    izq = draw(_relleno_espacios)
    der = draw(_relleno_espacios)
    return izq + nucleo + der


# --- Propiedad 1: tres familias de entradas invalidas -----------------------


@settings(max_examples=MAX_EXAMPLES, database=_DB)
@given(descripcion=descripcion_corta())
def test_descripcion_corta_rechazada_sin_bedrock(descripcion):
    """Descripciones de longitud < 10 (tras strip) se rechazan sin llamar a Bedrock."""
    assert len(descripcion.strip()) < app.DESCRIPCION_MIN  # precondicion del generador
    resultado, mock_converse = _invocar_handler(descripcion)
    _afirmar_rechazo_sin_bedrock(resultado, mock_converse)


@settings(max_examples=MAX_EXAMPLES, database=_DB)
@given(descripcion=descripcion_larga())
def test_descripcion_larga_rechazada_sin_bedrock(descripcion):
    """Descripciones de longitud > 500 (tras strip) se rechazan sin llamar a Bedrock."""
    assert len(descripcion.strip()) > app.DESCRIPCION_MAX  # precondicion del generador
    resultado, mock_converse = _invocar_handler(descripcion)
    _afirmar_rechazo_sin_bedrock(resultado, mock_converse)


@settings(max_examples=MAX_EXAMPLES, database=_DB)
@given(descripcion=_solo_espacios)
def test_descripcion_solo_espacios_rechazada_sin_bedrock(descripcion):
    """Descripciones vacias o solo con espacios se rechazan sin llamar a Bedrock."""
    assert descripcion.strip() == ""  # precondicion del generador
    resultado, mock_converse = _invocar_handler(descripcion)
    _afirmar_rechazo_sin_bedrock(resultado, mock_converse)
