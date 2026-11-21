import './styles/main.css';
import './engine/terrain-engine.js';

/** Application entry point. The legacy engine is isolated behind this module boundary. */
const appRoot = document.body;

if (!appRoot) {
  throw new Error('Terrain application root is missing.');
}

console.info('[Terrain] Vite + TypeScript application bootstrapped.');
