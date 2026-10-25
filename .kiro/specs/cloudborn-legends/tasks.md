# Implementation Plan: Cloudborn Legends

## Overview

Implementación incremental del juego web serverless Cloudborn Legends. Las tareas avanzan desde la infraestructura base (SAM/IaC) → backend (Lambdas Python) → frontend (Phaser 3 + combat.js) → pruebas → despliegue. Cada tarea construye sobre las anteriores y termina con código integrado, sin bloques huérfanos.

## Tasks

- [x] 1. Estructura del proyecto e infraestructura SAM base
  - [x] 1.1 Crear la estructura de carpetas del proyecto
    - Crear `backend/crear_campeon/`, `backend/listar_campeones/`, `backend/registrar_resultado/`, `backend/obtener_ranking/`, `backend/narrar_batalla/`, `backend/shared/`
    - Crear `frontend/src/`, `frontend/scenes/`, `frontend/assets/`
    - Crear `.gitignore` con entradas para `__pycache__`, `*.pyc`, `.aws-sam/`, `node_modules/`, `frontend/config.js`
    - _Requisitos: 15.1, 15.2, 15.3_

  - [x] 1.2 Crear `template.yaml` con recursos SAM completos
    - Configurar `CodeUri: backend/` en el bloque `Globals` o en cada función Lambda del `template.yaml` para que la carpeta `backend/shared/` se incluya automáticamente en todos los paquetes
    - Configurar el `Handler` de cada Lambda con la ruta completa desde `backend/`: `crear_campeon.app.lambda_handler`, `listar_campeones.app.lambda_handler`, `registrar_resultado.app.lambda_handler`, `obtener_ranking.app.lambda_handler`, `narrar_batalla.app.lambda_handler`
    - Crear archivos `__init__.py` vacíos en cada carpeta de Lambda y en `backend/shared/` para que Python trate cada carpeta como un paquete y permita la importación de `shared.respuesta`
    - Definir el parámetro `BedrockModelId` con valor por defecto `amazon.nova-micro-v1:0`
    - Definir `CloudbornLegendsTable` (DynamoDB, `BillingMode: PAY_PER_REQUEST`, PK tipo String)
    - Definir `ApiGateway` (`AWS::Serverless::Api`) con CORS y throttling (`ThrottlingRateLimit: 5`, `ThrottlingBurstLimit: 10`)
    - Declarar las 5 funciones Lambda (`CrearCampeonFunction`, `ListarCampeonesFunction`, `RegistrarResultadoFunction`, `ObtenerRankingFunction`, `NarrarBatallaFunction`) con runtime `python3.12`, arquitectura `arm64` y variables de entorno `BEDROCK_MODEL_ID`, `TABLE_NAME`, `ALLOWED_ORIGIN`
    - Asignar timeouts: 15 s a `CrearCampeonFunction` y `NarrarBatallaFunction`; 10 s al resto
    - Definir roles IAM mínimos: `CrearCampeonRole` (DynamoDB `PutItem` + `bedrock:InvokeModel`), `ListarCampeonesRole` (`Scan`), `RegistrarResultadoRole` (`GetItem` + `UpdateItem`), `ObtenerRankingRole` (`Scan`), `NarrarBatallaRole` (`bedrock:InvokeModel`)
    - Definir `FrontendBucket` (S3 privado), `CloudFrontOriginAccessControl` y `CloudFrontDistribution`
    - Exportar outputs `ApiUrl` y `CloudFrontUrl`
    - _Requisitos: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 16.4_

  - [x] 1.3 Crear `backend/shared/respuesta.py`
    - Implementar `respuesta(status, cuerpo, event=None)` que construye respuestas HTTP con headers CORS siempre presentes, incluyendo en respuestas de error
    - Comparar el header `Origin` de la petición (extraído de `event["headers"]`) contra la lista de orígenes permitidos (`ALLOWED_ORIGIN` de la variable de entorno, `http://localhost`, `http://localhost:5500`, `http://127.0.0.1:5500`); devolver ese origen en `Access-Control-Allow-Origin` si está en la lista, o el origen de CloudFront como fallback
    - Nunca poner varios orígenes en un solo header: un único valor en `Access-Control-Allow-Origin` por respuesta
    - _Requisitos: 15.2, 17.3_

  - [x] 1.4 Configurar los entornos de prueba JavaScript y Python
    - Crear `frontend/package.json` con dependencias de desarrollo: `vitest`, `fast-check`
    - Crear `backend/requirements-dev.txt` con `pytest`, `hypothesis`, `boto3`, `moto` (para mockear DynamoDB)
    - Crear `frontend/vitest.config.js` con configuración de entorno Node.js para importar `combat.js` sin Phaser
    - _Requisitos: 17.3_

