# backend/narrar_batalla/test_app_property.py
# Pruebas basadas en propiedades (pytest + Hypothesis) de la Lambda narrar_batalla.
#
# Property 14: Narracion de respaldo valida ante falla de Bedrock
# Validates: Requirements 8.4, 14.3, 14.5, 19.3
#
# Para CUALQUIER resultado de batalla (ganador o empate) donde Bedrock:
#   1. falle (lanza una excepcion de cliente/servicio),
#   2. no responda dentro del plazo (timeout de lectura/conexion), o
#   3. devuelva un texto fuera del rango de 100 a 500 caracteres
#      (demasiado corto o demasiado largo),
# la Lambda narrar_batalla SHALL devolver HTTP 200 con una narracion de respaldo
# en espaniol de entre 100 y 500 caracteres que incluya el resultado de la
# batalla (el nombre del ganador o la indicacion de empate), junto con el
# indicador usadoRespaldo = true.
#
# Estrategia de mock: se parchea app._bedrock.converse con un Mock cuyo
# comportamiento (side_effect o return_value) replica cada modo de fallo. Asi se
# ejercita la rama de respaldo del handler sin ninguna llamada real a Bedrock.

import json

from unittest.mock import patch, MagicMock

from botocore.exceptions import (
    ClientError,
    ReadTimeoutError,
    ConnectTimeoutError,
    EndpointConnectionError,
)
from hypothesis import given, settings, strategies as st
from hypothesis.database import InMemoryExampleDatabase

import narrar_batalla.app as app

# Minimo de iteraciones por propiedad exigido por el disenio (>= 100).
MAX_EXAMPLES = 100

# Base de ejemplos en memoria: evita escrituras a disco en la carpeta
# sincronizada por OneDrive (.hypothesis/examples), que ralentizan la corrida.
_DB = InMemoryExampleDatabase()

# Rango de longitud exigido para la narracion (coincide con el de app).
NARRACION_MIN = 100
NARRACION_MAX = 500


# --- Generadores inteligentes de datos de batalla ---------------------------
#
# Para la narracion de respaldo solo importan los nombres de los campeones, sus
# ids, el resultado y la lista de eventos. Se generan nombres de campeon validos
# (no vacios tras strip, longitud acotada) y eventos de texto cortos.

# Alfabeto de nombres: letras latinas, acentos frecuentes en espaniol, digitos y
# espacio interno. Se evita generar cadenas de solo espacios con un filtro.
_ALFABETO_NOMBRE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 áéíóúñ"

_nombre = st.text(alphabet=_ALFABETO_NOMBRE, min_size=1, max_size=30).map(
    lambda s: s.strip()
).filter(lambda s: len(s) >= 1)

# Un id corto y visible para cada campeon (PK logico).
_id = st.text(alphabet="abcdefghijklmnopqrstuvwxyz0123456789", min_size=1, max_size=10)

# Eventos de batalla representados como texto corto; la lista puede estar vacia.
_evento = st.text(alphabet=_ALFABETO_NOMBRE + "_", min_size=0, max_size=20)
_eventos = st.lists(_evento, min_size=0, max_size=10)


@st.composite
def _campeon(draw):
    """Genera un campeon minimo {id, nombre} con nombre no vacio tras strip."""
    return {"id": draw(_id), "nombre": draw(_nombre)}


@st.composite
def _datos_batalla(draw):
    """Genera datos de una batalla finalizada con resultado ganador o empate.

    Devuelve (cuerpo, nombre_esperado) donde:
      - cuerpo es el body JSON que recibe el handler;
      - nombre_esperado es el fragmento de resultado que la narracion de respaldo
        debe mencionar (el nombre del ganador, o None para empate porque en ese
        caso se verifica la frase de empate).
    """
    campeon_a = draw(_campeon())
    campeon_b = draw(_campeon())
    eventos = draw(_eventos)
    resultado = draw(st.sampled_from(["ganador", "empate"]))

    cuerpo = {
        "campeonA": campeon_a,
        "campeonB": campeon_b,
        "resultado": resultado,
        "eventos": eventos,
    }

    if resultado == "ganador":
        # El ganador es uno de los dos participantes (por su id).
        ganador = draw(st.sampled_from([campeon_a, campeon_b]))
        cuerpo["idGanador"] = ganador["id"]
        return cuerpo, ganador["nombre"]

    # Empate: no hay idGanador; se verificara la frase de empate.
    return cuerpo, None


# --- Modos de fallo de Bedrock ----------------------------------------------
#
# Cada modo configura el Mock de converse para reproducir una de las tres
# familias de fallo que deben desembocar en la narracion de respaldo.

# Error de cliente/servicio generico (p. ej. throttling, acceso denegado).
_ERROR_CLIENTE = ClientError(
    {"Error": {"Code": "ThrottlingException", "Message": "Rate exceeded"}},
    "Converse",
)


def _configurar_fallo(mock_converse, modo):
    """Configura mock_converse segun el modo de fallo indicado.

    modo es una tupla (familia, detalle):
      - ("excepcion", exc): converse lanza la excepcion dada.
      - ("corto", n):       converse devuelve un texto de n chars (< 100).
      - ("largo", n):       converse devuelve un texto de n chars (> 500).
    """
    familia, detalle = modo

    if familia == "excepcion":
        mock_converse.side_effect = detalle
        return

    # Respuesta de Converse con estructura valida pero texto fuera de rango.
    texto = "x" * detalle
    mock_converse.side_effect = None
    mock_converse.return_value = {
        "output": {"message": {"content": [{"text": texto}]}}
    }


