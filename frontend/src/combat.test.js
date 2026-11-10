// Tests unitarios con ejemplos concretos para el desenlace del combate.
//
// A diferencia de las pruebas de propiedades (que verifican invariantes sobre
// muchas entradas generadas), estos tests comprueban CASOS CONCRETOS y
// deterministas del modulo de combate puro (src/combat.js), construyendo
// estados exactos y forzando cada escenario de forma reproducible.
//
// Requisitos validados:
//   - 7.1: si la vida de un campeon llega a 0 y la del otro es > 0, gana el
//     campeon con vida > 0.
//   - 7.2: si ambos campeones llegan a vida 0, el combate declara empate.
//   - 7.6: al agotarse el tiempo (90 s) sin KO, gana el campeon con mayor
//     porcentaje de vida restante; a igualdad de porcentaje, empate.
import { describe, it, expect } from 'vitest';
import {
  crearCombate,
  determinarGanador,
  determinarGanadorPorVida,
  simularCombate,
  actualizarTick,
  DURACION_MAXIMA,
  PASO_FIJO,
  RADIO_ARENA,
  DISTANCIA_MINIMA,
} from './combat.js';

// --------------------------------------------------------------------------
// Utilidades de construccion de campeones de prueba
// --------------------------------------------------------------------------

// Crea una definicion de campeon valida (como la que vendria de la API) con
// estadisticas y habilidades parametrizables. Sirve para armar estados de
// combate deterministas en los tests.
function crearCampeon(id, { vida = 1000, dano = 80, armadura = 50, velocidad = 300, habilidades = ['proyectil'] } = {}) {
  return {
    id,
    nombre: id,
    estadisticas: { vida, dano, armadura, velocidad },
    habilidades: [...habilidades],
  };
}

// --------------------------------------------------------------------------
// Requisito 7.1: victoria por KO (un campeon a 0 HP, el otro con HP > 0)
// --------------------------------------------------------------------------

describe('Requisito 7.1: victoria cuando un campeon llega a HP 0 y el otro tiene HP > 0', () => {
  // Caso concreto: el campeon A gana cuando el HP de B llega a 0 y el HP de A > 0.
  it('declara ganador al campeon A cuando B llega a 0 HP y A sigue vivo', () => {
    const estado = crearCombate(crearCampeon('A'), crearCampeon('B'), null, 123);
    // Forzamos el escenario de KO de B dejando A con vida.
    estado.campeonA.hp = 500;
    estado.campeonB.hp = 0;

    const desenlace = determinarGanador(estado);

    expect(desenlace.resultado).toBe('ganador');
    expect(desenlace.idGanador).toBe('A');
  });

  // Caso simetrico: el campeon B gana cuando el HP de A llega a 0 y el HP de B > 0.
  it('declara ganador al campeon B cuando A llega a 0 HP y B sigue vivo', () => {
    const estado = crearCombate(crearCampeon('A'), crearCampeon('B'), null, 123);
    estado.campeonA.hp = 0;
    estado.campeonB.hp = 250;

    const desenlace = determinarGanador(estado);

    expect(desenlace.resultado).toBe('ganador');
    expect(desenlace.idGanador).toBe('B');
  });

  // Caso de extremo a extremo: una simulacion completa y determinista entre un
  // campeon fuerte (A) y uno fragil (B) debe terminar con A como ganador por KO,
  // dejando a B en 0 HP y a A con HP > 0 (validacion integral del Requisito 7.1).
  it('en una simulacion completa, el campeon mas fuerte gana por KO con HP > 0', () => {
    const fuerte = crearCampeon('Fuerte', { vida: 1200, dano: 120, armadura: 80, velocidad: 350 });
    const fragil = crearCampeon('Fragil', { vida: 600, dano: 20, armadura: 10, velocidad: 220 });

    const { resultado, idGanador, estadoFinal } = simularCombate(fuerte, fragil, null, 7);

    expect(resultado).toBe('ganador');
    expect(idGanador).toBe('Fuerte');
    // El perdedor queda sin vida y el ganador conserva HP positivo.
    expect(estadoFinal.campeonB.hp).toBe(0);
    expect(estadoFinal.campeonA.hp).toBeGreaterThan(0);
  });
});

// --------------------------------------------------------------------------
// Requisito 7.2: empate cuando ambos campeones llegan a HP 0 en el mismo tick
// --------------------------------------------------------------------------

describe('Requisito 7.2: empate cuando ambos campeones llegan a HP 0', () => {
  // Caso concreto: empate cuando el HP de ambos llega a 0 en el mismo tick.
  it('declara empate cuando A y B tienen 0 HP simultaneamente', () => {
    const estado = crearCombate(crearCampeon('A'), crearCampeon('B'), null, 123);
    // Ambos campeones caen a 0 en el mismo tick.
    estado.campeonA.hp = 0;
    estado.campeonB.hp = 0;

    const desenlace = determinarGanador(estado);

    expect(desenlace.resultado).toBe('empate');
    expect(desenlace.idGanador).toBeNull();
  });
});

