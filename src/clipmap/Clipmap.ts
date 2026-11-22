import {
  DEFAULT_CLIPMAP_CONFIG,
  type ClipmapConfig,
  type ClipmapFrame,
  type ClipmapLevelState,
  type ClipmapUpdate,
  type Vec2,
  type Vec3
} from './types.ts';

const finite = (value: number, name: string): void => {
  if (!Number.isFinite(value)) throw new RangeError(name + ' must be finite');
};

const snap = (value: number, step: number): number => Math.floor(value / step + 0.5) * step;

/**
 * Renderer-agnostic clipmap state.
 * Camera and target center are independent inputs; no terrain/planet assumptions.
 */
export class Clipmap {
  readonly config: Readonly<ClipmapConfig>;
  private camera: Vec3 = { x: 0, y: 0, z: 0 };
  private center: Vec2 = { x: 0, z: 0 };
  private levels: ClipmapLevelState[] = [];
  private initialized = false;

  constructor(config: Partial<ClipmapConfig> = {}) {
    const value = { ...DEFAULT_CLIPMAP_CONFIG, ...config };
    if (!Number.isInteger(value.levels) || value.levels < 1) throw new RangeError('levels must be >= 1');
    if (!Number.isInteger(value.resolution) || value.resolution < 4 || value.resolution % 2 !== 0) {
      throw new RangeError('resolution must be an even integer >= 4');
    }
    if (!(value.baseCellSize > 0) || !(value.snapFactor > 0)) throw new RangeError('cell and snap sizes must be > 0');
    this.config = Object.freeze(value);
    this.rebuildLevels();
  }

  /** Set the view camera independently from the clipmap's world-space center. */
  setCamera(camera: Vec3): void {
    finite(camera.x, 'camera.x'); finite(camera.y, 'camera.y'); finite(camera.z, 'camera.z');
    this.camera = { ...camera };
  }

  /** Move the clipmap anchor (e.g. a planet center) independently from the camera. */
  setCenter(center: Vec2): void {
    finite(center.x, 'center.x'); finite(center.z, 'center.z');
    this.center = { ...center };
  }

  /** Atomic convenience update for the common render-loop use case. */
  update(frame: ClipmapFrame): ClipmapUpdate {
    this.setCamera(frame.camera);
    this.setCenter(frame.center);
    const changed = this.rebuildLevels();
    return this.snapshot(changed);
  }

  /** Recalculate snapped level origins after setCamera/setCenter. */
  refresh(): ClipmapUpdate {
    return this.snapshot(this.rebuildLevels());
  }

  getSnapshot(): ClipmapUpdate {
    return this.snapshot(false);
  }

  private rebuildLevels(): boolean {
    const next: ClipmapLevelState[] = [];
    const anchorX = this.center.x + this.camera.x;
    const anchorZ = this.center.z + this.camera.z;

    // All rings must share one world-space center. Snapping each level
    // independently shifts the coarse hole relative to the fine outer edge,
    // creating cracks even when their vertex spacing is otherwise compatible.
    // Snap once to the finest-level interval; every level is then derived
    // from this exact anchor and remains nested on a common lattice.
    const sharedSnapSize = this.config.baseCellSize * this.config.snapFactor;
    const snappedAnchorX = snap(anchorX, sharedSnapSize);
    const snappedAnchorZ = snap(anchorZ, sharedSnapSize);

    for (let index = 0; index < this.config.levels; index++) {
      const cellSize = this.config.baseCellSize * 2 ** index;
      const half = this.config.resolution * cellSize * 0.5;
      next.push({
        index, cellSize, resolution: this.config.resolution,
        origin: { x: snappedAnchorX - half, z: snappedAnchorZ - half },
        worldSize: this.config.resolution * cellSize
      });
    }
    const changed = !this.initialized || next.some((level, i) => {
      const old = this.levels[i];
      return !old || old.origin.x !== level.origin.x || old.origin.z !== level.origin.z;
    });
    this.levels = next;
    this.initialized = true;
    return changed;
  }

  private snapshot(changed: boolean): ClipmapUpdate {
    return {
      changed,
      camera: { ...this.camera },
      center: { ...this.center },
      levels: this.levels.map(level => ({ ...level, origin: { ...level.origin } }))
    };
  }
}
