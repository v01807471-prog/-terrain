precision highp float;
uniform vec2 uCamera;
uniform float uAltitude;
uniform float uCut;
varying vec3 vWorld;
void main() {
  float d=max(max(abs(vWorld.x-uCamera.x),abs(vWorld.z-uCamera.y)),uAltitude);
  if(d<uCut) discard;
  gl_FragColor=vec4(0.04,0.09,0.07,0.42);
}