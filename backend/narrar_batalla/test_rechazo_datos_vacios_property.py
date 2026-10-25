# backend/narrar_batalla/test_rechazo_datos_vacios_property.py
# Prueba basada en propiedades (pytest + Hypothesis) de la Lambda narrar_batalla.
#
# Property 20: Datos de batalla vacios o sin resultado rechazados
# Validates: Requirements 14.4
#
# IF el endpoint recibe datos de batalla vacios o que NO contienen el resultado
# del combate, THEN la Lambda narrar_batalla SHALL retornar un error con codigo
# HTTP 400 y un mensaje en espaniol. Ademas, el rechazo debe ocurrir ANTES de
# invocar Bedrock: una solicitud invalida nunca debe llegar al modelo.
#
# Se cubren las dos familias de entrada invalida descritas por el requisito:
#   1. Datos de batalla vacios: body ausente, None, cadena vacia, "{}", "[]",
#      JSON no valido, o un JSON que no es un objeto (lista, numero, texto...).
#   2. Datos sin resultado: un objeto JSON que omite el campo 'resultado', o que
#      lo trae vacio / solo con espacios / de un tipo que no es texto.
#
# Estrategia de mock: se parchea app._bedrock.converse con un Mock y se verifica
# que NUNCA se invoca, de modo que la prueba no hace ninguna llamada real a
# Bedrock y confirma que la validacion corta el flujo antes del modelo.

import json

from unittest.mock import patch, MagicMock

from hypothesis import given, settings, strategies as st
from hypothesis.database import InMemoryExampleDatabase

import narrar_batalla.app as app

# Minimo de iteraciones por propiedad exigido por el disenio (>= 100).
MAX_EXAMPLES = 100

# Base de ejemplos en memoria: evita escrituras a disco en la carpeta
# sincronizada por OneDrive (.hypothesis/examples), que ralentizan la corrida.
_DB = InMemoryExampleDatabase()


# --- Generadores de valores JSON arbitrarios --------------------------------
#
# Valores JSON cualesquiera para rellenar campos accesorios del body (campeones,
# eventos, idGanador, etc.) sin volverlo valido: el requisito solo exige el
# campo 'resultado', por lo que el resto puede ser cualquier cosa.

_ALFABETO = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 áéíóúñ"

_json_escalar = st.one_of(
    st.none(),
    st.booleans(),
    st.integers(min_value=-1000, max_value=1000),
    st.text(alphabet=_ALFABETO, max_size=20),
)

# Valor arbitrario para un campo accesorio: escalar, lista o pequenio objeto.
_json_valor = st.recursive(
    _json_escalar,
    lambda hijos: st.one_of(
        st.lists(hijos, max_size=3),
        st.dictionaries(st.text(alphabet=_ALFABETO, min_size=1, max_size=8), hijos, max_size=3),
    ),
    max_leaves=5,
)

# Un campeon minimo plausible para acompaniar al body (datos accesorios).
_campeon = st.fixed_dictionaries(
    {
        "id": st.text(alphabet="abcdefghijklmnopqrstuvwxyz0123456789", min_size=1, max_size=10),
        "nombre": st.text(alphabet=_ALFABETO, min_size=1, max_size=20),
    }
)

# Diccionario de campos accesorios (todos opcionales) SIN el campo 'resultado'.
_campos_accesorios = st.fixed_dictionaries(
    {},
    optional={
        "campeonA": _campeon,
        "campeonB": _campeon,
        "idGanador": st.text(alphabet="abcdefghijklmnopqrstuvwxyz0123456789", min_size=1, max_size=10),
        "eventos": st.lists(st.text(alphabet=_ALFABETO, max_size=15), max_size=5),
    },
)


# --- Familia 1: datos de batalla vacios -------------------------------------
#
# Generamos el valor de event["body"] directamente: cadenas vacias/ausentes,
# JSON no valido, o JSON valido que no es un objeto (lista, numero, texto...).


@st.composite
def _body_vacio_o_no_objeto(draw):
    """Genera un event cuyo body representa 'datos de batalla vacios'.

    Incluye body ausente (clave no presente), None, cadena vacia, cadenas que
    no son JSON valido, el objeto vacio "{}", y JSON valido que NO es un objeto
    (listas, numeros, cadenas, booleanos, null).
    """
    opcion = draw(
        st.sampled_from(
            [
                "ausente",      # no hay clave 'body'
                "none",         # body = None
                "cadena_vacia", # body = ""
                "solo_espacios",# body = "   "
                "no_json",      # body = texto que no es JSON
                "objeto_vacio", # body = "{}"
                "no_objeto",    # body = JSON valido pero no dict
            ]
        )
    )

    if opcion == "ausente":
        return {}
    if opcion == "none":
        return {"body": None}
    if opcion == "cadena_vacia":
        return {"body": ""}
    if opcion == "solo_espacios":
        return {"body": draw(st.text(alphabet=" \t\n", min_size=1, max_size=5))}
    if opcion == "no_json":
        # Texto que no empieza como JSON valido (evita que json.loads lo acepte).
        texto = draw(st.text(alphabet=_ALFABETO, min_size=1, max_size=20))
        return {"body": "@" + texto}
    if opcion == "objeto_vacio":
        return {"body": "{}"}

    # no_objeto: JSON valido que no es un diccionario.
    valor = draw(
        st.one_of(
            st.lists(_json_valor, max_size=3),
            st.integers(min_value=-1000, max_value=1000),
            st.text(alphabet=_ALFABETO, max_size=15),
            st.booleans(),
            st.none(),
        )
    )
    return {"body": json.dumps(valor)}


