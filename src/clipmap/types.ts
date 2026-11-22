export interface Vec2 { x: number; z: number }
export interface Vec3 { x: number; y: number; z: number }

export interface ClipmapLevelConfig {
  /** World-space spacing between adjacent samples. */
  cellSize: number;
  /** Number of samples on one side; must be an even integer >= 4. */
  resolution: number;
}

export interface ClipmapConfig {
  levels: number;
  baseCellSize: number;
  resolution: number;
  /** Snap interval multiplier for stable camera-following origins. */
  snapFactor: number;
}

export interface ClipmapFrame {
  camera: Vec3;
  center: Vec2;
}

export interface ClipmapLevelState extends ClipmapLevelConfig {
  index: number;
  origin: Vec2;
  worldSize: number;
}

export interface ClipmapUpdate {
  changed: boolean;
  camera: Vec3;
  center: Vec2;
  levels: readonly ClipmapLevelState[];
}

export const DEFAULT_CLIPMAP_CONFIG: Readonly<ClipmapConfig> = Object.freeze({
  levels: 8,
  baseCellSize: 1,
  resolution: 128,
  snapFactor: 2
});
