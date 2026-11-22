import * as THREE from 'three';
import terrainVertexShader from './shaders/terrain.vert.glsl?raw';
import terrainFragmentShader from './shaders/terrain.frag.glsl?raw';
import wireFragmentShader from './shaders/wire.frag.glsl?raw';
import type { Terrain } from '../terrain/Terrain.js';
import type { TerrainBlueprint } from '../blueprint/types.js';
import { BUILTIN_TEXTURE_ASSETS, createBuiltinTexture } from '../textures/assets.js';
import { DOME_RADIUS } from '../terrain/DomeProjection.js';

export interface TerrainClipmapOptions {
  levels?: number;
  gridSize?: number;
  tileSize?: number;
  baseCellSize?: number;
  showWireframe?: boolean;
}

export class TerrainRenderer {
  readonly group = new THREE.Group();
  readonly levels: number;
  readonly gridSize: number;
  readonly tileSize: number;
  readonly baseCellSize: number;
  private readonly tilesPerSide: number;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly wireGeometries: THREE.BufferGeometry[] = [];
  private readonly creationQueue: Array<{ ringIndex: number; tileIndex: number }> = [];
  private readonly rings: Array<{
    step: number;
    half: number;
    cut: number;
    outer: number;
    centerX: number;
    centerZ: number;
    instances: THREE.InstancedMesh;
    instanceOffset: number;
    tiles: Array<{ ready: boolean; visible: boolean; dirty: boolean; instanceIndex: number; wire: THREE.LineSegments | null; ox: number; oz: number }>;
    material: THREE.ShaderMaterial;
    wireMaterial: THREE.ShaderMaterial;
  }> = [];
  private readonly instanceTransform = new THREE.Object3D();
  private readonly uniforms: {
    uCamera: { value: THREE.Vector2 };
    uAltitude: { value: number };
    uLodScale: { value: number };
    uFogColor: { value: THREE.Color };
    uFogNear: { value: number };
    uFogFar: { value: number };
    uSunDirection: { value: THREE.Vector3 };
    uSunIntensity: { value: number };
  };
  private readonly unsubscribe: () => void;
  private showWireframe: boolean;
  private readonly terrain: Terrain;
  private readonly frustum = new THREE.Frustum();
  private readonly projectionView = new THREE.Matrix4();
  private readonly tileBounds = new THREE.Box3();
  private readonly assetTextures = new Map<string, THREE.DataTexture>();
  private activeVertexShader = '';
  private activeFragmentShader = '';
  private activeTextureIds: string[] = [];
  private baseFogNear: number;
  private baseFogFar: number;
  private readonly fallbackAssetTexture = (() => { const pixels = new Uint8Array([255,0,255,255, 0,0,0,255, 0,0,0,255, 255,0,255,255]); const t = new THREE.DataTexture(pixels,2,2,THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; })();

  constructor(
    private readonly scene: THREE.Scene,
    terrain: Terrain,
    blueprint: TerrainBlueprint,
    options: TerrainClipmapOptions = {}
  ) {
    this.terrain = terrain;
    this.baseFogNear = blueprint.fogNear;
    this.baseFogFar = blueprint.fogFar;
    this.levels = options.levels ?? 8;
    this.gridSize = options.gridSize ?? 96;
    this.tileSize = options.tileSize ?? 32;
    this.baseCellSize = options.baseCellSize ?? 1;
    this.tilesPerSide = this.gridSize / this.tileSize;
    this.showWireframe = options.showWireframe ?? false;
    if (!Number.isInteger(this.tilesPerSide) || this.tilesPerSide < 1) {
      throw new Error('gridSize должен делиться на tileSize без остатка');
    }
    this.uniforms = {
      uCamera: { value: new THREE.Vector2() },
      uAltitude: { value: 0 },
      uLodScale: { value: 1 },
      uFogColor: { value: new THREE.Color(blueprint.fogColor) },
      uFogNear: { value: blueprint.fogNear },
      uFogFar: { value: blueprint.fogFar },
      uSunDirection: { value: new THREE.Vector3(-0.45, 0.78, 0.42).normalize() },
      uSunIntensity: { value: 1 }
    };
    this.build(blueprint);
    this.scene.add(this.group);
    this.unsubscribe = terrain.subscribeChanges(() => {
      // GPU edit-delta upload is handled by a future terrain-renderer adapter.
    });
  }

  setWireframe(enabled: boolean): void {
    this.showWireframe = enabled;
    for (let level = 0; level < this.rings.length; level++) {
      const ring = this.rings[level];
      for (let i = 0; i < ring.tiles.length; i++) {
        const tile = ring.tiles[i];
        if (enabled && tile.ready && !tile.wire) this.createWireForTile(ring, tile, i);
        if (tile.wire) tile.wire.visible = enabled && tile.visible;
      }
    }
  }

  /** Recompiles the visible terrain materials without rebuilding clipmap geometry. */
  setBlueprint(blueprint: TerrainBlueprint): void {
    const vertexShader = terrainVertexShader.replace('__TERRAIN_HEIGHT_FUNCTION__', blueprint.heightFunctionGLSL);
    const fragmentShader = terrainFragmentShader
      .replace('__TERRAIN_HEIGHT_FUNCTION__', blueprint.heightFunctionGLSL)
      .replace('__TERRAIN_COLOR_GRAPH__', blueprint.fragmentGraphGLSL ?? 'vec3 base = uBaseColor;');
    const vertexChanged = vertexShader !== this.activeVertexShader;
    const fragmentChanged = fragmentShader !== this.activeFragmentShader;
    const nextTextureIds = Array.from({ length: 8 }, (_, i) => blueprint.textureAssets?.[i] ?? '');
    const texturesChanged = nextTextureIds.some((id, i) => id !== this.activeTextureIds[i]);
    this.uniforms.uFogColor.value.set(blueprint.fogColor);
    this.baseFogNear = blueprint.fogNear;
    this.baseFogFar = blueprint.fogFar;
    this.uniforms.uFogNear.value = this.baseFogNear * this.uniforms.uLodScale.value;
    this.uniforms.uFogFar.value = this.baseFogFar * this.uniforms.uLodScale.value;
    for (const ring of this.rings) {
      if (vertexChanged) {
        ring.material.vertexShader = vertexShader;
        ring.wireMaterial.vertexShader = vertexShader;
        ring.material.needsUpdate = true;
        ring.wireMaterial.needsUpdate = true;
      }
      if (fragmentChanged) {
        ring.material.fragmentShader = fragmentShader;
        ring.material.needsUpdate = true;
      }
      ring.material.uniforms.uBaseColor.value.set(blueprint.terrainColor);
      if (texturesChanged && ring === this.rings[0]) for (let i = 0; i < 8; i++) {
        const texture = this.getAssetTexture(nextTextureIds[i] || undefined);
        ring.material.uniforms[`uAsset${i}`].value = texture;
        ring.wireMaterial.uniforms[`uAsset${i}`].value = texture;
      }
    }
    this.activeVertexShader = vertexShader;
    this.activeFragmentShader = fragmentShader;
    this.activeTextureIds = nextTextureIds;
  }

  setLighting(direction: THREE.Vector3, intensity: number): void {
    this.uniforms.uSunDirection.value.copy(direction).normalize();
    this.uniforms.uSunIntensity.value = Math.max(0, intensity);
  }

  update(camera: THREE.Camera): { visibleTiles: number; totalTiles: number; readyTiles: number; queuedTiles: number; altitude: number; horizonDistance: number; lodScale: number } {
    camera.updateMatrixWorld(true);
    const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    this.projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projectionView);

    const cx = cameraPosition.x, cz = cameraPosition.z;
    const groundY = this.terrain.getGroundHeight(cx, cz, this.baseCellSize);
    const cameraHeight = Math.max(1, cameraPosition.y - groundY);
    const altitude = Math.max(0, cameraHeight - 4);
    this.uniforms.uCamera.value.set(cx, cz);
    this.uniforms.uAltitude.value = altitude;
    // The dome is a fixed spherical cap. Camera altitude only reveals more of it
    // and expands the reused clipmap rings; it never deforms the physics surface.
    const horizonDistance = Math.sqrt(2 * DOME_RADIUS * cameraHeight + cameraHeight * cameraHeight);
    const baseCoverage = this.gridSize * 0.5 * this.baseCellSize * 2 ** (this.levels - 1);
    const lodScale = THREE.MathUtils.clamp(Math.max(1, horizonDistance / baseCoverage), 1, 256);
    const lodScaleChanged = Math.abs(this.uniforms.uLodScale.value - lodScale) > 0.0005;
    this.uniforms.uLodScale.value = lodScale;
    this.uniforms.uFogNear.value = this.baseFogNear * lodScale;
    this.uniforms.uFogFar.value = Math.max(this.baseFogFar, this.baseFogNear + 1) * lodScale;

    // Re-prioritize unfinished tiles around the camera every frame: inner LOD first,
    // then nearest tile centers. This keeps the visible center responsive while moving.
    this.creationQueue.sort((a, b) => {
      if (a.ringIndex !== b.ringIndex) return a.ringIndex - b.ringIndex;
      const ra = this.rings[a.ringIndex], rb = this.rings[b.ringIndex];
      const sa = 2 * ra.step * lodScale, sb = 2 * rb.step * lodScale;
      const ax = cx - Math.round(cx / sa) * sa, az = cz - Math.round(cz / sa) * sa;
      const bx = cx - Math.round(cx / sb) * sb, bz = cz - Math.round(cz / sb) * sb;
      const ta = ra.tiles[a.tileIndex], tb = rb.tiles[b.tileIndex];
      const da = Math.hypot((ta.ox + this.tileSize / 2) * ra.step * lodScale - ax, (ta.oz + this.tileSize / 2) * ra.step * lodScale - az);
      const db = Math.hypot((tb.ox + this.tileSize / 2) * rb.step * lodScale - bx, (tb.oz + this.tileSize / 2) * rb.step * lodScale - bz);
      return da - db;
    });
    // Create only a few tiles per frame; never build the full clipmap in one blocking burst.
    for (let i = 0; i < 4 && this.creationQueue.length > 0; i++) {
      const item = this.creationQueue.shift()!;
      const ring = this.rings[item.ringIndex];
      const tile = ring.tiles[item.tileIndex];
      tile.ready = true;
      tile.dirty = true;
      if (this.showWireframe) this.createWireForTile(ring, tile, item.tileIndex);
    }
    let visibleTiles = 0;
    for (let level = 0; level < this.rings.length; level++) {
      const ring = this.rings[level];
      const snap = 2 * ring.step * lodScale;
      const centerX = Math.round(cx / snap) * snap;
      const centerZ = Math.round(cz / snap) * snap;
      const last = level === this.rings.length - 1;
      const centerChanged = ring.centerX !== centerX || ring.centerZ !== centerZ;
      ring.centerX = centerX;
      ring.centerZ = centerZ;
      let instanceBufferChanged = false;
      for (let tileIndex = 0; tileIndex < ring.tiles.length; tileIndex++) {
        const tile = ring.tiles[tileIndex];
        if (!tile.ready) continue;
        if (tile.wire && (tile.wire.position.x !== centerX || tile.wire.position.z !== centerZ)) tile.wire.position.set(centerX, 0, centerZ);
        const size = this.tileSize * ring.step * lodScale;
        const x0 = centerX + tile.ox * ring.step * lodScale, x1 = x0 + size;
        const z0 = centerZ + tile.oz * ring.step * lodScale, z1 = z0 + size;
        const minDistance = Math.max(
          Math.max(x0 - cx, 0, cx - x1),
          Math.max(z0 - cz, 0, cz - z1), altitude
        );
        const maxDistance = Math.max(
          Math.abs(x0 - cx), Math.abs(x1 - cx),
          Math.abs(z0 - cz), Math.abs(z1 - cz), altitude
        );
        // Conservative vertical bounds include procedural peaks and valleys.
        this.tileBounds.min.set(x0, -DOME_RADIUS, z0);
        this.tileBounds.max.set(x1, 512, z1);
        const inCameraFrustum = this.frustum.intersectsBox(this.tileBounds);
        const inRing = maxDistance >= ring.cut * lodScale && (last || minDistance < ring.outer * lodScale);
        const nearestDx = Math.max(x0 - cx, 0, cx - x1);
        const nearestDz = Math.max(z0 - cz, 0, cz - z1);
        const beforeHorizon = Math.hypot(nearestDx, nearestDz) <= horizonDistance * 1.03;
        const visible = inCameraFrustum && inRing && beforeHorizon;
        if (tile.dirty || centerChanged || lodScaleChanged || visible !== tile.visible) {
          this.instanceTransform.position.set(centerX + tile.ox * ring.step * lodScale, 0, centerZ + tile.oz * ring.step * lodScale);
          this.instanceTransform.rotation.set(0, 0, 0);
          this.instanceTransform.scale.set(visible ? ring.step * lodScale : 0, visible ? 1 : 0, visible ? ring.step * lodScale : 0);
          this.instanceTransform.updateMatrix();
          ring.instances.setMatrixAt(tile.instanceIndex, this.instanceTransform.matrix);
          tile.dirty = false;
          instanceBufferChanged = true;
        }
        tile.visible = visible;
        if (tile.wire) tile.wire.visible = visible && this.showWireframe;
        if (visible) visibleTiles++;
      }
      if (instanceBufferChanged) ring.instances.instanceMatrix.needsUpdate = true;
      if (lodScaleChanged) for (const tile of ring.tiles) if (tile.wire) tile.wire.scale.set(ring.step * lodScale, 1, ring.step * lodScale);
    }
    return { visibleTiles, totalTiles: this.rings.length * this.tilesPerSide ** 2, readyTiles: this.rings.reduce((n, r) => n + r.tiles.filter(t => t.ready).length, 0), queuedTiles: this.creationQueue.length, altitude, horizonDistance, lodScale };
  }

