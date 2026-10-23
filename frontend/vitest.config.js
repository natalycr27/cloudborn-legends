// Configuracion de Vitest para el frontend de Cloudborn Legends.
// Usa el entorno "node" para poder importar el modulo de combate puro (src/combat.js)
// sin cargar Phaser ni el DOM del navegador, tal como exige el diseno.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Entorno Node.js: combat.js es logica pura y no depende de ventana/documento.
    environment: 'node',
    // Habilita describe/it/expect sin importarlos en cada archivo de prueba.
    globals: true,
    // Busca los archivos de prueba del frontend (combate y validacion de UI).
    include: ['**/*.{test,spec}.{js,mjs}'],
  },
});
