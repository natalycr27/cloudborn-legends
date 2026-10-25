// InvocacionScene: pantalla donde el jugador describe su campeon.
//
// NOTA (tarea 8.1): implementacion minima (stub) que solo muestra un rotulo.
// El overlay HTML (textarea, contador "X / 500", boton), la validacion en
// cliente y la llamada a POST /campeones se implementan en la tarea 8.2.

export default class InvocacionScene extends Phaser.Scene {
  // Registra la escena con la clave "InvocacionScene" usada por main.js.
  constructor() {
    super("InvocacionScene");
  }

  // Dibuja un rotulo temporal mientras la escena completa se implementa.
  create() {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2, "Invoca tu leyenda", {
        fontFamily: "sans-serif",
        fontSize: "28px",
        color: "#e8eefc",
      })
      .setOrigin(0.5);
  }
}
