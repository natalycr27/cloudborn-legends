// SeleccionScene: lista los campeones disponibles y permite elegir dos.
//
// Responsabilidades (tarea 8.3):
//   - Llamar a GET /campeones y mostrar todos los campeones almacenados como
//     una lista de tarjetas (Requisitos 11.1 / 11.2).
//   - Mostrar cada campeon con su nombre, las cuatro estadisticas (Vida, Daño,
//     Velocidad, Armadura) y sus dos colores como un circulo partido en dos
//     mitades (Requisitos 11.3 / 11.4).
//   - Manejar el arreglo vacio con un mensaje amable en espanol y los fallos
//     de red / HTTP 500 con un mensaje de error en espanol (Requisito 11.2 y
//     tolerancia a fallos del endpoint).
//   - Permitir seleccionar exactamente DOS campeones distintos y, al confirmar,
//     iniciar ArenaScene pasando ambos campeones para comenzar el combate
//     (Requisito 6.1). Mientras no haya dos seleccionados, mostrar una pista en
//     espanol y mantener el boton de confirmar deshabilitado.
//
// Nota de diseno: esta escena es autocontenida y se renderiza con objetos
// nativos de Phaser (texto, rectangulos, graficos). No usa overlay HTML, por lo
// que no necesita tocar index.html ni limpiar listeners del DOM. La escena
// previa (InvocacionScene) la arranca con { campeonCreado } para poder resaltar
// al campeon recien invocado.

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

// Paleta reutilizada (coincide con index.html / las demas escenas).
const COLOR_FONDO = "#0b1020";
const COLOR_TARJETA = 0x141a33;
const COLOR_BORDE = 0x3a4a7a;
const COLOR_BORDE_SELECCION = 0x4f6bff;
const COLOR_RIEL = 0x0b1020;
const COLOR_RELLENO = 0x4f6bff;
const COLOR_TEXTO = "#e8eefc";
const COLOR_TEXTO_TENUE = "#9fb0d8";
const COLOR_ERROR = "#ff7a7a";

export default class SeleccionScene extends Phaser.Scene {
  // Registra la escena con la clave "SeleccionScene" usada por main.js.
  constructor() {
    super("SeleccionScene");

    // Campeon recien creado por InvocacionScene (para resaltarlo si llega).
    this.campeonCreado = null;

    // Estado de datos y seleccion.
    this.campeones = [];
    // Ids de los campeones seleccionados, en orden de seleccion (maximo 2).
    this.seleccionados = [];

    // Objetos de UI persistentes.
    this.contenedorLista = null;
    this.textoMensaje = null;
    this.textoPista = null;
    this.botonConfirmar = null;
    this.textoBotonConfirmar = null;
    // Mapa id -> referencias graficas de cada tarjeta (para re-estilizar).
    this.tarjetasPorId = new Map();
  }

  // Lee los datos entrantes de la escena previa antes de create().
  init(data) {
    // InvocacionScene arranca esta escena con { campeonCreado }.
    this.campeonCreado = data && data.campeonCreado ? data.campeonCreado : null;
    // Reinicia el estado por si la escena se reutiliza.
    this.campeones = [];
    this.seleccionados = [];
    this.tarjetasPorId = new Map();
  }

  // Dibuja la cabecera fija y lanza la carga de campeones desde la API.
  create() {
    const { width } = this.scale;

    // Fondo solido para que la escena no herede residuos de otras escenas.
    this.cameras.main.setBackgroundColor(COLOR_FONDO);

    // Titulo de la pantalla.
    this.add
      .text(width / 2, 36, "Elige dos campeones", {
        fontFamily: "sans-serif",
        fontSize: "28px",
        fontStyle: "bold",
        color: COLOR_TEXTO,
      })
      .setOrigin(0.5);

    // Pista dinamica que indica cuantos campeones faltan por seleccionar.
    this.textoPista = this.add
      .text(width / 2, 70, "", {
        fontFamily: "sans-serif",
        fontSize: "15px",
        color: COLOR_TEXTO_TENUE,
      })
      .setOrigin(0.5);

    // Mensaje central para estados de carga / vacio / error.
    this.textoMensaje = this.add
      .text(width / 2, 260, "Cargando campeones...", {
        fontFamily: "sans-serif",
        fontSize: "18px",
        color: COLOR_TEXTO_TENUE,
        align: "center",
        wordWrap: { width: width - 80 },
      })
      .setOrigin(0.5);

    // Contenedor que agrupa las tarjetas de campeones (facilita limpiarlas).
    this.contenedorLista = this.add.container(0, 0);

    // Boton de confirmar (inicialmente deshabilitado hasta tener dos).
    this.crearBotonConfirmar();

    // Pide los campeones a la API.
    this.cargarCampeones();
  }

