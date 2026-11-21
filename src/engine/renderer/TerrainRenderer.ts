import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.js';
import type { TerrainBlueprint } from '../blueprint/types.js';

export interface TerrainClipmapOptions {
  levels?: number;
  gridSize?: number;
  tileSize?: number;
  baseCellSize?: number;
  showWireframe?: boolean;
}

/**
 * Reusable geometry Clipmap renderer.
 * Grid buffers are created once; camera motion only snaps tile transforms and
 * changes ring visibility/LOD uniforms. Terrain remains the CPU source of truth.
 */
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
    uFogFar: { value: number };
  };
  private readonly unsubscribe: () => void;
  private showWireframe: boolean;
  private readonly terrain: Terrain;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
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
      uFogFar: { value: blueprint.fogFar }
    };

    this.build(blueprint);
    this.scene.add(this.group);
    this.unsubscribe = terrain.subscribeChanges(() => {
      // GPU evaluates the procedural base itself; edit texture upload is a
      // separate adapter and is intentionally not faked by this prototype.
    });
  }

  setWireframe(enabled: boolean): void {
    this.showWireframe = enabled;
    for (const ring of this.rings) {
      for (const tile of ring.tiles) tile.wire.visible = enabled && tile.mesh.visible;
    }
  }

  update(): { visibleTiles: number; totalTiles: number; altitude: number } {
    const cameraPosition = new THREE.Vector3();
    this.camera.getWorldPosition(cameraPosition);
    const cx = cameraPosition.x;
    const cz = cameraPosition.z;
    const groundY = this.terrain.getHeight(cx, cz);
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
        const px = centerX;
        const pz = centerZ;
        if (tile.mesh.position.x !== px || tile.mesh.position.z !== pz) {
          tile.mesh.position.set(px, 0, pz);
          tile.wire.position.set(px, 0, pz);
        }

        const size = this.tileSize * ring.step;
        const x0 = centerX + tile.ox * ring.step;
        const x1 = x0 + size;
        const z0 = centerZ + tile.oz * ring.step;
        const z1 = z0 + size;
        const minDistance = Math.max(
          Math.max(x0 - cx, 0, cx - x1),
          Math.max(z0 - cz, 0, cz - z1),
          altitude
        );
        const maxDistance = Math.max(
          Math.abs(x0 - cx), Math.abs(x1 - cx),
          Math.abs(z0 - cz), Math.abs(z1 - cz), altitude
        );
        const visible = maxDistance >= ring.cut && (last || minDistance < ring.outer);
        tile.mesh.visible = visible;
        tile.wire.visible = visible && this.showWireframe;
        if (visible) visibleTiles++;
      }
    }

    return { visibleTiles, totalTiles: this.rings.length * this.tilesPerSide ** 2, altitude };
  }

  dispose(): void {
    this.unsubscribe();
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
    const vertexShader = `
      precision highp float;
      uniform vec2 uCamera;
      uniform float uAltitude;
      uniform float uStep;
      uniform float uHalf;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vDistance;
      ${blueprint.heightFunctionGLSL}
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vec2 p = world.xz;
        float d = max(max(abs(p.x-uCamera.x), abs(p.y-uCamera.y)), uAltitude);
        float morphEnd = uHalf - 2.0*uStep;
        float morph = smoothstep(morphEnd-uHalf*0.25, morphEnd, d);
        float h0 = terrainHeight(p);
        float h = h0;
        vec2 odd = mod(floor(p/uStep + 0.5), 2.0);
        if (morph > 0.0 && odd.x + odd.y > 0.5) {
          float coarse;
          if (odd.x > 0.5 && odd.y > 0.5) {
            coarse = 0.5*(terrainHeight(p+vec2(uStep,-uStep))+terrainHeight(p+vec2(-uStep,uStep)));
          } else if (odd.x > 0.5) {
            coarse = 0.5*(terrainHeight(p+vec2(uStep,0.0))+terrainHeight(p-vec2(uStep,0.0)));
          } else {
            coarse = 0.5*(terrainHeight(p+vec2(0.0,uStep))+terrainHeight(p-vec2(0.0,uStep)));
          }
          h = mix(h0, coarse, morph);
        }
        float e = 0.5*uStep*(1.0+morph);
        float hx = terrainHeight(p+vec2(e,0.0));
        float hz = terrainHeight(p+vec2(0.0,e));
        vNormal = normalize(vec3(-(hx-h0)/e, 1.0, -(hz-h0)/e));
        vWorld = vec3(p.x,h,p.y);
        vDistance = d;
        gl_Position = projectionMatrix*viewMatrix*vec4(vWorld,1.0);
      }
    `;
    const fragmentShader = `
      precision highp float;
      uniform vec2 uCamera;
      uniform float uAltitude;
      uniform float uCut;
      uniform float uOuter;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      uniform vec3 uBaseColor;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vDistance;
      void main() {
        vec2 delta = abs(vWorld.xz-uCamera);
        float d = max(max(delta.x,delta.y),uAltitude);
        if (d < uCut || d >= uOuter) discard;
        vec3 n = normalize(vNormal);
        vec3 lightDir = normalize(vec3(-0.45,0.78,0.42));
        float diffuse = max(dot(n,lightDir),0.0);
        float slope = 1.0-clamp(n.y,0.0,1.0);
        vec3 color = uBaseColor*(0.55+diffuse*0.8)*(1.0-slope*0.24);
        float distanceToCamera = length(vWorld-vec3(uCamera.x,0.0,uCamera.y));
        color = mix(color,uFogColor,smoothstep(uFogNear,uFogFar,distanceToCamera));
        gl_FragColor = vec4(color,1.0);
      }
    `;
    const wireFragment = `
      precision highp float;
      uniform vec2 uCamera;
      uniform float uAltitude;
      uniform float uCut;
      uniform float uOuter;
      varying vec3 vWorld;
      void main() {
        float d=max(max(abs(vWorld.x-uCamera.x),abs(vWorld.z-uCamera.y)),uAltitude);
        if(d<uCut || d>=uOuter) discard;
        gl_FragColor=vec4(0.04,0.09,0.07,0.42);
      }
    `;

    for (let tz = 0; tz < this.tilesPerSide; tz++) {
      for (let tx = 0; tx < this.tilesPerSide; tx++) {
        const geometry = this.createTileGeometry(tx, tz);
        const wireGeometry = this.createTileWireGeometry(tx, tz);
        this.geometries.push(geometry);
        this.wireGeometries.push(wireGeometry);
      }
    }

    const halfGrid = this.gridSize / 2;
    for (let level = 0; level < this.levels; level++) {
      const step = this.baseCellSize * 2 ** level;
      const half = halfGrid * this.baseCellSize * 2 ** level;
      const outer = half - 2 * step;
      const cut = level > 0 ? (halfGrid * this.baseCellSize * 2 ** (level - 1)) - 2 * (step / 2) : 0;
      const common = {
        uCamera: this.uniforms.uCamera,
        uAltitude: this.uniforms.uAltitude,
        uStep: { value: step },
        uHalf: { value: half },
        uCut: { value: cut },
        uOuter: { value: level === this.levels - 1 ? 1e9 : outer },
        uFogColor: this.uniforms.uFogColor,
        uFogNear: this.uniforms.uFogNear,
        uFogFar: this.uniforms.uFogFar,
        uBaseColor: { value: new THREE.Color(blueprint.terrainColor) }
      };
      const material = new THREE.ShaderMaterial({
        uniforms: common, vertexShader, fragmentShader, side: THREE.DoubleSide
      });
      const wireMaterial = new THREE.ShaderMaterial({
        uniforms: common, vertexShader, fragmentShader: wireFragment,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
      });
      const tiles: Array<{ mesh: THREE.Mesh; wire: THREE.LineSegments; ox: number; oz: number }> = [];
      for (let i = 0; i < this.geometries.length; i++) {
        const tx = i % this.tilesPerSide;
        const tz = Math.floor(i / this.tilesPerSide);
        const ox = tx * this.tileSize - halfGrid;
        const oz = tz * this.tileSize - halfGrid;
        const mesh = new THREE.Mesh(this.geometries[i], material);
        const wire = new THREE.LineSegments(this.wireGeometries[i], wireMaterial);
        mesh.scale.set(step, 1, step);
        wire.scale.set(step, 1, step);
        mesh.frustumCulled = false;
        wire.frustumCulled = false;
        this.group.add(mesh, wire);
        tiles.push({ mesh, wire, ox, oz });
      }
      this.rings.push({ step, half, cut, outer, tiles, material, wireMaterial });
    }
  }

  private createTileWireGeometry(tx: number, tz: number): THREE.BufferGeometry {
    const side = this.tileSize + 1;
    const positions = new Float32Array(side * side * 3);
    const indices: number[] = [];
    const ox = tx * this.tileSize - this.gridSize / 2;
    const oz = tz * this.tileSize - this.gridSize / 2;
    for (let z = 0; z < side; z++) {
      for (let x = 0; x < side; x++) {
        const i = (z * side + x) * 3;
        positions[i] = ox + x;
        positions[i + 2] = oz + z;
        const vertex = z * side + x;
        if (x < this.tileSize) indices.push(vertex, vertex + 1);
        if (z < this.tileSize) indices.push(vertex, vertex + side);
      }
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
    for (let z = 0; z < side; z++) {
      for (let x = 0; x < side; x++) {
        const i = (z * side + x) * 3;
        positions[i] = ox + x;
        positions[i + 2] = oz + z;
      }
    }
    for (let z = 0; z < this.tileSize; z++) {
      for (let x = 0; x < this.tileSize; x++) {
        const a = z * side + x;
        const b = a + 1;
        const c = a + side;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    return geometry;
  }
}
