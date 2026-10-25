// SeleccionScene: lista los campeones disponibles y permite elegir dos.
//
// Responsabilidades (tarea 8.3):
//   - Llamar a GET /campeones y mostrar todos los campeones almacenados como
//     tarjetas (Requisitos 11.1 / 11.2).
//   - Mostrar cada campeon con su nombre, las cuatro estadisticas (Vida, Daño,
//     Velocidad, Armadura) con barras, sus habilidades como etiquetas y sus dos
//     colores como un circulo partido en dos mitades (Requisitos 11.3 / 11.4).
//   - Manejar el arreglo vacio con un mensaje amable en espanol y los fallos de
//     red / HTTP 500 con un mensaje de error en espanol.
//   - Permitir seleccionar exactamente DOS campeones distintos (resaltandolos) y,
//     al confirmar, iniciar ArenaScene pasando ambos campeones (Requisito 6.1).
//     El boton "Iniciar combate" queda deshabilitado hasta tener dos.
//
// Nota de diseno: igual que InvocacionScene y RankingScene, esta escena NO
// dibuja con objetos de Phaser, sino que controla un overlay HTML definido en
// index.html (#overlay-seleccion). Asi la UI es verdaderamente responsiva via
// CSS (cuadricula de una sola columna < 768px y varias columnas >= 768px con
// auto-fit + minmax(260px, 1fr), centrada con max-width 1100px y margin auto),
// el texto no se ve borroso por el escalado del canvas y el boton "Iniciar
// combate" puede quedar fijo abajo en movil. La version movil es prioritaria
// porque el publico juega escaneando un QR desde el celular. El overlay se
// muestra al entrar en la escena y se oculta al salir. La escena previa
// (InvocacionScene) la arranca con { campeonCreado } para preseleccionar al
// campeon recien invocado.

import { API_URL } from "../src/main.js";

// Rangos fijos de cada estadistica (coinciden con el backend) usados para
// normalizar el valor a un porcentaje de barra. vida 800-1200, dano 50-150,
// velocidad 200-400, armadura 10-50.
const RANGOS_ESTADISTICAS = [
  { clave: "vida", etiqueta: "Vida", min: 800, max: 1200 },
  { clave: "dano", etiqueta: "Daño", min: 50, max: 150 },
  { clave: "velocidad", etiqueta: "Velocidad", min: 200, max: 400 },
  { clave: "armadura", etiqueta: "Armadura", min: 10, max: 50 },
];

export default class SeleccionScene extends Phaser.Scene {
  // Registra la escena con la clave "SeleccionScene" usada por main.js.
  constructor() {
    super("SeleccionScene");

    // Campeon recien creado por InvocacionScene (para preseleccionarlo si llega).
    this.campeonCreado = null;

    // Estado de datos y seleccion.
    this.campeones = [];
    // Ids de los campeones seleccionados, en orden de seleccion (maximo 2).
    this.seleccionados = [];

    // Referencias a los elementos del overlay HTML; se resuelven en create().
    this.overlay = null;
    this.pista = null;
    this.mensaje = null;
    this.lista = null;
    this.boton = null;

    // Manejadores guardados para desuscribirlos al apagar la escena.
    this.alIniciar = null;
    // Manejador delegado de clicks sobre las tarjetas de la lista.
    this.alClickLista = null;
  }

  // Lee los datos entrantes de la escena previa antes de create().
  init(data) {
    // InvocacionScene arranca esta escena con { campeonCreado }.
    this.campeonCreado = data && data.campeonCreado ? data.campeonCreado : null;
    // Reinicia el estado por si la escena se reutiliza.
    this.campeones = [];
    this.seleccionados = [];
  }

  // Al crearse la escena: resuelve el overlay HTML, lo muestra y pide los
  // campeones a la API.
  create() {
    // Localiza los elementos del overlay definidos en index.html.
    this.overlay = document.getElementById("overlay-seleccion");
    this.pista = document.getElementById("pista-seleccion");
    this.mensaje = document.getElementById("mensaje-seleccion");
    this.lista = document.getElementById("lista-seleccion");
    this.boton = document.getElementById("boton-iniciar-combate");

    // Si el overlay no existe (p. ej. en un entorno de prueba sin DOM), no
    // continua para evitar errores; el resto del juego sigue funcionando.
    if (!this.overlay || !this.lista) {
      return;
    }

    // Estado inicial: lista limpia y overlay visible por encima del canvas.
    this.lista.innerHTML = "";
    this.overlay.classList.add("visible");
    this.overlay.scrollTop = 0;

    // Boton "Iniciar combate": solo transiciona si hay dos seleccionados.
    if (this.boton) {
      this.alIniciar = () => this.confirmarSeleccion();
      this.boton.addEventListener("click", this.alIniciar);
    }

    // Click delegado sobre la lista: alterna la seleccion de la tarjeta pulsada.
    this.alClickLista = (evento) => {
      const tarjeta = evento.target.closest(".tarjeta-seleccion");
      if (tarjeta && tarjeta.dataset.id != null) {
        this.alternarSeleccion(tarjeta.dataset.id);
      }
    };
    this.lista.addEventListener("click", this.alClickLista);

    // Limpia los listeners y oculta el overlay cuando la escena se apaga.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.alApagar, this);

    // Estado inicial del boton y la pista, y carga de campeones.
    this.actualizarBoton();
    this.actualizarPista();
    this.cargarCampeones();
  }

