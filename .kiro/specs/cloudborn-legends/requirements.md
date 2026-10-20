# Requirements Document

## Introduction

Cloudborn Legends es un juego web serverless en AWS donde un jugador describe un campeón en texto y la IA lo genera como un objeto JSON con estadísticas, habilidades y colores. Dos campeones se enfrentan en una arena vista desde arriba (estilo MOBA) con combate automático en tiempo real: los campeones se mueven y usan habilidades solos según sus estadísticas. Al terminar la batalla, un narrador de IA comenta lo ocurrido y un ranking en vivo de victorias llamado "Salón de las Leyendas" muestra a los mejores.

La arquitectura es 100% serverless: frontend estático en S3 + CloudFront con Phaser 3 (JavaScript), API Gateway REST con Lambdas en Python, Amazon Bedrock para los modelos de IA (invocado solo desde Lambda), DynamoDB para campeones y ranking, e infraestructura definida con AWS SAM. El proyecto está orientado a una demo en vivo y portafolio, por lo que prioriza simplicidad y estabilidad sobre funcionalidad avanzada, manteniendo costos dentro de la capa gratuita de AWS.

## Glossary

- **Cloudborn_Legends**: El juego web serverless completo descrito en este documento.
- **Frontend**: La aplicación web construida con Phaser 3 (JavaScript), servida como contenido estático desde S3 mediante CloudFront.
- **Backend**: El conjunto de APIs y funciones Lambda en AWS que implementan la lógica del juego.
- **API_Gateway**: El servicio AWS API Gateway que expone los endpoints REST del Backend.
- **Lambda**: Las funciones AWS Lambda escritas en Python que contienen la lógica del Backend.
- **Bedrock**: El servicio Amazon Bedrock que provee los modelos de IA para generación de campeones y narración de batallas.
- **DynamoDB**: La base de datos NoSQL Amazon DynamoDB que almacena campeones y el ranking.
- **SAM**: AWS Serverless Application Model, utilizado para definir la infraestructura como código.
- **CloudFront**: La CDN de AWS que distribuye el Frontend.
- **S3**: Amazon Simple Storage Service, donde se almacenan los archivos estáticos del Frontend.
- **Campeón**: Una entidad generada por IA, representada como un objeto JSON con nombre, estadísticas, entre 2 y 3 habilidades del catálogo predefinido y dos colores.
- **Estadísticas**: Los valores numéricos de un Campeón: vida, daño, velocidad y armadura, cada uno dentro de un rango fijo.
- **Habilidad**: Una capacidad del catálogo predefinido: proyectil, escudo, curación, embestida o área_de_daño.
- **Arena**: El campo de combate visto desde arriba en estilo MOBA donde dos Campeones se enfrentan.
- **Combate**: La secuencia automática en tiempo real donde dos Campeones se mueven y usan habilidades según sus Estadísticas.
- **Narrador**: El componente que genera comentarios sobre la batalla usando Bedrock una vez finalizada.
- **Salón_de_las_Leyendas**: El ranking en vivo de victorias que muestra a los Campeones ordenados por número de victorias.

## Requirements

### Requirement 1: Interfaz responsiva del juego

**User Story:** Como jugador, quiero acceder al juego desde mi celular o desde una pantalla grande, para poder jugar en cualquier dispositivo.

#### Acceptance Criteria

