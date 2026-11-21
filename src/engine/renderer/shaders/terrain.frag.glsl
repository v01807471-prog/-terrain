precision highp float;
uniform vec2 uCamera;
uniform float uAltitude;
uniform float uCut;
uniform float uOuter;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uBaseColor;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vDistance;
void main() {
  if (!gl_FrontFacing) discard;
  vec2 delta = abs(vWorld.xz-uCamera);
  float d = max(max(delta.x,delta.y),uAltitude);
  if (d < uCut || d >= uOuter) discard;
  vec3 n = normalize(vNormal);
  vec3 lightDir = normalize(vec3(-0.45,0.78,0.42));
  float diffuse = max(dot(n,lightDir),0.0);
  float slope = 1.0-clamp(n.y,0.0,1.0);
  vec3 color = uBaseColor*(0.55+diffuse*0.8)*(1.0-slope*0.24);
  float distanceToCamera = length(vWorld-vec3(uCamera.x,0.0,uCamera.y));
  color = mix(color,uFogColor,smoothstep(uFogNear,uFogFar,distanceToCamera));
  gl_FragColor = vec4(color,1.0);
}