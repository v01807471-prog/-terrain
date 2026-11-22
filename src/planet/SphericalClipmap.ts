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
  gridMaterial:THREE.ShaderMaterial;
};

const GRID_SEGMENTS = 128;
const MIN_EXTENT = 40;

function makeSquareLevel(extent:number, level:number) {
  const positions:number[] = [];
  const indices:number[] = [];
  const linePositions:number[] = [];
  const lineSet=new Set<string>();
  const vertexMap=new Map<string,number>();
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

      // Share vertices between adjacent cells. Duplicating four vertices
      // per quad prevents smooth interpolation and creates visible faceting.
      const vertex=(vx:number,vz:number)=>{
        const key=`${vx.toFixed(5)},${vz.toFixed(5)}`;
        const existing=vertexMap.get(key);
        if(existing!==undefined) return existing;
        const index=positions.length/3;
        positions.push(vx,0,vz);
        vertexMap.set(key,index);
        return index;
      };
      const a=vertex(x0,z0), b=vertex(x1,z0), c=vertex(x1,z1), d=vertex(x0,z1);
      indices.push(a,b,c, a,c,d);

      // Draw only the four square edges; never expose the mesh's
      // internal triangulation diagonal in the debug grid.
      const addLine=(ax:number,az:number,bx:number,bz:number)=>{
        const a=`${ax.toFixed(5)},${az.toFixed(5)}`;
        const b=`${bx.toFixed(5)},${bz.toFixed(5)}`;
        const key=a<b?`${a}|${b}`:`${b}|${a}`;
        if(lineSet.has(key)) return;
        lineSet.add(key);
        linePositions.push(ax,0,az,bx,0,bz);
      };
      addLine(x0,z0,x1,z0);
      addLine(x1,z0,x1,z1);
      addLine(x1,z1,x0,z1);
      addLine(x0,z1,x0,z0);
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
  private globe:THREE.Mesh;
  private globeMaterial:THREE.ShaderMaterial;
  private gridVisible=true;
  private lastAltitude=-1;
  private currentExtent=0;
  private activeRingCount=4;

  constructor(private readonly scene:THREE.Scene,public settings:ClipmapSettings) {
    const uniforms={
      uTime:{value:0},
      uAmplitude:{value:settings.amplitude},
      uFrequency:{value:settings.frequency},
      uRadius:{value:settings.radius},
      uDetailFade:{value:0},
      uGridColor:{value:new THREE.Color(0x22d3ee)}
    };

    const vertexShader=`
      uniform float uRadius;
      varying vec3 vWorldNormal;
      varying vec3 vRadial;
      varying vec3 vWorldPosition;
      ${terrainBlueprint.shader}

      void main() {
        // Project the square clipmap's tangent-plane coordinates onto the
        // sphere with a gnomonic projection. Unlike a linear angle mapping,
        // this keeps every vertex on a smooth spherical cap and naturally
        // compresses larger distances toward the horizon.
        vec2 plane=position.xz;
        vec3 radial=normalize(vec3(plane.x, uRadius, plane.y));

        // Convert the clipmap-local direction into a fixed planet/world
        // direction BEFORE sampling terrain. This makes mountains geographic
        // features of the planet instead of features glued to the moving patch.
        vec3 worldRadial=normalize(mat3(modelMatrix)*radial);
        vec3 displaced=displacePlanet(worldRadial*uRadius,uRadius);
        float height=length(displaced)-uRadius;
        vec3 worldPosition=worldRadial*(uRadius+height+position.y);

        vHeight=height;
        vRadial=worldRadial;
        vWorldNormal=worldRadial;
        vWorldPosition=worldPosition;

        gl_Position=projectionMatrix*viewMatrix*vec4(worldPosition,1.0);
      }
    `;

    this.material=new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader:`
        varying vec3 vWorldNormal;
        varying vec3 vRadial;
        varying vec3 vWorldPosition;
        varying float vHeight;
        uniform float uAmplitude;

        float hash3(vec3 p) {
          p=fract(p*.3183099+vec3(.13,.17,.11));
          p*=17.0;
          return fract(p.x*p.y*p.z*(p.x+p.y+p.z));
        }
        float noise3(vec3 p) {
          vec3 i=floor(p), f=fract(p);
          f=f*f*(3.0-2.0*f);
          float a=mix(hash3(i),hash3(i+vec3(1,0,0)),f.x);
          float b=mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x);
          float c=mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x);
          float d=mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x);
          return mix(mix(a,b,f.y),mix(c,d,f.y),f.z);
        }

        void main() {
          // Derive the actual displaced terrain normal per fragment. Using
          // only the radial direction lights the planet like a smooth ball
          // and hides the mountain slopes at orbital viewing distances.
          vec3 n=normalize(cross(dFdx(vWorldPosition),dFdy(vWorldPosition)));
          if(dot(n,vRadial)<0.0) n=-n;
          float light=max(dot(n,normalize(vec3(.4,.8,.3))),0.0);
          float macro=noise3(vRadial*34.0);
          float detail=noise3(vRadial*180.0);
          float micro=noise3(vRadial*720.0);
          float h=vHeight/max(uAmplitude*.001,0.001);

          vec3 deepOcean=vec3(.012,.045,.085);
          vec3 shallowOcean=vec3(.025,.19,.23);
          vec3 lowland=vec3(.12,.27,.12);
          vec3 forest=vec3(.16,.34,.16);
          vec3 dryland=vec3(.39,.34,.20);
          vec3 highRock=vec3(.43,.42,.38);
          vec3 snow=vec3(.82,.84,.80);

          vec3 color=mix(deepOcean,shallowOcean,smoothstep(-.72,-.25,h));
          color=mix(color,lowland,smoothstep(-.28,-.12,h));
          color=mix(color,forest,smoothstep(-.10,.12,h)*(.65+macro*.35));
          color=mix(color,dryland,smoothstep(.18,.38,h)*(.65+detail*.35));
          color=mix(color,highRock,smoothstep(.42,.62,h));
          color=mix(color,snow,smoothstep(.72,.95,h));

          float textureMix=(macro-.5)*.22+(detail-.5)*.12+(micro-.5)*.055;
          color*=1.0+textureMix;
          color*=.24+light*.96;
          gl_FragColor=vec4(color,1.0);
        }
      `,
      side:THREE.DoubleSide,
      depthTest:true,
      depthWrite:true
    });

    // A complete low-frequency globe provides the round planetary silhouette.
    // The clipmap patches are only local high-detail overlays, never the whole planet.
    this.globeMaterial=new THREE.ShaderMaterial({
      uniforms:{
        uTime:{value:0},
        uAmplitude:{value:settings.amplitude},
        uFrequency:{value:settings.frequency},
        uRadius:{value:settings.radius},
        uDetailFade:{value:1}
      },
      vertexShader:`
        uniform float uRadius;
        varying vec3 vGlobeRadial;
        varying float vGlobeHeight;
        ${terrainBlueprint.shader}
        void main(){
          vec3 radial=normalize(position);
          vec3 displaced=displacePlanet(radial*uRadius,uRadius);
          vGlobeRadial=radial;
          vGlobeHeight=length(displaced)-uRadius;
          vec3 worldPosition=radial*length(displaced);
          gl_Position=projectionMatrix*modelViewMatrix*vec4(worldPosition,1.0);
        }
      `,
      fragmentShader:`
        uniform float uAmplitude;
        varying vec3 vGlobeRadial;
        varying float vGlobeHeight;
        void main(){
          float h=clamp(vGlobeHeight/max(uAmplitude*.001,.001),-1.0,1.0);
          float land=smoothstep(-.08,.12,h);
          vec3 ocean=vec3(.018,.075,.12);
          vec3 lowland=vec3(.12,.25,.12);
          vec3 highland=vec3(.32,.30,.22);
          vec3 color=mix(ocean,lowland,land);
          color=mix(color,highland,smoothstep(.35,.8,h));
          float light=.28+.72*max(dot(normalize(vGlobeRadial),normalize(vec3(.4,.8,.3))),0.0);
          gl_FragColor=vec4(color*light,1.0);
        }
      `,
      side:THREE.FrontSide,
      depthTest:true,
      depthWrite:true
    });
    const globeGeometry=new THREE.SphereGeometry(settings.radius,256,128);
    this.globe=new THREE.Mesh(globeGeometry,this.globeMaterial);
    this.globe.frustumCulled=false;
    this.globe.renderOrder=-10;
    this.scene.add(this.globe);

    this.scene.add(this.group);
    this.rebuild(this.calculateExtent(15000-this.settings.radius),4);
  }

  private calculateExtent(altitude:number) {
    // The full clipmap footprint follows camera-to-ground distance.
    // It is capped below a hemisphere so the square-to-sphere projection
    // cannot wrap around the back side of the planet.
    return THREE.MathUtils.clamp(
      Math.max(MIN_EXTENT,altitude*2.0),
      MIN_EXTENT,
      this.settings.radius*0.95
    );
  }

  private rebuild(totalExtent:number, requestedCount=this.activeRingCount) {
    for (const level of this.levels) {
      this.group.remove(level.mesh);
      this.group.remove(level.lines);
      level.mesh.geometry.dispose();
      level.lines.geometry.dispose();
      level.gridMaterial.dispose();
    }
    this.levels=[];

    const count=THREE.MathUtils.clamp(Math.round(requestedCount),1,Math.min(8,Math.round(this.settings.rings)));
    this.activeRingCount=count;
    const maxLevel=count-1;
    const baseExtent=totalExtent/Math.pow(2,maxLevel);

    for (let i=0;i<count;i++) {
      const extent=baseExtent*Math.pow(2,i);
      const geometry=makeSquareLevel(extent,i);
      const mesh=new THREE.Mesh(geometry.surface,this.material);
      mesh.frustumCulled=false;
      mesh.renderOrder=i;

      const palette=[0x22d3ee,0xf59e0b,0xa78bfa,0x4ade80,0xfb7185,0xfacc15,0x60a5fa,0xe879f9];
      const gridMaterial=new THREE.ShaderMaterial({
        uniforms:{...this.material.uniforms,uGridColor:{value:new THREE.Color(palette[i%palette.length])}},
        vertexShader:this.material.vertexShader,
        fragmentShader:`
          uniform vec3 uGridColor;
          void main() {
            gl_FragColor=vec4(uGridColor,0.86);
          }
        `,
        transparent:true,
        depthTest:true,
        depthWrite:false,
        polygonOffset:true,
        polygonOffsetFactor:-1,
        polygonOffsetUnits:-1,
        side:THREE.DoubleSide
      });
      const lines=new THREE.LineSegments(geometry.grid,gridMaterial);
      lines.frustumCulled=false;
      lines.renderOrder=100+i;
      lines.visible=this.gridVisible;

      this.group.add(mesh,lines);
      this.levels.push({mesh,lines,extent,level:i,gridMaterial});
    }
    this.currentExtent=totalExtent;
  }

  update(camera:THREE.PerspectiveCamera,time:number) {
    this.material.uniforms.uTime.value=time;

    // Anchor the patch to the player's spherical coordinates. Build a stable
    // tangent frame from planet north so the patch does not acquire arbitrary
    // twist as the camera moves around the globe.
    const radial=camera.position.clone().normalize();
    const northReference=Math.abs(radial.dot(new THREE.Vector3(0,1,0)))>.995
      ? new THREE.Vector3(0,0,1)
      : new THREE.Vector3(0,1,0);
    const east=new THREE.Vector3().crossVectors(northReference,radial).normalize();
    const south=new THREE.Vector3().crossVectors(east,radial).normalize();
    const frame=new THREE.Matrix4().makeBasis(east,radial,south);
    this.group.quaternion.setFromRotationMatrix(frame);

    const altitude=Math.max(0,camera.position.length()-this.settings.radius);
    // At orbital distances, suppress fine displacement octaves smoothly;
    // retain the broad-scale shape so mountains do not pop or collapse.
    this.material.uniforms.uDetailFade.value=THREE.MathUtils.smoothstep(altitude,250,25000);
    const nextExtent=this.calculateExtent(altitude);
    const extentChanged=Math.abs(nextExtent-this.currentExtent)>Math.max(20,this.currentExtent*.08);
    const altitudeChanged=this.lastAltitude<0 ||
      Math.abs(altitude-this.lastAltitude)>Math.max(25,this.lastAltitude*.08);

    // Pick the number of nested levels from projected cell size.
    // Avoid keeping a level whose cells are only a few screen pixels wide.
    const viewportHeight=Math.max(1, window.innerHeight);
    const worldPerPixel=(2*Math.max(altitude,1)*Math.tan(THREE.MathUtils.degToRad(camera.fov*.5)))/viewportHeight;
    const outerCellPixels=(nextExtent*2/GRID_SEGMENTS)/Math.max(worldPerPixel,1e-4);
    const desiredRings=THREE.MathUtils.clamp(
      Math.ceil(Math.log2(Math.max(1,outerCellPixels/3)))+1,
      1,
      Math.min(8,Math.round(this.settings.rings))
    );

    if (extentChanged || altitudeChanged || desiredRings!==this.activeRingCount) this.rebuild(nextExtent,desiredRings);
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
    this.globeMaterial.uniforms.uAmplitude.value=this.settings.amplitude;
    this.globeMaterial.uniforms.uFrequency.value=this.settings.frequency;
    this.globeMaterial.uniforms.uRadius.value=this.settings.radius;

    if (rebuild) {
      this.rebuild(this.calculateExtent(Math.max(0,this.lastAltitude)),this.activeRingCount);
    }
  }

  setGridVisible(visible:boolean) {
    this.gridVisible=visible;
    for(const level of this.levels) level.lines.visible=visible;
  }

  get lod() {
    return GRID_SEGMENTS;
  }

  get triangleCount() {
    return this.levels.reduce((sum,level)=>{
      const index=level.mesh.geometry.index;
      return sum+(index ? index.count/3 : 0);
    },0);
  }

  get activeLevels() {
    return this.activeRingCount;
  }

  dispose() {
    for (const level of this.levels) {
      level.mesh.geometry.dispose();
      level.lines.geometry.dispose();
      level.gridMaterial.dispose();
    }
    this.material.dispose();
    this.globe.geometry.dispose();
    this.globeMaterial.dispose();
    this.scene.remove(this.globe);
    this.scene.remove(this.group);
  }
}
