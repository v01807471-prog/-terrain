export interface TerrainConfig {
  /** Width of the root quadtree tile in planet-local units. */
  rootSize: number;
  /** Finest tile width. rootSize must be divisible by 2^maxLevel. */
  minChunkSize: number;
  maxLevel: number;
  /** Number of grid cells along one chunk edge. */
  chunkResolution: number;
  /** Distance multiplier controlling how aggressively chunks split. */
  splitDistanceFactor: number;
  /** Depth of the edge skirts, in local units. */
  skirtDepth: number;
}

export const DEFAULT_TERRAIN_CONFIG: Readonly<TerrainConfig> = Object.freeze({
  rootSize: 8192,
  minChunkSize: 128,
  maxLevel: 6,
  chunkResolution: 32,
  splitDistanceFactor: 2.6,
  skirtDepth: 18
});

export function validateTerrainConfig(config: TerrainConfig): void {
  if (!(config.rootSize > 0) || !(config.minChunkSize > 0)) {
    throw new RangeError('rootSize and minChunkSize must be positive');
  }
  if (!Number.isInteger(config.maxLevel) || config.maxLevel < 0) {
    throw new RangeError('maxLevel must be a non-negative integer');
  }
  if (Math.abs(config.rootSize / 2 ** config.maxLevel - config.minChunkSize) > 1e-8) {
    throw new RangeError('rootSize / 2^maxLevel must equal minChunkSize');
  }
  if (!Number.isInteger(config.chunkResolution) || config.chunkResolution < 2) {
    throw new RangeError('chunkResolution must be an integer >= 2');
  }
  if (!(config.splitDistanceFactor > 0) || !(config.skirtDepth > 0)) {
    throw new RangeError('splitDistanceFactor and skirtDepth must be positive');
  }
}