- [ ] 2. Lambda `crear_campeon` — generación y validación de campeón
  - [x] 2.1 Implementar la validación de descripción y la lógica de invocación a Bedrock
    - En `backend/crear_campeon/app.py`, implementar el handler que recibe el body JSON con el campo `descripcion`
    - Aplicar `strip()` y validar longitud entre 10 y 500 caracteres; devolver HTTP 400 con mensaje en español si falla, sin invocar Bedrock
    - Crear el cliente `boto3` de Bedrock Runtime con `botocore.config.Config(read_timeout=12, connect_timeout=3, retries={"max_attempts": 1})`
    - Construir el system prompt y el user message según el diseño; llamar a `bedrock.converse(...)` con `maxTokens=800` y `temperature=0.7`
    - _Requisitos: 3.1, 3.2, 3.4, 3.6, 3.7, 10.1, 10.3, 10.5, 19.1_

  - [x] 2.2 Implementar la función de validación y ajuste del campeón JSON
    - En `backend/shared/validar_campeon.py`, implementar `validar_y_ajustar(campeon_dict)` que:
      - Valida presencia de nombre (1-30 chars), cuatro estadísticas, 2-3 habilidades del catálogo, colorPrincipal y colorSecundario
      - Aplica `clamp` a cada estadística al límite más cercano del rango fijo
      - Rechaza con error descriptivo en español si la estructura es inválida (nombre ausente/vacío/>30 chars, número incorrecto de habilidades/estadísticas/colores, JSON inválido)
      - Rechaza con error que nombra la habilidad si alguna no pertenece al catálogo predefinido
    - _Requisitos: 3.3, 3.5, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.4_

  - [ ] 2.3 Completar el handler: guardar en DynamoDB y devolver el campeón
    - Parsear la respuesta de Bedrock como JSON y llamar a `validar_y_ajustar`
    - Generar un UUID con `uuid.uuid4()`, asignar `victorias = 0` y `createdAt` en formato ISO 8601
    - Crear el cliente `boto3` de DynamoDB con `botocore.config.Config(read_timeout=5, connect_timeout=3)`; ejecutar `PutItem` con `PK = "CAMPEON#<uuid>"`
    - Devolver HTTP 200 con el campeón completo usando `respuesta()`; devolver HTTP 500 ante fallo de Bedrock o JSON inválido sin almacenar nada parcial
    - _Requisitos: 3.7, 3.8, 10.2, 10.4, 10.6, 10.7, 19.1_

  - [x] 2.4 Escribir pruebas de propiedad para la validación de descripción (Property 1)
    - **Propiedad 1: Validación de descripción rechaza entradas inválidas sin invocar Bedrock**
    - **Valida: Requisitos 3.2, 2.5, 10.3, 10.5**
    - Usar pytest + Hypothesis; mockear Bedrock; generar descripciones de longitud < 10, > 500 y solo espacios en blanco
    - Verificar HTTP 400 con mensaje en español y que Bedrock no fue invocado

  - [x] 2.5 Escribir pruebas de propiedad para la invariante de estructura del campeón (Property 2)
    - **Propiedad 2: Invariante de estructura del campeón**
    - **Valida: Requisitos 3.3, 5.2, 5.3, 2.6**
    - Generar inputs de `validar_y_ajustar` con nombres, estadísticas, habilidades y colores arbitrarios válidos
    - Verificar que el resultado contiene exactamente nombre, cuatro estadísticas, 2-3 habilidades del catálogo y dos colores

  - [x] 2.6 Escribir pruebas de propiedad para la invariante de rangos de estadísticas (Property 3)
    - **Propiedad 3: Invariante de rangos de estadísticas**
    - **Valida: Requisitos 3.5, 4.7**
    - Generar campeones con estadísticas en cualquier rango; verificar que el resultado siempre tiene vida ∈ [800,1200], daño ∈ [50,150], velocidad ∈ [200,400], armadura ∈ [10,50]

  - [x] 2.7 Escribir pruebas de propiedad para el ajuste al límite más cercano (Property 4)
    - **Propiedad 4: Ajuste de estadísticas al límite más cercano**
    - **Valida: Requisitos 4.2, 4.8, 4.5**
    - Generar campeones con estadísticas fuera de rango; verificar que el valor ajustado es el límite más cercano al valor original
    - Generar campeones con estadísticas dentro de rango; verificar que no se modifican

  - [x] 2.8 Escribir pruebas de propiedad para idempotencia y preservación de estructura (Properties 5, 6)
    - **Propiedad 5: Idempotencia de la validación**
    - **Propiedad 6: El ajuste preserva los campos no-estadísticas**
    - **Valida: Requisitos 4.6, 4.9**
    - Validar campeones válidos dos veces y comparar todos los campos; verificar que nombre, habilidades y colores no cambian en campeones con estadísticas ajustadas

  - [-] 2.9 Escribir pruebas de propiedad para no-duplicidad de habilidades y rechazo de inválidos (Properties 7, 8)
    - **Propiedad 7: No duplicidad de habilidades**
    - **Propiedad 8: Rechazo de campeones inválidos o incompletos**
    - **Valida: Requisitos 5.5, 3.8, 4.1, 4.3, 4.4, 5.4, 10.7, 19.4**
    - Generar campeones con habilidades duplicadas o fuera del catálogo; verificar rechazo con error descriptivo y que no se emite ni almacena un campeón inválido

