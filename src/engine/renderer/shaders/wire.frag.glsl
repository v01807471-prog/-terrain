precision highp float;
uniform vec2 uCamera;
uniform float uAltitude;
uniform float uCut;
uniform vec3 uWireColor;
in vec3 vWorld;
out vec4 wireFragColor;
void main() {
  float d=max(max(abs(vWorld.x-uCamera.x),abs(vWorld.z-uCamera.y)),uAltitude);
  if(d<uCut) discard;
  wireFragColor=vec4(uWireColor,0.88);
}