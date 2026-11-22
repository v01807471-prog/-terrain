import * as THREE from 'three';
import { hashPixel, tfbm } from '../math/noise.js';

export const BUILTIN_TEXTURE_ASSETS = [
  { id: 'b_grass', name: 'Трава', description: 'Мелкая травяная фактура для равнин и склонов', category: 'Растительность' },
  { id: 'b_rock', name: 'Скала', description: 'Слоистая каменная поверхность', category: 'Камень' },
  { id: 'b_sand', name: 'Песок', description: 'Мягкий мелкозернистый песок', category: 'Грунт' },
  { id: 'b_dirt', name: 'Земля', description: 'Тёмная почва с естественными пятнами', category: 'Грунт' },
  { id: 'b_snow', name: 'Снег', description: 'Светлая снежная поверхность с микрорельефом', category: 'Снег и лёд' },
  { id: 'b_gravel', name: 'Гравий', description: 'Крупнозернистая каменная крошка', category: 'Камень' }
] as const;

export type BuiltinTextureAssetId = typeof BUILTIN_TEXTURE_ASSETS[number]['id'];

function fillTextureRows(id: string, size: number, data: Uint8Array, startY: number, endY: number): void {
  for (let y = startY; y < endY; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let rgb: number[];
      if (id === 'b_grass') {
        const t = .75 + tfbm(u, v, 8, 4, 3) * .5 + (tfbm(u, v, 64, 2, 9) - .5) * .35;
        rgb = [52 * t, 106 * t, 36 * t];
      } else if (id === 'b_rock') {
        const t = .55 + tfbm(u, v, 6, 5, 5) * .7 + (tfbm(u, v, 24, 3, 8) - .5) * .4;
        rgb = [112 * t, 106 * t, 98 * t];
      } else if (id === 'b_sand') {
        const t = .85 + tfbm(u, v, 10, 3, 2) * .25 + (hashPixel(x, y, 7) - .5) * .18;
        rgb = [214 * t, 190 * t, 140 * t];
      } else if (id === 'b_dirt') {
        const t = .6 + tfbm(u, v, 6, 5, 6) * .6 + (hashPixel(x, y, 3) - .5) * .2;
        rgb = [112 * t, 80 * t, 52 * t];
      } else if (id === 'b_snow') {
        const t = .9 + tfbm(u, v, 8, 3, 4) * .12 + (hashPixel(x, y, 11) - .5) * .06;
        rgb = [238 * t, 244 * t, 250 * t];
      } else {
        const t = .5 + tfbm(u, v, 48, 2, 1) * .6 + (tfbm(u, v, 12, 3, 13) - .5) * .3 + (hashPixel(x, y, 19) - .5) * .2;
        rgb = [130 * t, 126 * t, 120 * t];
      }
      const i = (y * size + x) * 4;
      data[i] = THREE.MathUtils.clamp(rgb[0], 0, 255);
      data[i + 1] = THREE.MathUtils.clamp(rgb[1], 0, 255);
      data[i + 2] = THREE.MathUtils.clamp(rgb[2], 0, 255);
      data[i + 3] = 255;
    }
  }
}

function makeTexture(data: Uint8Array, size: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createBuiltinTexture(id: string, size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  fillTextureRows(id, size, data, 0, size);
  return makeTexture(data, size);
}

/** Builds texture rows over separate tasks so adding a graph texture never stalls the first frame. */
export function createBuiltinTextureAsync(id: string, size = 128): Promise<THREE.DataTexture> {
  const data = new Uint8Array(size * size * 4);
  return new Promise((resolve) => {
    let y = 0;
    const renderChunk = () => {
      const endY = Math.min(size, y + 8);
      fillTextureRows(id, size, data, y, endY);
      y = endY;
      if (y < size) {
        setTimeout(renderChunk, 0);
      } else {
        resolve(makeTexture(data, size));
      }
    };
    renderChunk();
  });
}