- [x] 3. Punto de control — despliegue del backend base
  - Ejecutar `sam build` para verificar que el template compila sin errores
  - Ejecutar `sam deploy --guided` en la región `us-east-1` (primera vez) o `sam deploy` (despliegues posteriores)
  - Verificar que `ApiUrl` aparece en los outputs de CloudFormation
  - Probar el endpoint con curl: `curl -X POST <ApiUrl>/campeones -H "Content-Type: application/json" -d '{"descripcion":"Un guerrero de fuego con escudo y proyectil"}'` y confirmar que se recibe un campeón JSON válido
  - Consultar al usuario si el despliegue o la prueba con curl falla

- [ ] 4. Lambdas de consulta: `listar_campeones` y `obtener_ranking`
  - [ ] 4.1 Implementar `listar_campeones` (GET /campeones)
    - En `backend/listar_campeones/app.py`, crear cliente DynamoDB con `read_timeout=5, connect_timeout=3`
    - Ejecutar `Scan` sobre la tabla; devolver HTTP 200 con arreglo JSON (vacío si no hay ítems)
    - Si DynamoDB no responde en 5 s, devolver HTTP 500 con mensaje en español usando `respuesta()`
    - _Requisitos: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ] 4.2 Implementar `obtener_ranking` (GET /ranking)
    - En `backend/obtener_ranking/app.py`, crear cliente DynamoDB con `read_timeout=5, connect_timeout=3`
    - Ejecutar `Scan`; ordenar en la Lambda por `victorias` descendente y `nombre` ascendente; devolver máximo 100 entradas con HTTP 200
    - Si DynamoDB no está disponible, devolver error HTTP 500 con mensaje en español usando `respuesta()`
    - _Requisitos: 9.1, 13.1, 13.2, 13.3, 13.4, 13.5_

  - [ ]* 4.3 Escribir pruebas de propiedad para el orden e integridad del ranking (Property 15)
    - **Propiedad 15: Invariante de orden del ranking**
    - **Valida: Requisitos 9.1, 9.3, 13.2**
    - Generar listas arbitrarias de campeones con victorias y nombres aleatorios; mockear DynamoDB; verificar orden desc por victorias, desempate asc por nombre, máximo 100 entradas y sin duplicados

