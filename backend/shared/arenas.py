# backend/shared/arenas.py
# Temas de arena y nombres de archivo en S3: generados/arenas/<tema>-<uuid>.jpg

import re
import unicodedata

PREFIJO_ARENAS = "generados/arenas/"

TEMAS = [
    "volcán con ríos de lava",
    "bosque encantado",
    "ruinas antiguas de piedra",
    "templo de hielo",
    "desierto con obeliscos",
    "pantano con niebla",
]

# Tema en español -> descripcion en ingles para el prompt del modelo.
TEMAS_EN = {
    "volcán con ríos de lava": "volcano with rivers of lava",
    "bosque encantado": "enchanted forest",
    "ruinas antiguas de piedra": "ancient stone ruins",
    "templo de hielo": "ice temple",
    "desierto con obeliscos": "desert with obelisks",
    "pantano con niebla": "foggy swamp",
}

# Un UUID textual mide 36 caracteres.
_PATRON_UUID = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)


def slug_tema(tema):
    """'volcán con ríos de lava' -> 'volcan-con-rios-de-lava'."""
    sin_acentos = unicodedata.normalize("NFKD", tema)
    sin_acentos = "".join(c for c in sin_acentos if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", sin_acentos.lower()).strip("-")


_TEMA_POR_SLUG = {slug_tema(t): t for t in TEMAS}


def llave_arena(tema, uuid_texto):
    return f"{PREFIJO_ARENAS}{slug_tema(tema)}-{uuid_texto}.jpg"


def tema_desde_llave(llave):
    """Recupera el tema (en español) desde la llave S3; '' si no se reconoce."""
    nombre = llave.rsplit("/", 1)[-1]
    if nombre.lower().endswith(".jpg"):
        nombre = nombre[:-4]
    coincidencia = _PATRON_UUID.search(nombre)
    if not coincidencia:
        return ""
    slug = nombre[: coincidencia.start()].rstrip("-")
    return _TEMA_POR_SLUG.get(slug, slug.replace("-", " "))