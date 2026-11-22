precision highp float;
uniform vec2 uCamera;
uniform float uAltitude;
uniform float uStep;
uniform float uHalf;
in float aStep;
in float aHalf;
in float aCut;
out float vCut;
uniform float uWireLift;
out vec3 vWorld;
out vec3 vNormal;
out float vDistance;
#include <shadowmap_pars_vertex>
__TERRAIN_HEIGHT_FUNCTION__
float terrainHeightAtLOD(vec2 sampleP, float stepSize, float halfSize) {
  float distanceToCamera = max(max(abs(sampleP.x-uCamera.x), abs(sampleP.y-uCamera.y)), uAltitude);
  float morphEnd = halfSize - 2.0 * stepSize;
  float morphWidth = max(8.0 * stepSize, halfSize * 0.35);
  float morph = smoothstep(morphEnd - morphWidth, morphEnd, distanceToCamera);
  float fineHeight = terrainHeight(sampleP);
  vec2 odd = mod(floor(sampleP / stepSize + 0.5), 2.0);
  if (morph > 0.0 && odd.x + odd.y > 0.5) {
    float coarseHeight;
    if (odd.x > 0.5 && odd.y > 0.5) {
      coarseHeight = 0.5 * (terrainHeight(sampleP + vec2(stepSize, -stepSize)) + terrainHeight(sampleP + vec2(-stepSize, stepSize)));
    } else if (odd.x > 0.5) {
      coarseHeight = 0.5 * (terrainHeight(sampleP + vec2(stepSize, 0.0)) + terrainHeight(sampleP - vec2(stepSize, 0.0)));
    } else {
      coarseHeight = 0.5 * (terrainHeight(sampleP + vec2(0.0, stepSize)) + terrainHeight(sampleP - vec2(0.0, stepSize)));
    }
    fineHeight = mix(fineHeight, coarseHeight, morph);
  }
  return fineHeight;
}
void main() {
  vec4 world;
  #ifdef USE_INSTANCING
    world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  #else
    world = modelMatrix * vec4(position, 1.0);
  #endif
  vec2 p = world.xz;
  float stepSize = uStep;
  float halfSize = uHalf;
  float cutSize = 0.0;
  #ifdef USE_INSTANCING
    stepSize = aStep;
    halfSize = aHalf;
    cutSize = aCut;
  #endif
  vCut = cutSize;
  float d = max(max(abs(p.x-uCamera.x), abs(p.y-uCamera.y)), uAltitude);
  float h = terrainHeightAtLOD(p, stepSize, halfSize);
  float e = max(0.5 * stepSize, 0.05);
  float hx = terrainHeightAtLOD(p + vec2(e, 0.0), stepSize, halfSize);
  float hz = terrainHeightAtLOD(p + vec2(0.0, e), stepSize, halfSize);
  vNormal = normalize(vec3(-(hx-h)/e, 1.0, -(hz-h)/e));
  vWorld = vec3(p.x,h + uWireLift,p.y);
  vDistance = d;
  vec3 transformed = vWorld;
  #include <shadowmap_vertex>
  gl_Position = projectionMatrix*viewMatrix*vec4(vWorld,1.0);
}