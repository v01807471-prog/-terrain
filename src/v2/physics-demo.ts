import * as THREE from 'three';
import { Terrain } from '../engine/terrain/Terrain.js';
import { createDefaultTerrainGraph, compileTerrainGraph } from '../engine/blueprint/graph.js';
import { TerrainRenderer } from '../engine/renderer/TerrainRenderer.js';
import { PhysicsWorld } from '../engine/physics/PhysicsWorld.js';
import { FixedStepLoop } from '../engine/physics/FixedStepLoop.js';
import { CpuTerrainSurfaceDebug } from './CpuTerrainSurfaceDebug.js';
import './physics-demo.css';

const root = document.querySelector<HTMLDivElement>('#physics-v2-root');
if (!root) throw new Error('Не найден контейнер Physics V2');

root.innerHTML = `
  <main class="pv2-shell">
    <section class="pv2-main">
      <header class="pv2-header">
        <div>
          <div class="pv2-eyebrow">TERRAIN ENGINE · V2 PLAYGROUND</div>
          <h1 class="pv2-title">Исследование рельефа V2</h1>
          <p class="pv2-subtitle">Управляй персонажем на процедурном ландшафте. Камера следует за героем, а Clipmap перестраивает детализацию вокруг активной камеры.</p>
        </div>
        <span class="pv2-status">● LEGACY НЕ ИЗМЕНЁН</span>
      </header>
      <div class="pv2-viewport" id="pv2-viewport">
        <div class="pv2-overlay">
          <span class="pv2-chip">Режим: <b id="pv2-state">исследование</b></span>
          <span class="pv2-chip">Управление: <b>WASD + мышь</b></span>
        </div>
        <div class="pv2-hint">WASD — бег · Пробел — прыжок · Зажми ЛКМ и веди мышь — повернуть камеру · Колесо — приблизить</div>
      </div>
    </section>
    <aside class="pv2-side">
      <section class="pv2-panel">
        <h2>Персонаж и сцена</h2>
        <div class="pv2-buttons">
          <button class="pv2-button primary" id="pv2-reset">↻ Вернуть героя</button>
          <button class="pv2-button" id="pv2-drop">↓ Уронить шар</button>
          <button class="pv2-button" id="pv2-drop-pair">⚪ Уронить пару шаров</button>
          <button class="pv2-button" id="pv2-pause">Ⅱ Пауза физики</button>
          <button class="pv2-button" id="pv2-camera">◎ Камера за героем</button>
          <label class="pv2-toggle"><input id="pv2-wire" type="checkbox"> Сетка рельефа по уровням LOD</label>
          <label class="pv2-toggle"><input id="pv2-physics-debug" type="checkbox"> Контакты физики героя</label>
          <label class="pv2-toggle"><input id="pv2-cpu-surface" type="checkbox"> CPU-поверхность столкновений</label>
        </div>
        <p class="pv2-note">Фиолетовая сетка — отдельная CPU-поверхность столкновений с теми же треугольниками, что использует физика. Зелёные точки — опорные пробы капсулы, жёлтые отрезки — зазор до CPU-рельефа. Сравнивай фиолетовую сетку с цветным GPU-рельефом.</p>
      </section>
      <section class="pv2-panel">
        <h2>Показания</h2>
        <div class="pv2-statgrid">
          <div class="pv2-stat"><span>Скорость героя</span><b id="pv2-player-speed">0.0 м/с</b></div>
          <div class="pv2-stat"><span>Высота героя</span><b id="pv2-player-height">— м</b></div>
          <div class="pv2-stat"><span>Сфер в сцене</span><b id="pv2-bodies">0</b></div>
          <div class="pv2-stat"><span>Скорость шара</span><b id="pv2-speed">— м/с</b></div>
          <div class="pv2-stat"><span>FPS рендера</span><b id="pv2-fps">—</b></div>
          <div class="pv2-stat"><span>Видимых тайлов</span><b id="pv2-tiles">—</b></div>
        </div>
      </section>
      <section class="pv2-panel">
        <h2>Физика шара</h2>
        <div class="pv2-control">
          <label for="pv2-friction">Трение <output id="pv2-friction-value">0.65</output></label>
          <input id="pv2-friction" type="range" min="0" max="1.5" step="0.05" value="0.65">
        </div>
        <div class="pv2-control">
          <label for="pv2-bounce">Упругость <output id="pv2-bounce-value">0.12</output></label>
          <input id="pv2-bounce" type="range" min="0" max="0.9" step="0.03" value="0.12">
        </div>
        <p class="pv2-note">Шар использует отдельный heightfield-решатель. Капсула героя использует фиксированный шаг и проверку опорной области нижней полусферы.</p>
      </section>
      <section class="pv2-panel">
        <h2>Blueprint рельефа</h2>
        <p class="pv2-note">V2 теперь получает высоту и цвет из узлового Blueprint-компилятора V1. Один граф компилируется в CPU-функцию для Terrain/физики и GLSL для GPU. В демо подключён граф холмов с шумом, арифметическими узлами, маской уклона и смешиванием цветов.</p>
        <p class="pv2-note">Выходы воды и тумана также читаются компилятором; отдельный рендер воды и перенос пользовательских текстурных ассетов в V2 ещё не подключены.</p>
        <p class="pv2-footer">Отсечение тайлов выполняется по пирамиде видимости активной камеры. Обратные грани поверхности отсекаются материалом FrontSide и проверкой gl_FrontFacing.</p>
      </section>
    </aside>
  </main>
`;