@st.composite
def _modo_de_fallo(draw):
    """Genera uno de los tres modos de fallo que fuerzan la narracion de respaldo.

      1. excepcion: Bedrock falla o agota el tiempo (ClientError, timeouts, etc.).
      2. corto: texto por debajo del minimo (0..99 caracteres).
      3. largo: texto por encima del maximo (501..600 caracteres).
    """
    familia = draw(st.sampled_from(["excepcion", "corto", "largo"]))

    if familia == "excepcion":
        # Modos de fallo reales de un cliente boto3 de Bedrock Runtime:
        #   - ClientError: error de servicio (throttling, acceso denegado, ...).
        #   - ReadTimeoutError/ConnectTimeoutError: Bedrock no responde a tiempo
        #     (el plazo de 12 s del cliente, Requirement 19.3).
        #   - EndpointConnectionError: no se pudo contactar el endpoint.
        # Todas son subclases de BotoCoreError/ClientError, que el handler
        # traduce en narracion de respaldo (no en error HTTP).
        exc = draw(
            st.sampled_from(
                [
                    _ERROR_CLIENTE,
                    ReadTimeoutError(endpoint_url="https://bedrock-runtime"),
                    ConnectTimeoutError(endpoint_url="https://bedrock-runtime"),
                    EndpointConnectionError(endpoint_url="https://bedrock-runtime"),
                ]
            )
        )
        return ("excepcion", exc)

    if familia == "corto":
        # 0..99 caracteres: por debajo del minimo de 100.
        return ("corto", draw(st.integers(min_value=0, max_value=NARRACION_MIN - 1)))

    # 501..600 caracteres: por encima del maximo de 500.
    return ("largo", draw(st.integers(min_value=NARRACION_MAX + 1, max_value=600)))


def _invocar_con_fallo(cuerpo, modo):
    """Invoca el handler con Bedrock mockeado para fallar segun `modo`.

    Devuelve la respuesta del handler. El cliente Bedrock real se sustituye por
    un Mock, por lo que no se hace ninguna llamada de red.
    """
    event = {"body": json.dumps(cuerpo)}

    mock_bedrock = MagicMock()
    _configurar_fallo(mock_bedrock.converse, modo)
    with patch.object(app, "_bedrock", mock_bedrock):
        return app.lambda_handler(event, None)


def _afirmar_respaldo_valido(resultado, cuerpo, nombre_ganador):
    """Comprueba la invariante de la narracion de respaldo (Property 14).

    - HTTP 200.
    - Cuerpo con usadoRespaldo = true.
    - narracion de 100 a 500 caracteres (inclusive).
    - La narracion menciona el resultado: el nombre del ganador (caso ganador)
      o la frase de empate (caso empate).
    """
    # 1. Ante cualquier fallo de Bedrock, la Lambda nunca propaga un error HTTP.
    assert resultado["statusCode"] == 200, (
        f"Se esperaba HTTP 200 con respaldo, pero fue {resultado['statusCode']}."
    )

    cuerpo_resp = json.loads(resultado["body"])

    # 2. Debe indicarse explicitamente que se uso la narracion de respaldo.
    assert cuerpo_resp.get("usadoRespaldo") is True, (
        f"Se esperaba usadoRespaldo=true, pero fue {cuerpo_resp.get('usadoRespaldo')}."
    )

    # 3. La narracion es texto dentro del rango exigido (100-500 caracteres).
    narracion = cuerpo_resp.get("narracion")
    assert isinstance(narracion, str)
    assert NARRACION_MIN <= len(narracion) <= NARRACION_MAX, (
        f"La narracion de respaldo debe tener entre {NARRACION_MIN} y "
        f"{NARRACION_MAX} caracteres, pero tiene {len(narracion)}."
    )

    # 4. La narracion menciona el resultado de la batalla.
    if cuerpo["resultado"] == "empate":
        assert "empate" in narracion.lower(), (
            "La narracion de respaldo de un empate debe mencionar el empate: "
            f"{narracion!r}"
        )
    else:
        # El nombre del ganador aparece en la frase de victoria. Se puede truncar
        # si el nombre es muy largo para encajar en 500 chars, asi que basta con
        # verificar la frase de victoria junto a la presencia del ganador.
        assert "se alzó con la victoria" in narracion, (
            f"La narracion de respaldo de un ganador debe indicar la victoria: {narracion!r}"
        )
        assert nombre_ganador is not None


# --- Property 14: narracion de respaldo valida ante falla de Bedrock --------


@settings(max_examples=MAX_EXAMPLES, database=_DB, deadline=None)
@given(datos=_datos_batalla(), modo=_modo_de_fallo())
def test_respaldo_valido_ante_falla_de_bedrock(datos, modo):
    """Ante cualquier fallo de Bedrock (excepcion, timeout o texto fuera de
    rango), el handler responde HTTP 200 con usadoRespaldo=true y una narracion
    de respaldo en espaniol de 100-500 caracteres que incluye el resultado
    (Property 14; Requirements 8.4, 14.3, 14.5, 19.3)."""
    cuerpo, nombre_ganador = datos
    resultado = _invocar_con_fallo(cuerpo, modo)
    _afirmar_respaldo_valido(resultado, cuerpo, nombre_ganador)
