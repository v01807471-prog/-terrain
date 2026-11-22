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
  float morphEnd = halfSize - 2.0*stepSize;
  float morphWidth = max(8.0*stepSize, halfSize*0.35);
  float morph = smoothstep(morphEnd-morphWidth, morphEnd, d);
  float h0 = terrainHeight(p);
  float h = h0;
  vec2 odd = mod(floor(p/stepSize + 0.5), 2.0);
  if (morph > 0.0 && odd.x + odd.y > 0.5) {
    float coarse;
    if (odd.x > 0.5 && odd.y > 0.5) {
      coarse = 0.5*(terrainHeight(p+vec2(stepSize,-stepSize))+terrainHeight(p+vec2(-stepSize,stepSize)));
    } else if (odd.x > 0.5) {
      coarse = 0.5*(terrainHeight(p+vec2(stepSize,0.0))+terrainHeight(p-vec2(stepSize,0.0)));
    } else {
      coarse = 0.5*(terrainHeight(p+vec2(0.0,uStep))+terrainHeight(p-vec2(0.0,uStep)));
    }
    h = mix(h0, coarse, morph);
  }
  float e = 0.5*stepSize*(1.0+morph);
  float hx = terrainHeight(p+vec2(e,0.0));
  float hz = terrainHeight(p+vec2(0.0,e));
  vNormal = normalize(vec3(-(hx-h0)/e, 1.0, -(hz-h0)/e));
  vWorld = vec3(p.x,h + uWireLift,p.y);
  vDistance = d;
  vec4 worldPosition = vec4(vWorld, 1.0);
  #include <shadowmap_vertex>
  gl_Position = projectionMatrix*viewMatrix*vec4(vWorld,1.0);
}