1. THE Frontend SHALL renderizar el juego con Phaser 3 en JavaScript, de modo que el lienzo del juego sea visible con dimensiones mayores a 0px y contenga elementos de juego con los que el jugador pueda interactuar.
2. WHEN el Frontend se carga en una pantalla con ancho menor a 768px, THE Frontend SHALL adaptar el diseño y los controles a formato móvil, mostrando controles táctiles con área de interacción mínima de 44x44 píxeles y disponiendo los elementos de la interfaz en una sola columna.
3. WHEN el Frontend se carga en una pantalla con ancho mayor o igual a 768px, THE Frontend SHALL mostrar el diseño en formato de pantalla grande, disponiendo los elementos de la interfaz en múltiples columnas y mostrando controles para cursor y teclado.
4. WHEN el juego se carga en el Frontend, THE Frontend SHALL mostrar el texto "Invoca tu leyenda" como invitación para que el jugador describa su Campeón, de forma visible y completa sin recortes.
5. WHEN el ancho de la pantalla cambia de un rango a otro (de menor a 768px o viceversa), THE Frontend SHALL re-adaptar el diseño y los controles al formato correspondiente al nuevo ancho sin requerir recarga de la página.
6. FOR ALL los anchos de pantalla entre 320px y 1920px, THE Frontend SHALL mantener todos los elementos de la interfaz dentro de los límites visibles de la pantalla, sin generar scroll horizontal.
7. FOR ALL los anchos de pantalla entre 320px y 1920px, THE Frontend SHALL mantener todos los elementos interactivos completamente visibles dentro del área de la pantalla, sin recortes ni superposiciones entre elementos.

### Requirement 2: Invocación de campeón por texto

**User Story:** Como jugador, quiero describir un campeón en texto y verlo generarse, para sentir que mi leyenda nace en la nube.

#### Acceptance Criteria

1. THE Frontend SHALL mostrar un campo de texto de máximo 500 caracteres donde el jugador describe su Campeón.
2. WHEN el jugador envía una descripción de Campeón no vacía, THE Frontend SHALL mostrar el texto "Tu leyenda está naciendo en la nube..." y mantenerlo visible mientras se genera el Campeón, hasta que la generación termine con éxito o falle.
3. WHEN la generación del Campeón termina con éxito, THE Frontend SHALL mostrar el Campeón generado con su nombre, Estadísticas, Habilidades y colores.
4. IF la generación del Campeón falla, THEN THE Frontend SHALL mostrar un mensaje de error en español indicando que la generación falló, conservar la descripción ingresada por el jugador y permitir un nuevo intento de generación.
5. IF el jugador envía una descripción de Campeón vacía, THEN THE Frontend SHALL mostrar un mensaje de error en español indicando que la descripción es obligatoria, sin iniciar la generación del Campeón.
6. FOR ALL Campeones generados con éxito, el Frontend SHALL mostrar exactamente un nombre, las cuatro Estadísticas, entre 2 y 3 Habilidades del catálogo predefinido y dos colores del Campeón (propiedad invariante de visualización).

### Requirement 3: Generación de campeón por IA

**User Story:** Como jugador, quiero que la IA genere un Campeón a partir de mi descripción de texto, para obtener un personaje único con estadísticas y habilidades.

#### Acceptance Criteria

1. WHEN el jugador envía una descripción de texto de entre 10 y 500 caracteres, THE Lambda SHALL invocar Bedrock para generar un Campeón en formato JSON.
2. IF el jugador envía una descripción de texto con menos de 10 caracteres o más de 500 caracteres, THEN THE Lambda SHALL rechazar la solicitud con un mensaje de error indicando que la descripción no cumple la longitud permitida, sin invocar Bedrock.
3. THE Campeón generado SHALL incluir un nombre de entre 1 y 30 caracteres, cuatro Estadísticas (vida, daño, velocidad, armadura), entre 2 y 3 Habilidades del catálogo predefinido, y un color principal y un color secundario.
4. THE Lambda SHALL ser el único componente autorizado para invocar Bedrock.
5. THE Estadísticas de un Campeón SHALL estar dentro de los siguientes rangos fijos: vida entre 800 y 1200, daño entre 50 y 150, velocidad entre 200 y 400, armadura entre 10 y 50.
6. THE Lambda SHALL invocar Bedrock con un modelo cuyo costo por token se encuentre en el tercio inferior del catálogo de modelos de Bedrock.
7. IF la invocación a Bedrock falla o no responde dentro de 30 segundos, THEN THE Lambda SHALL devolver al jugador un mensaje de error indicando que la generación del Campeón no pudo completarse, sin generar ni almacenar un Campeón parcial.
8. IF la respuesta de Bedrock no cumple con la estructura completa de un Campeón (nombre, cuatro Estadísticas dentro de sus rangos fijos, entre 2 y 3 Habilidades del catálogo predefinido, y colores principal y secundario), THEN THE Lambda SHALL devolver al jugador un mensaje de error indicando que la generación no pudo completarse, sin exponer datos incompletos al jugador.

