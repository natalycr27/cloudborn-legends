// RankingScene: Salon de las Leyendas; muestra el ranking por victorias.
//
// NOTA (tarea 8.1): implementacion minima (stub). La llamada a GET /ranking,
// el listado ordenado y la responsividad global se implementan en la tarea 8.5.

export default class RankingScene extends Phaser.Scene {
  // Registra la escena con la clave "RankingScene" usada por main.js.
  constructor() {
    super("RankingScene");
  }

  // Dibuja un rotulo temporal mientras la escena completa se implementa.
  create() {
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height / 2, "Salon de las Leyendas", {
        fontFamily: "sans-serif",
        fontSize: "24px",
        color: "#e8eefc",
      })
      .setOrigin(0.5);
  }
}
