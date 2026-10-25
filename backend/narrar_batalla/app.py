# backend/narrar_batalla/app.py
# Lambda narrar_batalla (POST /narraciones).
#
# Flujo (tarea 5.4):
#   1. Recibe los datos de una batalla finalizada (resultado, campeones y
#      eventos). Valida que el body sea un JSON objeto que contenga el campo
#      'resultado'; si no, devuelve HTTP 400 en español (Requirements 8.1,
#      14.4, 19.2).
#   2. Invoca Bedrock (API Converse) para generar un comentario narrativo en
#      español de entre 100 y 500 caracteres (Requirements 8.2, 14.1, 14.2).
#   3. Si Bedrock falla, se agota el tiempo, o el texto queda fuera del rango
#      100-500, construye una narración de respaldo que siempre cae dentro de
#      ese rango y responde HTTP 200 con usadoRespaldo=true (Requirements 8.3,
#      8.4, 14.3, 14.5, 19.3). En caso de éxito responde con usadoRespaldo=false.

import os
import json

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from shared.respuesta import respuesta

# Rango de longitud permitido para la narración (en caracteres, tras strip).
NARRACION_MIN = 100
NARRACION_MAX = 500

# Prompt de sistema que instruye a Bedrock a devolver UNICAMENTE el texto
# narrativo en español dentro del rango de longitud exigido (Requirement 14.1).
SYSTEM_PROMPT = (
    "Eres el narrador de un juego de arena de combate. Recibirás el resultado "
    "de una batalla entre dos campeones y una lista de eventos. Genera un "
    "comentario narrativo en español de entre 100 y 500 caracteres que "
    "mencione el resultado de la batalla y al menos un evento ocurrido. "
    "Devuelve únicamente el texto narrativo, sin formato JSON."
)

# Configuracion del cliente Bedrock: limite end-to-end de 15 s de la Lambda.
# read_timeout=12 (Requirement 19.2), connect_timeout=3, sin reintentos para
# no exceder el presupuesto de tiempo de la invocacion.
_CONFIG_BEDROCK = Config(
    read_timeout=12,
    connect_timeout=3,
    retries={"max_attempts": 1},
)

# Cliente de Bedrock Runtime reutilizado entre invocaciones (se crea una sola
# vez por contenedor de Lambda para aprovechar las conexiones en caliente).
_bedrock = boto3.client("bedrock-runtime", config=_CONFIG_BEDROCK)


def _nombre_campeon(campeon, por_defecto):
    """Extrae el nombre de un campeón de forma tolerante.

    'campeon' puede ser un diccionario completo de campeón (se usa su campo
    'nombre'), None, o cualquier otro valor. Si el nombre falta o no es texto
    válido, devuelve el valor por defecto indicado ("Campeón A"/"Campeón B").
    """
    if isinstance(campeon, dict):
        nombre = campeon.get("nombre")
        if isinstance(nombre, str) and nombre.strip():
            return nombre.strip()
    return por_defecto


def _id_campeon(campeon):
    """Devuelve el id de un campeón si viene como diccionario; si no, None."""
    if isinstance(campeon, dict):
        return campeon.get("id")
    return None


def _nombre_ganador(cuerpo, nombre_a, nombre_b):
    """Determina el nombre del ganador a partir de idGanador.

    Compara 'idGanador' del body contra los ids de campeonA y campeonB. Si
    coincide con B devuelve su nombre; en cualquier otro caso (coincide con A,
    es ambiguo o falta) devuelve el nombre de A como valor de respaldo.
    """
    id_ganador = cuerpo.get("idGanador")
    campeon_a = cuerpo.get("campeonA")
    campeon_b = cuerpo.get("campeonB")

    if id_ganador is not None and _id_campeon(campeon_b) == id_ganador:
        return nombre_b
    return nombre_a


def _construir_mensaje_usuario(cuerpo, nombre_a, nombre_b):
    """Construye el user message para Bedrock con el resultado y los eventos.

    Formatea el resultado, los nombres de ambos campeones y la lista de eventos
    de la batalla siguiendo la plantilla del diseño.
    """
    resultado = cuerpo.get("resultado")
    eventos = cuerpo.get("eventos")
    if not isinstance(eventos, list):
        eventos = []

    # Representación textual compacta de los eventos para el prompt.
    eventos_texto = ", ".join(str(ev) for ev in eventos) if eventos else "ninguno"

    return (
        f"Resultado: {resultado}. "
        f"Campeón A: {nombre_a}. "
        f"Campeón B: {nombre_b}. "
        f"Eventos: {eventos_texto}."
    )


def _invocar_bedrock(mensaje_usuario):
    """Invoca Bedrock (API Converse) y devuelve el texto narrativo generado.

    Usa el modelo indicado por la variable de entorno BEDROCK_MODEL_ID
    (por defecto amazon.nova-micro-v1:0) con maxTokens=400 y temperature=0.8.
    Extrae el texto de la respuesta Converse.
    """
    model_id = os.environ.get("BEDROCK_MODEL_ID", "amazon.nova-micro-v1:0")

    salida = _bedrock.converse(
        modelId=model_id,
        messages=[
            {
                "role": "user",
                "content": [{"text": mensaje_usuario}],
            }
        ],
        system=[{"text": SYSTEM_PROMPT}],
        inferenceConfig={
            "maxTokens": 400,
            "temperature": 0.8,
        },
    )

    return salida["output"]["message"]["content"][0]["text"]


