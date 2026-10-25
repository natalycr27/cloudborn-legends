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
//     generacion; al exito NO pasar directo a SeleccionScene, sino mostrar una
//     tarjeta del campeon (nombre grande, las cuatro estadisticas con barras de
//     progreso, las habilidades como etiquetas y un circulo con sus dos colores)
//     con dos botones: "Crear otro campeón" (limpia el formulario y lo vuelve a
//     mostrar) e "Ir a la arena" (pasa a SeleccionScene). Al fallo mostrar un
//     error en espanol conservando la descripcion ingresada y permitiendo
//     reintentar.
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
    this.formulario = null;
    this.textarea = null;
    this.boton = null;
    this.contador = null;
    this.mensaje = null;

    // Elementos de la tarjeta del campeon recien creado.
    this.tarjeta = null;
    this.tarjetaNombre = null;
    this.tarjetaColores = null;
    this.tarjetaEstadisticas = null;
    this.tarjetaHabilidades = null;
    this.botonCrearOtro = null;
    this.botonIrArena = null;

    // Boton secundario del formulario para ir directo a la arena con los
    // campeones ya existentes, sin crear uno nuevo.
    this.botonIrArenaExistentes = null;

    // Campeon mostrado actualmente en la tarjeta (para "Ir a la arena").
    this.campeonActual = null;

    // Manejadores guardados para poder desuscribirlos al apagar la escena.
    this.alEscribir = null;
    this.alInvocar = null;
    this.alCrearOtro = null;
    this.alIrArena = null;
    this.alIrArenaExistentes = null;

    // Evita envios simultaneos mientras una invocacion esta en curso.
    this.generando = false;
  }

  // Al crearse la escena, resuelve el overlay HTML, lo muestra y conecta los
  // eventos del textarea y del boton.
  create() {
    // Localiza los elementos del overlay definidos en index.html.
    this.overlay = document.getElementById("overlay-invocacion");
    this.formulario = document.getElementById("formulario-invocacion");
    this.textarea = document.getElementById("descripcion-campeon");
    this.boton = document.getElementById("boton-invocar");
    this.contador = document.getElementById("contador-caracteres");
    this.mensaje = document.getElementById("mensaje-invocacion");
    this.botonIrArenaExistentes = document.getElementById(
      "boton-ir-arena-existentes"
    );

    // Elementos de la tarjeta del campeon recien creado.
    this.tarjeta = document.getElementById("tarjeta-campeon");
    this.tarjetaNombre = document.getElementById("tarjeta-nombre");
    this.tarjetaColores = document.getElementById("tarjeta-colores");
    this.tarjetaEstadisticas = document.getElementById("tarjeta-estadisticas");
    this.tarjetaHabilidades = document.getElementById("tarjeta-habilidades");
    this.botonCrearOtro = document.getElementById("boton-crear-otro");
    this.botonIrArena = document.getElementById("boton-ir-arena");

    // Si el overlay no existe (p. ej. en un entorno de prueba sin DOM), no
    // continua para evitar errores; el resto del juego sigue funcionando.
    if (!this.overlay || !this.textarea || !this.boton) {
      return;
    }

    // Estado inicial: cada vez que se entra a la escena (incluido al volver
    // desde "Volver a jugar" en RankingScene) el formulario arranca limpio:
    // textarea vacio, contador en "0 / 500", sin mensajes, boton habilitado y
    // tarjeta del campeon anterior oculta.
    this.reiniciarFormulario();

    // Muestra el overlay por encima del canvas de Phaser.
    this.overlay.classList.add("visible");

    // Enfoca el campo ya vacio para que el jugador escriba de inmediato.
    this.textarea.focus();

    // Contador en tiempo real: se actualiza en cada tecleo (Requisito 2.1).
    this.alEscribir = () => this.actualizarContador();
    this.textarea.addEventListener("input", this.alEscribir);

    // Boton de invocar: dispara la validacion y la generacion del campeon.
    this.alInvocar = () => this.invocarCampeon();
    this.boton.addEventListener("click", this.alInvocar);

    // Boton secundario: ir directo a la arena con los campeones existentes,
    // sin crear uno nuevo (arranca SeleccionScene sin campeon preseleccionado).
    if (this.botonIrArenaExistentes) {
      this.alIrArenaExistentes = () => this.irAArenaExistentes();
      this.botonIrArenaExistentes.addEventListener(
        "click",
        this.alIrArenaExistentes
      );
    }

    // Botones de la tarjeta: crear otro campeon o ir a la arena.
    if (this.botonCrearOtro) {
      this.alCrearOtro = () => this.crearOtroCampeon();
      this.botonCrearOtro.addEventListener("click", this.alCrearOtro);
    }
    if (this.botonIrArena) {
      this.alIrArena = () => this.irASeleccion(this.campeonActual);
      this.botonIrArena.addEventListener("click", this.alIrArena);
    }

    // Limpia los listeners y oculta el overlay cuando la escena se apaga,
    // para no dejar eventos colgados ni el overlay visible en otras escenas.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.alApagar, this);
  }

  // Muestra el formulario de invocacion y oculta la tarjeta del campeon.
  mostrarFormulario() {
    if (this.formulario) {
      this.formulario.classList.remove("oculto");
    }
    this.ocultarTarjeta();
  }

  // Oculta y vacia la tarjeta del campeon.
  ocultarTarjeta() {
    if (this.tarjeta) {
      this.tarjeta.classList.remove("visible");
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
    this.ocultarTarjeta();
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

      // Exito: NO pasa directo a SeleccionScene. Primero muestra la tarjeta
      // del campeon generado (nombre, estadisticas, habilidades, colores) con
      // los botones "Crear otro campeón" e "Ir a la arena" (Requisito 2.3 / 2.6).
      this.mostrarCampeon(datos);
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

  // Muestra un mensaje de error en espanol (estilo de error) y oculta la
  // tarjeta del campeon.
  mostrarError(texto) {
    this.ocultarTarjeta();
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

  // Rangos fijos de cada estadistica (coinciden con el backend) usados para
  // calcular el porcentaje de llenado de cada barra de progreso.
  //   vida 800-1200, dano 50-150, velocidad 200-400, armadura 10-50.
  static RANGOS = {
    vida: { min: 800, max: 1200, etiqueta: "Vida" },
    dano: { min: 50, max: 150, etiqueta: "Daño" },
    velocidad: { min: 200, max: 400, etiqueta: "Velocidad" },
    armadura: { min: 10, max: 50, etiqueta: "Armadura" },
  };

  // Renderiza la tarjeta del campeon generado dentro del overlay: nombre
  // grande, las cuatro estadisticas con barras de progreso, las habilidades
  // como etiquetas y un circulo con los dos colores (Requisito 2.3 / 2.6).
  mostrarCampeon(campeon) {
    this.limpiarMensaje();
    this.campeonActual = campeon;

    const estad = campeon.estadisticas || {};
    const habilidades = Array.isArray(campeon.habilidades)
      ? campeon.habilidades
      : [];

    // Nombre grande del campeon.
    if (this.tarjetaNombre) {
      this.tarjetaNombre.textContent = campeon.nombre || "Campeón";
    }

    // Circulo dividido en dos mitades con el color principal y el secundario.
    if (this.tarjetaColores) {
      const principal = this.colorSeguro(campeon.colorPrincipal);
      const secundario = this.colorSeguro(campeon.colorSecundario);
      this.tarjetaColores.style.background = `linear-gradient(135deg, ${principal} 0%, ${principal} 50%, ${secundario} 50%, ${secundario} 100%)`;
      this.tarjetaColores.setAttribute(
        "aria-label",
        `Colores del campeón: principal ${principal}, secundario ${secundario}`
      );
    }

    // Estadisticas con barras de progreso, cada una escalada a su rango.
    if (this.tarjetaEstadisticas) {
      this.tarjetaEstadisticas.innerHTML = Object.entries(
        InvocacionScene.RANGOS
      )
        .map(([clave, rango]) => {
          const valor = estad[clave];
          const numero = typeof valor === "number" ? valor : null;
          const porcentaje =
            numero == null
              ? 0
              : Math.max(
                  0,
                  Math.min(
                    100,
                    ((numero - rango.min) / (rango.max - rango.min)) * 100
                  )
                );
          const textoValor = numero == null ? "-" : numero;
          return (
            `<div class="estadistica">` +
            `<div class="estadistica-cabecera">` +
            `<span>${rango.etiqueta}</span>` +
            `<span class="estadistica-valor">${textoValor}</span>` +
            `</div>` +
            `<div class="barra"><div class="barra-relleno" style="width:${porcentaje}%"></div></div>` +
            `</div>`
          );
        })
        .join("");
    }

    // Habilidades como etiquetas tipo "chip".
    if (this.tarjetaHabilidades) {
      this.tarjetaHabilidades.innerHTML = habilidades.length
        ? habilidades
            .map(
              (h) =>
                `<span class="habilidad-etiqueta">${this.escapar(h)}</span>`
            )
            .join("")
        : `<span class="habilidad-etiqueta">Sin habilidades</span>`;
    }

    // Oculta el formulario y muestra la tarjeta.
    if (this.formulario) {
      this.formulario.classList.add("oculto");
    }
    if (this.tarjeta) {
      this.tarjeta.classList.add("visible");
    }
    if (this.botonIrArena) {
      this.botonIrArena.focus();
    }
  }

  // Deja el formulario de invocacion en su estado inicial: vacia el textarea,
  // pone el contador en "0 / 500", borra cualquier mensaje de error o de carga,
  // habilita el boton "Invocar" y oculta la tarjeta del campeon anterior.
  // Se usa tanto al entrar a la escena (create) como en "Crear otro campeón".
  reiniciarFormulario() {
    // Olvida el campeon mostrado en la tarjeta anterior.
    this.campeonActual = null;

    // Permite enviar de nuevo (por si se salio con una invocacion en curso).
    this.generando = false;

    // Vacia el textarea y refresca el contador a "0 / 500".
    if (this.textarea) {
      this.textarea.value = "";
    }
    this.actualizarContador();

    // Borra mensajes de error/carga y vuelve a habilitar el boton.
    this.limpiarMensaje();
    if (this.boton) {
      this.boton.disabled = false;
    }

    // Muestra el formulario y oculta la tarjeta del campeon anterior.
    this.mostrarFormulario();
  }

  // "Crear otro campeón": reinicia el formulario y devuelve el foco al textarea.
  crearOtroCampeon() {
    this.reiniciarFormulario();
    if (this.textarea) {
      this.textarea.focus();
    }
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

  // "Ir a la arena con campeones existentes": no crea ningun campeon; oculta el
  // overlay y pasa directo a SeleccionScene sin preseleccionar a nadie. Evita
  // transicionar si hay una invocacion en curso.
  irAArenaExistentes() {
    if (this.generando) {
      return;
    }
    if (this.overlay) {
      this.overlay.classList.remove("visible");
    }
    this.scene.start("SeleccionScene");
  }

  // "Ir a la arena": oculta el overlay y transiciona a SeleccionScene pasando
  // el campeon recien creado para que quede disponible como oponente.
  irASeleccion(campeon) {
    // Sin un campeon valido no hay nada que llevar a la arena.
    if (!campeon) {
      return;
    }
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
    if (this.botonCrearOtro && this.alCrearOtro) {
      this.botonCrearOtro.removeEventListener("click", this.alCrearOtro);
    }
    if (this.botonIrArena && this.alIrArena) {
      this.botonIrArena.removeEventListener("click", this.alIrArena);
    }
    if (this.botonIrArenaExistentes && this.alIrArenaExistentes) {
      this.botonIrArenaExistentes.removeEventListener(
        "click",
        this.alIrArenaExistentes
      );
    }
    if (this.overlay) {
      this.overlay.classList.remove("visible");
    }
    this.alEscribir = null;
    this.alInvocar = null;
    this.alCrearOtro = null;
    this.alIrArena = null;
    this.alIrArenaExistentes = null;
  }
}
