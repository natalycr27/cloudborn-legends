# backend/shared/validar_campeon.py
# Validacion y ajuste del JSON del campeon generado por Bedrock (Requirement 4).
#
# Responsabilidad de esta tarea (2.2): a partir del diccionario ya parseado de
# un campeon, comprobar que la estructura es valida (nombre, cuatro estadisticas,
# entre 2 y 3 habilidades distintas del catalogo, y los dos colores) y ajustar
# (clamp) cada estadistica al limite mas cercano de su rango fijo.
#
# Contrato con crear_campeon/app.py (tareas 2.1 y 2.3):
#   - Entrada: campeon_dict, el JSON del campeon ya deserializado a dict.
#   - Exito: devuelve el mismo campeon_dict con las estadisticas ajustadas.
#   - Error: lanza CampeonInvalidoError con un mensaje en español que nombra el
#     elemento que fallo. El handler captura esa excepcion y responde HTTP 500
#     con el mensaje, sin exponer ni almacenar un campeon parcial (Req 3.8/10.7).

# Nombre del campo -> (limite inferior, limite superior) de cada estadistica.
# Rangos fijos definidos en el diseño (Requirements 3.5, 4.2).
RANGOS_ESTADISTICAS = {
    "vida": (800, 1200),
    "dano": (50, 150),
    "velocidad": (200, 400),
    "armadura": (10, 50),
}

# Catalogo predefinido e inmutable de habilidades (Requirement 5.1).
# Se usa un frozenset para la pertenencia y una tupla para conservar el orden
# del catalogo si se necesitara mostrarlo en un mensaje de error.
CATALOGO_HABILIDADES = frozenset(
    {"proyectil", "escudo", "curacion", "embestida", "area_de_dano"}
)

# Limites de estructura del campeon.
NOMBRE_MAX = 30
HABILIDADES_MIN = 2
HABILIDADES_MAX = 3


class CampeonInvalidoError(ValueError):
    """Error de validacion de un campeon con un mensaje descriptivo en español.

    Se lanza cuando la estructura del campeon no cumple el modelo esperado; el
    mensaje indica que elemento concreto fallo para facilitar la depuracion y la
    respuesta HTTP 500 del handler (Requirements 4.3, 4.4, 3.8).
    """


def _clamp(valor, minimo, maximo):
    """Ajusta 'valor' al limite mas cercano del rango [minimo, maximo].

    Si el valor ya esta dentro del rango se devuelve sin cambios; si esta por
    debajo del minimo devuelve el minimo y si supera el maximo devuelve el
    maximo (propiedad metamorfica de ajuste, Requirement 4.8).
    """
    if valor < minimo:
        return minimo
    if valor > maximo:
        return maximo
    return valor


def _validar_nombre(campeon_dict):
    """Valida que 'nombre' exista, sea texto y tenga entre 1 y 30 caracteres."""
    nombre = campeon_dict.get("nombre")
    if not isinstance(nombre, str) or nombre == "":
        raise CampeonInvalidoError(
            "El campeón no tiene un nombre válido: el nombre es obligatorio."
        )
    if len(nombre) > NOMBRE_MAX:
        raise CampeonInvalidoError(
            f"El nombre del campeón supera los {NOMBRE_MAX} caracteres permitidos."
        )


def _validar_y_ajustar_estadisticas(campeon_dict):
    """Valida la presencia de las cuatro estadisticas y aplica clamp a cada una.

    Comprueba que 'estadisticas' sea un diccionario con exactamente las cuatro
    claves esperadas y valores numericos; luego ajusta cada valor al rango fijo
    correspondiente (Requirements 4.1, 4.2, 4.5). Modifica el dict en el sitio.
    """
    estadisticas = campeon_dict.get("estadisticas")
    if not isinstance(estadisticas, dict):
        raise CampeonInvalidoError(
            "El campeón no tiene el bloque de estadísticas con la estructura esperada."
        )

    # El numero de estadisticas debe ser exactamente cuatro, ni mas ni menos.
    claves_esperadas = set(RANGOS_ESTADISTICAS)
    if set(estadisticas) != claves_esperadas:
        raise CampeonInvalidoError(
            "Las estadísticas del campeón deben ser exactamente: "
            "vida, dano, velocidad, armadura."
        )

    for clave, (minimo, maximo) in RANGOS_ESTADISTICAS.items():
        valor = estadisticas[clave]
        # Se rechazan no-numericos y booleanos (bool es subclase de int en Python).
        if isinstance(valor, bool) or not isinstance(valor, (int, float)):
            raise CampeonInvalidoError(
                f"La estadística '{clave}' del campeón debe ser un número."
            )
        estadisticas[clave] = _clamp(valor, minimo, maximo)


def _validar_habilidades(campeon_dict):
    """Valida que 'habilidades' tenga 2-3 entradas distintas del catalogo.

    Rechaza un numero incorrecto de habilidades, los duplicados (Requirement 5.5)
    y cualquier habilidad fuera del catalogo nombrandola en el error (Req 4.4).
    """
    habilidades = campeon_dict.get("habilidades")
    if not isinstance(habilidades, list):
        raise CampeonInvalidoError(
            "El campeón no tiene una lista de habilidades válida."
        )

    if not (HABILIDADES_MIN <= len(habilidades) <= HABILIDADES_MAX):
        raise CampeonInvalidoError(
            f"El campeón debe tener entre {HABILIDADES_MIN} y {HABILIDADES_MAX} "
            "habilidades."
        )

    # Las habilidades deben ser distintas entre si, sin duplicados (Req 5.5).
    if len(set(habilidades)) != len(habilidades):
        raise CampeonInvalidoError(
            "El campeón tiene habilidades duplicadas; deben ser todas distintas."
        )

    # Cada habilidad debe pertenecer al catalogo predefinido; se nombra la que falle.
    for habilidad in habilidades:
        if habilidad not in CATALOGO_HABILIDADES:
            raise CampeonInvalidoError(
                f"La habilidad '{habilidad}' no pertenece al catálogo predefinido."
            )


def _validar_colores(campeon_dict):
    """Valida la presencia de colorPrincipal y colorSecundario como texto."""
    for campo in ("colorPrincipal", "colorSecundario"):
        valor = campeon_dict.get(campo)
        if not isinstance(valor, str) or valor == "":
            raise CampeonInvalidoError(
                f"El campeón no tiene un '{campo}' válido."
            )


def validar_y_ajustar(campeon_dict):
    """Valida la estructura del campeon y ajusta sus estadisticas al rango fijo.

    Verifica nombre (1-30 caracteres), las cuatro estadisticas, entre 2 y 3
    habilidades distintas del catalogo y los dos colores; aplica clamp a cada
    estadistica al limite mas cercano de su rango. Devuelve el mismo campeon_dict
    con las estadisticas ajustadas y el resto de campos intactos, o lanza
    CampeonInvalidoError (en español) indicando que elemento fallo.
    """
    # La raiz debe ser un diccionario; cualquier otra cosa es estructura invalida.
    if not isinstance(campeon_dict, dict):
        raise CampeonInvalidoError(
            "El campeón generado no tiene una estructura JSON válida."
        )

    _validar_nombre(campeon_dict)
    _validar_y_ajustar_estadisticas(campeon_dict)
    _validar_habilidades(campeon_dict)
    _validar_colores(campeon_dict)

    return campeon_dict
