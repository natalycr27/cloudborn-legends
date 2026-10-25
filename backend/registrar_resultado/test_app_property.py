# backend/registrar_resultado/test_app_property.py
# Pruebas basadas en propiedades (pytest + Hypothesis) de la Lambda registrar_resultado.
#
# Property 16: Aislamiento del incremento de victorias
# Property 17: El empate no modifica los conteos de victorias
# Property 19: Registro de resultado inválido rechazado sin efectos colaterales
# Validates: Requirements 9.2, 9.4, 9.5, 9.6, 12.2, 12.3, 12.4, 12.5, 12.6
#
# Property 16 (aislamiento): para CUALQUIER conjunto de campeones (N >= 2) con
#   conteos de victorias iniciales arbitrarios, tras un registro valido con
#   resultado 'ganador' sobre dos participantes, SOLO el ganador incrementa su
#   conteo en EXACTAMENTE 1; cualquier otro campeon (incluido el participante no
#   ganador) queda sin cambios (Requirements 9.2, 9.5, 9.6, 12.2).
#
# Property 17 (empate): para CUALQUIER registro valido con resultado 'empate'
#   sobre dos participantes existentes, NINGUN campeon modifica su conteo de
#   victorias (Requirements 9.4, 12.3).
#
# Property 19 (integridad ante error): para CUALQUIER solicitud que resulte en
#   HTTP 400 (falta campeonA/campeonB/resultado, idGanador vacio/ausente,
#   idGanador que no es participante, idGanador inexistente en DynamoDB, o un
#   valor de 'resultado' invalido), el handler SHALL responder HTTP 400 y SHALL
#   dejar TODOS los conteos de victorias intactos (Requirements 12.4, 12.5, 12.6).
#
# Estrategia de mock: se usa moto (mock_aws) para levantar una tabla DynamoDB en
# memoria sin infraestructura real. El modulo registrar_resultado.app crea su
# recurso boto3 al importarse (antes de que el mock este activo), por eso cada
# prueba recrea un recurso DynamoDB DENTRO del contexto mockeado y parchea
# app._dynamo con el, de modo que GetItem/UpdateItem operen sobre la tabla mock.

import os
import json

import boto3
from hypothesis import given, settings, strategies as st
from hypothesis.database import InMemoryExampleDatabase
from moto import mock_aws

import registrar_resultado.app as app

# Minimo de iteraciones por propiedad exigido por el disenio (>= 100).
MAX_EXAMPLES = 100

# Base de ejemplos en memoria: evita escrituras a disco en la carpeta
# sincronizada por OneDrive (.hypothesis/examples), que ralentizan la corrida.
_DB = InMemoryExampleDatabase()

# Nombre de la tabla usado por el mock; coincide con la variable de entorno que
# la Lambda lee en runtime (TABLE_NAME).
_TABLA = "CloudbornLegendsTable"

# Region arbitraria requerida por moto/boto3 para crear el recurso.
_REGION = "us-east-1"


# --- Generadores inteligentes de campeones ----------------------------------
#
# Lo unico que importa para estas propiedades es el id (PK) y el conteo de
# victorias de cada campeon, asi que se generan ids visibles cortos y enteros no
# negativos (el conteo real nunca es negativo). Se mantiene un alfabeto acotado
# para que la generacion y el shrinking sean rapidos.

_ID_ALFABETO = "abcdefghijklmnopqrstuvwxyz0123456789"
_id_campeon = st.text(alphabet=_ID_ALFABETO, min_size=1, max_size=12)

# Conteo inicial de victorias: no negativo. ADD victorias :1 funciona incluso si
# el atributo no existe, pero aqui siempre se siembra para comprobar el delta.
_victorias = st.integers(min_value=0, max_value=1000)


@st.composite
def _conjunto_de_campeones(draw, min_size=2, max_size=8):
    """Conjunto de campeones con ids UNICOS y victorias iniciales arbitrarias.

    Devuelve una lista de dicts {"id", "victorias"} con al menos `min_size`
    campeones distintos, para poder elegir dos participantes y verificar que los
    demas campeones no cambian.
    """
    ids = draw(
        st.lists(_id_campeon, min_size=min_size, max_size=max_size, unique=True)
    )
    return [{"id": i, "victorias": draw(_victorias)} for i in ids]


