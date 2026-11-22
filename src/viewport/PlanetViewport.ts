import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ResizeManager } from './ResizeManager';
import { SphericalClipmap } from '../planet/SphericalClipmap';

export class PlanetViewport {
  readonly renderer:THREE.WebGLRenderer;
  readonly scene=new THREE.Scene();
  readonly camera=new THREE.PerspectiveCamera(48,1,.01,120000);
  readonly clipmap:SphericalClipmap;
  private controls:OrbitControls;
  private resize:ResizeManager;
  private radius=6371;
  private running=false;
  private frame=0;
  private clock=new THREE.Clock();
  private settings={rings:16,baseSegments:24,ringGrowth:1.22,radius:6371,amplitude:1100,frequency:5.2,zoomSpeed:1.35,rotationSpeed:1,autoRotate:false};

  constructor(private canvas:HTMLCanvasElement) {
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.setSize(innerWidth,innerHeight,false);
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.scene.background=new THREE.Color('#07111e');

    this.scene.add(new THREE.HemisphereLight(0x9ecfff,0x17202b,1.7));
    // The sun is fixed in world space. Camera movement never rotates the light.
    const sun=new THREE.DirectionalLight(0xffffff,2.2);
    sun.position.set(1,2,1);
    this.scene.add(sun);

    this.clipmap=new SphericalClipmap(this.scene,this.settings);

    this.camera.position.set(15000*Math.sin(1.12)*Math.sin(.7),15000*Math.cos(1.12),15000*Math.sin(1.12)*Math.cos(.7));
    this.controls=new OrbitControls(this.camera,this.canvas);
    this.controls.target.set(0,0,0);
    this.controls.enableDamping=true;
    this.controls.dampingFactor=.08;
    this.controls.enablePan=false;
    this.controls.enableRotate=true;
    this.controls.enableZoom=true;
    this.controls.rotateSpeed=this.settings.rotationSpeed;
    this.controls.zoomSpeed=this.settings.zoomSpeed;
    this.controls.minDistance=this.radius*1.003;
    this.controls.maxDistance=90000;
    this.controls.minPolarAngle=.01;
    this.controls.maxPolarAngle=Math.PI-.01;
    // Both mouse buttons orbit; right-drag must never pan the planet off-screen.
    this.controls.mouseButtons={
      LEFT:THREE.MOUSE.ROTATE,
      MIDDLE:THREE.MOUSE.DOLLY,
      RIGHT:THREE.MOUSE.ROTATE
    };
    this.controls.update();

    this.resize=new ResizeManager(canvas,(w,h,dpr)=>{
      this.camera.aspect=w/h;
      this.camera.updateProjectionMatrix();
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(w,h,false);
    });
  }

  start(){
    if(this.running)return;
    this.running=true;
    const tick=()=>{
      if(!this.running)return;
      this.frame=requestAnimationFrame(tick);
      const t=this.clock.getElapsedTime();
      this.controls.autoRotate=this.settings.autoRotate;
      this.controls.autoRotateSpeed=.5*this.settings.rotationSpeed;
      this.controls.update();
      this.clipmap.update(this.camera,t);
      this.renderer.render(this.scene,this.camera);
    };
    tick();
  }

  getTelemetry(){
    return{
      altitude:Math.max(0,this.camera.position.distanceTo(this.controls.target)-this.radius),
      rings:this.settings.rings,
      lod:this.clipmap.lod
    };
  }

  getConfig(){return this.settings;}

  updateConfig(patch:Record<string,number|boolean>){
    Object.assign(this.settings,patch);
    this.controls.rotateSpeed=this.settings.rotationSpeed;
    this.controls.zoomSpeed=this.settings.zoomSpeed;
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
    this.resize.dispose();
    this.clipmap.dispose();
    this.renderer.dispose();
  }
}
