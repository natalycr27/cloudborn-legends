// Modulo de combate puro de Cloudborn Legends (combat.js).
//
// Este modulo contiene la logica de combate automatico SIN ninguna dependencia
// de Phaser ni del DOM. Es un modulo ES de funciones puras (o con estado
// explicito y determinista) que puede importarse y ejecutarse en Node.js para
// pruebas unitarias y de propiedades.
//
// Interfaz publica del modulo:
//   - crearCombate: inicializa el EstadoCombate completo.
//   - moverCampeon: mueve un campeon hacia su objetivo limitando al circulo de combate.
//   (actualizarTick mueve a los campeones por toda la arena con una IA de posicionamiento:
//   kiting a distancia, persecucion/retroceso cuerpo a cuerpo, huida y embestida.)
//   - calcularDano: calcula el dano final segun habilidad, armadura y escudo.
//   - seleccionarHabilidad: decide la habilidad del campeon en cada tick.
//   - actualizarTick: avanza la simulacion un paso fijo y devuelve eventos.
//   - determinarGanador / determinarGanadorPorVida: resuelven el desenlace.
//   - simularCombate: ejecuta el combate completo (usado en pruebas).
//   - crearRng: generador pseudoaleatorio determinista con semilla.
//   - Constantes: ARENA_POR_DEFECTO, DURACION_MAXIMA, CATALOGO_HABILIDADES, PASO_FIJO.
//
// Todas las funciones son puras o con estado explicito y determinista, de modo
// que el modulo puede importarse y ejecutarse en Node.js sin Phaser ni DOM.

// ---------------------------------------------------------------------------
// Constantes de combate
// ---------------------------------------------------------------------------

// Dimensiones por defecto de la arena (vista desde arriba, estilo MOBA).
export const ARENA_POR_DEFECTO = Object.freeze({ ancho: 800, alto: 600 });

// Duracion maxima del combate en segundos (Requisito 7.3).
export const DURACION_MAXIMA = 90;

// Catalogo predefinido de habilidades (inmutable). OJO: la habilidad de area se
// llama "area_de_dano" tal como viene de la API. El nombre "area" NO es una
// habilidad: solo se usa como tipo de evento para el narrador/efectos visuales.
export const CATALOGO_HABILIDADES = Object.freeze([
  'proyectil',
  'escudo',
  'curacion',
  'embestida',
  'area_de_dano',
]);

// Tabla de multiplicadores de dano por habilidad (segun la tabla de balance del
// diseno). Las habilidades que no infligen dano directo (escudo, curacion) no
// aparecen aqui. El ataque basico usa el multiplicador neutro 1.0.
const MULTIPLICADORES_DANO = Object.freeze({
  proyectil: 1.0,
  embestida: 1.5,
  area_de_dano: 0.8,
  ataque_basico: 1.0,
});

// Multiplicador usado cuando la habilidad no esta en la tabla (p. ej. ataque
// basico sin nombre explicito). Se mantiene neutro para no alterar el dano base.
const MULTIPLICADOR_POR_DEFECTO = 1.0;

// Factor global de ajuste de dano. Escala el dano final de cada golpe para
// ajustar el ritmo del combate: con este factor y el movimiento por toda la arena
// (kiting a distancia, retroceso cuerpo a cuerpo) los combates duran, en terminos
// aproximados, entre 15 y 35 segundos (mediana ~18 s). Se aplica como ultimo paso en
// calcularDano, por lo que afecta a todas las habilidades ofensivas por igual.
export const FACTOR_DANO_GLOBAL = 0.5;

// ---------------------------------------------------------------------------
// Generador de numeros aleatorios determinista (RNG con semilla)
// ---------------------------------------------------------------------------

