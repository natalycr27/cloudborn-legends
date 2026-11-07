# backend/generar_retrato/app.py
# Lambda generar_retrato (POST /campeones/{id}/retrato).
#
# Genera con un modelo de Stability AI en Bedrock (IMAGE_REGION) el retrato del
# campeon, lo guarda en S3 (generados/campeones/<id>-<timestamp>.jpg) y registra
# "imagenUrl" en DynamoDB. Si el campeon ya tiene imagenUrl, la devuelve sin
# generar otra para no pagar dos veces.

import os
import re
import time
import json
import base64

import boto3
from botocore.config import Config

from shared.respuesta import respuesta

# Sufijo de estilo anexado al prompt visual del campeon.
SUFIJO_PROMPT = (
    ", stylized fantasy game character illustration, painterly concept art, "
    "vibrant colors, glowing magical effects, centered, upper body, dark background"
)

NEGATIVE_PROMPT = (
    "photorealistic, photo, photograph, realistic skin, real person, "
    "celebrity, text, watermark, blurry"
)

# Region del modelo de texto (Nova Micro) usado para crear promptImagen.
TEXT_REGION = "us-east-1"

PROMPT_SISTEMA = (
    "You write visual descriptions of fantasy game characters for an image "
    "generator. Reply ONLY with the description, in English, at most 60 words. "
    "Never mention video games, brands, existing characters or real people."
)

# Solo se aceptan ids con forma de UUID (evita claves S3/DynamoDB arbitrarias).
_PATRON_ID = re.compile(r"^[0-9a-fA-F-]{8,64}$")

# Generar imagenes tarda varios segundos; el timeout de la Lambda es 28 s.
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
_bedrock_texto = boto3.client(
    "bedrock-runtime",
    region_name=TEXT_REGION,
    config=Config(read_timeout=10, connect_timeout=3, retries={"max_attempts": 1}),
)
_s3 = boto3.client("s3", config=_CONFIG_AWS)
_dynamo = boto3.resource("dynamodb", config=_CONFIG_AWS)


def _generar_prompt_imagen(item):
    """Pide a Nova Micro una descripcion visual (EN, max 60 palabras) del campeon."""
    est = item.get("estadisticas") or {}
    stats = ", ".join(f"{k}: {v}" for k, v in est.items())
    habilidades = ", ".join(str(h) for h in (item.get("habilidades") or []))
    usuario = (
        f"Name: {item.get('nombre', '')}\n"
        f"Abilities: {habilidades}\n"
        f"Stats: {stats}\n"
        f"Primary color: {item.get('colorPrincipal', '')}\n"
        f"Secondary color: {item.get('colorSecundario', '')}\n"
        "Write the visual description (max 60 words)."
    )
    salida = _bedrock_texto.converse(
        modelId=os.environ["BEDROCK_MODEL_ID"],
        system=[{"text": PROMPT_SISTEMA}],
        messages=[{"role": "user", "content": [{"text": usuario}]}],
        inferenceConfig={"maxTokens": 200, "temperature": 0.7},
    )
    texto = salida["output"]["message"]["content"][0]["text"].strip()
    # Garantiza el limite de 60 palabras aunque el modelo se pase.
    palabras = texto.split()
    if not palabras:
        raise ValueError("Nova no devolvio descripcion")
    return " ".join(palabras[:60])


def _generar_imagen(prompt):
    """Invoca el modelo de imagen y devuelve los bytes JPEG generados."""
    cuerpo = {
        "prompt": prompt,
        "negative_prompt": NEGATIVE_PROMPT,
        "mode": "text-to-image",
        "aspect_ratio": "1:1",
        "output_format": "jpeg",
    }
    salida = _bedrock.invoke_model(
        modelId=os.environ["IMAGE_MODEL_ID"],
        body=json.dumps(cuerpo),
        contentType="application/json",
        accept="application/json",
    )
    datos = json.loads(salida["body"].read())

    # finish_reasons con valor no nulo indica filtrado de contenido o error.
    razones = datos.get("finish_reasons") or [None]
    if razones[0]:
        raise ValueError(f"El modelo no devolvio imagen: {razones[0]}")

    imagenes = datos.get("images") or []
    if not imagenes:
        raise ValueError("El modelo no devolvio ninguna imagen")
    return base64.b64decode(imagenes[0])


def lambda_handler(event, context):
    """Handler de POST /campeones/{id}/retrato."""
    try:
        campeon_id = ((event or {}).get("pathParameters") or {}).get("id", "")
        if not isinstance(campeon_id, str) or not _PATRON_ID.match(campeon_id):
            return respuesta(400, {"error": "El id del campeón no es válido"}, event)

        tabla = _dynamo.Table(os.environ["TABLE_NAME"])
        clave = {"PK": f"CAMPEON#{campeon_id}"}
        item = tabla.get_item(Key=clave).get("Item")
        if not item:
            return respuesta(404, {"error": "Campeón no encontrado"}, event)

        # Ya tiene retrato: no se genera otro (evita pagar dos veces).
        if item.get("imagenUrl"):
            return respuesta(200, {"imagenUrl": item["imagenUrl"]}, event)

        base = item.get("promptImagen")
        if not base:
            base = _generar_prompt_imagen(item)
            tabla.update_item(
                Key=clave,
                UpdateExpression="SET promptImagen = :p",
                ExpressionAttributeValues={":p": base},
            )
        imagen = _generar_imagen(base + SUFIJO_PROMPT)

        # Nombre unico para que CloudFront no sirva una version vieja en cache.
        llave = f"generados/campeones/{campeon_id}-{int(time.time())}.jpg"
        _s3.put_object(
            Bucket=os.environ["BUCKET_NAME"],
            Key=llave,
            Body=imagen,
            ContentType="image/jpeg",
        )

        url = f"{os.environ['CLOUDFRONT_URL'].rstrip('/')}/{llave}"
        tabla.update_item(
            Key=clave,
            UpdateExpression="SET imagenUrl = :u",
            ExpressionAttributeValues={":u": url},
        )
        return respuesta(200, {"imagenUrl": url}, event)

    except Exception as e:  # noqa: BLE001 - cualquier fallo se reporta como 500
        print(f"ERROR generar_retrato: {e}")
        return respuesta(
            500,
            {"error": "No se pudo generar el retrato del campeón; inténtalo de nuevo"},
            event,
        )
