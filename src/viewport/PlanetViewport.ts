import * as THREE from 'three';
import { ResizeManager } from './ResizeManager';
import { SphericalClipmap } from '../planet/SphericalClipmap';

export class PlanetViewport {
  readonly renderer:THREE.WebGLRenderer;
  readonly scene=new THREE.Scene();
  readonly camera=new THREE.PerspectiveCamera(48,1,.01,120000);
  readonly clipmap:SphericalClipmap;
  private resize:ResizeManager;
  private target=new THREE.Vector3();
  private radius=6371;
  private distance=15000;
  private azimuth=.7;
  private polar=1.12;
  private dragging=false;
  private panning=false;
  private lastX=0;private lastY=0;
  private running=false;private frame=0;
  private clock=new THREE.Clock();
  private settings={rings:16,baseSegments:24,ringGrowth:1.22,radius:6371,amplitude:1100,frequency:5.2,zoomSpeed:1.35,rotationSpeed:1,autoRotate:false};

  constructor(private canvas:HTMLCanvasElement) {
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.setSize(innerWidth,innerHeight,false);
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.scene.background=new THREE.Color('#07111e');
    this.scene.add(new THREE.HemisphereLight(0x9ecfff,0x17202b,1.7));
    const sun=new THREE.DirectionalLight(0xffffff,2.2);sun.position.set(1,2,1);this.scene.add(sun);
    this.clipmap=new SphericalClipmap(this.scene,this.settings);
    this.resize=new ResizeManager(canvas,(w,h,dpr)=>{this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setPixelRatio(dpr);this.renderer.setSize(w,h,false);});
    this.bindControls();this.updateCamera();
  }
  private bindControls(){
    this.canvas.addEventListener('contextmenu',e=>e.preventDefault());
    this.canvas.addEventListener('pointerdown',e=>{this.dragging=true;this.panning=e.shiftKey||e.button===2;this.lastX=e.clientX;this.lastY=e.clientY;this.canvas.setPointerCapture(e.pointerId);});
    this.canvas.addEventListener('pointermove',e=>{
      if(!this.dragging)return;
      const dx=e.clientX-this.lastX;
      const dy=e.clientY-this.lastY;
      this.lastX=e.clientX;
      this.lastY=e.clientY;
      if(this.panning){
        this.azimuth-=dx*.003;
        this.target.y+=dy*this.distance*.00035;
      }else{
        // Orbit the camera around the planet on both axes.
        this.azimuth+=dx*.005*this.settings.rotationSpeed;
        this.polar=THREE.MathUtils.clamp(
          this.polar-dy*.005*this.settings.rotationSpeed,
          .04,
          Math.PI-.04
        );
      }
      this.updateCamera();
    });
    const end=()=>{this.dragging=false;};this.canvas.addEventListener('pointerup',end);this.canvas.addEventListener('pointercancel',end);
    this.canvas.addEventListener('wheel',e=>{e.preventDefault();const factor=Math.exp(e.deltaY*.0012*this.settings.zoomSpeed);this.distance=THREE.MathUtils.clamp(this.distance*factor,this.radius*1.003,90000);this.updateCamera();},{passive:false});
    this.canvas.addEventListener('dblclick',()=>{this.distance=this.radius*1.08;this.updateCamera();});
  }
  private updateCamera(){
    const sin=Math.sin(this.polar);this.camera.position.set(this.target.x+this.distance*sin*Math.sin(this.azimuth),this.target.y+this.distance*Math.cos(this.polar),this.target.z+this.distance*sin*Math.cos(this.azimuth));
    this.camera.lookAt(this.target);this.camera.near=Math.max(.02,this.distance/100000);this.camera.far=Math.max(120000,this.distance*5);this.camera.updateProjectionMatrix();
  }
  start(){if(this.running)return;this.running=true;const tick=()=>{if(!this.running)return;this.frame=requestAnimationFrame(tick);const t=this.clock.getElapsedTime();if(this.settings.autoRotate&&!this.dragging){this.azimuth-=.0007;this.updateCamera();}this.clipmap.update(this.camera,t);this.renderer.render(this.scene,this.camera);};tick();}
  getTelemetry(){return{altitude:Math.max(0,this.camera.position.length()-this.radius),rings:this.settings.rings,lod:this.clipmap.lod};}
  getConfig(){return this.settings;}
  updateConfig(patch:Record<string,number|boolean>){Object.assign(this.settings,patch);this.clipmap.setSettings({rings:this.settings.rings,baseSegments:this.settings.baseSegments,amplitude:this.settings.amplitude,frequency:this.settings.frequency,ringGrowth:this.settings.ringGrowth});this.updateCamera();}
  dispose(){this.running=false;cancelAnimationFrame(this.frame);this.resize.dispose();this.clipmap.dispose();this.renderer.dispose();}
}
