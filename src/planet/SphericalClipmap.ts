import * as THREE from 'three';
import { terrainBlueprint } from './TerrainBlueprint';

export interface ClipmapSettings { rings:number; baseSegments:number; ringGrowth:number; radius:number; amplitude:number; frequency:number; }
type Ring = {mesh:THREE.Mesh;level:number;segments:number;};

export class SphericalClipmap {
  readonly group=new THREE.Group();
  private rings:Ring[]=[];
  private material:THREE.ShaderMaterial;
  private lastCenter=new THREE.Vector3();
  private initialized=false;
  constructor(private readonly scene:THREE.Scene, public settings:ClipmapSettings) {
    this.material=new THREE.ShaderMaterial({
      uniforms:{uTime:{value:0},uAmplitude:{value:settings.amplitude},uFrequency:{value:settings.frequency}},
      vertexShader:`uniform float uAmplitude;uniform float uFrequency;varying vec3 vWorldNormal;varying float vHeight;
        ${terrainBlueprint.shader}
        void main(){vec3 displaced=displacePlanet(position, ${settings.radius.toFixed(1)});vHeight=length(displaced)-${settings.radius.toFixed(1)};vec4 mv=modelViewMatrix*vec4(displaced,1.0);vWorldNormal=normalize(mat3(modelMatrix)*normalize(displaced));gl_Position=projectionMatrix*mv;}`,
      fragmentShader:`varying vec3 vWorldNormal;varying float vHeight;void main(){float light=max(dot(normalize(vWorldNormal),normalize(vec3(.4,.8,.3))),0.0);vec3 low=vec3(.035,.13,.19),mid=vec3(.17,.34,.19),high=vec3(.62,.62,.53);vec3 c=mix(low,mid,smoothstep(-180.,120.,vHeight));c=mix(c,high,smoothstep(450.,900.,vHeight));c*=.34+light*.8;gl_FragColor=vec4(c,1.0);}`,
      wireframe:false
    });
    scene.add(this.group);
    this.rebuild(settings.rings,settings.baseSegments);
  }
  private rebuild(count:number,base:number) {
    for(const r of this.rings){this.group.remove(r.mesh);r.mesh.geometry.dispose();}
    this.rings=[];
    for(let i=count-1;i>=0;i--){
      const segments=Math.min(512,Math.max(12,Math.round(base*Math.pow(1.22,i))));
      const geometry=new THREE.SphereGeometry(this.settings.radius,segments,Math.max(8,Math.round(segments*.5)));
      const mesh=new THREE.Mesh(geometry,this.material);mesh.frustumCulled=false;mesh.renderOrder=0;
      this.group.add(mesh);this.rings.push({mesh,level:i,segments});
    }
  }
  update(camera:THREE.PerspectiveCamera,time:number) {
    this.material.uniforms.uTime.value=time;
    const direction=camera.position.clone().normalize();
    // Planet is spherical: rings are concentric spherical shells around the camera's sub-point.
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction);
    const altitude=Math.max(0,camera.position.length()-this.settings.radius);
    const zoomFactor=THREE.MathUtils.clamp(1-altitude/(this.settings.radius*1.8),0,1);
    const desired=Math.round(24+zoomFactor*232);
    if(!this.initialized||Math.abs(desired-(this.rings[0]?.segments??0))>24){
      this.initialized=true;this.rebuild(this.settings.rings,Math.max(12,Math.round(desired/Math.pow(1.22,this.settings.rings-1))));
    }
    this.lastCenter.copy(direction);
  }
  setSettings(patch:Partial<ClipmapSettings>) {
    const rebuild=patch.rings!==undefined||patch.baseSegments!==undefined;
    Object.assign(this.settings,patch);
    this.material.uniforms.uAmplitude.value=this.settings.amplitude;
    this.material.uniforms.uFrequency.value=this.settings.frequency;
    if(rebuild)this.rebuild(this.settings.rings,this.settings.baseSegments);
  }
  get lod(){return this.rings[0]?.segments??0;}
  dispose(){for(const r of this.rings)r.mesh.geometry.dispose();this.material.dispose();this.scene.remove(this.group);}
}