// --------------------------------------------------------------------------
// Requisito 7.6: desenlace por tiempo agotado (90 s) segun porcentaje de vida
// --------------------------------------------------------------------------

describe('Requisito 7.6: desenlace por tiempo agotado a los 90 s segun porcentaje de vida', () => {
  // Caso concreto: ganador por tiempo cuando los porcentajes de vida difieren.
  // A conserva 60% (600/1000) y B conserva 30% (300/1000): gana A.
  it('declara ganador al campeon con mayor porcentaje de vida restante', () => {
    const estado = crearCombate(
      crearCampeon('A', { vida: 1000 }),
      crearCampeon('B', { vida: 1000 }),
      null,
      123,
    );
    // Simulamos que se alcanzo la duracion maxima sin KO.
    estado.tiempoTranscurrido = DURACION_MAXIMA;
    estado.campeonA.hp = 600; // 60% de 1000
    estado.campeonB.hp = 300; // 30% de 1000

    const desenlace = determinarGanadorPorVida(estado);

    expect(desenlace.resultado).toBe('ganador');
    expect(desenlace.idGanador).toBe('A');
  });

  // El porcentaje se mide respecto a la vida maxima de CADA campeon, no al HP
  // absoluto: B tiene mas HP absoluto (400) pero menor porcentaje (40%) que A
  // (450/500 = 90%), por lo que gana A.
  it('usa el porcentaje relativo a la vida maxima, no el HP absoluto', () => {
    const estado = crearCombate(
      crearCampeon('A', { vida: 500 }),
      crearCampeon('B', { vida: 1000 }),
      null,
      123,
    );
    estado.tiempoTranscurrido = DURACION_MAXIMA;
    estado.campeonA.hp = 450; // 90% de 500
    estado.campeonB.hp = 400; // 40% de 1000

    const desenlace = determinarGanadorPorVida(estado);

    expect(desenlace.resultado).toBe('ganador');
    expect(desenlace.idGanador).toBe('A');
  });

  // Caso concreto: empate por tiempo cuando ambos conservan el mismo porcentaje
  // de vida, aunque sus vidas maximas (y por tanto su HP absoluto) difieran.
  it('declara empate cuando ambos conservan el mismo porcentaje de vida', () => {
    const estado = crearCombate(
      crearCampeon('A', { vida: 1000 }),
      crearCampeon('B', { vida: 500 }),
      null,
      123,
    );
    estado.tiempoTranscurrido = DURACION_MAXIMA;
    estado.campeonA.hp = 500; // 50% de 1000
    estado.campeonB.hp = 250; // 50% de 500

    const desenlace = determinarGanadorPorVida(estado);

    expect(desenlace.resultado).toBe('empate');
    expect(desenlace.idGanador).toBeNull();
  });
});

// --------------------------------------------------------------------------
// Movimiento por toda la arena (circulo de radio 280 centrado en 400,300)
// --------------------------------------------------------------------------