  // Llama a GET /campeones y, segun el resultado, muestra la lista, el estado
  // vacio o un error en espanol.
  async cargarCampeones() {
    this.mostrarMensaje("Cargando campeones...", false);

    try {
      // Pide el listado de campeones almacenados (Requisito 11.1 / 11.2).
      const respuesta = await fetch(`${API_URL}/campeones`);

      // Un HTTP 500 (o cualquier no-2xx) se trata como servicio no disponible.
      if (!respuesta.ok) {
        throw new Error(
          "No pudimos cargar los campeones. El servicio no esta disponible."
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
          "La respuesta del servidor no es valida. Intenta de nuevo."
        );
      }

      this.campeones = datos;

      // Arreglo vacio: mensaje amable invitando a crear un campeon (Req. 11.4).
      if (this.campeones.length === 0) {
        this.lista.innerHTML = "";
        this.mostrarMensaje(
          "No hay campeones todavia. Invoca uno para empezar.",
          false
        );
        this.actualizarPista();
        this.actualizarBoton();
        return;
      }

      // Hay campeones: ocultar el mensaje y renderizar la lista.
      this.ocultarMensaje();
      this.renderizarLista();

      // Preselecciona al campeon recien creado (si llego de InvocacionScene).
      if (this.campeonCreado) {
        const id = this.idDe(this.campeonCreado);
        if (this.campeones.some((c) => this.idDe(c) === id)) {
          this.alternarSeleccion(id);
        }
      }

      this.actualizarPista();
      this.actualizarBoton();
    } catch (error) {
      // Fallo de red o HTTP 500: mensaje de error en espanol (Requisito 11.5).
      this.lista.innerHTML = "";
      this.mostrarMensaje(
        error && error.message
          ? error.message
          : "No pudimos cargar los campeones. Intenta de nuevo.",
        true
      );
    }
  }

  // Renderiza una tarjeta por cada campeon dentro de la rejilla de la lista.
  // Cada tarjeta lleva data-id para poder identificarla en el click delegado.
  renderizarLista() {
    this.lista.innerHTML = this.campeones
      .map((campeon) => this.plantillaTarjeta(campeon))
      .join("");
  }

  // Construye el HTML de la tarjeta de un campeon: cabecera (nombre + circulo de
  // colores), estadisticas con barras y habilidades como etiquetas.
  plantillaTarjeta(campeon) {
    const id = this.idDe(campeon);
    const nombre = this.escapar(campeon && campeon.nombre) || "Campeón";
    const estad = (campeon && campeon.estadisticas) || {};

    // Circulo dividido en dos mitades con el color principal y el secundario.
    const principal = this.colorSeguro(campeon && campeon.colorPrincipal);
    const secundario = this.colorSeguro(campeon && campeon.colorSecundario);
    const estiloColores =
      `background:linear-gradient(135deg, ${principal} 0%, ${principal} 50%, ` +
      `${secundario} 50%, ${secundario} 100%)`;

    // Estadisticas con barras, cada una escalada a su rango.
    const estadisticasHtml = RANGOS_ESTADISTICAS.map((rango) => {
      const valor = estad[rango.clave];
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
    }).join("");

    // Habilidades como etiquetas tipo "chip".
    const habilidades = Array.isArray(campeon && campeon.habilidades)
      ? campeon.habilidades
      : [];
    const habilidadesHtml = habilidades.length
      ? habilidades
          .map(
            (h) => `<span class="habilidad-etiqueta">${this.escapar(h)}</span>`
          )
          .join("")
      : `<span class="habilidad-etiqueta">Sin habilidades</span>`;

    return (
      `<li class="tarjeta-seleccion" data-id="${this.escapar(id)}" ` +
      `role="button" aria-pressed="false" tabindex="0">` +
      `<div class="seleccion-cabecera">` +
      `<h2 class="seleccion-nombre">${nombre}</h2>` +
      `<span class="seleccion-colores" role="img" ` +
      `aria-label="Colores de ${nombre}" style="${estiloColores}"></span>` +
      `</div>` +
      `<div class="seleccion-estadisticas">${estadisticasHtml}</div>` +
      `<div class="seleccion-habilidades">${habilidadesHtml}</div>` +
      `</li>`
    );
  }

