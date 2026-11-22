import * as THREE from 'three';
import { ThreeClipmap } from './clipmap/ThreeClipmap.ts';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app root');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9dc7e1);
scene.add(new THREE.HemisphereLight(0xffffff, 0x53634d, 2));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(100, 200, 80);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100000);
camera.position.set(90, 100, 130);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
app.appendChild(renderer.domElement);

const clipmap = new ThreeClipmap({ levels: 8, resolution: 64, baseCellSize: 1 });
scene.add(clipmap.group);
const center = new THREE.Vector2(0, 0);
const target = new THREE.Vector3(0, 0, 0);
const clock = new THREE.Clock();

function animate(): void {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  target.set(Math.sin(t * 0.08) * 20, 0, Math.cos(t * 0.06) * 20);
  camera.lookAt(target);
  clipmap.update(camera, center);
  renderer.render(scene, camera);
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const hint = document.createElement('div');
hint.textContent = 'Clipmap from Zero · camera + independent world center · TypeScript';
Object.assign(hint.style, {
  position: 'fixed', left: '16px', bottom: '16px', padding: '10px 14px',
  color: '#fff', background: '#10202acc', borderRadius: '8px',
  font: '13px system-ui, sans-serif'
});
document.body.appendChild(hint);
