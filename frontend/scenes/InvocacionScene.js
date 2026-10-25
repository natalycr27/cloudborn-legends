// InvocacionScene: pantalla donde el jugador describe su campeon y lo invoca.
//
// Responsabilidades (tarea 8.2):
//   - Mostrar el overlay HTML superpuesto al canvas de Phaser (textarea, boton,
//     contador "X / 500" y mensajes). El overlay vive en index.html con
//     position:absolute y z-index superior al canvas para quedar por encima.
//   - Mostrar el texto "Invoca tu leyenda" de forma visible y completa.
//   - Actualizar el contador de caracteres en tiempo real (formato "X / 500").
//   - Validar la descripcion en el cliente (vacia, solo espacios, < 10 chars)
//     y mostrar un error en espanol SIN llamar a la API.
//   - Al enviar: mostrar "Tu leyenda esta naciendo en la nube..." durante la
//     generacion; al exito mostrar el campeon (nombre, estadisticas, habilidades,
//     colores) y pasarlo a SeleccionScene; al fallo mostrar un error en espanol
//     conservando la descripcion ingresada y permitiendo reintentar.
//
// Nota de diseno: el input, el boton y el contador NO son objetos de Phaser,
// son elementos HTML del overlay (mas accesibles y simples que un input propio
// de Phaser). Esta escena solo los controla: los muestra, escucha eventos y
// oculta el overlay al transicionar.

import { API_URL } from "../src/main.js";

// Limites de longitud de la descripcion (Requisito 2.1 / 2.5).
const MIN_CARACTERES = 10;
const MAX_CARACTERES = 500;

export default class InvocacionScene extends Phaser.Scene {
  // Registra la escena con la clave "InvocacionScene" usada por main.js.
  constructor() {
    super("InvocacionScene");

    // Referencias a los elementos del overlay HTML; se resuelven en create().
    this.overlay = null;
    this.textarea = null;
    this.boton = null;
    this.contador = null;
    this.mensaje = null;
    this.preview = null;

    // Manejadores guardados para poder desuscribirlos al apagar la escena.
    this.alEscribir = null;
    this.alInvocar = null;

    // Evita envios simultaneos mientras una invocacion esta en curso.
    this.generando = false;
  }

  // Al crearse la escena, resuelve el overlay HTML, lo muestra y conecta los
  // eventos del textarea y del boton.
  create() {
    // Localiza los elementos del overlay definidos en index.html.
    this.overlay = document.getElementById("overlay-invocacion");
    this.textarea = document.getElementById("descripcion-campeon");
    this.boton = document.getElementById("boton-invocar");
    this.contador = document.getElementById("contador-caracteres");
    this.mensaje = document.getElementById("mensaje-invocacion");

    // Si el overlay no existe (p. ej. en un entorno de prueba sin DOM), no
    // continua para evitar errores; el resto del juego sigue funcionando.
    if (!this.overlay || !this.textarea || !this.boton) {
      return;
    }

    // Crea (una sola vez) el contenedor para previsualizar el campeon generado.
    this.prepararPreview();

    // Asegura un estado inicial limpio del mensaje y habilita el boton.
    this.limpiarMensaje();
    this.boton.disabled = false;

    // Muestra el overlay por encima del canvas de Phaser.
    this.overlay.classList.add("visible");

    // Enfoca el campo y actualiza el contador con el contenido actual (que
    // puede conservarse de un intento anterior fallido).
    this.actualizarContador();
    this.textarea.focus();

    // Contador en tiempo real: se actualiza en cada tecleo (Requisito 2.1).
    this.alEscribir = () => this.actualizarContador();
    this.textarea.addEventListener("input", this.alEscribir);

    // Boton de invocar: dispara la validacion y la generacion del campeon.
    this.alInvocar = () => this.invocarCampeon();
    this.boton.addEventListener("click", this.alInvocar);

    // Limpia los listeners y oculta el overlay cuando la escena se apaga,
    // para no dejar eventos colgados ni el overlay visible en otras escenas.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.alApagar, this);
  }

