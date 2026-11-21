export interface TerrainSample {
  height: number;
  normal: Vector3Like;
  slope: number;
}

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface TerrainBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface TerrainChange {
  version: number;
  bounds: TerrainBounds;
}

export interface TerrainConfig {
  seed: number;
  editCellSize: number;
  editChunkSize: number;
  normalSampleDistance: number;
}
