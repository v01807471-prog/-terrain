import * as THREE from 'three';
import { Clipmap } from './Clipmap.ts';
import type { ClipmapConfig, ClipmapUpdate, ClipmapLevelState } from './types.ts';

const CHECKER_TILE_WORLD_SIZE = 4;
const CHECKER_REPEAT_WORLD_SIZE = CHECKER_TILE_WORLD_SIZE * 8;
const MORPH_BAND_CELLS = 8;

function terrainHeight(x: number, z: number): number {
  const broad = Math.sin(x * 0.018) * Math.cos(z * 0.021) * 5.5;
  const detail = Math.sin(x * 0.071 + z * 0.035) * Math.cos(z * 0.063) * 1.4;
  const ridge = Math.max(0, Math.sin((x + z) * 0.012)) * 2.2;
  return broad + detail + ridge;
}

/** Bilinear height on the coarser level's sample lattice. */
function sampleCoarseHeight(x: number, z: number, coarse: ClipmapLevelState): number {
  const step = coarse.cellSize;
  const gx = (x - coarse.origin.x) / step;
  const gz = (z - coarse.origin.z) / step;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const tx = gx - ix;
  const tz = gz - iz;
  const x0 = coarse.origin.x + ix * step;
  const z0 = coarse.origin.z + iz * step;
  const h00 = terrainHeight(x0, z0);
  const h10 = terrainHeight(x0 + step, z0);
  const h01 = terrainHeight(x0, z0 + step);
  const h11 = terrainHeight(x0 + step, z0 + step);
  const a = THREE.MathUtils.lerp(h00, h10, tx);
  const b = THREE.MathUtils.lerp(h01, h11, tx);
  return THREE.MathUtils.lerp(a, b, tz);
}

/**
 * Three.js clipmap renderer.
 * Adjacent levels share a snapped sample lattice. Fine outer boundaries collapse
 * odd vertices onto coarse samples, while a transition band geo-morphs heights
 * onto the coarser surface to avoid cracks and visible popping.
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
        const coarser = state.levels[level.index + 1];
        this.rebuildLevel(levelGroup, level, coarser);
        this.lastOrigins[level.index] = originKey;
      }
      levelGroup.position.set(
        level.origin.x + level.worldSize / 2,
        0,
        level.origin.z + level.worldSize / 2
      );
    }
  }

  private rebuildLevel(
    levelGroup: THREE.Group,
    level: ClipmapLevelState,
    coarser?: ClipmapLevelState
  ): void {
    const oldSurface = levelGroup.children[0] as THREE.Mesh | undefined;
    if (oldSurface) oldSurface.geometry.dispose();
    levelGroup.clear();

    const geometry = this.createRingGeometry(level, coarser);
    const surface = new THREE.Mesh(geometry, this.surfaceMaterial);
    surface.receiveShadow = true;
    surface.frustumCulled = false;
    levelGroup.add(surface);

    const grid = new THREE.Mesh(geometry, this.gridMaterial);
    grid.frustumCulled = false;
    grid.renderOrder = 2;
    levelGroup.add(grid);
  }

  private createRingGeometry(
    level: ClipmapLevelState,
    coarser?: ClipmapLevelState
  ): THREE.BufferGeometry {
    const cells = level.resolution;
    const verticesPerSide = cells + 1;
    const half = level.worldSize / 2;
    const step = level.cellSize;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let z = 0; z <= cells; z++) {
      for (let x = 0; x <= cells; x++) {
        let sampleX = level.origin.x + x * step;
        let sampleZ = level.origin.z + z * step;

        // Collapse odd vertices on the outer edge onto the preceding even
        // coarse-lattice vertex. This removes boundary T-junctions.
        if (coarser) {
          if ((x === 0 || x === cells) && z % 2 === 1) sampleZ -= step;
          if ((z === 0 || z === cells) && x % 2 === 1) sampleX -= step;
        }

        const rawHeight = terrainHeight(sampleX, sampleZ);
        let height = rawHeight;

        if (coarser) {
          const edgeDistance = Math.min(x, z, cells - x, cells - z);
          const morph = THREE.MathUtils.clamp(1 - edgeDistance / MORPH_BAND_CELLS, 0, 1);
          if (morph > 0) {
            const coarseHeight = sampleCoarseHeight(sampleX, sampleZ, coarser);
            height = THREE.MathUtils.lerp(rawHeight, coarseHeight, morph);
          }
        }

        // World-space UVs keep checker squares the same physical size on every ring.
        positions.push(sampleX - (level.origin.x + half), height, sampleZ - (level.origin.z + half));
        uvs.push(sampleX / CHECKER_REPEAT_WORLD_SIZE, sampleZ / CHECKER_REPEAT_WORLD_SIZE);
      }
    }

    const holeStart = cells / 4;
    const holeEnd = cells * 3 / 4;
    for (let z = 0; z < cells; z++) {
      for (let x = 0; x < cells; x++) {
        if (level.index > 0 && x >= holeStart && x < holeEnd && z >= holeStart && z < holeEnd) continue;
        const a = z * verticesPerSide + x;
        const b = a + 1;
        const c = a + verticesPerSide;
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
