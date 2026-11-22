import * as THREE from 'three';
import { ThreeClipmap } from './clipmap/ThreeClipmap.ts';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app root');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9dc7e1);
scene.fog = new THREE.Fog(0x9dc7e1, 220, 1100);
scene.add(new THREE.HemisphereLight(0xffffff, 0x52604b, 2.1));

const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(-120, 220, 90);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 5000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
app.appendChild(renderer.domElement);

const clipmap = new ThreeClipmap({ levels: 7, resolution: 64, baseCellSize: 1 });
scene.add(clipmap.group);

const center = new THREE.Vector2(0, 0);
const clock = new THREE.Clock();

function animate(): void {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();

  // Move the actual camera so snapped clipmap origins visibly follow it.
  camera.position.set(Math.cos(t * 0.10) * 115, 78 + Math.sin(t * 0.17) * 9, Math.sin(t * 0.10) * 115);
  camera.lookAt(Math.cos(t * 0.10) * 22, 0, Math.sin(t * 0.10) * 22);
  clipmap.update(camera, center);
  renderer.render(scene, camera);
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const panel = document.createElement('div');
panel.innerHTML = '<strong>CLIPMAP DEBUG VIEW</strong><div>7 nested levels · checker texture · wire grid</div><div>Camera is moving automatically</div><div>Dark grid = mesh topology · tiles = material UVs</div>';
Object.assign(panel.style, {
  position: 'fixed', left: '16px', top: '16px', padding: '12px 15px',
  color: '#f4f7fa', background: 'rgba(9, 19, 31, .82)', border: '1px solid #7893a8',
  borderRadius: '8px', font: '12px/1.65 ui-monospace, SFMono-Regular, monospace',
  boxShadow: '0 4px 18px #10203055', pointerEvents: 'none'
});
document.body.appendChild(panel);
