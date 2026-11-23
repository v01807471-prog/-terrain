import * as THREE from 'three';
import type { QuadTile } from '../quadtree/QuadTile.ts';

/** CPU-side chunk culling in the planet-local frame, before meshes are allocated. */
export class ChunkFrustumCuller {
  private readonly frustum = new THREE.Frustum();
  private readonly projectionView = new THREE.Matrix4();
  private readonly inversePlanetWorld = new THREE.Matrix4();
  private readonly bounds = new THREE.Box3();
  private readonly min = new THREE.Vector3();
  private readonly max = new THREE.Vector3();

  constructor(
    private readonly planetRoot: THREE.Object3D,
    private readonly minHeight = -120,
    private readonly maxHeight = 140
  ) {}

  filter(tiles: readonly QuadTile[], camera: THREE.Camera): QuadTile[] {
    camera.updateMatrixWorld(true);
    this.planetRoot.updateWorldMatrix(true, false);

    this.projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projectionView);
    this.inversePlanetWorld.copy(this.planetRoot.matrixWorld).invert();
    this.frustum.applyMatrix4(this.inversePlanetWorld);

    return tiles.filter(tile => {
      this.min.set(tile.minX, this.minHeight, tile.minZ);
      this.max.set(tile.minX + tile.size, this.maxHeight, tile.minZ + tile.size);
      this.bounds.set(this.min, this.max);
      return this.frustum.intersectsBox(this.bounds);
    });
  }
}
