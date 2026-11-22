import './style.css';
import { CharacterTest } from './viewport/CharacterTest';

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;
const test = new CharacterTest(canvas);
test.start();

window.addEventListener('beforeunload', () => test.dispose());
