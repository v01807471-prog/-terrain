import * as THREE from 'three';

/**
 * Converts world-space camera positions into a planet-centred local frame.
 * The terrain never follows the camera: its chunk coordinates stay fixed
 * relative to the planet. Moving/orbiting the planet is handled by planetRoot.
 */
export class PlanetLocalFrame {
  private readonly inverseWorld = new THREE.Matrix4();
  private readonly localCamera = new THREE.Vector3();

  constructor(readonly planetRoot: THREE.Object3D) {}

  cameraPosition(camera: THREE.Camera): THREE.Vector3 {
    this.planetRoot.updateWorldMatrix(true, false);
    camera.updateMatrixWorld(true);
    this.inverseWorld.copy(this.planetRoot.matrixWorld).invert();
    this.localCamera.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(this.inverseWorld);
    return this.localCamera.clone();
  }
}
