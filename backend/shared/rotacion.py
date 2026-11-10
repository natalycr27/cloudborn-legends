# backend/shared/rotacion.py
# Rotacion entre modelos de imagen de Bedrock ante ThrottlingException.
#
# Cada modelo tiene un limite de 1 solicitud por minuto, asi que ante un
# ThrottlingException se pasa de inmediato al siguiente modelo. Si los tres
# estan ocupados se espera y se repite la ronda, sin pasar del limite total.

import time

from shared.reintentos import es_throttling, ForjadorOcupadoError

# Modelos de imagen (us-west-2), en orden de preferencia.
MODELOS_IMAGEN = (
    "stability.sd3-5-large-v1:0",
    "stability.stable-image-core-v1:1",
    "stability.stable-image-ultra-v1:1",
)

ESPERA_ENTRE_RONDAS_SEGUNDOS = 5
LIMITE_TOTAL_SEGUNDOS = 24

# Modelos que aceptan (y requieren) el campo "mode"; Core y Ultra no lo usan.
_MODELOS_CON_MODE = ("stability.sd3-5-large-v1:0",)


def cuerpo_peticion(modelo, prompt, negative_prompt):
    """Cuerpo JSON compatible con los tres modelos de Stability AI."""
    cuerpo = {
        "prompt": prompt,
        "negative_prompt": negative_prompt,
        "aspect_ratio": "1:1",
        "output_format": "jpeg",
    }
    if modelo in _MODELOS_CON_MODE:
        cuerpo["mode"] = "text-to-image"
    return cuerpo


def invocar_con_rotacion(
    invocar,
    inicio=None,
    modelos=MODELOS_IMAGEN,
    espera=ESPERA_ENTRE_RONDAS_SEGUNDOS,
    limite=LIMITE_TOTAL_SEGUNDOS,
    dormir=time.sleep,
    reloj=time.monotonic,
):
    """Llama a invocar(modelo) probando cada modelo; ante ThrottlingException
    pasa al siguiente sin esperar. Tras una ronda completa ocupada espera
    'espera' s y repite, sin superar 'limite' s desde 'inicio'. Si no se logra,
    lanza ForjadorOcupadoError. Otros errores se propagan sin reintentar.
    """
    if inicio is None:
        inicio = reloj()
    ultimo = None
    while True:
        for modelo in modelos:
            if (reloj() - inicio) >= limite:
                raise ForjadorOcupadoError(str(ultimo))
            try:
                return invocar(modelo)
            except Exception as e:  # noqa: BLE001
                if not es_throttling(e):
                    raise
                print(f"WARN {modelo} ThrottlingException; probando siguiente")
                ultimo = e
        if (reloj() - inicio) + espera > limite:
            raise ForjadorOcupadoError(str(ultimo))
        dormir(espera)