/** Fixed-radius spherical cap used by CPU terrain, terrain GLSL and water. */
export const DOME_RADIUS = 6_371_000;

export function domeHeightOffset(x: number, z: number, radius = DOME_RADIUS): number {
  const radialSq = x * x + z * z;
  return Math.sqrt(Math.max(0, radius * radius - radialSq)) - radius;
}

/** GLSL counterpart of domeHeightOffset; keep the formula in sync. */
export const DOME_HEIGHT_GLSL = `
const float TERRAIN_DOME_RADIUS = 6371000.0;
float domeHeightOffset(vec2 p) {
  float radialSq = dot(p, p);
  return sqrt(max(0.0, TERRAIN_DOME_RADIUS * TERRAIN_DOME_RADIUS - radialSq)) - TERRAIN_DOME_RADIUS;
}
`;
