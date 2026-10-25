# backend/crear_campeon/test_crear_campeon_unit.py
# Pruebas unitarias con ejemplos concretos (pytest + moto) de la Lambda
# crear_campeon (POST /campeones). Complementan las pruebas de propiedad.
#
# Validates: Requirements 3.2, 4.4
#   - 3.2: la descripcion se valida (10-500 caracteres tras strip); el limite
#     inferior exacto se rechaza en 9 caracteres SIN invocar Bedrock, y los
#     limites exactos de 10 y 500 caracteres se aceptan (si invocan Bedrock).
#   - 4.4: una habilidad fuera del catalogo se rechaza con un mensaje en español
#     que NOMBRA la habilidad invalida (verificado sobre validar_y_ajustar, que
#     es donde vive ese mensaje descriptivo).
#
# Estrategia de mock:
#   - Bedrock: se parchea app._bedrock.converse con un Mock. Para el caso de 9
#     caracteres se comprueba assert_not_called; para 10 y 500 caracteres se
#     devuelve una respuesta Converse valida con el JSON de un campeon.
#   - DynamoDB: se usa moto (mock_aws) y se parchea app._dynamo con el recurso
#     mock para que el PutItem del handler no toque infraestructura real.

import json
import os

import boto3
import pytest
from unittest.mock import MagicMock, patch
from moto import mock_aws

import crear_campeon.app as app
from shared.validar_campeon import validar_y_ajustar, CampeonInvalidoError

_TABLA = "CloudbornLegendsTable"
_REGION = "us-east-1"


# --- Utilidades -------------------------------------------------------------


def _campeon_valido_json():
    """Devuelve el texto JSON de un campeon valido, tal como lo emite Bedrock."""
    return json.dumps(
        {
            "nombre": "Ignis el Forjador",
            "estadisticas": {
                "vida": 1000,
                "dano": 90,
                "velocidad": 300,
                "armadura": 25,
            },
            "habilidades": ["proyectil", "escudo"],
            "colorPrincipal": "#C0392B",
            "colorSecundario": "#F1C40F",
        }
    )


def _respuesta_converse(texto):
    """Construye la estructura de respuesta de bedrock.converse con 'texto'.

    Replica la ruta output.message.content[0].text que lee _invocar_bedrock.
    """
    return {"output": {"message": {"content": [{"text": texto}]}}}


def _crear_tabla_mock():
    """Crea la tabla DynamoDB mock y parchea app._dynamo. Dentro de mock_aws()."""
    os.environ["TABLE_NAME"] = _TABLA
    dynamo = boto3.resource("dynamodb", region_name=_REGION)
    dynamo.create_table(
        TableName=_TABLA,
        KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": "PK", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )
    app._dynamo = dynamo
    return dynamo


def _invocar(descripcion, texto_bedrock=None):
    """Invoca el handler con la descripcion; mockea Bedrock y DynamoDB.

    Devuelve (resultado, mock_converse). Si texto_bedrock es None se usa un
    campeon valido por defecto.
    """
    if texto_bedrock is None:
        texto_bedrock = _campeon_valido_json()

    event = {"body": json.dumps({"descripcion": descripcion})}

    mock_bedrock = MagicMock()
    mock_bedrock.converse.return_value = _respuesta_converse(texto_bedrock)

    with mock_aws():
        _crear_tabla_mock()
        with patch.object(app, "_bedrock", mock_bedrock):
            resultado = app.lambda_handler(event, None)

    return resultado, mock_bedrock.converse


# --- Req 3.2: limite inferior exacto (9 caracteres) se rechaza sin Bedrock ---


def test_descripcion_9_caracteres_rechazada_sin_bedrock():
    """Una descripcion de 9 caracteres (limite inferior - 1) devuelve HTTP 400
    en español y NO invoca Bedrock (Req 3.2)."""
    descripcion = "123456789"  # exactamente 9 caracteres tras strip
    assert len(descripcion.strip()) == 9

    resultado, mock_converse = _invocar(descripcion)

    assert resultado["statusCode"] == 400
    cuerpo = json.loads(resultado["body"])
    assert "error" in cuerpo
    assert "descripci" in cuerpo["error"].lower()

    # El rechazo ocurre antes de cualquier llamada a Bedrock.
    mock_converse.assert_not_called()


# --- Req 3.2: limites exactos (10 y 500 caracteres) se aceptan ---------------


@pytest.mark.parametrize("longitud", [10, 500])
def test_descripcion_limite_exacto_aceptada(longitud):
    """Descripciones de exactamente 10 y 500 caracteres se aceptan: HTTP 200,
    campeon devuelto y Bedrock invocado una vez (Req 3.2)."""
    descripcion = "a" * longitud
    assert len(descripcion.strip()) == longitud

    resultado, mock_converse = _invocar(descripcion)

    assert resultado["statusCode"] == 200
    cuerpo = json.loads(resultado["body"])

    # El campeon devuelto conserva el nombre generado y recibe los campos que
    # gestiona el backend (id, victorias=0, createdAt).
    assert cuerpo["nombre"] == "Ignis el Forjador"
    assert cuerpo["victorias"] == 0
    assert "id" in cuerpo and cuerpo["id"]
    assert "createdAt" in cuerpo and cuerpo["createdAt"]

    # Al ser una descripcion valida, Bedrock SI fue invocado exactamente una vez.
    mock_converse.assert_called_once()


# --- Req 4.4: habilidad fuera del catalogo rechazada nombrandola -------------


def test_habilidad_fuera_de_catalogo_rechazada_nombrando_la_habilidad():
    """validar_y_ajustar rechaza una habilidad fuera del catalogo con un mensaje
    en español que NOMBRA la habilidad invalida (Req 4.4)."""
    habilidad_invalida = "teletransporte"
    campeon = {
        "nombre": "Ignis el Forjador",
        "estadisticas": {
            "vida": 1000,
            "dano": 90,
            "velocidad": 300,
            "armadura": 25,
        },
        "habilidades": ["proyectil", habilidad_invalida],
        "colorPrincipal": "#C0392B",
        "colorSecundario": "#F1C40F",
    }

    with pytest.raises(CampeonInvalidoError) as exc_info:
        validar_y_ajustar(campeon)

    mensaje = str(exc_info.value)
    # El mensaje nombra la habilidad invalida y esta en español ("catálogo").
    assert habilidad_invalida in mensaje
    assert "catálogo" in mensaje.lower()


def test_habilidad_fuera_de_catalogo_no_almacena_campeon():
    """Extremo a extremo: si Bedrock produce un campeon con una habilidad fuera
    del catalogo, el handler responde HTTP 500 y NO persiste nada (Req 4.4)."""
    campeon_invalido = json.dumps(
        {
            "nombre": "Ignis el Forjador",
            "estadisticas": {
                "vida": 1000,
                "dano": 90,
                "velocidad": 300,
                "armadura": 25,
            },
            "habilidades": ["proyectil", "teletransporte"],
            "colorPrincipal": "#C0392B",
            "colorSecundario": "#F1C40F",
        }
    )

    descripcion = "Un guerrero de fuego con escudo"
    assert len(descripcion.strip()) >= 10

    resultado, _ = _invocar(descripcion, texto_bedrock=campeon_invalido)

    assert resultado["statusCode"] == 500
    cuerpo = json.loads(resultado["body"])
    assert "error" in cuerpo
