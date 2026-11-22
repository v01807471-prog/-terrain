import './style.css';
import { PlanetViewport } from './viewport/PlanetViewport';
import { PlanetGui } from './ui/PlanetGui';

const viewport = new PlanetViewport(document.querySelector<HTMLCanvasElement>('#viewport')!);
new PlanetGui(viewport, document.querySelector<HTMLDivElement>('#gui')!);
viewport.start();

const readout = document.querySelector<HTMLDivElement>('#readout')!;
function updateReadout() {
  const state = viewport.getTelemetry();
  readout.textContent = state.testMode ? `FLAT TEST · CAMERA ${state.altitude.toFixed(2)} km FROM PATCH · WORLD OFFSET ${state.testOffset.toLocaleString()} km` : `ALT ${state.altitude.toFixed(2)} km  ·  LEVELS ${state.levels}  ·  LOD ${state.lod}  ·  TRIANGLES ${state.triangles.toLocaleString()}${state.surfaceMode ? '  ·  WASD MOVE  ·  MOUSE LOOK  ·  SPACE JUMP  ·  SHIFT SPRINT  ·  SCROLL OUT TO ORBIT' : ''}`;
  requestAnimationFrame(updateReadout);
}
updateReadout();

window.addEventListener('beforeunload', () => viewport.dispose());
