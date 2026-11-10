# backend/shared/test_reintentos.py
import pytest
from botocore.exceptions import ClientError

from shared.reintentos import con_reintentos_throttling, ForjadorOcupadoError


def _throttle():
    return ClientError({"Error": {"Code": "ThrottlingException", "Message": "x"}}, "InvokeModel")


class Reloj:
    def __init__(self):
        self.t = 0.0
    def __call__(self):
        return self.t
    def dormir(self, s):
        self.t += s


def test_reintenta_con_espera_creciente_y_tiene_exito():
    reloj, intentos = Reloj(), []
    esperas = []
    def f():
        intentos.append(1)
        if len(intentos) < 3:
            raise _throttle()
        return "ok"
    def dormir(s):
        esperas.append(s); reloj.dormir(s)
    assert con_reintentos_throttling(f, dormir=dormir, reloj=reloj) == "ok"
    assert esperas == [3, 6]


def test_respeta_limite_de_25_segundos():
    reloj, esperas = Reloj(), []
    def dormir(s):
        esperas.append(s); reloj.dormir(s)
    with pytest.raises(ForjadorOcupadoError):
        con_reintentos_throttling(lambda: (_ for _ in ()).throw(_throttle()), dormir=dormir, reloj=reloj)
    assert esperas == [3, 6, 12]
    assert reloj.t <= 25


def test_no_espera_si_excede_el_limite():
    reloj, esperas = Reloj(), []
    reloj.t = 23
    with pytest.raises(ForjadorOcupadoError):
        con_reintentos_throttling(lambda: (_ for _ in ()).throw(_throttle()), inicio=0, dormir=esperas.append, reloj=reloj)
    assert esperas == []


def test_otros_errores_no_se_reintentan():
    e = ClientError({"Error": {"Code": "ValidationException"}}, "InvokeModel")
    with pytest.raises(ClientError):
        con_reintentos_throttling(lambda: (_ for _ in ()).throw(e), dormir=lambda s: None)

