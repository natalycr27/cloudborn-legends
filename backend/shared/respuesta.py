# backend/shared/respuesta.py
# Helper compartido por las 5 Lambdas: asegura que TODAS las respuestas HTTP
# (incluidas las de error) incluyan los headers CORS necesarios.

import os
import json
from decimal import Decimal

# Orígenes de localhost permitidos siempre para pruebas locales del frontend.
# El dominio de CloudFront se añade en tiempo de ejecución desde ALLOWED_ORIGIN.
ORIGENES_LOCALES = [
    "http://localhost",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
]


def _origenes_permitidos():
    """Construye la lista de orígenes permitidos para la petición actual.

    El dominio de CloudFront se inyecta como variable de entorno ALLOWED_ORIGIN
    desde SAM. Se resuelve en cada llamada (no al importar) para que las pruebas
    y los distintos entornos puedan definir la variable correctamente.
    El primer elemento es siempre el origen de CloudFront, que actúa como
    valor de respaldo (fallback) cuando el origen de la petición no está permitido.
    """
    cloudfront = os.environ.get("ALLOWED_ORIGIN", "")
    return [cloudfront, *ORIGENES_LOCALES]


def respuesta(status, cuerpo, event=None):
    """Construye una respuesta HTTP con headers CORS en todos los casos.

    Compara el header Origin de la petición contra la lista de orígenes permitidos
    y devuelve ese origen en Access-Control-Allow-Origin si está en la lista; en
    caso contrario devuelve el origen de CloudFront como respaldo.
    Un solo origen por respuesta: nunca se devuelven varios orígenes en el mismo
    header Access-Control-Allow-Origin.
    """
    permitidos = _origenes_permitidos()

    # Extraer el header Origin de la petición de forma tolerante:
    # event puede ser None y los headers pueden faltar o ser None;
    # además el header puede venir como "origin" o "Origin" (case-insensitive).
    headers_peticion = (event or {}).get("headers") or {}
    origen = headers_peticion.get("origin") or headers_peticion.get("Origin", "")

    # Devolver el origen de la petición solo si está en la lista permitida;
    # de lo contrario, usar el origen de CloudFront (primer elemento) como fallback.
    origen_permitido = origen if origen in permitidos else permitidos[0]

    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origen_permitido,
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        },
        "body": json.dumps(cuerpo, ensure_ascii=False),
    }