#### Propiedades PBT

1. **Invariante de rangos de Estadísticas:** Para todo Campeón generado, vida ∈ [800, 1200], daño ∈ [50, 150], velocidad ∈ [200, 400], armadura ∈ [10, 50].
2. **Invariante de Habilidades:** Para todo Campeón generado, el número de Habilidades ∈ {2, 3} y cada Habilidad pertenece al catálogo predefinido.
3. **Invariante de estructura completa:** Para todo Campeón generado, el JSON incluye un nombre de entre 1 y 30 caracteres, las cuatro Estadísticas, entre 2 y 3 Habilidades del catálogo predefinido, y un color principal y un color secundario.

### Requirement 4: Validación y ajuste del campeón JSON

**User Story:** Como desarrollador, quiero que la Lambda valide el JSON del Campeón y ajuste valores fuera de rango, para garantizar que todos los Campeones sean válidos y consistentes.

#### Acceptance Criteria

1. WHEN la Lambda recibe el JSON del Campeón desde Bedrock, THE Lambda SHALL validar que el JSON contiene un nombre de entre 1 y 50 caracteres, las cuatro Estadísticas, entre 2 y 3 Habilidades del catálogo predefinido y los dos colores.
2. IF una Estadística del Campeón está fuera de su rango fijo, THEN THE Lambda SHALL ajustar el valor al límite válido más cercano del rango.
3. IF el JSON del Campeón no tiene la estructura esperada (nombre ausente, vacío o superior a 50 caracteres; número incorrecto de Estadísticas; número incorrecto de Habilidades; número incorrecto de colores; o sintaxis JSON inválida), THEN THE Lambda SHALL retornar un error descriptivo en español que indique qué elemento falló, rechazando el Campeón sin ajustar sus Estadísticas.
4. IF una Habilidad del Campeón no pertenece al catálogo predefinido, THEN THE Lambda SHALL rechazar el Campeón con un error que indique el nombre de la Habilidad no reconocida.
5. WHEN la Lambda valida un Campeón con Estadísticas dentro de rango, THE Lambda SHALL retornar el Campeón sin modificar sus Estadísticas.
6. FOR ALL Campeones válidos, validar el Campeón dos veces SHALL producir valores idénticos en todos los campos (nombre, Estadísticas, Habilidades y colores) que validarlo una vez (propiedad de idempotencia).
7. FOR ALL Campeones válidos, las Estadísticas resultantes de la validación SHALL estar dentro de los rangos fijos (propiedad invariante).
8. FOR ALL Campeones con una Estadística fuera de rango, el valor ajustado por la Lambda SHALL ser el límite del rango más cercano al valor original (propiedad metamórfica de ajuste).
9. FOR ALL Campeones cuyas Estadísticas son ajustadas por la validación, los campos distintos a las Estadísticas (nombre, Habilidades y colores) SHALL permanecer idénticos a los del Campeón original (propiedad invariante de preservación de estructura).

### Requirement 5: Catálogo de habilidades predefinido

**User Story:** Como jugador, quiero que las Habilidades del Campeón provengan de un catálogo fijo, para que el Combate sea predecible y balanceado.

#### Acceptance Criteria

1. THE Backend SHALL mantener un catálogo predefinido e inmutable de cinco Habilidades: proyectil, escudo, curación, embestida y área_de_daño.
2. THE Campeón SHALL tener entre 2 y 3 Habilidades distintas, todas pertenecientes al catálogo predefinido.
3. FOR ALL Campeones, cada Habilidad listada SHALL pertenecer al catálogo predefinido de cinco Habilidades (propiedad invariante).
4. IF se intenta asignar al Campeón una Habilidad que no pertenece al catálogo predefinido, THEN THE Backend SHALL rechazar la asignación con un error y conservar las Habilidades previamente asignadas sin modificación.
5. FOR ALL Campeones, las Habilidades asignadas SHALL ser distintas entre sí, sin duplicados (propiedad invariante de no duplicidad).