- [ ] 5. Lambdas de escritura: `registrar_resultado` y `narrar_batalla`
  - [ ] 5.1 Implementar `registrar_resultado` (POST /resultados)
    - En `backend/registrar_resultado/app.py`, validar que el body incluya `campeonA`, `campeonB` y `resultado`; devolver HTTP 400 si falta alguno
    - Si `resultado == 'ganador'`, validar que `idGanador` no está vacío, corresponde a uno de los dos participantes y existe en DynamoDB (`GetItem`); devolver HTTP 400 con mensaje en español ante cualquier fallo sin modificar conteos
    - Si todo es válido, ejecutar `UpdateItem` con `ADD victorias :1` sobre el ganador; para empate, no modificar nada
    - Usar `read_timeout=5, connect_timeout=3` en el cliente DynamoDB; usar `respuesta()` para todas las respuestas
    - _Requisitos: 9.2, 9.4, 9.5, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [ ]* 5.2 Escribir pruebas de propiedad para conservación, monotonía e integridad del registro (Properties 16, 17, 19)
    - **Propiedad 16: Aislamiento del incremento de victorias**
    - **Propiedad 17: El empate no modifica los conteos de victorias**
    - **Propiedad 19: Registro de resultado inválido rechazado sin efectos colaterales**
    - **Valida: Requisitos 9.2, 9.4, 9.5, 9.6, 12.2, 12.3, 12.4, 12.5, 12.6**
    - Usar pytest + Hypothesis con DynamoDB mockeado; verificar que solo el ganador incrementa en 1, que el empate no modifica nada, y que los errores HTTP 400 dejan los conteos intactos

  - [ ]* 5.3 Escribir prueba de propiedad para conservación del total de victorias (Property 18)
    - **Propiedad 18: Conservación del total de victorias**
    - **Valida: Requisito 9.7**
    - Simular una secuencia de registros con ganador y empate; verificar que la suma de victorias iguala el número de resultados con ganador declarado

  - [ ] 5.4 Implementar `narrar_batalla` (POST /narraciones)
    - En `backend/narrar_batalla/app.py`, validar que el body contiene el resultado y los datos de la batalla; devolver HTTP 400 con mensaje en español si está vacío o sin resultado
    - Crear cliente Bedrock con `read_timeout=12, connect_timeout=3, retries={"max_attempts": 1}`; construir system prompt y user message según el diseño; invocar `bedrock.converse(...)`
    - Verificar que el texto devuelto tiene entre 100 y 500 caracteres; si Bedrock falla, no responde en 12 s o el texto está fuera de rango, construir narración de respaldo con la plantilla del diseño y devolver HTTP 200 con `usadoRespaldo: true`
    - Usar `respuesta()` para todas las respuestas
    - _Requisitos: 8.1, 8.2, 8.3, 8.4, 14.1, 14.2, 14.3, 14.4, 14.5, 19.2, 19.3_

  - [ ]* 5.5 Escribir pruebas de propiedad para la narración de respaldo (Property 14)
    - **Propiedad 14: Narración de respaldo válida ante falla de Bedrock**
    - **Valida: Requisitos 8.4, 14.3, 14.5, 19.3**
    - Usar Hypothesis; mockear Bedrock para que falle, dé timeout o devuelva texto fuera de rango; verificar HTTP 200, `usadoRespaldo: true`, narración en español de 100-500 caracteres con el resultado de la batalla

  - [ ]* 5.6 Escribir prueba de propiedad para el rechazo de datos de batalla vacíos (Property 20)
    - **Propiedad 20: Datos de batalla vacíos o sin resultado rechazados**
    - **Valida: Requisito 14.4**
    - Generar solicitudes con body vacío o sin campo `resultado`; verificar HTTP 400 con mensaje en español

- [ ] 6. Punto de control — backend completo
  - Verificar que todos los tests pasan con `pytest backend/ -v`. Consultar al usuario si surge alguna duda.

