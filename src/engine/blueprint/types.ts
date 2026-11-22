export interface TerrainBlueprint {
  /** CPU implementation generated from the editable graph; used by Terrain and PhysicsWorld. */
  heightAt(x: number, z: number): number;
  /** GPU implementation generated from the same graph. */
  heightFunctionGLSL: string;
  /** Optional GLSL color program generated from the V1 graph compiler. */
  fragmentGraphGLSL?: string;
  /** Asset IDs referenced by texture nodes, in shader uniform-slot order. */
  textureAssets?: string[];
  terrainColor: string;
  fogColor: string;
  fogNear: number;
  fogFar: number;
  /** Compiled V1 environment output; consumed by environment render adapters. */
  water?: unknown;
  fog?: { on?: number; near?: number; far?: number; color?: string } | null;
}