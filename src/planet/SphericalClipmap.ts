import * as THREE from 'three';
import { terrainBlueprint } from './TerrainBlueprint';

export interface ClipmapSettings { rings:number; baseSegments:number; ringGrowth:number; radius:number; amplitude:number; frequency:number; }
type Ring = { mesh:THREE.Mesh; level:number; segments:number; inner:number; outer:number };

function makeAnnulus(inner:number,outer:number,segments:number,radialSteps:number,radius:number){
  const vertices:number[]=[];const indices:number[]=[];const uvs:number[]=[];
  for(let r=0;r<=radialSteps;r++){
    const t=r/radialSteps,dist=inner+(outer-inner)*t;
    for(let a=0;a<=segments;a++){
      const angle=a/segments*Math.PI*2;
      vertices.push(Math.cos(angle)*dist,0,Math.sin(angle)*dist);
      uvs.push(a/segments,t);
    }
  }
  for(let r=0;r<radialSteps;r++)for(let a=0;a<segments;a++){
    const i=r*(segments+1)+a,j=i+segments+1;
    indices.push(i,j,i+1,i+1,j,j+1);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  g.setIndex(indices);g.computeVertexNormals();return g;
}

export class SphericalClipmap {
  readonly group=new THREE.Group();
  private rings:Ring[]=[];
  private material:THREE.ShaderMaterial;
  private lastDirection=new THREE.Vector3();
  private lastAltitude=-1;
  private rebuildQueued=false;
  private proximity=0;
  constructor(private readonly scene:THREE.Scene,public settings:ClipmapSettings){
    this.material=new THREE.ShaderMaterial({
      uniforms:{uTime:{value:0},uAmplitude:{value:settings.amplitude},uFrequency:{value:settings.frequency}},
      vertexShader:`uniform float uAmplitude;uniform float uFrequency;varying vec3 vWorldNormal;varying float vHeight;
        ${terrainBlueprint.shader}
        void main(){
          vec3 radial=normalize(vec3(position.x,${settings.radius.toFixed(1)},position.z));
          vec3 displaced=displacePlanet(radial*${settings.radius.toFixed(1)},${settings.radius.toFixed(1)});
          vHeight=length(displaced)-${settings.radius.toFixed(1)};
          vec3 local=radial*(${settings.radius.toFixed(1)}+vHeight);
          vec4 mv=modelViewMatrix*vec4(local,1.0);
          vWorldNormal=normalize(mat3(modelMatrix)*radial);
          gl_Position=projectionMatrix*mv;
        }`,
      fragmentShader:`varying vec3 vWorldNormal;varying float vHeight;
        void main(){float light=max(dot(normalize(vWorldNormal),normalize(vec3(.4,.8,.3))),0.0);
        vec3 ocean=vec3(.025,.10,.17),land=vec3(.16,.31,.17),rock=vec3(.55,.54,.46);
        vec3 c=mix(ocean,land,smoothstep(-90.,40.,vHeight));c=mix(c,rock,smoothstep(420.,850.,vHeight));
        c*=.3+light*.85;gl_FragColor=vec4(c,1.0);}`,
      side:THREE.DoubleSide
    });
    this.scene.add(this.group);this.rebuild();
  }
  private rebuild(){
    for(const r of this.rings){this.group.remove(r.mesh);r.mesh.geometry.dispose();}
    this.rings=[];
    const count=THREE.MathUtils.clamp(Math.round(this.settings.rings),1,16);
    const growth=this.settings.ringGrowth;
    const baseAngle=.006;
    for(let i=0;i<count;i++){
      const inner=i===0?0:baseAngle*Math.pow(growth,i-1)*this.settings.radius;
      const outer=baseAngle*Math.pow(growth,i)*this.settings.radius;
      const centerResolution=12+Math.max(0,this.settings.baseSegments-12)*4*this.proximity;
      const segments=Math.min(512,Math.max(12,Math.round(12+(centerResolution-12)*Math.exp(-i*.42))));
      const radialSteps=Math.max(2,Math.round(segments*.25));
      const mesh=new THREE.Mesh(makeAnnulus(inner,outer,segments,radialSteps,this.settings.radius),this.material);
      mesh.frustumCulled=false;mesh.renderOrder=i;
      this.group.add(mesh);this.rings.push({mesh,level:i,segments,inner,outer});
    }
  }
  update(camera:THREE.PerspectiveCamera,time:number){
    this.material.uniforms.uTime.value=time;
    const direction=camera.position.clone().normalize();
    // The clipmap's local +Y is aligned to the camera's planetary normal.
    const orientation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction);
    this.group.quaternion.copy(orientation);
    const altitude=Math.max(0,camera.position.length()-this.settings.radius);
    // Keep the whole clipmap coarse at startup/far zoom; add density only as the camera approaches.
    const proximity=THREE.MathUtils.clamp(1-altitude/(this.settings.radius*.8),0,1);
    if(Math.abs(proximity-this.proximity)>.035&&!this.rebuildQueued){
      this.proximity=proximity;
      this.rebuildQueued=true;
      queueMicrotask(()=>{this.rebuild();this.rebuildQueued=false;});
    }
    this.lastDirection.copy(direction);this.lastAltitude=altitude;
  }
  setSettings(patch:Partial<ClipmapSettings>){
    const rebuild=patch.rings!==undefined||patch.baseSegments!==undefined||patch.ringGrowth!==undefined;
    Object.assign(this.settings,patch);
    this.material.uniforms.uAmplitude.value=this.settings.amplitude;
    this.material.uniforms.uFrequency.value=this.settings.frequency;
    if(rebuild)this.rebuild();
  }
  get lod(){return this.rings[0]?.segments??0;}
  dispose(){for(const r of this.rings)r.mesh.geometry.dispose();this.material.dispose();this.scene.remove(this.group);}
}
