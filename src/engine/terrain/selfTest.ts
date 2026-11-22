import { TerrainEditStore } from './TerrainEditStore.js';
import { Terrain } from './Terrain.js';
import { TerrainUpdateQueue } from './TerrainUpdateQueue.js';
import { PRESET_GRAPHS, defaultGraph } from '../legacy/graphPresets.js';
import { compileGraph } from '../graph/compiler.js';

export interface TerrainSelfTestResult {
  passed: string[];
}

export function runTerrainSelfTests(): TerrainSelfTestResult {
  const passed: string[] = [];
  const assert = (condition: boolean, message: string): void => {
    if (!condition) throw new Error('Terrain self-test: ' + message);
    passed.push(message);
  };
  const near = (actual: number, expected: number, epsilon = 1e-6): boolean =>
    Math.abs(actual - expected) <= epsilon;

  const coordinates = [
    [-1200.5, -340.25],
    [-31, 18],
    [0, 0],
    [128.75, -92.5],
    [4096, 2048]
  ] as const;
  const first = new Terrain(undefined, { seed: 173 });
  const second = new Terrain(undefined, { seed: 173 });
  const otherSeed = new Terrain(undefined, { seed: 174 });
  const firstSamples = coordinates.map(([x, z]) => first.getBaseHeight(x, z));
  const secondSamples = coordinates.map(([x, z]) => second.getBaseHeight(x, z));
  const otherSamples = coordinates.map(([x, z]) => otherSeed.getBaseHeight(x, z));

  assert(firstSamples.every((value, index) => value === secondSamples[index]),
    'одинаковые seed и координаты дают побитово одинаковую CPU-высоту');
  assert(firstSamples.every(Number.isFinite), 'процедурная высота конечна на отрицательных и больших координатах');
  assert(firstSamples.some((value, index) => Math.abs(value - otherSamples[index]) > 1e-6),
    'изменение seed меняет процедурный рельеф');
  assert(first.edits.allocatedChunkCount === 0 && first.allocatedEditBytes === 0,
    'нетронутый мир не выделяет память под heightmap или блоки правок');

  const graph = {
    seed: 29,
    nodes: [
      { id: 1, type: 'noise', p: { scale: 0.012, oct: 3, ns: 4 } },
      { id: 2, type: 'mul', d: { b: 18 }, in: { a: 1 } },
      { id: 3, type: 'out_height', in: { h: 2 } }
    ]
  };
  const graphA = Terrain.fromGraph(graph);
  const graphB = Terrain.fromGraph(graph);
  const graphC = Terrain.fromGraph({ ...graph, seed: 30 });
  const graphHeight = graphA.getBaseHeight(-73.25, 119.5);
  assert(graphHeight === graphB.getBaseHeight(-73.25, 119.5),
    'CPU-высота Blueprint-графа детерминирована');
  assert(Math.abs(graphHeight - graphC.getBaseHeight(-73.25, 119.5)) > 1e-6,
    'seed Blueprint-графа влияет на процедурную высоту');

  const presetNames = ['hills', 'mountains', 'islands', 'plains', 'terraces'] as const;
  for (const presetName of presetNames) {
    const presetA = PRESET_GRAPHS[presetName](41);
    const presetB = PRESET_GRAPHS[presetName](41);
    const compiledA = compileGraph(presetA);
    const compiledB = compileGraph(presetB);
    const heightA = compiledA.js(-73.25, 119.5);
    assert(Number.isFinite(heightA), 'legacy-пресет ' + presetName + ' компилируется в конечную CPU-высоту');
    assert(heightA === compiledB.js(-73.25, 119.5),
      'legacy-пресет ' + presetName + ' сохраняет детерминизм при одинаковом seed');
    assert(['out_height', 'out_color', 'out_water', 'out_fog'].every(type =>
      presetA.nodes.some(node => node.type === type)),
    'legacy-пресет ' + presetName + ' сохраняет выходы высоты, цвета, воды и тумана');
  }
  const defaultPreset = defaultGraph();
  assert(defaultPreset.seed === 0 && defaultPreset.nodes.length === PRESET_GRAPHS.hills(0).nodes.length,
    'граф по умолчанию остаётся прежним hills-пресетом с seed 0');
  const islandGraph = PRESET_GRAPHS.islands(41);
  const islandWater = islandGraph.nodes.find(node => node.type === 'out_water');
  assert(islandWater?.d.level === -1, 'островной пресет сохраняет исходный уровень воды');

  const edits = new TerrainEditStore(1, 8);
  assert(edits.allocatedChunkCount === 0 && edits.allocatedBytes === 0,
    'TerrainEditStore создаётся без предварительного выделения блоков');
  edits.addRadial(2, 2, 1.5, 2);
  const firstChunkCount = edits.allocatedChunkCount;
  assert(firstChunkCount === 1, 'первый мазок лениво создаёт только затронутый блок');
  edits.addRadial(3, 2, 1.5, 1);
  assert(edits.allocatedChunkCount === firstChunkCount,
    'повторный мазок в той же области использует существующий блок');
  edits.addRadial(8, 2, 1.5, 1);
  assert(edits.allocatedChunkCount === 2,
    'мазок через границу блока выделяет только соседний блок');
  assert(edits.sample(2, 2) > 2, 'разреженная дельта корректно читается в точке мазка');

  const negativeEdits = new TerrainEditStore(1, 8);
  negativeEdits.addRadial(-1, -1, 1.5, 1);
  assert(negativeEdits.sample(-1, -1) > 0,
    'индексация разреженных блоков корректна для отрицательных координат');

  const reversibleEdits = new TerrainEditStore(1, 8);
  reversibleEdits.addRadial(2, 2, 1.5, 2);
  reversibleEdits.addRadial(2, 2, 1.5, -2);
  assert(reversibleEdits.allocatedChunkCount === 0 && reversibleEdits.allocatedBytes === 0,
    'обнулённые блоки освобождаются после обратного мазка');

  const editedTerrain = new Terrain(() => 12, { editCellSize: 1, editChunkSize: 8 });
  const originalBase = editedTerrain.getBaseHeight(2, 2);
  const originalHeight = editedTerrain.getHeight(2, 2);
  const changes: Array<{ version: number; bounds: { minX: number; minZ: number; maxX: number; maxZ: number } }> = [];
  const unsubscribe = editedTerrain.subscribeChanges(change => changes.push(change));
  const editChange = editedTerrain.applyEdit(2, 2, 1.5, 3);
  assert(editedTerrain.getBaseHeight(2, 2) === originalBase,
    'локальная правка не меняет процедурную основу');
  assert(editedTerrain.getHeight(2, 2) > originalHeight + 2.9,
    'getHeight возвращает процедурную основу с локальной дельтой');
  assert(editChange.version === 1 && changes[0]?.version === 1,
    'изменение Terrain публикует возрастающую версию и событие');
  assert(near(editChange.bounds.minX, 0.5) && near(editChange.bounds.maxX, 3.5),
    'событие кисти содержит ограниченную dirty-область');
  const clearChange = editedTerrain.clearEdits();
  assert(clearChange?.version === 2 && editedTerrain.edits.allocatedChunkCount === 0,
    'очистка правок освобождает sparse store и увеличивает версию');
  assert(clearChange?.bounds.minX === -Infinity && clearChange.bounds.maxX === Infinity,
    'полный сброс явно помечает всю область мира изменённой');
  assert(editedTerrain.clearEdits() === null, 'повторная очистка пустого store не создаёт ложное событие');
  unsubscribe();
  editedTerrain.applyEdit(2, 2, 1.5, 1);
  assert(changes.length === 2, 'отписка прекращает получение событий Terrain');

  const queue = new TerrainUpdateQueue({ maxRegionsPerDrain: 1 });
  const originalChange = {
    version: 1,
    bounds: { minX: 0, minZ: 0, maxX: 4, maxZ: 4 }
  };
  queue.enqueue(originalChange);
  queue.enqueue({ version: 2, bounds: { minX: 4, minZ: 1, maxX: 6, maxZ: 3 } });
  queue.enqueue({ version: 4, bounds: { minX: 6, minZ: 3, maxX: 8, maxZ: 5 } });
  assert(queue.pendingCount === 1, 'очередь объединяет пересекающиеся и соприкасающиеся области транзитивно');
  const mergedChange = queue.drain({ maxRegions: 1 })[0];
  assert(mergedChange.version === 4
    && mergedChange.bounds.minX === 0
    && mergedChange.bounds.minZ === 0
    && mergedChange.bounds.maxX === 8
    && mergedChange.bounds.maxZ === 5,
  'объединённая область сохраняет последнюю версию и точные общие границы');
  assert(queue.pendingCount === 0 && originalChange.bounds.maxX === 4,
    'drain удаляет только выданную область и не изменяет исходное событие');

  const prioritizedQueue = new TerrainUpdateQueue({ maxRegionsPerDrain: 1 });
  prioritizedQueue.enqueue({ version: 1, bounds: { minX: 100, minZ: 100, maxX: 110, maxZ: 110 } });
  prioritizedQueue.enqueue({ version: 2, bounds: { minX: 2, minZ: 2, maxX: 3, maxZ: 3 } });
  const nearest = prioritizedQueue.drain({ priority: { x: 0, z: 0 } })[0];
  assert(nearest.version === 2 && prioritizedQueue.pendingCount === 1,
    'очередь отдаёт ближайшую к камере область и соблюдает лимит выдачи');

  const fullResetQueue = new TerrainUpdateQueue();
  fullResetQueue.enqueue({
    version: 5,
    bounds: { minX: -Infinity, minZ: -Infinity, maxX: Infinity, maxZ: Infinity }
  });
  fullResetQueue.enqueue({ version: 6, bounds: { minX: 1, minZ: 2, maxX: 3, maxZ: 4 } });
  const fullReset = fullResetQueue.drain()[0];
  assert(fullReset.version === 6 && fullReset.bounds.minX === -Infinity && fullReset.bounds.maxX === Infinity,
    'полный сброс поглощает локальные dirty-области и сохраняет последнюю версию');

  const plane = new Terrain((x, z) => 2 * x + 3 * z, { normalSampleDistance: 0.25 });
  const firstTriangle = plane.sampleGround(0.25, 0.5, 1);
  const secondTriangle = plane.sampleGround(0.75, 0.75, 1);
  const normalLength = Math.sqrt(14);
  assert(near(firstTriangle.height, 2) && near(secondTriangle.height, 3.75),
    'выборка поверхности совпадает с обоими треугольниками сетки LOD0');
  assert(near(firstTriangle.normal.x, -2 / normalLength)
    && near(firstTriangle.normal.y, 1 / normalLength)
    && near(firstTriangle.normal.z, -3 / normalLength),
  'нормаль плоскости вычисляется из той же треугольной поверхности');
  assert(near(plane.getSlope(0.25, 0.5), 1 - 1 / normalLength),
    'уклон согласован с нормалью поверхности');

  return { passed };
}
