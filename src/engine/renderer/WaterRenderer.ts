import * as THREE from 'three';

export interface WaterExclusionCircle {
  x: number;
  z: number;
  radius: number;
  feather?: number;
}

export interface WaterRendererOptions {
  seaLevel?: number;
  extent?: number;
  shallowColor?: string;
  deepColor?: string;
  opacity?: number;
  waveAmplitude?: number;
  waveScale?: number;
  waveSpeed?: number;
  foamStrength?: number;
}

const MAX_EXCLUSIONS = 16;

const vertexShader = [
  '#version 300 es',
  'precision highp float;',
  'uniform float uTime;',
  'uniform float uSeaLevel;',
  'uniform float uWaveAmplitude;',
  'uniform float uWaveScale;',
  'uniform float uWaveSpeed;',
  'out vec3 vWorld;',
  'out float vWave;',
  'void main() {',
  '  vec4 world = modelMatrix * vec4(position, 1.0);',
  '  vec2 p = world.xz * uWaveScale;',
  '  float waveA = sin(p.x * 0.73 + uTime * uWaveSpeed);',
  '  float waveB = cos(p.y * 0.61 - uTime * uWaveSpeed * 0.82);',
  '  float waveC = sin((p.x + p.y) * 0.37 + uTime * uWaveSpeed * 0.55);',
  '  float wave = (waveA * 0.48 + waveB * 0.34 + waveC * 0.18) * uWaveAmplitude;',
  '  world.y = uSeaLevel + wave;',
  '  vWorld = world.xyz;',
  '  vWave = wave;',
  '  gl_Position = projectionMatrix * viewMatrix * world;',
  '}'
].join('\n');

const fragmentShader = [
  '#version 300 es',
  'precision highp float;',
  'uniform float uTime;',
  'uniform vec3 uShallowColor;',
  'uniform vec3 uDeepColor;',
  'uniform float uOpacity;',
  'uniform float uWaveScale;',
  'uniform float uFoamStrength;',
  'uniform vec4 uExclusions[16];',
  'uniform int uExclusionCount;',
  'in vec3 vWorld;',
  'in float vWave;',
  'out vec4 waterColor;',
  'void main() {',
  '  float edgeFoam = 0.0;',
  '  for (int i = 0; i < 16; i++) {',
  '    if (i >= uExclusionCount) break;',
  '    vec4 hole = uExclusions[i];',
  '    float d = distance(vWorld.xz, hole.xy);',
  '    if (d < hole.z) discard;',
  '    float feather = max(hole.w, 0.001);',
  '    edgeFoam = max(edgeFoam, 1.0 - smoothstep(hole.z, hole.z + feather, d));',
  '  }',
  '  float ripple = 0.5 + 0.5 * sin((vWorld.x + vWorld.z) * uWaveScale * 2.1 + uTime * 1.7);',
  '  float crest = smoothstep(0.45, 0.95, ripple + vWave * 0.08);',
  '  vec3 color = mix(uDeepColor, uShallowColor, clamp(0.24 + ripple * 0.32 + crest * 0.18, 0.0, 1.0));',
  '  color = mix(color, vec3(0.78, 0.91, 0.9), clamp(edgeFoam * uFoamStrength, 0.0, 0.85));',
  '  waterColor = vec4(color, uOpacity);',
  '}'
].join('\n');

export class WaterRenderer {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly exclusionData = Array.from({ length: MAX_EXCLUSIONS }, () => new THREE.Vector4());
  private readonly cameraPosition = new THREE.Vector3();
  private readonly extent: number;
  private seaLevel: number;

  constructor(scene: THREE.Scene, options: WaterRendererOptions = {}) {
    this.seaLevel = options.seaLevel ?? -6;
    this.extent = options.extent ?? 8192;
    this.uniforms = {
      uTime: { value: 0 },
      uSeaLevel: { value: this.seaLevel },
      uWaveAmplitude: { value: options.waveAmplitude ?? 0.22 },
      uWaveScale: { value: options.waveScale ?? 0.035 },
      uWaveSpeed: { value: options.waveSpeed ?? 0.8 },
      uShallowColor: { value: new THREE.Color(options.shallowColor ?? '#087f86') },
      uDeepColor: { value: new THREE.Color(options.deepColor ?? '#041c35') },
      uOpacity: { value: options.opacity ?? 0.92 },
      uFoamStrength: { value: options.foamStrength ?? 0.75 },
      uExclusions: { value: this.exclusionData },
      uExclusionCount: { value: 0 }
    };
    const geometry = new THREE.PlaneGeometry(2, 2, 128, 128);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.scale.set(this.extent, 1, this.extent);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.position.y = this.seaLevel;
    scene.add(this.mesh);
  }

  setSeaLevel(level: number): void {
    this.seaLevel = level;
    this.uniforms.uSeaLevel.value = level;
    this.mesh.position.y = level;
  }

  setExclusionCircles(circles: WaterExclusionCircle[]): void {
    const count = Math.min(circles.length, MAX_EXCLUSIONS);
    for (let i = 0; i < MAX_EXCLUSIONS; i++) {
      const c = circles[i];
      this.exclusionData[i].set(c?.x ?? 0, c?.z ?? 0, Math.max(0, c?.radius ?? 0), Math.max(0.01, c?.feather ?? 2));
    }
    this.uniforms.uExclusionCount.value = count;
  }

  update(camera: THREE.Camera, elapsedSeconds: number): void {
    camera.getWorldPosition(this.cameraPosition);
    this.mesh.position.x = this.cameraPosition.x;
    this.mesh.position.z = this.cameraPosition.z;
    this.uniforms.uTime.value = elapsedSeconds;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