### Requirement 6: Combate automático en la arena

**User Story:** Como jugador, quiero ver a dos Campeones pelear solos en una Arena vista desde arriba, para disfrutar del Combate sin control manual.

#### Acceptance Criteria

1. WHEN se seleccionan dos Campeones, THE Frontend SHALL iniciar un Combate automático en una Arena vista desde arriba en estilo MOBA.
2. WHILE el Combate está activo, THE Frontend SHALL mover cada Campeón automáticamente según sus Estadísticas.
3. WHILE el Combate está activo, THE Frontend SHALL ejecutar las Habilidades de cada Campeón automáticamente según sus Estadísticas.
4. WHILE el Combate está activo, THE Frontend SHALL mostrar la vida de cada Campeón actualizada al menos cada 1 segundo.
5. THE Combate SHALL involucrar exactamente dos Campeones.
6. WHEN la vida de un Campeón llega a cero, THE Combate SHALL terminar.
7. FOR ALL Combates, la vida de cada Campeón SHALL permanecer mayor o igual a cero y menor o igual a su vida máxima durante toda la batalla (propiedad invariante).

### Requirement 7: Resolución de la batalla

**User Story:** Como jugador, quiero que la batalla termine con un ganador claro, para poder registrarlo en el Salón_de_las_Leyendas.

#### Acceptance Criteria

1. WHEN la vida de un Campeón llega a cero y la vida del otro Campeón es mayor que cero, THE Combate SHALL terminar y declarar al Campeón con vida mayor que cero como ganador.
2. WHEN la vida de un Campeón llega a cero y la vida del otro Campeón también es cero, THE Combate SHALL declarar empate.
3. THE Combate SHALL terminar únicamente cuando al menos un Campeón tenga vida cero.
4. FOR ALL Combates, la vida de cada Campeón SHALL permanecer mayor o igual a cero durante toda la batalla (propiedad invariante).
5. FOR ALL Combates, THE Combate SHALL producir exactamente un resultado: un ganador único o un empate, nunca ambos ni ninguno (propiedad invariante de resultado único).

### Requirement 8: Narrador de IA de la batalla

**User Story:** Como jugador, quiero que el Narrador comente la batalla al terminar, para hacer la experiencia más inmersiva y entretenida.

#### Acceptance Criteria

1. WHEN el Combate termina, THE Backend SHALL invocar Bedrock con los eventos registrados, los Campeones participantes y el resultado del Combate para generar un comentario narrativo de la batalla, con un tiempo máximo de respuesta de 30 segundos.
2. THE Narrador SHALL producir un texto en español de entre 100 y 500 caracteres que incluya el resultado de la batalla y al menos un evento registrado de la misma.
3. THE Backend SHALL usar Bedrock como única fuente para la narración.
4. IF Bedrock falla o no responde dentro de 30 segundos, THEN THE Backend SHALL proporcionar una narración de respaldo en español que indique el resultado de la batalla.

#### Propiedades PBT

1. **Invariante de idioma:** Para toda narración generada, el texto SHALL estar en español.
2. **Invariante de longitud:** Para toda narración generada, el texto SHALL tener entre 100 y 500 caracteres.
3. **Invariante de contenido mínimo:** Para toda narración generada, el texto SHALL incluir el resultado de la batalla y al menos un evento registrado.
4. **Invariante de resiliencia:** Para toda falla de Bedrock, el Backend SHALL proporcionar una narración de respaldo en español con el resultado de la batalla.
5. **Invariante de plazo de respuesta:** Para toda narración, el Backend SHALL entregar el comentario dentro de 30 segundos desde la finalización del Combate.

### Requirement 9: Salón de las Leyendas (ranking en vivo)

**User Story:** Como jugador, quiero ver un ranking de victorias en vivo, para competir y comparar mi Campeón con los demás.

#### Acceptance Criteria