- [ ] 7. Módulo `combat.js` — lógica de combate pura
  - [ ] 7.1 Implementar las funciones base del módulo `combat.js`
    - Crear `frontend/src/combat.js` como módulo ES; implementar `crearCombate(campeonA, campeonB, configArena, semilla)` que inicializa el `EstadoCombate` completo (posiciones, HP, enfriamientos, escudoActivo, rng con semilla, tiempoTranscurrido, duracionMaxima=90, eventos=[])
    - Implementar `moverCampeon(campeon, objetivo, deltaTiempo)` que mueve en dirección normalizada a velocidad `estadisticas.velocidad` px/s y limita a la arena
    - Implementar `calcularDano(atacante, defensor, habilidad)` con la tabla de multiplicadores (proyectil×1.0, embestida×1.5, área×0.8), reducción por armadura y reducción 50% si escudoActivo
    - _Requisitos: 6.1, 6.2, 6.3, 6.5_

  - [ ] 7.2 Implementar `seleccionarHabilidad`, `actualizarTick` y `determinarGanador`
    - Implementar `seleccionarHabilidad(campeon, estado)` con la lógica de prioridad del diseño (curación si HP<50%, escudo si oponente ataca, proyectil/área a distancia, embestida cerca, ataque básico a 60px) y respeto de enfriamientos
    - Implementar `actualizarTick(estado, deltaTiempo)` que avanza movimiento, enfriamientos, selección y ejecución de habilidades, aplica daño, registra eventos y retorna `{ estado, eventos }`; la vida nunca baja de 0 ni sube del máximo
    - Implementar `determinarGanador(estado)` y `determinarGanadorPorVida(estado)` según el diseño
    - _Requisitos: 6.2, 6.3, 6.4, 6.6, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ] 7.3 Implementar `simularCombate` y exportar la interfaz pública del módulo
    - Implementar `simularCombate(campeonA, campeonB, configArena, semilla)` que ejecuta el loop completo con paso fijo de 50 ms hasta que `determinarGanador` no devuelve `'en_curso'` o se alcanza la duración máxima
    - Exportar todas las funciones públicas; verificar que el módulo se puede importar en Node.js sin Phaser ni DOM
    - _Requisitos: 6.5, 6.6, 7.3, 7.5_

  - [ ]* 7.4 Escribir pruebas de propiedad para la vida dentro de límites durante el combate (Property 9)
    - **Propiedad 9: Vida dentro de límites durante todo el combate**
    - **Valida: Requisitos 6.7, 7.4**
    - Usar Vitest + fast-check; generar pares de campeones con estadísticas aleatorias en rango; ejecutar `simularCombate` y verificar que en cada tick la vida de cada campeón permanece ∈ [0, vida_maxima]

  - [ ]* 7.5 Escribir pruebas de propiedad para la terminación del combate (Property 10)
    - **Propiedad 10: El combate termina al llegar a vida cero o a 90 segundos**
    - **Valida: Requisitos 6.6, 7.3**
    - Verificar que `simularCombate` siempre termina y que lo hace en el momento exacto en que HP llega a 0 o al alcanzar los 90 segundos, lo que ocurra primero

  - [ ]* 7.6 Escribir pruebas de propiedad para el resultado único y el determinismo (Properties 11, 12)
    - **Propiedad 11: Resultado único y determinación del ganador**
    - **Propiedad 12: Determinismo del combate con semilla**
    - **Valida: Requisitos 6.5, 7.1, 7.2, 7.5, 7.6, 6.2, 6.3**
    - Verificar que `simularCombate` produce exactamente un resultado (ganador único o empate, nunca ambos ni ninguno); verificar que dos ejecuciones con la misma semilla producen el mismo resultado y la misma secuencia de eventos

  - [ ]* 7.7 Escribir prueba de propiedad para el movimiento proporcional a la velocidad (Property 13)
    - **Propiedad 13: El movimiento es proporcional a la velocidad**
    - **Valida: Requisitos 6.2, 6.3**
    - Generar pares de campeones donde la velocidad de A > velocidad de B; verificar que la distancia recorrida por A en un tick es mayor que la de B bajo las mismas condiciones

