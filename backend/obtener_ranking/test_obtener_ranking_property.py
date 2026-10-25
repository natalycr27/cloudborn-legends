# backend/obtener_ranking/test_obtener_ranking_property.py
# Pruebas basadas en propiedades (pytest + Hypothesis) de la Lambda obtener_ranking.
#
# Property 15: Invariante de orden del ranking
# Validates: Requirements 9.1, 9.3, 13.2
#
# Para CUALQUIER conjunto de campeones almacenados en DynamoDB con victorias y
# nombres arbitrarios, el ranking devuelto por lambda_handler SHALL cumplir las
# siguientes invariantes:
#   1. Orden por victorias DESCENDENTE: la entrada i tiene victorias >= que la i+1.
#   2. Desempate por nombre ASCENDENTE: a igualdad de victorias, el nombre
#      alfabéticamente menor aparece antes.
#   3. Cota de tamaño: el ranking contiene como máximo 100 entradas.
#   4. Sin duplicados: cada campeón (identificado por su id) aparece exactamente
#      una vez en el ranking.
#
# Estrategia de mock: se usa moto (mock_aws) para levantar una tabla DynamoDB en
# memoria sin infraestructura real. El módulo obtener_ranking.app crea su recurso
# boto3 al importarse (antes de que el mock esté activo), por eso cada prueba
# recrea un recurso DynamoDB DENTRO del contexto mockeado y parchea app._dynamo
# con él, de modo que _scan_todos_los_campeones lea de la tabla mock.

import os

import boto3
from hypothesis import given, settings, strategies as st
from hypothesis.database import InMemoryExampleDatabase
from moto import mock_aws

import obtener_ranking.app as app

# Minimo de iteraciones por propiedad exigido por el disenio (>= 100).
MAX_EXAMPLES = 100

# Base de ejemplos en memoria: evita escrituras a disco en la carpeta
# sincronizada por OneDrive (.hypothesis/examples), que ralentizan la corrida.
_DB = InMemoryExampleDatabase()

# Nombre de la tabla usado por el mock; coincide con la variable de entorno que
# la Lambda lee en runtime (TABLE_NAME).
_TABLA = "CloudbornLegendsTable"

# Region arbitraria requerida por moto/boto3 para crear el recurso.
_REGION = "us-east-1"


# --- Generadores inteligentes de campeones ----------------------------------
#
# El contenido de los campos no influye en el orden salvo 'victorias' y 'nombre';
# por eso se usan alfabetos acotados de caracteres visibles para los nombres
# (manteniendo la generacion y el shrinking rapidos) y enteros no negativos para
# las victorias (el conteo real nunca es negativo). Se incluyen nombres repetidos
# a proposito para ejercitar el desempate alfabetico con victorias iguales.

_NOMBRE_ALFABETO = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 áéíóúñ"
_nombre = st.text(alphabet=_NOMBRE_ALFABETO, min_size=1, max_size=20)

# Rango pequeño de victorias para forzar MUCHOS empates y asi ejercitar el
# criterio de desempate por nombre de forma frecuente.
_victorias = st.integers(min_value=0, max_value=5)


@st.composite
def _lista_de_campeones(draw):
    """Lista de 0 a 150 campeones con id único, victorias y nombre arbitrarios.

    Se permite superar las 100 entradas (hasta 150) para ejercitar la cota de
    tamaño del ranking. Cada campeón recibe un PK único (CAMPEON#<indice>) para
    poder comprobar la invariante de no-duplicidad por id.
    """
    cantidad = draw(st.integers(min_value=0, max_value=150))
    campeones = []
    for i in range(cantidad):
        campeones.append(
            {
                "PK": f"CAMPEON#{i}",
                "nombre": draw(_nombre),
                "victorias": draw(_victorias),
            }
        )
    return campeones


def _crear_tabla_y_poblar(campeones):
    """Crea la tabla mock, inserta los campeones y parchea app._dynamo.

    Devuelve el recurso DynamoDB mock para que el llamador pueda limpiarlo si
    lo necesita. Debe invocarse dentro de un contexto mock_aws() activo.
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
    # el recurso mock para que _scan_todos_los_campeones lea de la tabla en memoria.
    app._dynamo = dynamo
    return dynamo


# --- Property 15: invariante de orden e integridad del ranking --------------


@settings(max_examples=MAX_EXAMPLES, database=_DB, deadline=None)
@given(campeones=_lista_de_campeones())
def test_ranking_orden_e_integridad(campeones):
    """El ranking respeta orden desc por victorias, desempate asc por nombre,
    cota de 100 entradas y ausencia de duplicados (Requirements 9.1, 9.3, 13.2)."""
    with mock_aws():
        _crear_tabla_y_poblar(campeones)

        resultado = app.lambda_handler({}, None)

    # El handler siempre responde HTTP 200 cuando DynamoDB está disponible.
    assert resultado["statusCode"] == 200

    import json

    ranking = json.loads(resultado["body"])

    # 3. Cota de tamaño: como máximo 100 entradas (Requirement 13.2).
    assert len(ranking) <= app._MAX_ENTRADAS
    assert len(ranking) <= 100

    # El ranking nunca contiene mas campeones de los que existen.
    assert len(ranking) <= len(campeones)

    # Invariante de orden para cada par consecutivo (Requirements 9.1, 9.3, 13.2):
    #   - victorias no creciente;
    #   - a igualdad de victorias, nombre no decreciente (orden alfabetico asc).
    for anterior, siguiente in zip(ranking, ranking[1:]):
        v_ant = anterior["victorias"]
        v_sig = siguiente["victorias"]
        assert v_ant >= v_sig, (
            f"Orden de victorias roto: {v_ant} aparece antes que {v_sig}."
        )
        if v_ant == v_sig:
            assert anterior["nombre"] <= siguiente["nombre"], (
                "Desempate alfabético roto: "
                f"'{anterior['nombre']}' aparece antes que '{siguiente['nombre']}' "
                "con las mismas victorias."
            )


@settings(max_examples=MAX_EXAMPLES, database=_DB, deadline=None)
@given(campeones=_lista_de_campeones())
def test_ranking_sin_duplicados_y_subconjunto(campeones):
    """Cada campeón aparece a lo sumo una vez y el ranking es un subconjunto de
    los campeones almacenados (invariante de no-duplicidad, Requirement 13.2)."""
    with mock_aws():
        _crear_tabla_y_poblar(campeones)
        resultado = app.lambda_handler({}, None)

    import json

    ranking = json.loads(resultado["body"])

    # Reconstruir la identidad de cada entrada del ranking a partir de (nombre,
    # victorias): el handler elimina el PK del cuerpo, asi que se compara por los
    # campos observables. Se usa el conteo de ocurrencias para detectar que
    # ninguna entrada del ranking aparece mas veces de las que existe en origen.
    from collections import Counter

    origen = Counter((c["nombre"], c["victorias"]) for c in campeones)
    visto = Counter()
    for entrada in ranking:
        clave = (entrada["nombre"], entrada["victorias"])
        visto[clave] += 1
        # Ninguna entrada del ranking puede aparecer mas veces que en el origen:
        # eso delataria una duplicacion introducida por la Lambda.
        assert visto[clave] <= origen[clave], (
            f"El campeón {clave} aparece en el ranking más veces "
            "de las que existe en DynamoDB (duplicado)."
        )

    # Si hay 100 campeones o menos, el ranking debe contenerlos a TODOS: no se
    # pierde ni se duplica ninguno cuando no se aplica la cota de 100.
    if len(campeones) <= app._MAX_ENTRADAS:
        assert len(ranking) == len(campeones)
