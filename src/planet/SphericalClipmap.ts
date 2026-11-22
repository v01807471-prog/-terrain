import * as THREE from 'three';
import { terrainBlueprint } from './TerrainBlueprint';

export interface ClipmapSettings {
  rings:number;
  baseSegments:number;
  ringGrowth:number;
  radius:number;
  amplitude:number;
  frequency:number;
}

type Level = {
  mesh:THREE.Mesh;
  lines:THREE.LineSegments;
  extent:number;
  level:number;
};

const GRID_SEGMENTS = 64;
const MIN_EXTENT = 40;

function makeSquareLevel(extent:number, level:number) {
  const positions:number[] = [];
  const indices:number[] = [];
  const linePositions:number[] = [];
  const step = extent * 2 / GRID_SEGMENTS;
  const inner = level === 0 ? 0 : extent * 0.5;

  for (let z=0; z<GRID_SEGMENTS; z++) {
    for (let x=0; x<GRID_SEGMENTS; x++) {
      const x0=-extent+x*step;
      const x1=x0+step;
      const z0=-extent+z*step;
      const z1=z0+step;
      const cx=(x0+x1)*0.5;
      const cz=(z0+z1)*0.5;

      // Each outer level is a square ring. Its central square is reserved
      // for the next, higher-resolution level.
      if (level>0 && Math.abs(cx)<inner && Math.abs(cz)<inner) continue;

      const base=positions.length/3;
      positions.push(
        x0,0,z0,
        x1,0,z0,
        x1,0,z1,
        x0,0,z1
      );
      indices.push(base,base+1,base+2, base,base+2,base+3);

      // Draw only the four square edges; never expose the mesh's
      // internal triangulation diagonal in the debug grid.
      linePositions.push(
        x0,0,z0, x1,0,z0,
        x1,0,z0, x1,0,z1,
        x1,0,z1, x0,0,z1,
        x0,0,z1, x0,0,z0
      );
    }
  }

  const surface=new THREE.BufferGeometry();
  surface.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  surface.setIndex(indices);
  surface.computeVertexNormals();

  const grid=new THREE.BufferGeometry();
  grid.setAttribute('position',new THREE.Float32BufferAttribute(linePositions,3));
  return {surface,grid};
}

export class SphericalClipmap {
  readonly group=new THREE.Group();
  private levels:Level[]=[];
  private material:THREE.ShaderMaterial;
  private gridMaterial:THREE.ShaderMaterial;
  private lastAltitude=-1;
  private currentExtent=0;