1. THE Salón_de_las_Leyendas SHALL mostrar los Campeones ordenados por número de victorias en orden descendente y, a igualdad de victorias, ordenados alfabéticamente por nombre del Campeón en orden ascendente.
2. WHEN se registra un nuevo resultado de batalla con un ganador, THE Salón_de_las_Leyendas SHALL incrementar en exactamente 1 el conteo de victorias del Campeón ganador.
3. FOR ALL pares de Campeones en el ranking, el Campeón con más victorias SHALL aparecer antes en la lista, y a igualdad de victorias el de nombre alfabéticamente menor SHALL aparecer antes (propiedad invariante de orden).
4. IF la batalla terminó en empate, THEN THE Lambda SHALL dejar el conteo de victorias del Salón_de_las_Leyendas sin cambios.
5. WHEN se registra un resultado de batalla cuyo Campeón ganador no figura aún en el ranking, THE Salón_de_las_Leyendas SHALL añadir al Campeón ganador con un conteo de victorias igual a 1.
6. FOR ALL Campeón C del ranking distinto del Campeón ganador de una batalla registrada, el conteo de victorias de C SHALL permanecer sin cambios tras registrar el resultado (propiedad invariante de aislamiento de actualizaciones).
7. FOR ALL consultas al ranking, la suma de los conteos de victorias de todos los Campeones SHALL ser igual al número de resultados de batalla registrados con un ganador declarado (propiedad invariante de conservación del total).

### Requirement 10: Endpoint de API para crear campeón

**User Story:** Como sistema, quiero un endpoint que reciba la descripción de texto y devuelva el Campeón generado, para conectar el Frontend con la IA.

#### Acceptance Criteria

1. THE API_Gateway SHALL exponer un endpoint REST para crear un Campeón a partir de una descripción de texto de entre 1 y 2000 caracteres.
2. WHEN el endpoint recibe una descripción de texto de entre 1 y 2000 caracteres que no esté compuesta únicamente por espacios en blanco, THE Lambda SHALL generar el Campeón vía Bedrock, validar que el Campeón cumple con los campos obligatorios del modelo de Campeón, y devolverlo como JSON.
3. IF la descripción de texto está vacía o compuesta únicamente por espacios en blanco, THEN THE Lambda SHALL retornar un error con código HTTP 400 y un mensaje en español indicando que la descripción es obligatoria.
4. WHEN la generación y validación del Campeón son exitosas, THE endpoint SHALL devolver el Campeón generado como JSON con código HTTP 200.
5. IF la descripción de texto supera los 2000 caracteres, THEN THE Lambda SHALL retornar un error con código HTTP 400 y un mensaje en español indicando que la descripción excede la longitud máxima permitida.
6. IF la generación del Campeón vía Bedrock falla o no se completa dentro de los 30 segundos, THEN THE Lambda SHALL retornar un error indicando que la generación no pudo completarse y conservar el estado previo sin crear un Campeón parcial.
7. IF el Campeón generado no cumple con los campos obligatorios del modelo de Campeón, THEN THE Lambda SHALL retornar un error indicando que el Campeón generado no es válido y no devolverlo al Frontend.

#### Propiedades PBT

1. **Completitud:** Para toda descripción de texto válida (entre 1 y 2000 caracteres y no compuesta únicamente por espacios en blanco), el endpoint devuelve un Campeón que cumple con los campos obligatorios del modelo de Campeón.
2. **No falsos positivos:** Para toda descripción de texto vacía o compuesta únicamente por espacios en blanco, el endpoint retorna un error con código HTTP 400.
3. **Validación del límite superior:** Para toda descripción de texto que supere los 2000 caracteres, el endpoint retorna un error con código HTTP 400.
4. **No emisión de Campeones inválidos:** El endpoint nunca devuelve un Campeón que no haya superado la validación de campos obligatorios del modelo de Campeón.

### Requirement 11: Endpoint de API para listar campeones

**User Story:** Como jugador, quiero ver los Campeones disponibles, para elegir oponentes para el Combate.

#### Acceptance Criteria

