import type { TerrainBounds } from './types.js';

interface EditChunk {
  values: Float32Array;
  nonZeroCount: number;
}

/** Разреженные дельты высоты. Память выделяется только для затронутых блоков. */
export class TerrainEditStore {
  private readonly chunks = new Map<string, EditChunk>();
  private readonly stride: number;

  constructor(
    readonly cellSize = 1,
    readonly chunkSize = 32
  ) {
    if (!(cellSize > 0) || !Number.isInteger(chunkSize) || chunkSize < 2) {
      throw new Error('Некорректный размер ячейки или блока TerrainEditStore');
    }
    this.stride = chunkSize + 1;
  }

  get allocatedChunkCount(): number {
    return this.chunks.size;
  }

  get allocatedBytes(): number {
    return this.chunks.size * this.stride * this.stride * Float32Array.BYTES_PER_ELEMENT;
  }

  private locate(gx: number, gz: number) {
    const cx = Math.floor(gx / this.chunkSize);
    const cz = Math.floor(gz / this.chunkSize);
    const lx = gx - cx * this.chunkSize;
    const lz = gz - cz * this.chunkSize;
    return { key: cx + ':' + cz, index: lz * this.stride + lx };
  }

  private readNode(gx: number, gz: number): number {
    const { key, index } = this.locate(gx, gz);
    return this.chunks.get(key)?.values[index] ?? 0;
  }

  private writeNode(gx: number, gz: number, delta: number): void {
    const { key, index } = this.locate(gx, gz);
    let chunk = this.chunks.get(key);
    if (!chunk && delta !== 0) {
      chunk = { values: new Float32Array(this.stride * this.stride), nonZeroCount: 0 };
      this.chunks.set(key, chunk);
    }
    if (!chunk) return;

    const previous = chunk.values[index];
    if (previous === delta) return;
    if (previous === 0 && delta !== 0) chunk.nonZeroCount++;
    if (previous !== 0 && delta === 0) chunk.nonZeroCount--;
    chunk.values[index] = delta;
    if (chunk.nonZeroCount === 0) this.chunks.delete(key);
  }

  sample(x: number, z: number): number {
    const gx = x / this.cellSize;
    const gz = z / this.cellSize;
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const tx = gx - x0;
    const tz = gz - z0;
    const a = this.readNode(x0, z0);
    const b = this.readNode(x0 + 1, z0);
    const c = this.readNode(x0, z0 + 1);
    const d = this.readNode(x0 + 1, z0 + 1);
    const top = a + (b - a) * tx;
    const bottom = c + (d - c) * tx;
    return top + (bottom - top) * tz;
  }

  /** Добавляет плавную круглую правку к дельте исходной процедурной высоты. */
  addRadial(x: number, z: number, radius: number, amount: number, softness = 0.65): TerrainBounds {
    if (!(radius > 0) || !Number.isFinite(amount)) throw new Error('Некорректная кисть Terrain');
    const minGX = Math.floor((x - radius) / this.cellSize);
    const maxGX = Math.ceil((x + radius) / this.cellSize);
    const minGZ = Math.floor((z - radius) / this.cellSize);
    const maxGZ = Math.ceil((z + radius) / this.cellSize);
    const soft = Math.max(0, Math.min(1, softness));

    for (let gz = minGZ; gz <= maxGZ; gz++) {
      for (let gx = minGX; gx <= maxGX; gx++) {
        const wx = gx * this.cellSize;
        const wz = gz * this.cellSize;
        const distance = Math.hypot(wx - x, wz - z);
        if (distance >= radius) continue;
        const t = 1 - distance / radius;
        const exponent = 0.4 + (1 - soft) * 3;
        const falloff = Math.pow(t, exponent);
        const weight = falloff * falloff * (3 - 2 * falloff);
        const next = this.readNode(gx, gz) + amount * weight;
        this.writeNode(gx, gz, Math.abs(next) < 1e-5 ? 0 : next);
      }
    }

    return { minX: x - radius, minZ: z - radius, maxX: x + radius, maxZ: z + radius };
  }

  clear(): void {
    this.chunks.clear();
  }
}
