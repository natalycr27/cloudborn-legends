# backend/registrar_resultado/app.py
# Lambda registrar_resultado (POST /resultados).
#
# Responsabilidad (tarea 5.1): recibir el resultado de una batalla (ids de los
# dos campeones y el resultado: 'ganador' o 'empate') e incrementar en 1 el
# conteo de victorias del ganador en DynamoDB. Si hay empate, no modifica nada.
#   - Valida que el body incluya campeonA, campeonB y resultado; devuelve HTTP
#     400 en español si falta alguno (Requirements 12.1, 12.6).
#   - Si resultado == 'ganador', valida que idGanador no este vacio, corresponda
#     a uno de los dos participantes y exista en DynamoDB (GetItem); ante
#     cualquier fallo devuelve HTTP 400 en español SIN modificar conteos
#     (Requirements 12.4, 12.5).
#   - Si todo es valido y hay ganador, ejecuta UpdateItem con ADD victorias :1
#     sobre el item del ganador (Requirements 9.2, 9.5, 12.2).
#   - Si resultado == 'empate', no modifica nada y devuelve exito (Requirements
#     9.4, 12.3).
#   - Devuelve HTTP 200 { "ok": true } en caso de exito.
#   - Si DynamoDB no responde dentro de 5 s (read_timeout) o falla, devuelve
#     HTTP 500 en español usando el helper respuesta().

import os
import json

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from shared.respuesta import respuesta

# Configuracion del cliente DynamoDB: read_timeout=5, connect_timeout=3. Si
# DynamoDB excede 5 s respondiendo, boto3 lanza un timeout que se traduce en
# HTTP 500. Cliente de recurso reutilizado por contenedor de Lambda.
_CONFIG_DYNAMO = Config(
    read_timeout=5,
    connect_timeout=3,
)

# Recurso DynamoDB reutilizado entre invocaciones (se crea una sola vez por
# contenedor de Lambda para aprovechar las conexiones en caliente). El nombre de
# la tabla se lee de la variable de entorno TABLE_NAME inyectada por SAM.
_dynamo = boto3.resource("dynamodb", config=_CONFIG_DYNAMO)


def _clave_campeon(id_campeon):
    """Construye la clave primaria del item de un campeon en DynamoDB.

    El modelo de datos usa PK = "CAMPEON#<id>" como clave de particion fija para
    todo campeon, por lo que GetItem y UpdateItem deben usar este formato.
    """
    return {"PK": f"CAMPEON#{id_campeon}"}


def _campeon_existe(tabla, id_campeon):
    """Verifica con un GetItem que el campeon exista en DynamoDB.

    Devuelve True si el item con PK = "CAMPEON#<id>" existe, False en caso
    contrario. Se usa para confirmar que el ganador declarado es un campeon real
    antes de incrementar sus victorias (Requirement 12.5).
    """
    resultado = tabla.get_item(Key=_clave_campeon(id_campeon))
    return "Item" in resultado


def _incrementar_victorias(tabla, id_ganador):
    """Incrementa en 1 el conteo de victorias del ganador con UpdateItem (ADD).

    Usa la expresion de actualizacion "ADD victorias :uno" sobre el item del
    ganador; ADD crea el atributo con el valor si no existia o lo suma si ya
    existia (Requirements 9.2, 9.5, 12.2).
    """
    tabla.update_item(
        Key=_clave_campeon(id_ganador),
        UpdateExpression="ADD victorias :uno",
        ExpressionAttributeValues={":uno": 1},
    )


def lambda_handler(event, context):
    """Handler de la Lambda registrar_resultado (POST /resultados).

    Parsea el body JSON de forma tolerante; valida la presencia de campeonA,
    campeonB y resultado (HTTP 400 en español si falta alguno). Si el resultado
    es 'ganador', valida que idGanador no este vacio, sea uno de los dos
    participantes y exista en DynamoDB (GetItem); ante cualquier fallo responde
    HTTP 400 en español sin modificar conteos. Si es valido, incrementa en 1 las
    victorias del ganador (UpdateItem ADD); si es 'empate', no modifica nada.
    Devuelve HTTP 200 { "ok": true } en caso de exito y HTTP 500 en español si
    DynamoDB no esta disponible. El event se propaga a respuesta() para resolver
    correctamente el header CORS Origin.
    """
    # Parsear el body de la peticion de forma tolerante (puede venir como texto).
    try:
        cuerpo = json.loads(event.get("body") or "{}")
    except (ValueError, TypeError):
        return respuesta(400, {"error": "El cuerpo de la solicitud no es JSON válido"}, event)

    if not isinstance(cuerpo, dict):
        return respuesta(400, {"error": "El cuerpo de la solicitud no es JSON válido"}, event)

    campeon_a = cuerpo.get("campeonA")
    campeon_b = cuerpo.get("campeonB")
    resultado = cuerpo.get("resultado")

    # Validacion de campos obligatorios: ambos ids y el resultado (Req 12.1/12.6).
    if not campeon_a or not campeon_b or not resultado:
        return respuesta(
            400,
            {"error": "La solicitud debe incluir campeonA, campeonB y resultado"},
            event,
        )

    # Empate: no se modifica ningun conteo, se responde exito (Req 9.4, 12.3).
    if resultado == "empate":
        return respuesta(200, {"ok": True}, event)

    # Resultado con ganador: se valida el idGanador antes de tocar DynamoDB.
    if resultado == "ganador":
        id_ganador = cuerpo.get("idGanador")

        # idGanador obligatorio y no vacio (Requirement 12.4).
        if not id_ganador:
            return respuesta(
                400,
                {"error": "El id del ganador es obligatorio cuando hay un ganador"},
                event,
            )

        # El ganador debe ser uno de los dos participantes (Requirement 12.4).
        if id_ganador not in (campeon_a, campeon_b):
            return respuesta(
                400,
                {"error": "El id del ganador no corresponde a ninguno de los dos participantes"},
                event,
            )

        tabla = _dynamo.Table(os.environ["TABLE_NAME"])

        # El ganador debe existir en DynamoDB; si no, HTTP 400 sin modificar nada
        # (Requirement 12.5). Un fallo de DynamoDB se reporta como HTTP 500.
        try:
            if not _campeon_existe(tabla, id_ganador):
                return respuesta(
                    400,
                    {"error": "El campeón ganador no existe"},
                    event,
                )

            # Incrementar en 1 las victorias del ganador (Req 9.2, 9.5, 12.2).
            _incrementar_victorias(tabla, id_ganador)
        except (BotoCoreError, ClientError) as e:
            print(f"ERROR DynamoDB: {e}")
            return respuesta(
                500,
                {"error": "No se pudo registrar el resultado; inténtalo de nuevo"},
                event,
            )

        return respuesta(200, {"ok": True}, event)

    # Cualquier otro valor de 'resultado' es invalido (Requirement 12.6).
    return respuesta(
        400,
        {"error": "El resultado debe ser 'ganador' o 'empate'"},
        event,
    )
