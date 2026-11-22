import * as THREE from 'three';
import { ArcballControls } from 'three/addons/controls/ArcballControls.js';
import { ResizeManager } from './ResizeManager';
import { SphericalClipmap } from '../planet/SphericalClipmap';

export class PlanetViewport {
  readonly renderer:THREE.WebGLRenderer;
  readonly scene=new THREE.Scene();
  readonly camera=new THREE.PerspectiveCamera(48,1,.00005,120000);
  readonly clipmap:SphericalClipmap;
  private controls:ArcballControls;
  private resize:ResizeManager;
  private radius=6371;
  private running=false;
  private frame=0;
  private clock=new THREE.Clock();
  private thirdPerson=false;
  private avatar=new THREE.Group();
  private settings={rings:16,baseSegments:24,ringGrowth:1.22,radius:6371,amplitude:1100,frequency:5.2,zoomSpeed:1.35,rotationSpeed:1,autoRotate:false,showGrid:true};

  constructor(private canvas:HTMLCanvasElement) {
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.setSize(innerWidth,innerHeight,false);
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.scene.background=new THREE.Color('#07111e');

    this.scene.add(new THREE.HemisphereLight(0x9ecfff,0x17202b,1.7));
    // Sun direction is fixed in world coordinates; camera rotation never moves it.
    const sun=new THREE.DirectionalLight(0xffffff,2.2);
    sun.position.set(1,2,1);
    this.scene.add(sun);

    this.clipmap=new SphericalClipmap(this.scene,this.settings);
    this.createAvatar();

    // Arcball always rotates the camera around the planet center.
    // Its target is the planet origin, not a point on the camera's tangent plane.
    this.camera.position.set(this.radius+8629,0,0);
    this.camera.up.set(0,1,0);
    this.camera.lookAt(0,0,0);
    this.controls=new ArcballControls(this.camera,this.canvas,this.scene);
    this.controls.target.set(0,0,0);
    this.controls.enableRotate=true;
    this.controls.enablePan=false;
    this.controls.enableZoom=true;
    this.controls.enableAnimations=true;
    this.controls.scaleFactor=this.settings.zoomSpeed;
    this.controls.minDistance=this.radius+1;
    this.controls.maxDistance=this.radius+90000;
    this.controls.setGizmosVisible(false);
    this.controls.update();

    this.resize=new ResizeManager(canvas,(w,h,dpr)=>{
      this.camera.aspect=w/h;
      this.camera.updateProjectionMatrix();
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(w,h,false);
    });
  }

  private fract(value:number){return value-Math.floor(value);}

