# backend/shared/test_rotacion.py
import pytest
from botocore.exceptions import ClientError

from shared.reintentos import ForjadorOcupadoError
from shared.rotacion import MODELOS_IMAGEN, cuerpo_peticion, invocar_con_rotacion
from shared.arenas import llave_arena, tema_desde_llave, slug_tema


def _throttle():
    return ClientError({"Error": {"Code": "ThrottlingException"}}, "InvokeModel")


class Reloj:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t

    def dormir(self, s):
        self.t += s


def test_pasa_al_siguiente_modelo_sin_esperar():
    reloj, usados = Reloj(), []

    def f(m):
        usados.append(m)
        if len(usados) < 3:
            raise _throttle()
        return "ok"

    assert invocar_con_rotacion(f, dormir=reloj.dormir, reloj=reloj) == "ok"
    assert usados == list(MODELOS_IMAGEN)
    assert reloj.t == 0


def test_repite_ronda_tras_5s_y_respeta_24s():
    reloj, llamadas = Reloj(), []

    def f(m):
        llamadas.append(m)
        raise _throttle()

    with pytest.raises(ForjadorOcupadoError):
        invocar_con_rotacion(f, dormir=reloj.dormir, reloj=reloj)
    assert reloj.t <= 24
    assert len(llamadas) % 3 == 0 and len(llamadas) >= 6


def test_otros_errores_se_propagan():
    e = ClientError({"Error": {"Code": "ValidationException"}}, "InvokeModel")

    def f(m):
        raise e

    with pytest.raises(ClientError):
        invocar_con_rotacion(f, dormir=lambda s: None)


def test_mode_solo_en_sd3():
    assert cuerpo_peticion(MODELOS_IMAGEN[0], "p", "n")["mode"] == "text-to-image"
    for m in MODELOS_IMAGEN[1:]:
        c = cuerpo_peticion(m, "p", "n")
        assert "mode" not in c
        assert c["aspect_ratio"] == "1:1" and c["output_format"] == "jpeg"


def test_llave_arena_y_tema():
    u = "123e4567-e89b-12d3-a456-426614174000"
    llave = llave_arena("volcán con ríos de lava", u)
    assert llave == f"generados/arenas/volcan-con-rios-de-lava-{u}.jpg"
    assert tema_desde_llave(llave) == "volcán con ríos de lava"
    assert tema_desde_llave(f"generados/arenas/{u}.jpg") == ""
    assert slug_tema("Bosque Encantado") == "bosque-encantado"