import * as THREE from 'three';
import type { QuadTile } from '../quadtree/QuadTile.ts';
import { TerrainGeometryFactory } from '../geometry/TerrainGeometryFactory.ts';

export class ChunkRenderer {
  readonly group = new THREE.Group();
  private readonly active = new Map<string, THREE.Mesh>();
  private readonly pool: THREE.Mesh[] = [];

  constructor(
    private readonly geometryFactory: TerrainGeometryFactory,
    private readonly material: THREE.Material
  ) {}

  sync(tiles: readonly QuadTile[]): void {
    const wanted = new Set(tiles.map(tile => tile.key));

    for (const [key, mesh] of this.active) {
      if (wanted.has(key)) continue;
      this.active.delete(key);
      mesh.visible = false;
      this.group.remove(mesh);
      this.pool.push(mesh);
    }

    for (const tile of tiles) {
      if (this.active.has(tile.key)) continue;
      const mesh = this.pool.pop() ?? new THREE.Mesh(new THREE.BufferGeometry(), this.material);
      mesh.geometry.dispose();
      mesh.geometry = this.geometryFactory.create(tile);
      mesh.position.set(tile.centerX, 0, tile.centerZ);
      mesh.frustumCulled = true;
      mesh.visible = true;
      mesh.userData.tileKey = tile.key;
      mesh.userData.lod = tile.level;
      this.active.set(tile.key, mesh);
      this.group.add(mesh);
    }
  }

  get activeChunkCount(): number {
    return this.active.size;
  }

  dispose(): void {
    for (const mesh of [...this.active.values(), ...this.pool]) {
      mesh.geometry.dispose();
      this.group.remove(mesh);
    }
    this.active.clear();
    this.pool.length = 0;
    this.material.dispose();
  }
}