# --- Familia 2: objeto sin un resultado valido ------------------------------


@st.composite
def _body_sin_resultado(draw):
    """Genera un event cuyo body es un objeto JSON sin un 'resultado' valido.

    El objeto puede traer campos accesorios (campeones, eventos, idGanador) pero
    o bien omite 'resultado', o lo incluye vacio/solo espacios o de un tipo que
    no es texto (None, numero, booleano, lista, objeto).
    """
    cuerpo = dict(draw(_campos_accesorios))

    modo = draw(st.sampled_from(["omitido", "vacio", "espacios", "no_texto"]))

    if modo == "omitido":
        # Asegurar que la clave no esta presente.
        cuerpo.pop("resultado", None)
    elif modo == "vacio":
        cuerpo["resultado"] = ""
    elif modo == "espacios":
        cuerpo["resultado"] = draw(st.text(alphabet=" \t\n", min_size=1, max_size=5))
    else:  # no_texto
        cuerpo["resultado"] = draw(
            st.one_of(
                st.none(),
                st.integers(min_value=-1000, max_value=1000),
                st.booleans(),
                st.lists(_json_valor, max_size=3),
                st.dictionaries(
                    st.text(alphabet=_ALFABETO, min_size=1, max_size=6),
                    _json_valor,
                    max_size=3,
                ),
            )
        )

    return {"body": json.dumps(cuerpo)}


# --- Deteccion de "mensaje en espaniol" -------------------------------------
#
# Heuristica ligera: el mensaje de error debe contener texto y palabras propias
# del espaniol usadas por los mensajes del handler (p. ej. "cuerpo", "datos",
# "batalla", "resultado", "solicitud", "válido"). Basta con que aparezca alguna.

_PALABRAS_ESPANOL = (
    "cuerpo",
    "solicitud",
    "datos",
    "batalla",
    "resultado",
    "válido",
    "valido",
    "incompletos",
    "falta",
)


def _es_mensaje_en_espanol(mensaje):
    """True si el mensaje de error parece estar en espaniol (heuristica)."""
    if not isinstance(mensaje, str) or mensaje.strip() == "":
        return False
    texto = mensaje.lower()
    return any(palabra in texto for palabra in _PALABRAS_ESPANOL)


def _invocar(event):
    """Invoca el handler con Bedrock mockeado y devuelve (respuesta, mock).

    El cliente Bedrock real se reemplaza por un Mock para confirmar que una
    solicitud invalida NO lo invoca (la validacion corta antes del modelo).
    """
    mock_bedrock = MagicMock()
    with patch.object(app, "_bedrock", mock_bedrock):
        resultado = app.lambda_handler(event, None)
    return resultado, mock_bedrock


def _afirmar_rechazo_400(resultado, mock_bedrock):
    """Comprueba la invariante de Property 20 para una entrada invalida.

    - HTTP 400.
    - Cuerpo JSON con un campo 'error' que es un mensaje en espaniol no vacio.
    - Bedrock no fue invocado.
    """
    assert resultado["statusCode"] == 400, (
        f"Se esperaba HTTP 400 para datos de batalla invalidos, pero fue "
        f"{resultado['statusCode']}."
    )

    cuerpo_resp = json.loads(resultado["body"])
    mensaje = cuerpo_resp.get("error")
    assert _es_mensaje_en_espanol(mensaje), (
        f"El mensaje de error debe estar en espaniol y no vacio: {mensaje!r}"
    )

    # El rechazo ocurre antes de contactar al modelo: converse nunca se llama.
    mock_bedrock.converse.assert_not_called()


# --- Property 20: datos de batalla vacios o sin resultado rechazados --------


@settings(max_examples=MAX_EXAMPLES, database=_DB, deadline=None)
@given(event=_body_vacio_o_no_objeto())
def test_datos_vacios_rechazados_con_400(event):
    """Datos de batalla vacios (body ausente/vacio/no-JSON/no-objeto) son
    rechazados con HTTP 400 y mensaje en espaniol, sin invocar Bedrock
    (Property 20; Requirement 14.4)."""
    resultado, mock_bedrock = _invocar(event)
    _afirmar_rechazo_400(resultado, mock_bedrock)


@settings(max_examples=MAX_EXAMPLES, database=_DB, deadline=None)
@given(event=_body_sin_resultado())
def test_datos_sin_resultado_rechazados_con_400(event):
    """Un objeto de batalla sin un 'resultado' valido (omitido, vacio, solo
    espacios o de tipo no textual) es rechazado con HTTP 400 y mensaje en
    espaniol, sin invocar Bedrock (Property 20; Requirement 14.4)."""
    resultado, mock_bedrock = _invocar(event)
    _afirmar_rechazo_400(resultado, mock_bedrock)
