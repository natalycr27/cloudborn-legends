# backend/obtener_ranking/app.py
# Lambda obtener_ranking (GET /ranking).
#
# Responsabilidad (tarea 4.2): leer TODOS los campeones de DynamoDB y
# devolverlos como un ranking ordenado (el "Salón de las Leyendas").
#   - Ordena los campeones por numero de victorias en orden DESCENDENTE y, a
#     igualdad de victorias, por nombre en orden ASCENDENTE (Requirements 9.1,
#     13.2).
#   - Devuelve como maximo 100 entradas (Requirements 13.2, propiedad "cota de
#     tamaño").
#   - Devuelve HTTP 200 con el arreglo ordenado (arreglo vacio [] si la tabla no
#     tiene campeones; Requirements 13.3, 13.4).
#   - Pagina el Scan usando LastEvaluatedKey para garantizar que se consideren
#     TODOS los items antes de ordenar aunque DynamoDB trocee la respuesta.
#   - Si DynamoDB no responde dentro de 5 s (read_timeout) o falla, devuelve
#     HTTP 500 en español usando el helper respuesta() (Requirement 13.5).

import os

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from shared.respuesta import respuesta

# Numero maximo de campeones que se devuelven en el ranking (Requirement 13.2).
_MAX_ENTRADAS = 100

# Configuracion del cliente DynamoDB: read_timeout=5, connect_timeout=3
# (Requirement 13.5). Si DynamoDB excede 5 s leyendo, boto3 lanza un timeout que
# se traduce en HTTP 500.
_CONFIG_DYNAMO = Config(
    read_timeout=5,
    connect_timeout=3,
)

# Recurso DynamoDB reutilizado entre invocaciones (se crea una sola vez por
# contenedor de Lambda para aprovechar las conexiones en caliente). El nombre de
# la tabla se lee de la variable de entorno TABLE_NAME inyectada por SAM.
_dynamo = boto3.resource("dynamodb", config=_CONFIG_DYNAMO)


def _scan_todos_los_campeones():
    """Ejecuta un Scan paginado sobre la tabla y devuelve todos los items.

    DynamoDB puede trocear el resultado de un Scan en varias paginas (limite de
    1 MB por pagina); se itera usando LastEvaluatedKey como ExclusiveStartKey
    hasta agotar la tabla, de modo que se consideran TODOS los campeones antes de
    ordenar. Si la tabla esta vacia, devuelve [].
    """
    tabla = _dynamo.Table(os.environ["TABLE_NAME"])

    items = []
    argumentos = {}
    while True:
        resultado = tabla.scan(**argumentos)
        items.extend(resultado.get("Items", []))

        # Si no hay mas paginas, LastEvaluatedKey no viene en la respuesta.
        clave_siguiente = resultado.get("LastEvaluatedKey")
        if not clave_siguiente:
            break
        argumentos["ExclusiveStartKey"] = clave_siguiente

    return items


def _ordenar_ranking(campeones):
    """Ordena los campeones para el Salón de las Leyendas y aplica la cota de 100.

    Orden: victorias DESCENDENTE y, a igualdad de victorias, nombre ASCENDENTE
    (Requirements 9.1, 13.2). Se consigue en una sola llamada a sorted() usando
    una clave compuesta: el nombre en orden natural ascendente y las victorias
    negadas para invertir solo ese criterio a descendente. El valor de victorias
    llega desde DynamoDB como Decimal; negarlo y compararlo funciona sin
    conversiones adicionales. Finalmente se recortan las primeras 100 entradas
    (Requirement 13.2).
    """
    ordenados = sorted(
        campeones,
        key=lambda c: (-c.get("victorias", 0), c.get("nombre", "")),
    )
    return ordenados[:_MAX_ENTRADAS]


def lambda_handler(event, context):
    """Handler de la Lambda obtener_ranking (GET /ranking).

    Ejecuta un Scan paginado sobre la tabla, ordena los campeones por victorias
    descendente y nombre ascendente, recorta a un maximo de 100 entradas y
    devuelve HTTP 200 con el arreglo ordenado (arreglo vacio [] si no hay
    campeones; Requirements 13.3, 13.4). Si DynamoDB no responde dentro de 5 s o
    falla, devuelve HTTP 500 en español indicando que el ranking no esta
    disponible (Requirement 13.5). El event se propaga a respuesta() para
    resolver el header CORS Origin correctamente.
    """
    try:
        campeones = _scan_todos_los_campeones()
    except (BotoCoreError, ClientError) as e:
        print(f"ERROR DynamoDB: {e}")
        return respuesta(
            500,
            {"error": "El ranking no está disponible"},
            event,
        )

    ranking = _ordenar_ranking(campeones)

    for c in ranking:
           c.pop("PK", None)
    
    # HTTP 200 con el ranking ordenado (vacio si la tabla no tiene campeones).
    return respuesta(200, ranking, event)
