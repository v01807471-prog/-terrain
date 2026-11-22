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

/** V1-compatible hills graph, including its color blend graph and environment outputs. */
export function createDefaultTerrainGraph(seed = 17): TerrainGraph {
  const nodes: TerrainGraph['nodes'] = [
    { id: 1, type: 'noise', p: { scale: 0.0048, oct: 4 } },
    { id: 2, type: 'mul', d: { b: 42 }, in: { a: 1 } },
    { id: 3, type: 'noise', p: { scale: 0.018, ox: 31, oz: -17, oct: 4 } },
    { id: 4, type: 'mul', d: { b: 12 }, in: { a: 3 } },
    { id: 5, type: 'noise', p: { scale: 0.065, ox: -13, oz: 42, oct: 4 } },
    { id: 6, type: 'mul', d: { b: 1.8 }, in: { a: 5 } },
    { id: 7, type: 'add', in: { a: 2, b: 4 } },
    { id: 8, type: 'add', in: { a: 7, b: 6 } },
    { id: 9, type: 'add', d: { b: 6 }, in: { a: 8 } },
    { id: 10, type: 'out_height', in: { h: 9 } },

    // The original V1 color graph: slope mask blends grass and rock.
    { id: 11, type: 'grass' },
    { id: 12, type: 'rock' },
    { id: 13, type: 'slope' },
    { id: 14, type: 'smooth', p: { e0: 0.42, e1: 0.68 }, in: { a: 13 } },
    { id: 15, type: 'cmix', in: { a: 11, b: 12, t: 14 } },
    { id: 16, type: 'height' },
    { id: 17, type: 'smooth', p: { e0: 30, e1: 48 }, in: { a: 16 } },
    { id: 18, type: 'mul', d: { b: 0.8 }, in: { a: 17 } },
    { id: 19, type: 'color', p: { col: '#76726c' } },
    { id: 20, type: 'cmix', in: { a: 15, b: 19, t: 18 } },
    { id: 21, type: 'out_color', in: { c: 20 } },
    { id: 22, type: 'out_water', p: {}, d: {}, in: {} },
    { id: 23, type: 'out_fog', p: { on: 1, color: '#9dc7e1' }, d: {}, in: {} }
  ];
  return { seed, nodes };
}

/**
 * Compiles the same editable node graph used by V1 into a CPU height evaluator
 * and a GLSL height/color program consumed by V2.
 */
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