- [ ] 8. Frontend — escenas Phaser 3 y UI
  - [ ] 8.1 Crear `frontend/index.html` y configurar Phaser 3
    - Crear `frontend/index.html` con el canvas de Phaser y los elementos HTML del overlay (textarea, botón, contador de caracteres)
    - Crear `frontend/src/main.js` que inicializa Phaser 3 con las 5 escenas registradas (`BootScene`, `InvocacionScene`, `SeleccionScene`, `ArenaScene`, `RankingScene`) y el canvas responsive
    - Leer `window.CONFIG.apiUrl` para las llamadas a la API; usar `http://localhost:3000` como valor por defecto si `window.CONFIG` no existe
    - _Requisitos: 1.1, 1.4, 15.1_

  - [ ] 8.2 Implementar `BootScene` e `InvocacionScene`
    - Crear `frontend/scenes/BootScene.js`: carga inicial de assets y transición a `InvocacionScene`
    - Crear `frontend/scenes/InvocacionScene.js`:
      - Superponer un `<textarea>` HTML (10-500 chars) y un botón HTML sobre el canvas con `position: absolute` y `z-index` superior al canvas
      - Mostrar contador de caracteres en formato "X / 500" actualizado en tiempo real
      - Mostrar el texto "Invoca tu leyenda" de forma visible y completa
      - Validar la descripción en el cliente (vacía, solo espacios, <10 chars) y mostrar error en español sin llamar a la API
      - Mostrar "Tu leyenda está naciendo en la nube..." mientras se genera; mostrar el campeón (nombre, estadísticas, habilidades, colores) al éxito; mostrar error en español conservando la descripción al fallo
      - Llamar a `POST /campeones` y pasar el campeón a `SeleccionScene` al éxito
    - _Requisitos: 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ] 8.3 Implementar `SeleccionScene`
    - Crear `frontend/scenes/SeleccionScene.js` que llama a `GET /campeones`, muestra cada campeón con nombre, estadísticas y colores, y permite al jugador seleccionar dos campeones
    - Al confirmar la selección, pasar los dos campeones a `ArenaScene`
    - _Requisitos: 11.1, 11.2, 11.3, 11.4, 6.1_

  - [ ] 8.4a Implementar el loop de combate, arena, sprites y barras de vida en `ArenaScene`
    - Crear `frontend/scenes/ArenaScene.js` que importa `combat.js` y crea el combate con `crearCombate` usando una semilla aleatoria
    - Implementar el game loop con acumulador de paso fijo (50 ms) en el método `update(time, delta)` de Phaser
    - Renderizar la arena vista desde arriba con sprites de campeones (círculos o sprites simples con los colores del campeón)
    - Mostrar y actualizar las barras de vida de cada campeón al menos cada 1 segundo
    - _Requisitos: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ] 8.4b Implementar los efectos visuales de habilidades en `ArenaScene`
    - Renderizar efectos visuales para cada tipo de habilidad: proyectil (línea o sprite animado), embestida (movimiento rápido), área de daño (círculo expandiéndose), escudo (borde luminoso alrededor del campeón), curación (efecto de recuperación)
    - Usar los eventos del combate devueltos por `actualizarTick` para disparar cada efecto visual en el momento correcto
    - _Requisitos: 6.2, 6.3_

  - [ ] 8.4c Implementar el fin de combate: registro de resultado, narración y navegación en `ArenaScene`
    - Al terminar el combate, llamar a `POST /resultados` con el resultado (ganador o empate) y los ids de los dos campeones
    - Filtrar y priorizar los eventos del combate para seleccionar máximo 15 eventos relevantes (muerte → tiempo_agotado → habilidades especiales → proyectiles → golpes > 80) antes de enviar a la narración
    - Llamar a `POST /narraciones` con los datos de la batalla y los máximo 15 eventos; mostrar la narración devuelta (o la de respaldo si `usadoRespaldo: true`)
    - Navegar a `RankingScene` tras mostrar el resultado y la narración
    - _Requisitos: 7.1, 7.2, 7.3, 8.1, 8.2, 12.1_

  - [ ] 8.5 Implementar `RankingScene` y responsividad global
    - Crear `frontend/scenes/RankingScene.js` que llama a `GET /ranking` y muestra la lista del Salón de las Leyendas ordenada por victorias con texto mínimo de 16 px en móvil
    - Aplicar CSS responsivo: una sola columna y controles táctiles en anchos < 768 px; múltiples columnas en anchos ≥ 768 px; todos los elementos dentro de los límites visibles entre 320 px y 1920 px sin scroll horizontal; re-adaptación sin recarga al cambiar el ancho
    - _Requisitos: 1.2, 1.3, 1.5, 1.6, 1.7, 9.1, 13.1, 13.2, 13.3, 18.1, 18.3_

- [ ] 9. Punto de control — frontend y combate completos
  - Ejecutar `npx vitest --run` para verificar que todos los tests de `combat.js` pasan. Consultar al usuario si surge alguna duda.

