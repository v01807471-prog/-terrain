/** Shared domain types for the terrain editor. */
export type TerrainTool = 'raise' | 'lower' | 'flatten' | 'smooth' | 'slope' | 'noise';

export interface BrushSettings {
  radius: number;
  strength: number;
  softness: number;
}

export interface TerrainQualitySettings {
  cell: number;
  area: number;
  grid: number;
  distance: number;
  textureSize: number;
  anisotropy: number;
  renderScale: number;
}

export interface HeightmapDocument {
  version: number;
  area: number;
  width: number;
  height: number;
  data: string;
}
