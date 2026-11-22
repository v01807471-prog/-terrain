import * as THREE from 'three';
import { Clipmap } from './Clipmap.ts';
import type { ClipmapConfig, ClipmapUpdate } from './types.ts';

/**
 * Minimal Three.js surface adapter. The core remains usable without Three.js.
 * Replace the default material/height function with the host application's terrain source.
 */
export class ThreeClipmap {
  readonly group = new THREE.Group();
  readonly core: Clipmap;
  private readonly meshes: THREE.Mesh[] = [];
  private readonly material: THREE.MeshStandardMaterial;

  constructor(config: Partial<ClipmapConfig> = {}, material?: THREE.Material) {
    this.core = new Clipmap(config);
    this.material = material instanceof THREE.MeshStandardMaterial
      ? material
      : new THREE.MeshStandardMaterial({ color: 0x668b62, roughness: 1, wireframe: false });
    const state = this.core.getSnapshot();
    for (const level of state.levels) {
      const geometry = new THREE.PlaneGeometry(level.worldSize, level.worldSize, level.resolution - 1, level.resolution - 1);
      geometry.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.frustumCulled = false;
      mesh.userData.clipmapLevel = level.index;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    this.apply(this.core.refresh());
  }

  update(camera: THREE.Camera, center: THREE.Vector2): ClipmapUpdate {
    camera.updateMatrixWorld(true);
    const position = camera.getWorldPosition(new THREE.Vector3());
    const state = this.core.update({
      camera: { x: position.x, y: position.y, z: position.z },
      center: { x: center.x, z: center.y }
    });
    this.apply(state);
    return state;
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      this.group.remove(mesh);
    }
    this.meshes.length = 0;
    this.material.dispose();
  }

  private apply(state: ClipmapUpdate): void {
    for (const level of state.levels) {
      const mesh = this.meshes[level.index];
      if (!mesh) continue;
      mesh.position.set(level.origin.x + level.worldSize / 2, 0, level.origin.z + level.worldSize / 2);
      mesh.visible = true;
    }
  }
}
