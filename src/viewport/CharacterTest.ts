import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class CharacterTest {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
  private controls: OrbitControls;
  private frame = 0;
  private resizeObserver: ResizeObserver;
  private status: HTMLDivElement;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.scene.background = new THREE.Color(0x182331);
    this.scene.add(new THREE.HemisphereLight(0xdceaff, 0x55483d, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(2.5, 5, 3);
    key.castShadow = true;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x91bfff, 1.2);
    fill.position.set(-3, 2, -2);
    this.scene.add(fill);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0x394653, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.015;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(12, 24, 0x8093a5, 0x536475);
    grid.position.y = -0.012;
    this.scene.add(grid);

    this.camera.position.set(0, 1.15, 3.8);
    this.camera.lookAt(0, 0.9, 0);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.9, 0);
    this.controls.enableDamping = true;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 8;
    this.controls.update();

    this.status = document.createElement('div');
    this.status.className = 'character-test-status';
    this.status.textContent = 'Загрузка модели героя…';
    document.body.appendChild(this.status);

    const modelUrl = '/Universal%20Base%20Characters%5BStandard%5D/Base%20Characters/Godot%20-%20UE/Superhero_Male_FullBody.gltf';
    new GLTFLoader().load(modelUrl, (gltf) => {
      const model = gltf.scene;
      model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      if (!(size.y > 0)) {
        this.status.textContent = 'Ошибка: у модели нулевая высота';
        return;
      }
      // Preserve the source model proportions; this isolated scene uses metres.
      model.position.x -= (bounds.min.x + bounds.max.x) * 0.5;
      model.position.z -= (bounds.min.z + bounds.max.z) * 0.5;
      model.position.y -= bounds.min.y;
      model.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
          object.frustumCulled = false;
        }
      });
      this.scene.add(model);
      this.status.textContent = 'Модель загружена · высота ' + size.y.toFixed(2) + ' м · ширина ' + size.x.toFixed(2) + ' м · глубина ' + size.z.toFixed(2) + ' м · ЛКМ — вращение, колесо — масштаб';
    }, undefined, (error) => {
      console.error('Character GLTF load failed:', error);
      this.status.textContent = 'Не удалось загрузить GLTF — смотри ошибку в консоли';
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  private resize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  start() {
    const tick = () => {
      this.frame = requestAnimationFrame(tick);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.status.remove();
  }
}
