import {
  brushEdgeFactor,
  calculateBrushDelta,
  sampleSmoothHeight,
  smoothFalloff,
  type BrushTool
} from './brushMath.js';

export function runBrushMathSelfTests(): { passed: string[] } {
  const passed: string[] = [];
  const assert = (condition: boolean, message: string): void => {
    if (!condition) throw new Error('Brush math self-test: ' + message);
    passed.push(message);
  };
  const closeTo = (actual: number, expected: number): boolean =>
    Math.abs(actual - expected) < 1e-6;

  assert(smoothFalloff(2, 2, 0.5) === 0,
    'затухание равно нулю на границе и за пределами радиуса');
  assert(smoothFalloff(0, 2, 0.5) === 1,
    'затухание в центре кисти равно единице');
  const t = 0.75;
  const edge = Math.pow(t, 0.4 + (1 - 0.25) * 3);
  assert(closeTo(smoothFalloff(0.5, 2, 0.25), edge * edge * (3 - 2 * edge)),
    'промежуточное затухание сохраняет legacy-кривую и параметр softness');

  assert(brushEdgeFactor(50, 50, 100) === 1,
    'в центре хранилища краевое ослабление не меняет силу кисти');
  assert(brushEdgeFactor(0, 50, 100) === 0,
    'на границе хранилища краевое ослабление равно нулю');
  assert(brushEdgeFactor(6, 50, 100) === 0.5,
    'краевое ослабление линейно на первых двенадцати текселях');

  const grid = Float32Array.from({ length: 25 }, (_, index) => index);
  let interiorReads = 0;
  const interior = sampleSmoothHeight(2, 2, 5, 5, (x, y) => {
    interiorReads++;
    return grid[y * 5 + x];
  });
  assert(interior === 12 && interiorReads === 25,
    'сглаживание внутри хранилища использует все 25 значений окна');

  let cornerReads = 0;
  const corner = sampleSmoothHeight(0, 0, 5, 5, (x, y) => {
    cornerReads++;
    return grid[y * 5 + x];
  });
  assert(corner === 6 && cornerReads === 9,
    'сглаживание у угла усредняет только девять существующих значений');

  const base = {
    currentDelta: 2,
    currentHeight: 12,
    falloff: 0.5,
    direction: 1,
    rate: 4,
    smoothingWeight: 0.25,
    targetHeight: 20,
    noiseSample: 0.75
  };
  const apply = (tool: BrushTool, direction = base.direction, targetHeight = base.targetHeight): number =>
    calculateBrushDelta(
      tool,
      base.currentDelta,
      base.currentHeight,
      base.falloff,
      direction,
      base.rate,
      base.smoothingWeight,
      targetHeight,
      base.noiseSample
    );

  assert(apply('raise') === 4,
    'кисть raise сохраняет прибавление rate × falloff');
  assert(apply('raise', -1) === 0,
    'обратное направление raise сохраняет знак изменения');
  assert(apply('lower') === 0,
    'кисть lower сохраняет вычитание rate × falloff');
  assert(apply('lower', -1) === 4,
    'обратное направление lower сохраняет знак изменения');
  assert(apply('flatten') === 3,
    'кисть flatten интерполирует высоту к заданной цели');
  assert(apply('smooth', 1, 8) === 1.5,
    'кисть smooth интерполирует высоту к среднему значению окна');
  assert(apply('slope', 1, 16) === 2.5,
    'кисть slope интерполирует высоту к рассчитанной плоскости');
  assert(closeTo(apply('noise'), 2.9),
    'кисть noise сохраняет масштаб шума и коэффициент 0.6');

  return { passed };
}
