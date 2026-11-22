import './style.css';
import { CharacterTest } from './viewport/CharacterTest';

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;
const characterTest = new CharacterTest(canvas);
characterTest.start();

const readout = document.querySelector<HTMLElement>('#readout');
if (readout) readout.textContent = 'WASD MOVE · CLICK TO CAPTURE MOUSE · MOUSE LOOK';
window.addEventListener('beforeunload', () => characterTest.dispose());