const viewport = document.querySelector<HTMLDivElement>('#pv2-viewport')!;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#91aeb4');
scene.fog = new THREE.Fog('#91aeb4', 100, 320);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 700);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.domElement.tabIndex = 0;
viewport.prepend(renderer.domElement);

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

const LOD0_CELL_SIZE = 1;
const blueprintGraph = createDefaultTerrainGraph(17);
const blueprint = compileTerrainGraph(blueprintGraph);
scene.background = new THREE.Color(blueprint.fogColor);
scene.fog = new THREE.Fog(blueprint.fogColor, blueprint.fogNear, blueprint.fogFar);
const terrain = new Terrain(blueprint.heightAt, {
  seed: 17, editCellSize: 0.5, editChunkSize: 32, normalSampleDistance: 0.35
});
const terrainRenderer = new TerrainRenderer(scene, terrain, blueprint, {
  levels: 8, gridSize: 96, tileSize: 32, baseCellSize: LOD0_CELL_SIZE, showWireframe: false
});
const cpuSurfaceDebug = new CpuTerrainSurfaceDebug(scene, terrain, LOD0_CELL_SIZE, 16);

const world = new PhysicsWorld(terrain, { fixedDelta: 1 / 60, maxSubSteps: 10, maxFrameDelta: 0.1, terrainCellSize: LOD0_CELL_SIZE });
const loop = new FixedStepLoop(world, 1 / 60, 10, 0.1);
const sphereMeshes = new Map<string, THREE.Mesh>();
// Все шары используют одну геометрию и один материал: меньше GPU-ресурсов.
const sphereGeometry = new THREE.SphereGeometry(1.15, 24, 16);
const sphereMaterial = new THREE.MeshStandardMaterial({
  color: '#e9a95e', roughness: 0.28, metalness: 0.12
});
let nextId = 1;
let paused = false;
let friction = 0.65;
let restitution = 0.12;
let totalSteps = 0;

const playerRadius = 0.48;
const playerHeight = 1.35;
const player = {
  x: 0, z: 0, y: terrain.getGroundHeight(0, 0, LOD0_CELL_SIZE) + playerHeight * 0.5 + playerRadius,
  vx: 0, vy: 0, vz: 0, yaw: 0, grounded: true
};
const playerMesh = new THREE.Mesh(
  new THREE.CapsuleGeometry(playerRadius, playerHeight, 6, 12),
  new THREE.MeshStandardMaterial({ color: '#f0b66f', roughness: 0.62 })
);
playerMesh.castShadow = true;
scene.add(playerMesh);

