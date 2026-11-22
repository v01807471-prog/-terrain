import * as THREE from 'three';
import terrainVertexShader from './shaders/terrain.vert.glsl?raw';
import terrainFragmentShader from './shaders/terrain.frag.glsl?raw';
import wireFragmentShader from './shaders/wire.frag.glsl?raw';
import type { Terrain } from '../terrain/Terrain.js';
import type { TerrainBlueprint } from '../blueprint/types.js';
import { BUILTIN_TEXTURE_ASSETS, createBuiltinTexture } from '../textures/assets.js';

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
    tiles: Array<{ mesh: THREE.Mesh | null; wire: THREE.LineSegments | null; ox: number; oz: number }>;
    material: THREE.ShaderMaterial;
    wireMaterial: THREE.ShaderMaterial;
  }> = [];
  private readonly uniforms: {
    uCamera: { value: THREE.Vector2 };
    uAltitude: { value: number };
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
  private readonly fallbackAssetTexture = (() => { const pixels = new Uint8Array([255,0,255,255, 0,0,0,255, 0,0,0,255, 255,0,255,255]); const t = new THREE.DataTexture(pixels,2,2,THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; })();

  constructor(
    private readonly scene: THREE.Scene,
    terrain: Terrain,
    blueprint: TerrainBlueprint,
    options: TerrainClipmapOptions = {}
  ) {
    this.terrain = terrain;
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
        if (enabled && tile.mesh && !tile.wire) this.createWireForTile(ring, tile, i);
        if (tile.wire) tile.wire.visible = enabled && !!tile.mesh?.visible;
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
    this.uniforms.uFogNear.value = blueprint.fogNear;
    this.uniforms.uFogFar.value = blueprint.fogFar;
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
      if (texturesChanged) for (let i = 0; i < 8; i++) {
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

  update(camera: THREE.Camera): { visibleTiles: number; totalTiles: number; readyTiles: number; queuedTiles: number; altitude: number } {
    camera.updateMatrixWorld(true);
    const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    this.projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projectionView);

    const cx = cameraPosition.x, cz = cameraPosition.z;
    const groundY = this.terrain.getGroundHeight(cx, cz, this.baseCellSize);
    const altitude = Math.max(0, cameraPosition.y - groundY - 4);
    this.uniforms.uCamera.value.set(cx, cz);
    this.uniforms.uAltitude.value = altitude;

    // Re-prioritize unfinished tiles around the camera every frame: inner LOD first,
    // then nearest tile centers. This keeps the visible center responsive while moving.
    this.creationQueue.sort((a, b) => {
      if (a.ringIndex !== b.ringIndex) return a.ringIndex - b.ringIndex;
      const ra = this.rings[a.ringIndex], rb = this.rings[b.ringIndex];
      const sa = 2 * ra.step, sb = 2 * rb.step;
      const ax = cx - Math.round(cx / sa) * sa, az = cz - Math.round(cz / sa) * sa;
      const bx = cx - Math.round(cx / sb) * sb, bz = cz - Math.round(cz / sb) * sb;
      const ta = ra.tiles[a.tileIndex], tb = rb.tiles[b.tileIndex];
      const da = Math.hypot((ta.ox + this.tileSize / 2) * ra.step - ax, (ta.oz + this.tileSize / 2) * ra.step - az);
      const db = Math.hypot((tb.ox + this.tileSize / 2) * rb.step - bx, (tb.oz + this.tileSize / 2) * rb.step - bz);
      return da - db;
    });
    // Create only a few tiles per frame; never build the full clipmap in one blocking burst.
    for (let i = 0; i < 4 && this.creationQueue.length > 0; i++) {
      const item = this.creationQueue.shift()!;
      const ring = this.rings[item.ringIndex];
      const tile = ring.tiles[item.tileIndex];
      const mesh = new THREE.Mesh(this.geometries[item.tileIndex], ring.material);
      mesh.scale.set(ring.step, 1, ring.step);
      mesh.frustumCulled = false;
      tile.mesh = mesh;
      this.group.add(mesh);
      if (this.showWireframe) this.createWireForTile(ring, tile, item.tileIndex);
    }
    let visibleTiles = 0;
    for (let level = 0; level < this.rings.length; level++) {
      const ring = this.rings[level];
      const snap = 2 * ring.step;
      const centerX = Math.round(cx / snap) * snap;
      const centerZ = Math.round(cz / snap) * snap;
      const last = level === this.rings.length - 1;
      for (const tile of ring.tiles) {
        if (!tile.mesh) continue;
        if (tile.mesh.position.x !== centerX || tile.mesh.position.z !== centerZ) {
          tile.mesh.position.set(centerX, 0, centerZ);
          if (tile.wire) tile.wire.position.set(centerX, 0, centerZ);
        }
        const size = this.tileSize * ring.step;
        const x0 = centerX + tile.ox * ring.step, x1 = x0 + size;
        const z0 = centerZ + tile.oz * ring.step, z1 = z0 + size;
        const minDistance = Math.max(
          Math.max(x0 - cx, 0, cx - x1),
          Math.max(z0 - cz, 0, cz - z1), altitude
        );
        const maxDistance = Math.max(
          Math.abs(x0 - cx), Math.abs(x1 - cx),
          Math.abs(z0 - cz), Math.abs(z1 - cz), altitude
        );
        // Conservative vertical bounds include procedural peaks and valleys.
        this.tileBounds.min.set(x0, -40, z0);
        this.tileBounds.max.set(x1, 65, z1);
        const inCameraFrustum = this.frustum.intersectsBox(this.tileBounds);
        const inRing = maxDistance >= ring.cut && (last || minDistance < ring.outer);
        const visible = inCameraFrustum && inRing;
        tile.mesh.visible = visible;
        if (tile.wire) tile.wire.visible = visible && this.showWireframe;
        if (visible) visibleTiles++;
      }
    }
    return { visibleTiles, totalTiles: this.rings.length * this.tilesPerSide ** 2, readyTiles: this.rings.reduce((n, r) => n + r.tiles.filter(t => t.mesh !== null).length, 0), queuedTiles: this.creationQueue.length, altitude };
  }

  dispose(): void {
    this.unsubscribe();
    for (const texture of this.assetTextures.values()) texture.dispose();
    this.assetTextures.clear();
    this.fallbackAssetTexture.dispose();
    for (const ring of this.rings) {
      ring.material.dispose();
      ring.wireMaterial.dispose();
    }
    for (const geometry of this.geometries) geometry.dispose();
    for (const geometry of this.wireGeometries) geometry?.dispose();
    this.scene.remove(this.group);
    this.rings.length = 0;
    this.geometries.length = 0;
    this.wireGeometries.length = 0;
  }

  private createWireForTile(
    ring: { step: number; wireMaterial: THREE.ShaderMaterial },
    tile: { mesh: THREE.Mesh | null; wire: THREE.LineSegments | null },
    tileIndex: number
  ): void {
    if (tile.wire) return;
    let wireGeometry = this.wireGeometries[tileIndex];
    if (!wireGeometry) {
      const tx = tileIndex % this.tilesPerSide, tz = Math.floor(tileIndex / this.tilesPerSide);
      wireGeometry = this.createTileWireGeometry(tx, tz);
      this.wireGeometries[tileIndex] = wireGeometry;
    }
    const wire = new THREE.LineSegments(wireGeometry, ring.wireMaterial);
    wire.scale.set(ring.step, 1, ring.step);
    wire.frustumCulled = false;
    wire.position.copy(tile.mesh?.position ?? new THREE.Vector3());
    wire.visible = this.showWireframe && !!tile.mesh?.visible;
    tile.wire = wire;
    this.group.add(wire);
  }

  private build(blueprint: TerrainBlueprint): void {
    const vertexShader = terrainVertexShader.replace('__TERRAIN_HEIGHT_FUNCTION__', blueprint.heightFunctionGLSL);
    const fragmentShader = terrainFragmentShader.replace('__TERRAIN_HEIGHT_FUNCTION__', blueprint.heightFunctionGLSL).replace('__TERRAIN_COLOR_GRAPH__', blueprint.fragmentGraphGLSL ?? 'vec3 base = uBaseColor;');
    this.activeVertexShader = vertexShader;
    this.activeFragmentShader = fragmentShader;
    this.activeTextureIds = Array.from({ length: 8 }, (_, i) => blueprint.textureAssets?.[i] ?? '');
    for (let tz = 0; tz < this.tilesPerSide; tz++) {
      for (let tx = 0; tx < this.tilesPerSide; tx++) {
        this.geometries.push(this.createTileGeometry(tx, tz));
        // Diagnostic wire geometry is generated only if the user enables the wire overlay.
      }
    }
    const halfGrid = this.gridSize / 2;
    for (let level = 0; level < this.levels; level++) {
      const step = this.baseCellSize * 2 ** level;
      const half = halfGrid * this.baseCellSize * 2 ** level;
      const outer = half - 2 * step;
      // Exactly the previous level's morph boundary, as in the legacy clipmap.
      const cut = level > 0 ? halfGrid * this.baseCellSize * 2 ** (level - 1) - step : 0;
      const assetUniforms: Record<string, { value: THREE.Texture }> = {};
      for (let i = 0; i < 8; i++) assetUniforms[`uAsset${i}`] = { value: this.getAssetTexture(blueprint.textureAssets?.[i]) };
      const common = {
        ...assetUniforms,
        uCamera: this.uniforms.uCamera,
        uAltitude: this.uniforms.uAltitude,
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
        // Контрастный цвет для каждого LOD, чтобы было видно границы уровней.
        uWireColor: { value: new THREE.Color().setHSL(0.48 + level * 0.075, 0.88, 0.62) }
      };
      const material = new THREE.ShaderMaterial({
        uniforms: { ...common, uWireLift: { value: 0 } }, vertexShader, fragmentShader: terrainFragmentShader.replace('__TERRAIN_HEIGHT_FUNCTION__', blueprint.heightFunctionGLSL).replace('__TERRAIN_COLOR_GRAPH__', blueprint.fragmentGraphGLSL ?? 'vec3 base = uBaseColor;'),
        glslVersion: THREE.GLSL3, side: THREE.FrontSide
      });
      const wireMaterial = new THREE.ShaderMaterial({
        uniforms: { ...common, uWireLift: { value: 0.025 } }, vertexShader, fragmentShader: wireFragmentShader,
        glslVersion: THREE.GLSL3, transparent: true, depthWrite: false, side: THREE.FrontSide,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
      });
      const tiles: Array<{ mesh: THREE.Mesh; wire: THREE.LineSegments; ox: number; oz: number }> = [];
      for (let i = 0; i < this.geometries.length; i++) {
        const tx = i % this.tilesPerSide, tz = Math.floor(i / this.tilesPerSide);
        const ox = tx * this.tileSize - halfGrid, oz = tz * this.tileSize - halfGrid;
        tiles.push({ mesh: null, wire: null, ox, oz });
      }
      this.rings.push({ step, half, cut, outer, tiles, material, wireMaterial });
    }
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

  private createTileGeometry(tx: number, tz: number): THREE.BufferGeometry {
    const side = this.tileSize + 1;
    const positions = new Float32Array(side * side * 3);
    const indices: number[] = [];
    const ox = tx * this.tileSize - this.gridSize / 2;
    const oz = tz * this.tileSize - this.gridSize / 2;
    for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
      const i = (z * side + x) * 3;
      positions[i] = ox + x; positions[i + 2] = oz + z;
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