  // Crea el boton "Iniciar combate" en la parte inferior de la pantalla.
  crearBotonConfirmar() {
    const { width, height } = this.scale;
    const anchoBoton = 240;
    const altoBoton = 48;
    const x = width / 2;
    const y = height - 40;

    // Fondo del boton como rectangulo redondeado interactivo.
    this.botonConfirmar = this.add
      .rectangle(x, y, anchoBoton, altoBoton, COLOR_BORDE_SELECCION)
      .setStrokeStyle(2, COLOR_BORDE_SELECCION)
      .setInteractive({ useHandCursor: true });

    // Etiqueta del boton.
    this.textoBotonConfirmar = this.add
      .text(x, y, "Iniciar combate", {
        fontFamily: "sans-serif",
        fontSize: "18px",
        fontStyle: "bold",
        color: COLOR_TEXTO,
      })
      .setOrigin(0.5);

    // Al pulsar: solo inicia el combate si hay exactamente dos seleccionados.
    this.botonConfirmar.on("pointerup", () => this.confirmarSeleccion());

    // Estado visual inicial: deshabilitado.
    this.actualizarBotonConfirmar();
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
        this.mostrarMensaje(
          "No hay campeones todavia. Invoca uno para empezar.",
          false
        );
        this.actualizarPista();
        this.actualizarBotonConfirmar();
        return;
      }

