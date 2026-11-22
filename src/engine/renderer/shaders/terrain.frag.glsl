precision highp float;
uniform vec2 uCamera;
uniform float uAltitude;
uniform float uCut;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uBaseColor;
uniform vec3 uSunDirection;
uniform float uSunIntensity;
uniform sampler2D uAsset0;
uniform sampler2D uAsset1;
uniform sampler2D uAsset2;
uniform sampler2D uAsset3;
uniform sampler2D uAsset4;
uniform sampler2D uAsset5;
uniform sampler2D uAsset6;
uniform sampler2D uAsset7;
in vec3 vWorld;
in vec3 vNormal;
in float vDistance;
out vec4 terrainFragColor;
__TERRAIN_HEIGHT_FUNCTION__
void main() {
  if (!gl_FrontFacing) discard;
  vec2 delta = abs(vWorld.xz-uCamera);
  float d = max(max(delta.x,delta.y),uAltitude);
  if (d < uCut) discard;
  vec3 n = normalize(vNormal);
  vec2 pw = vWorld.xz;
  float vHeight = vWorld.y;
  float slopeV = 1.0 - clamp(n.y, 0.0, 1.0);
  vec3 vWorldPosition = vWorld;
  vec3 tw = pow(abs(n), vec3(4.0));
  tw /= max(dot(tw, vec3(1.0)), 0.00001);
  float dist = vDistance;
  vec3 grassColor = vec3(0.18, 0.34, 0.12);
  vec3 rockColor = vec3(0.34, 0.32, 0.29);
  __TERRAIN_COLOR_GRAPH__
  float diffuse = max(dot(n,normalize(uSunDirection)),0.0);
  float shadow = 1.0;
  if (uSunDirection.y > 0.04) {
    for (int i = 1; i <= 5; i++) {
      float rayDistance = float(i) * 3.5;
      vec2 sampleXZ = vWorld.xz + uSunDirection.xz * rayDistance;
      float rayHeight = vWorld.y + uSunDirection.y * rayDistance;
      if (terrainHeight(sampleXZ) > rayHeight + 0.55) { shadow = 0.52; break; }
    }
  }
  float daylight = 0.24 + uSunIntensity * 0.25;
  vec3 color = base*(daylight+diffuse*uSunIntensity*0.72*shadow)*(1.0-slopeV*0.2);
  float distanceToCamera = length(vWorld-vec3(uCamera.x,0.0,uCamera.y));
  color = mix(color,uFogColor,smoothstep(uFogNear,uFogFar,distanceToCamera));
  terrainFragColor = vec4(color,1.0);
}