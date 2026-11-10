# backend/generar_arena/app.py
# Lambda generar_arena (POST /arenas).
#
# Elige un tema al azar, genera la imagen de la arena con un modelo de
# Stability AI en Bedrock (IMAGE_REGION) y la guarda en S3 bajo
# generados/arenas/<tema-con-guiones>-<uuid>.jpg. Devuelve {"imagenUrl": ..., "tema": ...}.

import os
import json
import uuid
import base64
import random
import time

import boto3
from botocore.config import Config

from shared.respuesta import respuesta
from shared.reintentos import ForjadorOcupadoError
from shared.rotacion import cuerpo_peticion, invocar_con_rotacion
from shared.arenas import TEMAS, TEMAS_EN, llave_arena

PLANTILLA_PROMPT = (
    "top-down view of an empty circular fantasy battle arena, {tema}, "
    "stone floor in the center clear for fighting, game environment art, "
    "highly detailed, dramatic lighting, no characters, no text"
)

NEGATIVE_PROMPT = "characters, people, text, watermark, blurry, photo"

_CONFIG_IMAGEN = Config(
    read_timeout=25,
    connect_timeout=3,
    retries={"max_attempts": 1},
)
_CONFIG_AWS = Config(read_timeout=5, connect_timeout=3)

_bedrock = boto3.client(
    "bedrock-runtime",
    region_name=os.environ.get("IMAGE_REGION", "us-west-2"),
    config=_CONFIG_IMAGEN,
)
_s3 = boto3.client("s3", config=_CONFIG_AWS)


def _generar_imagen(modelo, prompt):
    """Invoca el modelo de imagen indicado y devuelve los bytes JPEG generados."""
    cuerpo = cuerpo_peticion(modelo, prompt, NEGATIVE_PROMPT)
    salida = _bedrock.invoke_model(
        modelId=modelo,
        body=json.dumps(cuerpo),
        contentType="application/json",
        accept="application/json",
    )
    datos = json.loads(salida["body"].read())

    razones = datos.get("finish_reasons") or [None]
    if razones[0]:
        raise ValueError(f"El modelo no devolvio imagen: {razones[0]}")

    imagenes = datos.get("images") or []
    if not imagenes:
        raise ValueError("El modelo no devolvio ninguna imagen")
    return base64.b64decode(imagenes[0])


def lambda_handler(event, context):
    """Handler de POST /arenas."""
    inicio = time.monotonic()
    try:
        tema = random.choice(TEMAS)
        prompt = PLANTILLA_PROMPT.format(tema=TEMAS_EN[tema])
        imagen = invocar_con_rotacion(
            lambda modelo: _generar_imagen(modelo, prompt), inicio=inicio
        )

        llave = llave_arena(tema, uuid.uuid4())
        _s3.put_object(
            Bucket=os.environ["BUCKET_NAME"],
            Key=llave,
            Body=imagen,
            ContentType="image/jpeg",
        )

        url = f"{os.environ['CLOUDFRONT_URL'].rstrip('/')}/{llave}"
        return respuesta(200, {"imagenUrl": url, "tema": tema}, event)

    except ForjadorOcupadoError as e:
        print(f"WARN generar_arena ocupado: {e}")
        return respuesta(429, {"error": "El forjador está ocupado, reintentando..."}, event)

    except Exception as e:  # noqa: BLE001 - cualquier fallo se reporta como 500
        print(f"ERROR generar_arena: {e}")
        return respuesta(
            500,
            {"error": "No se pudo generar la arena; inténtalo de nuevo"},
            event,
        )
