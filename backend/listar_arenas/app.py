# backend/listar_arenas/app.py
# Lambda listar_arenas (GET /arenas).
#
# Lista las arenas pregeneradas en S3 (generados/arenas/) y devuelve
# [{"imagenUrl": ..., "tema": ...}]. No usa DynamoDB.

import os

import boto3
from botocore.config import Config

from shared.respuesta import respuesta
from shared.arenas import PREFIJO_ARENAS, tema_desde_llave

_s3 = boto3.client("s3", config=Config(read_timeout=5, connect_timeout=3))


def lambda_handler(event, context):
    """Handler de GET /arenas."""
    try:
        base = os.environ["CLOUDFRONT_URL"].rstrip("/")
        arenas = []
        paginas = _s3.get_paginator("list_objects_v2").paginate(
            Bucket=os.environ["BUCKET_NAME"], Prefix=PREFIJO_ARENAS
        )
        for pagina in paginas:
            for objeto in pagina.get("Contents", []):
                llave = objeto["Key"]
                if not llave.lower().endswith(".jpg"):
                    continue
                arenas.append(
                    {"imagenUrl": f"{base}/{llave}", "tema": tema_desde_llave(llave)}
                )
        return respuesta(200, arenas, event)
    except Exception as e:  # noqa: BLE001
        print(f"ERROR listar_arenas: {e}")
        return respuesta(500, {"error": "No se pudieron listar las arenas"}, event)