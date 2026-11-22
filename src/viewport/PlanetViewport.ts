import * as THREE from 'three';
import { ResizeManager } from './ResizeManager';
import { SphericalClipmap } from '../planet/SphericalClipmap';

export class PlanetViewport {
  readonly renderer:THREE.WebGLRenderer;
  readonly scene=new THREE.Scene();
  readonly camera=new THREE.PerspectiveCamera(48,1,.01,120000);
  readonly clipmap:SphericalClipmap;
  private resize:ResizeManager;
  private radius=6371;
  private running=false;
  private frame=0;
  private clock=new THREE.Clock();
  private longitude=0;
  private latitude=0;
  private altitude=8629;
  private dragPointer:number|null=null;
  private lastPointerX=0;
  private lastPointerY=0;
  private readonly worldUp=new THREE.Vector3(0,1,0);
  private settings={rings:16,baseSegments:24,ringGrowth:1.22,radius:6371,amplitude:1100,frequency:5.2,zoomSpeed:1.35,rotationSpeed:1,autoRotate:false};

  private onPointerDown=(event:PointerEvent)=>{
    if(event.button!==0 && event.button!==2)return;
    this.dragPointer=event.pointerId;
    this.lastPointerX=event.clientX;
    this.lastPointerY=event.clientY;
    this.canvas.setPointerCapture(event.pointerId);
  };

  private onPointerMove=(event:PointerEvent)=>{
    if(this.dragPointer!==event.pointerId)return;
    const dx=event.clientX-this.lastPointerX;
    const dy=event.clientY-this.lastPointerY;
    this.lastPointerX=event.clientX;
    this.lastPointerY=event.clientY;
    const sensitivity=.004*this.settings.rotationSpeed;
    this.longitude-=dx*sensitivity;
    this.latitude=THREE.MathUtils.clamp(
      this.latitude-dy*sensitivity,
      -Math.PI*.495,
      Math.PI*.495
    );
    this.updateCameraPose();
  };

  private onPointerUp=(event:PointerEvent)=>{
    if(this.dragPointer!==event.pointerId)return;
    this.dragPointer=null;
    if(this.canvas.hasPointerCapture(event.pointerId))this.canvas.releasePointerCapture(event.pointerId);
  };

  private onWheel=(event:WheelEvent)=>{
    event.preventDefault();
    this.altitude=THREE.MathUtils.clamp(
      this.altitude*Math.exp(event.deltaY*.001*this.settings.zoomSpeed),
      2,
      90000
    );
    this.updateCameraPose();
  };

  private onContextMenu=(event:MouseEvent)=>event.preventDefault();

  constructor(private canvas:HTMLCanvasElement) {
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.setSize(innerWidth,innerHeight,false);
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.scene.background=new THREE.Color('#07111e');

    this.scene.add(new THREE.HemisphereLight(0x9ecfff,0x17202b,1.7));
    // World-space sun: its direction is independent of camera/player movement.
    const sun=new THREE.DirectionalLight(0xffffff,2.2);
    sun.position.set(1,2,1);
    this.scene.add(sun);

    this.clipmap=new SphericalClipmap(this.scene,this.settings);

    this.canvas.addEventListener('pointerdown',this.onPointerDown);
    this.canvas.addEventListener('pointermove',this.onPointerMove);
    this.canvas.addEventListener('pointerup',this.onPointerUp);
    this.canvas.addEventListener('pointercancel',this.onPointerUp);
    this.canvas.addEventListener('wheel',this.onWheel,{passive:false});
    this.canvas.addEventListener('contextmenu',this.onContextMenu);
    this.updateCameraPose();

    this.resize=new ResizeManager(canvas,(w,h,dpr)=>{
      this.camera.aspect=w/h;
      this.camera.updateProjectionMatrix();
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(w,h,false);
    });
  }

  // The camera rides above a latitude/longitude on the globe. It looks
  // along the local tangent plane instead of permanently targeting planet center.
  private updateCameraPose(){
    const cosLat=Math.cos(this.latitude);
    const radial=new THREE.Vector3(
      cosLat*Math.cos(this.longitude),
      Math.sin(this.latitude),
      cosLat*Math.sin(this.longitude)
    ).normalize();
    const north=new THREE.Vector3(
      -Math.sin(this.latitude)*Math.cos(this.longitude),
      cosLat,
      -Math.sin(this.latitude)*Math.sin(this.longitude)
    ).normalize();
    const pitch=THREE.MathUtils.degToRad(24);
    const forward=north.multiplyScalar(Math.cos(pitch)).addScaledVector(radial,-Math.sin(pitch)).normalize();
    this.camera.position.copy(radial).multiplyScalar(this.radius+this.altitude);
    this.camera.up.copy(radial);
    this.camera.lookAt(this.camera.position.clone().addScaledVector(forward,1000));
    this.camera.updateMatrixWorld();
  }

  start(){
    if(this.running)return;
    this.running=true;
    const tick=()=>{
      if(!this.running)return;
      this.frame=requestAnimationFrame(tick);
      const t=this.clock.getElapsedTime();
      if(this.settings.autoRotate){
        this.longitude+=.0008*this.settings.rotationSpeed;
        this.updateCameraPose();
      }
      this.clipmap.update(this.camera,t);
      this.renderer.render(this.scene,this.camera);
    };
    tick();
  }

  getTelemetry(){
    return{
      altitude:this.altitude,
      rings:this.settings.rings,
      lod:this.clipmap.lod,
      levels:this.clipmap.activeLevels,
      triangles:this.clipmap.triangleCount
    };
  }

  getConfig(){return this.settings;}

  updateConfig(patch:Record<string,number|boolean>){
    Object.assign(this.settings,patch);
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
    this.canvas.removeEventListener('pointerdown',this.onPointerDown);
    this.canvas.removeEventListener('pointermove',this.onPointerMove);
    this.canvas.removeEventListener('pointerup',this.onPointerUp);
    this.canvas.removeEventListener('pointercancel',this.onPointerUp);
    this.canvas.removeEventListener('wheel',this.onWheel);
    this.canvas.removeEventListener('contextmenu',this.onContextMenu);
    this.resize.dispose();
    this.clipmap.dispose();
    this.renderer.dispose();
  }
}
