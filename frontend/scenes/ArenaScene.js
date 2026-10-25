// ArenaScene: arena de combate que orquesta combat.js y renderiza el estado
// con aspecto de coliseo, todo dibujado con Phaser (Graphics, particulas y
// tweens), SIN ninguna imagen externa.
//
// Responsabilidades:
//   - Crear el combate con `crearCombate` (combat.js) usando una semilla
//     aleatoria a partir de los dos campeones recibidos de SeleccionScene.
//   - Avanzar la simulacion con un acumulador de paso fijo (50 ms) dentro del
//     metodo update(time, delta) de Phaser, igual que el patron del diseno
//     ("Game loop con paso fijo"). Asi el combate es determinista e
//     independiente del framerate del navegador.
//   - Renderizar la arena vista desde arriba con estetica de coliseo:
//       * piso circular de baldosas de piedra, anillo de borde y runas centrales
//       * 4 antorchas con fuego animado por particulas
//       * publico como puntos animados en las gradas
//       * vineta oscura en los bordes
//   - Renderizar los campeones como circulos con su colorPrincipal/secundario,
//     con sombra, aura, animacion de respiracion, parpadeo + retroceso al
//     recibir dano y numeros de dano flotantes (amarillos y mas grandes si el
//     evento es critico).
//   - HUD estilo juego de pelea: barras de vida grandes arriba a la izquierda
//     (campeon A) y a la derecha (campeon B) con nombre y color; temporizador
//     al centro. (Se quitan las barras/nombres que iban encima de los campeones.)
//   - Efectos por habilidad usando los eventos de actualizarTick:
//       * proyectil  -> bola de energia con estela que viaja al objetivo
//       * embestida  -> dash con rastro
//       * area       -> onda expansiva circular
//       * escudo     -> burbuja translucida mientras dure
//       * curacion   -> particulas verdes subiendo
//       * critico    -> sacudida de camara
//   - Pantalla final: oscurecer el fondo y mostrar "¡VICTORIA!" + nombre del
//     ganador (o "¡EMPATE!") con animacion de entrada.
//
// Nota sobre eventos: combat.js emite eventos con la forma
//   { tipo, campeon (id atacante), objetivo (id defensor), detalle, critico? }
// Los tipos son 'ataque' (incluye proyectil y ataque basico), 'embestida',
// 'area', 'escudo' y 'curacion'. El proyectil NO tiene tipo propio: se detecta
// porque su `detalle` empieza por "proyectil". La habilidad "area_de_dano"
// genera el tipo de evento "area".
//
// La tarea 8.4c (registro de resultado, narracion y navegacion) se enganchara
// sobre this.resultado / this.idGanador / this.eventosNarracion.

import {
  crearCombate,
  actualizarTick,
  determinarGanador,
  ARENA_POR_DEFECTO,
  PASO_FIJO,
} from "../src/combat.js";
import { API_URL } from "../src/main.js";

// Paleta reutilizada (coincide con index.html / las demas escenas).
const COLOR_FONDO = "#0b1020";
const COLOR_TEXTO = "#e8eefc";
const COLOR_TEXTO_TENUE = "#9fb0d8";

// Colores del coliseo (enteros Phaser).
const COLOR_PISO = 0x3a3024; // piedra calida del piso de la arena
const COLOR_PISO_CLARO = 0x4a3e2d; // baldosa alterna mas clara
const COLOR_JUNTA = 0x241d14; // lineas entre baldosas
const COLOR_ANILLO = 0x6b5636; // anillo de borde de la arena
const COLOR_ANILLO_INT = 0x8a6f44; // reflejo interior del anillo
const COLOR_GRADA = 0x1a1626; // gradas oscuras alrededor
const COLOR_RUNA = 0x5ad1ff; // runas brillantes del centro

// Colores del HUD de barras de vida estilo juego de pelea.
const COLOR_HUD_MARCO = 0x05070f;
const COLOR_HUD_RIEL = 0x1a2140;
const COLOR_VIDA = 0x5ad17a; // relleno de vida alta
const COLOR_VIDA_MEDIA = 0xffd15a; // relleno de vida media
const COLOR_VIDA_BAJA = 0xff6b6b; // relleno de vida baja

// Radio en pixeles (en coordenadas logicas 800x600) del circulo de cada campeon.
const RADIO_CAMPEON = 30;

export default class ArenaScene extends Phaser.Scene {
  // Registra la escena con la clave "ArenaScene" usada por main.js.
  constructor() {
    super("ArenaScene");

    // Campeones recibidos de SeleccionScene.
    this.campeonA = null;
    this.campeonB = null;

    // Estado de combate (combat.js) y control del loop de paso fijo.
    this.estadoCombate = null;
    this.acumulador = 0;
    this.resultado = null; // 'ganador' | 'empate' | null (en curso)
    this.idGanador = null;

    // Historial de eventos acumulados tick a tick (lo consume 8.4c).
    this.eventosNarracion = [];

    // Factores de escala de la arena logica (800x600) al canvas real.
    this.escala = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.centroX = 0; // centro del piso circular en pantalla
    this.centroY = 0;
    this.radioArena = 0; // radio del piso circular en pantalla

    // Objetos de render persistentes por campeon.
    this.sprites = { A: null, B: null };

    // HUD superior (barras grandes + temporizador).
    this.hud = { A: null, B: null };
    this.textoTemporizador = null;

    // Capas de dibujo por profundidad.
    this.capaEfectos = null;

    // Vida anterior de cada campeon (para detectar impactos y animar dano).
    this.hpPrevio = { A: null, B: null };

    // Bandera para no lanzar la pantalla final mas de una vez.
    this.pantallaFinalMostrada = false;

    // Bandera para ejecutar el flujo de fin de combate (registro de resultado,
    // narracion y navegacion) una sola vez (tarea 8.4c).
    this.finProcesado = false;

    // Referencia al texto de narracion de la pantalla final (se rellena cuando
    // /narraciones responde) y al boton para continuar al ranking.
    this.textoNarracion = null;

    // Bandera para navegar al ranking una sola vez (boton manual + automatico).
    this.navegacionIniciada = false;
  }

  // Lee los datos entrantes de SeleccionScene antes de create().
  init(data) {
    this.campeonA = data && data.campeonA ? data.campeonA : null;
    this.campeonB = data && data.campeonB ? data.campeonB : null;

    // Reinicia el estado por si la escena se reutiliza entre combates.
    this.estadoCombate = null;
    this.acumulador = 0;
    this.resultado = null;
    this.idGanador = null;
    this.eventosNarracion = [];
    this.sprites = { A: null, B: null };
    this.hud = { A: null, B: null };
    this.hpPrevio = { A: null, B: null };
    this.pantallaFinalMostrada = false;
    this.finProcesado = false;
    this.textoNarracion = null;
    this.navegacionIniciada = false;
  }

  // Inicializa el combate, calcula la escala de la arena y dibuja la escena base.
  create() {
    // Fondo solido para que la arena no herede residuos de otras escenas.
    this.cameras.main.setBackgroundColor(COLOR_FONDO);

    // Si faltan campeones (navegacion inesperada), vuelve a la seleccion.
    if (!this.campeonA || !this.campeonB) {
      this.mostrarErrorYVolver();
      return;
    }

    // Semilla aleatoria: combate reproducible dentro de la sesion.
    const semilla = Math.floor(Math.random() * 0xffffffff);
    this.estadoCombate = crearCombate(this.campeonA, this.campeonB, ARENA_POR_DEFECTO, semilla);

    // Genera las texturas de particulas (puntos suaves) una sola vez.
    this.generarTexturasParticulas();

    // Construye todo el layout visual (coliseo, sprites y HUD) para el tamano
    // actual del canvas. Se extrae a un metodo propio para poder reconstruirlo
    // cuando cambie el tamano/orientacion (giro del telefono).
    this.construirLayout();

    // Guarda la vida inicial para detectar impactos posteriores.
    this.hpPrevio.A = this.estadoCombate.campeonA.hp;
    this.hpPrevio.B = this.estadoCombate.campeonB.hp;

    // Render inicial del estado (posiciones y barras de vida de partida).
    this.renderizar();

    // Reacomodo ante cambio de tamano/orientacion: cuando main.js ajusta el
    // tamano base del juego (720x1280 <-> 800x600) o el navegador redimensiona
    // la ventana, Phaser emite 'resize' en el ScaleManager. Reconstruimos el
    // layout conservando el estado del combate para que la arena se reacomode
    // sin reiniciar la pelea.
    this.scale.on("resize", this.alRedimensionar, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.alApagar, this);
  }

