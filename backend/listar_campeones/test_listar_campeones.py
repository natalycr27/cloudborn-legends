# backend/listar_campeones/test_listar_campeones.py
# Pruebas unitarias con ejemplos concretos (pytest + moto) de la Lambda
# listar_campeones (GET /campeones). Complementan las pruebas de propiedad.
#
# Validates: Requirements 11.3, 11.4
#   - 11.3/11.4: GET /campeones devuelve HTTP 200 con un arreglo JSON; arreglo
#     vacio [] cuando la tabla no tiene campeones, y el arreglo con los campeones
#     cuando si existen.
#
# Estrategia de mock: se usa moto (mock_aws) para levantar una tabla DynamoDB en
# memoria. El modulo listar_campeones.app crea su recurso boto3 al importarse
# (antes de activar el mock), por eso cada prueba recrea un recurso DynamoDB
# DENTRO del contexto mockeado y parchea app._dynamo con el.

import json
import os

import boto3
from moto import mock_aws

import listar_campeones.app as app

# Nombre de la tabla usado por el mock; coincide con la variable de entorno
# TABLE_NAME que la Lambda lee en runtime.
_TABLA = "CloudbornLegendsTable"

# Region arbitraria requerida por moto/boto3 para crear el recurso.
_REGION = "us-east-1"


def _crear_tabla_y_poblar(campeones):
    """Crea la tabla mock, inserta los campeones y parchea app._dynamo.

    Debe invocarse dentro de un contexto mock_aws() activo.
    """
    os.environ["TABLE_NAME"] = _TABLA

    dynamo = boto3.resource("dynamodb", region_name=_REGION)
    dynamo.create_table(
        TableName=_TABLA,
        KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": "PK", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )
    tabla = dynamo.Table(_TABLA)
    with tabla.batch_writer() as lote:
        for campeon in campeones:
            lote.put_item(Item=campeon)

    # La Lambda crea su recurso al importarse (fuera del mock); se sustituye por
    # el recurso mock para que _scan_todos_los_campeones lea de la tabla mock.
    app._dynamo = dynamo
    return dynamo


def test_lista_vacia_devuelve_arreglo_vacio_http_200():
    """Sin campeones en DynamoDB, GET /campeones devuelve HTTP 200 con [] (Req 11.3)."""
    with mock_aws():
        _crear_tabla_y_poblar([])
        resultado = app.lambda_handler({}, None)

    assert resultado["statusCode"] == 200
    cuerpo = json.loads(resultado["body"])
    assert cuerpo == []


def test_lista_con_campeones_devuelve_arreglo_http_200():
    """Con campeones en DynamoDB, GET /campeones devuelve HTTP 200 con el arreglo
    completo y sin exponer la clave PK (Req 11.4)."""
    campeones = [
        {
            "PK": "CAMPEON#1",
            "id": "1",
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
            "victorias": 3,
            "createdAt": "2024-01-01T00:00:00+00:00",
        },
        {
            "PK": "CAMPEON#2",
            "id": "2",
            "nombre": "Boreas el Guardián",
            "estadisticas": {
                "vida": 1200,
                "dano": 60,
                "velocidad": 220,
                "armadura": 50,
            },
            "habilidades": ["escudo", "curacion"],
            "colorPrincipal": "#2980B9",
            "colorSecundario": "#ECF0F1",
            "victorias": 0,
            "createdAt": "2024-01-02T00:00:00+00:00",
        },
    ]

    with mock_aws():
        _crear_tabla_y_poblar(campeones)
        resultado = app.lambda_handler({}, None)

    assert resultado["statusCode"] == 200
    cuerpo = json.loads(resultado["body"])

    # Se devuelven los dos campeones almacenados.
    assert len(cuerpo) == 2

    # El handler elimina la clave PK del cuerpo de la respuesta.
    for entrada in cuerpo:
        assert "PK" not in entrada

    # Los campeones almacenados estan presentes, identificados por su id/nombre.
    nombres = {c["nombre"] for c in cuerpo}
    assert nombres == {"Ignis el Forjador", "Boreas el Guardián"}
