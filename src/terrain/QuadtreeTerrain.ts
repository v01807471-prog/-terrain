import * as THREE from 'three';
import { DEFAULT_TERRAIN_CONFIG, validateTerrainConfig, type TerrainConfig } from './config/TerrainConfig.ts';
import { PlanetLocalFrame } from './math/PlanetLocalFrame.ts';
import { QuadtreeLodSelector } from './lod/QuadtreeLodSelector.ts';
import { ChunkFrustumCuller } from './culling/ChunkFrustumCuller.ts';
import { TerrainGeometryFactory } from './geometry/TerrainGeometryFactory.ts';
import { TerrainMaterial } from './render/TerrainMaterial.ts';
import { ChunkRenderer } from './render/ChunkRenderer.ts';

export class QuadtreeTerrain {
  readonly group = new THREE.Group();
  readonly renderer: ChunkRenderer;
  private readonly frame: PlanetLocalFrame;
  private readonly selector: QuadtreeLodSelector;
  private readonly frustumCuller: ChunkFrustumCuller;

  constructor(
    readonly planetRoot: THREE.Object3D,
    config: Partial<TerrainConfig> = {}
  ) {
    const resolved = { ...DEFAULT_TERRAIN_CONFIG, ...config };
    validateTerrainConfig(resolved);
    this.frame = new PlanetLocalFrame(planetRoot);
    this.selector = new QuadtreeLodSelector(resolved);
    this.frustumCuller = new ChunkFrustumCuller(planetRoot);
    this.renderer = new ChunkRenderer(
      new TerrainGeometryFactory(resolved),
      new TerrainMaterial().create()
    );
    this.group.add(this.renderer.group);
    planetRoot.add(this.group);
  }

  update(camera: THREE.Camera): void {
    const localCamera = this.frame.cameraPosition(camera);
    const lodTiles = this.selector.select(localCamera.x, localCamera.z);
    const visibleTiles = this.frustumCuller.filter(lodTiles, camera);
    this.renderer.sync(visibleTiles);
  }

  dispose(): void {
    this.renderer.dispose();
    this.planetRoot.remove(this.group);
  }
}