  private terrainNoise(x:number,y:number,z:number){
    const hash=(ix:number,iy:number,iz:number)=>{
      let px=this.fract(ix*.3183099+.13)*17;
      let py=this.fract(iy*.3183099+.17)*17;
      let pz=this.fract(iz*.3183099+.11)*17;
      return this.fract(px*py*pz*(px+py+pz));
    };
    const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
    const fx=this.fract(x),fy=this.fract(y),fz=this.fract(z);
    const sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy),sz=fz*fz*(3-2*fz);
    const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
    const x00=mix(hash(ix,iy,iz),hash(ix+1,iy,iz),sx);
    const x10=mix(hash(ix,iy+1,iz),hash(ix+1,iy+1,iz),sx);
    const x01=mix(hash(ix,iy,iz+1),hash(ix+1,iy,iz+1),sx);
    const x11=mix(hash(ix,iy+1,iz+1),hash(ix+1,iy+1,iz+1),sx);
    return mix(mix(x00,x10,sy),mix(x01,x11,sy),sz);
  }

  private terrainHeightKm(direction:THREE.Vector3){
    const f=this.settings.frequency;
    const n=this.terrainNoise(direction.x*f,direction.y*f,direction.z*f)*.65
      +this.terrainNoise(direction.x*f*2.13,direction.y*f*2.13,direction.z*f*2.13)*.25
      +this.terrainNoise(direction.x*f*5.7,direction.y*f*5.7,direction.z*f*5.7)*.1;
    return (n-.48)*this.settings.amplitude*.001;
  }

  private createAvatar(){
    // Simple scale-correct placeholder (metres converted to planet kilometres).
    const skin=new THREE.MeshStandardMaterial({color:0xe0a16a,roughness:.85});
    const suit=new THREE.MeshStandardMaterial({color:0x263b58,roughness:.8});
    const body=new THREE.Mesh(new THREE.CylinderGeometry(.00028,.00034,.00105,8),suit);
    body.position.y=.00085;
    const head=new THREE.Mesh(new THREE.SphereGeometry(.00022,10,8),skin);
    head.position.y=.00155;
    this.avatar.add(body,head);
    this.avatar.visible=false;
    this.scene.add(this.avatar);
  }

  private updateCameraMode(){
    if(!this.thirdPerson){
      const altitude=this.camera.position.distanceTo(this.controls.target)-this.radius;
      if(altitude>80) return;
      const radial=this.camera.position.clone().normalize();
      const worldUp=new THREE.Vector3(0,1,0);
      const reference=Math.abs(radial.dot(worldUp))>.995 ? new THREE.Vector3(0,0,1) : worldUp;
      const east=new THREE.Vector3().crossVectors(reference,radial).normalize();
      const north=new THREE.Vector3().crossVectors(radial,east).normalize();
      const terrainRadius=this.radius+this.terrainHeightKm(radial);
      const surface=radial.clone().multiplyScalar(terrainRadius);
      this.avatar.position.copy(surface).addScaledVector(radial,-.0003);
      this.avatar.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),radial);
      this.avatar.visible=true;
      const target=surface.clone().addScaledVector(radial,.0012);
      this.controls.target.copy(target);
      this.camera.position.copy(target).addScaledVector(radial,.006).addScaledVector(north,-.012);
      this.camera.up.copy(radial);
      this.camera.lookAt(target);
      this.controls.minDistance=.003;
      this.controls.maxDistance=150000;
      this.controls.update();
      this.thirdPerson=true;
      return;
    }

    if(this.camera.position.distanceTo(this.controls.target)<150) return;
    // Leaving local third-person orbit: restore a planet-centred orbit target.
    const radial=this.camera.position.clone().normalize();
    this.controls.target.set(0,0,0);
    this.camera.position.copy(radial).multiplyScalar(this.radius+250);
    this.camera.up.set(0,1,0);
    this.camera.lookAt(0,0,0);
    this.controls.minDistance=this.radius+1;
    this.controls.maxDistance=this.radius+90000;
    this.controls.update();
    this.avatar.visible=false;
    this.thirdPerson=false;
  }

  start(){
    if(this.running)return;
    this.running=true;
    const tick=()=>{
      if(!this.running)return;
      this.frame=requestAnimationFrame(tick);
      const t=this.clock.getElapsedTime();
      this.updateCameraMode();
      if(this.settings.autoRotate && !this.thirdPerson){
        // Rotate the orbit camera around the planet, keeping its target at origin.
        const offset=this.camera.position.clone().sub(this.controls.target);
        offset.applyAxisAngle(new THREE.Vector3(0,1,0),.0008*this.settings.rotationSpeed);
        this.camera.position.copy(this.controls.target).add(offset);
        this.camera.lookAt(this.controls.target);
      }
      this.controls.update();
      this.clipmap.update(this.camera,t);
      this.renderer.render(this.scene,this.camera);
    };
    tick();
  }

  getTelemetry(){
    return{
      altitude:this.thirdPerson ? this.camera.position.distanceTo(this.controls.target) : Math.max(0,this.camera.position.distanceTo(this.controls.target)-this.radius),
      rings:this.settings.rings,
      lod:this.clipmap.lod,
      levels:this.clipmap.activeLevels,
      triangles:this.clipmap.triangleCount
    };
  }

  getConfig(){return this.settings;}

  updateConfig(patch:Record<string,number|boolean>){
    Object.assign(this.settings,patch);
    this.controls.scaleFactor=this.settings.zoomSpeed;
    if(!this.thirdPerson){
      this.controls.minDistance=this.radius+1;
      this.controls.maxDistance=this.radius+90000;
    }
    if(typeof patch.showGrid==='boolean') this.clipmap.setGridVisible(patch.showGrid);
    this.clipmap.setSettings({
      rings:this.settings.rings,
      baseSegments:this.settings.baseSegments,
      amplitude:this.settings.amplitude,
      frequency:this.settings.frequency,
      ringGrowth:this.settings.ringGrowth
    });
  }

  dispose(){
    this.running=false;
    cancelAnimationFrame(this.frame);
    this.controls.dispose();
    this.scene.remove(this.avatar);
    this.resize.dispose();
    this.clipmap.dispose();
    this.renderer.dispose();
  }
}