  // Construye (o reconstruye) todo el contenido visual de la escena para el
  // tamano actual del canvas: calcula la escala/offsets de la arena logica
  // (800x600) sobre el canvas, dibuja el coliseo, crea la capa de efectos y
  // genera los sprites de los campeones y el HUD superior. No toca el estado
  // del combate, de modo que puede invocarse de nuevo al cambiar el tamano.
  construirLayout() {
    // Calcula como mapear la arena logica (800x600) al canvas real, centrada.
    // El HUD va arriba y el coliseo ocupa el mayor espacio posible del ancho.
    this.calcularEscalaArena();

    // Dibuja el coliseo (gradas, publico, piso, runas, antorchas, vineta).
    this.dibujarColiseo();

    // Capa donde van los efectos de habilidades, por encima de la arena pero
    // por debajo del HUD.
    this.capaEfectos = this.add.container(0, 0).setDepth(6);

    // Crea los sprites de los campeones y el HUD superior.
    this.crearSprites();
    this.crearHud();
  }

  // Manejador del evento 'resize' del ScaleManager. Destruye el contenido
  // visual actual (dejando intacto el estado del combate) y reconstruye el
  // layout para el nuevo tamano, de modo que al girar el telefono la arena se
  // reacomode: el HUD arriba y el coliseo ocupando casi todo el ancho.
  alRedimensionar() {
    // Evita reconstruir si la escena ya no esta activa (p. ej. navegando fuera).
    if (!this.scene || !this.scene.isActive() || !this.estadoCombate) {
      return;
    }

    // Detiene y elimina tweens y objetos de dibujo creados por el layout
    // anterior para no acumular graficos ni animaciones huerfanas.
    this.tweens.killAll();
    this.children.removeAll(true);

    // Reconstruye el coliseo, los sprites y el HUD para el tamano nuevo.
    this.construirLayout();

    // Vuelve a pintar el estado actual del combate con la nueva escala.
    this.renderizar();

    // Si el combate ya habia terminado, re-muestra la pantalla final para que
    // no desaparezca tras el reacomodo.
    if (this.resultado !== null) {
      this.pantallaFinalMostrada = false;
      this.mostrarPantallaFinal();
    }
  }

  // Limpieza al apagar la escena: desengancha el listener de 'resize' para no
  // dejar manejadores colgados cuando se navega a otra escena.
  alApagar() {
    if (this.scale) {
      this.scale.off("resize", this.alRedimensionar, this);
    }
  }

  // -------------------------------------------------------------------------
  // Escala y conversion de coordenadas arena logica (800x600) -> pantalla
  // -------------------------------------------------------------------------

  // Indica si el juego esta en orientacion vertical (canvas mas alto que ancho),
  // caso prioritario porque el publico juega desde el celular tras escanear un
  // QR. Determina el layout del HUD (dos filas arriba en vertical) y como se
  // reparte el espacio para que el coliseo ocupe lo maximo posible.
  esVertical() {
    return this.scale.height > this.scale.width;
  }

  // Alto en pixeles que reserva el HUD en la parte superior. En vertical son dos
  // filas (barras de vida en la primera, nombres + temporizador en la segunda),
  // asi que ocupa mas alto; en horizontal basta con una franja.
  altoHud() {
    return this.esVertical() ? 132 : 88;
  }

  // Calcula el factor de escala y los offsets para centrar la arena logica
  // (800x600) dentro del canvas real sin deformarla. Deja margen arriba para
  // el HUD de barras de vida. Todas las medidas salen de this.scale.width /
  // this.scale.height, de modo que el coliseo ocupa el mayor espacio posible en
  // ambas orientaciones.
  calcularEscalaArena() {
    const { width, height } = this.scale;
    const anchoLogico = ARENA_POR_DEFECTO.ancho;
    const altoLogico = ARENA_POR_DEFECTO.alto;

    // Margen superior reservado para el HUD (dos filas en vertical, una en
    // horizontal) y un pequeno margen alrededor de la arena.
    const margenSuperior = this.altoHud();
    const margen = 12;
    const anchoDisponible = width - margen * 2;
    const altoDisponible = height - margenSuperior - margen;

    // Se usa el menor factor para que la arena entre completa y sin deformarse;
    // asi ocupa todo el ancho en vertical y todo el alto disponible en horizontal.
    this.escala = Math.min(anchoDisponible / anchoLogico, altoDisponible / altoLogico);

    const anchoArena = anchoLogico * this.escala;
    const altoArena = altoLogico * this.escala;
    this.offsetX = (width - anchoArena) / 2;
    this.offsetY = margenSuperior + (altoDisponible - altoArena) / 2;

    // Centro y radio del piso circular (inscrito en el rectangulo logico).
    this.centroX = this.aPantallaX(anchoLogico / 2);
    this.centroY = this.aPantallaY(altoLogico / 2);
    // El radio del piso ocupa casi todo el alto logico disponible.
    this.radioArena = (altoLogico / 2) * this.escala * 0.98;
  }

  // Convierte una coordenada X de la arena logica (0..800) al canvas real.
  aPantallaX(xLogica) {
    return this.offsetX + xLogica * this.escala;
  }

  // Convierte una coordenada Y de la arena logica (0..600) al canvas real.
  aPantallaY(yLogica) {
    return this.offsetY + yLogica * this.escala;
  }

  // -------------------------------------------------------------------------
  // Texturas de particulas generadas en tiempo de ejecucion (sin imagenes)
  // -------------------------------------------------------------------------

  // Genera texturas pequenas (puntos circulares difuminados) para los emisores
  // de particulas. Phaser 3 necesita una textura para las particulas; aqui se
  // crean dibujandolas con Graphics, de modo que no hace falta ningun asset.
  generarTexturasParticulas() {
    // Punto blanco suave de 16x16 usado como base y teñido por color de emisor.
    if (!this.textures.exists("particula-punto")) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      // Degradado manual: circulos concentricos cada vez mas transparentes.
      for (let i = 8; i > 0; i--) {
        const alpha = i / 8;
        g.fillStyle(0xffffff, alpha * 0.35);
        g.fillCircle(8, 8, i);
      }
      g.generateTexture("particula-punto", 16, 16);
      g.destroy();
    }

