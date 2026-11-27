import { ClipmapLayout, type ClipmapLevelDefinition } from './ClipmapLayout.js';

export function runClipmapLayoutSelfTests(): { passed: string[] } {
  const passed: string[] = [];
  const assert = (condition: boolean, message: string): void => {
    if (!condition) throw new Error('Clipmap layout self-test: ' + message);
    passed.push(message);
  };
  const levels: ClipmapLevelDefinition[] = [
    { level: 0, step: 1, cut: 0, outer: 10, tiles: [{ ox: -2, oz: -2 }, { ox: 0, oz: 0 }] },
    { level: 1, step: 2, cut: 10, outer: 20, tiles: [{ ox: -2, oz: -2 }, { ox: 0, oz: 0 }] }
  ];
  const layout = new ClipmapLayout(levels, 2);

  layout.update(0, 10, 0, 0);
  assert(layout.altitude === 6, 'высота камеры над Terrain учитывает прежний отступ 4 метра');
  assert(layout.visibleTiles === 2, 'на земле видимы детальный уровень, а дальний уровень скрыт порогом cut');
  assert(layout.placements[0] === 0 && layout.placements[1] === 0, 'первый тайл получает привязанный к сетке центр уровня');
  assert(layout.placements[2] === 1 && layout.placements[8] === 0, 'видимость записывается отдельно для каждого переиспользуемого тайла');

  layout.update(5, 10, -5, 0);
  assert(layout.placements[0] === 6 && layout.placements[1] === -4, 'центр Clipmap сохраняет Math.round-привязку на положительных и отрицательных координатах');

  layout.update(0, 30, 0, 0);
  assert(layout.altitude === 26, 'высотный режим вычисляет ту же абсолютную высоту над поверхностью');
  assert(layout.visibleTiles === 2 && layout.placements[2] === 0 && layout.placements[8] === 1, 'при подъёме скрывается детальный уровень и остаётся последний дальний уровень');

  const placements = layout.placements;
  const levelOffsets = layout.levelTileOffsets;
  layout.update(12, 14, 9, 3);
  assert(layout.placements === placements && layout.levelTileOffsets === levelOffsets, 'обновление повторно использует заранее выделенные буферы без новых массивов');
  assert(layout.cameraX === 12 && layout.cameraZ === 9, 'снимок положения камеры обновляется без зависимости от Three.js');

  const cutoff = new ClipmapLayout([
    { level: 0, step: 1, cut: 0, outer: 10, tiles: [{ ox: 30, oz: 30 }] },
    { level: 1, step: 2, cut: 0, outer: 20, tiles: [{ ox: 30, oz: 30 }] }
  ], 2);
  cutoff.update(0, 10, 0, 0);
  assert(cutoff.placements[2] === 0, 'тайл за внешней границей скрывается на промежуточном уровне');
  assert(cutoff.placements[5] === 1, 'последний уровень остаётся видимым за внешней границей');

  let rejected = false;
  try {
    new ClipmapLayout(levels, 0);
  } catch {
    rejected = true;
  }
  assert(rejected, 'некорректный размер тайла отклоняется до создания буферов');

  return { passed };
}
