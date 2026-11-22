import * as THREE from 'three';
import terrainVertexShader from './shaders/terrain.vert.glsl?raw';
import terrainFragmentShader from './shaders/terrain.frag.glsl?raw';
import wireFragmentShader from './shaders/wire.frag.glsl?raw';
import type { Terrain } from '../terrain/Terrain.js';
import type { TerrainBlueprint } from '../blueprint/types.js';
import { createBuiltinTexture } from '../textures/assets.js';

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
  private readonly rings: Array<{
    step: number;
    half: number;
    cut: number;
    outer: number;
    tiles: Array<{ mesh: THREE.Mesh; wire: THREE.LineSegments; ox: number; oz: number }>;
    material: THREE.ShaderMaterial;
    wireMaterial: THREE.ShaderMaterial;
  }> = [];
  private readonly uniforms: {
    uCamera: { value: THREE.Vector2 };
    uAltitude: { value: number };
    uFogColor: { value: THREE.Color };
    uFogNear: { value: number };
    uFogFar: { value: number };\n    uSunDirection: { value: THREE.Vector3 };\n    uSunIntensity: { value: number };
  };
  private readonly unsubscribe: () => void;
  private showWireframe: boolean;
  private readonly terrain: Terrain;
  private readonly frustum = new THREE.Frustum();
  private readonly projectionView = new THREE.Matrix4();
  private readonly tileBounds = new THREE.Box3();
  private readonly assetTextures = new Map<string, THREE.DataTexture>();
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
      uFogFar: { value: blueprint.fogFar },\n      uSunDirection: { value: new THREE.Vector3(-0.45, 0.78, 0.42).normalize() },\n      uSunIntensity: { value: 1 }
    };
    this.build(blueprint);
    this.scene.add(this.group);
    this.unsubscribe = terrain.subscribeChanges(() => {
      // GPU edit-delta upload is handled by a future terrain-renderer adapter.
    });
  }

  setWireframe(enabled: boolean): void {
    this.showWireframe = enabled;
    for (const ring of this.rings) {
      for (const tile of ring.tiles) tile.wire.visible = enabled && tile.mesh.visible;
    }
  }

  /** Recompiles the visible terrain materials without rebuilding clipmap geometry. */
  setBlueprint(blueprint: TerrainBlueprint): void {
    const vertexShader = terrainVertexShader.replace('__TERRAIN_HEIGHT_FUNCTION__', blueprint.heightFunctionGLSL);
    const fragmentShader = terrainFragmentShader.replace(
      '__TERRAIN_COLOR_GRAPH__', blueprint.fragmentGraphGLSL ?? 'vec3 base = uBaseColor;'
    );
    this.uniforms.uFogColor.value.set(blueprint.fogColor);
    this.uniforms.uFogNear.value = blueprint.fogNear;
    this.uniforms.uFogFar.value = blueprint.fogFar;
    for (const ring of this.rings) {
      ring.material.vertexShader = vertexShader;
      ring.material.fragmentShader = fragmentShader;
      ring.material.uniforms.uBaseColor.value.set(blueprint.terrainColor);
      ring.wireMaterial.vertexShader = vertexShader;
      for (let i = 0; i < 8; i++) {
        const texture = this.getAssetTexture(blueprint.textureAssets?.[i]);
        ring.material.uniforms[`uAsset${i}`].value = texture;
        ring.wireMaterial.uniforms[`uAsset${i}`].value = texture;
      }
      ring.material.needsUpdate = true;
      ring.wireMaterial.needsUpdate = true;
    }
  }

  setLighting(direction: THREE.Vector3, intensity: number): void {\n    this.uniforms.uSunDirection.value.copy(direction).normalize();\n    this.uniforms.uSunIntensity.value = Math.max(0, intensity);\n  }\n\n  update(camera: THREE.Camera): { visibleTiles: number; totalTiles: number; altitude: number } {
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

    let visibleTiles = 0;
    for (let level = 0; level < this.rings.length; level++) {
      const ring = this.rings[level];
      const snap = 2 * ring.step;
      const centerX = Math.round(cx / snap) * snap;
      const centerZ = Math.round(cz / snap) * snap;
      const last = level === this.rings.length - 1;
      for (const tile of ring.tiles) {
        if (tile.mesh.position.x !== centerX || tile.mesh.position.z !== centerZ) {
          tile.mesh.position.set(centerX, 0, centerZ);
          tile.wire.position.set(centerX, 0, centerZ);
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
        tile.wire.visible = visible && this.showWireframe;
        if (visible) visibleTiles++;
      }
    }
    return { visibleTiles, totalTiles: this.rings.length * this.tilesPerSide ** 2, altitude };
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
    for (const geometry of this.wireGeometries) geometry.dispose();
    this.scene.remove(this.group);
    this.rings.length = 0;
    this.geometries.length = 0;
    this.wireGeometries.length = 0;
  }

  private build(blueprint: TerrainBlueprint): void {
    const vertexShader = terrainVertexShader.replace('__TERRAIN_HEIGHT_FUNCTION__', blueprint.heightFunctionGLSL);
    for (let tz = 0; tz < this.tilesPerSide; tz++) {
      for (let tx = 0; tx < this.tilesPerSide; tx++) {
        this.geometries.push(this.createTileGeometry(tx, tz));
        this.wireGeometries.push(this.createTileWireGeometry(tx, tz));
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
        uFogFar: this.uniforms.uFogFar,\n        uSunDirection: this.uniforms.uSunDirection,\n        uSunIntensity: this.uniforms.uSunIntensity,
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
        const mesh = new THREE.Mesh(this.geometries[i], material);
        const wire = new THREE.LineSegments(this.wireGeometries[i], wireMaterial);
        mesh.scale.set(step, 1, step);
        wire.scale.set(step, 1, step);
        // Tile visibility is explicitly tested against the active camera frustum.
        mesh.frustumCulled = false;
        wire.frustumCulled = false;
        this.group.add(mesh, wire);
        tiles.push({ mesh, wire, ox, oz });
      }
      this.rings.push({ step, half, cut, outer, tiles, material, wireMaterial });
    }
  }

  private getAssetTexture(id?: string): THREE.Texture {
    if (!id) return this.fallbackAssetTexture;
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
