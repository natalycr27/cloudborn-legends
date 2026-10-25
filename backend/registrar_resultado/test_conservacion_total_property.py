# backend/registrar_resultado/test_conservacion_total_property.py
# Prueba basada en propiedades (pytest + Hypothesis) de la Lambda registrar_resultado.
#
# Property 18: Conservacion del total de victorias
# Validates: Requirement 9.7
#
# Property 18 (conservacion del total): para CUALQUIER secuencia de registros de
#   batalla (mezcla de resultados 'ganador' con un idGanador valido entre los
#   participantes y 'empate') aplicada sobre un conjunto de campeones que parten
#   con victorias = 0, la suma de los conteos de victorias de TODOS los campeones
#   tras procesar la secuencia SHALL ser EXACTAMENTE igual al numero de registros
#   con un ganador declarado (Requirement 9.7). Los empates no aportan al total.
#
# Estrategia de mock: se usa moto (mock_aws) para levantar una tabla DynamoDB en
# memoria sin infraestructura real. El modulo registrar_resultado.app crea su
# recurso boto3 al importarse (antes de que el mock este activo), por eso cada
# prueba recrea un recurso DynamoDB DENTRO del contexto mockeado y parchea
# app._dynamo con el, de modo que GetItem/UpdateItem operen sobre la tabla mock.

import os
import json

import boto3
from hypothesis import given, settings, strategies as st
from hypothesis.database import InMemoryExampleDatabase
from moto import mock_aws

import registrar_resultado.app as app

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


# --- Generadores inteligentes ------------------------------------------------
#
# Para esta propiedad solo importa el id (PK) de cada campeon; todos parten con
# victorias = 0 para que la suma final sea comparable contra el numero de
# victorias declaradas. Se usa un alfabeto acotado para que la generacion y el
# shrinking sean rapidos.

_ID_ALFABETO = "abcdefghijklmnopqrstuvwxyz0123456789"
_id_campeon = st.text(alphabet=_ID_ALFABETO, min_size=1, max_size=12)


@st.composite
def _ids_de_campeones(draw, min_size=2, max_size=8):
    """Conjunto de ids UNICOS de campeones (al menos dos para poder enfrentarlos).

    Devuelve una lista de ids distintos; el resto de la prueba enfrenta pares de
    estos campeones a lo largo de una secuencia de registros de batalla.
    """
    return draw(
        st.lists(_id_campeon, min_size=min_size, max_size=max_size, unique=True)
    )


@st.composite
def _secuencia_de_batallas(draw, ids):
    """Genera una secuencia de registros de batalla sobre los campeones dados.

    Cada entrada es un cuerpo valido para el handler: elige dos participantes
    distintos y un resultado 'ganador' (con idGanador entre los participantes) o
    'empate'. La secuencia mezcla ambos tipos para ejercitar la conservacion del
    total frente a empates que no suman.
    """
    cantidad = draw(st.integers(min_value=0, max_value=20))
    secuencia = []
    for _ in range(cantidad):
        indices = draw(
            st.lists(
                st.integers(min_value=0, max_value=len(ids) - 1),
                min_size=2,
                max_size=2,
                unique=True,
            )
        )
        a = ids[indices[0]]
        b = ids[indices[1]]
        if draw(st.booleans()):
            # Resultado con ganador declarado entre los dos participantes.
            id_ganador = draw(st.sampled_from([a, b]))
            secuencia.append(
                {
                    "campeonA": a,
                    "campeonB": b,
                    "resultado": "ganador",
                    "idGanador": id_ganador,
                }
            )
        else:
            # Empate: no aporta al total de victorias.
            secuencia.append({"campeonA": a, "campeonB": b, "resultado": "empate"})
    return secuencia


def _crear_tabla_y_poblar(ids):
    """Crea la tabla mock, inserta los campeones con victorias=0 y parchea app._dynamo.

    Cada campeon se almacena con PK = "CAMPEON#<id>" y victorias en 0, replicando
    el estado inicial real (un campeon recien creado parte en cero). Debe
    invocarse dentro de un contexto mock_aws() activo. Devuelve la tabla mock.
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
        for id_campeon in ids:
            lote.put_item(
                Item={
                    "PK": f"CAMPEON#{id_campeon}",
                    "id": id_campeon,
                    "nombre": f"Campeon {id_campeon}",
                    "victorias": 0,
                }
            )

    # La Lambda crea su recurso al importarse (fuera del mock); se sustituye por
    # el recurso mock para que GetItem/UpdateItem operen sobre la tabla en memoria.
    app._dynamo = dynamo
    return tabla


def _suma_total_de_victorias(tabla, ids):
    """Suma el conteo de victorias de todos los campeones desde la tabla mock.

    Replica la consulta al ranking (un Scan en produccion) sumando el atributo
    victorias de cada campeon, para comparar el total observable contra el numero
    de victorias declaradas en la secuencia.
    """
    total = 0
    for id_campeon in ids:
        item = tabla.get_item(Key={"PK": f"CAMPEON#{id_campeon}"}).get("Item", {})
        total += int(item.get("victorias", 0))
    return total


def _invocar(cuerpo):
    """Invoca el handler con el cuerpo dado serializado como body JSON."""
    return app.lambda_handler({"body": json.dumps(cuerpo)}, None)


# --- Property 18: conservacion del total de victorias -----------------------


@settings(max_examples=MAX_EXAMPLES, database=_DB, deadline=None)
@given(
    ids=_ids_de_campeones(),
    datos=st.data(),
)
def test_suma_de_victorias_igual_a_resultados_con_ganador(ids, datos):
    """Tras una secuencia de registros, la suma de victorias de todos los
    campeones es igual al numero de resultados con ganador declarado; los
    empates no aportan (Property 18; Requirement 9.7)."""
    secuencia = datos.draw(_secuencia_de_batallas(ids))

    # El total esperado es el numero de registros con resultado 'ganador',
    # ya que todos los campeones parten de victorias = 0 y cada ganador suma 1.
    victorias_declaradas = sum(1 for b in secuencia if b["resultado"] == "ganador")

    with mock_aws():
        tabla = _crear_tabla_y_poblar(ids)

        for cuerpo in secuencia:
            resultado = _invocar(cuerpo)
            # Cada registro de la secuencia es valido: debe responder HTTP 200.
            assert resultado["statusCode"] == 200, (
                f"El registro {cuerpo} debio aceptarse con 200, pero devolvio "
                f"{resultado['statusCode']}."
            )
            assert json.loads(resultado["body"]) == {"ok": True}

        total = _suma_total_de_victorias(tabla, ids)

    # Invariante de conservacion: la suma de victorias iguala el numero de
    # resultados con ganador declarado (los empates no modifican el total).
    assert total == victorias_declaradas, (
        f"La suma de victorias ({total}) debio igualar el numero de resultados "
        f"con ganador declarado ({victorias_declaradas}) tras {len(secuencia)} "
        f"registros."
    )
