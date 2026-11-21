import type { TerrainBlueprint } from './types.js';

// This is the same integer hash and value-noise algorithm used by the legacy
// terrain engine (math/noise.ts + shaders/noise.glsl). Avoid sin-based hashes:
// JS double precision and GPU float32 produce visibly different terrain.
function hash2(x: number, z: number): number {
  let h = (Math.imul(x + 65536, 1597334673) ^ Math.imul(z + 65536, 3812015801)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822519) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 3266489917) >>> 0;
  h ^= h >>> 16;
  return (h >>> 8) / 8388607.5 - 1;
}

function noise2(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx0 = x - ix, fz0 = z - iz;
  const fx = fx0 * fx0 * (3 - 2 * fx0);
  const fz = fz0 * fz0 * (3 - 2 * fz0);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  const ab = a + (b - a) * fx;
  const cd = c + (d - c) * fx;
  return ab + (cd - ab) * fz;
}

function fbm(x: number, z: number, octaves: number): number {
  let sum = 0, amplitude = 0.5, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x, z) * amplitude;
    norm += amplitude;
    x *= 2.02;
    z *= 2.02;
    amplitude *= 0.5;
  }
  return sum / norm;
}

function terrainHeightCpu(x: number, z: number, seed: number): number {
  // Match the exact decimal constants embedded into the GLSL source.
  const sx = Math.round(seed * 19.17 * 10000) / 10000;
  const sz = Math.round(seed * 7.31 * 10000) / 10000;
  const warpX = fbm(x * 0.0024 + sx, z * 0.0024 + sz, 3) * 38;
  const warpZ = fbm(x * 0.0024 + 41 + sx, z * 0.0024 - 23 + sz, 3) * 38;
  const wx = x + warpX, wz = z + warpZ;
  const broad = fbm(wx * 0.009 + sx, wz * 0.009 + sz, 5);
  const medium = fbm(wx * 0.027 - 13 + sx, wz * 0.027 + 29 + sz, 4);
  const detail = fbm(wx * 0.085 + 57 + sx, wz * 0.085 - 71 + sz, 3);
  const ridgeSignal = fbm(wx * 0.014 + 91 + sx, wz * 0.014 + 37 + sz, 4);
  const ridges = 1 - 2 * Math.abs(ridgeSignal);
  const valleySignal = noise2(wx * 0.006 + 151 + sx, wz * 0.006 - 83 + sz) * 0.5 + 0.5;
  const valleys = Math.pow(Math.max(0, 1 - Math.abs(valleySignal - 0.5) * 5), 2);
  return 3 + broad * 19 + medium * 7 + detail * 1.8 + Math.max(0, ridges) * 5 - valleys * 8;
}

export function createDemoBlueprint(seed = 17): TerrainBlueprint {
  const seedOffsetX = (Math.round(seed * 19.17 * 10000) / 10000).toFixed(4);
  const seedOffsetZ = (Math.round(seed * 7.31 * 10000) / 10000).toFixed(4);
  const heightAt = (x: number, z: number): number => terrainHeightCpu(x, z, seed);
  const heightFunctionGLSL = `
    // Bit-exact hash structure shared with the legacy CPU noise implementation.
    float hash2(vec2 i) {
      uvec2 q = uvec2(i + 65536.0);
      uint h = (q.x * 1597334673u) ^ (q.y * 3812015801u);
      h = (h ^ (h >> 16)) * 2246822519u;
      h ^= h >> 13;
      h *= 3266489917u;
      h ^= h >> 16;
      return float(h >> 8) * (1.0 / 8388607.5) - 1.0;
    }
    float noise2(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash2(i);
      float b = hash2(i + vec2(1.0, 0.0));
      float c = hash2(i + vec2(0.0, 1.0));
      float d = hash2(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    float fbm(vec2 p, int octaves) {
      float sum = 0.0;
      float amplitude = 0.5;
      float norm = 0.0;
      for (int i = 0; i < 5; i++) {
        if (i >= octaves) break;
        sum += noise2(p) * amplitude;
        norm += amplitude;
        p *= 2.02;
        amplitude *= 0.5;
      }
      return sum / max(norm, 0.000001);
    }
    float terrainHeight(vec2 p) {
      vec2 seedOffset = vec2(${seedOffsetX}, ${seedOffsetZ});
      float warpX = fbm(p * 0.0024 + seedOffset, 3) * 38.0;
      float warpZ = fbm(p * 0.0024 + vec2(41.0, -23.0) + seedOffset, 3) * 38.0;
      vec2 q = p + vec2(warpX, warpZ);
      float broad = fbm(q * 0.009 + seedOffset, 5);
      float medium = fbm(q * 0.027 + vec2(-13.0, 29.0) + seedOffset, 4);
      float detail = fbm(q * 0.085 + vec2(57.0, -71.0) + seedOffset, 3);
      float ridgeSignal = fbm(q * 0.014 + vec2(91.0, 37.0) + seedOffset, 4);
      float ridges = 1.0 - 2.0 * abs(ridgeSignal);
      float valleySignal = noise2(q * 0.006 + vec2(151.0, -83.0) + seedOffset) * 0.5 + 0.5;
      float valleys = pow(max(0.0, 1.0 - abs(valleySignal - 0.5) * 5.0), 2.0);
      return 3.0 + broad * 19.0 + medium * 7.0 + detail * 1.8 + max(0.0, ridges) * 5.0 - valleys * 8.0;
    }
  `;
  return { heightAt, heightFunctionGLSL, terrainColor: '#668b55', fogColor: '#91aeb4', fogNear: 100, fogFar: 320 };
}
