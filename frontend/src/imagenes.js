// imagenes.js: llamadas a la API de imagenes generadas con IA.
//
//   - POST /campeones/{id}/retrato -> { imagenUrl }
//   - POST /arenas                 -> { imagenUrl, tema }
//
// Cada generacion tarda de 5 a 15 s, asi que las escenas las lanzan en segundo
// plano (sin await en el flujo del jugador). Ambas funciones tienen un tiempo
// maximo de 27 s (API Gateway corta a los 29 s) y nunca bloquean la UI.

import { API_URL } from "./main.js";

// Tiempo maximo de espera de una generacion, en milisegundos.
export const TIEMPO_MAXIMO_IMAGEN_MS = 27000;

// Clave del registry de Phaser donde SeleccionScene guarda el estado de la
// arena generada para que ArenaScene la use:
//   { estado: "pendiente" | "lista" | "error", imagenUrl?, tema?, error? }
export const REGISTRY_ARENA = "arenaGenerada";

// Reintentos al cargar una imagen que falla (error de red) antes de usar el
// respaldo: hasta 3 reintentos, con 2 s de espera entre cada uno.
export const REINTENTOS_IMAGEN = 3;
export const ESPERA_REINTENTO_IMAGEN_MS = 2000;

// Reintentos en segundo plano cuando POST /retrato responde 429 (el forjador
// esta ocupado): hasta 3 veces, cada 20 s.
export const REINTENTOS_RETRATO_429 = 3;
export const ESPERA_RETRATO_429_MS = 20000;

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

// Precarga una imagen; si falla la reintenta hasta REINTENTOS_IMAGEN veces con
// ESPERA_REINTENTO_IMAGEN_MS entre intentos. Devuelve true si cargo, false si
// agoto los reintentos. Nunca lanza.
export async function cargarImagenConReintentos(
  url,
  reintentos = REINTENTOS_IMAGEN,
  esperaMs = ESPERA_REINTENTO_IMAGEN_MS
) {
  for (let intento = 0; intento <= reintentos; intento++) {
    const cargo = await new Promise((resolver) => {
      const imagen = new Image();
      imagen.onload = () => resolver(true);
      imagen.onerror = () => resolver(false);
      imagen.src = url;
    });
    if (cargo) {
      return true;
    }
    if (intento < reintentos) {
      await esperar(esperaMs);
    }
  }
  return false;
}

// Para un <img> del DOM que acaba de fallar: reintenta la carga y, si al final
// carga, vuelve a asignar el src para que el navegador la pinte. Devuelve true
// si se recupero; false si hay que usar el respaldo.
export async function reintentarElementoImagen(img) {
  const url = img && img.src;
  if (!url) {
    return false;
  }
  const cargo = await cargarImagenConReintentos(url);
  if (cargo) {
    img.src = url;
  }
  return cargo;
}

// Solo se aceptan URLs http(s) para evitar esquemas peligrosos (javascript:, data:).
export function urlImagenSegura(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url.trim())
    ? url.trim()
    : null;
}

// POST con tiempo maximo; aborta la peticion al vencer. Lanza si falla.
async function postConTiempo(ruta, tiempoMs) {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), tiempoMs);
  try {
    const respuesta = await fetch(`${API_URL}${ruta}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: controlador.signal,
    });
    if (!respuesta.ok) {
      const error = new Error(`HTTP ${respuesta.status}`);
      error.status = respuesta.status;
      throw error;
    }
    return await respuesta.json();
  } finally {
    clearTimeout(temporizador);
  }
}

// Ids de campeones cuyo retrato se esta reintentando en segundo plano tras un 429.
const retratosReintentando = new Set();

// True si el retrato de ese campeon sigue reintentandose en segundo plano.
export function retratoReintentandose(idCampeon) {
  return retratosReintentando.has(String(idCampeon));
}

// Tras un 429 reintenta cada 20 s (hasta 3 veces) sin bloquear. Si alguno
// funciona llama a alListo(url). Al terminar deja de estar "reintentando".
async function reintentarRetratoEnSegundoPlano(idCampeon, tiempoMs, alListo) {
  const clave = String(idCampeon);
  let url = null;
  retratosReintentando.add(clave);
  try {
    for (let intento = 0; intento < REINTENTOS_RETRATO_429 && !url; intento++) {
      await esperar(ESPERA_RETRATO_429_MS);
      try {
        const datos = await postConTiempo(
          `/campeones/${encodeURIComponent(clave)}/retrato`,
          tiempoMs
        );
        url = urlImagenSegura(datos && datos.imagenUrl);
        break;
      } catch (error) {
        if (!(error && error.status === 429)) {
          console.warn("No se pudo generar el retrato:", error);
          break;
        }
      }
    }
  } finally {
    retratosReintentando.delete(clave);
  }
  // Un solo aviso final: la URL si se consiguio, o null si no.
  if (typeof alListo === "function") {
    alListo(url);
  }
}
// Pide el retrato de un campeon. Devuelve la URL segura o null si falla, no hay
// id o tarda mas del tiempo maximo. Nunca lanza.
// Si el servidor responde 429 (forjador ocupado) devuelve null y reintenta cada
// 20 s hasta 3 veces en segundo plano; al conseguirlo llama a alListo(url), y
// si se agotan los reintentos llama a alListo(null).
export async function pedirRetrato(
  idCampeon,
  tiempoMs = TIEMPO_MAXIMO_IMAGEN_MS,
  alListo = null
) {
  if (idCampeon == null || idCampeon === "") {
    return null;
  }
  try {
    const datos = await postConTiempo(
      `/campeones/${encodeURIComponent(String(idCampeon))}/retrato`,
      tiempoMs
    );
    return urlImagenSegura(datos && datos.imagenUrl);
  } catch (error) {
    if (error && error.status === 429 && !retratoReintentandose(idCampeon)) {
      reintentarRetratoEnSegundoPlano(idCampeon, tiempoMs, alListo);
      return null;
    }
    console.warn("No se pudo generar el retrato:", error);
    return null;
  }
}
// Pide una arena nueva. Devuelve { imagenUrl, tema }; lanza si falla.
export async function pedirArena(tiempoMs = TIEMPO_MAXIMO_IMAGEN_MS) {
  const datos = await postConTiempo("/arenas", tiempoMs);
  const imagenUrl = urlImagenSegura(datos && datos.imagenUrl);
  if (!imagenUrl) {
    throw new Error("Respuesta de arena no valida");
  }
  return {
    imagenUrl,
    tema: typeof (datos && datos.tema) === "string" ? datos.tema : "",
  };
}
