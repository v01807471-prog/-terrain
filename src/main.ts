import './style.css';
import { PlanetViewport } from './viewport/PlanetViewport';
import { PlanetGui } from './ui/PlanetGui';

const viewport = new PlanetViewport(document.querySelector<HTMLCanvasElement>('#viewport')!);
new PlanetGui(viewport, document.querySelector<HTMLDivElement>('#gui')!);
viewport.start();

const readout = document.querySelector<HTMLDivElement>('#readout')!;
function updateReadout() {
  const state = viewport.getTelemetry();
  readout.textContent = `ALT ${state.altitude.toFixed(0)} km  ·  RING ${state.rings}  ·  CAMERA LOD ${state.lod}`;
  requestAnimationFrame(updateReadout);
}
updateReadout();

window.addEventListener('beforeunload', () => viewport.dispose());
