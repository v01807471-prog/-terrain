import * as THREE from 'three';
import vertexShader from '../shaders/terrain.vert.glsl?raw';
import fragmentShader from '../shaders/terrain.frag.glsl?raw';

export class TerrainMaterial {
  create(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {},
      side: THREE.DoubleSide
    });
  }
}
