import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { QuadtreeTerrain } from './terrain/QuadtreeTerrain.ts';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app root');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9dc7e1);
scene.fog = new THREE.Fog(0x9dc7e1, 1800, 9000);
scene.add(new THREE.HemisphereLight(0xffffff, 0x52604b, 1.8));

const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-600, 900, 450);
scene.add(sun);

// The planet root is the local coordinate frame. It may orbit/translate in the
// solar-system scene while terrain chunks remain fixed relative to this object.
const planetRoot = new THREE.Group();
scene.add(planetRoot);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 30000);
camera.position.set(520, 420, 620);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.domElement.setAttribute('aria-label', 'Interactive quadtree terrain preview');
app.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.enablePan = true;
controls.screenSpacePanning = true;
controls.minDistance = 35;
controls.maxDistance = 12000;
controls.maxPolarAngle = Math.PI * 0.49;
controls.update();

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

const terrain = new QuadtreeTerrain(planetRoot);
const stats = document.createElement('aside');
stats.className = 'debug-panel';
stats.innerHTML = `
  <strong>QUADTREE TERRAIN</strong>
  <div class="debug-subtitle">Адаптивные чанки · planet-local coordinates</div>
  <div class="terrain-stats">
    <span>Активные чанки</span><b id="chunk-count">0</b>
  </div>
  <div class="controls-help">
    <b>Управление камерой</b>
    <span>ЛКМ — вращение</span>
    <span>Колесо — приближение</span>
    <span>ПКМ / Shift + ЛКМ — перемещение</span>
  </div>
`;
document.body.appendChild(stats);
const chunkCount = stats.querySelector<HTMLElement>('#chunk-count');

function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  terrain.update(camera);
  if (chunkCount) chunkCount.textContent = String(terrain.renderer.activeChunkCount);
  renderer.render(scene, camera);
}
animate();

window.addEventListener('beforeunload', () => {
  resizeObserver.disconnect();
  terrain.dispose();
  renderer.dispose();
});
