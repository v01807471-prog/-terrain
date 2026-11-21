import type { TerrainBlueprint } from './types.js';

function hash2(x: number, z: number): number {
  const v = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return v - Math.floor(v);
}
function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx0 = x - ix, fz0 = z - iz;
  const fx = fx0 * fx0 * (3 - 2 * fx0), fz = fz0 * fz0 * (3 - 2 * fz0);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  const ab = a + (b - a) * fx, cd = c + (d - c) * fx;
  return ab + (cd - ab) * fz;
}
function fbm(x: number, z: number, octaves: number): number {
  let sum = 0, amplitude = 0.5, norm = 0, frequency = 1;
  for (let i = 0; i < octaves; i++) {
    sum += (valueNoise(x * frequency, z * frequency) * 2 - 1) * amplitude;
    norm += amplitude; frequency *= 2.03; amplitude *= 0.5;
  }
  return sum / norm;
}
function terrainHeightCpu(x: number, z: number, seed: number): number {
  const sx = seed * 19.17, sz = seed * 7.31;
  const warpX = fbm(x * 0.0024 + sx, z * 0.0024 + sz, 3) * 38;
  const warpZ = fbm(x * 0.0024 + 41 + sx, z * 0.0024 - 23 + sz, 3) * 38;
  const wx = x + warpX, wz = z + warpZ;
  const broad = fbm(wx * 0.009 + sx, wz * 0.009 + sz, 5);
  const medium = fbm(wx * 0.027 - 13 + sx, wz * 0.027 + 29 + sz, 4);
  const detail = fbm(wx * 0.085 + 57 + sx, wz * 0.085 - 71 + sz, 3);
  const ridgeSignal = fbm(wx * 0.014 + 91 + sx, wz * 0.014 + 37 + sz, 4);
  const ridges = 1 - 2 * Math.abs(ridgeSignal);
  const valleySignal = valueNoise(wx * 0.006 + 151 + sx, wz * 0.006 - 83 + sz);
  const valleys = Math.pow(Math.max(0, 1 - Math.abs(valleySignal - 0.5) * 5), 2);
  return 3 + broad * 19 + medium * 7 + detail * 1.8 + Math.max(0, ridges) * 5 - valleys * 8;
}
export function createDemoBlueprint(seed = 17): TerrainBlueprint {
  const seedOffsetX = (seed * 19.17).toFixed(4);
  const seedOffsetZ = (seed * 7.31).toFixed(4);
  const heightAt = (x: number, z: number): number => terrainHeightCpu(x, z, seed);
  const heightFunctionGLSL = `
    float hashNoise(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float valueNoise(vec2 p) {
      vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
      float a = hashNoise(i), b = hashNoise(i + vec2(1.0, 0.0));
      float c = hashNoise(i + vec2(0.0, 1.0)), d = hashNoise(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    float fbm(vec2 p, int octaves) {
      float sum = 0.0, amplitude = 0.5, norm = 0.0, frequency = 1.0;
      for (int i = 0; i < 5; i++) { if (i >= octaves) break; sum += (valueNoise(p * frequency) * 2.0 - 1.0) * amplitude; norm += amplitude; frequency *= 2.03; amplitude *= 0.5; }
      return sum / max(norm, 0.0001);
    }
    float terrainHeight(vec2 p) {
      vec2 seedOffset = vec2(" + seedOffsetX + ", " + seedOffsetZ + ");
      float warpX = fbm(p * 0.0024 + seedOffset, 3) * 38.0;
      float warpZ = fbm(p * 0.0024 + vec2(41.0, -23.0) + seedOffset, 3) * 38.0;
      vec2 q = p + vec2(warpX, warpZ);
      float broad = fbm(q * 0.009 + seedOffset, 5);
      float medium = fbm(q * 0.027 + vec2(-13.0, 29.0) + seedOffset, 4);
      float detail = fbm(q * 0.085 + vec2(57.0, -71.0) + seedOffset, 3);
      float ridgeSignal = fbm(q * 0.014 + vec2(91.0, 37.0) + seedOffset, 4);
      float ridges = 1.0 - 2.0 * abs(ridgeSignal);
      float valleySignal = valueNoise(q * 0.006 + vec2(151.0, -83.0) + seedOffset);
      float valleys = pow(max(0.0, 1.0 - abs(valleySignal - 0.5) * 5.0), 2.0);
      return 3.0 + broad * 19.0 + medium * 7.0 + detail * 1.8 + max(0.0, ridges) * 5.0 - valleys * 8.0;
    }
  `;
  return { heightAt, heightFunctionGLSL, terrainColor: '#668b55', fogColor: '#91aeb4', fogNear: 100, fogFar: 320 };
}