  // Alterna la seleccion de un campeon respetando el maximo de dos distintos.
  alternarSeleccion(id) {
    const yaSeleccionado = this.seleccionados.includes(id);

    if (yaSeleccionado) {
      // Deselecciona el campeon.
      this.seleccionados = this.seleccionados.filter((otro) => otro !== id);
    } else {
      // Solo se permiten dos; si ya hay dos, ignora el nuevo click y avisa.
      if (this.seleccionados.length >= 2) {
        this.actualizarPista(
          "Ya elegiste dos campeones. Deselecciona uno para cambiar."
        );
        return;
      }
      this.seleccionados.push(id);
    }

    // Refresca el resaltado de las tarjetas, la pista y el boton.
    this.actualizarResaltado();
    this.actualizarPista();
    this.actualizarBoton();
  }

  // Aplica/quita la clase "seleccionada" a cada tarjeta segun el estado actual.
  actualizarResaltado() {
    if (!this.lista) {
      return;
    }
    const tarjetas = this.lista.querySelectorAll(".tarjeta-seleccion");
    tarjetas.forEach((tarjeta) => {
      const seleccionada = this.seleccionados.includes(tarjeta.dataset.id);
      tarjeta.classList.toggle("seleccionada", seleccionada);
      tarjeta.setAttribute("aria-pressed", seleccionada ? "true" : "false");
    });
  }

  // Actualiza el texto de la pista segun cuantos campeones faltan por elegir.
  // Admite un mensaje explicito opcional (p. ej. al intentar elegir un tercero).
  actualizarPista(mensajeExplicito) {
    if (!this.pista) {
      return;
    }
    if (mensajeExplicito) {
      this.pista.textContent = mensajeExplicito;
      return;
    }
    const faltan = 2 - this.seleccionados.length;
    if (this.campeones.length === 0) {
      this.pista.textContent = "";
    } else if (faltan === 2) {
      this.pista.textContent = "Selecciona dos campeones para pelear.";
    } else if (faltan === 1) {
      this.pista.textContent = "Selecciona un campeon mas.";
    } else {
      this.pista.textContent = "Listo: pulsa Iniciar combate.";
    }
  }

  // Habilita el boton de confirmar solo cuando hay exactamente dos campeones
  // distintos seleccionados; en caso contrario lo deshabilita.
  actualizarBoton() {
    if (!this.boton) {
      return;
    }
    this.boton.disabled = this.seleccionados.length !== 2;
  }

  // Al confirmar: valida que haya dos campeones distintos y arranca ArenaScene
  // pasando ambos campeones para iniciar el combate (Requisito 6.1).
  confirmarSeleccion() {
    // Doble verificacion: exactamente dos campeones distintos seleccionados.
    if (this.seleccionados.length !== 2) {
      this.actualizarPista("Debes seleccionar exactamente dos campeones.");
      return;
    }

    const campeonA = this.campeonPorId(this.seleccionados[0]);
    const campeonB = this.campeonPorId(this.seleccionados[1]);

    // Si por algun motivo no se resuelven los objetos, no transiciona.
    if (!campeonA || !campeonB) {
      this.mostrarMensaje(
        "No pudimos preparar el combate. Intenta de nuevo.",
        true
      );
      return;
    }

    // Oculta el overlay e inicia la arena con los dos campeones elegidos.
    if (this.overlay) {
      this.overlay.classList.remove("visible");
    }
    this.scene.start("ArenaScene", { campeonA, campeonB });
  }

  // Devuelve un identificador estable para un campeon (id, o nombre de respaldo).
  idDe(campeon) {
    if (!campeon) {
      return "";
    }
    if (campeon.id != null) {
      return String(campeon.id);
    }
    return `nombre:${campeon.nombre || ""}`;
  }

  // Busca el objeto campeon por su identificador dentro de la lista cargada.
  campeonPorId(id) {
    return this.campeones.find((campeon) => this.idDe(campeon) === id) || null;
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

  // Al apagar la escena: elimina los listeners y oculta el overlay para que no
  // quede visible ni activo durante las demas escenas.
  alApagar() {
    if (this.boton && this.alIniciar) {
      this.boton.removeEventListener("click", this.alIniciar);
    }
    if (this.lista && this.alClickLista) {
      this.lista.removeEventListener("click", this.alClickLista);
    }
    if (this.overlay) {
      this.overlay.classList.remove("visible");
    }
    this.alIniciar = null;
    this.alClickLista = null;
  }
}