  dispose(): void {
    this.unsubscribe();
    for (const texture of this.assetTextures.values()) texture.dispose();
    this.assetTextures.clear();
    this.fallbackAssetTexture.dispose();
    const shared = this.rings[0];
    if (shared) {
      this.group.remove(shared.instances);
      shared.instances.dispose();
      shared.material.dispose();
      shared.wireMaterial.dispose();
    }
    for (const geometry of this.geometries) geometry.dispose();
    for (const geometry of this.wireGeometries) geometry?.dispose();
    this.scene.remove(this.group);
    this.rings.length = 0;
    this.geometries.length = 0;
    this.wireGeometries.length = 0;
  }

  private createWireForTile(
    ring: { step: number; centerX: number; centerZ: number; wireMaterial: THREE.ShaderMaterial },
    tile: { ready: boolean; visible: boolean; wire: THREE.LineSegments | null },
    tileIndex: number
  ): void {
    if (tile.wire || !tile.ready) return;
    let wireGeometry = this.wireGeometries[tileIndex];
    if (!wireGeometry) {
      const tx = tileIndex % this.tilesPerSide, tz = Math.floor(tileIndex / this.tilesPerSide);
      wireGeometry = this.createTileWireGeometry(tx, tz);
      this.wireGeometries[tileIndex] = wireGeometry;
    }
    const wire = new THREE.LineSegments(wireGeometry, ring.wireMaterial);
    wire.scale.set(ring.step * this.uniforms.uLodScale.value, 1, ring.step * this.uniforms.uLodScale.value);
    wire.frustumCulled = false;
    wire.position.set(ring.centerX, 0, ring.centerZ);
    wire.visible = this.showWireframe && tile.visible;
    tile.wire = wire;
    this.group.add(wire);
  }

