import type { TerrainBlueprint } from './types.js';
import { noise2, fbmXZ } from '../math/noise.js';
import { NOISE_GLSL } from '../shaders/noise.glsl.js';

function terrainHeightCpu(x: number, z: number, seed: number): number {
  // Match the exact decimal constants embedded into the GLSL source.
  const sx = Math.round(seed * 19.17 * 10000) / 10000;
  const sz = Math.round(seed * 7.31 * 10000) / 10000;
  const warpX = fbmXZ(x * 0.0024 + sx, z * 0.0024 + sz, 3) * 38;
  const warpZ = fbmXZ(x * 0.0024 + 41 + sx, z * 0.0024 - 23 + sz, 3) * 38;
  const wx = x + warpX, wz = z + warpZ;
  const broad = fbmXZ(wx * 0.009 + sx, wz * 0.009 + sz, 5);
  const medium = fbmXZ(wx * 0.027 - 13 + sx, wz * 0.027 + 29 + sz, 4);
  const detail = fbmXZ(wx * 0.085 + 57 + sx, wz * 0.085 - 71 + sz, 3);
  const ridgeSignal = fbmXZ(wx * 0.014 + 91 + sx, wz * 0.014 + 37 + sz, 4);
  const ridges = 1 - 2 * Math.abs(ridgeSignal);
  const valleySignal = noise2(wx * 0.006 + 151 + sx, wz * 0.006 - 83 + sz) * 0.5 + 0.5;
  const valleys = Math.pow(Math.max(0, 1 - Math.abs(valleySignal - 0.5) * 5), 2);
  return 3 + broad * 19 + medium * 7 + detail * 1.8 + Math.max(0, ridges) * 5 - valleys * 8;
}

export function createDemoBlueprint(seed = 17): TerrainBlueprint {
  const seedOffsetX = (Math.round(seed * 19.17 * 10000) / 10000).toFixed(4);
  const seedOffsetZ = (Math.round(seed * 7.31 * 10000) / 10000).toFixed(4);
  const heightAt = (x: number, z: number): number => terrainHeightCpu(x, z, seed);

  // Reuse the legacy shader noise source instead of maintaining a second hash.
  // CPU and GPU therefore share the same integer hash, interpolation and fBm.
  const heightFunctionGLSL = `
    ${NOISE_GLSL}
    float terrainHeight(vec2 p) {
      vec2 seedOffset = vec2(${seedOffsetX}, ${seedOffsetZ});
      float warpX = fbmXZ(p.x * 0.0024 + seedOffset.x, p.y * 0.0024 + seedOffset.y, 3) * 38.0;
      float warpZ = fbmXZ(p.x * 0.0024 + 41.0 + seedOffset.x, p.y * 0.0024 - 23.0 + seedOffset.y, 3) * 38.0;
      vec2 q = p + vec2(warpX, warpZ);
      float broad = fbmXZ(q.x * 0.009 + seedOffset.x, q.y * 0.009 + seedOffset.y, 5);
      float medium = fbmXZ(q.x * 0.027 - 13.0 + seedOffset.x, q.y * 0.027 + 29.0 + seedOffset.y, 4);
      float detail = fbmXZ(q.x * 0.085 + 57.0 + seedOffset.x, q.y * 0.085 - 71.0 + seedOffset.y, 3);
      float ridgeSignal = fbmXZ(q.x * 0.014 + 91.0 + seedOffset.x, q.y * 0.014 + 37.0 + seedOffset.y, 4);
      float ridges = 1.0 - 2.0 * abs(ridgeSignal);
      float valleySignal = noise2(vec2(q.x * 0.006 + 151.0 + seedOffset.x, q.y * 0.006 - 83.0 + seedOffset.y)) * 0.5 + 0.5;
      float valleys = pow(max(0.0, 1.0 - abs(valleySignal - 0.5) * 5.0), 2.0);
      return 3.0 + broad * 19.0 + medium * 7.0 + detail * 1.8 + max(0.0, ridges) * 5.0 - valleys * 8.0;
    }
  `;
  return { heightAt, heightFunctionGLSL, terrainColor: '#668b55', fogColor: '#91aeb4', fogNear: 100, fogFar: 320 };
}
