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
  private heroRoot: THREE.Group | null = null;
  private readonly keys = new Set<string>();
  private yaw = 0;
  private pitch = 0.16;
  private pointerLocked = false;
  private readonly retargetedClips = new Map<string, THREE.AnimationClip>();

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

    this.createFlatClipmap();

    this.camera.position.set(0, 1.15, 3.8);
    this.camera.lookAt(0, 0.9, 0);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.9, 0);
    this.controls.enableDamping = true;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 8;
    this.controls.update();
    this.canvas.addEventListener('click', this.onCanvasClick);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);

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
      const targetMeshes: THREE.SkinnedMesh[] = [];
      model.traverse((object) => {
        if (object instanceof THREE.SkinnedMesh) {
          targetMeshes.push(object);
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
      // Select the main body skin, not a small face/eye accessory mesh.
      this.targetMesh = targetMeshes.sort((a, b) =>
        (b.geometry.getAttribute('position')?.count ?? 0) - (a.geometry.getAttribute('position')?.count ?? 0)
      )[0] ?? null;
      if (!this.targetMesh) {
        this.status.textContent = 'В модели не найден SkinnedMesh со скелетом';
        return;
      }
      this.heroRoot = new THREE.Group();
      this.heroRoot.name = 'HeroRoot';
      this.heroRoot.add(model);
      this.scene.add(this.heroRoot);
      // retargetClip creates tracks addressed through the SkinnedMesh's bones[] binding.
      // The mixer root must therefore be the skinned mesh, not the outer GLTF Group.
      this.mixer = new THREE.AnimationMixer(this.targetMesh);
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


  private createFlatClipmap() {
    const material = new THREE.MeshStandardMaterial({ color: 0x394653, roughness: 1, side: THREE.DoubleSide });
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x61788d, transparent: true, opacity: 0.48 });
    const addRing = (extent: number, inner: number, divisions: number) => {
      const positions: number[] = [];
      const indices: number[] = [];
      const lines: number[] = [];
      const step = extent * 2 / divisions;
      for (let z = 0; z < divisions; z++) for (let x = 0; x < divisions; x++) {
        const x0 = -extent + x * step, x1 = x0 + step;
        const z0 = -extent + z * step, z1 = z0 + step;
        const cx = (x0 + x1) * 0.5, cz = (z0 + z1) * 0.5;
        if (inner > 0 && Math.abs(cx) < inner && Math.abs(cz) < inner) continue;
        const a = positions.length / 3;
        positions.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1);
        indices.push(a, a + 2, a + 1, a, a + 3, a + 2);
        lines.push(x0, 0, z0, x1, 0, z0, x1, 0, z0, x1, 0, z1);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = -0.001;
      this.scene.add(mesh);
      const gridGeometry = new THREE.BufferGeometry();
      gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
      const grid = new THREE.LineSegments(gridGeometry, lineMaterial);
      grid.position.y = 0.001;
      this.scene.add(grid);
    };
    addRing(8, 0, 128);
    addRing(16, 8, 128);
    addRing(32, 16, 128);
    addRing(64, 32, 128);
    addRing(128, 64, 128);
  }

  private loadAdditionalLibrary(url: string, label: string) {
    if (!this.targetMesh || !this.mixer) return;
    new GLTFLoader().load(url, (gltf) => {
      const meshes: THREE.SkinnedMesh[] = [];
      gltf.scene.traverse((object) => { if (object instanceof THREE.SkinnedMesh) meshes.push(object); });
      const target = this.targetMesh;
      if (!meshes.length || !target) return;
      const targetNames = new Set(target.skeleton.bones.map((bone) => bone.name));
      const source = meshes.map((mesh) => ({
        mesh,
        overlap: mesh.skeleton.bones.filter((bone) => targetNames.has(bone.name)).length
      })).sort((a, b) => b.overlap - a.overlap)[0].mesh;
      const sourceNames = new Set(source.skeleton.bones.map((bone) => bone.name));
      const names: Record<string, string> = {};
      for (const bone of target.skeleton.bones) if (sourceNames.has(bone.name)) names[bone.name] = bone.name;
      if (Object.keys(names).length < 5) {
        this.status.textContent += ' · ' + label + ': несовместимый скелет';
        return;
      }
      const rootNames = target.skeleton.bones
        .filter((bone) => !target.skeleton.bones.includes(bone.parent as THREE.Bone))
        .map((bone) => bone.name);
      let count = 0;
      for (const clip of gltf.animations) {
        try {
          const converted = SkeletonUtils.retargetClip(target, source, clip, {
            names, fps: 30, preserveBoneMatrix: true, preserveBonePositions: true
          });
          converted.tracks = converted.tracks.filter((track) =>
            !(track.name.endsWith('.position') && rootNames.some((name) => track.name.includes('[' + name + ']')))
          );
          if (!converted.tracks.length) continue;
          const name = label + ' · ' + (clip.name || 'Clip ' + count);
          converted.name = name;
          this.retargetedClips.set(name, converted);
          const option = document.createElement('option');
          option.value = name;
          option.textContent = name;
          this.animationSelect.appendChild(option);
          count++;
        } catch (error) { console.warn(label + ' retarget failed:', clip.name, error); }
      }
      this.status.textContent += ' · ' + label + ': ' + count + ' клипов';
    }, undefined, (error) => console.error(label + ' load failed:', error));
  }

  private updateThirdPerson(delta: number) {
    if (!this.heroRoot) return;
    if (this.pointerLocked) {
      const forward = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
      const side = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
      const magnitude = Math.hypot(forward, side);
      if (magnitude > 0) {
        const speed = (this.keys.has('ShiftLeft') ? 5.2 : 3.1) * delta;
        this.heroRoot.position.x += (Math.sin(this.yaw) * forward + Math.cos(this.yaw) * side) / magnitude * speed;
        this.heroRoot.position.z += (Math.cos(this.yaw) * forward - Math.sin(this.yaw) * side) / magnitude * speed;
        this.heroRoot.rotation.y = this.yaw;
      }
    }
    const target = this.heroRoot.position.clone().add(new THREE.Vector3(0, 0.98, 0));
    const distance = 3.5;
    const horizontal = Math.cos(this.pitch) * distance;
    this.camera.position.set(
      target.x - Math.sin(this.yaw) * horizontal,
      target.y + Math.sin(this.pitch) * distance + 0.25,
      target.z - Math.cos(this.yaw) * horizontal
    );
    this.camera.lookAt(target);
    this.controls.target.copy(target);
    this.controls.enabled = !this.pointerLocked;
  }

  private onCanvasClick = () => { if (!this.pointerLocked) void this.canvas.requestPointerLock(); };
  private onPointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    if (!this.pointerLocked) this.keys.clear();
  };
  private onMouseMove = (event: MouseEvent) => {
    if (!this.pointerLocked) return;
    this.yaw -= event.movementX * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * 0.0018, -0.25, 0.7);
  };
  private onKeyDown = (event: KeyboardEvent) => {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft'].includes(event.code)) {
      event.preventDefault();
      this.keys.add(event.code);
    }
  };
  private onKeyUp = (event: KeyboardEvent) => { this.keys.delete(event.code); };

  private tryStartRetargetedAnimation() {
    if (!this.mixer || !this.targetMesh || !this.sourceScene || this.sourceClips.length === 0) return;
    const sourceMeshes: THREE.SkinnedMesh[] = [];
    this.sourceScene.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) sourceMeshes.push(object);
    });
    if (sourceMeshes.length === 0) {
      this.sourceMesh = null;
      this.status.textContent = 'UAL1 загружен, но в GLB не найден SkinnedMesh';
      return;
    }

    const targetNames = new Set(this.targetMesh.skeleton.bones.map((bone) => bone.name));
    // Animation packs can contain several skinned meshes. Choose the rig with
    // the strongest bone-name overlap with the actual hero body, not index 0.
    const rankedSources = sourceMeshes.map((mesh) => {
      const names = mesh.skeleton.bones.map((bone) => bone.name);
      return { mesh, names, overlap: names.filter((name) => targetNames.has(name)).length };
    }).sort((a, b) => b.overlap - a.overlap || b.names.length - a.names.length);
    const sourceMesh = rankedSources[0].mesh;
    this.sourceMesh = sourceMesh;
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
    const prepared = this.retargetedClips.get(this.animationSelect.value);
    if (prepared) {
      this.activeAction?.fadeOut(0.15);
      this.activeAction = this.mixer.clipAction(prepared);
      this.activeAction.reset().fadeIn(0.15).play();
      this.status.textContent = 'Анимация: ' + prepared.name + ' · UAL2';
      return;
    }
    const index = Number(this.animationSelect.value);
    const clip = this.sourceClips[index];
    if (!clip) return;
    try {
      // SkeletonUtils expects an explicit target-bone -> source-bone map.
      // Without it, getBoneName() returns undefined and the target stays in bind/T-pose.
      const sourceBoneNames = new Set(this.sourceMesh.skeleton.bones.map((bone) => bone.name));
      const boneMap: Record<string, string> = {};
      for (const bone of this.targetMesh.skeleton.bones) {
        if (sourceBoneNames.has(bone.name)) boneMap[bone.name] = bone.name;
      }
      const retargeted = SkeletonUtils.retargetClip(
        this.targetMesh,
        this.sourceMesh,
        clip,
        {
          names: boneMap,
          fps: 30,
          preserveBoneMatrix: true,
          preserveBonePositions: true
        }
      );
      if (retargeted.tracks.length === 0) {
        this.status.textContent = 'Клип ' + clip.name + ': нет совпавших анимируемых костей';
        console.warn('Retarget produced no tracks. Source bones:', this.sourceMesh.skeleton.bones.map((b) => b.name),
          'Target bones:', this.targetMesh.skeleton.bones.map((b) => b.name),
          'Clip tracks:', clip.tracks.map((track) => track.name));
        return;
      }
      this.activeAction?.stop();
      this.activeAction = this.mixer.clipAction(retargeted);
      this.activeAction.reset().play();
      this.mixer.update(0);
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
      this.updateThirdPerson(delta);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.canvas.removeEventListener('click', this.onCanvasClick);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    this.mixer?.stopAllAction();
    this.renderer.dispose();
    this.status.remove();
    this.animationSelect.remove();
  }
}
