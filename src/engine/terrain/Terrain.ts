import { compileGraph } from '../graph/compiler.js';
import { fbmXZ } from '../math/noise.js';
import { TerrainEditStore } from './TerrainEditStore.js';
import type { TerrainChange, TerrainConfig, TerrainSample, Vector3Like } from './types.js';

type HeightFunction = (x: number, z: number) => number;
type TerrainListener = (change: TerrainChange) => void;

const DEFAULT_CONFIG: TerrainConfig = {
  seed: 0,
  editCellSize: 1,
  editChunkSize: 32,
  normalSampleDistance: 0.5
};

function createDefaultHeight(seed: number): HeightFunction {
  const sx = seed * 12.9898;
  const sz = seed * 78.233;
  return (x, z) =>
    6 +
    fbmXZ(x * 0.0048 + sx, z * 0.0048 + sz, 4) * 42 +
    fbmXZ(x * 0.018 + 31 + sx, z * 0.018 - 17 + sz, 4) * 12 +
    fbmXZ(x * 0.065 - 13 + sx, z * 0.065 + 42 + sz, 4) * 1.8;
}

/** Процедурный источник истины о высоте мира; не зависит от камеры и Renderer. */
export class Terrain {
  readonly edits: TerrainEditStore;
  readonly config: TerrainConfig;
  private baseHeight: HeightFunction;
  private readonly listeners = new Set<TerrainListener>();
  private version = 0;

  constructor(baseHeight?: HeightFunction, config: Partial<TerrainConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.baseHeight = baseHeight ?? createDefaultHeight(this.config.seed);
    this.edits = new TerrainEditStore(this.config.editCellSize, this.config.editChunkSize);
  }

  static fromGraph(graph: unknown, config: Partial<TerrainConfig> = {}): Terrain {
    const compiled = compileGraph(graph);
    return new Terrain(compiled.js as HeightFunction, {
      ...config,
      seed: Number((graph as { seed?: number }).seed) || 0
    });
  }

  /** Replaces the procedural source at runtime while preserving sparse edits. */
  setBaseHeight(heightAt: HeightFunction): TerrainChange {
    this.baseHeight = heightAt;
    const change: TerrainChange = {
      version: ++this.version,
      bounds: { minX: -Infinity, minZ: -Infinity, maxX: Infinity, maxZ: Infinity }
    };
    for (const listener of this.listeners) listener(change);
    return change;
  }

  get dataVersion(): number {
    return this.version;
  }

  get allocatedEditBytes(): number {
    return this.edits.allocatedBytes;
  }

  getBaseHeight(x: number, z: number): number {
    return this.baseHeight(x, z);
  }

  getHeight(x: number, z: number): number {
    return this.baseHeight(x, z) + this.edits.sample(x, z);
  }

  /**
   * Samples the exact triangle surface used by the LOD0 render grid.
   * Triangle diagonal is B-C, matching TerrainRenderer geometry indices.
   */
  sampleGround(x: number, z: number, cellSize = 1): TerrainSample {
    if (!(cellSize > 0)) throw new Error('cellSize должен быть положительным');
    const gx = x / cellSize;
    const gz = z / cellSize;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const x0 = ix * cellSize;
    const z0 = iz * cellSize;
    const hA = this.getHeight(x0, z0);
    const hB = this.getHeight(x0 + cellSize, z0);
    const hC = this.getHeight(x0, z0 + cellSize);
    const hD = this.getHeight(x0 + cellSize, z0 + cellSize);

    let height: number;
    let dx: number;
    let dz: number;
    if (fx + fz <= 1) {
      height = hA + (hB - hA) * fx + (hC - hA) * fz;
      dx = (hB - hA) / cellSize;
      dz = (hC - hA) / cellSize;
    } else {
      height = hD + (hC - hD) * (1 - fx) + (hB - hD) * (1 - fz);
      dx = (hD - hC) / cellSize;
      dz = (hD - hB) / cellSize;
    }
    const length = Math.hypot(dx, 1, dz);
    const normal = { x: -dx / length, y: 1 / length, z: -dz / length };
    return { height, normal, slope: 1 - normal.y };
  }

  getGroundHeight(x: number, z: number, cellSize = 1): number {
    return this.sampleGround(x, z, cellSize).height;
  }

  getNormal(x: number, z: number): Vector3Like {
    const e = this.config.normalSampleDistance;
    const dx = (this.getHeight(x + e, z) - this.getHeight(x - e, z)) / (2 * e);
    const dz = (this.getHeight(x, z + e) - this.getHeight(x, z - e)) / (2 * e);
    const length = Math.hypot(dx, 1, dz);
    return { x: -dx / length, y: 1 / length, z: -dz / length };
  }

  getSlope(x: number, z: number): number {
    return 1 - this.getNormal(x, z).y;
  }

  sampleSurface(x: number, z: number): TerrainSample {
    const normal = this.getNormal(x, z);
    return { height: this.getHeight(x, z), normal, slope: 1 - normal.y };
  }

  applyEdit(x: number, z: number, radius: number, amount: number, softness = 0.65): TerrainChange {
    const bounds = this.edits.addRadial(x, z, radius, amount, softness);
    const change = { version: ++this.version, bounds };
    for (const listener of this.listeners) listener(change);
    return change;
  }

  clearEdits(): TerrainChange | null {
    if (this.edits.allocatedChunkCount === 0) return null;
    this.edits.clear();
    const change: TerrainChange = {
      version: ++this.version,
      bounds: { minX: -Infinity, minZ: -Infinity, maxX: Infinity, maxZ: Infinity }
    };
    for (const listener of this.listeners) listener(change);
    return change;
  }

  subscribeChanges(listener: TerrainListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
