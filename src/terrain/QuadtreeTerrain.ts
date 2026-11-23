import * as THREE from 'three';
import { DEFAULT_TERRAIN_CONFIG, validateTerrainConfig, type TerrainConfig } from './config/TerrainConfig.ts';
import { PlanetLocalFrame } from './math/PlanetLocalFrame.ts';
import { QuadtreeLodSelector } from './lod/QuadtreeLodSelector.ts';
import { TerrainGeometryFactory } from './geometry/TerrainGeometryFactory.ts';
import { TerrainMaterial } from './render/TerrainMaterial.ts';
import { ChunkRenderer } from './render/ChunkRenderer.ts';

export class QuadtreeTerrain {
  readonly group = new THREE.Group();
  readonly renderer: ChunkRenderer;
  private readonly frame: PlanetLocalFrame;
  private readonly selector: QuadtreeLodSelector;

  constructor(
    readonly planetRoot: THREE.Object3D,
    config: Partial<TerrainConfig> = {}
  ) {
    const resolved = { ...DEFAULT_TERRAIN_CONFIG, ...config };
    validateTerrainConfig(resolved);
    this.frame = new PlanetLocalFrame(planetRoot);
    this.selector = new QuadtreeLodSelector(resolved);
    this.renderer = new ChunkRenderer(
      new TerrainGeometryFactory(resolved),
      new TerrainMaterial().create()
    );
    this.group.add(this.renderer.group);
    planetRoot.add(this.group);
  }

  update(camera: THREE.Camera): void {
    const localCamera = this.frame.cameraPosition(camera);
    const tiles = this.selector.select(localCamera.x, localCamera.z);
    this.renderer.sync(tiles);
  }

  dispose(): void {
    this.renderer.dispose();
    this.planetRoot.remove(this.group);
  }
}
