import * as THREE from 'three';
import type { Terrain } from '../engine/terrain/Terrain.js';

/**
 * Visualizes the exact piecewise-planar heightfield used by Terrain.sampleGround().
 * The mesh uses the same 1m cell spacing and B-C diagonal as the LOD0 terrain mesh.
 */
export class CpuTerrainSurfaceDebug {
  readonly group = new THREE.Group();
  private readonly geometry: THREE.BufferGeometry;
  private readonly positions: Float32Array;
  private readonly side: number;
  private readonly halfExtent: number;
  private readonly cellSize: number;
  private originX = Number.NaN;
  private originZ = Number.NaN;

  constructor(
    scene: THREE.Scene,
    private readonly terrain: Terrain,
    cellSize = 1,
    halfExtent = 16
  ) {
    this.cellSize = cellSize;
    this.halfExtent = halfExtent;
    this.side = halfExtent * 2 + 1;
    this.positions = new Float32Array(this.side * this.side * 3);
    const indices: number[] = [];
    for (let z = 0; z < this.side - 1; z++) {
      for (let x = 0; x < this.side - 1; x++) {
        const a = z * this.side + x;
        const b = a + 1;
        const c = a + this.side;
        const d = c + 1;
        // Same B-C diagonal and winding as TerrainRenderer.createTileGeometry().
        indices.push(a, c, b, b, c, d);
      }
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setIndex(indices);
    const material = new THREE.MeshBasicMaterial({
      color: '#ff4bd8',
      wireframe: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.group.visible = false;
    scene.add(this.group);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  update(centerX: number, centerZ: number): void {
    const originX = Math.floor(centerX / this.cellSize) * this.cellSize - this.halfExtent * this.cellSize;
    const originZ = Math.floor(centerZ / this.cellSize) * this.cellSize - this.halfExtent * this.cellSize;
    if (originX === this.originX && originZ === this.originZ) return;
    this.originX = originX;
    this.originZ = originZ;

    for (let z = 0; z < this.side; z++) {
      for (let x = 0; x < this.side; x++) {
        const index = (z * this.side + x) * 3;
        const worldX = originX + x * this.cellSize;
        const worldZ = originZ + z * this.cellSize;
        this.positions[index] = x * this.cellSize;
        // Keep the CPU surface at its true height; polygon offset is only a draw-order aid.
        this.positions[index + 1] = this.terrain.getHeight(worldX, worldZ);
        this.positions[index + 2] = z * this.cellSize;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeBoundingSphere();
    this.group.position.set(originX, 0, originZ);
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    this.geometry.dispose();
    const material = (this.group.children[0] as THREE.Mesh).material as THREE.Material;
    material.dispose();
  }
}
