varying vec3 vNormal;
varying float vHeight;

void main() {
  vec3 low = vec3(0.12, 0.25, 0.20);
  vec3 grass = vec3(0.34, 0.48, 0.29);
  vec3 rock = vec3(0.48, 0.45, 0.39);
  vec3 snow = vec3(0.82, 0.86, 0.88);

  float vegetation = smoothstep(-28.0, 18.0, vHeight);
  float stone = smoothstep(22.0, 48.0, vHeight);
  float peak = smoothstep(62.0, 88.0, vHeight);
  vec3 color = mix(low, grass, vegetation);
  color = mix(color, rock, stone);
  color = mix(color, snow, peak);

  vec3 lightDirection = normalize(vec3(-0.45, 0.82, 0.36));
  float diffuse = max(dot(normalize(vNormal), lightDirection), 0.0);
  float lighting = 0.42 + diffuse * 0.72;
  gl_FragColor = vec4(color * lighting, 1.0);
}
