// main.js: punto de entrada del frontend de Cloudborn Legends.
//
// Responsabilidades (tarea 8.1):
//   - Resolver la URL de la API desde window.CONFIG.apiUrl, con fallback a
//     http://localhost:3000 para desarrollo local.
//   - Inicializar Phaser 3 con un canvas responsive.
//   - Registrar las 5 escenas del juego en el orden del flujo:
//     BootScene -> InvocacionScene -> SeleccionScene -> ArenaScene -> RankingScene.
//
// Phaser 3 se carga desde el CDN en index.html, por lo que esta disponible como
// variable global `Phaser`. Las escenas se importan como modulos ES.

import BootScene from "../scenes/BootScene.js";
import InvocacionScene from "../scenes/InvocacionScene.js";
import SeleccionScene from "../scenes/SeleccionScene.js";
import ArenaScene from "../scenes/ArenaScene.js";
import RankingScene from "../scenes/RankingScene.js";

// Resuelve la URL base de la API. En produccion, el script config.js (generado
// en el despliegue y gitignored) define window.CONFIG.apiUrl. En desarrollo
// local, cuando window.CONFIG no existe, se usa http://localhost:3000.
export function obtenerApiUrl() {
  if (window.CONFIG && typeof window.CONFIG.apiUrl === "string") {
    return window.CONFIG.apiUrl;
  }
  return "http://localhost:3000";
}

// URL base de la API expuesta globalmente para que las escenas la reutilicen
// sin volver a resolver el fallback en cada llamada.
export const API_URL = obtenerApiUrl();

// Dimensiones base del juego segun la orientacion de la ventana.
//   - Horizontal (apaisado): 800x600, el tamano historico de la arena.
//   - Vertical (celular en vertical, alto > ancho): 720x1280, para que el
//     juego ocupe la pantalla alta de un movil sin franjas negras enormes.
// El publico entra escaneando un QR desde el celular, asi que la version
// vertical es prioritaria. Phaser.Scale.FIT + CENTER_BOTH escalan y centran
// el canvas dentro del contenedor manteniendo la proporcion elegida aqui.
const ANCHO_HORIZONTAL = 800;
const ALTO_HORIZONTAL = 600;
const ANCHO_VERTICAL = 720;
const ALTO_VERTICAL = 1280;

// Elige el tamano del juego a partir de la orientacion actual de la ventana.
// Vertical (alto > ancho): 720x1280, prioritario porque el publico entra desde
// el celular tras escanear un QR. Horizontal: 800x600. Si no hay window
// (entorno de prueba sin DOM) cae al tamano horizontal por defecto.
export function dimensionesSegunOrientacion() {
  const alto = typeof window !== "undefined" ? window.innerHeight : 0;
  const ancho = typeof window !== "undefined" ? window.innerWidth : 0;
  const esVertical = alto > ancho;
  return esVertical
    ? { width: ANCHO_VERTICAL, height: ALTO_VERTICAL }
    : { width: ANCHO_HORIZONTAL, height: ALTO_HORIZONTAL };
}

const { width: ANCHO_BASE, height: ALTO_BASE } = dimensionesSegunOrientacion();

// Configuracion de Phaser 3 con canvas responsive.
const config = {
  type: Phaser.AUTO, // WebGL si esta disponible, con fallback a Canvas
  backgroundColor: "#0b1020",
  parent: "contenedor-juego", // monta el canvas dentro del contenedor del overlay
  scale: {
    // FIT escala el canvas manteniendo la proporcion dentro del contenedor,
    // y CENTER_BOTH lo centra. Asi el juego se adapta de 320px a 1920px sin
    // generar scroll horizontal (Requisito 1.6). El tamano base depende de la
    // orientacion (vertical en movil, horizontal en escritorio).
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: ANCHO_BASE,
    height: ALTO_BASE,
  },
  // Orden de registro = orden de arranque: BootScene se ejecuta primero.
  scene: [BootScene, InvocacionScene, SeleccionScene, ArenaScene, RankingScene],
};

// Crea la instancia del juego y arranca BootScene.
// Se expone en window.juego para facilitar depuracion y acceso desde las escenas.
const juego = new Phaser.Game(config);
window.juego = juego;

// Reacomodo ante cambio de tamano/orientacion de la ventana: cuando el usuario
// gira el telefono, la relacion alto/ancho cambia y el tamano base del juego
// (720x1280 vertical vs 800x600 horizontal) debe seguirla. Se actualiza con
// scale.setGameSize(), lo que a su vez dispara el evento 'resize' que cada
// escena (p. ej. ArenaScene) escucha para reacomodar su contenido. Solo se
// aplica cuando la orientacion realmente cambia, para no reconstruir de mas.
function ajustarTamanoJuego() {
  if (!juego || !juego.scale) {
    return;
  }
  const { width, height } = dimensionesSegunOrientacion();
  const escala = juego.scale;
  if (escala.width !== width || escala.height !== height) {
    escala.setGameSize(width, height);
  }
  // Recalcula el factor FIT contra el nuevo tamano de la ventana.
  escala.refresh();
}

if (typeof window !== "undefined") {
  window.addEventListener("resize", ajustarTamanoJuego);
  // orientationchange cubre navegadores moviles que no emiten 'resize' fiable
  // al rotar; el pequeno retardo espera a que el viewport reporte las medidas
  // ya rotadas.
  window.addEventListener("orientationchange", () => {
    window.setTimeout(ajustarTamanoJuego, 50);
  });
}

export default juego;
