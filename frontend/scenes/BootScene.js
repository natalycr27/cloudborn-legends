// BootScene: escena de arranque del juego.
//
// Responsabilidades (tarea 8.2):
//   - Realizar la carga inicial (assets base) del juego.
//   - Mostrar un breve rotulo de marca mientras arranca.
//   - Transicionar a InvocacionScene (flujo: BootScene -> InvocacionScene).
//
// El juego no depende de imagenes externas todavia (los campeones se dibujan
// con graficos generados por colores en la arena), por lo que la fase de carga
// es minima y sirve principalmente como punto de entrada estable del flujo.

export default class BootScene extends Phaser.Scene {
  // Registra la escena con la clave "BootScene" usada por main.js.
  constructor() {
    super("BootScene");
  }

  // Carga inicial de assets. De momento no hay archivos externos que cargar,
  // pero se deja preload como punto unico donde agregar assets en el futuro
  // sin tocar el resto del flujo de escenas.
  preload() {
    // Sin assets externos por ahora: los campeones se renderizan con formas y
    // colores generados en tiempo de ejecucion (ver ArenaScene y combat.js).
  }

  // Al terminar la carga, muestra un titulo breve y pasa a la pantalla de
  // invocacion. Se usa un pequeno retraso para que el rotulo de marca sea
  // visible sin bloquear el arranque del juego.
  create() {
    const { width, height } = this.scale;

    // Rotulo de marca centrado mientras se completa el arranque.
    this.add
      .text(width / 2, height / 2, "Cloudborn Legends", {
        fontFamily: "sans-serif",
        fontSize: "32px",
        color: "#e8eefc",
      })
      .setOrigin(0.5);

    // Transicion a InvocacionScene tras una breve pausa (flujo del juego).
    this.time.delayedCall(600, () => {
      this.scene.start("InvocacionScene");
    });
  }
}
