# backend/obtener_ranking/test_obtener_ranking.py
# Pruebas unitarias con ejemplos concretos (pytest + moto) de la Lambda
# obtener_ranking (GET /ranking). Complementan las pruebas de propiedad.
#
# Validates: Requirements 9.1, 13.2
#   - 13.2/9.1: el ranking devuelve HTTP 200 con un arreglo vacio cuando no hay
#     campeones, y ordenado por victorias DESCENDENTE con desempate por nombre
#     ASCENDENTE cuando hay empate de victorias.
#
# Estrategia de mock: se usa moto (mock_aws) para levantar una tabla DynamoDB en
# memoria. El modulo obtener_ranking.app crea su recurso boto3 al importarse, por
# eso cada prueba recrea un recurso DENTRO del contexto mockeado y parchea
# app._dynamo con el.

import json
import os

import boto3
from moto import mock_aws

import obtener_ranking.app as app

_TABLA = "CloudbornLegendsTable"
_REGION = "us-east-1"


def _campeon(pk, nombre, victorias):
    """Construye un item minimo de campeon para poblar la tabla mock."""
    return {"PK": f"CAMPEON#{pk}", "id": pk, "nombre": nombre, "victorias": victorias}


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

    app._dynamo = dynamo
    return dynamo


def test_ranking_vacio_devuelve_arreglo_vacio_http_200():
    """Sin campeones, GET /ranking devuelve HTTP 200 con [] (Req 13.2)."""
    with mock_aws():
        _crear_tabla_y_poblar([])
        resultado = app.lambda_handler({}, None)

    assert resultado["statusCode"] == 200
    cuerpo = json.loads(resultado["body"])
    assert cuerpo == []


def test_ranking_ordena_por_victorias_desc():
    """El ranking ordena por victorias DESCENDENTE (Req 9.1, 13.2)."""
    campeones = [
        _campeon("a", "Alfa", 2),
        _campeon("b", "Beta", 10),
        _campeon("c", "Gamma", 5),
    ]
    with mock_aws():
        _crear_tabla_y_poblar(campeones)
        resultado = app.lambda_handler({}, None)

    assert resultado["statusCode"] == 200
    ranking = json.loads(resultado["body"])

    nombres = [c["nombre"] for c in ranking]
    assert nombres == ["Beta", "Gamma", "Alfa"]


def test_ranking_desempata_victorias_iguales_por_nombre_asc():
    """Con empate de victorias, el ranking desempata por nombre ASCENDENTE
    (Req 13.2). Se mezcla el orden de insercion para evitar depender de el."""
    campeones = [
        _campeon("1", "Zelda", 7),
        _campeon("2", "Ares", 7),
        _campeon("3", "Morgana", 7),
        # Un campeon con mas victorias debe quedar siempre primero.
        _campeon("4", "Odin", 9),
    ]
    with mock_aws():
        _crear_tabla_y_poblar(campeones)
        resultado = app.lambda_handler({}, None)

    assert resultado["statusCode"] == 200
    ranking = json.loads(resultado["body"])

    nombres = [c["nombre"] for c in ranking]
    # Odin (9 victorias) primero; los tres empatados a 7 en orden alfabetico.
    assert nombres == ["Odin", "Ares", "Morgana", "Zelda"]

    # Verificacion explicita de la invariante: victorias no crecientes y, a
    # igualdad de victorias, nombres no decrecientes.
    for anterior, siguiente in zip(ranking, ranking[1:]):
        assert anterior["victorias"] >= siguiente["victorias"]
        if anterior["victorias"] == siguiente["victorias"]:
            assert anterior["nombre"] <= siguiente["nombre"]
