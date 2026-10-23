# backend/conftest.py
# Configuracion compartida de pytest para el backend.
#
# Las Lambdas se empaquetan con CodeUri: backend/ y handlers del tipo
# crear_campeon.app.lambda_handler, por lo que los imports (p. ej.
# `from shared.respuesta import respuesta`) se resuelven desde la carpeta
# backend/. Aqui aniadimos backend/ a sys.path para que pytest pueda importar
# los modulos de las Lambdas y el paquete shared tal como lo hace SAM en runtime.

import os
import sys

_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)
