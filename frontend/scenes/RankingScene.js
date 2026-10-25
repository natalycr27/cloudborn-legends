// RankingScene: Salón de las Leyendas; muestra el ranking por victorias.
//
// Responsabilidades (tarea 8.5):
//   - Llamar a GET /ranking y mostrar la lista del Salón de las Leyendas con los
//     campeones ya ordenados por victorias descendente y nombre ascendente
//     (el backend garantiza ese orden; Requisitos 9.1, 13.1, 13.2).
//   - Renderizar cada entrada con su puesto, los dos colores del campeon, el
//     nombre y el numero de victorias, con texto de al menos 16px en movil
//     (Requisito 18.1).
//   - Manejar los estados de carga, ranking vacio y error de red con mensajes en
//     espanol, sin cerrar la aplicacion (Requisitos 13.3, 17.4).
//   - Ofrecer un boton "Volver a jugar" que regrese a la pantalla de invocacion
//     (InvocacionScene) cerrando el overlay.
//
// Nota de diseno: igual que InvocacionScene, la lista y el boton NO son objetos
// de Phaser sino elementos HTML del overlay definido en index.html. Asi la UI es
// verdaderamente responsiva via CSS (una sola columna en anchos < 768px, varias
// columnas en anchos >= 768px, re-adaptacion al cambiar el ancho sin recargar y
// sin scroll horizontal entre 320px y 1920px; Requisitos 1.2, 1.3, 1.5, 1.6,
// 1.7) y los textos pueden garantizar el minimo de 16px en movil. El overlay se
// muestra al entrar en la escena y se oculta al salir.

import { API_URL } from "../src/main.js";

export default class RankingScene extends Phaser.Scene {
  // Registra la escena con la clave "RankingScene" usada por main.js.
  constructor() {
    super("RankingScene");

    // Referencias a los elementos del overlay HTML; se resuelven en create().
    this.overlay = null;
    this.mensaje = null;
    this.lista = null;
    this.botonVolver = null;

    // Manejador del boton "Volver a jugar", guardado para desuscribirlo al
    // apagar la escena.
    this.alVolver = null;
  }

  // Al crearse la escena: resuelve el overlay HTML, lo muestra y pide el ranking.
  create() {
    // Localiza los elementos del overlay definidos en index.html.
    this.overlay = document.getElementById("overlay-ranking");
    this.mensaje = document.getElementById("mensaje-ranking");
    this.lista = document.getElementById("lista-ranking");
    this.botonVolver = document.getElementById("boton-volver-jugar");

    // Si el overlay no existe (p. ej. en un entorno de prueba sin DOM), no
    // continua para evitar errores; el resto del juego sigue funcionando.
    if (!this.overlay || !this.lista) {
      return;
    }

    // Estado inicial: lista limpia y overlay visible por encima del canvas.
    this.lista.innerHTML = "";
    this.overlay.classList.add("visible");

    // Boton "Volver a jugar": regresa a la pantalla de invocacion.
    if (this.botonVolver) {
      this.alVolver = () => this.volverAJugar();
      this.botonVolver.addEventListener("click", this.alVolver);
    }

    // Limpia los listeners y oculta el overlay cuando la escena se apaga.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.alApagar, this);

    // Carga el ranking desde la API.
    this.cargarRanking();
  }

