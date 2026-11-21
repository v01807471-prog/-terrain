import { compileGraph } from '../graph/compiler.js';
import { originalBaseHeight } from '../math/noise.js';
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

/** Процедурный источник истины о высоте мира; не зависит от камеры и Renderer. */
export class Terrain {
  readonly edits: TerrainEditStore;
  readonly config: TerrainConfig;
  private readonly baseHeight: HeightFunction;
  private readonly listeners = new Set<TerrainListener>();
  private version = 0;

  constructor(baseHeight: HeightFunction = originalBaseHeight, config: Partial<TerrainConfig> = {}) {
    this.baseHeight = baseHeight;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.edits = new TerrainEditStore(this.config.editCellSize, this.config.editChunkSize);
  }

  static fromGraph(graph: unknown, config: Partial<TerrainConfig> = {}): Terrain {
    const compiled = compileGraph(graph);
    return new Terrain(compiled.js as HeightFunction, {
      ...config,
      seed: Number((graph as { seed?: number }).seed) || 0
    });
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
    return { height: this.getHeight(x, z), normal: this.getNormal(x, z), slope: this.getSlope(x, z) };
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
