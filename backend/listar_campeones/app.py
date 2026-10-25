# backend/listar_campeones/app.py
# Lambda listar_campeones (GET /campeones).
#
# Responsabilidad (tarea 4.1): leer TODOS los campeones almacenados en DynamoDB
# y devolverlos como un arreglo JSON.
#   - Devuelve HTTP 200 con el arreglo completo de campeones (arreglo vacio []
#     si la tabla no tiene items).
#   - Pagina el Scan usando LastEvaluatedKey para garantizar que se devuelvan
#     TODOS los items aunque DynamoDB trocee la respuesta en varias paginas.
#   - Si DynamoDB no responde dentro de 5 s (read_timeout) o falla, devuelve
#     HTTP 500 en español usando el helper respuesta()
#     (Requirements 11.1, 11.2, 11.3, 11.4, 11.5).

import os

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from shared.respuesta import respuesta

# Configuracion del cliente DynamoDB: read_timeout=5, connect_timeout=3
# (Requirement 11.5). Si DynamoDB excede 5 s leyendo, boto3 lanza un timeout que
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
    hasta agotar la tabla, de modo que se devuelven TODOS los campeones
    almacenados (Requirement 11.2). Si la tabla esta vacia, devuelve [].
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


def lambda_handler(event, context):
    """Handler de la Lambda listar_campeones (GET /campeones).

    Ejecuta un Scan paginado sobre la tabla y devuelve HTTP 200 con un arreglo
    JSON de todos los campeones almacenados (arreglo vacio [] si no hay ninguno;
    Requirements 11.3 y 11.4). Si DynamoDB no responde dentro de 5 s o falla,
    devuelve HTTP 500 en español indicando que el servicio no esta disponible
    (Requirement 11.5). El event se propaga a respuesta() para resolver el
    header CORS Origin correctamente.
    """
    try:
        campeones = _scan_todos_los_campeones()
    except (BotoCoreError, ClientError) as e:
        print(f"ERROR DynamoDB: {e}")
        return respuesta(
            500,
            {"error": "El servicio no está disponible"},
            event,
        )

    for c in campeones:
           c.pop("PK", None)
           
    # HTTP 200 con el arreglo de campeones (vacio si la tabla no tiene items).
    return respuesta(200, campeones, event)
