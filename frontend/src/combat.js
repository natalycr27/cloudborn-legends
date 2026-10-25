// Modulo de combate puro de Cloudborn Legends (combat.js).
//
// Este modulo contiene la logica de combate automatico SIN ninguna dependencia
// de Phaser ni del DOM. Es un modulo ES de funciones puras (o con estado
// explicito y determinista) que puede importarse y ejecutarse en Node.js para
// pruebas unitarias y de propiedades.
//
// Esta primera parte (tarea 7.1) implementa las funciones base:
//   - crearCombate: inicializa el EstadoCombate completo.
//   - moverCampeon: mueve un campeon hacia su objetivo limitando a la arena.
//   - calcularDano: calcula el dano final segun habilidad, armadura y escudo.
//
// Las funciones seleccionarHabilidad, actualizarTick, determinarGanador y
// simularCombate se agregan en tareas posteriores (7.2 y 7.3). El modulo esta
// estructurado para permitir esa ampliacion sin cambios de interfaz.

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

// Limita una posicion {x, y} para que permanezca dentro de los limites de la
// arena. Los campeones no pueden salir del rectangulo [0, ancho] x [0, alto].
function limitarALaArena(posicion, arena) {
  const ancho = arena && typeof arena.ancho === 'number' ? arena.ancho : ARENA_POR_DEFECTO.ancho;
  const alto = arena && typeof arena.alto === 'number' ? arena.alto : ARENA_POR_DEFECTO.alto;
  return {
    x: Math.min(Math.max(posicion.x, 0), ancho),
    y: Math.min(Math.max(posicion.y, 0), alto),
  };
}

// ---------------------------------------------------------------------------
// Inicializacion del estado de combate
// ---------------------------------------------------------------------------

// Construye el sub-estado de un campeon dentro del combate a partir de su
// definicion (la que viene de la API). Clona el campeon para no mutar el
// original y le agrega el estado de combate: hp, posicion, enfriamientos,
// escudoActivo y escudoTurnos.
function inicializarCampeon(campeon, posicion) {
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
  // Arena: usa la configuracion recibida o la arena por defecto (800x600).
  const arena = {
    ancho: configArena && typeof configArena.ancho === 'number' ? configArena.ancho : ARENA_POR_DEFECTO.ancho,
    alto: configArena && typeof configArena.alto === 'number' ? configArena.alto : ARENA_POR_DEFECTO.alto,
  };

  // Posiciones iniciales: campeon A a la izquierda y campeon B a la derecha,
  // ambos centrados verticalmente. Se separan a un cuarto del ancho de cada
  // borde para que empiecen enfrentados con distancia entre ellos.
  const posicionA = { x: arena.ancho * 0.25, y: arena.alto / 2 };
  const posicionB = { x: arena.ancho * 0.75, y: arena.alto / 2 };

  return {
    campeonA: inicializarCampeon(campeonA, posicionA),
    campeonB: inicializarCampeon(campeonB, posicionB),
    tiempoTranscurrido: 0, // segundos transcurridos de combate
    duracionMaxima: DURACION_MAXIMA, // 90 segundos
    arena,
    eventos: [], // eventos registrados para el narrador
    resultado: null, // 'ganador' | 'empate' | null (en curso)
    idGanador: null,
    rng: crearRng(semilla), // generador determinista reproducible con semilla
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
  const danoFinal = danoBruto * (1 - reduccionArmadura);

  return Math.max(0, danoFinal);
}