- [ ] 10. Infraestructura de pruebas y pruebas unitarias con ejemplos
  - [ ] 10.1 Escribir tests unitarios con ejemplos para el backend (Python)
    - Tests para `listar_campeones`: respuesta vacía cuando no hay campeones en DynamoDB; respuesta HTTP 200 con arreglo cuando existen campeones
    - Tests para `obtener_ranking`: respuesta vacía cuando no hay campeones; orden correcto con empate de victorias
    - Tests para `crear_campeon`: rechazo de descripción límite inferior (9 chars) y aceptación de descripción límite exacto (10 y 500 chars); rechazo de habilidad fuera del catálogo con mensaje que nombra la habilidad
    - _Requisitos: 3.2, 4.4, 9.1, 11.3, 11.4, 13.2_

  - [ ] 10.2 Escribir tests unitarios con ejemplos para el combate (JavaScript/Vitest)
    - Caso concreto: campeón A gana cuando HP de B llega a 0 y HP de A > 0
    - Caso concreto: empate cuando HP de ambos llega a 0 en el mismo tick
    - Caso concreto: ganador por tiempo a los 90 s con porcentajes de vida distintos
    - Caso concreto: empate por tiempo a los 90 s con el mismo porcentaje de vida
    - _Requisitos: 7.1, 7.2, 7.6_

- [ ] 11. Script de despliegue y configuración final
  - [ ] 11.1 Crear el script de despliegue `deploy.ps1` (Windows) y `deploy.sh` (Unix)
    - Ejecutar `sam build` y `sam deploy`
    - Leer el output `ApiUrl` con `aws cloudformation describe-stacks --query Outputs`
    - Generar `frontend/config.js` con el contenido `window.CONFIG = { apiUrl: "<ApiUrl>" };`
    - Subir todos los archivos estáticos del frontend al bucket S3 con `aws s3 sync`
    - Invalidar la caché de CloudFront con `aws cloudfront create-invalidation`
    - _Requisitos: 17.1_

  - [ ]* 11.2 Escribir smoke tests de configuración SAM
    - Verificar que `template.yaml` define los 8 recursos esperados (S3, CloudFront, API Gateway, 5 Lambdas, DynamoDB)
    - Verificar que el modelo de Bedrock proviene del parámetro `BedrockModelId`
    - Verificar que solo `CrearCampeonFunction` y `NarrarBatallaFunction` tienen permiso `bedrock:InvokeModel`
    - Verificar que el script de despliegue existe y es ejecutable
    - _Requisitos: 15.1, 15.2, 15.3, 15.5, 16.4, 3.6, 17.1_

- [ ] 12. Punto de control final — todos los tests pasan
  - Ejecutar `pytest backend/ -v` y `npx vitest --run`. Verificar que todos los tests (propiedades, unitarios y smoke) pasan sin errores. Consultar al usuario si surge alguna duda.

## Notes

- Las tareas marcadas con `*` son opcionales y pueden omitirse para un MVP más rápido
- Cada tarea referencia los requisitos específicos para trazabilidad
- Los puntos de control garantizan validación incremental antes de avanzar a la siguiente capa
- Los tests de propiedades usan `fast-check` (JS) y `Hypothesis` (Python) con mínimo 100 iteraciones
- Los tests de integración con Bedrock y DynamoDB reales no se incluyen en las tareas de código; se ejecutan manualmente antes del despliegue
- El archivo `frontend/config.js` está en `.gitignore` y se genera en cada despliegue

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["2.1", "4.1", "4.2", "5.1", "5.4", "7.1"] },
    { "id": 2, "tasks": ["2.2", "7.2"] },
    { "id": 3, "tasks": ["2.3", "7.3"] },
    { "id": 4, "tasks": ["2.4", "2.5", "2.6", "2.7", "2.8", "2.9", "4.3", "5.2", "5.3", "5.5", "5.6", "7.4", "7.5", "7.6", "7.7"] },
    { "id": 5, "tasks": ["8.1", "10.1"] },
    { "id": 6, "tasks": ["8.2", "8.3", "10.2"] },
    { "id": 7, "tasks": ["8.4a", "8.4b"] },
    { "id": 8, "tasks": ["8.4c"] },
    { "id": 9, "tasks": ["8.5"] },
    { "id": 10, "tasks": ["11.1"] },
    { "id": 11, "tasks": ["11.2"] }
  ]
}
```
