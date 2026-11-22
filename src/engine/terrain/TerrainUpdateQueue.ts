import type { Terrain } from './Terrain.js';
import type { TerrainBounds, TerrainChange } from './types.js';

export interface TerrainUpdateQueueOptions {
  /** Максимальное число объединённых областей, выдаваемых за один drain(). */
  maxRegionsPerDrain?: number;
  /** Допуск между прямоугольниками для объединения; 0 объединяет пересечения и касания. */
  mergeGap?: number;
}

export interface TerrainUpdateDrainOptions {
  maxRegions?: number;
  /** Необязательная мировая точка для приоритета ближайших областей. */
  priority?: { x: number; z: number };
}

function intersectsOrTouches(a: TerrainBounds, b: TerrainBounds, gap: number): boolean {
  return a.minX <= b.maxX + gap
    && a.maxX + gap >= b.minX
    && a.minZ <= b.maxZ + gap
    && a.maxZ + gap >= b.minZ;
}

function unionBounds(a: TerrainBounds, b: TerrainBounds): TerrainBounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minZ: Math.min(a.minZ, b.minZ),
    maxX: Math.max(a.maxX, b.maxX),
    maxZ: Math.max(a.maxZ, b.maxZ)
  };
}

function distanceToBoundsSquared(point: { x: number; z: number }, bounds: TerrainBounds): number {
  const dx = Math.max(bounds.minX - point.x, 0, point.x - bounds.maxX);
  const dz = Math.max(bounds.minZ - point.z, 0, point.z - bounds.maxZ);
  return dx * dx + dz * dz;
}

/**
 * Объединяет dirty-прямоугольники Terrain и выдаёт их renderer порциями.
 * Очередь не владеет данными Terrain и не меняет исходные события.
 */
export class TerrainUpdateQueue {
  private readonly pending: TerrainChange[] = [];

  constructor(private readonly options: TerrainUpdateQueueOptions = {}) {
    const limit = options.maxRegionsPerDrain ?? 8;
    const gap = options.mergeGap ?? 0;
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('maxRegionsPerDrain должен быть положительным целым числом');
    }
    if (!Number.isFinite(gap) || gap < 0) {
      throw new Error('mergeGap должен быть конечным неотрицательным числом');
    }
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /** Подписывает очередь на изменения Terrain; возвращает функцию отключения. */
  connect(terrain: Pick<Terrain, 'subscribeChanges'>): () => void {
    return terrain.subscribeChanges(change => this.enqueue(change));
  }

  enqueue(change: TerrainChange): void {
    let merged: TerrainChange = {
      version: change.version,
      bounds: { ...change.bounds }
    };

    // Повторяем проход после каждого слияния: новый прямоугольник может
    // соединить области, которые до этого не пересекались между собой.
    for (let index = 0; index < this.pending.length;) {
      const existing = this.pending[index];
      if (!intersectsOrTouches(existing.bounds, merged.bounds, this.options.mergeGap ?? 0)) {
        index++;
        continue;
      }

      merged = {
        version: Math.max(existing.version, merged.version),
        bounds: unionBounds(existing.bounds, merged.bounds)
      };
      this.pending.splice(index, 1);
      index = 0;
    }

    this.pending.push(merged);
  }

  drain(options: TerrainUpdateDrainOptions = {}): TerrainChange[] {
    const maxRegions = options.maxRegions ?? this.options.maxRegionsPerDrain ?? 8;
    if (!Number.isInteger(maxRegions) || maxRegions < 0) {
      throw new Error('maxRegions должен быть неотрицательным целым числом');
    }
    if (maxRegions === 0 || this.pending.length === 0) return [];

    const ordered = this.pending.map((change, index) => ({
      index,
      distance: options.priority
        ? distanceToBoundsSquared(options.priority, change.bounds)
        : index
    }));

    if (options.priority) {
      ordered.sort((a, b) => a.distance - b.distance || a.index - b.index);
    }

    const selected = ordered.slice(0, maxRegions);
    const selectedIndices = new Set(selected.map(item => item.index));
    const result = selected.map(item => {
      const change = this.pending[item.index];
      return { version: change.version, bounds: { ...change.bounds } };
    });

    for (let index = this.pending.length - 1; index >= 0; index--) {
      if (selectedIndices.has(index)) this.pending.splice(index, 1);
    }

    return result;
  }

  clear(): void {
    this.pending.length = 0;
  }
}