  constructor(private readonly scene:THREE.Scene,public settings:ClipmapSettings) {
    const uniforms={
      uTime:{value:0},
      uAmplitude:{value:settings.amplitude},
      uFrequency:{value:settings.frequency},
      uRadius:{value:settings.radius}
    };

    const vertexShader=`
      varying vec3 vWorldNormal;
      ${terrainBlueprint.shader}

      void main() {
        // position.xz is a flat square clipmap coordinate. Map that tangent
        // plane to a spherical cap using the exponential-map projection.
        vec2 plane=position.xz;
        float planarDistance=length(plane);
        float angle=planarDistance/uRadius;
        vec2 tangent=planarDistance>0.00001 ? plane/planarDistance : vec2(0.0);

        float s=sin(angle);
        vec3 radial=normalize(vec3(tangent.x*s, cos(angle), tangent.y*s));

        // Terrain height is sampled in planet-local radial coordinates and
        // is always applied along the local surface normal, never world-up.
        vec3 displaced=displacePlanet(radial*uRadius,uRadius);
        float height=length(displaced)-uRadius;
        vec3 surfacePosition=radial*(uRadius+height);

        vHeight=height;
        vWorldNormal=normalize(mat3(modelMatrix)*radial);

        vec4 mvPosition=modelViewMatrix*vec4(surfacePosition,1.0);
        gl_Position=projectionMatrix*mvPosition;
      }
    `;

    this.material=new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader:`
        varying vec3 vWorldNormal;
        varying float vHeight;
        void main() {
          vec3 lightDirection=normalize(vec3(.4,.8,.3));
          float light=max(dot(normalize(vWorldNormal),lightDirection),0.0);
          vec3 ocean=vec3(.025,.10,.17);
          vec3 land=vec3(.16,.31,.17);
          vec3 rock=vec3(.55,.54,.46);
          vec3 color=mix(ocean,land,smoothstep(-90.0,40.0,vHeight));
          color=mix(color,rock,smoothstep(420.0,850.0,vHeight));
          color*=.3+light*.85;
          gl_FragColor=vec4(color,1.0);
        }
      `,
      side:THREE.DoubleSide
    });

    this.gridMaterial=new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader:`
        void main() {
          gl_FragColor=vec4(0.18,0.82,1.0,0.82);
        }
      `,
      transparent:true,
      opacity:.82,
      depthWrite:false,
      side:THREE.DoubleSide
    });

    this.scene.add(this.group);
    this.rebuild(this.calculateExtent(15000-this.settings.radius));
  }

  private calculateExtent(altitude:number) {
    // The full clipmap footprint follows camera-to-ground distance.
    // It is capped below a hemisphere so the square-to-sphere projection
    // cannot wrap around the back side of the planet.
    return THREE.MathUtils.clamp(
      Math.max(MIN_EXTENT,altitude*2.0),
      MIN_EXTENT,
      this.settings.radius*1.25
    );
  }

  private rebuild(totalExtent:number) {
    for (const level of this.levels) {
      this.group.remove(level.mesh);
      this.group.remove(level.lines);
      level.mesh.geometry.dispose();
      level.lines.geometry.dispose();
    }
    this.levels=[];

    const count=THREE.MathUtils.clamp(Math.round(this.settings.rings),1,16);
    const maxLevel=count-1;
    const baseExtent=totalExtent/Math.pow(2,maxLevel);

    for (let i=0;i<count;i++) {
      const extent=baseExtent*Math.pow(2,i);
      const geometry=makeSquareLevel(extent,i);
      const mesh=new THREE.Mesh(geometry.surface,this.material);
      mesh.frustumCulled=false;
      mesh.renderOrder=i;

      const lines=new THREE.LineSegments(geometry.grid,this.gridMaterial);
      lines.frustumCulled=false;
      lines.renderOrder=100+i;

      this.group.add(mesh,lines);
      this.levels.push({mesh,lines,extent,level:i});
    }
    this.currentExtent=totalExtent;
  }

  update(camera:THREE.PerspectiveCamera,time:number) {
    this.material.uniforms.uTime.value=time;

    // The clipmap's center is the radial point directly below the camera.
    const direction=camera.position.clone().normalize();
    const orientation=new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0,1,0),
      direction
    );
    this.group.quaternion.copy(orientation);

    const altitude=Math.max(0,camera.position.length()-this.settings.radius);
    const nextExtent=this.calculateExtent(altitude);
    const extentChanged=Math.abs(nextExtent-this.currentExtent)>Math.max(20,this.currentExtent*.08);
    const altitudeChanged=this.lastAltitude<0 ||
      Math.abs(altitude-this.lastAltitude)>Math.max(25,this.lastAltitude*.08);

    if (extentChanged || altitudeChanged) this.rebuild(nextExtent);
    this.lastAltitude=altitude;
  }

  setSettings(patch:Partial<ClipmapSettings>) {
    const rebuild=patch.rings!==undefined ||
      patch.baseSegments!==undefined ||
      patch.ringGrowth!==undefined ||
      patch.radius!==undefined;

    Object.assign(this.settings,patch);
    this.material.uniforms.uAmplitude.value=this.settings.amplitude;
    this.material.uniforms.uFrequency.value=this.settings.frequency;
    this.material.uniforms.uRadius.value=this.settings.radius;

    if (rebuild) {
      this.rebuild(this.calculateExtent(Math.max(0,this.lastAltitude)));
    }
  }

  get lod() {
    return GRID_SEGMENTS;
  }

  dispose() {
    for (const level of this.levels) {
      level.mesh.geometry.dispose();
      level.lines.geometry.dispose();
    }
    this.material.dispose();
    this.gridMaterial.dispose();
    this.scene.remove(this.group);
  }
}