      // Hay campeones: ocultar el mensaje y renderizar la lista.
      this.ocultarMensaje();
      this.renderizarLista();
      this.actualizarPista();
      this.actualizarBotonConfirmar();
    } catch (error) {
      // Fallo de red o HTTP 500: mensaje de error en espanol (Requisito 11.5).
      this.mostrarMensaje(
        error && error.message
          ? error.message
          : "No pudimos cargar los campeones. Intenta de nuevo.",
        true
      );
    }
  }

  // Renderiza una tarjeta por cada campeon dentro del contenedor de la lista.
  renderizarLista() {
    // Limpia cualquier tarjeta previa antes de volver a dibujar.
    this.contenedorLista.removeAll(true);
    this.tarjetasPorId = new Map();

    const { width } = this.scale;

    // Disposicion en rejilla: hasta 3 columnas segun el ancho disponible.
    const margen = 24;
    const separacion = 16;
    const anchoDisponible = width - margen * 2;
    const columnas = Math.max(1, Math.min(3, Math.floor(anchoDisponible / 240)));
    const anchoTarjeta = Math.floor(
      (anchoDisponible - separacion * (columnas - 1)) / columnas
    );
    const altoTarjeta = 190;
    const filaInicialY = 100;

    this.campeones.forEach((campeon, indice) => {
      const columna = indice % columnas;
      const fila = Math.floor(indice / columnas);
      const x = margen + columna * (anchoTarjeta + separacion);
      const y = filaInicialY + fila * (altoTarjeta + separacion);
      this.crearTarjetaCampeon(campeon, x, y, anchoTarjeta, altoTarjeta);
    });
  }

  // Dibuja la tarjeta de un campeon: fondo, nombre, circulo de colores y las
  // cuatro estadisticas con barras. La tarjeta es interactiva para alternar su
  // seleccion.
  crearTarjetaCampeon(campeon, x, y, ancho, alto) {
    // Identificador estable del campeon (usa id, o el nombre como respaldo).
    const id = this.idDe(campeon);

    // Fondo de la tarjeta (origen en la esquina superior izquierda).
    const fondo = this.add
      .rectangle(x, y, ancho, alto, COLOR_TARJETA)
      .setOrigin(0, 0)
      .setStrokeStyle(2, COLOR_BORDE)
      .setInteractive({ useHandCursor: true });

    // Nombre del campeon (truncado por el ancho disponible).
    const nombre = this.add
      .text(x + 14, y + 12, campeon.nombre || "Campeon", {
        fontFamily: "sans-serif",
        fontSize: "18px",
        fontStyle: "bold",
        color: COLOR_TEXTO,
        wordWrap: { width: ancho - 70 },
      })
      .setOrigin(0, 0);

    // Circulo partido en dos mitades con el color principal y el secundario
    // (Requisito 11.3). Se usan graficos de Phaser con colores numericos.
    const radio = 16;
    const cx = x + ancho - 14 - radio;
    const cy = y + 12 + radio;
    const colores = this.add.graphics();
    this.dibujarCirculoColores(
      colores,
      cx,
      cy,
      radio,
      campeon.colorPrincipal,
      campeon.colorSecundario
    );

    // Estadisticas: etiqueta en espanol, valor y barra normalizada al rango.
    const objetosEstadisticas = [];
    const estad = campeon.estadisticas || {};
    let filaY = y + 58;
    const anchoBarra = ancho - 28;
    RANGOS_ESTADISTICAS.forEach((rango) => {
      const valor = typeof estad[rango.clave] === "number" ? estad[rango.clave] : null;
      const porcentaje =
        valor == null
          ? 0
          : Math.max(0, Math.min(1, (valor - rango.min) / (rango.max - rango.min)));

      // Etiqueta "Vida" y valor numerico alineado a la derecha.
      const etiqueta = this.add
        .text(x + 14, filaY, rango.etiqueta, {
          fontFamily: "sans-serif",
          fontSize: "12px",
          color: COLOR_TEXTO_TENUE,
        })
        .setOrigin(0, 0);
      const textoValor = this.add
        .text(x + ancho - 14, filaY, valor == null ? "-" : String(valor), {
          fontFamily: "sans-serif",
          fontSize: "12px",
          color: COLOR_TEXTO,
        })
        .setOrigin(1, 0);

      // Riel de la barra y su relleno proporcional al porcentaje.
      const riel = this.add
        .rectangle(x + 14, filaY + 18, anchoBarra, 6, COLOR_RIEL)
        .setOrigin(0, 0)
        .setStrokeStyle(1, COLOR_BORDE);
      const relleno = this.add
        .rectangle(x + 14, filaY + 18, Math.max(1, anchoBarra * porcentaje), 6, COLOR_RELLENO)
        .setOrigin(0, 0);

      objetosEstadisticas.push(etiqueta, textoValor, riel, relleno);
      filaY += 30;
    });

    // Agrupa todos los objetos de la tarjeta en el contenedor de la lista.
    this.contenedorLista.add([fondo, nombre, colores, ...objetosEstadisticas]);

    // Guarda referencias para poder resaltar la tarjeta al seleccionarla.
    this.tarjetasPorId.set(id, { fondo, campeon });

    // Click en cualquier parte de la tarjeta alterna su seleccion.
    fondo.on("pointerup", () => this.alternarSeleccion(id));

    // Si este es el campeon recien creado, lo preselecciona y resalta.
    if (this.campeonCreado && this.idDe(this.campeonCreado) === id) {
      this.alternarSeleccion(id);
    }
  }

  // Dibuja en `g` un circulo dividido en dos mitades verticales con el color
  // principal (izquierda) y el secundario (derecha), mas un borde.
  dibujarCirculoColores(g, cx, cy, radio, colorPrincipal, colorSecundario) {
    const principal = this.colorAEntero(colorPrincipal);
    const secundario = this.colorAEntero(colorSecundario);

    // Mitad izquierda con el color principal.
    g.fillStyle(principal, 1);
    g.slice(cx, cy, radio, Phaser.Math.DegToRad(90), Phaser.Math.DegToRad(270), false);
    g.fillPath();

    // Mitad derecha con el color secundario.
    g.fillStyle(secundario, 1);
    g.slice(cx, cy, radio, Phaser.Math.DegToRad(270), Phaser.Math.DegToRad(90), false);
    g.fillPath();

    // Borde del circulo para separarlo del fondo.
    g.lineStyle(2, COLOR_BORDE, 1);
    g.strokeCircle(cx, cy, radio);
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
    this.actualizarBotonConfirmar();
  }

  // Resalta las tarjetas seleccionadas con un borde destacado y las demas con
  // el borde normal.
  actualizarResaltado() {
    this.tarjetasPorId.forEach((ref, id) => {
      const seleccionado = this.seleccionados.includes(id);
      ref.fondo.setStrokeStyle(
        seleccionado ? 4 : 2,
        seleccionado ? COLOR_BORDE_SELECCION : COLOR_BORDE
      );
    });
  }

  // Actualiza el texto de la pista segun cuantos campeones faltan por elegir.
  // Admite un mensaje explicito opcional (p. ej. al intentar elegir un tercero).
  actualizarPista(mensajeExplicito) {
    if (!this.textoPista) {
      return;
    }
    if (mensajeExplicito) {
      this.textoPista.setText(mensajeExplicito);
      return;
    }
    const faltan = 2 - this.seleccionados.length;
    if (this.campeones.length === 0) {
      this.textoPista.setText("");
    } else if (faltan === 2) {
      this.textoPista.setText("Selecciona dos campeones para pelear.");
    } else if (faltan === 1) {
      this.textoPista.setText("Selecciona un campeon mas.");
    } else {
      this.textoPista.setText("Listo: pulsa Iniciar combate.");
    }
  }

  // Habilita el boton de confirmar solo cuando hay exactamente dos campeones
  // distintos seleccionados; en caso contrario lo atenua y lo deshabilita.
  actualizarBotonConfirmar() {
    if (!this.botonConfirmar || !this.textoBotonConfirmar) {
      return;
    }
    const listo = this.seleccionados.length === 2;
    if (listo) {
      this.botonConfirmar.setFillStyle(COLOR_BORDE_SELECCION);
      this.botonConfirmar.setAlpha(1);
      this.textoBotonConfirmar.setAlpha(1);
      this.botonConfirmar.setInteractive({ useHandCursor: true });
    } else {
      this.botonConfirmar.setFillStyle(COLOR_TARJETA);
      this.botonConfirmar.setAlpha(0.6);
      this.textoBotonConfirmar.setAlpha(0.6);
      this.botonConfirmar.disableInteractive();
    }
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

    // Inicia la arena con los dos campeones elegidos.
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

  // Convierte un color "#rrggbb" a entero para Phaser; si no es valido devuelve
  // un gris neutro, evitando inyectar valores arbitrarios (sanitizacion).
  colorAEntero(color) {
    if (typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color.trim())) {
      return parseInt(color.trim().slice(1), 16);
    }
    // Gris neutro por defecto (equivale a #6b7280).
    return 0x6b7280;
  }

  // Muestra el mensaje central (carga / vacio / error) y oculta la lista cuando
  // corresponde. `esError` cambia el color a rojo.
  mostrarMensaje(texto, esError) {
    if (this.contenedorLista) {
      this.contenedorLista.removeAll(true);
    }
    if (this.textoMensaje) {
      this.textoMensaje.setText(texto);
      this.textoMensaje.setColor(esError ? COLOR_ERROR : COLOR_TEXTO_TENUE);
      this.textoMensaje.setVisible(true);
    }
  }

  // Oculta el mensaje central (cuando se va a mostrar la lista de campeones).
  ocultarMensaje() {
    if (this.textoMensaje) {
      this.textoMensaje.setVisible(false);
    }
  }
}
