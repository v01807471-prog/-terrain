import type { TerrainBlueprint } from './types.js';

/**
 * Shared world description for the V2 demo.
 * Keep the CPU height function and its GLSL counterpart mathematically aligned.
 */
export function createDemoBlueprint(): TerrainBlueprint {
  const heightAt = (x: number, z: number): number =>
    2.5 - x * 0.19 +
    Math.sin(z * 0.075) * 1.15 +
    Math.sin(x * 0.055 + z * 0.035) * 0.9 +
    Math.sin(z * 0.19 + x * 0.025) * 0.22;

  return {
    heightAt,
    heightFunctionGLSL: `
      float terrainHeight(vec2 p) {
        return 2.5 - p.x * 0.19
          + sin(p.y * 0.075) * 1.15
          + sin(p.x * 0.055 + p.y * 0.035) * 0.9
          + sin(p.y * 0.19 + p.x * 0.025) * 0.22;
      }
    `,
    terrainColor: '#557b50',
    fogColor: '#91aeb4',
    fogNear: 65,
    fogFar: 180
  };
}