    // Chispa alargada (pequeno rectangulo redondeado) para el fuego.
    if (!this.textures.exists("particula-chispa")) {
      const g = this.make.graphics({ x: 0, y: 0, add: false });
      g.fillStyle(0xffffff, 1);
      g.fillCircle(4, 4, 4);
      g.generateTexture("particula-chispa", 8, 8);
      g.destroy();
    }
  }

  // -------------------------------------------------------------------------
  // Dibujo del coliseo (fondo estatico + elementos animados)
  // -------------------------------------------------------------------------

  // Dibuja el coliseo completo: gradas con publico, piso circular de baldosas,
  // anillo de borde, runas centrales, 4 antorchas y la vineta oscura.
  dibujarColiseo() {
    this.dibujarGradasYPublico();
    this.dibujarPiso();
    this.dibujarAnillo();
    this.dibujarRunas();
    this.dibujarAntorchas();
    this.dibujarVineta();
  }

  // Gradas: anillo oscuro alrededor del piso con el publico como puntos que
  // parpadean/oscilan suavemente (animados con tweens de alpha).
  dibujarGradasYPublico() {
    // Fondo general de gradas (cubre todo el canvas por debajo de la arena).
    const fondo = this.add.graphics().setDepth(0);
    fondo.fillStyle(COLOR_GRADA, 1);
    fondo.fillRect(0, 0, this.scale.width, this.scale.height);

    // Anillo de gradas alrededor del piso (un par de arcos concentricos).
    const gradas = this.add.graphics().setDepth(0);
    for (let i = 0; i < 3; i++) {
      const radio = this.radioArena + 12 + i * 10 * this.escala;
      const tono = 0x221c30 + i * 0x060608;
      gradas.lineStyle(Math.max(6, 8 * this.escala), tono, 1);
      gradas.strokeCircle(this.centroX, this.centroY, radio);
    }

    // Publico: puntos de colores calidos repartidos en el anillo de gradas.
    const coloresPublico = [0xffd27f, 0xff9e7a, 0xbfae8f, 0x9fb0d8, 0xd8a0ff];
    const cantidad = 120;
    for (let i = 0; i < cantidad; i++) {
      const angulo = (i / cantidad) * Math.PI * 2;
      // Dos filas de publico a distinto radio.
      const fila = i % 2;
      const radio = this.radioArena + (20 + fila * 14) * this.escala;
      const x = this.centroX + Math.cos(angulo) * radio;
      const y = this.centroY + Math.sin(angulo) * radio * 0.82; // elipse leve
      const color = coloresPublico[i % coloresPublico.length];
      const punto = this.add
        .circle(x, y, Math.max(1.5, 2.2 * this.escala), color)
        .setDepth(1)
        .setAlpha(0.55);
      // Parpadeo/oscilacion sutil del publico (animacion con tween).
      this.tweens.add({
        targets: punto,
        alpha: { from: 0.35, to: 0.9 },
        duration: 700 + Math.random() * 1200,
        yoyo: true,
        repeat: -1,
        delay: Math.random() * 1500,
      });
    }
  }

  // Piso circular de baldosas de piedra: relleno base + patron de baldosas
  // (lineas radiales y anillos concentricos) para dar textura de piedra.
  dibujarPiso() {
    const piso = this.add.graphics().setDepth(2);

    // Relleno base del piso.
    piso.fillStyle(COLOR_PISO, 1);
    piso.fillCircle(this.centroX, this.centroY, this.radioArena);

    // Anillos concentricos alternando tono (baldosas en forma de aros).
    const aros = 6;
    for (let i = 1; i <= aros; i++) {
      const radio = (this.radioArena * i) / aros;
      const color = i % 2 === 0 ? COLOR_PISO_CLARO : COLOR_PISO;
      piso.fillStyle(color, 0.25);
      piso.lineStyle(Math.max(1, 1.5 * this.escala), COLOR_JUNTA, 0.5);
      piso.strokeCircle(this.centroX, this.centroY, radio);
    }

    // Lineas radiales (juntas entre baldosas) desde el centro hacia el borde.
    const radiales = 16;
    piso.lineStyle(Math.max(1, 1 * this.escala), COLOR_JUNTA, 0.4);
    for (let i = 0; i < radiales; i++) {
      const angulo = (i / radiales) * Math.PI * 2;
      piso.beginPath();
      piso.moveTo(this.centroX, this.centroY);
      piso.lineTo(
        this.centroX + Math.cos(angulo) * this.radioArena,
        this.centroY + Math.sin(angulo) * this.radioArena,
      );
      piso.strokePath();
    }
  }

  // Anillo de borde grueso alrededor del piso (piedra labrada), con un reflejo
  // interior mas claro para dar relieve.
  dibujarAnillo() {
    const anillo = this.add.graphics().setDepth(3);
    anillo.lineStyle(Math.max(6, 10 * this.escala), COLOR_ANILLO, 1);
    anillo.strokeCircle(this.centroX, this.centroY, this.radioArena);
    anillo.lineStyle(Math.max(2, 3 * this.escala), COLOR_ANILLO_INT, 0.8);
    anillo.strokeCircle(this.centroX, this.centroY, this.radioArena - 6 * this.escala);
  }

  // Runas brillantes en el centro de la arena: un circulo de glifos simples
  // (lineas y pequenos rombos) que laten con un tween de alpha.
  dibujarRunas() {
    const runas = this.add.graphics().setDepth(4);
    const radioRunas = this.radioArena * 0.28;

    runas.lineStyle(Math.max(1.5, 2 * this.escala), COLOR_RUNA, 0.9);
    // Circulo exterior de runas.
    runas.strokeCircle(this.centroX, this.centroY, radioRunas);
    runas.strokeCircle(this.centroX, this.centroY, radioRunas * 0.6);

    // Glifos: pequenos rombos repartidos en el circulo.
    const glifos = 8;
    for (let i = 0; i < glifos; i++) {
      const angulo = (i / glifos) * Math.PI * 2;
      const x = this.centroX + Math.cos(angulo) * radioRunas;
      const y = this.centroY + Math.sin(angulo) * radioRunas;
      const r = 4 * this.escala;
      runas.beginPath();
      runas.moveTo(x, y - r);
      runas.lineTo(x + r, y);
      runas.lineTo(x, y + r);
      runas.lineTo(x - r, y);
      runas.closePath();
      runas.strokePath();
    }

    // Latido luminoso de las runas (animacion con tween de alpha).
    this.tweens.add({
      targets: runas,
      alpha: { from: 0.45, to: 1 },
      duration: 1600,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  // Cuatro antorchas en las esquinas del cuadrado inscrito, cada una con un
  // emisor de particulas de fuego (chispas que suben y se desvanecen).
  dibujarAntorchas() {
    // Posiciones de las antorchas: en diagonal respecto al centro.
    const d = this.radioArena * 0.72;
    const posiciones = [
      { x: this.centroX - d, y: this.centroY - d * 0.82 },
      { x: this.centroX + d, y: this.centroY - d * 0.82 },
      { x: this.centroX - d, y: this.centroY + d * 0.82 },
      { x: this.centroX + d, y: this.centroY + d * 0.82 },
    ];

    for (const p of posiciones) {
      // Base/pebetero de la antorcha (piedra).
      const base = this.add.graphics().setDepth(4);
      base.fillStyle(0x2a2118, 1);
      base.fillCircle(p.x, p.y, 7 * this.escala);
      base.lineStyle(Math.max(1, 1.5 * this.escala), COLOR_ANILLO_INT, 1);
      base.strokeCircle(p.x, p.y, 7 * this.escala);

      // Emisor de fuego: chispas calidas que suben y se encogen.
      const fuego = this.add.particles(p.x, p.y, "particula-chispa", {
        speed: { min: 10 * this.escala, max: 35 * this.escala },
        angle: { min: 250, max: 290 }, // hacia arriba con dispersion
        scale: { start: 1.6 * this.escala, end: 0 },
        alpha: { start: 0.9, end: 0 },
        lifespan: { min: 450, max: 900 },
        frequency: 40,
        quantity: 2,
        tint: [0xffe27a, 0xffb347, 0xff6a2a],
        blendMode: "ADD",
      });
      fuego.setDepth(5);
      // Resplandor calido fijo bajo la llama.
      this.add
        .circle(p.x, p.y, 10 * this.escala, 0xff8c2a, 0.25)
        .setDepth(4)
        .setBlendMode(Phaser.BlendModes.ADD);
    }
  }

  // Vineta oscura: anillo radial de oscuridad en los bordes del canvas para
  // concentrar la mirada en el centro de la arena. Se dibuja como varios aros
  // negros translucidos cada vez mas opacos hacia el exterior.
  dibujarVineta() {
    const vineta = this.add.graphics().setDepth(7);
    const maxR = Math.hypot(this.scale.width, this.scale.height) / 2;
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const aros = 10;
    for (let i = 0; i < aros; i++) {
      const t = i / aros;
      const radio = maxR * (0.55 + 0.45 * t);
      vineta.lineStyle(maxR * 0.1, 0x000000, t * 0.12);
      vineta.strokeCircle(cx, cy, radio);
    }
  }

  // -------------------------------------------------------------------------
  // Sprites de los campeones
  // -------------------------------------------------------------------------

  // Crea los objetos graficos persistentes de cada campeon.
  crearSprites() {
    this.sprites.A = this.crearSpriteCampeon(this.estadoCombate.campeonA);
    this.sprites.B = this.crearSpriteCampeon(this.estadoCombate.campeonB);
  }

  // Construye el grupo de objetos de un campeon: sombra, aura, cuerpo y la
  // burbuja de escudo (oculta por defecto). Devuelve sus referencias para
  // poder reposicionarlos y animarlos cada frame.
  crearSpriteCampeon(campeon) {
    const radio = RADIO_CAMPEON * this.escala;
    const colorPrincipal = this.colorAEntero(campeon.colorPrincipal);
    const colorSecundario = this.colorAEntero(campeon.colorSecundario);

    // Sombra elipsoidal debajo del campeon (da sensacion de volumen).
    const sombra = this.add
      .ellipse(0, 0, radio * 2.2, radio * 0.9, 0x000000, 0.35)
      .setDepth(5);

    // Aura brillante con el color principal (circulo mas grande y translucido
    // en modo aditivo para que "brille"). Late con un tween suave.
    const aura = this.add
      .circle(0, 0, radio * 1.5, colorPrincipal, 0.28)
      .setDepth(5)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: aura,
      scale: { from: 0.9, to: 1.1 },
      alpha: { from: 0.18, to: 0.38 },
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    // Cuerpo del campeon: circulo con color principal (relleno) y color
    // secundario (borde). Es el objeto que se anima al respirar/recibir dano.
    const grosorBorde = Math.max(2, 3 * this.escala);
    const cuerpo = this.add
      .circle(0, 0, radio, colorPrincipal)
      .setStrokeStyle(grosorBorde, colorSecundario)
      .setDepth(6);

    // Animacion de respiracion: leve oscilacion de escala continua.
    this.tweens.add({
      targets: cuerpo,
      scale: { from: 0.97, to: 1.04 },
      duration: 900 + Math.random() * 300,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    // Burbuja de escudo (oculta hasta que el campeon active el escudo).
    const escudo = this.add
      .circle(0, 0, radio * 1.7, 0x8fd3ff, 0.25)
      .setStrokeStyle(Math.max(2, 2.5 * this.escala), 0xbfeaff, 0.8)
      .setDepth(7)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);

    return { sombra, aura, cuerpo, escudo, radio, colorPrincipal };
  }

  // -------------------------------------------------------------------------
  // HUD superior estilo juego de pelea
  // -------------------------------------------------------------------------

  // Crea las barras de vida grandes (A a la izquierda, B a la derecha) con el
  // nombre y color de cada campeon, y el temporizador al centro.
  //
  // En vertical el HUD se organiza en dos filas arriba: la primera fila con las
  // dos barras de vida (ocupando casi todo el ancho) y el temporizador al
  // centro, y la segunda fila con los nombres. En horizontal mantiene el layout
  // clasico (barras en las esquinas con el nombre debajo y el temporizador al
  // centro). Todo se calcula a partir de this.scale para adaptarse al tamano.
  crearHud() {
    const { width } = this.scale;
    const vertical = this.esVertical();

    this.hud.A = this.crearBarraHud(this.estadoCombate.campeonA, "izquierda");
    this.hud.B = this.crearBarraHud(this.estadoCombate.campeonB, "derecha");

    // Temporizador grande al centro, estilo marcador. En vertical baja a la
    // segunda fila del HUD (entre los nombres); en horizontal va arriba al centro.
    const yTemporizador = vertical ? 86 : 30;
    this.textoTemporizador = this.add
      .text(width / 2, yTemporizador, "90", {
        fontFamily: "Georgia, serif",
        fontSize: vertical ? "30px" : "34px",
        fontStyle: "bold",
        color: COLOR_TEXTO,
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setResolution(this.resolucionTexto())
      .setDepth(20);
  }

  // Crea una barra de vida grande en la esquina superior indicada. El relleno
  // de la barra A se vacia hacia la izquierda y el de la B hacia la derecha
  // (como en los juegos de pelea), de modo que ambos "bajan" hacia el centro.
  // El ancho, la posicion y la fila del nombre se calculan a partir de
  // this.scale para que el HUD quepa en ambas orientaciones.
  crearBarraHud(campeon, lado) {
    const { width } = this.scale;
    const vertical = this.esVertical();

    // En vertical las barras son mas anchas (dejando un hueco central para el
    // temporizador) y los nombres bajan a una segunda fila comun del HUD.
    const anchoBarra = vertical
      ? Math.min(width * 0.44, 320)
      : Math.min(width * 0.4, 340);
    const alto = vertical ? 22 : 26;
    const margen = 16;
    const y = 24;
    const colorPrincipal = this.colorAEntero(campeon.colorPrincipal);

    // Esquina X de la barra (origen a la izquierda del riel).
    const x = lado === "izquierda" ? margen : width - margen - anchoBarra;

    // Marco exterior.
    const marco = this.add
      .rectangle(x - 2, y - 2, anchoBarra + 4, alto + 4, COLOR_HUD_MARCO)
      .setOrigin(0, 0)
      .setDepth(18);

    // Riel (fondo de la barra).
    this.add
      .rectangle(x, y, anchoBarra, alto, COLOR_HUD_RIEL)
      .setOrigin(0, 0)
      .setDepth(19);

    // Relleno de vida. Para el lado derecho se ancla a la derecha para que
    // se vacie hacia el centro.
    const relleno = this.add
      .rectangle(
        lado === "izquierda" ? x : x + anchoBarra,
        y,
        anchoBarra,
        alto,
        COLOR_VIDA,
      )
      .setOrigin(lado === "izquierda" ? 0 : 1, 0)
      .setDepth(19);

    // Segunda fila del HUD: nombres bajo las barras. En vertical se separan un
    // poco mas para que no choquen con el temporizador central.
    const yNombre = y + alto + 6;

    // Franja de color del campeon (identificador junto a su nombre).
    const franjaX = lado === "izquierda" ? x : x + anchoBarra - 10;
    this.add
      .rectangle(franjaX, yNombre, 10, 14, colorPrincipal)
      .setOrigin(0, 0)
      .setDepth(19);

    // Nombre del campeon bajo la barra, alineado hacia el centro. En vertical se
    // acorta el ancho de ajuste para que no se solape con el temporizador.
    const nombre = this.add
      .text(
        lado === "izquierda" ? x + 16 : x + anchoBarra - 16,
        yNombre,
        campeon.nombre || "Campeon",
        {
          fontFamily: "sans-serif",
          fontSize: "16px",
          fontStyle: "bold",
          color: COLOR_TEXTO,
          stroke: "#000000",
          strokeThickness: 3,
          wordWrap: { width: anchoBarra - 20 },
        },
      )
      .setOrigin(lado === "izquierda" ? 0 : 1, 0)
      .setResolution(this.resolucionTexto())
      .setDepth(19);

    return { marco, relleno, nombre, anchoBarra, lado };
  }

  // -------------------------------------------------------------------------
  // Game loop
  // -------------------------------------------------------------------------

  // Game loop de Phaser con acumulador de paso fijo (50 ms). Avanza la
  // simulacion en pasos deterministas, procesa los eventos de cada tick para
  // disparar efectos visuales y luego renderiza el estado actual.
  update(time, delta) {
    if (!this.estadoCombate) {
      return;
    }

    if (!this.combateTerminado()) {
      this.acumulador += delta / 1000;

      while (this.acumulador >= PASO_FIJO && !this.combateTerminado()) {
        const paso = actualizarTick(this.estadoCombate, PASO_FIJO);
        this.estadoCombate = paso.estado;

        // Acumula los eventos del tick para la narracion (8.4c).
        this.eventosNarracion.push(...paso.eventos);

        // Dispara los efectos visuales de cada evento de este tick.
        this.procesarEventos(paso.eventos);

        this.acumulador -= PASO_FIJO;
        this.evaluarFinCombate();
      }
    }

    // Phaser dibuja el estado actual (posiciones, auras, barras, temporizador).
    this.renderizar(time);
  }

  // -------------------------------------------------------------------------
  // Efectos visuales por evento de habilidad
  // -------------------------------------------------------------------------

  // Procesa la lista de eventos de un tick y lanza el efecto visual adecuado
  // para cada uno. Tambien anima el impacto en el campeon golpeado y muestra
  // numeros de dano flotantes.
  procesarEventos(eventos) {
    for (const ev of eventos) {
      const atacante = this.spritePorId(ev.campeon);
      const objetivo = this.spritePorId(ev.objetivo);
      const campeonAtacante = this.campeonEstadoPorId(ev.campeon);
      const campeonObjetivo = this.campeonEstadoPorId(ev.objetivo);

      const posAtacante = campeonAtacante ? this.posEnPantalla(campeonAtacante) : null;
      const posObjetivo = campeonObjetivo ? this.posEnPantalla(campeonObjetivo) : null;

      switch (ev.tipo) {
        case "escudo":
          // La burbuja se muestra mientras el estado de combate indique escudo
          // activo (se gestiona en renderizar); aqui solo un destello inicial.
          if (atacante && posAtacante) {
            this.destelloEscudo(posAtacante, atacante.radio);
          }
          break;

        case "curacion":
          if (posAtacante) {
            this.efectoCuracion(posAtacante, atacante ? atacante.radio : 20);
          }
          break;

        case "embestida":
          if (posAtacante && posObjetivo) {
            this.efectoEmbestida(posAtacante, posObjetivo, atacante);
          }
          this.impactoDano(ev, posObjetivo);
          break;

        case "area":
          if (posAtacante) {
            this.efectoArea(posAtacante);
          }
          this.impactoDano(ev, posObjetivo);
          break;

        case "ataque":
        default:
          // El proyectil se distingue por el inicio de su detalle.
          if (typeof ev.detalle === "string" && ev.detalle.startsWith("proyectil") && posAtacante && posObjetivo) {
            this.efectoProyectil(posAtacante, posObjetivo, atacante);
          }
          this.impactoDano(ev, posObjetivo);
          break;
      }

      // Critico: sacudida de camara (ademas del numero de dano amarillo grande).
      if (ev.critico) {
        this.cameras.main.shake(180, 0.012);
      }
    }
  }

  // Dispara la animacion de impacto en el objetivo (parpadeo blanco + retroceso)
  // y el numero de dano flotante, si el evento representa un golpe con dano.
  impactoDano(ev, posObjetivo) {
    // Extrae la cantidad de dano del detalle ("... inflige N de dano").
    const dano = this.extraerDano(ev.detalle);
    if (dano == null || !posObjetivo) {
      return;
    }

    const objetivo = this.spritePorId(ev.objetivo);
    if (objetivo) {
      this.animarGolpe(objetivo, posObjetivo);
    }
    this.numeroDano(posObjetivo, dano, Boolean(ev.critico));
  }

  // Parpadeo blanco breve y pequeno retroceso del campeon golpeado. El retroceso
  // se aplica como un desplazamiento temporal del cuerpo/aura/sombra que vuelve
  // solo a su sitio (renderizar reposiciona cada frame, asi que usamos un tween
  // de offset guardado en el sprite).
  animarGolpe(sprite, posObjetivo) {
    // Parpadeo blanco: se tiñe el cuerpo de blanco y vuelve a su color.
    sprite.cuerpo.setFillStyle(0xffffff);
    this.time.delayedCall(90, () => {
      if (sprite.cuerpo && sprite.cuerpo.active) {
        sprite.cuerpo.setFillStyle(sprite.colorPrincipal);
      }
    });

    // Retroceso: guarda un offset que renderizar() sumara a la posicion, y lo
    // anima de vuelta a cero con un tween.
    sprite.offsetGolpe = sprite.offsetGolpe || { x: 0, y: 0 };
    // Direccion del retroceso: alejarse del centro de la arena.
    const dx = posObjetivo.x - this.centroX;
    const dy = posObjetivo.y - this.centroY;
    const mag = Math.hypot(dx, dy) || 1;
    const fuerza = 10 * this.escala;
    sprite.offsetGolpe.x = (dx / mag) * fuerza;
    sprite.offsetGolpe.y = (dy / mag) * fuerza;
    this.tweens.add({
      targets: sprite.offsetGolpe,
      x: 0,
      y: 0,
      duration: 220,
      ease: "Quad.easeOut",
    });
  }

  // Numero de dano flotante: sube y se desvanece. Amarillo y mas grande si el
  // golpe es critico; blanco y mediano en caso normal.
  numeroDano(pos, dano, critico) {
    const texto = this.add
      .text(pos.x, pos.y - 20, String(dano), {
        fontFamily: "Arial Black, sans-serif",
        fontSize: critico ? "30px" : "20px",
        fontStyle: "bold",
        color: critico ? "#ffdd33" : "#ffffff",
        stroke: "#000000",
        strokeThickness: critico ? 5 : 3,
      })
      .setOrigin(0.5)
      .setResolution(this.resolucionTexto())
      .setDepth(21);

    if (critico) {
      // El critico aparece con un pequeno "pop" de escala.
      texto.setScale(0.6);
      this.tweens.add({ targets: texto, scale: 1.2, duration: 150, yoyo: true });
    }

    this.tweens.add({
      targets: texto,
      y: pos.y - 60,
      alpha: 0,
      duration: 800,
      ease: "Quad.easeOut",
      onComplete: () => texto.destroy(),
    });
  }

  // Proyectil: bola de energia con estela que viaja del atacante al objetivo.
  efectoProyectil(origen, destino, spriteAtacante) {
    const color = spriteAtacante ? spriteAtacante.colorPrincipal : 0x5ad1ff;
    const bola = this.add
      .circle(origen.x, origen.y, 7 * this.escala, color)
      .setDepth(8)
      .setBlendMode(Phaser.BlendModes.ADD);

    // Estela: emisor de particulas que sigue a la bola mientras viaja.
    const estela = this.add.particles(0, 0, "particula-punto", {
      speed: 0,
      scale: { start: 1.1 * this.escala, end: 0 },
      alpha: { start: 0.8, end: 0 },
      lifespan: 260,
      frequency: 16,
      tint: color,
      blendMode: "ADD",
    });
    estela.setDepth(8);
    estela.startFollow(bola);

    const distancia = Phaser.Math.Distance.Between(origen.x, origen.y, destino.x, destino.y);
    const duracion = Math.max(120, (distancia / (600 * this.escala)) * 400);

    this.tweens.add({
      targets: bola,
      x: destino.x,
      y: destino.y,
      duration: duracion,
      ease: "Quad.easeIn",
      onComplete: () => {
        // Pequeno estallido al impactar y limpieza de la bola/estela.
        this.estallido(destino, color);
        estela.stop();
        this.time.delayedCall(280, () => estela.destroy());
        bola.destroy();
      },
    });
  }

  // Embestida: dash con rastro. Se dibuja una linea/trazo del atacante hacia el
  // objetivo que se desvanece, mas un emisor de rastro breve en el origen.
  efectoEmbestida(origen, destino, spriteAtacante) {
    const color = spriteAtacante ? spriteAtacante.colorPrincipal : 0xffffff;

    // Trazo del dash (linea gruesa que se desvanece).
    const trazo = this.add.graphics().setDepth(7).setBlendMode(Phaser.BlendModes.ADD);
    trazo.lineStyle(Math.max(4, 6 * this.escala), color, 0.8);
    trazo.beginPath();
    trazo.moveTo(origen.x, origen.y);
    trazo.lineTo(destino.x, destino.y);
    trazo.strokePath();
    this.tweens.add({
      targets: trazo,
      alpha: 0,
      duration: 300,
      onComplete: () => trazo.destroy(),
    });

    // Rastro de particulas a lo largo del recorrido.
    const rastro = this.add.particles(0, 0, "particula-punto", {
      x: { min: Math.min(origen.x, destino.x), max: Math.max(origen.x, destino.x) },
      y: { min: Math.min(origen.y, destino.y), max: Math.max(origen.y, destino.y) },
      speed: 0,
      scale: { start: 1.2 * this.escala, end: 0 },
      alpha: { start: 0.7, end: 0 },
      lifespan: 260,
      quantity: 10,
      tint: color,
      blendMode: "ADD",
    });
    rastro.setDepth(7);
    rastro.explode(14);
    this.time.delayedCall(320, () => rastro.destroy());
  }

  // Area: onda expansiva circular centrada en el atacante que crece y se
  // desvanece (anillo que se expande).
  efectoArea(centro) {
    const onda = this.add
      .circle(centro.x, centro.y, 6 * this.escala)
      .setStrokeStyle(Math.max(3, 4 * this.escala), 0xffa94d, 0.9)
      .setDepth(7)
      .setBlendMode(Phaser.BlendModes.ADD);
    onda.setFillStyle(0xffa94d, 0.12);

    this.tweens.add({
      targets: onda,
      scale: { from: 0.2, to: 7 },
      alpha: { from: 0.9, to: 0 },
      duration: 520,
      ease: "Quad.easeOut",
      onComplete: () => onda.destroy(),
    });
  }

  // Destello breve al activar el escudo (la burbuja persistente la gestiona
  // renderizar segun escudoActivo del estado de combate).
  destelloEscudo(centro, radio) {
    const destello = this.add
      .circle(centro.x, centro.y, radio * 1.8, 0xbfeaff, 0.5)
      .setDepth(8)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: destello,
      scale: { from: 0.6, to: 1.3 },
      alpha: { from: 0.6, to: 0 },
      duration: 360,
      onComplete: () => destello.destroy(),
    });
  }

  // Curacion: particulas verdes que suben desde el campeon y se desvanecen.
  efectoCuracion(centro, radio) {
    const verdes = this.add.particles(centro.x, centro.y, "particula-punto", {
      x: { min: -radio, max: radio },
      speed: { min: 20 * this.escala, max: 50 * this.escala },
      angle: { min: 250, max: 290 }, // hacia arriba
      scale: { start: 1.1 * this.escala, end: 0 },
      alpha: { start: 0.9, end: 0 },
      lifespan: 700,
      quantity: 14,
      tint: [0x7cf59a, 0x3ad17a, 0xd6ffe0],
      blendMode: "ADD",
    });
    verdes.setDepth(8);
    verdes.explode(16);
    this.time.delayedCall(760, () => verdes.destroy());
  }

  // Pequeno estallido radial de particulas al impactar un proyectil.
  estallido(centro, color) {
    const chispas = this.add.particles(centro.x, centro.y, "particula-punto", {
      speed: { min: 40 * this.escala, max: 120 * this.escala },
      scale: { start: 1.1 * this.escala, end: 0 },
      alpha: { start: 0.9, end: 0 },
      lifespan: 300,
      quantity: 12,
      tint: color,
      blendMode: "ADD",
    });
    chispas.setDepth(8);
    chispas.explode(12);
    this.time.delayedCall(340, () => chispas.destroy());
  }

  // -------------------------------------------------------------------------
  // Fin del combate
  // -------------------------------------------------------------------------

  // Comprueba las condiciones de fin del combate (vida en cero o tiempo maximo)
  // y fija this.resultado / this.idGanador cuando corresponde.
  evaluarFinCombate() {
    const estado = this.estadoCombate;

    // Fin por vida en cero: combat.js NO emite un evento 'muerte', asi que lo
    // sintetizamos aqui y lo anadimos al historial de narracion para que el
    // filtro de prioridad (tarea 8.4c) pueda incluirlo como evento clave.
    if (estado.campeonA.hp <= 0 || estado.campeonB.hp <= 0) {
      const desenlace = determinarGanador(estado);
      const caido = estado.campeonA.hp <= 0 ? estado.campeonA : estado.campeonB;
      this.eventosNarracion.push({
        tipo: "muerte",
        campeon: caido.id,
        objetivo: null,
        detalle: `${caido.nombre || "Un campeon"} cae derrotado`,
      });
      this.fijarResultado(desenlace.resultado, desenlace.idGanador);
      return;
    }

    // Fin por tiempo agotado (90 s): combat.js tampoco emite 'tiempo_agotado',
    // asi que tambien lo sintetizamos para el narrador y resolvemos por el mayor
    // porcentaje de vida restante.
    if (estado.tiempoTranscurrido >= estado.duracionMaxima) {
      this.eventosNarracion.push({
        tipo: "tiempo_agotado",
        campeon: null,
        objetivo: null,
        detalle: "se agota el tiempo del combate",
      });

      const porcentajeA = estado.campeonA.hp / estado.campeonA.vidaMaxima;
      const porcentajeB = estado.campeonB.hp / estado.campeonB.vidaMaxima;
      if (porcentajeA > porcentajeB) {
        this.fijarResultado("ganador", estado.campeonA.id);
      } else if (porcentajeB > porcentajeA) {
        this.fijarResultado("ganador", estado.campeonB.id);
      } else {
        this.fijarResultado("empate", null);
      }
    }
  }

  // Fija el resultado del combate (una sola vez) y lanza la pantalla final.
  fijarResultado(resultado, idGanador) {
    if (this.resultado !== null) {
      return;
    }
    this.resultado = resultado;
    this.idGanador = idGanador;
    this.mostrarPantallaFinal();

    // Lanza el flujo de fin de combate (registro de resultado, narracion y
    // navegacion al ranking) una sola vez. Es asincrono y tolerante a fallos
    // de red: pase lo que pase, la escena termina navegando a RankingScene.
    this.procesarFinCombate();
  }

  // Indica si el combate ya tiene un resultado definido (ha terminado).
  combateTerminado() {
    return this.resultado !== null;
  }

  // Pantalla final: oscurece el fondo y muestra "¡VICTORIA!" con el nombre del
  // ganador (o "¡EMPATE!") con animacion de entrada. El panel tiene fondo propio
  // para no quedar "flotando" sobre la escena.
  mostrarPantallaFinal() {
    if (this.pantallaFinalMostrada) {
      return;
    }
    this.pantallaFinalMostrada = true;

    const { width, height } = this.scale;

    // Velo oscuro semitransparente sobre toda la escena (fade de entrada).
    const velo = this.add
      .rectangle(0, 0, width, height, 0x000000, 0)
      .setOrigin(0, 0)
      .setDepth(30);
    this.tweens.add({ targets: velo, fillAlpha: 0.65, duration: 500 });

    // Panel central con fondo para sostener el texto (no queda sin fondo). Es
    // mas alto que antes porque ademas del resultado alberga la narracion de la
    // batalla (tarea 8.4c) y el boton para continuar al ranking.
    const panelAncho = Math.min(width - 40, 560);
    const panelAlto = Math.min(height - 40, 360);
    const centroPanelY = height / 2;
    const bordePanelSuperior = centroPanelY - panelAlto / 2;
    const panel = this.add
      .rectangle(width / 2, centroPanelY, panelAncho, panelAlto, 0x11162b, 0.95)
      .setStrokeStyle(3, 0xffd15a)
      .setDepth(31)
      .setScale(0.6)
      .setAlpha(0);
    this.tweens.add({
      targets: panel,
      scale: 1,
      alpha: 1,
      duration: 450,
      ease: "Back.easeOut",
    });

    // Titulo: "¡VICTORIA!" o "¡EMPATE!".
    const esEmpate = this.resultado !== "ganador";
    const titulo = this.add
      .text(width / 2, bordePanelSuperior + 42, esEmpate ? "¡EMPATE!" : "¡VICTORIA!", {
        fontFamily: "Georgia, serif",
        fontSize: "40px",
        fontStyle: "bold",
        color: esEmpate ? "#ffd15a" : "#5ad17a",
        stroke: "#000000",
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setResolution(this.resolucionTexto())
      .setDepth(32)
      .setAlpha(0)
      .setScale(0.5);
    this.tweens.add({
      targets: titulo,
      alpha: 1,
      scale: 1,
      duration: 500,
      delay: 150,
      ease: "Back.easeOut",
    });

    // Subtitulo: nombre del ganador (o texto de empate).
    let subtexto = "La batalla termina en tablas";
    if (!esEmpate && this.idGanador != null) {
      const ganador = this.campeonPorId(this.idGanador);
      const nombre = ganador && ganador.nombre ? ganador.nombre : "Campeon";
      subtexto = `Gana ${nombre}`;
    }
    const sub = this.add
      .text(width / 2, bordePanelSuperior + 82, subtexto, {
        fontFamily: "sans-serif",
        fontSize: "20px",
        fontStyle: "bold",
        color: COLOR_TEXTO,
        stroke: "#000000",
        strokeThickness: 3,
        align: "center",
        wordWrap: { width: panelAncho - 40 },
      })
      .setOrigin(0.5)
      .setResolution(this.resolucionTexto())
      .setDepth(32)
      .setAlpha(0);
    this.tweens.add({ targets: sub, alpha: 1, duration: 500, delay: 450 });

    // Texto de narracion: arranca con un mensaje de "generando..." y se
    // reemplaza cuando /narraciones responde (o con un aviso si falla la red).
    this.textoNarracion = this.add
      .text(width / 2, centroPanelY + 24, "Narrando la batalla en la nube...", {
        fontFamily: "sans-serif",
        fontSize: "16px",
        color: COLOR_TEXTO_TENUE,
        align: "center",
        lineSpacing: 4,
        wordWrap: { width: panelAncho - 48 },
      })
      .setOrigin(0.5)
      .setResolution(this.resolucionTexto())
      .setDepth(32)
      .setAlpha(0);
    this.tweens.add({ targets: this.textoNarracion, alpha: 1, duration: 500, delay: 650 });

    // Boton para continuar manualmente al ranking (ademas de la navegacion
    // automatica que dispara procesarFinCombate al terminar el flujo).
    this.crearBotonRanking(width / 2, bordePanelSuperior + panelAlto - 32, panelAncho);
  }

  // Crea un boton "Ver Salon de las Leyendas" dentro de la pantalla final que
  // navega a RankingScene al pulsarlo. La navegacion tambien ocurre de forma
  // automatica al completar el flujo de fin de combate.
  crearBotonRanking(x, y, panelAncho) {
    const anchoBoton = Math.min(panelAncho - 60, 280);
    const altoBoton = 44;

    const fondo = this.add
      .rectangle(x, y, anchoBoton, altoBoton, 0x4f6bff, 0.95)
      .setStrokeStyle(2, 0xffd15a)
      .setDepth(33)
      .setAlpha(0)
      .setInteractive({ useHandCursor: true });

    const etiqueta = this.add
      .text(x, y, "Ver Salón de las Leyendas", {
        fontFamily: "sans-serif",
        fontSize: "17px",
        fontStyle: "bold",
        color: COLOR_TEXTO,
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setResolution(this.resolucionTexto())
      .setDepth(34)
      .setAlpha(0);

    this.tweens.add({ targets: [fondo, etiqueta], alpha: 1, duration: 400, delay: 800 });

    // Al pulsar, navega inmediatamente al ranking.
    fondo.on("pointerup", () => this.irAlRanking());
  }

  // -------------------------------------------------------------------------
  // Flujo de fin de combate (tarea 8.4c): resultado, narracion y navegacion
  // -------------------------------------------------------------------------

  // Orquesta el cierre del combate una sola vez: registra el resultado,
  // selecciona los eventos relevantes, pide la narracion y navega al ranking.
  // Todo el flujo es tolerante a fallos de red: si cualquier llamada falla, se
  // muestra una indicacion y la escena navega igualmente a RankingScene
  // (Requisito 17.4), sin cerrar la aplicacion.
  async procesarFinCombate() {
    // Protege contra reentradas (solo se ejecuta una vez por combate).
    if (this.finProcesado) {
      return;
    }
    this.finProcesado = true;

    // 1. Registrar el resultado (ids como texto) en POST /resultados.
    await this.registrarResultado();

    // 2. Seleccionar hasta 15 eventos relevantes y pedir la narracion.
    const eventos = this.seleccionarEventosRelevantes(this.eventosNarracion, 15);
    const narracion = await this.obtenerNarracion(eventos);

    // 3. Mostrar la narracion devuelta (o la de respaldo) en la pantalla final.
    this.mostrarNarracion(narracion);

    // 4. Navegar al ranking tras una breve pausa para que el jugador lea el
    //    resultado y la narracion (la navegacion es idempotente).
    this.time.delayedCall(6000, () => this.irAlRanking());
  }

  // Llama a POST /resultados con el resultado del combate. El contrato de este
  // endpoint recibe campeonA y campeonB como IDS (texto), mas el resultado y,
  // cuando hay ganador, el idGanador. Un empate no envia idGanador. Los errores
  // de red o HTTP no detienen el flujo: se registran y se continua.
  async registrarResultado() {
    // Cuerpo con los IDS de ambos campeones (texto), no los objetos completos.
    const cuerpo = {
      campeonA: this.campeonA ? this.campeonA.id : null,
      campeonB: this.campeonB ? this.campeonB.id : null,
      resultado: this.resultado,
    };
    // Solo se adjunta idGanador cuando hay un ganador declarado.
    if (this.resultado === "ganador" && this.idGanador != null) {
      cuerpo.idGanador = this.idGanador;
    }

    try {
      const respuesta = await fetch(`${API_URL}/resultados`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      // Un no-2xx no es fatal para el jugador: se registra y se continua.
      if (!respuesta.ok) {
        console.warn(`POST /resultados respondio ${respuesta.status}`);
      }
    } catch (error) {
      // Error de red: no cerrar la app; el flujo continua hacia la narracion.
      console.warn("No se pudo registrar el resultado:", error);
    }
  }

  // Selecciona hasta 'maximo' eventos relevantes de la lista completa del
  // combate, manteniendo el ORDEN CRONOLOGICO y priorizando por tipo cuando hay
  // mas de 'maximo'. Prioridad (de mayor a menor): muerte -> tiempo_agotado ->
  // habilidades especiales (embestida/escudo/curacion/area) -> proyectiles ->
  // golpes con dano > 80. Los eventos no relevantes (p. ej. ataques basicos con
  // dano <= 80) se descartan. Si hay menos relevantes que 'maximo', se envian
  // todos. Devuelve los eventos elegidos en su orden cronologico original.
  seleccionarEventosRelevantes(eventos, maximo) {
    const lista = Array.isArray(eventos) ? eventos : [];

    // Anota cada evento relevante con su indice original (para reordenar al
    // final de forma cronologica) y su prioridad (numerica, menor = mas alta).
    const anotados = [];
    lista.forEach((ev, indice) => {
      const prioridad = this.prioridadEvento(ev);
      if (prioridad !== null) {
        anotados.push({ ev, indice, prioridad });
      }
    });

    // Si caben todos los relevantes, se devuelven en orden cronologico.
    if (anotados.length <= maximo) {
      return anotados
        .sort((a, b) => a.indice - b.indice)
        .map((item) => item.ev);
    }

    // Hay mas relevantes que el maximo: se ordena por prioridad (desc) y, a
    // igualdad de prioridad, por orden cronologico; se toman los 'maximo'
    // primeros y luego se restablece el orden cronologico para el narrador.
    return anotados
      .sort((a, b) => {
        if (a.prioridad !== b.prioridad) {
          return a.prioridad - b.prioridad;
        }
        return a.indice - b.indice;
      })
      .slice(0, maximo)
      .sort((a, b) => a.indice - b.indice)
      .map((item) => item.ev);
  }

  // Devuelve la prioridad numerica de un evento (0 = maxima) o null si el evento
  // no es relevante para la narracion. El orden sigue el diseño:
  //   0 muerte, 1 tiempo_agotado, 2 habilidades especiales, 3 proyectil,
  //   4 golpe con dano > 80. Un ataque basico con dano <= 80 no es relevante.
  prioridadEvento(ev) {
    if (!ev || typeof ev.tipo !== "string") {
      return null;
    }
    switch (ev.tipo) {
      case "muerte":
        return 0;
      case "tiempo_agotado":
        return 1;
      case "embestida":
      case "escudo":
      case "curacion":
      case "area":
        return 2;
      case "ataque": {
        // El proyectil se distingue por el inicio de su detalle (igual que en
        // los efectos visuales). Tiene mayor prioridad que un golpe fuerte.
        if (typeof ev.detalle === "string" && ev.detalle.startsWith("proyectil")) {
          return 3;
        }
        // Golpe mayor: ataque basico con dano > 80.
        const dano = this.extraerDano(ev.detalle);
        if (dano != null && dano > 80) {
          return 4;
        }
        return null;
      }
      default:
        return null;
    }
  }

  // Llama a POST /narraciones con los datos de la batalla y los eventos ya
  // filtrados. El contrato de este endpoint recibe campeonA y campeonB como
  // OBJETOS completos del campeon (con nombre e id), mas resultado, idGanador
  // (si aplica) y eventos. Devuelve el texto de narracion a mostrar. Si la red
  // falla, devuelve un mensaje de respaldo local para no cerrar la app.
  async obtenerNarracion(eventos) {
    // Cuerpo con los OBJETOS completos de ambos campeones (no solo sus ids).
    const cuerpo = {
      campeonA: this.campeonA,
      campeonB: this.campeonB,
      resultado: this.resultado,
      eventos,
    };
    if (this.resultado === "ganador" && this.idGanador != null) {
      cuerpo.idGanador = this.idGanador;
    }

    try {
      const respuesta = await fetch(`${API_URL}/narraciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });

      // La narracion siempre deberia responder 200 (con respaldo del backend),
      // pero cubrimos un no-2xx igualmente devolviendo un texto local.
      if (!respuesta.ok) {
        console.warn(`POST /narraciones respondio ${respuesta.status}`);
        return this.narracionLocalDeRespaldo();
      }

      const datos = await respuesta.json();
      // La respuesta tiene la forma { narracion, usadoRespaldo }. Se muestra el
      // texto venga del modelo o del respaldo del backend (usadoRespaldo true).
      if (datos && typeof datos.narracion === "string" && datos.narracion.trim()) {
        return datos.narracion.trim();
      }
      return this.narracionLocalDeRespaldo();
    } catch (error) {
      // Error de red: narracion de respaldo local; el flujo continua al ranking.
      console.warn("No se pudo obtener la narracion:", error);
      return this.narracionLocalDeRespaldo();
    }
  }

  // Construye una narracion de respaldo local (solo para fallos de red del
  // frontend, ya que el backend siempre devuelve 200 con su propio respaldo).
  narracionLocalDeRespaldo() {
    const nombreA = this.campeonA && this.campeonA.nombre ? this.campeonA.nombre : "Campeon A";
    const nombreB = this.campeonB && this.campeonB.nombre ? this.campeonB.nombre : "Campeon B";
    if (this.resultado === "empate") {
      return `La batalla entre ${nombreA} y ${nombreB} termino en empate tras una lucha memorable.`;
    }
    const ganador = this.campeonPorId(this.idGanador);
    const nombreGanador = ganador && ganador.nombre ? ganador.nombre : "El vencedor";
    return `La batalla entre ${nombreA} y ${nombreB} ha terminado. ${nombreGanador} se alzo con la victoria.`;
  }

  // Muestra el texto de narracion en la pantalla final, reemplazando el mensaje
  // de "generando...". Si el texto de narracion aun no existe (caso extremo),
  // no hace nada.
  mostrarNarracion(texto) {
    if (!this.textoNarracion || !this.textoNarracion.active) {
      return;
    }
    this.textoNarracion.setColor(COLOR_TEXTO);
    this.textoNarracion.setText(texto || this.narracionLocalDeRespaldo());
  }

  // Navega a RankingScene de forma idempotente (solo una vez). Se usa tanto por
  // la navegacion automatica tras la narracion como por el boton manual.
  irAlRanking() {
    if (this.navegacionIniciada) {
      return;
    }
    this.navegacionIniciada = true;
    this.scene.start("RankingScene");
  }

  // -------------------------------------------------------------------------
  // Render por frame
  // -------------------------------------------------------------------------

  // Renderiza el estado actual del combate: reposiciona los sprites de ambos
  // campeones (incluyendo el offset de retroceso), actualiza la burbuja de
  // escudo, refresca las barras del HUD y el temporizador.
  renderizar() {
    if (!this.estadoCombate) {
      return;
    }

    this.actualizarSprite(this.sprites.A, this.estadoCombate.campeonA);
    this.actualizarSprite(this.sprites.B, this.estadoCombate.campeonB);

    this.actualizarBarraHud(this.hud.A, this.estadoCombate.campeonA);
    this.actualizarBarraHud(this.hud.B, this.estadoCombate.campeonB);

    this.actualizarTemporizador();
  }

  // Posicion en pantalla del centro de un campeon (sin offset de retroceso).
  posEnPantalla(campeon) {
    return {
      x: this.aPantallaX(campeon.posicion.x),
      y: this.aPantallaY(campeon.posicion.y),
    };
  }

  // Reposiciona sombra, aura, cuerpo y burbuja de escudo de un campeon, sumando
  // el pequeno offset de retroceso cuando esta activo. Muestra la burbuja de
  // escudo mientras escudoActivo sea verdadero en el estado de combate.
  actualizarSprite(sprite, campeon) {
    if (!sprite) {
      return;
    }

    const base = this.posEnPantalla(campeon);
    const off = sprite.offsetGolpe || { x: 0, y: 0 };
    const x = base.x + off.x;
    const y = base.y + off.y;

    sprite.cuerpo.setPosition(x, y);
    sprite.aura.setPosition(x, y);
    // La sombra se queda en la posicion base (en el "suelo"), sin retroceso.
    sprite.sombra.setPosition(base.x, base.y + sprite.radio * 0.8);

    // Burbuja de escudo: visible solo mientras el escudo este activo.
    sprite.escudo.setPosition(x, y);
    sprite.escudo.setVisible(Boolean(campeon.escudoActivo));
  }

  // Actualiza el relleno de una barra del HUD segun el porcentaje de vida y
  // cambia su color (verde -> amarillo -> rojo) al bajar la vida.
  actualizarBarraHud(barra, campeon) {
    if (!barra) {
      return;
    }
    const porcentaje = Math.max(0, Math.min(1, campeon.hp / campeon.vidaMaxima));
    barra.relleno.width = barra.anchoBarra * porcentaje;

    let color = COLOR_VIDA;
    if (porcentaje < 0.3) {
      color = COLOR_VIDA_BAJA;
    } else if (porcentaje < 0.6) {
      color = COLOR_VIDA_MEDIA;
    }
    barra.relleno.setFillStyle(color);
  }

  // Actualiza el temporizador central con los segundos restantes (cuenta atras
  // desde la duracion maxima hasta 0).
  actualizarTemporizador() {
    if (!this.textoTemporizador) {
      return;
    }
    const restante = Math.max(
      0,
      Math.ceil(this.estadoCombate.duracionMaxima - this.estadoCombate.tiempoTranscurrido),
    );
    this.textoTemporizador.setText(String(restante));
  }

  // -------------------------------------------------------------------------
  // Utilidades
  // -------------------------------------------------------------------------

  // Devuelve el sprite ('A' o 'B') correspondiente al id de campeon dado.
  spritePorId(id) {
    if (this.estadoCombate && this.estadoCombate.campeonA.id === id) {
      return this.sprites.A;
    }
    if (this.estadoCombate && this.estadoCombate.campeonB.id === id) {
      return this.sprites.B;
    }
    return null;
  }

  // Devuelve el sub-estado de combate del campeon con el id dado.
  campeonEstadoPorId(id) {
    if (!this.estadoCombate) {
      return null;
    }
    if (this.estadoCombate.campeonA.id === id) {
      return this.estadoCombate.campeonA;
    }
    if (this.estadoCombate.campeonB.id === id) {
      return this.estadoCombate.campeonB;
    }
    return null;
  }

  // Resuelve el objeto campeon (el recibido de SeleccionScene) a partir de su id.
  campeonPorId(id) {
    if (this.campeonA && this.campeonA.id === id) {
      return this.campeonA;
    }
    if (this.campeonB && this.campeonB.id === id) {
      return this.campeonB;
    }
    return null;
  }

  // Extrae el numero de dano del texto del detalle ("... inflige N de dano").
  // Devuelve el entero o null si el detalle no contiene dano (escudo/curacion).
  extraerDano(detalle) {
    if (typeof detalle !== "string") {
      return null;
    }
    const m = detalle.match(/inflige\s+(\d+)\s+de dano/);
    return m ? parseInt(m[1], 10) : null;
  }

  // Resolucion de renderizado para los textos de Phaser. Al multiplicar por el
  // devicePixelRatio de la pantalla (x2) los textos se rasterizan a mayor
  // densidad, de modo que no se ven borrosos cuando el canvas se escala (sobre
  // todo en celulares de alta densidad, que es el caso prioritario). Se acota
  // para no disparar el uso de memoria en pantallas con DPR muy alto.
  resolucionTexto() {
    const dpr =
      typeof window !== "undefined" && window.devicePixelRatio
        ? window.devicePixelRatio
        : 1;
    return Math.min(4, dpr * 2);
  }

  // Convierte un color "#rrggbb" a entero para Phaser; si no es valido devuelve
  // un gris neutro (sanitizacion), igual que en SeleccionScene.
  colorAEntero(color) {
    if (typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color.trim())) {
      return parseInt(color.trim().slice(1), 16);
    }
    return 0x6b7280;
  }

  // Muestra un mensaje de error breve y vuelve a la seleccion si faltan los
  // campeones necesarios para iniciar el combate (navegacion inesperada).
  mostrarErrorYVolver() {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2, "No hay campeones para el combate.", {
        fontFamily: "sans-serif",
        fontSize: "18px",
        color: COLOR_TEXTO_TENUE,
        align: "center",
        wordWrap: { width: width - 60 },
      })
      .setOrigin(0.5)
      .setResolution(this.resolucionTexto());

    this.time.delayedCall(1500, () => {
      this.scene.start("SeleccionScene");
    });
  }
}