  private build(blueprint: TerrainBlueprint): void {
    const vertexShader = terrainVertexShader.replace('__TERRAIN_HEIGHT_FUNCTION__', blueprint.heightFunctionGLSL);
    const fragmentShader = terrainFragmentShader.replace('__TERRAIN_HEIGHT_FUNCTION__', blueprint.heightFunctionGLSL).replace('__TERRAIN_COLOR_GRAPH__', blueprint.fragmentGraphGLSL ?? 'vec3 base = uBaseColor;');
    this.activeVertexShader = vertexShader;
    this.activeFragmentShader = fragmentShader;
    this.activeTextureIds = Array.from({ length: 8 }, (_, i) => blueprint.textureAssets?.[i] ?? '');
    // Одна локальная геометрия повторно используется всеми экземплярами всех LOD.
    // Диагностическая проволочная сетка остаётся отдельным необязательным overlay.
    this.geometries.push(this.createTileGeometry());
    const halfGrid = this.gridSize / 2;
    const totalInstances = this.levels * this.tilesPerSide ** 2;
    const steps = new Float32Array(totalInstances);
    const halves = new Float32Array(totalInstances);
    const cuts = new Float32Array(totalInstances);
    const tileGeometry = this.geometries[0];
    tileGeometry.setAttribute('aStep', new THREE.InstancedBufferAttribute(steps, 1));
    tileGeometry.setAttribute('aHalf', new THREE.InstancedBufferAttribute(halves, 1));
    tileGeometry.setAttribute('aCut', new THREE.InstancedBufferAttribute(cuts, 1));
    const assetUniforms: Record<string, { value: THREE.Texture }> = {};
    for (let i = 0; i < 8; i++) assetUniforms[`uAsset${i}`] = { value: this.getAssetTexture(blueprint.textureAssets?.[i]) };
    const common = {
      ...assetUniforms,
      uCamera: this.uniforms.uCamera,
      uAltitude: this.uniforms.uAltitude,
      uLodScale: this.uniforms.uLodScale,
      uFogColor: this.uniforms.uFogColor,
      uFogNear: this.uniforms.uFogNear,
      uFogFar: this.uniforms.uFogFar,
      uSunDirection: this.uniforms.uSunDirection,
      uSunIntensity: this.uniforms.uSunIntensity,
      uBaseColor: { value: new THREE.Color(blueprint.terrainColor) },
      uWireLift: { value: 0 }
    };
    const sharedMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([common, THREE.UniformsLib.lights]),
      vertexShader, fragmentShader, lights: true,
      glslVersion: THREE.GLSL3, side: THREE.FrontSide
    });
    const sharedInstances = new THREE.InstancedMesh(tileGeometry, sharedMaterial, totalInstances);
    sharedInstances.frustumCulled = false;
    sharedInstances.receiveShadow = true;
    sharedInstances.count = totalInstances;
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < totalInstances; i++) sharedInstances.setMatrixAt(i, hidden);
    let instanceOffset = 0;
    for (let level = 0; level < this.levels; level++) {
      const step = this.baseCellSize * 2 ** level;
      const half = halfGrid * this.baseCellSize * 2 ** level;
      const outer = half - 2 * step;
      // Exactly the previous level's morph boundary, as in the legacy clipmap.
      const cut = level > 0 ? halfGrid * this.baseCellSize * 2 ** (level - 1) - step : 0;
      const common = {
        ...Object.fromEntries(Object.entries(sharedMaterial.uniforms).filter(([key]) => key.startsWith('uAsset'))),
        uCamera: this.uniforms.uCamera,
        uAltitude: this.uniforms.uAltitude,
        uLodScale: this.uniforms.uLodScale,
        uStep: { value: step },
        uHalf: { value: half },
        uCut: { value: cut },
        uOuter: { value: level === this.levels - 1 ? 1e9 : outer },
        uFogColor: this.uniforms.uFogColor,
        uFogNear: this.uniforms.uFogNear,
        uFogFar: this.uniforms.uFogFar,
        uSunDirection: this.uniforms.uSunDirection,
        uSunIntensity: this.uniforms.uSunIntensity,
        uBaseColor: { value: new THREE.Color(blueprint.terrainColor) },
        uWireColor: { value: new THREE.Color().setHSL(0.48 + level * 0.075, 0.88, 0.62) }
      };
      const material = sharedMaterial;
      const wireMaterial = new THREE.ShaderMaterial({
        uniforms: { ...common, uWireLift: { value: 0.025 } }, vertexShader, fragmentShader: wireFragmentShader,
        glslVersion: THREE.GLSL3, transparent: true, depthWrite: false, side: THREE.FrontSide,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
      });
      const tiles: Array<{ ready: boolean; visible: boolean; dirty: boolean; instanceIndex: number; wire: THREE.LineSegments | null; ox: number; oz: number }> = [];
      for (let i = 0; i < this.tilesPerSide ** 2; i++) {
        const tx = i % this.tilesPerSide, tz = Math.floor(i / this.tilesPerSide);
        const ox = tx * this.tileSize - halfGrid, oz = tz * this.tileSize - halfGrid;
        const instanceIndex = instanceOffset + i;
        tiles.push({ ready: false, visible: false, dirty: true, instanceIndex, wire: null, ox, oz });
        steps[instanceIndex] = step;
        halves[instanceIndex] = half;
        cuts[instanceIndex] = cut;
      }
      this.rings.push({ step, half, cut, outer, centerX: 0, centerZ: 0, instances: sharedInstances, instanceOffset, tiles, material, wireMaterial });
      instanceOffset += tiles.length;
    }
    sharedInstances.instanceMatrix.needsUpdate = true;
    tileGeometry.getAttribute('aStep').needsUpdate = true;
    tileGeometry.getAttribute('aHalf').needsUpdate = true;
    tileGeometry.getAttribute('aCut').needsUpdate = true;
    this.group.add(sharedInstances);
    // Within each LOD, create central tiles first; outer rings are queued later.
    for (let ringIndex = 0; ringIndex < this.rings.length; ringIndex++) {
      const ring = this.rings[ringIndex];
      const order = ring.tiles.map((tile, tileIndex) => ({ tileIndex, distance: Math.hypot(tile.ox + this.tileSize / 2, tile.oz + this.tileSize / 2) }))
        .sort((a, b) => a.distance - b.distance);
      for (const item of order) this.creationQueue.push({ ringIndex, tileIndex: item.tileIndex });
    }
  }

  private getAssetTexture(id?: string): THREE.Texture {
    if (!id || !BUILTIN_TEXTURE_ASSETS.some(asset => asset.id === id)) return this.fallbackAssetTexture;
    let texture = this.assetTextures.get(id);
    if (!texture) { texture = createBuiltinTexture(id); this.assetTextures.set(id, texture); }
    return texture;
  }

  private createTileWireGeometry(tx: number, tz: number): THREE.BufferGeometry {
    const side = this.tileSize + 1;
    const positions = new Float32Array(side * side * 3);
    const indices: number[] = [];
    const ox = tx * this.tileSize - this.gridSize / 2;
    const oz = tz * this.tileSize - this.gridSize / 2;
    for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
      const i = (z * side + x) * 3, vertex = z * side + x;
      positions[i] = ox + x; positions[i + 2] = oz + z;
      // Горизонтальные сегменты дублируются по границе соседних Z-тайлов,
      // вертикальные — по границе соседних X-тайлов. Не пропускаем первые
      // внутренние сегменты строки/столбца: иначе в сетке появляются разрывы.
      if (x < this.tileSize && !(z === 0 && tz > 0)) indices.push(vertex, vertex + 1);
      if (z < this.tileSize && !(x === 0 && tx > 0)) indices.push(vertex, vertex + side);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    return geometry;
  }

  private createTileGeometry(): THREE.BufferGeometry {
    const side = this.tileSize + 1;
    const positions = new Float32Array(side * side * 3);
    const indices: number[] = [];
    for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
      const i = (z * side + x) * 3;
      positions[i] = x; positions[i + 2] = z;
    }
    for (let z = 0; z < this.tileSize; z++) for (let x = 0; x < this.tileSize; x++) {
      const a = z * side + x, b = a + 1, c = a + side, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    return geometry;
  }
}
