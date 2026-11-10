# backend/shared/reintentos.py
# Reintentos con espera creciente ante ThrottlingException de Bedrock.

import time

from botocore.exceptions import ClientError

# Esperas entre intentos (segundos) y tiempo total maximo desde el inicio.
ESPERAS_SEGUNDOS = (3, 6, 12)
LIMITE_TOTAL_SEGUNDOS = 25


class ForjadorOcupadoError(Exception):
    """Bedrock siguio devolviendo ThrottlingException tras los reintentos."""


def es_throttling(error):
    """True si el error es un ThrottlingException de AWS."""
    if not isinstance(error, ClientError):
        return False
    return error.response.get("Error", {}).get("Code") == "ThrottlingException"


def con_reintentos_throttling(
    funcion,
    inicio=None,
    esperas=ESPERAS_SEGUNDOS,
    limite=LIMITE_TOTAL_SEGUNDOS,
    dormir=time.sleep,
    reloj=time.monotonic,
):
    """Ejecuta funcion(); ante ThrottlingException espera 3, 6 y 12 s y reintenta.

    No espera si con la siguiente pausa se superaria 'limite' segundos desde
    'inicio' (por defecto, el momento de la llamada). Si no se logra, lanza
    ForjadorOcupadoError. Cualquier otro error se propaga sin reintentar.
    """
    if inicio is None:
        inicio = reloj()
    for espera in (*esperas, None):
        try:
            return funcion()
        except ClientError as e:
            if not es_throttling(e):
                raise
            print(f"WARN Bedrock ThrottlingException (espera siguiente: {espera})")
            if espera is None or (reloj() - inicio) + espera > limite:
                raise ForjadorOcupadoError(str(e)) from e
            dormir(espera)