1. THE API_Gateway SHALL exponer un endpoint REST para listar los Campeones almacenados en DynamoDB.
2. WHEN el endpoint es invocado, THE Lambda SHALL retornar todos los Campeones almacenados en DynamoDB como un arreglo JSON.
3. IF existen Campeones almacenados en DynamoDB, THEN THE endpoint SHALL devolver código HTTP 200 con un arreglo JSON que contiene los Campeones.
4. IF no existen Campeones almacenados en DynamoDB, THEN THE endpoint SHALL devolver código HTTP 200 con un arreglo JSON vacío.
5. IF DynamoDB no responde dentro de 5 segundos, THEN THE Lambda SHALL devolver código HTTP 500 con un mensaje que indique que el servicio no está disponible.

#### Propiedades PBT

1. **Completitud:** Para cualquier invocación del endpoint, el conjunto de Campeones del arreglo JSON retornado es exactamente igual al conjunto de Campeones almacenados en DynamoDB (ni más ni menos).
2. **Unicidad:** Cada Campeón almacenado en DynamoDB aparece exactamente una vez en el arreglo JSON retornado (sin duplicados).
3. **Validez estructural:** La respuesta del endpoint siempre es un arreglo JSON válido, incluso cuando no existen Campeones almacenados.

### Requirement 12: Endpoint de API para registrar resultado de batalla

**User Story:** Como sistema, quiero un endpoint que registre el resultado de una batalla, para mantener el Salón_de_las_Leyendas actualizado.

#### Acceptance Criteria

1. THE API_Gateway SHALL exponer un endpoint REST para registrar el resultado de una batalla, el cual debe incluir los identificadores de los dos Campeones participantes y el resultado del combate, indicando un ganador o un empate.
2. WHEN el endpoint recibe un resultado que indica un ganador, THE Lambda SHALL incrementar en 1 el conteo de victorias del Campeón ganador en DynamoDB.
3. WHEN el endpoint recibe un resultado que indica empate, THE Lambda SHALL dejar los conteos de victorias de todos los Campeones participantes sin cambios.
4. IF el resultado no contiene un identificador de Campeón ganador o el identificador está vacío, THEN THE Lambda SHALL retornar un error con código HTTP 400 indicando que el identificador del ganador es inválido, sin modificar los conteos de victorias.
5. IF el identificador del Campeón ganador no corresponde a un Campeón existente en DynamoDB, THEN THE Lambda SHALL retornar un error con código HTTP 400 indicando que el Campeón no existe, sin modificar los conteos de victorias.
6. IF el resultado no incluye los identificadores de ambos Campeones participantes o el indicador de resultado del combate, THEN THE Lambda SHALL retornar un error con código HTTP 400 indicando que el resultado de la batalla está incompleto, sin modificar los conteos de victorias.

#### Propiedades PBT

1. **Conservación de conteos:** Para toda batalla registrada con un ganador, exactamente un Campeón incrementa su conteo de victorias en 1 y los demás no cambian. Para toda batalla registrada con empate, ningún conteo cambia.
2. **Monotonía no decreciente:** El registro de cualquier resultado de batalla nunca decrementa el conteo de victorias de ningún Campeón.
3. **Integridad ante error:** Cualquier intento de registro que resulte en un error HTTP 400 deja todos los conteos de victorias en su estado anterior al intento.

### Requirement 13: Endpoint de API para obtener ranking

**User Story:** Como jugador, quiero consultar el ranking actualizado, para ver el Salón_de_las_Leyendas.

#### Acceptance Criteria

1. THE API_Gateway SHALL exponer un endpoint REST para obtener el ranking desde DynamoDB.
2. WHEN el endpoint es invocado, THE Lambda SHALL retornar el ranking con un máximo de 100 Campeones, ordenados por victorias en orden descendente y, en caso de empate en victorias, por nombre del Campeón en orden ascendente.
3. WHEN el endpoint es invocado, THE endpoint SHALL devolver código HTTP 200 con el ranking ordenado.
4. WHEN el endpoint es invocado y no existen Campeones en DynamoDB, THE endpoint SHALL devolver código HTTP 200 con un ranking vacío.
5. IF DynamoDB no está disponible, THEN THE endpoint SHALL devolver una respuesta de error indicando que el ranking no está disponible.

