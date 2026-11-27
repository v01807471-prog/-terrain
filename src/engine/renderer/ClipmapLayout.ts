export interface ClipmapTileOffset {
  readonly ox: number;
  readonly oz: number;
}

export interface ClipmapLevelDefinition {
  readonly level: number;
  readonly step: number;
  readonly cut: number;
  readonly outer: number;
  readonly tiles: readonly ClipmapTileOffset[];
}

/**
 * Рассчитывает размещение уже созданных тайлов Clipmap.
 * Модуль не зависит от Terrain, камеры Three.js или GPU: высоту под камерой
 * передаёт вызывающая сторона, а результат записывается в заранее выделенный буфер.
 *
 * Формат placements: для каждого тайла подряд идут centerX, centerZ и флаг видимости (0/1).
 */
export class ClipmapLayout {
  readonly placements: Float64Array;
  readonly levelTileOffsets: Uint32Array;
  readonly levelCount: number;

  altitude = 0;
  visibleTiles = 0;
  cameraX = 0;
  cameraZ = 0;

  private readonly levelNumbers: Int32Array;
  private readonly steps: Float64Array;
  private readonly cuts: Float64Array;
  private readonly outers: Float64Array;
  private readonly tileOffsets: Float64Array;
  private readonly tileSize: number;
  private readonly lastLevel: number;

  constructor(levels: readonly ClipmapLevelDefinition[], tileSize: number) {
    if (!Number.isFinite(tileSize) || tileSize <= 0) {
      throw new RangeError('Размер тайла Clipmap должен быть положительным числом');
    }

    this.levelCount = levels.length;
    this.tileSize = tileSize;
    this.levelNumbers = new Int32Array(levels.length);
    this.steps = new Float64Array(levels.length);
    this.cuts = new Float64Array(levels.length);
    this.outers = new Float64Array(levels.length);
    this.levelTileOffsets = new Uint32Array(levels.length + 1);

    let totalTiles = 0;
    let lastLevel = -1;

    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      if (!Number.isInteger(level.level) || level.level < 0) {
        throw new RangeError('Индекс уровня Clipmap должен быть неотрицательным целым числом');
      }
      if (!Number.isFinite(level.step) || level.step <= 0) {
        throw new RangeError('Шаг уровня Clipmap должен быть положительным числом');
      }
      if (!Number.isFinite(level.cut) || level.cut < 0 || !Number.isFinite(level.outer) || level.outer < 0) {
        throw new RangeError('Границы перехода LOD должны быть конечными неотрицательными числами');
      }

      this.levelNumbers[i] = level.level;
      this.steps[i] = level.step;
      this.cuts[i] = level.cut;
      this.outers[i] = level.outer;
      this.levelTileOffsets[i] = totalTiles;
      lastLevel = Math.max(lastLevel, level.level);

      for (const tile of level.tiles) {
        if (!Number.isFinite(tile.ox) || !Number.isFinite(tile.oz)) {
          throw new RangeError('Смещение тайла Clipmap должно быть конечным числом');
        }
        totalTiles++;
      }
    }

    this.levelTileOffsets[levels.length] = totalTiles;
    this.lastLevel = lastLevel;
    this.tileOffsets = new Float64Array(totalTiles * 2);
    this.placements = new Float64Array(totalTiles * 3);

    let tileIndex = 0;
    for (const level of levels) {
      for (const tile of level.tiles) {
        const offset = tileIndex * 2;
        this.tileOffsets[offset] = tile.ox;
        this.tileOffsets[offset + 1] = tile.oz;
        tileIndex++;
      }
    }
  }

  /**
   * Обновляет буфер без выделения новых массивов или объектов.
   * Сетка центра каждого уровня привязана к шагу 2 * step, как в legacy renderer.
   */
  update(cameraX: number, cameraY: number, cameraZ: number, groundHeight: number): void {
    if (!Number.isFinite(cameraX) || !Number.isFinite(cameraY) || !Number.isFinite(cameraZ) || !Number.isFinite(groundHeight)) {
      throw new RangeError('Положение камеры и высота Terrain должны быть конечными числами');
    }

    this.cameraX = cameraX;
    this.cameraZ = cameraZ;
    this.altitude = Math.max(0, cameraY - groundHeight - 4);

    let visibleTiles = 0;

    for (let levelIndex = 0; levelIndex < this.levelCount; levelIndex++) {
      const step = this.steps[levelIndex];
      const gridStep = 2 * step;
      const centerX = Math.round(cameraX / gridStep) * gridStep;
      const centerZ = Math.round(cameraZ / gridStep) * gridStep;
      const size = this.tileSize * step;
      const cut = this.cuts[levelIndex];
      const outer = this.outers[levelIndex];
      const last = this.levelNumbers[levelIndex] === this.lastLevel;
      const firstTile = this.levelTileOffsets[levelIndex];
      const endTile = this.levelTileOffsets[levelIndex + 1];

      for (let tileIndex = firstTile; tileIndex < endTile; tileIndex++) {
        const sourceOffset = tileIndex * 2;
        const outputOffset = tileIndex * 3;
        const x0 = centerX + this.tileOffsets[sourceOffset] * step;
        const x1 = x0 + size;
        const z0 = centerZ + this.tileOffsets[sourceOffset + 1] * step;
        const z1 = z0 + size;

        const minDistance = Math.max(
          Math.max(x0 - cameraX, 0, cameraX - x1),
          Math.max(z0 - cameraZ, 0, cameraZ - z1),
          this.altitude
        );
        const maxDistance = Math.max(
          Math.abs(x0 - cameraX),
          Math.abs(x1 - cameraX),
          Math.abs(z0 - cameraZ),
          Math.abs(z1 - cameraZ),
          this.altitude
        );

        const visible = maxDistance >= cut && (last || minDistance < outer);
        this.placements[outputOffset] = centerX;
        this.placements[outputOffset + 1] = centerZ;
        this.placements[outputOffset + 2] = visible ? 1 : 0;
        if (visible) visibleTiles++;
      }
    }

    this.visibleTiles = visibleTiles;
  }
}
