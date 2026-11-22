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

const BASE_TILES = 4;
const MAX_LEVELS = 6;
const SUBDIVISIONS_PER_TILE = 4;

function makeSquareLevel(extent:number, level:number) {
  const positions:number[]=[];
  const indices:number[]=[];
  const linePositions:number[]=[];
  const lineSet=new Set<string>();
  const vertexMap=new Map<string,number>();
  const tilesPerSide=BASE_TILES*Math.pow(2,level);
  const segments=tilesPerSide*SUBDIVISIONS_PER_TILE;
  const step=extent*2/segments;
  const inner=level===0?0:extent*.5;

  const vertex=(x:number,z:number)=>{
    const key=`${x.toFixed(5)},${z.toFixed(5)}`;
    const old=vertexMap.get(key);
    if(old!==undefined)return old;
    const index=positions.length/3;
    positions.push(x,0,z);
    vertexMap.set(key,index);
    return index;
  };
  const addLine=(ax:number,az:number,bx:number,bz:number)=>{
    const a=`${ax.toFixed(5)},${az.toFixed(5)}`;
    const b=`${bx.toFixed(5)},${bz.toFixed(5)}`;
    const key=a<b?`${a}|${b}`:`${b}|${a}`;
    if(lineSet.has(key))return;
    lineSet.add(key);
    linePositions.push(ax,0,az,bx,0,bz);
  };

  for(let z=0;z<segments;z++){
    for(let x=0;x<segments;x++){
      const x0=-extent+x*step,x1=x0+step;
      const z0=-extent+z*step,z1=z0+step;
      const cx=(x0+x1)*.5,cz=(z0+z1)*.5;
      // Each level is a square ring; the next finer level owns its centre.
      if(level>0&&Math.abs(cx)<inner&&Math.abs(cz)<inner)continue;
      const a=vertex(x0,z0),b=vertex(x1,z0),c=vertex(x1,z1),d=vertex(x0,z1);
      indices.push(a,b,c,a,c,d);
      addLine(x0,z0,x1,z0);addLine(x1,z0,x1,z1);
      addLine(x1,z1,x0,z1);addLine(x0,z1,x0,z0);
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
  private globeGrid:THREE.Mesh;
  private globeGridMaterial:THREE.ShaderMaterial;
  private gridVisible=true;
  private lastAltitude=-1;
  private currentExtent=0;
  private activeRingCount=4;
  private pendingRingCount=0;
  private pendingRingFrames=0;

  constructor(private readonly scene:THREE.Scene,public settings:ClipmapSettings) {
    const uniforms={
      uTime:{value:0},
      uAmplitude:{value:settings.amplitude},
      uFrequency:{value:settings.frequency},
      uRadius:{value:settings.radius},
      uClipExtent:{value:1},
      uDetailFade:{value:0},
      uTexelWorldSize:{value:1},
      uGridColor:{value:new THREE.Color(0x22d3ee)},
      uSunPosition:{value:new THREE.Vector3(0,0,0)},
      uPatchOpacity:{value:1},
      uGlobeGridOpacity:{value:0}
    };
    const vertexShader=`
      uniform float uRadius;
      varying vec3 vRadial;
      varying vec3 vWorldPosition;
      varying vec3 vViewPosition;
      ${terrainBlueprint.shader}
      void main(){
        vec2 plane=position.xz;
        vec3 radial=normalize(vec3(plane.x,uRadius,plane.y));
        vec3 worldRadial=normalize(mat3(modelMatrix)*radial);
        // Sample terrain in planet-local coordinates so body motion cannot change the terrain direction.
        vec3 displaced=displacePlanet(radial*uRadius,uRadius);
        float height=length(displaced)-uRadius;
        vec3 localPosition=radial*(uRadius+height+position.y);
        vec3 worldPosition=(modelMatrix*vec4(localPosition,1.0)).xyz;
        vHeight=height;
        vRadial=worldRadial;
        vWorldPosition=worldPosition;
        // Compose camera-relative coordinates on the CPU before GPU upload.
        vec3 viewPosition=(modelViewMatrix*vec4(localPosition,1.0)).xyz;
        vViewPosition=viewPosition;
        gl_Position=projectionMatrix*vec4(viewPosition,1.0);
      }`;
    const fragmentShader=`
      varying vec3 vRadial;
      varying vec3 vWorldPosition;
      varying vec3 vViewPosition;
      varying float vHeight;
      uniform float uAmplitude;
      uniform float uRadius;
      uniform float uTexelWorldSize;
      uniform vec3 uSunPosition;
      uniform float uPatchOpacity;
      float hash3(vec3 p){
        p=fract(p*.3183099+vec3(.13,.17,.11));p*=17.0;
        return fract(p.x*p.y*p.z*(p.x+p.y+p.z));
      }
      float noise3(vec3 p){
        vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        float a=mix(hash3(i),hash3(i+vec3(1,0,0)),f.x);
        float b=mix(hash3(i+vec3(0,1,0)),hash3(i+vec3(1,1,0)),f.x);
        float c=mix(hash3(i+vec3(0,0,1)),hash3(i+vec3(1,0,1)),f.x);
        float d=mix(hash3(i+vec3(0,1,1)),hash3(i+vec3(1,1,1)),f.x);
        return mix(mix(a,b,f.y),mix(c,d,f.y),f.z);
      }
      void main(){
        // Derivatives in camera-relative view space avoid precision loss at large world coordinates.
        vec3 n=normalize(cross(dFdx(vViewPosition),dFdy(vViewPosition)));
        if(dot(n,vRadial)<0.0)n=-n;
        vec3 toSun=normalize(uSunPosition-vWorldPosition);
        float light=max(dot(n,toSun),0.0);
        float h=vHeight/max(uAmplitude*.001,.001);
        // A world-space quantized sample behaves like a repeating pixel texture.
        // Its texel size is derived from the base tile, so adding outer LOD rings
        // never stretches the pattern across the larger clipmap footprint.
        vec3 texelCoord=floor(vRadial*uRadius/max(uTexelWorldSize,.0001));
        float pixel=hash3(texelCoord);
        float macro=noise3(vRadial*uRadius*.008);
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
        color=mix(color,dryland,smoothstep(.18,.38,h));
        color=mix(color,highRock,smoothstep(.42,.62,h));
        color=mix(color,snow,smoothstep(.72,.95,h));
        color*=.94+pixel*.12;
        color*=.32+light*.88;
        gl_FragColor=vec4(color,uPatchOpacity);
      }`;
    this.material=new THREE.ShaderMaterial({
      uniforms,vertexShader,fragmentShader,side:THREE.DoubleSide,
      depthTest:true,depthWrite:false,transparent:true,
      polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1
    });

    // A complete spherical proxy takes over at orbital distances. The square
    // tangent clipmap is never stretched into a disk or asked to cover a globe.
    this.globeMaterial=new THREE.ShaderMaterial({
      uniforms:{...uniforms,uPatchOpacity:{value:1}},
      vertexShader:`
        uniform float uRadius;
        varying vec3 vRadial;
        varying vec3 vWorldPosition;
        varying vec3 vViewPosition;
        ${terrainBlueprint.shader}
        void main(){
          vec3 radial=normalize(position);
          vec3 worldRadial=normalize(mat3(modelMatrix)*radial);
          vec3 displaced=displacePlanet(radial*uRadius,uRadius);
          float height=length(displaced)-uRadius;
          vec3 localPosition=radial*(uRadius+height);
          vec4 world=modelMatrix*vec4(localPosition,1.0);
          vec3 viewPosition=(modelViewMatrix*vec4(localPosition,1.0)).xyz;
          vRadial=worldRadial;vHeight=height;vWorldPosition=world.xyz;
          vViewPosition=viewPosition;
          gl_Position=projectionMatrix*vec4(viewPosition,1.0);
        }`,
      fragmentShader,
      side:THREE.FrontSide,depthTest:true,depthWrite:true
    });
    this.globe=new THREE.Mesh(
      new THREE.SphereGeometry(settings.radius,192,128),
      this.globeMaterial
    );
    this.globe.frustumCulled=false;
    this.globe.visible=false;
    this.globeGridMaterial=new THREE.ShaderMaterial({
      uniforms:{uGridColor:{value:new THREE.Color(0x22d3ee)},uGlobeGridOpacity:{value:0}},
      vertexShader:this.globeMaterial.vertexShader,
      fragmentShader:`uniform vec3 uGridColor;uniform float uGlobeGridOpacity;void main(){gl_FragColor=vec4(uGridColor,.34*uGlobeGridOpacity);}`,
      transparent:true,depthTest:true,depthWrite:false,
      wireframe:true,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1
    });
    this.globeGrid=new THREE.Mesh(this.globe.geometry,this.globeGridMaterial);
    this.globeGrid.name='GlobeGrid';
    this.globeGrid.frustumCulled=false;
    this.globeGrid.visible=false;
    this.scene.add(this.group);
    this.group.add(this.globe,this.globeGrid);
    this.rebuild(this.calculateExtent(15000-settings.radius),4);
  }

  private calculateExtent(altitude:number){
    return THREE.MathUtils.clamp(Math.max(2,altitude*2),2,this.settings.radius*.95);
  }

  private rebuild(totalExtent:number,requestedCount=this.activeRingCount){
    for(const level of this.levels){
      this.group.remove(level.mesh);this.group.remove(level.lines);
      level.mesh.geometry.dispose();level.lines.geometry.dispose();level.gridMaterial.dispose();
    }
    this.levels=[];
    const count=THREE.MathUtils.clamp(Math.round(requestedCount),1,Math.min(MAX_LEVELS,Math.round(this.settings.rings)));
    this.activeRingCount=count;
    const baseExtent=totalExtent/Math.pow(2,count-1);
    const palette=[0x22d3ee,0xf59e0b,0xa78bfa,0x4ade80,0xfb7185,0xfacc15];
    for(let i=0;i<count;i++){
      const extent=baseExtent*Math.pow(2,i);
      const geometry=makeSquareLevel(extent,i);
      const mesh=new THREE.Mesh(geometry.surface,this.material);
      mesh.frustumCulled=false;mesh.renderOrder=i;
      const gridMaterial=new THREE.ShaderMaterial({
        uniforms:{...this.material.uniforms,uGridColor:{value:new THREE.Color(palette[i%palette.length])}},
        vertexShader:this.material.vertexShader,
        fragmentShader:`uniform vec3 uGridColor;uniform float uPatchOpacity;void main(){gl_FragColor=vec4(uGridColor,.86*uPatchOpacity);}`,
        transparent:true,depthTest:true,depthWrite:false,
        polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1,
        side:THREE.DoubleSide
      });
      const lines=new THREE.LineSegments(geometry.grid,gridMaterial);
      lines.frustumCulled=false;lines.renderOrder=100+i;lines.visible=this.gridVisible;
      this.group.add(mesh,lines);
      this.levels.push({mesh,lines,extent,level:i,gridMaterial});
    }
    this.currentExtent=totalExtent;
    this.material.uniforms.uClipExtent.value=totalExtent;
    this.globeMaterial.uniforms.uClipExtent.value=totalExtent;
    // Four texels per smallest tile: 4x4 tiles -> 16x16 texel pattern.
    // Doubling the ring tile count doubles total pattern resolution without
    // changing the world-space size of an individual texel.
    this.material.uniforms.uTexelWorldSize.value=Math.max(baseExtent/8,.0001);
    this.globeMaterial.uniforms.uTexelWorldSize.value=Math.max(baseExtent/8,.0001);
  }

  update(camera:THREE.PerspectiveCamera,time:number,planetCenter=new THREE.Vector3()){
    if(!this.group.visible)return;
    this.material.uniforms.uTime.value=time;
    this.globeMaterial.uniforms.uTime.value=time;
    const cameraFromCenter=camera.position.clone().sub(planetCenter);
    const radial=cameraFromCenter.clone().normalize();
    // Clipmaps live under their celestial body node. Convert the body's
    // world centre and the world tangent frame into that parent's local space.
    this.group.position.copy(this.group.parent
      ?this.group.parent.worldToLocal(planetCenter.clone())
      :planetCenter);
    const northReference=Math.abs(radial.dot(new THREE.Vector3(0,1,0)))>.995
      ?new THREE.Vector3(0,0,1):new THREE.Vector3(0,1,0);
    const east=new THREE.Vector3().crossVectors(northReference,radial).normalize();
    const south=new THREE.Vector3().crossVectors(east,radial).normalize();
    const frame=new THREE.Matrix4().makeBasis(east,radial,south);
    const worldFrame=new THREE.Quaternion().setFromRotationMatrix(frame);
    const parentFrame=new THREE.Quaternion();
    if(this.group.parent)this.group.parent.getWorldQuaternion(parentFrame);
    this.group.quaternion.copy(parentFrame.invert().multiply(worldFrame));

    const altitude=Math.max(0,cameraFromCenter.length()-this.settings.radius);
    this.material.uniforms.uDetailFade.value=THREE.MathUtils.smoothstep(altitude,250,25000);
    this.globeMaterial.uniforms.uDetailFade.value=THREE.MathUtils.smoothstep(altitude,250,25000);
    const nextExtent=this.calculateExtent(altitude);
    const extentChanged=Math.abs(nextExtent-this.currentExtent)>Math.max(.1,this.currentExtent*.08);
    const maxRings=Math.min(MAX_LEVELS,Math.round(this.settings.rings));
    const desiredRings=THREE.MathUtils.clamp(
      Math.ceil(6-Math.log2(1+altitude/100)),1,maxRings
    );
    if(desiredRings===this.activeRingCount){
      this.pendingRingCount=0;this.pendingRingFrames=0;
    }else if(desiredRings!==this.pendingRingCount){
      this.pendingRingCount=desiredRings;this.pendingRingFrames=1;
    }else this.pendingRingFrames++;
    const ringCountStable=this.pendingRingFrames>=8;
    if(extentChanged||ringCountStable){
      this.rebuild(nextExtent,ringCountStable?desiredRings:this.activeRingCount);
      if(ringCountStable){this.pendingRingCount=0;this.pendingRingFrames=0;}
    }
    this.lastAltitude=altitude;

    // Cross-fade ownership by distance: surface patch near the player,
    // whole displaced sphere in orbit/space.
    // Keep one displaced spherical surface throughout ascent. Local clipmap
    // detail fades gradually while the matching spherical grid fades in.
    const globeBlend=THREE.MathUtils.smoothstep(
      altitude,this.settings.radius*.12,this.settings.radius*.8
    );
    this.globe.visible=true;
    this.material.uniforms.uPatchOpacity.value=1-globeBlend;
    this.globeMaterial.uniforms.uPatchOpacity.value=1;
    this.globeGridMaterial.uniforms.uGlobeGridOpacity.value=globeBlend;
    this.globeGrid.visible=this.gridVisible;
    for(const level of this.levels){
      level.mesh.visible=true;
      level.lines.visible=this.gridVisible;
    }
    this.globeMaterial.uniforms.uAmplitude.value=this.settings.amplitude;
    this.globeMaterial.uniforms.uFrequency.value=this.settings.frequency;
    this.globeMaterial.uniforms.uRadius.value=this.settings.radius;
    this.material.uniforms.uAmplitude.value=this.settings.amplitude;
    this.material.uniforms.uFrequency.value=this.settings.frequency;
    this.material.uniforms.uRadius.value=this.settings.radius;
  }

  setSettings(patch:Partial<ClipmapSettings>){
    const rebuild=patch.rings!==undefined||patch.baseSegments!==undefined||
      patch.ringGrowth!==undefined||patch.radius!==undefined;
    Object.assign(this.settings,patch);
    for(const material of [this.material,this.globeMaterial]){
      material.uniforms.uAmplitude.value=this.settings.amplitude;
      material.uniforms.uFrequency.value=this.settings.frequency;
      material.uniforms.uRadius.value=this.settings.radius;
    }
    if(rebuild){
      this.globe.geometry.dispose();
      this.globe.geometry=new THREE.SphereGeometry(this.settings.radius,192,128);
      this.globeGrid.geometry=this.globe.geometry;
      this.rebuild(this.calculateExtent(Math.max(0,this.lastAltitude)),this.activeRingCount);
    }
  }

  setGridVisible(visible:boolean){
    this.gridVisible=visible;
    this.globeGrid.visible=visible;
    for(const level of this.levels)level.lines.visible=visible&&level.mesh.visible;
  }

  get lod(){return BASE_TILES*Math.pow(2,this.activeRingCount-1);}
  get triangleCount(){
    return this.levels.reduce((sum,level)=>{
      const index=level.mesh.geometry.index;
      return sum+(index?index.count/3:0);
    },0)+(this.globe.visible?this.globe.geometry.index?.count/3||0:0);
  }
  get activeLevels(){return this.activeRingCount;}

  dispose(){
    for(const level of this.levels){
      level.mesh.geometry.dispose();level.lines.geometry.dispose();level.gridMaterial.dispose();
    }
    this.globe.geometry.dispose();this.globeMaterial.dispose();this.globeGridMaterial.dispose();this.material.dispose();
    this.scene.remove(this.group);
  }
}
