export interface QuadTile {
  /** Stable identity for this tile in the planet-local quadtree. */
  key: string;
  level: number;
  xIndex: number;
  zIndex: number;
  size: number;
  minX: number;
  minZ: number;
  centerX: number;
  centerZ: number;
}
