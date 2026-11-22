import * as THREE from 'three';
import { DOME_RADIUS } from '../terrain/DomeProjection.js';

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
  fogColor?: string;
  fogNear?: number;
  fogFar?: number;
}

const MAX_EXCLUSIONS = 16;

const vertexShader = [
  'precision highp float;',
  'out vec3 vWorld;',
  'uniform float uDomeRadius;',
  'float waterDomeOffset(vec2 p) { float r2 = dot(p,p); return sqrt(max(0.0,uDomeRadius*uDomeRadius-r2))-uDomeRadius; }',
  'void main() {',
  '  vec4 world = modelMatrix * vec4(position, 1.0);',
  '  world.y += waterDomeOffset(world.xz);',
  '  vWorld = world.xyz;',
  '  gl_Position = projectionMatrix * viewMatrix * world;',
  '}'
].join(String.fromCharCode(10))

const fragmentShaderTemplate = `
precision highp float;
in vec3 vWorld;
out vec4 waterColor;
uniform float uTime;
uniform float uSeaLevel;
uniform vec3 uShallowColor;
uniform vec3 uDeepColor;
uniform float uOpacity;
uniform float uClarity;
uniform float uWaveAmplitude;
uniform float uWaveScale;
uniform float uWaveSpeed;
uniform float uGlint;
uniform float uFoamStrength;
uniform float uShoreWidth;
uniform float uFadeDistance;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform vec4 uExclusions[16];
uniform int uExclusionCount;

__TERRAIN_HEIGHT_FUNCTION__

float waterNoise(vec2 q, float t, float fade) {
  return noise2(q * 0.09 + vec2(t * 0.05, t * 0.03))
       + noise2(q * 0.31 - vec2(t * 0.09, t * 0.07)) * 0.45 * fade
       + noise2(q * 0.93 + vec2(t * 0.15, -t * 0.12)) * 0.2 * fade;
}

void main() {
  vec2 p = vWorld.xz;
  float ground = terrainHeight(p);
  float depth = vWorld.y - ground;

  // Ключевой принцип: шейдер не рисует воду над сушей.
  if (depth <= 0.0) discard;
  // Water is restricted to the same spherical cap as the terrain and fallback planet.
  if (dot(p, p) >= TERRAIN_DOME_RADIUS * TERRAIN_DOME_RADIUS) discard;
  float exclusionFoam = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= uExclusionCount) break;
    vec4 hole = uExclusions[i];
    float holeDistance = distance(p, hole.xy);
    if (holeDistance < hole.z) discard;
    exclusionFoam = max(exclusionFoam, 1.0 - smoothstep(hole.z, hole.z + max(hole.w, 0.01), holeDistance));
  }

  float distanceToCamera = length(vWorld - cameraPosition);
  float fade = 1.0 - smoothstep(uFadeDistance * 0.2, uFadeDistance, distanceToCamera);
  float t = uTime * uWaveSpeed;
  vec2 wavePoint = p * uWaveScale;
  float e = 0.08;
  float h0 = waterNoise(wavePoint, t, fade);
  vec2 gradient = vec2(
    waterNoise(wavePoint + vec2(e, 0.0), t, fade) - h0,
    waterNoise(wavePoint + vec2(0.0, e), t, fade) - h0
  ) / e * uWaveAmplitude * 0.6;
  vec3 normal = normalize(vec3(-gradient.x, 1.0, -gradient.y));
  vec3 viewDirection = normalize(cameraPosition - vWorld);
  float shore = smoothstep(0.0, max(0.01, uShoreWidth * 0.5), depth);

  if (cameraPosition.y < uSeaLevel + domeHeightOffset(cameraPosition.xz)) {
    vec3 underwater = pow(mix(uShallowColor, uDeepColor, 0.35), vec3(1.0 / 2.2));
    underwater *= 0.6 + 0.4 * smoothstep(-0.3, 0.4, normal.y);
    // Keep underwater color clear while inspecting terrain coverage.
    waterColor = vec4(underwater, 0.6 * shore * uOpacity);
    return;
  }

  float fresnel = 0.04 + 0.96 * pow(1.0 - clamp(dot(normal, viewDirection), 0.0, 1.0), 4.0);
  float depthTint = 1.0 - exp(-max(depth, 0.0) * uClarity);
  vec3 water = mix(uShallowColor, uDeepColor, depthTint);
  vec3 sun = normalize(uSunDirection);
  vec3 lit = water * (uAmbient * 0.6 + uSunColor * (0.3 + 0.7 * max(dot(normal, sun), 0.0)));
  vec3 sky = pow(max(uFogColor, vec3(0.0)), vec3(2.2));
  vec3 color = mix(lit, sky, fresnel);
  float specular = pow(max(dot(reflect(-sun, normal), viewDirection), 0.0), mix(30.0, 160.0, fade));
  color += uSunColor * specular * 1.4 * uGlint * mix(0.35, 1.0, fade);
  float foam = (1.0 - smoothstep(0.0, max(0.01, uShoreWidth), depth))
    * (0.6 + 0.4 * noise2(p * 1.7 + vec2(t * 0.3, 0.0))) * mix(0.5, 1.0, fade);
  foam = max(foam, exclusionFoam * fade);
  color = mix(color, vec3(0.9), clamp(foam, 0.0, 1.0) * uFoamStrength);
  float alpha = clamp(max(mix(0.3, 0.96, depthTint), fresnel * 0.8) * shore * uOpacity, 0.0, 1.0);
  color = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
  // Distance fog disabled: do not hide distant terrain or water boundaries.
  waterColor = vec4(color, alpha);
}
`;