def _frase_resultado(cuerpo, nombre_ganador):
    """Construye la frase de resultado para la narración de respaldo.

    Para 'empate' indica que el combate terminó en empate; en cualquier otro
    caso ('ganador') menciona al ganador alzándose con la victoria.
    """
    resultado = cuerpo.get("resultado")
    if resultado == "empate":
        return "El combate terminó en empate tras una intensa lucha en la arena"
    return f"{nombre_ganador} se alzó con la victoria tras una intensa lucha en la arena"


def _narracion_respaldo(cuerpo, nombre_a, nombre_b):
    """Construye una narración de respaldo garantizada entre 100 y 500 chars.

    Usa la plantilla del diseño incluyendo los nombres de ambos campeones y la
    frase de resultado. El texto base de la plantilla ya supera los 100
    caracteres, por lo que el límite inferior siempre se cumple. Para respetar
    el límite superior se truncan los nombres de los campeones si hiciera falta.
    """
    nombre_ganador = _nombre_ganador(cuerpo, nombre_a, nombre_b)

    def _construir(na, nb, ng):
        # Ensambla la plantilla completa con los nombres (posiblemente truncados).
        return (
            f"La batalla entre {na} y {nb} ha terminado. "
            f"{_frase_resultado(cuerpo, ng)}. "
            "Los campeones demostraron su valor y el público coreó sus nombres. "
            "Una leyenda más se escribe en el Salón de las Leyendas."
        )

    texto = _construir(nombre_a, nombre_b, nombre_ganador)

    # Si la plantilla supera el límite superior (nombres muy largos), truncar
    # progresivamente los nombres hasta encajar en 500 caracteres.
    while len(texto) > NARRACION_MAX and (len(nombre_a) > 1 or len(nombre_b) > 1):
        if len(nombre_a) >= len(nombre_b) and len(nombre_a) > 1:
            nombre_a = nombre_a[:-1].rstrip()
            if not nombre_a:
                nombre_a = "A"
        elif len(nombre_b) > 1:
            nombre_b = nombre_b[:-1].rstrip()
            if not nombre_b:
                nombre_b = "B"
        nombre_ganador = _nombre_ganador(cuerpo, nombre_a, nombre_b)
        texto = _construir(nombre_a, nombre_b, nombre_ganador)

    # Salvaguarda final: si aún excede (p. ej. frase de ganador muy larga por un
    # nombre), recortar duro para garantizar el límite superior.
    if len(texto) > NARRACION_MAX:
        texto = texto[:NARRACION_MAX]

    return texto


def lambda_handler(event, context):
    """Handler de la Lambda narrar_batalla (POST /narraciones).

    Parsea el body JSON de forma tolerante y valida que sea un objeto que
    contenga el campo 'resultado'; si no, devuelve HTTP 400 en español. Invoca
    Bedrock para generar la narración y verifica que tenga entre 100 y 500
    caracteres: si lo cumple responde HTTP 200 con usadoRespaldo=false. Ante
    fallo o timeout de Bedrock, o un texto fuera de rango, construye una
    narración de respaldo (siempre dentro de 100-500 caracteres) y responde
    HTTP 200 con usadoRespaldo=true.
    """
    # Parsear el body de la peticion de forma tolerante (puede venir como texto).
    try:
        cuerpo = json.loads(event.get("body") or "{}")
    except (ValueError, TypeError):
        return respuesta(
            400,
            {"error": "El cuerpo de la solicitud no es JSON válido"},
            event,
        )

    if not isinstance(cuerpo, dict):
        return respuesta(
            400,
            {"error": "El cuerpo de la solicitud no es JSON válido"},
            event,
        )

    # Validacion: los datos de batalla deben incluir el resultado (Req. 14.4).
    resultado = cuerpo.get("resultado")
    if not isinstance(resultado, str) or resultado.strip() == "":
        return respuesta(
            400,
            {"error": "Los datos de la batalla están incompletos: falta el resultado"},
            event,
        )

    # Extraer los nombres de los campeones de forma robusta (pueden faltar).
    nombre_a = _nombre_campeon(cuerpo.get("campeonA"), "Campeón A")
    nombre_b = _nombre_campeon(cuerpo.get("campeonB"), "Campeón B")

    # Invocar Bedrock. Cualquier fallo, timeout o estructura inesperada se
    # traduce en la narración de respaldo (no en un error HTTP).
    try:
        mensaje_usuario = _construir_mensaje_usuario(cuerpo, nombre_a, nombre_b)
        texto = _invocar_bedrock(mensaje_usuario)
        texto = (texto or "").strip()

        # Verificar el rango de longitud exigido (Requirement 14.2).
        if NARRACION_MIN <= len(texto) <= NARRACION_MAX:
            return respuesta(200, {"narracion": texto, "usadoRespaldo": False}, event)

        # Texto fuera de rango -> usar respaldo (Requirement 14.3/14.5).
        print(f"WARN narracion fuera de rango ({len(texto)} chars); usando respaldo")
    except (BotoCoreError, ClientError, KeyError, IndexError) as e:
        print(f"ERROR Bedrock: {e}")

    # Narración de respaldo garantizada dentro de 100-500 caracteres.
    respaldo = _narracion_respaldo(cuerpo, nombre_a, nombre_b)
    return respuesta(200, {"narracion": respaldo, "usadoRespaldo": True}, event)
