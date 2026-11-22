precision highp float;
uniform vec2 uCamera;
uniform float uAltitude;
uniform float uCut;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uBaseColor;
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
void main() {
  if (!gl_FrontFacing) discard;
  vec2 delta = abs(vWorld.xz-uCamera);
  float d = max(max(delta.x,delta.y),uAltitude);
  if (d < uCut) discard;
  vec3 n = normalize(vNormal);
  // Variables exposed to the legacy Blueprint color-node compiler.
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
  vec3 lightDir = normalize(vec3(-0.45,0.78,0.42));
  float diffuse = max(dot(n,lightDir),0.0);
  float slope = 1.0-clamp(n.y,0.0,1.0);
  vec3 color = base*(0.55+diffuse*0.8)*(1.0-slope*0.24);
  float distanceToCamera = length(vWorld-vec3(uCamera.x,0.0,uCamera.y));
  color = mix(color,uFogColor,smoothstep(uFogNear,uFogFar,distanceToCamera));
  terrainFragColor = vec4(color,1.0);
}