// Диагностика опоры капсулы: зелёные точки — высота земли,
// вертикальные отрезки — зазор до нижней поверхности капсулы.
// Плотная выборка нижней полусферы: центр + два кольца по 16 точек.
const playerSupportSamples: Array<[number, number]> = [[0, 0]];
for (const radial of [0.45, 0.88]) {
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    playerSupportSamples.push([
      Math.cos(angle) * playerRadius * radial,
      Math.sin(angle) * playerRadius * radial
    ]);
  }
}
const physicsDebug = new THREE.Group();
physicsDebug.visible = false;
const contactLinePositions = new Float32Array(playerSupportSamples.length * 2 * 3);
const contactLineGeometry = new THREE.BufferGeometry();
contactLineGeometry.setAttribute('position', new THREE.BufferAttribute(contactLinePositions, 3));
const contactLines = new THREE.LineSegments(
  contactLineGeometry,
  new THREE.LineBasicMaterial({ color: '#ffcf5a', transparent: true, opacity: 0.95, depthWrite: false })
);
physicsDebug.add(contactLines);
const contactMarkerGeometry = new THREE.SphereGeometry(0.065, 8, 6);
const contactMarkers = playerSupportSamples.map(() => {
  const marker = new THREE.Mesh(contactMarkerGeometry,
    new THREE.MeshBasicMaterial({ color: '#45f0b2', depthTest: true }));
  physicsDebug.add(marker);
  return marker;
});
scene.add(physicsDebug);

function updatePhysicsDebug(): void {
  const positions = contactLineGeometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < playerSupportSamples.length; i++) {
    const [ox, oz] = playerSupportSamples[i];
    const radialSq = ox * ox + oz * oz;
    const x = player.x + ox, z = player.z + oz;
    const groundY = terrain.getGroundHeight(x, z, LOD0_CELL_SIZE);
    const lowerCap = Math.sqrt(Math.max(0, playerRadius * playerRadius - radialSq));
    const capsuleSurfaceY = player.y - playerHalfSegment - lowerCap;
    positions.setXYZ(i * 2, x, groundY, z);
    positions.setXYZ(i * 2 + 1, x, capsuleSurfaceY, z);
    contactMarkers[i].position.set(x, groundY + 0.035, z);
  }
  positions.needsUpdate = true;
  contactLineGeometry.computeBoundingSphere();
}

let cameraYaw = Math.PI;
let cameraPitch = 0.28;
let cameraDistance = 7.5;
let draggingCamera = false;
let previousPointerX = 0;
let previousPointerY = 0;
const keys = new Set<string>();

const playerHalfSegment = playerHeight * 0.5;
const playerFixedStep = 1 / 120;
let playerAccumulator = 0;

// Проверяем не только точку под центром, а опорную область нижней полусферы капсулы.
// Для каждой точки вычисляем высоту, при которой капсула уже касается поверхности.
function getPlayerSupportHeight(x: number, z: number): number {
  const r = playerRadius;
  let support = -Infinity;
  for (const [ox, oz] of playerSupportSamples) {
    const radialSq = ox * ox + oz * oz;
    if (radialSq >= r * r) continue;
    const ground = terrain.getGroundHeight(x + ox, z + oz, LOD0_CELL_SIZE);
    const lowerCap = Math.sqrt(Math.max(0, r * r - radialSq));
    support = Math.max(support, ground + playerHalfSegment + lowerCap);
  }
  return support;
}

