// SeleccionScene: lista los campeones disponibles y permite elegir dos.
//
// NOTA (tarea 8.1): implementacion minima (stub). La llamada a GET /campeones,
// el listado y la seleccion de dos campeones se implementan en la tarea 8.3.

export default class SeleccionScene extends Phaser.Scene {
  // Registra la escena con la clave "SeleccionScene" usada por main.js.
  constructor() {
    super("SeleccionScene");
  }

  // Dibuja un rotulo temporal mientras la escena completa se implementa.
  create() {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2, "Seleccion de campeones", {
        fontFamily: "sans-serif",
        fontSize: "24px",
        color: "#e8eefc",
      })
      .setOrigin(0.5);
  }
}