// Mezcla una semilla entera de 32 bits (algoritmo xmur3 simplificado) para
// derivar un estado inicial bien distribuido a partir de cualquier numero.
function mezclarSemilla(semilla) {
  // Normaliza la semilla a un entero de 32 bits sin signo.
  let h = (Math.floor(Math.abs(Number(semilla) || 0)) ^ 0x6d2b79f5) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// Crea un generador pseudoaleatorio determinista (mulberry32) a partir de una
// semilla. Devuelve un objeto con:
//   - siguiente(): numero flotante en [0, 1) (equivalente a Math.random()).
//   - semilla: la semilla original (para trazabilidad / reproduccion).
// Dos generadores creados con la misma semilla producen la misma secuencia,
// lo que hace el combate reproducible (determinismo con semilla).
export function crearRng(semilla) {
  let estado = mezclarSemilla(semilla);
  return {
    semilla,
    siguiente() {
      // mulberry32: PRNG rapido y determinista de 32 bits.
      estado = (estado + 0x6d2b79f5) >>> 0;
      let t = estado;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

// ---------------------------------------------------------------------------
// Utilidades geometricas
// ---------------------------------------------------------------------------

// Normaliza el vector que va de 'origen' a 'destino' (ambos {x, y}) a longitud 1.
// Si ambos puntos coinciden (distancia 0), devuelve el vector nulo para evitar
// divisiones por cero; en ese caso el campeon simplemente no se mueve.
function normalizarDireccion(origen, destino) {
  const dx = destino.x - origen.x;
  const dy = destino.y - origen.y;
  const magnitud = Math.hypot(dx, dy);
  if (magnitud === 0) {
    return { x: 0, y: 0 };
  }
  return { x: dx / magnitud, y: dy / magnitud };
}

// Geometria del area de combate. El combate ocurre dentro de un circulo que
// ocupa casi toda la arena (radio ~280 centrado en el centro de la arena; en
// la arena por defecto de 800x600 el centro es (400, 300)).
export const RADIO_ARENA = 280;

// Distancia minima permitida entre los dos campeones (en pixeles). Nunca se
// encimaran: si un movimiento los acerca mas, se separan.
export const DISTANCIA_MINIMA = 50;

// Calcula el centro y el radio del circulo de combate para una arena dada. El
// radio es RADIO_ARENA, salvo que la arena sea mas chica (se deja un margen).
function geometriaArena(arena) {
  const ancho = arena && typeof arena.ancho === 'number' ? arena.ancho : ARENA_POR_DEFECTO.ancho;
  const alto = arena && typeof arena.alto === 'number' ? arena.alto : ARENA_POR_DEFECTO.alto;
  const radio = Math.max(1, Math.min(RADIO_ARENA, Math.min(ancho, alto) / 2 - 20));
  return { cx: ancho / 2, cy: alto / 2, radio };
}

// Limita una posicion {x, y} al circulo de combate. Si queda fuera, se proyecta
// radialmente sobre el borde: el componente tangencial del paso se conserva, por
// lo que el campeon se desliza a lo largo del borde en lugar de frenarse.
function limitarALaArena(posicion, arena) {
  const { cx, cy, radio } = geometriaArena(arena);
  const dx = posicion.x - cx;
  const dy = posicion.y - cy;
  const distancia = Math.hypot(dx, dy);
  const limite = radio - 1e-9;
  if (distancia <= limite) {
    return { x: posicion.x, y: posicion.y };
  }
  const k = limite / distancia;
  return { x: cx + dx * k, y: cy + dy * k };
}
// ---------------------------------------------------------------------------
// Inicializacion del estado de combate
// ---------------------------------------------------------------------------

// Construye el sub-estado de un campeon dentro del combate a partir de su
// definicion (la que viene de la API). Clona el campeon para no mutar el
// original y le agrega el estado de combate: hp, posicion, enfriamientos,
// escudoActivo y escudoTurnos.
function inicializarCampeon(campeon, posicion, ia) {
  const vidaMaxima = campeon.estadisticas.vida;

  // Enfriamientos por habilidad: cada habilidad del campeon arranca lista para
  // usarse (enfriamiento en 0). Se usa el nombre de la habilidad como clave
  // (incluido "area_de_dano" tal cual viene de la API).
  const enfriamientos = {};
  for (const habilidad of campeon.habilidades) {
    enfriamientos[habilidad] = 0;
  }
  // El ataque basico tambien tiene su propio enfriamiento (cada 1 s segun la
  // tabla de balance). Se registra con una clave reservada que no colisiona con
  // ninguna habilidad del catalogo.
  enfriamientos.ataque_basico = 0;

  return {
    ...campeon,
    vidaMaxima,
    hp: vidaMaxima,
    posicion: { x: posicion.x, y: posicion.y },
    enfriamientos,
    escudoActivo: false,
    escudoTurnos: 0,
    ia, // estado de IA de movimiento (ver crearIA)
    movimiento: { x: 0, y: 0 }, // velocidad real del ultimo tick (px/s)
  };
}

// crearCombate: crea el estado inicial del combate a partir de dos campeones
// validos y la configuracion de la arena. El parametro 'semilla' hace que el
// combate sea determinista y reproducible.
//
// Devuelve el EstadoCombate completo:
//   { campeonA, campeonB, tiempoTranscurrido, duracionMaxima, arena, eventos,
//     resultado, idGanador, rng }
export function crearCombate(campeonA, campeonB, configArena, semilla) {
  // Arena: usa la configuracion recibida o la arena por defecto (800x600). Ademas
  // expone el circulo de combate (centro y radio) para que la escena lo dibuje.
  const arena = {
    ancho: configArena && typeof configArena.ancho === 'number' ? configArena.ancho : ARENA_POR_DEFECTO.ancho,
    alto: configArena && typeof configArena.alto === 'number' ? configArena.alto : ARENA_POR_DEFECTO.alto,
  };
  const geometria = geometriaArena(arena);
  arena.centroX = geometria.cx;
  arena.centroY = geometria.cy;
  arena.radio = geometria.radio;

  // RNG determinista del combate: toda la aleatoriedad (movimiento y dano) sale
  // de aqui, nunca de Math.random().
  const rng = crearRng(semilla);

  // Posiciones iniciales: campeon A a la izquierda y campeon B a la derecha,
  // ambos centrados verticalmente (siempre dentro del circulo de combate).
  const posicionA = limitarALaArena({ x: arena.ancho * 0.25, y: arena.alto / 2 }, arena);
  const posicionB = limitarALaArena({ x: arena.ancho * 0.75, y: arena.alto / 2 }, arena);

  return {
    campeonA: inicializarCampeon(campeonA, posicionA, crearIA(rng)),
    campeonB: inicializarCampeon(campeonB, posicionB, crearIA(rng)),
    tiempoTranscurrido: 0, // segundos transcurridos de combate
    duracionMaxima: DURACION_MAXIMA, // 90 segundos
    arena,
    eventos: [], // eventos registrados para el narrador
    resultado: null, // 'ganador' | 'empate' | null (en curso)
    idGanador: null,
    rng, // generador determinista reproducible con semilla
  };
}
// ---------------------------------------------------------------------------
// Movimiento
// ---------------------------------------------------------------------------

// moverCampeon: mueve un campeon hacia su objetivo en linea recta.
// La estadistica 'velocidad' (rango 200-400) se interpreta como pixeles por
// segundo. El desplazamiento en este tick es velocidad * deltaTiempo en la
// direccion normalizada hacia el objetivo, limitado a los bordes de la arena.
//
// Parametros:
//   - campeon: sub-estado del campeon que se mueve (tiene posicion y estadisticas).
//   - objetivo: sub-estado del oponente (tiene posicion). Es el punto destino.
//   - deltaTiempo: segundos transcurridos en este tick.
//   - arena (opcional): limites de la arena; por defecto 800x600.
//
// Devuelve la nueva posicion {x, y} (no muta el campeon recibido).
export function moverCampeon(campeon, objetivo, deltaTiempo, arena = ARENA_POR_DEFECTO) {
  const direccion = normalizarDireccion(campeon.posicion, objetivo.posicion);
  const distancia = campeon.estadisticas.velocidad * deltaTiempo;
  const nuevaPosicion = {
    x: campeon.posicion.x + direccion.x * distancia,
    y: campeon.posicion.y + direccion.y * distancia,
  };
  return limitarALaArena(nuevaPosicion, arena);
}

// ---------------------------------------------------------------------------
// Calculo de dano
// ---------------------------------------------------------------------------

// Devuelve el multiplicador de dano de una habilidad. Reconoce el nombre
// "area_de_dano" (tal como viene de la API). Para habilidades sin dano directo
// o desconocidas, usa el multiplicador neutro por defecto (1.0).
function multiplicadorPorHabilidad(habilidad) {
  const valor = MULTIPLICADORES_DANO[habilidad];
  return typeof valor === 'number' ? valor : MULTIPLICADOR_POR_DEFECTO;
}

// calcularDano: calcula el dano final que un atacante inflige a un defensor con
// una habilidad dada. Considera:
//   - dano base = atacante.estadisticas.dano
//   - multiplicador por habilidad (proyectil x1.0, embestida x1.5, area_de_dano x0.8)
//   - reduccion del 50% si el defensor tiene el escudo activo
//   - reduccion por armadura: armadura / (armadura + 100)
//
// El resultado nunca es negativo (minimo 0).
export function calcularDano(atacante, defensor, habilidad) {
  const danoBase = atacante.estadisticas.dano;
  const multiplicador = multiplicadorPorHabilidad(habilidad);
  let danoBruto = danoBase * multiplicador;

  // El escudo activo reduce a la mitad el dano recibido.
  if (defensor.escudoActivo) {
    danoBruto *= 0.5;
  }

  // La armadura mitiga el dano con una formula de rendimientos decrecientes.
  const armadura = defensor.estadisticas.armadura;
  const reduccionArmadura = armadura / (armadura + 100);
  // El factor global de dano escala el resultado final para ajustar el ritmo
  // del combate (ver FACTOR_DANO_GLOBAL).
  const danoFinal = danoBruto * (1 - reduccionArmadura) * FACTOR_DANO_GLOBAL;

  return Math.max(0, danoFinal);
}

// ---------------------------------------------------------------------------
// Tabla de rangos, enfriamientos y efectos de habilidades
// ---------------------------------------------------------------------------

// Rango de uso (en pixeles) de cada habilidad y del ataque basico. Un campeon
// solo ejecuta la habilidad cuando la distancia al oponente es <= a su rango.
// El escudo y la curacion no dependen de la distancia (rango Infinity): se usan
// por contexto (vida baja, oponente atacando), no por cercania.
const RANGO_HABILIDAD = Object.freeze({
  ataque_basico: 60,
  proyectil: 300,
  embestida: 150,
  area_de_dano: 120,
  escudo: Infinity,
  curacion: Infinity,
});

// Enfriamiento (en segundos) de cada habilidad tras usarse. Segun la tabla de
// balance del diseno. El ataque basico se puede usar cada 1 s.
const ENFRIAMIENTO_HABILIDAD = Object.freeze({
  ataque_basico: 1,
  proyectil: 3,
  embestida: 6,
  area_de_dano: 7,
  escudo: 10,
  curacion: 12,
});

// Duracion (en segundos) del escudo una vez activado. Mientras este activo, el
// dano recibido se reduce al 50% (ver calcularDano).
const DURACION_ESCUDO = 3;

// Fraccion de la vida maxima que recupera la curacion al usarse (12%).
const FRACCION_CURACION = 0.12;

// Umbral de vida (fraccion de la vida maxima) por debajo del cual el campeon
// prioriza curarse. La curacion solo se selecciona si hp < 50% de la vida max.
const UMBRAL_CURACION = 0.5;

// ---------------------------------------------------------------------------
// Utilidades internas de combate
// ---------------------------------------------------------------------------

// Distancia euclidiana entre dos campeones (usa su posicion {x, y}).
function distanciaEntre(campeonA, campeonB) {
  return Math.hypot(
    campeonB.posicion.x - campeonA.posicion.x,
    campeonB.posicion.y - campeonA.posicion.y,
  );
}

// Indica si una habilidad esta lista para usarse (enfriamiento agotado).
// Tolera errores de punto flotante con un pequeno epsilon.
function habilidadDisponible(campeon, habilidad) {
  const restante = campeon.enfriamientos[habilidad];
  return typeof restante === 'number' && restante <= 1e-9;
}

// Devuelve true si una habilidad inflige dano directo (proyectil, embestida,
// area_de_dano o el ataque basico). El escudo y la curacion no danan.
function esHabilidadOfensiva(habilidad) {
  return (
    habilidad === 'proyectil' ||
    habilidad === 'embestida' ||
    habilidad === 'area_de_dano' ||
    habilidad === 'ataque_basico'
  );
}

// Determina si el oponente esta "atacando" al campeon: se considera que ataca
// cuando esta dentro del rango de su ataque basico (60 px) o tiene alguna
// habilidad ofensiva lista cuyo rango alcanza la distancia actual. Se usa para
// decidir cuando conviene levantar el escudo.
function oponenteAtaca(oponente, distancia) {
  if (distancia <= rangoAtaqueBasico(oponente)) {
    return true;
  }
  const habilidades = Array.isArray(oponente.habilidades) ? oponente.habilidades : [];
  for (const habilidad of habilidades) {
    if (!esHabilidadOfensiva(habilidad)) {
      continue;
    }
    if (habilidadDisponible(oponente, habilidad) && distancia <= RANGO_HABILIDAD[habilidad]) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Seleccion de habilidad
// ---------------------------------------------------------------------------

// seleccionarHabilidad: decide que habilidad usara 'campeon' en este tick segun
// su estado, el del oponente y los enfriamientos. Devuelve el nombre de la
// habilidad ('curacion', 'escudo', 'proyectil', 'embestida', 'area_de_dano' o
// 'ataque_basico') o null si ninguna esta disponible/aplicable en este momento.
//
// Logica de prioridad (segun el diseno):
//   1. Curacion: si la vida esta por debajo del 50% y la curacion esta lista.
//   2. Escudo: si el oponente esta atacando y el escudo esta listo (y no activo).
//   3. Proyectil / area_de_dano: ataque a distancia si el oponente esta a rango.
//   4. Embestida: ataque con bonus cuando el oponente esta relativamente cerca.
//   5. Ataque basico: si el oponente esta a 60 px y el basico esta listo.
//
// Solo devuelve una habilidad que el campeon realmente posee (salvo el ataque
// basico, que es universal) y que respeta su enfriamiento y rango.
export function seleccionarHabilidad(campeon, estado) {
  // Identifica al oponente dentro del estado de combate.
  const oponente = campeon === estado.campeonA ? estado.campeonB : estado.campeonA;
  const distancia = distanciaEntre(campeon, oponente);

  // Conjunto de habilidades que posee este campeon (excluye el ataque basico,
  // que se evalua aparte por ser universal).
  const habilidades = Array.isArray(campeon.habilidades) ? campeon.habilidades : [];
  const tiene = (h) => habilidades.includes(h);

  // 1. Curacion: maxima prioridad si la vida esta baja.
  if (
    tiene('curacion') &&
    habilidadDisponible(campeon, 'curacion') &&
    campeon.hp < campeon.vidaMaxima * UMBRAL_CURACION
  ) {
    return 'curacion';
  }

  // 2. Escudo: si el oponente ataca y aun no hay escudo activo.
  if (
    tiene('escudo') &&
    habilidadDisponible(campeon, 'escudo') &&
    !campeon.escudoActivo &&
    oponenteAtaca(oponente, distancia)
  ) {
    return 'escudo';
  }

  // 3. Ataque a distancia: proyectil (300 px) o area_de_dano (120 px).
  //    Se prioriza el proyectil por tener mayor alcance.
  if (
    tiene('proyectil') &&
    habilidadDisponible(campeon, 'proyectil') &&
    distancia <= RANGO_HABILIDAD.proyectil
  ) {
    return 'proyectil';
  }
  if (
    tiene('area_de_dano') &&
    habilidadDisponible(campeon, 'area_de_dano') &&
    distancia <= RANGO_HABILIDAD.area_de_dano
  ) {
    return 'area_de_dano';
  }

  // 4. Embestida: ataque cuerpo a cuerpo con bonus cuando el oponente esta cerca.
  if (
    tiene('embestida') &&
    habilidadDisponible(campeon, 'embestida') &&
    distancia <= RANGO_HABILIDAD.embestida
  ) {
    return 'embestida';
  }

  // 5. Ataque basico: disponible siempre, pero solo a rango corto (60 px).
  if (habilidadDisponible(campeon, 'ataque_basico') && distancia <= rangoAtaqueBasico(campeon)) {
    return 'ataque_basico';
  }

  // Ninguna habilidad aplicable en este tick (p. ej. el campeon aun se acerca).
  return null;
}

// ---------------------------------------------------------------------------
// Avance de un tick de combate
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Movimiento por la arena (IA de posicionamiento)
// ---------------------------------------------------------------------------
//
// Cada campeon lleva un pequeno estado de IA (campeon.ia) con el sentido en que
// orbita, el tiempo hasta el proximo posible cambio de sentido, el tiempo de
// retroceso tras un golpe cuerpo a cuerpo y la embestida en curso. TODA la
// aleatoriedad sale de estado.rng.siguiente() para mantener el determinismo.

// Banda de distancia que mantienen los campeones a distancia (px).
const DISTANCIA_BANDA_MIN = 200;
const DISTANCIA_BANDA_MAX = 260;
// Banda mas estrecha ("distancia media") cuando aun no tienen habilidades listas.
const DISTANCIA_MEDIA_MIN = 215;
const DISTANCIA_MEDIA_MAX = 245;
// Un campeon de area pura se acerca a esta distancia para lanzar su area (120 px).
const DISTANCIA_LANZAR_AREA = 100;
// Distancia a la que se planta un campeon cuerpo a cuerpo (cabe en el basico, 60 px).
const DISTANCIA_CUERPO_A_CUERPO = 55;
// Distancia a la que retrocede/gira un campeon cuerpo a cuerpo tras golpear.
const DISTANCIA_RETROCESO = 115;
const DISTANCIA_GIRO = 90;
// Duracion del retroceso tras golpear (segundos): entre 0.5 y 1.2 s.
const RETROCESO_MIN = 0.5;
const RETROCESO_MAX = 1.2;
// Cada cuanto (segundos) se evalua cambiar el sentido de la orbita.
const CAMBIO_SENTIDO_MIN = 1.5;
const CAMBIO_SENTIDO_MAX = 4;
// Vida (fraccion) bajo la cual un campeon con curacion huye al borde opuesto.
const UMBRAL_HUIDA = 0.35;
// Segundos tras usar la curacion durante los que sigue alejandose ("mientras se cura").
const VENTANA_CURACION = 4;
// La embestida es un tramo rapido: multiplica la velocidad del campeon.
const FACTOR_VELOCIDAD_EMBESTIDA = 3.5;
// El tramo de la embestida rodea al rival (sin pisarlo) y termina a esta
// distancia, del otro lado del rival.
const DISTANCIA_EMBESTIDA = 72;
// Fraccion del radio a partir de la cual los campeones que orbitan se alejan del borde.
const FRACCION_BORDE_SUAVE = 0.8;

// Alcance del ataque basico: los campeones a distancia disparan su ataque basico
// desde la banda de kiting (no pueden pegar de cerca porque se mantienen lejos);
// los cuerpo a cuerpo lo usan a 60 px.
const RANGO_BASICO_A_DISTANCIA = 280;
function rangoAtaqueBasico(campeon) {
  return esADistancia(campeon) ? RANGO_BASICO_A_DISTANCIA : RANGO_HABILIDAD.ataque_basico;
}

// Crea el estado de IA inicial de un campeon usando el RNG del combate.
function crearIA(rng) {
  const sentido = rng.siguiente() < 0.5 ? 1 : -1;
  const espera = CAMBIO_SENTIDO_MIN + rng.siguiente() * (CAMBIO_SENTIDO_MAX - CAMBIO_SENTIDO_MIN);
  return { sentido, tiempoCambio: espera, retroceso: 0, modoRetroceso: 0, embestida: null };
}

// Copia el estado de IA (incluida la ruta de la embestida) para no mutar la entrada.
function clonarIA(ia) {
  return {
    ...ia,
    embestida: ia.embestida
      ? { puntos: ia.embestida.puntos.map((p) => ({ x: p.x, y: p.y })) }
      : null,
  };
}

// Descuenta el temporizador de cambio de sentido y, al agotarse, decide con el
// RNG si invierte la orbita. Siempre consume dos valores al agotarse para que la
// secuencia del RNG no dependa de la decision.
function avanzarIA(campeon, deltaTiempo, rng) {
  const ia = campeon.ia;
  ia.tiempoCambio -= deltaTiempo;
  if (ia.tiempoCambio <= 0) {
    const tirada = rng.siguiente();
    const espera = CAMBIO_SENTIDO_MIN + rng.siguiente() * (CAMBIO_SENTIDO_MAX - CAMBIO_SENTIDO_MIN);
    if (tirada < 0.5) {
      ia.sentido = -ia.sentido;
    }
    ia.tiempoCambio = espera;
  }
}

// Tras golpear cuerpo a cuerpo, el campeon se aparta un momento (0.5 a 1.2 s) y
// elige con el RNG si retrocede (0) o gira alrededor del rival (1).
function iniciarRetroceso(campeon, rng) {
  campeon.ia.retroceso = RETROCESO_MIN + rng.siguiente() * (RETROCESO_MAX - RETROCESO_MIN);
  campeon.ia.modoRetroceso = rng.siguiente() < 0.5 ? 0 : 1;
}

// Indica si el campeon es "a distancia" (tiene proyectil o area_de_dano).
function esADistancia(campeon) {
  const habilidades = Array.isArray(campeon.habilidades) ? campeon.habilidades : [];
  return habilidades.includes('proyectil') || habilidades.includes('area_de_dano');
}

// Un campeon con curacion y vida baja se aleja del rival mientras se cura: huye
// si la curacion esta lista o si la uso hace pocos segundos.
function debeHuir(campeon) {
  const habilidades = Array.isArray(campeon.habilidades) ? campeon.habilidades : [];
  if (!habilidades.includes('curacion') || campeon.hp >= campeon.vidaMaxima * UMBRAL_HUIDA) {
    return false;
  }
  const enfriamiento = campeon.enfriamientos.curacion;
  return enfriamiento <= 1e-9 || enfriamiento > ENFRIAMIENTO_HABILIDAD.curacion - VENTANA_CURACION;
}

// Normaliza un vector (x, y); devuelve el nulo si su longitud es ~0.
function normalizarVector(x, y) {
  const magnitud = Math.hypot(x, y);
  if (magnitud < 1e-9) {
    return { x: 0, y: 0 };
  }
  return { x: x / magnitud, y: y / magnitud };
}

function acotar(valor, minimo, maximo) {
  return Math.min(maximo, Math.max(minimo, valor));
}

// Mantiene al campeon dentro de una banda [min, max] de distancia al rival:
// se aleja si esta muy cerca, se acerca si esta lejos y orbita si esta dentro.
// u = direccion hacia el rival, t = direccion tangente (sentido de la orbita).
function mantenerDistancia(u, t, distancia, min, max) {
  if (distancia < min) {
    return { dir: normalizarVector(-u.x + t.x * 0.6, -u.y + t.y * 0.6), factor: 1 };
  }
  if (distancia > max) {
    return {
      dir: normalizarVector(u.x + t.x * 0.3, u.y + t.y * 0.3),
      factor: 1,
      tope: distancia - max,
    };
  }
  const radial = acotar((distancia - (min + max) / 2) / ((max - min) / 2), -1, 1) * 0.5;
  return { dir: normalizarVector(t.x + u.x * radial, t.y + u.y * radial), factor: 0.75 };
}

// Mientras orbita, el campeon se aleja suavemente del borde para recorrer toda
// la arena en vez de pegarse a la pared.
function alejarDelBorde(movimiento, posicion, geometria) {
  const dCentro = Math.hypot(posicion.x - geometria.cx, posicion.y - geometria.cy);
  const limite = geometria.radio * FRACCION_BORDE_SUAVE;
  if (dCentro <= limite || dCentro < 1e-9) {
    return movimiento;
  }
  const peso = Math.min(1, (dCentro - limite) / (geometria.radio * (1 - FRACCION_BORDE_SUAVE))) * 1.2;
  const haciaCentro = { x: (geometria.cx - posicion.x) / dCentro, y: (geometria.cy - posicion.y) / dCentro };
  const dir = normalizarVector(
    movimiento.dir.x + haciaCentro.x * peso,
    movimiento.dir.y + haciaCentro.y * peso,
  );
  return { ...movimiento, dir };
}

// Decide hacia donde y a que fraccion de su velocidad se mueve un campeon en
// este tick. Devuelve { dir, factor, tope? } (tope = avance maximo en px).
function decidirMovimiento(campeon, oponente, estado, deltaTiempo) {
  const ia = campeon.ia;
  const geometria = geometriaArena(estado.arena);

  const dx = oponente.posicion.x - campeon.posicion.x;
  const dy = oponente.posicion.y - campeon.posicion.y;
  const distancia = Math.hypot(dx, dy);
  // Direccion hacia el rival (si estan superpuestos, una direccion fija).
  const u = distancia > 1e-9 ? { x: dx / distancia, y: dy / distancia } : { x: 1, y: 0 };
  // Direccion tangente: sentido en que orbita alrededor del rival.
  const t = { x: -u.y * ia.sentido, y: u.x * ia.sentido };

  const enRetroceso = ia.retroceso > 0;
  if (enRetroceso) {
    ia.retroceso = Math.max(0, ia.retroceso - deltaTiempo);
  }

  // 1. Vida baja con curacion: huye hacia el borde opuesto al rival.
  if (debeHuir(campeon)) {
    const ox = geometria.cx - oponente.posicion.x;
    const oy = geometria.cy - oponente.posicion.y;
    const magnitud = Math.hypot(ox, oy);
    const lejos = magnitud < 1e-6
      ? { x: -u.x, y: -u.y }
      : { x: ox / magnitud, y: oy / magnitud };
    const objetivo = {
      x: geometria.cx + lejos.x * geometria.radio * 0.9,
      y: geometria.cy + lejos.y * geometria.radio * 0.9,
    };
    const hacia = Math.hypot(objetivo.x - campeon.posicion.x, objetivo.y - campeon.posicion.y);
    if (hacia > 25) {
      return {
        dir: normalizarVector(objetivo.x - campeon.posicion.x, objetivo.y - campeon.posicion.y),
        factor: 1,
      };
    }
    // Ya esta en el borde opuesto: se mueve de lado para no quedarse quieto.
    return { dir: t, factor: 0.6 };
  }

  // 2. Campeon a distancia (proyectil / area_de_dano).
  if (esADistancia(campeon)) {
    const habilidades = campeon.habilidades;
    const tieneProyectil = habilidades.includes('proyectil');
    // Area pura: se acerca a lanzar el area cuando esta lista y luego se aleja.
    if (!tieneProyectil && habilidadDisponible(campeon, 'area_de_dano')) {
      if (distancia > DISTANCIA_LANZAR_AREA) {
        return {
          dir: normalizarVector(u.x + t.x * 0.25, u.y + t.y * 0.25),
          factor: 1,
          tope: distancia - DISTANCIA_LANZAR_AREA,
        };
      }
      return { dir: t, factor: 0.5 };
    }
    // Con proyectil listo mantiene 200-260 px; sin habilidades listas orbita a
    // distancia media.
    const listo = tieneProyectil && habilidadDisponible(campeon, 'proyectil');
    const mov = listo
      ? mantenerDistancia(u, t, distancia, DISTANCIA_BANDA_MIN, DISTANCIA_BANDA_MAX)
      : mantenerDistancia(u, t, distancia, DISTANCIA_MEDIA_MIN, DISTANCIA_MEDIA_MAX);
    return alejarDelBorde(mov, campeon.posicion, geometria);
  }

  // 3. Cuerpo a cuerpo.
  if (enRetroceso) {
    // Tras golpear: retrocede (0) o gira alrededor del rival (1).
    let mov;
    if (ia.modoRetroceso === 0) {
      mov = distancia < DISTANCIA_RETROCESO
        ? { dir: normalizarVector(-u.x + t.x * 0.35, -u.y + t.y * 0.35), factor: 1 }
        : { dir: t, factor: 0.7 };
    } else {
      const radial = acotar((distancia - DISTANCIA_GIRO) / 40, -1, 1) * 0.8;
      mov = { dir: normalizarVector(t.x + u.x * radial, t.y + u.y * radial), factor: 0.9 };
    }
    return alejarDelBorde(mov, campeon.posicion, geometria);
  }
  if (distancia > DISTANCIA_CUERPO_A_CUERPO) {
    // Persigue al rival con una ligera curva.
    return {
      dir: normalizarVector(u.x + t.x * 0.2, u.y + t.y * 0.2),
      factor: 1,
      tope: distancia - DISTANCIA_CUERPO_A_CUERPO,
    };
  }
  return { dir: t, factor: 0.35 };
}

// Prepara la embestida: una ruta de dos tramos que rodea al rival (sin pisarlo)
// y termina del otro lado de el. Devuelve el punto final de la ruta.
function iniciarEmbestida(atacante, oponente, arena) {
  const ia = atacante.ia;
  const dx = oponente.posicion.x - atacante.posicion.x;
  const dy = oponente.posicion.y - atacante.posicion.y;
  const hacia = normalizarVector(dx, dy);
  const u = hacia.x === 0 && hacia.y === 0 ? { x: 1, y: 0 } : hacia;
  const t = { x: -u.y * ia.sentido, y: u.x * ia.sentido };
  const lateral = limitarALaArena(
    {
      x: oponente.posicion.x + t.x * DISTANCIA_EMBESTIDA,
      y: oponente.posicion.y + t.y * DISTANCIA_EMBESTIDA,
    },
    arena,
  );
  const destino = limitarALaArena(
    {
      x: oponente.posicion.x + u.x * DISTANCIA_EMBESTIDA,
      y: oponente.posicion.y + u.y * DISTANCIA_EMBESTIDA,
    },
    arena,
  );
  ia.embestida = { puntos: [lateral, destino] };
  return destino;
}

// Avanza la embestida en curso a velocidad alta a lo largo de su ruta.
function avanzarEmbestida(campeon, deltaTiempo, arena) {
  const embestida = campeon.ia.embestida;
  let restante = campeon.estadisticas.velocidad * FACTOR_VELOCIDAD_EMBESTIDA * deltaTiempo;
  let { x, y } = campeon.posicion;
  while (restante > 1e-9 && embestida.puntos.length > 0) {
    const punto = embestida.puntos[0];
    const distancia = Math.hypot(punto.x - x, punto.y - y);
    if (distancia <= restante) {
      x = punto.x;
      y = punto.y;
      restante -= distancia;
      embestida.puntos.shift();
    } else {
      x += ((punto.x - x) / distancia) * restante;
      y += ((punto.y - y) / distancia) * restante;
      restante = 0;
    }
  }
  if (embestida.puntos.length === 0) {
    campeon.ia.embestida = null;
  }
  campeon.posicion = limitarALaArena({ x, y }, arena);
}

// Mueve un campeon un tick segun su comportamiento (embestida en curso, huida,
// kiting a distancia o persecucion cuerpo a cuerpo). Muta 'campeon'.
function moverCampeonIA(campeon, oponente, estado, deltaTiempo) {
  if (campeon.ia.embestida) {
    avanzarEmbestida(campeon, deltaTiempo, estado.arena);
    return;
  }
  const mov = decidirMovimiento(campeon, oponente, estado, deltaTiempo);
  if (!mov || (mov.dir.x === 0 && mov.dir.y === 0)) {
    return;
  }
  let paso = campeon.estadisticas.velocidad * mov.factor * deltaTiempo;
  if (typeof mov.tope === 'number') {
    paso = Math.min(paso, Math.max(0, mov.tope));
  }
  campeon.posicion = limitarALaArena(
    {
      x: campeon.posicion.x + mov.dir.x * paso,
      y: campeon.posicion.y + mov.dir.y * paso,
    },
    estado.arena,
  );
}

// Garantiza la distancia minima (DISTANCIA_MINIMA) entre los dos campeones sin
// sacarlos del circulo de combate. Muta las posiciones de 'a' y 'b'.
function separarCampeones(a, b, arena) {
  for (let i = 0; i < 4; i++) {
    const dx = b.posicion.x - a.posicion.x;
    const dy = b.posicion.y - a.posicion.y;
    const distancia = Math.hypot(dx, dy);
    if (distancia >= DISTANCIA_MINIMA) {
      return;
    }
    const n = distancia > 1e-9 ? { x: dx / distancia, y: dy / distancia } : { x: 1, y: 0 };
    const mitad = (DISTANCIA_MINIMA - distancia) / 2 + 1e-6;
    a.posicion = limitarALaArena(
      { x: a.posicion.x - n.x * mitad, y: a.posicion.y - n.y * mitad },
      arena,
    );
    b.posicion = limitarALaArena(
      { x: b.posicion.x + n.x * mitad, y: b.posicion.y + n.y * mitad },
      arena,
    );
  }
  if (Math.hypot(b.posicion.x - a.posicion.x, b.posicion.y - a.posicion.y) >= DISTANCIA_MINIMA) {
    return;
  }
  // Caso extremo (ambos contra el borde): el mas cercano al centro se coloca a
  // 51 px del otro, en direccion al centro de la arena (siempre dentro del circulo).
  const { cx, cy } = geometriaArena(arena);
  const dA = Math.hypot(a.posicion.x - cx, a.posicion.y - cy);
  const dB = Math.hypot(b.posicion.x - cx, b.posicion.y - cy);
  const [movil, fijo] = dA <= dB ? [a, b] : [b, a];
  const haciaCentro = normalizarVector(cx - fijo.posicion.x, cy - fijo.posicion.y);
  const dir = haciaCentro.x === 0 && haciaCentro.y === 0 ? { x: 1, y: 0 } : haciaCentro;
  movil.posicion = limitarALaArena(
    { x: fijo.posicion.x + dir.x * (DISTANCIA_MINIMA + 1), y: fijo.posicion.y + dir.y * (DISTANCIA_MINIMA + 1) },
    arena,
  );
}
// Reduce todos los enfriamientos del campeon en 'deltaTiempo' segundos, sin
// bajar de 0. Tambien descuenta la duracion del escudo activo y lo desactiva
// cuando el tiempo se agota. La duracion y los enfriamientos se manejan en
// segundos (no en turnos).
function avanzarTemporizadores(campeon, deltaTiempo) {
  for (const clave of Object.keys(campeon.enfriamientos)) {
    campeon.enfriamientos[clave] = Math.max(0, campeon.enfriamientos[clave] - deltaTiempo);
  }
  if (campeon.escudoActivo) {
    campeon.escudoTurnos = Math.max(0, campeon.escudoTurnos - deltaTiempo);
    if (campeon.escudoTurnos <= 1e-9) {
      campeon.escudoActivo = false;
      campeon.escudoTurnos = 0;
    }
  }
}

// Clona superficialmente el sub-estado de un campeon para no mutar el estado
// recibido por actualizarTick (que debe tratarse como inmutable desde fuera).
// Clona tambien las estructuras internas mutables (posicion, enfriamientos).
function clonarCampeon(campeon) {
  return {
    ...campeon,
    posicion: { x: campeon.posicion.x, y: campeon.posicion.y },
    enfriamientos: { ...campeon.enfriamientos },
    ia: campeon.ia ? clonarIA(campeon.ia) : undefined,
    movimiento: campeon.movimiento ? { x: campeon.movimiento.x, y: campeon.movimiento.y } : { x: 0, y: 0 },
  };
}
// Aplica una cura al campeon sin exceder su vida maxima. Devuelve la cantidad
// efectivamente recuperada (para el detalle del evento).
function curar(campeon) {
  const curacion = campeon.vidaMaxima * FRACCION_CURACION;
  const hpPrevio = campeon.hp;
  campeon.hp = Math.min(campeon.vidaMaxima, campeon.hp + curacion);
  return campeon.hp - hpPrevio;
}

// Mapea el nombre de la habilidad ofensiva al tipo de evento del narrador.
// Importante: la habilidad "area_de_dano" genera un evento de tipo "area".
function tipoEventoAtaque(habilidad) {
  if (habilidad === 'embestida') return 'embestida';
  if (habilidad === 'area_de_dano') return 'area';
  // proyectil y ataque basico se registran como 'ataque'.
  return 'ataque';
}

// Ejecuta la habilidad elegida por un campeon (atacante) contra su oponente.
// Aplica el efecto (dano, escudo o curacion), pone la habilidad en enfriamiento,
// respeta los limites de vida [0, vidaMaxima] y registra el evento resultante en
// el arreglo 'eventos'. No hace nada si 'habilidad' es null.
function ejecutarHabilidad(atacante, oponente, habilidad, eventos, rng, arena) {
  if (!habilidad) {
    return;
  }

  // Pone la habilidad en enfriamiento segun la tabla de balance.
  atacante.enfriamientos[habilidad] = ENFRIAMIENTO_HABILIDAD[habilidad];

  if (habilidad === 'escudo') {
    // Activa el escudo por su duracion fija (en segundos).
    atacante.escudoActivo = true;
    atacante.escudoTurnos = DURACION_ESCUDO;
    eventos.push({
      tipo: 'escudo',
      campeon: atacante.id,
      objetivo: null,
      detalle: 'activa un escudo protector',
    });
    return;
  }

  if (habilidad === 'curacion') {
    // Recupera vida sin superar la vida maxima.
    const recuperado = curar(atacante);
    eventos.push({
      tipo: 'curacion',
      campeon: atacante.id,
      objetivo: null,
      detalle: `recupera ${Math.round(recuperado)} HP`,
    });
    return;
  }

  // Habilidad ofensiva: calcula el dano base de la habilidad.
  let dano = calcularDano(atacante, oponente, habilidad);

  // Variacion aleatoria por golpe usando el RNG determinista del combate (nunca
  // Math.random()). Se consumen SIEMPRE dos valores en orden fijo (primero el
  // multiplicador de variacion, luego el tiro de critico) para no romper el
  // determinismo con semilla aunque un golpe no resulte critico.
  //   - multiplicador de variacion aleatorio en [0.85, 1.15).
  //   - 10% de probabilidad de golpe critico, que aplica un x1.5 adicional.
  const variacion = 0.85 + rng.siguiente() * 0.3;
  const esCritico = rng.siguiente() < 0.1;

  dano *= variacion;
  if (esCritico) {
    dano *= 1.5;
  }

  oponente.hp = Math.max(0, oponente.hp - dano);

  const nombreLegible = habilidad === 'ataque_basico' ? 'ataque basico' : habilidad.replace(/_/g, ' ');
  const evento = {
    tipo: tipoEventoAtaque(habilidad),
    campeon: atacante.id,
    objetivo: oponente.id,
    detalle: `${nombreLegible} inflige ${Math.round(dano)} de dano`,
  };
  if (esCritico) {
    evento.critico = true;
  }

  // Embestida: el campeon atraviesa al rival y termina del otro lado. El evento
  // lleva el punto final (coordenadas de la arena) para el efecto visual.
  if (habilidad === 'embestida') {
    evento.destino = iniciarEmbestida(atacante, oponente, arena);
  }
  // Tras golpear cuerpo a cuerpo, el campeon se aparta un momento.
  if (!esADistancia(atacante) && (habilidad === 'ataque_basico' || habilidad === 'embestida')) {
    iniciarRetroceso(atacante, rng);
  }
  eventos.push(evento);
}

// actualizarTick: avanza la simulacion del combate un paso de 'deltaTiempo'
// segundos. Devuelve un nuevo estado (no muta el recibido) y la lista de eventos
// generados en este tick: { estado, eventos }.
//
// Secuencia de cada tick:
//   1. Avanza el tiempo transcurrido.
//   2. Reduce enfriamientos y duracion del escudo de ambos campeones.
//   3. Cada campeon se mueve hacia el oponente, deteniendose al entrar en el
//      rango de la habilidad que usara (nunca se encima: distancia > 0).
//   4. Cada campeon selecciona y ejecuta su habilidad (si procede).
//   5. La vida se mantiene siempre dentro de [0, vidaMaxima].
//
// El orden de actuacion (A antes que B) es fijo para mantener el determinismo.
export function actualizarTick(estado, deltaTiempo) {
  // Clona el estado y los sub-estados de los campeones para no mutar la entrada.
  const nuevoEstado = {
    ...estado,
    campeonA: clonarCampeon(estado.campeonA),
    campeonB: clonarCampeon(estado.campeonB),
  };
  const eventos = [];

  const a = nuevoEstado.campeonA;
  const b = nuevoEstado.campeonB;

  // 1. Avanza el reloj del combate.
  nuevoEstado.tiempoTranscurrido += deltaTiempo;

  // 2. Avanza enfriamientos y temporizador del escudo de ambos campeones.
  avanzarTemporizadores(a, deltaTiempo);
  avanzarTemporizadores(b, deltaTiempo);

  // 3. Movimiento por toda la arena (circulo de radio ~280). Cada campeon se
  //    posiciona segun su tipo (a distancia, cuerpo a cuerpo, huida, embestida)
  //    y despues se garantiza la distancia minima entre ambos. Toda la
  //    aleatoriedad sale del RNG del estado (A antes que B, orden fijo).
  if (!a.ia) {
    a.ia = crearIA(nuevoEstado.rng);
  }
  if (!b.ia) {
    b.ia = crearIA(nuevoEstado.rng);
  }
  avanzarIA(a, deltaTiempo, nuevoEstado.rng);
  avanzarIA(b, deltaTiempo, nuevoEstado.rng);

  const previaA = { x: a.posicion.x, y: a.posicion.y };
  const previaB = { x: b.posicion.x, y: b.posicion.y };

  moverCampeonIA(a, b, nuevoEstado, deltaTiempo);
  moverCampeonIA(b, a, nuevoEstado, deltaTiempo);
  separarCampeones(a, b, nuevoEstado.arena);

  // Velocidad real (px/s) del tick: la escena la usa para inclinar el retrato.
  if (deltaTiempo > 0) {
    a.movimiento = {
      x: (a.posicion.x - previaA.x) / deltaTiempo,
      y: (a.posicion.y - previaA.y) / deltaTiempo,
    };
    b.movimiento = {
      x: (b.posicion.x - previaB.x) / deltaTiempo,
      y: (b.posicion.y - previaB.y) / deltaTiempo,
    };
  }
  // 4. Seleccion y ejecucion de habilidades (A actua primero, luego B). El RNG
  //    del estado se pasa para la variacion/critico de cada golpe ofensivo; el
  //    orden fijo A -> B preserva el determinismo con semilla.
  const habilidadA = seleccionarHabilidad(a, nuevoEstado);
  ejecutarHabilidad(a, b, habilidadA, eventos, nuevoEstado.rng, nuevoEstado.arena);

  // B solo actua si sigue con vida tras el ataque de A.
  if (b.hp > 0) {
    const habilidadB = seleccionarHabilidad(b, nuevoEstado);
    ejecutarHabilidad(b, a, habilidadB, eventos, nuevoEstado.rng, nuevoEstado.arena);
  }

  // 5. Red de seguridad: garantiza la invariante de vida en [0, vidaMaxima].
  a.hp = Math.min(a.vidaMaxima, Math.max(0, a.hp));
  b.hp = Math.min(b.vidaMaxima, Math.max(0, b.hp));

  return { estado: nuevoEstado, eventos };
}

// ---------------------------------------------------------------------------
// Determinacion del ganador
// ---------------------------------------------------------------------------

// determinarGanador: evalua el resultado del combate cuando (al menos) un
// campeon podria haber llegado a HP 0. Devuelve:
//   { resultado: 'ganador', idGanador } si solo uno sigue vivo,
//   { resultado: 'empate', idGanador: null } si ambos llegaron a 0,
//   { resultado: 'en_curso', idGanador: null } si ambos siguen vivos.
export function determinarGanador(estado) {
  const aVivo = estado.campeonA.hp > 0;
  const bVivo = estado.campeonB.hp > 0;

  if (!aVivo && !bVivo) {
    return { resultado: 'empate', idGanador: null };
  }
  if (!aVivo) {
    return { resultado: 'ganador', idGanador: estado.campeonB.id };
  }
  if (!bVivo) {
    return { resultado: 'ganador', idGanador: estado.campeonA.id };
  }
  return { resultado: 'en_curso', idGanador: null };
}

// determinarGanadorPorVida: resuelve el combate por tiempo agotado (90 s) segun
// el mayor porcentaje de vida restante respecto a la vida maxima de cada
// campeon. Si los porcentajes son iguales, declara empate.
export function determinarGanadorPorVida(estado) {
  const pctA = estado.campeonA.hp / estado.campeonA.vidaMaxima;
  const pctB = estado.campeonB.hp / estado.campeonB.vidaMaxima;

  if (pctA > pctB) {
    return { resultado: 'ganador', idGanador: estado.campeonA.id };
  }
  if (pctB > pctA) {
    return { resultado: 'ganador', idGanador: estado.campeonB.id };
  }
  return { resultado: 'empate', idGanador: null };
}

// ---------------------------------------------------------------------------
// Simulacion completa del combate
// ---------------------------------------------------------------------------

// Paso fijo de la simulacion: 50 ms (20 ticks por segundo). Un paso fijo hace
// el combate determinista e independiente del framerate del navegador.
export const PASO_FIJO = 0.05;

// simularCombate: ejecuta la simulacion completa de un combate desde el estado
// inicial hasta que termina, y devuelve el resultado junto con todos los
// eventos acumulados. Esta funcion se usa principalmente en pruebas (y en
// simulaciones "en background"); Phaser, en cambio, usa actualizarTick tick a
// tick para poder renderizar cada paso.
//
// El loop avanza con paso fijo de 50 ms (PASO_FIJO) y se detiene en cuanto:
//   - la vida de algun campeon llega a 0 (lo resuelve determinarGanador), o
//   - el tiempo transcurrido alcanza la duracion maxima (90 s), en cuyo caso el
//     combate se resuelve por mayor porcentaje de vida (determinarGanadorPorVida).
//
// Devuelve: { resultado, idGanador, eventos, estadoFinal }
//   - resultado: 'ganador' | 'empate'
//   - idGanador: id del campeon ganador, o null en empate
//   - eventos: arreglo con todos los eventos registrados durante el combate
//   - estadoFinal: el EstadoCombate final (con resultado e idGanador fijados)
export function simularCombate(campeonA, campeonB, configArena, semilla) {
  let estado = crearCombate(campeonA, campeonB, configArena, semilla);

  // Cota dura de seguridad: numero maximo de ticks posibles antes de alcanzar la
  // duracion maxima. Garantiza la terminacion del loop incluso ante errores de
  // punto flotante en la acumulacion del tiempo (nunca se queda colgado).
  const maxTicks = Math.ceil(estado.duracionMaxima / PASO_FIJO) + 1;
  let ticks = 0;

  // El combate sigue mientras no haya un resultado definido (en curso).
  while (estado.resultado === null && ticks < maxTicks) {
    ticks += 1;

    // Avanza un paso fijo de la simulacion sin mutar el estado anterior.
    const paso = actualizarTick(estado, PASO_FIJO);
    estado = paso.estado;

    // Acumula los eventos generados en este tick en el historial del combate.
    estado.eventos.push(...paso.eventos);

    // Condicion de fin por vida en cero: si alguno llego a 0, se resuelve el
    // ganador (o empate si ambos cayeron en el mismo tick).
    if (estado.campeonA.hp <= 0 || estado.campeonB.hp <= 0) {
      const desenlace = determinarGanador(estado);
      estado.resultado = desenlace.resultado;
      estado.idGanador = desenlace.idGanador;
    } else if (estado.tiempoTranscurrido >= estado.duracionMaxima) {
      // Condicion de fin por tiempo: se resuelve por mayor porcentaje de vida.
      const desenlace = determinarGanadorPorVida(estado);
      estado.resultado = desenlace.resultado;
      estado.idGanador = desenlace.idGanador;
    }
  }

  // Red de seguridad: si se alcanzo la cota de ticks sin resultado (no deberia
  // ocurrir), se resuelve por porcentaje de vida para garantizar un desenlace.
  if (estado.resultado === null) {
    const desenlace = determinarGanadorPorVida(estado);
    estado.resultado = desenlace.resultado;
    estado.idGanador = desenlace.idGanador;
  }

  return {
    resultado: estado.resultado,
    idGanador: estado.idGanador,
    eventos: estado.eventos,
    estadoFinal: estado,
  };
}
