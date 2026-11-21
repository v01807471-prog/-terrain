precision highp float;
uniform vec2 uCamera;
uniform float uAltitude;
uniform float uStep;
uniform float uHalf;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vDistance;
__TERRAIN_HEIGHT_FUNCTION__
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec2 p = world.xz;
  float d = max(max(abs(p.x-uCamera.x), abs(p.y-uCamera.y)), uAltitude);
  float morphEnd = uHalf - 2.0*uStep;
  float morph = smoothstep(morphEnd-uHalf*0.25, morphEnd, d);
  float h0 = terrainHeight(p);
  float h = h0;
  vec2 odd = mod(floor(p/uStep + 0.5), 2.0);
  if (morph > 0.0 && odd.x + odd.y > 0.5) {
    float coarse;
    if (odd.x > 0.5 && odd.y > 0.5) {
      coarse = 0.5*(terrainHeight(p+vec2(uStep,-uStep))+terrainHeight(p+vec2(-uStep,uStep)));
    } else if (odd.x > 0.5) {
      coarse = 0.5*(terrainHeight(p+vec2(uStep,0.0))+terrainHeight(p-vec2(uStep,0.0)));
    } else {
      coarse = 0.5*(terrainHeight(p+vec2(0.0,uStep))+terrainHeight(p-vec2(0.0,uStep)));
    }
    h = mix(h0, coarse, morph);
  }
  float e = 0.5*uStep*(1.0+morph);
  float hx = terrainHeight(p+vec2(e,0.0));
  float hz = terrainHeight(p+vec2(0.0,e));
  vNormal = normalize(vec3(-(hx-h0)/e, 1.0, -(hz-h0)/e));
  vWorld = vec3(p.x,h,p.y);
  vDistance = d;
  gl_Position = projectionMatrix*viewMatrix*vec4(vWorld,1.0);
}