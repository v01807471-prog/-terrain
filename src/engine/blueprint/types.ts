export interface TerrainBlueprint {
  /** CPU implementation used by Terrain and PhysicsWorld. */
  heightAt(x: number, z: number): number;
  /** GPU implementation of the same height function. */
  heightFunctionGLSL: string;
  terrainColor: string;
  fogColor: string;
  fogNear: number;
  fogFar: number;
}