#### Propiedades PBT

1. **Orden descendente por victorias:** Para cualquier par de entradas consecutivas en el ranking, las victorias de la entrada en posición i son mayores o iguales que las de la entrada en posición i+1.
2. **Desempate determinista por nombre:** Para cualquier par de entradas consecutivas con el mismo número de victorias, el nombre de la entrada en posición i es menor o igual (orden alfabético ascendente) que el de la entrada en posición i+1.
3. **Cota de tamaño:** El número de entradas del ranking es menor o igual a 100.
4. **Ausencia de duplicados:** Ningún Campeón aparece más de una vez en el ranking.

### Requirement 14: Endpoint de API para narrar batalla

**User Story:** Como sistema, quiero un endpoint que genere la narración de una batalla, para mostrar el comentario del Narrador en el Frontend.

#### Acceptance Criteria

1. THE API_Gateway SHALL exponer un endpoint REST para narrar una batalla.
2. WHEN el endpoint recibe los datos de una batalla finalizada que incluye el resultado del Combate y los Campeones participantes, THE Lambda SHALL invocar Bedrock y retornar un comentario narrativo no vacío en español de máximo 500 caracteres con código HTTP 200.
3. IF la generación de la narración falla, THEN THE Lambda SHALL retornar un error con código HTTP 500 y un mensaje en español.
4. IF el endpoint recibe datos de batalla vacíos o que no contienen el resultado del Combate, THEN THE Lambda SHALL retornar un error con código HTTP 400 y un mensaje en español.
5. FOR ALL narraciones exitosas, el comentario narrativo retornado SHALL ser un texto no vacío en español de máximo 500 caracteres (propiedad invariante).

### Requirement 15: Arquitectura serverless

**User Story:** Como desarrollador, quiero una arquitectura 100% serverless, para minimizar mantenimiento y costos operativos.

#### Acceptance Criteria

1. THE Frontend SHALL ser contenido estático servido desde S3 y distribuido mediante CloudFront.
2. THE Backend SHALL usar API_Gateway, Lambda en Python, Bedrock y DynamoDB.
3. THE infraestructura SHALL estar definida con SAM.
4. THE DynamoDB SHALL almacenar los Campeones y el ranking del Salón_de_las_Leyendas.
5. FOR ALL los recursos de cómputo de la infraestructura, cada recurso SHALL ser una función Lambda, sin instancias de servidor que requieran gestión por parte del operador (propiedad invariante).
6. FOR ALL los datos persistentes (Campeones y ranking), THE DynamoDB SHALL ser el único almacén, sin bases de datos que requieran gestión de instancias o capacidad por parte del operador (propiedad invariante).

### Requirement 16: Costos mínimos en capa gratuita

**User Story:** Como desarrollador, quiero mantener los costos dentro de la capa gratuita de AWS, para que el proyecto sea sostenible como demo de portafolio.

#### Acceptance Criteria

1. WHERE un servicio de la arquitectura ofrezca una capa gratuita, THE arquitectura SHALL usar dicho servicio dentro de los límites de la capa gratuita publicados por AWS, medidos en una ventana mensual.
2. WHEN se genera un Campeón o se narra una batalla, THE Lambda SHALL invocar Bedrock únicamente para esas dos operaciones, con el fin de reducir costos de inferencia.
3. THE DynamoDB SHALL usar capacidad bajo demanda o provisionada dentro de los límites de la capa gratuita publicados por AWS, medidos en una ventana mensual.
4. IF se intenta invocar Bedrock para una operación distinta a la generación de campeones o la narración de batallas, THEN THE Lambda SHALL rechazar la invocación.

#### Propiedades PBT

