import { compileGraph } from '../graph/compiler.js';
import noiseShader from '../shaders/noise.glsl?raw';
import type { TerrainBlueprint } from './types.js';

export interface TerrainGraph {
  seed: number;
  nodes: Array<{
    id: number; type: string; x?: number; y?: number;
    p?: Record<string, any>; d?: Record<string, any>; in?: Record<string, number>;
  }>;
}

/** Графы-пресеты используют одну и ту же систему узлов, CPU и GLSL. */
export type TerrainPreset = 'regions' | 'plains' | 'mountains' | 'desert' | 'islands';

export function createTerrainPresetGraph(preset: TerrainPreset = 'regions', seed = 17): TerrainGraph {
  const regionNode = preset === 'plains'
    ? { id: 1, type: 'num', p: { v: 0 } }
    : preset === 'mountains'
      ? { id: 1, type: 'num', p: { v: 1 } }
      : { id: 1, type: 'noise', p: { scale: 0.00135, oct: 3, ns: 11 } };
  const nodes: TerrainGraph['nodes'] = [
    regionNode,
    { id: 2, type: 'smooth', p: { e0: -0.22, e1: 0.28 }, in: { a: 1 } },
    { id: 3, type: 'noise', p: { scale: 0.008, oct: 4, ns: 2 } },
    { id: 4, type: 'mul', d: { b: preset === 'desert' ? 2.2 : 4.5 }, in: { a: 3 } },
    { id: 5, type: 'ridged', p: { scale: preset === 'islands' ? 0.0028 : 0.0038, oct: 5, ns: 7 } },
    { id: 6, type: 'mul', d: { b: preset === 'islands' ? 30 : 52 }, in: { a: 5 } },
    { id: 7, type: 'noise', p: { scale: 0.016, oct: 4, ns: 23 } },
    { id: 8, type: 'mul', d: { b: 8 }, in: { a: 7 } },
    { id: 9, type: 'add', in: { a: 6, b: 8 } },
    { id: 10, type: 'mixf', in: { a: 4, b: 9, t: 2 } },
    { id: 11, type: 'add', d: { b: preset === 'islands' ? -5 : 3 }, in: { a: 10 } },
    { id: 12, type: 'out_height', in: { h: 11 } },

    { id: 20, type: 'grass' },
    { id: 21, type: 'rock' },
    { id: 22, type: 'slope' },
    { id: 23, type: 'smooth', p: { e0: 0.38, e1: 0.7 }, in: { a: 22 } },
    { id: 24, type: 'cmix', in: { a: 20, b: 21, t: 23 } },
    { id: 25, type: 'color', p: { col: preset === 'desert' ? '#c7a66b' : preset === 'islands' ? '#78a58a' : '#76726c' } },
    { id: 26, type: 'height' },
    { id: 27, type: 'smooth', p: { e0: 24, e1: 42 }, in: { a: 26 } },
    { id: 28, type: 'cmix', in: { a: 24, b: 25, t: 27 } },
    { id: 29, type: 'out_color', in: { c: 28 } },
    { id: 30, type: 'out_water', d: { level: preset === 'islands' ? 1 : 8 } },
    { id: 31, type: 'out_fog', p: { on: 1, color: preset === 'desert' ? '#e6c89a' : '#9dc7e1' } }
  ];
  return { seed, nodes };
}

export function createDefaultTerrainGraph(seed = 17): TerrainGraph {
  return createTerrainPresetGraph('regions', seed);
}

export function compileTerrainGraph(graph: TerrainGraph): TerrainBlueprint {
  const compiled = compileGraph(graph);
  const fogColor = compiled.fog?.color ?? '#91aeb4';
  const fogNear = compiled.fog?.near > 0 ? compiled.fog.near : 100;
  const fogFar = compiled.fog?.far > fogNear ? compiled.fog.far : 320;
  const heightFunctionGLSL = `
    ${noiseShader}
    float terrainHeight(vec2 p) {
      vec2 pw = p;
      ${compiled.glHeight}
    }
  `;
  return {
    heightAt: compiled.js,
    heightFunctionGLSL,
    fragmentGraphGLSL: compiled.glColor.replaceAll('texture2D(', 'texture('),
    textureAssets: compiled.assets,
    terrainColor: '#668b55',
    fogColor,
    fogNear,
    fogFar,
    water: compiled.water,
    fog: compiled.fog
  };
}
