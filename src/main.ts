import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ThreeClipmap } from './clipmap/ThreeClipmap.ts';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app root');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9dc7e1);
scene.fog = new THREE.Fog(0x9dc7e1, 300, 1500);
scene.add(new THREE.HemisphereLight(0xffffff, 0x52604b, 2.1));

const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(-120, 220, 90);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 5000);
camera.position.set(92, 32, 92);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.domElement.setAttribute('aria-label', 'Interactive clipmap terrain preview');
app.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.enablePan = true;
controls.screenSpacePanning = true;
controls.minDistance = 12;
controls.maxDistance = 850;
controls.minPolarAngle = 0.12;
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

const clipmap = new ThreeClipmap({ levels: 7, resolution: 64, baseCellSize: 1 });
scene.add(clipmap.group);
const center = new THREE.Vector2(0, 0);

function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  clipmap.update(camera, center);
  renderer.render(scene, camera);
}
animate();

const panel = document.createElement('aside');
panel.className = 'debug-panel';
panel.innerHTML = `
  <strong>CLIPMAP · LOD</strong>
  <div class="debug-subtitle">7 уровней детализации · wireframe выключен</div>
  <div class="lod-legend">
    <div><i style="--lod:#ffffff"></i><span>LOD 0</span><small>1 м / ячейка</small></div>
    <div><i style="--lod:#c8e8ff"></i><span>LOD 1</span><small>2 м / ячейка</small></div>
    <div><i style="--lod:#bde7cf"></i><span>LOD 2</span><small>4 м / ячейка</small></div>
    <div><i style="--lod:#f2e6a6"></i><span>LOD 3</span><small>8 м / ячейка</small></div>
    <div><i style="--lod:#f0c39a"></i><span>LOD 4</span><small>16 м / ячейка</small></div>
    <div><i style="--lod:#e8a6a6"></i><span>LOD 5</span><small>32 м / ячейка</small></div>
    <div><i style="--lod:#c5b2eb"></i><span>LOD 6</span><small>64 м / ячейка</small></div>
  </div>
  <div class="controls-help">
    <b>Управление камерой</b>
    <span>ЛКМ — вращение</span>
    <span>Колесо — приближение</span>
    <span>ПКМ / Shift + ЛКМ — перемещение</span>
  </div>
`;
document.body.appendChild(panel);
