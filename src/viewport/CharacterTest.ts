import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export class CharacterTest {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
  private controls: OrbitControls;
  private frame = 0;
  private resizeObserver: ResizeObserver;
  private status: HTMLDivElement;
  private clock = new THREE.Clock();
  private mixer: THREE.AnimationMixer | null = null;
  private targetMesh: THREE.SkinnedMesh | null = null;
  private sourceScene: THREE.Object3D | null = null;
  private sourceClips: THREE.AnimationClip[] = [];
  private sourceMesh: THREE.SkinnedMesh | null = null;
  private animationSelect: HTMLSelectElement;
  private activeAction: THREE.AnimationAction | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Keep the diagnostic scene free of shadow-map acne and self-shadow artefacts.
    this.renderer.shadowMap.enabled = false;
    this.scene.background = new THREE.Color(0x182331);
    this.scene.add(new THREE.HemisphereLight(0xdceaff, 0x55483d, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(2.5, 5, 3);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x91bfff, 1.4);
    fill.position.set(-3, 2, -2);
    this.scene.add(fill);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0x394653, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.015;
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
    this.status.textContent = 'Загрузка героя и библиотеки анимаций…';
    document.body.appendChild(this.status);

    this.animationSelect = document.createElement('select');
    this.animationSelect.className = 'character-test-animation-select';
    this.animationSelect.disabled = true;
    this.animationSelect.addEventListener('change', () => this.playSelectedAnimation());
    document.body.appendChild(this.animationSelect);

    const loader = new GLTFLoader();
    const modelUrl = '/Universal%20Base%20Characters%5BStandard%5D/Base%20Characters/Godot%20-%20UE/Superhero_Male_FullBody.gltf';
    const animationUrl = '/Universal%20Animation%20Library%5BStandard%5D/Unreal-Godot/UAL1_Standard.glb';

    loader.load(modelUrl, (gltf) => {
      const model = gltf.scene;
      model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      if (!(size.y > 0)) {
        this.status.textContent = 'Ошибка: у модели нулевая высота';
        return;
      }
      model.position.x -= (bounds.min.x + bounds.max.x) * 0.5;
      model.position.z -= (bounds.min.z + bounds.max.z) * 0.5;
      model.position.y -= bounds.min.y;
      model.traverse((object) => {
        if (object instanceof THREE.SkinnedMesh) {
          this.targetMesh = object;
          object.castShadow = false;
          object.receiveShadow = false;
        } else if (object instanceof THREE.Mesh) {
          object.castShadow = false;
          object.receiveShadow = false;
        }
        if (object instanceof THREE.Mesh) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            // Temporarily remove tangent-space normal maps to isolate the
            // triangular lighting artefacts without altering source geometry.
            if ('normalMap' in material) {
              const standard = material as THREE.MeshStandardMaterial;
              standard.normalMap = null;
              standard.normalScale.set(1, 1);
              standard.roughness = Math.max(standard.roughness, 0.82);
              standard.metalness = 0;
              standard.needsUpdate = true;
            }
          }
        }
      });
      this.scene.add(model);
      this.mixer = new THREE.AnimationMixer(model);
      this.status.textContent = 'Герой загружен · ' + size.y.toFixed(2) + ' м · ищу клипы UAL1…';
      this.tryStartRetargetedAnimation();
    }, undefined, (error) => {
      console.error('Character GLTF load failed:', error);
      this.status.textContent = 'Не удалось загрузить героя — смотри ошибку в консоли';
    });

    loader.load(animationUrl, (gltf) => {
      this.sourceScene = gltf.scene;
      this.sourceClips = gltf.animations;
      console.info('UAL1 clips:', this.sourceClips.map((clip) => ({
        name: clip.name, duration: clip.duration, tracks: clip.tracks.length
      })));
      this.animationSelect.replaceChildren();
      this.sourceClips.forEach((clip, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = clip.name || 'Clip ' + (index + 1);
        this.animationSelect.appendChild(option);
      });
      this.animationSelect.disabled = this.sourceClips.length === 0;
      this.tryStartRetargetedAnimation();
    }, undefined, (error) => {
      console.error('UAL1 animation library load failed:', error);
      this.status.textContent = 'Герой загружен, но UAL1.glb не загрузился — смотри консоль';
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  private tryStartRetargetedAnimation() {
    if (!this.mixer || !this.targetMesh || !this.sourceScene || this.sourceClips.length === 0) return;
    const sourceMeshes: THREE.SkinnedMesh[] = [];
    this.sourceScene.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) sourceMeshes.push(object);
    });
    const sourceMesh = sourceMeshes[0];
    this.sourceMesh = sourceMesh ?? null;
    if (!sourceMesh) {
      this.status.textContent = 'UAL1 загружен, но в GLB не найден SkinnedMesh';
      return;
    }

    const targetNames = new Set(this.targetMesh.skeleton.bones.map((bone) => bone.name));
    const sourceNames = new Set(sourceMesh.skeleton.bones.map((bone) => bone.name));
    const commonBones = [...sourceNames].filter((name) => targetNames.has(name));
    if (commonBones.length < 5) {
      this.status.textContent = 'Скелеты UAL1 и героя несовместимы по именам костей (' + commonBones.length + ' совпадений)';
      console.warn('UAL1 bone names:', [...sourceNames]);
      console.warn('Hero bone names:', [...targetNames]);
      return;
    }

    const preferredIndex = this.sourceClips.findIndex((clip) => /idle|stand|breath/i.test(clip.name));
    this.animationSelect.value = String(preferredIndex >= 0 ? preferredIndex : 0);
    this.playSelectedAnimation(commonBones.length);
  }

  private playSelectedAnimation(commonBoneCount?: number) {
    if (!this.mixer || !this.targetMesh || !this.sourceMesh) return;
    const index = Number(this.animationSelect.value);
    const clip = this.sourceClips[index];
    if (!clip) return;
    try {
      const retargeted = SkeletonUtils.retargetClip(
        this.targetMesh,
        this.sourceMesh,
        clip,
        { preservePosition: true }
      );
      if (retargeted.tracks.length === 0) {
        this.status.textContent = 'Клип ' + clip.name + ': нет совпавших анимируемых костей';
        return;
      }
      this.activeAction?.stop();
      this.activeAction = this.mixer.clipAction(retargeted);
      this.activeAction.reset().play();
      const bonesText = commonBoneCount === undefined ? '' : ' · ' + commonBoneCount + ' общих костей';
      this.status.textContent = 'Анимация: ' + clip.name + bonesText +
        ' · ' + retargeted.tracks.length + ' треков · ' + this.sourceClips.length +
        ' клипов в библиотеке · выбери другой клип в списке';
    } catch (error) {
      console.error('UAL1 retarget failed:', clip.name, error);
      this.status.textContent = 'Не удалось перенести клип ' + clip.name + ' — детали в консоли';
    }
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
      const delta = Math.min(this.clock.getDelta(), 0.05);
      this.mixer?.update(delta);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.mixer?.stopAllAction();
    this.renderer.dispose();
    this.status.remove();
    this.animationSelect.remove();
  }
}
