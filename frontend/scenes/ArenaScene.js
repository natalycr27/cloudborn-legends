// ArenaScene: arena de combate que orquesta combat.js y renderiza el estado.
//
// NOTA (tarea 8.1): implementacion minima (stub). El game loop con paso fijo,
// el renderizado de sprites y barras de vida, los efectos de habilidades y el
// flujo de resultado/narracion se implementan en las tareas 8.4a-8.4c.

export default class ArenaScene extends Phaser.Scene {
  // Registra la escena con la clave "ArenaScene" usada por main.js.
  constructor() {
    super("ArenaScene");
  }

  // Dibuja un rotulo temporal mientras la escena completa se implementa.
  create() {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2, "Arena", {
        fontFamily: "sans-serif",
        fontSize: "24px",
        color: "#e8eefc",
      })
      .setOrigin(0.5);
  }
}