export class WaterRenderer {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly uniforms: Record<string, { value: any }>;
  private readonly exclusionData = Array.from({ length: MAX_EXCLUSIONS }, () => new THREE.Vector4());
  private readonly cameraPosition = new THREE.Vector3();
  private readonly extent: number;
  private seaLevel: number;
  private baseFadeDistance = 220;
  private baseFogNear = 420;
  private baseFogFar = 1800;
  private heightFunctionGLSL = '';
  private material!: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, options: WaterRendererOptions = {}) {
    this.seaLevel = options.seaLevel ?? -6;
    this.baseFadeDistance = 220;
    this.baseFogNear = options.fogNear ?? 420;
    this.baseFogFar = options.fogFar ?? 1800;
    this.extent = options.extent ?? 8192;
    this.uniforms = {
      uTime: { value: 0 },
      uDomeRadius: { value: DOME_RADIUS },
      uSeaLevel: { value: this.seaLevel },
      uWaveAmplitude: { value: options.waveAmplitude ?? 0.22 },
      uWaveScale: { value: options.waveScale ?? 0.035 },
      uClarity: { value: 0.35 },
      uWaveSpeed: { value: options.waveSpeed ?? 0.8 },
      uShallowColor: { value: new THREE.Color(options.shallowColor ?? '#087f86') },
      uDeepColor: { value: new THREE.Color(options.deepColor ?? '#041c35') },
      uOpacity: { value: options.opacity ?? 0.92 },
      uFoamStrength: { value: options.foamStrength ?? 0.75 },
      uGlint: { value: 1 },
      uShoreWidth: { value: 0.6 },
      uFadeDistance: { value: 220 },
      uSunDirection: { value: new THREE.Vector3(-0.45, 0.78, 0.42).normalize() },
      uSunColor: { value: new THREE.Color('#fff0d5') },
      uAmbient: { value: new THREE.Color('#9bb5a0') },
      uFogColor: { value: new THREE.Color(options.fogColor ?? '#91aeb4') },
      uFogNear: { value: options.fogNear ?? 420 },
      uFogFar: { value: options.fogFar ?? 1800 },
      uExclusions: { value: this.exclusionData },
      uExclusionCount: { value: 0 }
    };
    const geometry = new THREE.PlaneGeometry(2, 2, 128, 128);
    geometry.rotateX(-Math.PI / 2);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader: fragmentShaderTemplate.replace('__TERRAIN_HEIGHT_FUNCTION__', this.heightFunctionGLSL || 'float terrainHeight(vec2 p) { return 0.0; }'),
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.scale.set(this.extent, 1, this.extent);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.position.y = this.seaLevel;
    scene.add(this.mesh);
  }

  applyBlueprint(settings: unknown, heightFunctionGLSL?: string, fog?: { color?: string; near?: number; far?: number } | null): void {
    if (!settings || typeof settings !== 'object') {
      this.mesh.visible = false;
      return;
    }
    const water = settings as {
      on?: number; level?: number; clarity?: number; wave?: number; wscale?: number;
      wspeed?: number; foam?: number; opacity?: number; shallow?: number[]; deep?: number[];
    };
    this.mesh.visible = water.on !== 0;
    if (heightFunctionGLSL && heightFunctionGLSL !== this.heightFunctionGLSL) {
      this.heightFunctionGLSL = heightFunctionGLSL;
      this.material.fragmentShader = fragmentShaderTemplate.replace('__TERRAIN_HEIGHT_FUNCTION__', heightFunctionGLSL);
      this.material.needsUpdate = true;
    }
    if (fog?.color) (this.uniforms.uFogColor.value as THREE.Color).set(fog.color);
    if (Number.isFinite(fog?.near)) this.baseFogNear = fog!.near!;
    if (Number.isFinite(fog?.far)) this.baseFogFar = fog!.far!;
    if (Number.isFinite(water.level)) this.setSeaLevel(Number(water.level));
    this.uniforms.uClarity.value = THREE.MathUtils.clamp(water.clarity ?? 0.35, 0, 1);
    this.uniforms.uWaveAmplitude.value = Math.max(0, water.wave ?? 1);
    this.uniforms.uWaveScale.value = Math.max(0.05, water.wscale ?? 1);
    this.uniforms.uWaveSpeed.value = Math.max(0, water.wspeed ?? 1);
    this.uniforms.uFoamStrength.value = THREE.MathUtils.clamp(water.foam ?? 0.75, 0, 2);
    this.uniforms.uGlint.value = THREE.MathUtils.clamp((water as any).glint ?? 1, 0, 3);
    this.uniforms.uShoreWidth.value = Math.max(0.15, (water as any).shore ?? 0.6);
    this.baseFadeDistance = Math.max(20, (water as any).fade ?? 220);
    this.uniforms.uOpacity.value = THREE.MathUtils.clamp(water.opacity ?? 0.92, 0, 1);
    if (water.shallow?.length === 3) {
      (this.uniforms.uShallowColor.value as THREE.Color).setRGB(water.shallow[0], water.shallow[1], water.shallow[2], THREE.LinearSRGBColorSpace);
    }
    if (water.deep?.length === 3) {
      (this.uniforms.uDeepColor.value as THREE.Color).setRGB(water.deep[0], water.deep[1], water.deep[2], THREE.LinearSRGBColorSpace);
    }
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

  update(camera: THREE.Camera, elapsedSeconds: number, horizonScale = 1, fogScale = horizonScale): void {
    camera.getWorldPosition(this.cameraPosition);
    this.mesh.position.x = this.cameraPosition.x;
    this.mesh.position.z = this.cameraPosition.z;
    this.mesh.scale.set(this.extent * horizonScale, 1, this.extent * horizonScale);
    this.uniforms.uFadeDistance.value = Math.max(this.baseFadeDistance * horizonScale, this.extent * horizonScale * 0.95);
    this.uniforms.uFogNear.value = this.baseFogNear * fogScale;
    this.uniforms.uFogFar.value = this.baseFogFar * fogScale;
    this.uniforms.uTime.value = elapsedSeconds;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
