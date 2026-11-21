precision highp float;
uniform vec2 uCamera;
uniform float uAltitude;
uniform float uCut;
uniform vec3 uWireColor;
varying vec3 vWorld;
void main() {
  float d=max(max(abs(vWorld.x-uCamera.x),abs(vWorld.z-uCamera.y)),uAltitude);
  if(d<uCut) discard;
  gl_FragColor=vec4(uWireColor,0.88);
}