function placePlayerAt(x: number, z: number): void {
  player.x = x; player.z = z;
  player.y = getPlayerSupportHeight(x, z);
  player.vx = 0; player.vy = 0; player.vz = 0;
  player.grounded = true;
  playerAccumulator = 0;
}
function resetPlayer(): void {
  placePlayerAt(0, 0);
  player.yaw = 0;
  cameraYaw = Math.PI;
  cameraPitch = 0.28;
  cameraDistance = 7.5;
}
function updatePlayer(frameDelta: number): void {
  // Контроллер персонажа работает с фиксированным шагом, независимо от FPS.
  playerAccumulator += Math.min(frameDelta, 0.05);
  const forwardInput = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const sideInput = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  const inputLength = Math.hypot(forwardInput, sideInput);
  let targetX = 0, targetZ = 0;
  if (inputLength > 0) {
    const f = forwardInput / inputLength, s = sideInput / inputLength;
    const forwardX = -Math.sin(cameraYaw), forwardZ = -Math.cos(cameraYaw);
    const rightX = Math.cos(cameraYaw), rightZ = -Math.sin(cameraYaw);
    targetX = (forwardX * f + rightX * s) * 7.5;
    targetZ = (forwardZ * f + rightZ * s) * 7.5;
    player.yaw = Math.atan2(targetX, targetZ);
  }

  let steps = 0;
  while (playerAccumulator >= playerFixedStep && steps < 8) {
    const dt = playerFixedStep;
    const blend = 1 - Math.exp(-12 * dt);
    player.vx += (targetX - player.vx) * blend;
    player.vz += (targetZ - player.vz) * blend;
    if (keys.has('Space') && player.grounded) {
      player.vy = 6.2;
      player.grounded = false;
    }

    player.vy -= 18 * dt;
    player.x += player.vx * dt;
    player.z += player.vz * dt;
    player.y += player.vy * dt;

    const supportY = getPlayerSupportHeight(player.x, player.z);
    if (player.y <= supportY) {
      player.y = supportY;
      player.vy = 0;
      player.grounded = true;
    } else {
      player.grounded = false;
    }
    playerAccumulator -= dt;
    steps++;
  }

  // Не накапливаем большой долг симуляции после подвисания вкладки.
  if (steps === 8 && playerAccumulator >= playerFixedStep) {
    playerAccumulator = Math.min(playerAccumulator, playerFixedStep);
  }
  playerMesh.position.set(player.x, player.y, player.z);
  playerMesh.rotation.y = player.yaw;
  if (physicsDebug.visible) updatePhysicsDebug();
}
function updateFollowCamera(): void {
  const horizontal = Math.cos(cameraPitch) * cameraDistance;
  camera.position.set(
    player.x + Math.sin(cameraYaw) * horizontal,
    player.y + 0.25 + Math.sin(cameraPitch) * cameraDistance,
    player.z + Math.cos(cameraYaw) * horizontal
  );
  camera.lookAt(player.x, player.y + 0.55, player.z);
}

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  draggingCamera = true;
  previousPointerX = event.clientX;
  previousPointerY = event.clientY;
  renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener('pointermove', (event) => {
  if (!draggingCamera) return;
  const dx = event.clientX - previousPointerX, dy = event.clientY - previousPointerY;
  previousPointerX = event.clientX; previousPointerY = event.clientY;
  cameraYaw -= dx * 0.006;
  cameraPitch = THREE.MathUtils.clamp(cameraPitch + dy * 0.004, -0.05, 0.85);
});
renderer.domElement.addEventListener('pointerup', () => { draggingCamera = false; });
renderer.domElement.addEventListener('pointercancel', () => { draggingCamera = false; });
renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());
renderer.domElement.addEventListener('wheel', (event) => {
  cameraDistance = THREE.MathUtils.clamp(cameraDistance + event.deltaY * 0.008, 3.5, 18);
  event.preventDefault();
}, { passive: false });
window.addEventListener('keydown', (event) => {
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
});
window.addEventListener('keyup', (event) => keys.delete(event.code));
window.addEventListener('blur', () => keys.clear());

