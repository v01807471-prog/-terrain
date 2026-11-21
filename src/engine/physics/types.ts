export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface SphereBody {
  id: string;
  position: Vec3;
  previousPosition: Vec3;
  velocity: Vec3;
  angularVelocity: Vec3;
  orientation: Quaternion;
  radius: number;
  mass: number;
  restitution: number;
  friction: number;
  linearDamping: number;
  angularDamping: number;
  grounded: boolean;
}

export interface PhysicsConfig {
  gravity: Vec3;
  fixedDelta: number;
  maxSubSteps: number;
  maxFrameDelta: number;
  positionCorrection: number;
  /** Must match TerrainRenderer.baseCellSize for exact LOD0 collision sampling. */
  terrainCellSize: number;
}

export interface TerrainCollision {
  point: Vec3;
  normal: Vec3;
  penetration: number;
}
