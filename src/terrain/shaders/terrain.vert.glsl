varying vec3 vNormal;
varying float vHeight;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vHeight = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
