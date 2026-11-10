# backend/shared/test_reparar_habilidades_property.py
# Habilidades fuera del catalogo: se eliminan y se completan, no se rechaza.

from hypothesis import given, settings, strategies as st

from shared.validar_campeon import (
    validar_y_ajustar,
    CATALOGO_HABILIDADES,
    HABILIDADES_MIN,
    HABILIDADES_MAX,
)


def _campeon(habilidades, vida=1000, dano=90, armadura=25):
    return {
        "nombre": "Ignis el Forjador",
        "estadisticas": {"vida": vida, "dano": dano, "velocidad": 300, "armadura": armadura},
        "habilidades": habilidades,
        "colorPrincipal": "#C0392B",
        "colorSecundario": "#F1C40F",
    }


@settings(max_examples=100)
@given(
    invalidas=st.lists(
        st.text(alphabet="abcdefghijklmnop_", min_size=1, max_size=15).filter(
            lambda h: h not in CATALOGO_HABILIDADES
        ),
        max_size=3,
    ),
    validas=st.lists(st.sampled_from(sorted(CATALOGO_HABILIDADES)), max_size=3, unique=True),
    vida=st.integers(800, 1200),
    dano=st.integers(50, 150),
    armadura=st.integers(10, 50),
)
def test_habilidades_fuera_de_catalogo_se_reparan(invalidas, validas, vida, dano, armadura):
    campeon = _campeon(invalidas + validas, vida, dano, armadura)
    resultado = validar_y_ajustar(campeon)
    h = resultado["habilidades"]
    assert HABILIDADES_MIN <= len(h) <= HABILIDADES_MAX
    assert len(set(h)) == len(h)
    assert set(h) <= CATALOGO_HABILIDADES
    # Las validas originales se conservan.
    assert set(validas) <= set(h)


def test_relleno_coherente_con_estadisticas():
    # Mucho dano -> proyectil/embestida
    assert validar_y_ajustar(_campeon(["x", "y"], vida=900, dano=140, armadura=15))["habilidades"] == ["proyectil", "embestida"]
    # Mucha vida/armadura y poco dano -> escudo
    assert validar_y_ajustar(_campeon(["x", "y"], vida=1150, dano=60, armadura=45))["habilidades"][0] == "escudo"
    # Poca vida y poco dano -> curacion
    assert validar_y_ajustar(_campeon(["x", "y"], vida=820, dano=60, armadura=15))["habilidades"][0] == "curacion"
