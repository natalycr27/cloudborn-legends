// BootScene: escena de arranque del juego.
//
// NOTA (tarea 8.1): esta es una implementacion minima (stub) que solo transiciona
// a la escena de invocacion para que main.js arranque sin errores. La carga real
// de assets y la configuracion inicial se implementan en la tarea 8.2.

export default class BootScene extends Phaser.Scene {
  // Registra la escena con la clave "BootScene" usada por main.js.
  constructor() {
    super("BootScene");
  }

  // Al crearse, muestra un titulo breve y pasa a la pantalla de invocacion.
  create() {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2, "Cloudborn Legends", {
        fontFamily: "sans-serif",
        fontSize: "32px",
        color: "#e8eefc",
      })
      .setOrigin(0.5);

    // Transicion a InvocacionScene (flujo: BootScene -> InvocacionScene).
    this.scene.start("InvocacionScene");
  }
}
