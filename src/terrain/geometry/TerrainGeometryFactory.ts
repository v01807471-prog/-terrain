import * as THREE from 'three';
import type { TerrainConfig } from '../config/TerrainConfig.ts';
import type { QuadTile } from '../quadtree/QuadTile.ts';
import { terrainHeight } from './TerrainHeight.ts';

export class TerrainGeometryFactory {
  constructor(private readonly config: Readonly<TerrainConfig>) {}

  create(tile: QuadTile): THREE.BufferGeometry {
    const cells = this.config.chunkResolution;
    const side = cells + 1;
    const step = tile.size / cells;
    const half = tile.size / 2;
    const positions: number[] = [];
    const indices: number[] = [];

    for (let z = 0; z <= cells; z++) {
      for (let x = 0; x <= cells; x++) {
        const localX = -half + x * step;
        const localZ = -half + z * step;
        positions.push(localX, terrainHeight(tile.centerX + localX, tile.centerZ + localZ), localZ);
      }
    }

    for (let z = 0; z < cells; z++) {
      for (let x = 0; x < cells; x++) {
        const a = z * side + x;
        const b = a + 1;
        const c = a + side;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    this.addSkirts(positions, indices, cells, side);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private addSkirts(
    positions: number[],
    indices: number[],
    cells: number,
    side: number
  ): void {
    const edges: number[][] = [[], [], [], []];
    for (let i = 0; i <= cells; i++) {
      edges[0].push(i);
      edges[1].push(i * side + cells);
      edges[2].push(cells * side + (cells - i));
      edges[3].push((cells - i) * side);
    }

    for (const edge of edges) {
      const skirtStart = positions.length / 3;
      for (const sourceIndex of edge) {
        const offset = sourceIndex * 3;
        positions.push(
          positions[offset],
          positions[offset + 1] - this.config.skirtDepth,
          positions[offset + 2]
        );
      }
      for (let i = 0; i < cells; i++) {
        const topA = edge[i];
        const topB = edge[i + 1];
        const skirtA = skirtStart + i;
        const skirtB = skirtStart + i + 1;
        indices.push(topA, skirtA, topB, topB, skirtA, skirtB);
      }
    }
  }
}
