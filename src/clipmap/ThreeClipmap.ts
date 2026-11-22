import * as THREE from 'three';
import { Clipmap } from './Clipmap.ts';
import type { ClipmapConfig, ClipmapUpdate, ClipmapLevelState } from './types.ts';

/**
 * Three.js debug renderer for the renderer-agnostic Clipmap core.
 * Every level is a square grid ring. The inner square is removed from all
 * levels except level 0, so the meshes do not simply z-fight as full planes.
 */
export class ThreeClipmap {
  readonly group = new THREE.Group();
  readonly core: Clipmap;

  private readonly levelGroups: THREE.Group[] = [];
  private readonly surfaceMaterial: THREE.MeshStandardMaterial;
  private readonly gridMaterial: THREE.MeshBasicMaterial;
  private lastOrigins: string[] = [];

  constructor(config: Partial<ClipmapConfig> = {}, material?: THREE.Material) {
    this.core = new Clipmap(config);
    this.surfaceMaterial = material instanceof THREE.MeshStandardMaterial
      ? material
      : new THREE.MeshStandardMaterial({
          map: this.createCheckerTexture(),
          color: 0xffffff,
          roughness: 0.96,
          metalness: 0
        });
    this.gridMaterial = new THREE.MeshBasicMaterial({
      color: 0x182b38,
      wireframe: true,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1
    });

    const initial = this.core.refresh();
    for (const level of initial.levels) {
      const levelGroup = new THREE.Group();
      levelGroup.userData.clipmapLevel = level.index;
      this.levelGroups.push(levelGroup);
      this.group.add(levelGroup);
    }
    this.apply(initial);
  }

  update(camera: THREE.Camera, center: THREE.Vector2): ClipmapUpdate {
    camera.updateMatrixWorld(true);
    const position = camera.getWorldPosition(new THREE.Vector3());
    const state = this.core.update({
      camera: { x: position.x, y: position.y, z: position.z },
      center: { x: center.x, z: center.y }
    });
    this.apply(state);
    return state;
  }

  dispose(): void {
    for (const levelGroup of this.levelGroups) {
      const surface = levelGroup.children[0] as THREE.Mesh | undefined;
      if (surface) surface.geometry.dispose();
      this.group.remove(levelGroup);
    }
    this.levelGroups.length = 0;
    this.surfaceMaterial.map?.dispose();
    this.surfaceMaterial.dispose();
    this.gridMaterial.dispose();
  }

  private apply(state: ClipmapUpdate): void {
    for (const level of state.levels) {
      const levelGroup = this.levelGroups[level.index];
      if (!levelGroup) continue;
      const originKey = [level.origin.x, level.origin.z, level.worldSize].join(':');
      if (this.lastOrigins[level.index] !== originKey) {
        this.rebuildLevel(levelGroup, level);
        this.lastOrigins[level.index] = originKey;
      }
      levelGroup.position.set(
        level.origin.x + level.worldSize / 2,
        0,
        level.origin.z + level.worldSize / 2
      );
    }
  }

  private rebuildLevel(levelGroup: THREE.Group, level: ClipmapLevelState): void {
    const oldSurface = levelGroup.children[0] as THREE.Mesh | undefined;
    if (oldSurface) oldSurface.geometry.dispose();
    levelGroup.clear();

    const geometry = this.createRingGeometry(level);
    const surface = new THREE.Mesh(geometry, this.surfaceMaterial);
    surface.receiveShadow = true;
    surface.castShadow = false;
    surface.frustumCulled = false;
    levelGroup.add(surface);

    const grid = new THREE.Mesh(geometry, this.gridMaterial);
    grid.frustumCulled = false;
    grid.renderOrder = 2;
    levelGroup.add(grid);
  }

  private createRingGeometry(level: ClipmapLevelState): THREE.BufferGeometry {
    const resolution = level.resolution;
    const half = level.worldSize / 2;
    const step = level.worldSize / (resolution - 1);
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let z = 0; z < resolution; z++) {
      for (let x = 0; x < resolution; x++) {
        const localX = -half + x * step;
        const localZ = -half + z * step;
        const worldX = level.origin.x + half + localX;
        const worldZ = level.origin.z + half + localZ;
        const broad = Math.sin(worldX * 0.018) * Math.cos(worldZ * 0.021) * 5.5;
        const detail = Math.sin(worldX * 0.071 + worldZ * 0.035) * Math.cos(worldZ * 0.063) * 1.4;
        const ridge = Math.max(0, Math.sin((worldX + worldZ) * 0.012)) * 2.2;
        positions.push(localX, broad + detail + ridge, localZ);
        uvs.push(x / (resolution - 1) * 8, z / (resolution - 1) * 8);
      }
    }

    const holeStart = Math.floor(resolution / 4);
    const holeEnd = Math.ceil(resolution * 3 / 4);
    for (let z = 0; z < resolution - 1; z++) {
      for (let x = 0; x < resolution - 1; x++) {
        // Leave a central opening so each coarser level becomes a square ring.
        if (level.index > 0 && x >= holeStart && x < holeEnd && z >= holeStart && z < holeEnd) continue;
        const a = z * resolution + x;
        const b = a + 1;
        const c = a + resolution;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private createCheckerTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context is unavailable');

    const tile = 16;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        context.fillStyle = (x + y) % 2 === 0 ? '#e5dfc7' : '#587f78';
        context.fillRect(x * tile, y * tile, tile, tile);
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    return texture;
  }
}
