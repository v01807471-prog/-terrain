import './style.css';
import { PlanetViewport } from './viewport/PlanetViewport';
import { PlanetGui } from './ui/PlanetGui';

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;
const viewport = new PlanetViewport(canvas);
const gui = new PlanetGui(viewport, document.querySelector<HTMLElement>('#gui')!);
viewport.start();

const readout = document.querySelector<HTMLElement>('#readout');
const updateReadout = () => {
  const telemetry = viewport.getTelemetry();
  if (readout) {
    readout.textContent = telemetry.surfaceMode
      ? 'SURFACE MODE · WASD MOVE · SPACE JUMP · MOUSE LOOK'
      : 'ORBIT MODE · DRAG TO ROTATE · SCROLL TO ZOOM';
  }
  requestAnimationFrame(updateReadout);
};
updateReadout();

window.addEventListener('beforeunload', () => {
  gui.destroy();
  viewport.dispose();
});
