export type LegacyGraphPreset = 'hills' | 'mountains' | 'islands' | 'plains' | 'terraces';

export interface LegacyGraphNode {
  id: number;
  type: string;
  x: number;
  y: number;
  p: Record<string, string | number>;
  d: Record<string, string | number>;
  in: Record<string, number>;
}

export interface LegacyGraph {
  seed: number;
  nodes: LegacyGraphNode[];
}

type PresetNode = [
  type: string,
  x: number,
  y: number,
  parameters?: Record<string, string | number>,
  defaults?: Record<string, string | number>,
  connections?: Record<string, number>
];

function createGraph(seed: number, list: PresetNode[]): LegacyGraph {
  return {
    seed,
    nodes: list.map((node, index) => ({
      id: index + 1,
      type: node[0],
      x: node[1],
      y: node[2],
      p: node[3] || {},
      d: node[4] || {},
      in: node[5] || {}
    }))
  };
}

function createColorNodes(offset: number): PresetNode[] {
  return [
    ['grass', 30, 440],
    ['rock', 30, 510],
    ['slope', 30, 580],
    ['smooth', 260, 580, { e0: 0.42, e1: 0.68 }, {}, { a: offset + 3 }],
    ['cmix', 480, 470, {}, {}, { a: offset + 1, b: offset + 2, t: offset + 4 }],
    ['height', 30, 650],
    ['smooth', 260, 650, { e0: 30, e1: 48 }, {}, { a: offset + 6 }],
    ['mul', 480, 650, {}, { b: 0.8 }, { a: offset + 7 }],
    ['color', 480, 560, { col: '#76726c' }],
    ['cmix', 720, 500, {}, {}, { a: offset + 5, b: offset + 9, t: offset + 8 }],
    ['out_color', 960, 500, {}, {}, { c: offset + 10 }]
  ];
}

export function ensureEnv(graph: LegacyGraph): LegacyGraph {
  const nextId = (): number => graph.nodes.reduce((max, node) => Math.max(max, node.id), 0) + 1;
  if (!graph.nodes.some(node => node.type === 'out_water')) {
    graph.nodes.push({ id: nextId(), type: 'out_water', x: 1180, y: 40, p: {}, d: {}, in: {} });
  }
  if (!graph.nodes.some(node => node.type === 'out_fog')) {
    graph.nodes.push({ id: nextId(), type: 'out_fog', x: 1180, y: 330, p: {}, d: {}, in: {} });
  }
  return graph;
}

function createPreset(seed: number, heightNodes: PresetNode[]): LegacyGraph {
  return ensureEnv(createGraph(seed, [...heightNodes, ...createColorNodes(heightNodes.length)]));
}

/** Пресеты legacy-редактора вынесены без изменения состава узлов и их связей. */
export const PRESET_GRAPHS: Record<LegacyGraphPreset, (seed: number) => LegacyGraph> = {
  hills: seed => createPreset(seed, [
    ['noise', 30, 30, { scale: 0.0048, oct: 4 }],
    ['mul', 260, 30, {}, { b: 42 }, { a: 1 }],
    ['noise', 30, 130, { scale: 0.018, ox: 31, oz: -17, oct: 4 }],
    ['mul', 260, 130, {}, { b: 12 }, { a: 3 }],
    ['noise', 30, 230, { scale: 0.065, ox: -13, oz: 42, oct: 4 }],
    ['mul', 260, 230, {}, { b: 1.8 }, { a: 5 }],
    ['add', 480, 60, {}, {}, { a: 2, b: 4 }],
    ['add', 480, 160, {}, {}, { a: 7, b: 6 }],
    ['add', 690, 100, {}, { b: 6 }, { a: 8 }],
    ['out_height', 900, 100, {}, {}, { h: 9 }]
  ]),
  mountains: seed => createPreset(seed, [
    ['ridged', 30, 30, { scale: 0.004, oct: 6 }],
    ['mul', 260, 30, {}, { b: 90 }, { a: 1 }],
    ['noise', 30, 130, { scale: 0.02, ox: 31, oz: -17, oct: 4 }],
    ['mul', 260, 130, {}, { b: 8 }, { a: 3 }],
    ['noise', 30, 230, { scale: 0.07, ox: -13, oz: 42, oct: 3 }],
    ['mul', 260, 230, {}, { b: 1.2 }, { a: 5 }],
    ['add', 480, 60, {}, {}, { a: 2, b: 4 }],
    ['add', 480, 160, {}, {}, { a: 7, b: 6 }],
    ['add', 690, 100, {}, { b: 4 }, { a: 8 }],
    ['out_height', 900, 100, {}, {}, { h: 9 }]
  ]),
  islands: seed => createPreset(seed, [
    ['noise', 30, 30, { scale: 0.0035, oct: 5 }],
    ['mul', 260, 30, {}, { b: 55 }, { a: 1 }],
    ['add', 470, 30, {}, { b: -8 }, { a: 2 }],
    ['noise', 30, 130, { scale: 0.03, ox: 7, oz: 3, oct: 4 }],
    ['mul', 260, 130, {}, { b: 3 }, { a: 4 }],
    ['add', 690, 80, {}, {}, { a: 3, b: 5 }],
    ['out_height', 900, 80, {}, {}, { h: 6 }]
  ]),
  plains: seed => createPreset(seed, [
    ['noise', 30, 30, { scale: 0.01, oct: 3 }],
    ['mul', 260, 30, {}, { b: 2 }, { a: 1 }],
    ['add', 470, 30, {}, { b: 3 }, { a: 2 }],
    ['out_height', 700, 30, {}, {}, { h: 3 }]
  ]),
  terraces: seed => createPreset(seed, [
    ['noise', 30, 30, { scale: 0.005, oct: 5 }],
    ['mul', 260, 30, {}, { b: 40 }, { a: 1 }],
    ['terrace', 470, 30, { step: 5, sharp: 0.85 }, {}, { a: 2 }],
    ['add', 690, 30, {}, { b: 6 }, { a: 3 }],
    ['out_height', 900, 30, {}, {}, { h: 4 }]
  ])
};

const createIslandsPreset = PRESET_GRAPHS.islands;
PRESET_GRAPHS.islands = seed => {
  const graph = createIslandsPreset(seed);
  const water = graph.nodes.find(node => node.type === 'out_water');
  if (water) water.d.level = -1;
  return graph;
};

export function defaultGraph(): LegacyGraph {
  return PRESET_GRAPHS.hills(0);
}
