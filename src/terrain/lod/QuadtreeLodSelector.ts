import type { TerrainConfig } from '../config/TerrainConfig.ts';
import { QuadNode } from '../quadtree/QuadNode.ts';
import type { QuadTile } from '../quadtree/QuadTile.ts';

function distanceToTile(x: number, z: number, node: QuadNode): number {
  const maxX = node.minX + node.size;
  const maxZ = node.minZ + node.size;
  const dx = Math.max(node.minX - x, 0, x - maxX);
  const dz = Math.max(node.minZ - z, 0, z - maxZ);
  return Math.hypot(dx, dz);
}

/** Selects a balanced set of visible-detail candidates; no geometry is moved. */
export class QuadtreeLodSelector {
  private readonly root: QuadNode;

  constructor(private readonly config: Readonly<TerrainConfig>) {
    this.root = new QuadNode(config.rootSize, 0, 0, 0);
  }

  select(cameraX: number, cameraZ: number): QuadTile[] {
    const selected: QuadTile[] = [];
    this.visit(this.root, cameraX, cameraZ, selected);
    return selected;
  }

  private visit(node: QuadNode, cameraX: number, cameraZ: number, output: QuadTile[]): void {
    const distance = distanceToTile(cameraX, cameraZ, node);
    // The minimum distance floor prevents pathological subdivision when the
    // camera is exactly on a tile edge or at the planet-local origin.
    const stableDistance = Math.max(distance, this.config.minChunkSize * 0.5);
    const splitAt = Math.max(
      this.config.minChunkSize,
      stableDistance * this.config.splitDistanceFactor
    );
    const shouldSplit = node.level < this.config.maxLevel && node.size > splitAt;

    if (!shouldSplit) {
      output.push(node.tile);
      return;
    }

    for (const child of node.children(this.config.rootSize)) {
      this.visit(child, cameraX, cameraZ, output);
    }
  }
}
