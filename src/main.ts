import * as THREE from 'three';
import { ThreeClipmap } from './clipmap/ThreeClipmap.ts';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app root');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9dc7e1);
scene.fog = new THREE.Fog(0x9dc7e1, 220, 1100);
scene.add(new THREE.HemisphereLight(0xffffff, 0x52604b, 2.1));

const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(-120, 220, 90);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 5000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.domElement.setAttribute('aria-label', 'Interactive clipmap terrain preview');
app.appendChild(renderer.domElement);

function resizeRenderer(): void {
  const width = Math.max(1, app.clientWidth);
  const height = Math.max(1, app.clientHeight);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
const resizeObserver = new ResizeObserver(resizeRenderer);
resizeObserver.observe(app);
resizeRenderer();

const clipmap = new ThreeClipmap({ levels: 7, resolution: 64, baseCellSize: 1 });
scene.add(clipmap.group);

const center = new THREE.Vector2(0, 0);
const clock = new THREE.Clock();

function animate(): void {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();

  // Lower, shallower viewing angle: more terrain is visible and the horizon
  // no longer looks like a steep top-down inspection camera.
  camera.position.set(
    Math.cos(t * 0.10) * 115,
    34 + Math.sin(t * 0.17) * 4,
    Math.sin(t * 0.10) * 115
  );
  camera.lookAt(Math.cos(t * 0.10) * 24, 0, Math.sin(t * 0.10) * 24);
  clipmap.update(camera, center);
  renderer.render(scene, camera);
}
animate();

const panel = document.createElement('div');
panel.innerHTML = '<strong>CLIPMAP DEBUG VIEW</strong><div>7 nested levels · checker texture · wire grid</div><div>Camera is moving automatically</div><div>Dark grid = mesh topology · tiles = material UVs</div>';
Object.assign(panel.style, {
  position: 'fixed', left: '16px', top: '16px', padding: '12px 15px',
  color: '#f4f7fa', background: 'rgba(9, 19, 31, .82)', border: '1px solid #7893a8',
  borderRadius: '8px', font: '12px/1.65 ui-monospace, SFMono-Regular, monospace',
  boxShadow: '0 4px 18px #10203055', pointerEvents: 'none', zIndex: '2'
});
document.body.appendChild(panel);