  // Crea el contenedor de previsualizacion del campeon dentro del overlay si
  // aun no existe. Se mantiene oculto hasta que haya un campeon que mostrar.
  prepararPreview() {
    this.preview = document.getElementById("preview-campeon");
    if (!this.preview) {
      this.preview = document.createElement("div");
      this.preview.id = "preview-campeon";
      this.preview.style.display = "none";
      this.preview.style.marginTop = "8px";
      this.preview.style.padding = "12px";
      this.preview.style.borderRadius = "8px";
      this.preview.style.background = "#141a33";
      this.preview.style.border = "1px solid #3a4a7a";
      this.preview.style.fontSize = "14px";
      // Inserta el preview justo despues del mensaje de estado.
      this.mensaje.insertAdjacentElement("afterend", this.preview);
    }
  }

  // Actualiza el contador de caracteres en formato "X / 500" en tiempo real.
  actualizarContador() {
    const longitud = this.textarea.value.length;
    this.contador.textContent = `${longitud} / ${MAX_CARACTERES}`;
  }

  // Valida la descripcion en el cliente y, si es valida, llama a la API para
  // generar el campeon. Gestiona los estados de carga, exito y error.
  async invocarCampeon() {
    // Evita reentradas mientras una generacion esta en curso.
    if (this.generando) {
      return;
    }

    // Toma la descripcion recortando espacios al inicio y al final para la
    // validacion de longitud (Requisito 2.5 / 10.2).
    const descripcion = this.textarea.value.trim();

    // Validacion en cliente: vacia, solo espacios o menos de 10 caracteres.
    // En estos casos se muestra el error en espanol SIN llamar a la API.
    if (descripcion.length < MIN_CARACTERES) {
      this.mostrarError(
        `La descripcion debe tener al menos ${MIN_CARACTERES} caracteres.`
      );
      this.textarea.focus();
      return;
    }

    // Validacion de limite superior (el maxlength del textarea ya lo limita,
    // pero se valida por robustez antes de llamar a la API).
    if (descripcion.length > MAX_CARACTERES) {
      this.mostrarError(
        `La descripcion no puede superar los ${MAX_CARACTERES} caracteres.`
      );
      this.textarea.focus();
      return;
    }

    // Estado de carga: mensaje visible y boton deshabilitado (Requisito 2.2).
    this.generando = true;
    this.boton.disabled = true;
    this.ocultarPreview();
    this.mostrarCarga("Tu leyenda esta naciendo en la nube...");

    try {
      // Llama al endpoint de creacion de campeon (POST /campeones).
      const respuesta = await fetch(`${API_URL}/campeones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descripcion }),
      });

      // Intenta parsear el cuerpo como JSON; puede venir vacio o mal formado.
      let datos = null;
      try {
        datos = await respuesta.json();
      } catch (_) {
        datos = null;
      }

      // Si la respuesta no es exitosa, usa el mensaje del backend (en espanol)
      // o uno generico, conservando la descripcion para reintentar.
      if (!respuesta.ok) {
        const mensajeBackend =
          datos && typeof datos.error === "string" ? datos.error : null;
        throw new Error(
          mensajeBackend ||
            "No pudimos generar tu leyenda. Intenta de nuevo."
        );
      }

      // Si la respuesta no trae un campeon valido, se trata como fallo.
      if (!datos || !datos.nombre || !datos.estadisticas) {
        throw new Error(
          "La leyenda generada no es valida. Intenta de nuevo."
        );
      }

      // Exito: muestra el campeon generado (Requisito 2.3 / 2.6).
      this.mostrarCampeon(datos);

      // Pasa el campeon a SeleccionScene y oculta el overlay de invocacion.
      this.irASeleccion(datos);
    } catch (error) {
      // Fallo de red o del backend: error en espanol conservando la
      // descripcion ingresada para permitir un nuevo intento (Requisito 2.4).
      this.mostrarError(
        error && error.message
          ? error.message
          : "No pudimos generar tu leyenda. Intenta de nuevo."
      );
    } finally {
      // Rehabilita el boton y libera el bloqueo de reentrada.
      this.generando = false;
      if (this.boton) {
        this.boton.disabled = false;
      }
    }
  }

  // Muestra el mensaje de carga en estado neutro (no es un error).
  mostrarCarga(texto) {
    this.mensaje.classList.remove("error");
    this.mensaje.textContent = texto;
  }

  // Muestra un mensaje de error en espanol (estilo de error) y oculta el
  // preview del campeon.
  mostrarError(texto) {
    this.ocultarPreview();
    this.mensaje.classList.add("error");
    this.mensaje.textContent = texto;
  }

  // Limpia el mensaje de estado (ni carga ni error).
  limpiarMensaje() {
    if (this.mensaje) {
      this.mensaje.classList.remove("error");
      this.mensaje.textContent = "";
    }
  }

  // Oculta y vacia el contenedor de previsualizacion del campeon.
  ocultarPreview() {
    if (this.preview) {
      this.preview.style.display = "none";
      this.preview.innerHTML = "";
    }
  }

  // Renderiza el campeon generado dentro del overlay: nombre, las cuatro
  // estadisticas, las habilidades y los dos colores (Requisito 2.3 / 2.6).
  mostrarCampeon(campeon) {
    this.limpiarMensaje();

    const estad = campeon.estadisticas || {};
    const habilidades = Array.isArray(campeon.habilidades)
      ? campeon.habilidades
      : [];

    // Pequenas muestras de color para el color principal y el secundario.
    const muestra = (color) =>
      `<span style="display:inline-block;width:16px;height:16px;border-radius:4px;` +
      `vertical-align:middle;border:1px solid #0b1020;background:${this.colorSeguro(
        color
      )}"></span>`;

    this.preview.innerHTML =
      `<div style="font-weight:600;font-size:18px;margin-bottom:8px">${this.escapar(
        campeon.nombre
      )}</div>` +
      `<div>Vida: ${estad.vida ?? "-"} &middot; Dano: ${estad.dano ?? "-"} ` +
      `&middot; Velocidad: ${estad.velocidad ?? "-"} &middot; Armadura: ${
        estad.armadura ?? "-"
      }</div>` +
      `<div style="margin-top:6px">Habilidades: ${
        habilidades.length ? habilidades.map((h) => this.escapar(h)).join(", ") : "-"
      }</div>` +
      `<div style="margin-top:6px;display:flex;align-items:center;gap:8px">` +
      `Colores: ${muestra(campeon.colorPrincipal)} ${muestra(
        campeon.colorSecundario
      )}</div>`;

    this.preview.style.display = "block";
  }

  // Devuelve un color CSS seguro; si el valor no parece un color valido usa
  // un gris neutro para evitar inyectar estilos arbitrarios.
  colorSeguro(color) {
    if (typeof color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(color.trim())) {
      return color.trim();
    }
    return "#6b7280";
  }

  // Escapa texto para interpolarlo de forma segura dentro de innerHTML.
  escapar(valor) {
    const texto = valor == null ? "" : String(valor);
    return texto
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Oculta el overlay y transiciona a SeleccionScene pasando el campeon
  // recien creado para que quede disponible como oponente.
  irASeleccion(campeon) {
    this.overlay.classList.remove("visible");
    this.scene.start("SeleccionScene", { campeonCreado: campeon });
  }

  // Al apagar la escena: elimina los listeners y oculta el overlay para que no
  // quede visible ni activo durante las demas escenas.
  alApagar() {
    if (this.textarea && this.alEscribir) {
      this.textarea.removeEventListener("input", this.alEscribir);
    }
    if (this.boton && this.alInvocar) {
      this.boton.removeEventListener("click", this.alInvocar);
    }
    if (this.overlay) {
      this.overlay.classList.remove("visible");
    }
    this.alEscribir = null;
    this.alInvocar = null;
  }
}