  // Llama a GET /ranking y, segun el resultado, muestra la lista, el estado
  // vacio o un error en espanol. Es tolerante a fallos de red: cualquier fallo
  // se traduce en un mensaje en pantalla sin cerrar la aplicacion (Req 17.4).
  async cargarRanking() {
    this.mostrarMensaje("Cargando el Salón de las Leyendas...", false);

    try {
      // Pide el ranking ordenado (Requisitos 13.1, 13.2).
      const respuesta = await fetch(`${API_URL}/ranking`);

      // Un HTTP 500 (o cualquier no-2xx) se trata como servicio no disponible.
      if (!respuesta.ok) {
        throw new Error(
          "El Salón de las Leyendas no está disponible. Intenta de nuevo."
        );
      }

      // El cuerpo debe ser un arreglo JSON; si no, se trata como error.
      let datos = null;
      try {
        datos = await respuesta.json();
      } catch (_) {
        datos = null;
      }
      if (!Array.isArray(datos)) {
        throw new Error(
          "La respuesta del servidor no es válida. Intenta de nuevo."
        );
      }

      // Ranking vacio: mensaje amable invitando a crear campeones (Req 13.3).
      if (datos.length === 0) {
        this.lista.innerHTML = "";
        this.mostrarMensaje(
          "Todavía no hay leyendas. Invoca campeones y gana batallas para aparecer aquí.",
          false
        );
        return;
      }

      // Hay entradas: oculta el mensaje y renderiza la lista ordenada.
      this.ocultarMensaje();
      this.renderizarRanking(datos);
    } catch (error) {
      // Fallo de red o HTTP 500: mensaje de error en espanol (Requisito 13.5).
      this.lista.innerHTML = "";
      this.mostrarMensaje(
        error && error.message
          ? error.message
          : "No pudimos cargar el Salón de las Leyendas. Intenta de nuevo.",
        true
      );
    }
  }

  // Renderiza cada campeon como una entrada de la lista (<li>) con su puesto,
  // los dos colores, el nombre y el numero de victorias. Respeta el orden que
  // devuelve el backend (victorias descendente, nombre ascendente).
  renderizarRanking(campeones) {
    this.lista.innerHTML = campeones
      .map((campeon, indice) => {
        const puesto = indice + 1;
        const nombre = this.escapar(campeon && campeon.nombre) || "Campeón";
        const victorias =
          campeon && typeof campeon.victorias === "number"
            ? campeon.victorias
            : 0;
        const etiquetaVictorias = victorias === 1 ? "victoria" : "victorias";
        const principal = this.colorSeguro(campeon && campeon.colorPrincipal);
        const secundario = this.colorSeguro(campeon && campeon.colorSecundario);

        // Circulo dividido en dos mitades con el color principal y el secundario.
        const estiloColores =
          `background:linear-gradient(135deg, ${principal} 0%, ${principal} 50%, ` +
          `${secundario} 50%, ${secundario} 100%)`;

        return (
          `<li class="entrada-ranking">` +
          `<span class="entrada-puesto">${puesto}</span>` +
          `<span class="entrada-colores" role="img" ` +
          `aria-label="Colores de ${nombre}" style="${estiloColores}"></span>` +
          `<span class="entrada-nombre">${nombre}</span>` +
          `<span class="entrada-victorias">${victorias} ${etiquetaVictorias}</span>` +
          `</li>`
        );
      })
      .join("");
  }

  // "Volver a jugar": oculta el overlay y regresa a la pantalla de invocacion.
  volverAJugar() {
    if (this.overlay) {
      this.overlay.classList.remove("visible");
    }
    this.scene.start("InvocacionScene");
  }

  // Muestra un mensaje de estado (carga / vacio / error) en espanol.
  mostrarMensaje(texto, esError) {
    if (!this.mensaje) {
      return;
    }
    this.mensaje.textContent = texto;
    this.mensaje.classList.toggle("error", Boolean(esError));
  }

  // Oculta (vacia) el mensaje de estado.
  ocultarMensaje() {
    if (this.mensaje) {
      this.mensaje.textContent = "";
      this.mensaje.classList.remove("error");
    }
  }

  // Devuelve un color CSS seguro; si el valor no parece un color valido usa un
  // gris neutro para evitar inyectar estilos arbitrarios.
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

  // Al apagar la escena: elimina el listener del boton y oculta el overlay para
  // que no quede visible ni activo durante las demas escenas.
  alApagar() {
    if (this.botonVolver && this.alVolver) {
      this.botonVolver.removeEventListener("click", this.alVolver);
    }
    if (this.overlay) {
      this.overlay.classList.remove("visible");
    }
    this.alVolver = null;
  }
}
