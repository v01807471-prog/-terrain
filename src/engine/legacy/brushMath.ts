export type BrushTool = 'raise' | 'lower' | 'flatten' | 'smooth' | 'slope' | 'noise';

/** Возвращает прежнюю кривую затухания legacy-кисти. */
export function smoothFalloff(distance: number, radius: number, softness: number): number {
  if (distance >= radius) return 0;

  const t = 1 - distance / radius;
  const edge = Math.pow(t, 0.4 + (1 - softness) * 3);

  return edge * edge * (3 - 2 * edge);
}

/** Ослабляет мазок у границы конечного legacy-хранилища дельт. */
export function brushEdgeFactor(indexX: number, indexY: number, size: number): number {
  return Math.min(1, Math.min(indexX, indexY, size - 1 - indexX, size - 1 - indexY) / 12);
}

/**
 * Вычисляет прежнее среднее значение окна 5×5.
 * За пределами хранилища образец пропускается, а не заменяется нулём.
 */
export function sampleSmoothHeight(
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  readHeight: (x: number, y: number) => number
): number {
  let sum = 0;
  let count = 0;

  for (let offsetY = -2; offsetY <= 2; offsetY++) {
    for (let offsetX = -2; offsetX <= 2; offsetX++) {
      const x = centerX + offsetX;
      const y = centerY + offsetY;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      sum += readHeight(x, y);
      count++;
    }
  }

  return sum / count;
}

/**
 * Применяет одну из шести существующих формул кистей к значению дельты.
 * Геометрия мазка, чтение Terrain и запись/история остаются у редактора.
 */
export function calculateBrushDelta(
  tool: BrushTool,
  currentDelta: number,
  currentHeight: number,
  falloff: number,
  direction: number,
  rate: number,
  smoothingWeight: number,
  targetHeight: number,
  noiseSample: number
): number {
  switch (tool) {
    case 'raise':
      return currentDelta + direction * rate * falloff;
    case 'lower':
      return currentDelta - direction * rate * falloff;
    case 'flatten':
    case 'smooth':
    case 'slope':
      return currentDelta + (targetHeight - currentHeight) * smoothingWeight * falloff;
    case 'noise':
      return currentDelta + direction * noiseSample * rate * falloff * 0.6;
    default:
      return currentDelta;
  }
}