def _crear_tabla_y_poblar(campeones):
    """Crea la tabla mock, inserta los campeones y parchea app._dynamo.

    Cada campeon se almacena con PK = "CAMPEON#<id>" y su atributo victorias,
    replicando el modelo de datos real. Debe invocarse dentro de un contexto
    mock_aws() activo. Devuelve la tabla mock para poder releer los conteos.
    """
    os.environ["TABLE_NAME"] = _TABLA

    dynamo = boto3.resource("dynamodb", region_name=_REGION)
    dynamo.create_table(
        TableName=_TABLA,
        KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": "PK", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )
    tabla = dynamo.Table(_TABLA)
    with tabla.batch_writer() as lote:
        for campeon in campeones:
            lote.put_item(
                Item={
                    "PK": f"CAMPEON#{campeon['id']}",
                    "id": campeon["id"],
                    "nombre": f"Campeon {campeon['id']}",
                    "victorias": campeon["victorias"],
                }
            )

    # La Lambda crea su recurso al importarse (fuera del mock); se sustituye por
    # el recurso mock para que GetItem/UpdateItem operen sobre la tabla en memoria.
    app._dynamo = dynamo
    return tabla


def _leer_victorias(tabla, campeones):
    """Lee el conteo de victorias actual de cada campeon desde la tabla mock.

    Devuelve un dict {id: victorias(int)} con el estado observable tras la
    invocacion del handler, para comparar contra el estado previo.
    """
    conteos = {}
    for campeon in campeones:
        item = tabla.get_item(Key={"PK": f"CAMPEON#{campeon['id']}"}).get("Item", {})
        conteos[campeon["id"]] = int(item.get("victorias", 0))
    return conteos


def _invocar(cuerpo):
    """Invoca el handler con el cuerpo dado serializado como body JSON."""
    return app.lambda_handler({"body": json.dumps(cuerpo)}, None)


# --- Property 16: aislamiento del incremento de victorias -------------------


@settings(max_examples=MAX_EXAMPLES, database=_DB, deadline=None)
@given(
    campeones=_conjunto_de_campeones(),
    datos=st.data(),
)
def test_ganador_incrementa_solo_al_ganador_en_uno(campeones, datos):
    """Tras un registro valido 'ganador', solo el ganador sube en 1 y el resto
    queda intacto (Property 16; Requirements 9.2, 9.5, 9.6, 12.2)."""
    # Elegir dos participantes distintos y, entre ellos, el ganador.
    indices = datos.draw(
        st.lists(
            st.integers(min_value=0, max_value=len(campeones) - 1),
            min_size=2,
            max_size=2,
            unique=True,
        )
    )
    a = campeones[indices[0]]["id"]
    b = campeones[indices[1]]["id"]
    id_ganador = datos.draw(st.sampled_from([a, b]))

    with mock_aws():
        tabla = _crear_tabla_y_poblar(campeones)
        antes = _leer_victorias(tabla, campeones)

        resultado = _invocar(
            {"campeonA": a, "campeonB": b, "resultado": "ganador", "idGanador": id_ganador}
        )

        despues = _leer_victorias(tabla, campeones)

    # El registro valido responde HTTP 200 { "ok": true }.
    assert resultado["statusCode"] == 200
    assert json.loads(resultado["body"]) == {"ok": True}

    # El ganador incrementa su conteo en EXACTAMENTE 1.
    assert despues[id_ganador] == antes[id_ganador] + 1, (
        f"El ganador {id_ganador} debio subir de {antes[id_ganador]} a "
        f"{antes[id_ganador] + 1}, pero quedo en {despues[id_ganador]}."
    )

    # Cualquier OTRO campeon (incluido el participante no ganador) no cambia.
    for campeon in campeones:
        cid = campeon["id"]
        if cid == id_ganador:
            continue
        assert despues[cid] == antes[cid], (
            f"El campeon {cid} no debio cambiar ({antes[cid]}) pero quedo en "
            f"{despues[cid]} tras una victoria de {id_ganador}."
        )


# --- Property 17: el empate no modifica ningun conteo -----------------------


@settings(max_examples=MAX_EXAMPLES, database=_DB, deadline=None)
@given(
    campeones=_conjunto_de_campeones(),
    datos=st.data(),
)
def test_empate_no_modifica_ningun_conteo(campeones, datos):
    """Un registro valido 'empate' no altera el conteo de victorias de ningun
    campeon (Property 17; Requirements 9.4, 12.3)."""
    indices = datos.draw(
        st.lists(
            st.integers(min_value=0, max_value=len(campeones) - 1),
            min_size=2,
            max_size=2,
            unique=True,
        )
    )
    a = campeones[indices[0]]["id"]
    b = campeones[indices[1]]["id"]

    with mock_aws():
        tabla = _crear_tabla_y_poblar(campeones)
        antes = _leer_victorias(tabla, campeones)

        resultado = _invocar({"campeonA": a, "campeonB": b, "resultado": "empate"})

        despues = _leer_victorias(tabla, campeones)

    # El empate responde HTTP 200 { "ok": true }.
    assert resultado["statusCode"] == 200
    assert json.loads(resultado["body"]) == {"ok": True}

    # NINGUN conteo cambia tras un empate.
    assert despues == antes, (
        "El empate no debio modificar ningun conteo de victorias, "
        f"pero cambio de {antes} a {despues}."
    )


# --- Property 19: solicitudes HTTP 400 no tienen efectos colaterales --------
#
# Se genera, para cada corrida, una solicitud invalida de una de las familias
# que el handler debe rechazar con HTTP 400. En todos los casos los conteos de
# victorias deben quedar EXACTAMENTE igual que antes de la llamada.


@st.composite
def _solicitud_invalida(draw, campeones):
    """Genera una solicitud que el handler debe rechazar con HTTP 400.

    Cubre las familias de error documentadas en registrar_resultado.app:
      - falta campeonA, campeonB o resultado;
      - resultado 'ganador' con idGanador vacio/ausente;
      - resultado 'ganador' con idGanador que no es participante;
      - resultado 'ganador' con idGanador que no existe en DynamoDB;
      - valor de 'resultado' no reconocido.
    Usa ids existentes como participantes para aislar la causa del rechazo.
    """
    ids_existentes = [c["id"] for c in campeones]
    a = draw(st.sampled_from(ids_existentes))
    b = draw(st.sampled_from(ids_existentes))

    # Un id que seguro NO existe en la tabla (ningun id sembrado empieza con '#').
    id_inexistente = "#inexistente"

    familia = draw(
        st.sampled_from(
            [
                "falta_campeonA",
                "falta_campeonB",
                "falta_resultado",
                "ganador_sin_idGanador",
                "ganador_idGanador_vacio",
                "ganador_no_participante",
                "ganador_inexistente",
                "resultado_invalido",
            ]
        )
    )

    if familia == "falta_campeonA":
        return {"campeonB": b, "resultado": "empate"}
    if familia == "falta_campeonB":
        return {"campeonA": a, "resultado": "empate"}
    if familia == "falta_resultado":
        return {"campeonA": a, "campeonB": b}
    if familia == "ganador_sin_idGanador":
        return {"campeonA": a, "campeonB": b, "resultado": "ganador"}
    if familia == "ganador_idGanador_vacio":
        return {"campeonA": a, "campeonB": b, "resultado": "ganador", "idGanador": ""}
    if familia == "ganador_no_participante":
        # idGanador valido pero que no es ninguno de los dos participantes.
        otros = [i for i in ids_existentes if i not in (a, b)]
        extra = draw(st.sampled_from(otros)) if otros else id_inexistente
        return {"campeonA": a, "campeonB": b, "resultado": "ganador", "idGanador": extra}
    if familia == "ganador_inexistente":
        # idGanador es uno de los participantes declarados, pero ni A ni B existen
        # en la tabla: participantes totalmente inexistentes para forzar el 400
        # por "el campeon ganador no existe".
        return {
            "campeonA": id_inexistente,
            "campeonB": id_inexistente,
            "resultado": "ganador",
            "idGanador": id_inexistente,
        }
    # resultado_invalido
    valor = draw(
        st.text(min_size=1, max_size=10).filter(
            lambda s: s not in ("ganador", "empate")
        )
    )
    return {"campeonA": a, "campeonB": b, "resultado": valor}


@settings(max_examples=MAX_EXAMPLES, database=_DB, deadline=None)
@given(
    campeones=_conjunto_de_campeones(),
    datos=st.data(),
)
def test_solicitud_invalida_rechazada_sin_efectos(campeones, datos):
    """Toda solicitud que produce HTTP 400 deja los conteos de victorias
    intactos (Property 19; Requirements 12.4, 12.5, 12.6)."""
    with mock_aws():
        tabla = _crear_tabla_y_poblar(campeones)
        antes = _leer_victorias(tabla, campeones)

        cuerpo = datos.draw(_solicitud_invalida(campeones))
        resultado = _invocar(cuerpo)

        despues = _leer_victorias(tabla, campeones)

    # La solicitud invalida se rechaza con HTTP 400 y un mensaje de error.
    assert resultado["statusCode"] == 400, (
        f"La solicitud {cuerpo} debio rechazarse con 400, pero devolvio "
        f"{resultado['statusCode']}."
    )
    cuerpo_resp = json.loads(resultado["body"])
    assert "error" in cuerpo_resp
    assert isinstance(cuerpo_resp["error"], str) and cuerpo_resp["error"].strip() != ""

    # Sin efectos colaterales: ningun conteo de victorias cambio.
    assert despues == antes, (
        f"La solicitud invalida {cuerpo} no debio modificar los conteos, "
        f"pero cambiaron de {antes} a {despues}."
    )