function createSphere(x: number, z: number, lift = 8): void {
  const id = `sphere-${nextId++}`, radius = 1.15;
  const y = terrain.getGroundHeight(x, z, LOD0_CELL_SIZE) + radius + lift;
  const body = world.addSphere({
    id, position: { x, y, z }, radius, mass: 1,
    friction, restitution, linearDamping: 0.008, angularDamping: 0.015
  });
  const mesh = new THREE.Mesh(sphereGeometry, sphereMaterial);
  // Тени от десятков динамических сфер дорого пересчитывать каждый кадр.
  // Солнце и рельеф сохраняют тени, сами шары остаются освещёнными.
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.position.set(body.position.x, body.position.y, body.position.z);
  scene.add(mesh);
  sphereMeshes.set(id, mesh);
}
function clearSpheres(): void {
  for (const [id, mesh] of sphereMeshes) {
    scene.remove(mesh);
    world.removeBody(id);
  }
  sphereMeshes.clear();
}
function setPauseLabel(): void {
  document.querySelector('#pv2-pause')!.textContent = paused ? '▶ Продолжить физику' : 'Ⅱ Пауза физики';
  document.querySelector('#pv2-state')!.textContent = paused ? 'пауза физики' : 'исследование';
}
function reset(): void {
  clearSpheres(); nextId = 1; loop.reset(); totalSteps = 0;
  resetPlayer(); paused = false; setPauseLabel();
}
function updateStats(): void {
  document.querySelector('#pv2-player-speed')!.textContent = `${Math.hypot(player.vx, player.vz).toFixed(1)} м/с`;
  document.querySelector('#pv2-player-height')!.textContent = `${player.y.toFixed(1)} м`;
  document.querySelector('#pv2-bodies')!.textContent = String(world.bodies.size);
  const body = world.bodies.values().next().value;
  document.querySelector('#pv2-speed')!.textContent = body
    ? `${Math.hypot(body.velocity.x, body.velocity.y, body.velocity.z).toFixed(1)} м/с`
    : '— м/с';
}
document.querySelector('#pv2-reset')!.addEventListener('click', reset);
document.querySelector('#pv2-pause')!.addEventListener('click', () => { paused = !paused; setPauseLabel(); });
document.querySelector('#pv2-drop')!.addEventListener('click', () => createSphere(player.x + 3, player.z + 3, 12));
document.querySelector('#pv2-drop-pair')!.addEventListener('click', () => {
  createSphere(player.x + 3, player.z + 3, 12);
  createSphere(player.x + 5, player.z + 3, 12);
});
document.querySelector<HTMLInputElement>('#pv2-wire')!.addEventListener('change', (event) =>
  terrainRenderer.setWireframe((event.currentTarget as HTMLInputElement).checked));
document.querySelector<HTMLInputElement>('#pv2-cpu-surface')!.addEventListener('change', (event) => {
  const enabled = (event.currentTarget as HTMLInputElement).checked;
  cpuSurfaceDebug.setVisible(enabled);
  if (enabled) cpuSurfaceDebug.update(player.x, player.z);
});
document.querySelector<HTMLInputElement>('#pv2-physics-debug')!.addEventListener('change', (event) => {
  physicsDebug.visible = (event.currentTarget as HTMLInputElement).checked;
  if (physicsDebug.visible) updatePhysicsDebug();
});
document.querySelector('#pv2-camera')!.addEventListener('click', () => {
  cameraYaw = player.yaw + Math.PI; cameraPitch = 0.28; cameraDistance = 7.5;
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
  const width = viewport.clientWidth, height = viewport.clientHeight;
  camera.aspect = width / height; camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(viewport); resize();

let previousTime = performance.now(), fpsFrames = 0, fpsElapsed = 0;
function animate(now: number): void {
  requestAnimationFrame(animate);
  const delta = Math.min((now - previousTime) / 1000, 0.05);
  previousTime = now; fpsFrames++; fpsElapsed += delta;
  if (fpsElapsed >= 0.5) {
    document.querySelector('#pv2-fps')!.textContent = String(Math.round(fpsFrames / fpsElapsed));
    fpsFrames = 0; fpsElapsed = 0;
  }
  updatePlayer(delta);
  if (cpuSurfaceDebug.group.visible) cpuSurfaceDebug.update(player.x, player.z);
  if (!paused) {
    const result = loop.advance(delta);
    totalSteps += result.steps;
    for (const [id, mesh] of sphereMeshes) {
      const body = world.bodies.get(id);
      if (!body) continue;
      const p = world.getInterpolatedPosition(id, result.alpha);
      mesh.position.set(p.x, p.y, p.z);
      mesh.quaternion.set(body.orientation.x, body.orientation.y, body.orientation.z, body.orientation.w);
    }
  }
  updateFollowCamera();
  const culling = terrainRenderer.update(camera);
  document.querySelector('#pv2-tiles')!.textContent = `${culling.visibleTiles}/${culling.totalTiles}`;
  updateStats();
  renderer.render(scene, camera);
}
resetPlayer();
updateFollowCamera();
requestAnimationFrame(animate);
window.addEventListener('beforeunload', () => {
  resizeObserver.disconnect(); renderer.dispose(); terrainRenderer.dispose(); cpuSurfaceDebug.dispose();
  sphereGeometry.dispose(); sphereMaterial.dispose();
});