1. **Invariante de cobertura de capa gratuita:** Para todo servicio de la arquitectura que ofrezca capa gratuita, el uso mensual SHALL mantenerse dentro de los límites publicados por AWS.
2. **Invariante de invocación restringida de Bedrock:** Para toda invocación de Bedrock, la operación SHALL ser generación de campeón o narración de batalla.
3. **Invariante de capacidad de DynamoDB:** Para toda configuración de DynamoDB, la capacidad SHALL ser bajo demanda o provisionada dentro de la capa gratuita.

### Requirement 17: Simplicidad y estabilidad para demo

**User Story:** Como desarrollador, quiero que el proyecto sea simple y estable, para presentar una demo en vivo sin fallos.

#### Acceptance Criteria

1. THE Cloudborn_Legends SHALL iniciar la demostración completa mediante un único comando, sin requerir pasos de configuración manual ni activación de funcionalidades avanzadas opcionales.
2. THE código del proyecto SHALL incluir al menos un comentario descriptivo en español en cada función, para facilitar el mantenimiento por un desarrollador principiante en JavaScript.
3. WHEN se ejecuta la demostración completa de principio a fin, THE Cloudborn_Legends SHALL completarla sin errores de ejecución ni excepciones no controladas.
4. IF ocurre un error durante la demostración, THEN THE Cloudborn_Legends SHALL mostrar una indicación del error sin cerrar la aplicación ni perder el estado de la sesión.

### Requirement 18: Accesibilidad móvil

**User Story:** Como jugador móvil, quiero controles y textos legibles en mi teléfono, para jugar cómodamente.

#### Acceptance Criteria

1. WHEN el juego se muestra en un dispositivo con ancho de pantalla entre 375px y 768px, THE Frontend SHALL mostrar todos los textos de la interfaz de juego con tamaño mínimo de 16px.
2. WHEN el juego se muestra en un dispositivo con ancho de pantalla entre 375px y 768px, THE Frontend SHALL renderizar controles táctiles con área mínima de 44x44px y separación mínima de 8px entre controles adyacentes.
3. WHILE la pantalla tiene al menos 375px de ancho, THE Frontend SHALL mantener todos los elementos de la interfaz visibles sin requerir scroll horizontal.

### Requirement 19: Rendimiento de generación de campeón

**User Story:** Como jugador, quiero que la generación de mi Campeón sea suficientemente rápida, para no esperar demasiado durante la demo en vivo.

#### Acceptance Criteria

1. WHEN el jugador envía una descripción de texto de entre 1 y 500 caracteres, THE Backend SHALL devolver un Campeón que cumpla las reglas de validación de Campeón del sistema dentro de 15 segundos medidos desde la recepción de la solicitud hasta la entrega de la respuesta.
2. WHEN el jugador solicita la narración de una batalla entre exactamente 2 Campeones, THE Backend SHALL devolver un comentario narrativo de entre 100 y 2000 caracteres dentro de 15 segundos medidos desde la recepción de la solicitud hasta la entrega de la respuesta.
3. IF la generación del Campeón o la narración de batalla no se completa dentro de 15 segundos, THEN THE Backend SHALL devolver una respuesta de error indicando que se ha excedido el tiempo límite.
4. IF el Campeón generado no cumple las reglas de validación de Campeón del sistema, THEN THE Backend SHALL descartar el Campeón no válido y devolver una respuesta de error indicando que no se pudo generar un Campeón válido.

#### Propiedades PBT

1. **Invariante de rendimiento (generación):** Para toda descripción de texto de entre 1 y 500 caracteres, el tiempo entre la recepción de la solicitud y la entrega del Campeón válido es menor o igual a 15 segundos.
2. **Invariante de rendimiento (narración):** Para toda solicitud de narración de batalla entre 2 Campeones, el comentario narrativo devuelto tiene entre 100 y 2000 caracteres y se entrega en 15 segundos o menos.
3. **Invariante de error por timeout:** Para toda solicitud cuyo procesamiento exceda 15 segundos, el sistema devuelve una respuesta de error en lugar de quedar en espera indefinida.
4. **Invariante de validación:** Para todo Campeón que no cumpla las reglas de validación del sistema, el sistema devuelve una respuesta de error en lugar del Campeón no válido.
