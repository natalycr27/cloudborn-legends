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

// Dimensiones base de la arena/juego (coinciden con la arena de combat.js).
const ANCHO_BASE = 800;
const ALTO_BASE = 600;

// Configuracion de Phaser 3 con canvas responsive.
const config = {
  type: Phaser.AUTO, // WebGL si esta disponible, con fallback a Canvas
  backgroundColor: "#0b1020",
  parent: "contenedor-juego", // monta el canvas dentro del contenedor del overlay
  scale: {
    // FIT escala el canvas manteniendo la proporcion dentro del contenedor,
    // y CENTER_BOTH lo centra. Asi el juego se adapta de 320px a 1920px sin
    // generar scroll horizontal (Requisito 1.6). La responsividad fina de la
    // UI (columnas, controles tactiles) se afina en la tarea 8.5.
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

export default juego;
