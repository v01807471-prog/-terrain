import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Terrain } from '../engine/terrain/Terrain.js';
import { PhysicsWorld } from '../engine/physics/PhysicsWorld.js';
import { FixedStepLoop } from '../engine/physics/FixedStepLoop.js';
import './physics-demo.css';

const root = document.querySelector<HTMLDivElement>('#physics-v2-root');
if (!root) throw new Error('Не найден контейнер Physics V2');

root.innerHTML = `
  <main class="pv2-shell">
    <section class="pv2-main">
      <header class="pv2-header">
        <div>
          <div class="pv2-eyebrow">TERRAIN ENGINE · EXPERIMENTAL BRANCH</div>
          <h1 class="pv2-title">Физика V2</h1>
          <p class="pv2-subtitle">Отдельная песочница нового физического слоя. Смотри, как сфера падает, касается процедурного рельефа, катится по склону и реагирует на трение.</p>
        </div>
        <span class="pv2-status">● LEGACY НЕ ИЗМЕНЁН</span>
      </header>
      <div class="pv2-viewport" id="pv2-viewport">
        <div class="pv2-overlay">
          <span class="pv2-chip">Симуляция: <b id="pv2-state">запущена</b></span>
          <span class="pv2-chip">Физика: <b>60 шагов/с</b></span>
        </div>
        <div class="pv2-hint">ЛКМ — вращать · колёсико — приблизить · ПКМ — переместить камеру</div>
      </div>
    </section>
    <aside class="pv2-side">
      <section class="pv2-panel">
        <h2>Управление</h2>
        <div class="pv2-buttons">
          <button class="pv2-button primary" id="pv2-reset">↻ Сначала</button>
          <button class="pv2-button" id="pv2-pause">Ⅱ Пауза</button>
          <button class="pv2-button" id="pv2-drop">↓ Уронить шар</button>
          <button class="pv2-button" id="pv2-camera">◎ Камера</button>
        </div>
        <p class="pv2-note">«Уронить шар» создаёт ещё одну сферу над склоном. Можно наблюдать несколько тел одновременно.</p>
      </section>
      <section class="pv2-panel">
        <h2>Показания симуляции</h2>
        <div class="pv2-statgrid">
          <div class="pv2-stat"><span>Сфер в сцене</span><b id="pv2-bodies">1</b></div>
          <div class="pv2-stat"><span>Скорость шара</span><b id="pv2-speed">0.0 м/с</b></div>
          <div class="pv2-stat"><span>Высота центра</span><b id="pv2-height">— м</b></div>
          <div class="pv2-stat"><span>Контакт с землёй</span><b id="pv2-contact">нет</b></div>
          <div class="pv2-stat"><span>FPS рендера</span><b id="pv2-fps">—</b></div>
          <div class="pv2-stat"><span>Шагов физики</span><b id="pv2-steps">0</b></div>
        </div>
      </section>
      <section class="pv2-panel">
        <h2>Параметры тела</h2>
        <div class="pv2-control">
          <label for="pv2-friction">Трение <output id="pv2-friction-value">0.65</output></label>
          <input id="pv2-friction" type="range" min="0" max="1.5" step="0.05" value="0.65">
        </div>
        <div class="pv2-control">
          <label for="pv2-bounce">Упругость <output id="pv2-bounce-value">0.12</output></label>
          <input id="pv2-bounce" type="range" min="0" max="0.9" step="0.03" value="0.12">
        </div>
        <p class="pv2-note">Параметры применяются к новым сферам. Трение ограничивает скольжение в контакте, упругость задаёт отскок.</p>
      </section>
      <section class="pv2-panel">
        <h2>Что здесь проверяется</h2>
        <div class="pv2-legend"><span><i class="pv2-dot"></i>Процедурный рельеф</span><span><i class="pv2-dot" style="background:#f4b86a"></i>Физические сферы</span></div>
        <p class="pv2-note">Terrain вычисляет высоту по координатам. PhysicsWorld получает эти значения для контакта. FixedStepLoop отделяет стабильный шаг физики от частоты кадров.</p>
        <p class="pv2-footer">Это ранний прототип: контакт со склоном приближён выборкой девяти точек. Полный CCD и столкновения сфер друг с другом пока не реализованы.</p>
      </section>
    </aside>
  </main>
`;

const viewport = document.querySelector<HTMLDivElement>('#pv2-viewport')!;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#91aeb4');
scene.fog = new THREE.Fog('#91aeb4', 65, 180);
const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 350);
camera.position.set(27, 25, 34);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
viewport.prepend(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 4, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 9;
controls.maxDistance = 100;

scene.add(new THREE.HemisphereLight('#e5f5f1', '#38464a', 2.0));
const sun = new THREE.DirectionalLight('#fff0d5', 3.1);
sun.position.set(-25, 42, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -55;
sun.shadow.camera.right = 55;
sun.shadow.camera.top = 55;
sun.shadow.camera.bottom = -55;
scene.add(sun);

const terrain = new Terrain((x, z) =>
  2.5 - x * 0.19 +
  Math.sin(z * 0.075) * 1.15 +
  Math.sin(x * 0.055 + z * 0.035) * 0.9 +
  Math.sin(z * 0.19 + x * 0.025) * 0.22,
  { seed: 17, editCellSize: 0.5, editChunkSize: 32, normalSampleDistance: 0.35 }
);

const terrainSize = 150;
const segments = 180;
const terrainGeometry = new THREE.PlaneGeometry(terrainSize, terrainSize, segments, segments);
terrainGeometry.rotateX(-Math.PI / 2);
const positions = terrainGeometry.attributes.position as THREE.BufferAttribute;
const colors: number[] = [];
const color = new THREE.Color();
for (let i = 0; i < positions.count; i++) {
  const x = positions.getX(i);
  const z = positions.getZ(i);
  const y = terrain.getHeight(x, z);
  positions.setY(i, y);
  const tint = THREE.MathUtils.clamp((y + 8) / 26, 0, 1);
  color.setHSL(0.29 - tint * 0.12, 0.34 + tint * 0.12, 0.27 + tint * 0.22);
  colors.push(color.r, color.g, color.b);
}
terrainGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
terrainGeometry.computeVertexNormals();
const ground = new THREE.Mesh(terrainGeometry, new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.96, metalness: 0
}));
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(150, 75, '#536a67', '#536a67');
grid.position.y = -9;
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.2;
scene.add(grid);

