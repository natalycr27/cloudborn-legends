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
  if (distancia <= RANGO_HABILIDAD.ataque_basico) {
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
  if (habilidadDisponible(campeon, 'ataque_basico') && distancia <= RANGO_HABILIDAD.ataque_basico) {
    return 'ataque_basico';
  }

  // Ninguna habilidad aplicable en este tick (p. ej. el campeon aun se acerca).
  return null;
}

// ---------------------------------------------------------------------------
// Avance de un tick de combate
// ---------------------------------------------------------------------------

// Determina a que distancia (rango) un campeon debe detenerse para usar la
// mejor habilidad que tiene disponible. Esto evita que se encime sobre el
// oponente: el campeon avanza solo hasta quedar dentro del rango de la habilidad
// que podra ejecutar. Si no tiene ninguna habilidad de ataque disponible en
// este momento, se acerca hasta el rango del ataque basico (60 px).
function rangoDeDetencion(campeon) {
  const habilidades = Array.isArray(campeon.habilidades) ? campeon.habilidades : [];
  let rango = RANGO_HABILIDAD.ataque_basico; // objetivo minimo: rango del basico

  // Entre las habilidades ofensivas disponibles, el campeon puede detenerse en
  // el mayor rango util (asi ataca a distancia sin acercarse de mas).
  for (const habilidad of habilidades) {
    if (!esHabilidadOfensiva(habilidad)) {
      continue;
    }
    if (habilidadDisponible(campeon, habilidad)) {
      rango = Math.max(rango, RANGO_HABILIDAD[habilidad]);
    }
  }
  return rango;
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
function ejecutarHabilidad(atacante, oponente, habilidad, eventos) {
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

  // Habilidad ofensiva: calcula el dano y lo aplica sin que la vida baje de 0.
  const dano = calcularDano(atacante, oponente, habilidad);
  oponente.hp = Math.max(0, oponente.hp - dano);

  const nombreLegible = habilidad === 'ataque_basico' ? 'ataque basico' : habilidad.replace(/_/g, ' ');
  eventos.push({
    tipo: tipoEventoAtaque(habilidad),
    campeon: atacante.id,
    objetivo: oponente.id,
    detalle: `${nombreLegible} inflige ${Math.round(dano)} de dano`,
  });
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

  // 3. Movimiento: cada campeon avanza hacia el oponente, pero se detiene al
  //    entrar en el rango de la habilidad que podra usar. Nunca se encima: si ya
  //    esta dentro del rango de detencion, no se mueve (asi la distancia > 0).
  const distanciaActual = distanciaEntre(a, b);

  const rangoA = rangoDeDetencion(a);
  if (distanciaActual > rangoA) {
    a.posicion = moverHastaRango(a, b, deltaTiempo, nuevoEstado.arena, rangoA);
  }

  const rangoB = rangoDeDetencion(b);
  // Recalcula la distancia por si A ya se movio en este tick.
  if (distanciaEntre(a, b) > rangoB) {
    b.posicion = moverHastaRango(b, a, deltaTiempo, nuevoEstado.arena, rangoB);
  }

  // 4. Seleccion y ejecucion de habilidades (A actua primero, luego B).
  const habilidadA = seleccionarHabilidad(a, nuevoEstado);
  ejecutarHabilidad(a, b, habilidadA, eventos);

  // B solo actua si sigue con vida tras el ataque de A.
  if (b.hp > 0) {
    const habilidadB = seleccionarHabilidad(b, nuevoEstado);
    ejecutarHabilidad(b, a, habilidadB, eventos);
  }

  // 5. Red de seguridad: garantiza la invariante de vida en [0, vidaMaxima].
  a.hp = Math.min(a.vidaMaxima, Math.max(0, a.hp));
  b.hp = Math.min(b.vidaMaxima, Math.max(0, b.hp));

  return { estado: nuevoEstado, eventos };
}

// Mueve un campeon hacia su objetivo pero sin acercarse mas alla de 'rango'
// pixeles: si el paso calculado lo llevaria dentro del rango, se detiene justo
// en el borde del rango. Asi el campeon nunca se encima sobre el oponente
// (distancia 0) y respeta el rango de la habilidad que usara. Devuelve la nueva
// posicion {x, y} limitada a la arena.
function moverHastaRango(campeon, objetivo, deltaTiempo, arena, rango) {
  const direccion = normalizarDireccion(campeon.posicion, objetivo.posicion);
  // Si no hay direccion valida (misma posicion), no se mueve.
  if (direccion.x === 0 && direccion.y === 0) {
    return { x: campeon.posicion.x, y: campeon.posicion.y };
  }

  const distanciaActual = distanciaEntre(campeon, objetivo);
  const pasoDeseado = campeon.estadisticas.velocidad * deltaTiempo;
  // Nunca avanzar mas que (distanciaActual - rango): eso deja al campeon justo
  // en el borde del rango, nunca encimado sobre el oponente.
  const avanceMaximo = Math.max(0, distanciaActual - rango);
  const paso = Math.min(pasoDeseado, avanceMaximo);

  const nuevaPosicion = {
    x: campeon.posicion.x + direccion.x * paso,
    y: campeon.posicion.y + direccion.y * paso,
  };
  return limitarALaArena(nuevaPosicion, arena);
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
