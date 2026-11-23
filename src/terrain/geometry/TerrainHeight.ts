/** Deterministic planet-local height field. Replace with a sampled height source later. */
export function terrainHeight(x: number, z: number): number {
  const continents = Math.sin(x * 0.0018) * Math.cos(z * 0.0021) * 42;
  const hills = Math.sin(x * 0.0071 + z * 0.0035) * Math.cos(z * 0.0063) * 9;
  const ridges = Math.max(0, Math.sin((x + z) * 0.0012)) * 16;
  return continents + hills + ridges;
}