const world = new PhysicsWorld(terrain, { fixedDelta: 1 / 60, maxSubSteps: 10, maxFrameDelta: 0.1 });
const loop = new FixedStepLoop(world, 1 / 60, 10, 0.1);
const meshes = new Map<string, THREE.Mesh>();
let nextId = 1;
let paused = false;
let friction = 0.65;
let restitution = 0.12;
let totalSteps = 0;

function createSphere(x: number, z: number, lift = 8): void {
  const id = `sphere-${nextId++}`;
  const radius = 1.15;
  const y = terrain.getHeight(x, z) + radius + lift;
  const body = world.addSphere({
    id, position: { x, y, z }, radius, mass: 1,
    friction, restitution, linearDamping: 0.008, angularDamping: 0.015
  });
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 40, 28),
    new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.09 + (nextId % 4) * 0.035, 0.78, 0.59), roughness: 0.28, metalness: 0.12 })
  );
  mesh.castShadow = true;
  mesh.position.set(body.position.x, body.position.y, body.position.z);
  scene.add(mesh);
  meshes.set(id, mesh);
  updateStats();
}

function clearSpheres(): void {
  for (const [id, mesh] of meshes) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    world.removeBody(id);
  }
  meshes.clear();
}

function reset(): void {
  clearSpheres();
  nextId = 1;
  loop.reset();
  totalSteps = 0;
  createSphere(-21, 0, 9);
  paused = false;
  setPauseLabel();
  camera.position.set(27, 25, 34);
  controls.target.set(0, 4, 0);
  controls.update();
}

function setPauseLabel(): void {
  document.querySelector('#pv2-pause')!.textContent = paused ? '▶ Продолжить' : 'Ⅱ Пауза';
  document.querySelector('#pv2-state')!.textContent = paused ? 'пауза' : 'запущена';
}

function updateStats(): void {
  document.querySelector('#pv2-bodies')!.textContent = String(world.bodies.size);
  const body = world.bodies.values().next().value;
  if (!body) return;
  const speed = Math.hypot(body.velocity.x, body.velocity.y, body.velocity.z);
  document.querySelector('#pv2-speed')!.textContent = `${speed.toFixed(1)} м/с`;
  document.querySelector('#pv2-height')!.textContent = `${body.position.y.toFixed(1)} м`;
  document.querySelector('#pv2-contact')!.textContent = body.grounded ? 'да' : 'нет';
  document.querySelector('#pv2-steps')!.textContent = String(totalSteps);
}

document.querySelector('#pv2-reset')!.addEventListener('click', reset);
document.querySelector('#pv2-pause')!.addEventListener('click', () => { paused = !paused; setPauseLabel(); });
document.querySelector('#pv2-drop')!.addEventListener('click', () => createSphere(-21 - Math.random() * 5, (Math.random() - 0.5) * 8, 12 + Math.random() * 7));
document.querySelector('#pv2-camera')!.addEventListener('click', () => {
  camera.position.set(27, 25, 34);
  controls.target.set(0, 4, 0);
  controls.update();
});
const frictionInput = document.querySelector<HTMLInputElement>('#pv2-friction')!;
const bounceInput = document.querySelector<HTMLInputElement>('#pv2-bounce')!;
frictionInput.addEventListener('input', () => {
  friction = Number(frictionInput.value);
  document.querySelector('#pv2-friction-value')!.textContent = friction.toFixed(2);
});
bounceInput.addEventListener('input', () => {
  restitution = Number(bounceInput.value);
  document.querySelector('#pv2-bounce-value')!.textContent = restitution.toFixed(2);
});

function resize(): void {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(viewport);
resize();

let previousTime = performance.now();
let fpsFrames = 0;
let fpsElapsed = 0;
let displayedFps = 0;
function animate(now: number): void {
  requestAnimationFrame(animate);
  const delta = Math.min((now - previousTime) / 1000, 0.1);
  previousTime = now;
  fpsFrames++;
  fpsElapsed += delta;
  if (fpsElapsed >= 0.5) {
    displayedFps = Math.round(fpsFrames / fpsElapsed);
    fpsFrames = 0;
    fpsElapsed = 0;
    document.querySelector('#pv2-fps')!.textContent = String(displayedFps);
  }
  if (!paused) {
    const result = loop.advance(delta);
    totalSteps += result.steps;
    for (const [id, mesh] of meshes) {
      const body = world.bodies.get(id);
      if (!body) continue;
      const p = world.getInterpolatedPosition(id, result.alpha);
      mesh.position.set(p.x, p.y, p.z);
      mesh.quaternion.set(body.orientation.x, body.orientation.y, body.orientation.z, body.orientation.w);
    }
  }
  updateStats();
  controls.update();
  renderer.render(scene, camera);
}
createSphere(-21, 0, 9);
requestAnimationFrame(animate);

window.addEventListener('beforeunload', () => {
  resizeObserver.disconnect();
  renderer.dispose();
  terrainGeometry.dispose();
});