describe('Movimiento por la arena', () => {
  const combinaciones = [
    [['proyectil', 'escudo'], ['embestida', 'curacion']],
    [['area_de_dano', 'curacion'], ['proyectil', 'embestida']],
    [['embestida', 'escudo'], ['embestida', 'curacion']],
    [['proyectil', 'area_de_dano', 'curacion'], ['area_de_dano', 'escudo']],
  ];

  // Los campeones nunca salen del circulo y nunca se encimaran (>= 50 px).
  it('mantiene a los campeones dentro del circulo y a mas de 50 px entre si', () => {
    for (const [habA, habB] of combinaciones) {
      for (let semilla = 1; semilla <= 5; semilla++) {
        let estado = crearCombate(
          crearCampeon('A', { habilidades: habA, velocidad: 200 + semilla * 40 }),
          crearCampeon('B', { habilidades: habB, velocidad: 440 - semilla * 40 }),
          null,
          semilla,
        );
        for (let i = 0; i < 20 * 40; i++) {
          estado = actualizarTick(estado, PASO_FIJO).estado;
          for (const c of [estado.campeonA, estado.campeonB]) {
            const r = Math.hypot(c.posicion.x - 400, c.posicion.y - 300);
            expect(r).toBeLessThanOrEqual(RADIO_ARENA + 1e-6);
          }
          const d = Math.hypot(
            estado.campeonA.posicion.x - estado.campeonB.posicion.x,
            estado.campeonA.posicion.y - estado.campeonB.posicion.y,
          );
          expect(d).toBeGreaterThanOrEqual(DISTANCIA_MINIMA - 1e-6);
          if (estado.campeonA.hp <= 0 || estado.campeonB.hp <= 0) break;
        }
      }
    }
  });

  // Con la misma semilla el combate es identico y nunca se usa Math.random().
  it('es determinista con semilla y no usa Math.random()', () => {
    const original = Math.random;
    Math.random = () => {
      throw new Error('Math.random no debe usarse en combat.js');
    };
    try {
      const a = crearCampeon('A', { habilidades: ['proyectil', 'curacion'] });
      const b = crearCampeon('B', { habilidades: ['embestida', 'escudo'] });
      const x = simularCombate(a, b, null, 42);
      const y = simularCombate(a, b, null, 42);
      expect(y.estadoFinal.campeonA.posicion).toEqual(x.estadoFinal.campeonA.posicion);
      expect(y.estadoFinal.campeonB.posicion).toEqual(x.estadoFinal.campeonB.posicion);
      expect(y.estadoFinal.tiempoTranscurrido).toBe(x.estadoFinal.tiempoTranscurrido);
    } finally {
      Math.random = original;
    }
  });

  // Un campeon a distancia se queda entre 200 y 260 px del rival mientras espera.
  it('un campeon a distancia se mantiene cerca de los 200-260 px del rival', () => {
    let estado = crearCombate(
      crearCampeon('A', { habilidades: ['proyectil'], velocidad: 300 }),
      crearCampeon('B', { habilidades: ['proyectil'], velocidad: 300 }),
      null,
      3,
    );
    const distancias = [];
    for (let i = 0; i < 20 * 6; i++) {
      estado = actualizarTick(estado, PASO_FIJO).estado;
      if (i > 20 * 2) {
        distancias.push(
          Math.hypot(
            estado.campeonA.posicion.x - estado.campeonB.posicion.x,
            estado.campeonA.posicion.y - estado.campeonB.posicion.y,
          ),
        );
      }
    }
    const promedio = distancias.reduce((x, y) => x + y, 0) / distancias.length;
    expect(promedio).toBeGreaterThan(190);
    expect(promedio).toBeLessThan(270);
  });

  // Tras una embestida, el campeon termina del otro lado del rival.
  it('despues de una embestida el campeon queda del otro lado del rival', () => {
    // El rival casi no se mueve para poder comparar los lados con claridad.
    let estado = crearCombate(
      crearCampeon('A', { habilidades: ['embestida'], velocidad: 300 }),
      crearCampeon('B', { habilidades: ['escudo'], velocidad: 1 }),
      null,
      5,
    );
    let direccionInicial = null;
    let embistio = false;
    for (let i = 0; i < 20 * 15 && !embistio; i++) {
      const antes = estado;
      const paso = actualizarTick(estado, PASO_FIJO);
      estado = paso.estado;
      if (paso.eventos.some((e) => e.tipo === 'embestida' && e.campeon === 'A')) {
        embistio = true;
        const dx = antes.campeonB.posicion.x - antes.campeonA.posicion.x;
        const dy = antes.campeonB.posicion.y - antes.campeonA.posicion.y;
        const m = Math.hypot(dx, dy);
        direccionInicial = { x: dx / m, y: dy / m };
      }
    }
    expect(embistio).toBe(true);
    // Deja terminar la embestida (dura menos de 1 s) y mide justo al terminar.
    for (let i = 0; i < 20 && estado.campeonA.ia.embestida; i++) {
      estado = actualizarTick(estado, PASO_FIJO).estado;
    }
    expect(estado.campeonA.ia.embestida).toBeNull();
    const relX = estado.campeonA.posicion.x - estado.campeonB.posicion.x;
    const relY = estado.campeonA.posicion.y - estado.campeonB.posicion.y;
    expect(relX * direccionInicial.x + relY * direccionInicial.y).toBeGreaterThan(0);
  });

  // Con vida < 35% y curacion, el campeon se aleja del rival.
  it('con vida baja y curacion se aleja del rival', () => {
    let estado = crearCombate(
      crearCampeon('A', { habilidades: ['curacion'], velocidad: 300 }),
      crearCampeon('B', { habilidades: ['escudo'], velocidad: 1 }),
      null,
      9,
    );
    estado.campeonA.hp = estado.campeonA.vidaMaxima * 0.2;
    estado.campeonA.posicion = { x: 330, y: 300 };
    estado.campeonB.posicion = { x: 400, y: 300 };
    const distanciaInicial = 70;
    for (let i = 0; i < 20; i++) {
      estado = actualizarTick(estado, PASO_FIJO).estado;
    }
    const d = Math.hypot(
      estado.campeonA.posicion.x - estado.campeonB.posicion.x,
      estado.campeonA.posicion.y - estado.campeonB.posicion.y,
    );
    expect(d).toBeGreaterThan(distanciaInicial + 100);
  });
});