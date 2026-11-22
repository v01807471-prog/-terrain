import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ResizeManager } from './ResizeManager';
import { SphericalClipmap } from '../planet/SphericalClipmap';
import { terrainBlueprint } from '../planet/TerrainBlueprint';
import { Solar } from '../planet/Solar';

type PlanetRenderEntry = {
  name:string;
  center:THREE.Vector3;
  radius:number;
  clipmap:SphericalClipmap;
  shouldRender:(camera:THREE.PerspectiveCamera,frustum:THREE.Frustum,others:PlanetRenderEntry[])=>boolean;
};

export class PlanetViewport {
  readonly renderer:THREE.WebGLRenderer;
  readonly scene=new THREE.Scene();
  readonly camera=new THREE.PerspectiveCamera(48,1,.00005,300000000);
  readonly clipmap:SphericalClipmap;
  readonly moonClipmap:SphericalClipmap;
  readonly planets:PlanetRenderEntry[]=[];
  private solar:Solar;
  private controls:OrbitControls;
  private resize:ResizeManager;
  private radius=6371;
  private readonly systemViewDistance=300000000;
  private running=false;
  private frame=0;
  private clock=new THREE.Clock();
  private thirdPerson=false;
  private avatar=new THREE.Group();
  // Cached world-space positions are read from the Solar scene graph.
  private planetCenter=new THREE.Vector3();
  private moonCenter=new THREE.Vector3();
  private moonRadius=1737;
  private moonTerrainSettings={amplitude:950,frequency:7.4};
  private focusedMoon=false;
  private settings={rings:17,baseSegments:24,ringGrowth:1.22,radius:6371,amplitude:1100,frequency:5.2,zoomSpeed:1.1,rotationSpeed:1,autoRotate:false,showGrid:true};

  constructor(private canvas:HTMLCanvasElement) {
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance',logarithmicDepthBuffer:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.setSize(innerWidth,innerHeight,false);
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.scene.background=new THREE.Color('#07111e');
    this.solar=new Solar();
    this.scene.add(this.solar);
    this.syncSolarPositions();

    this.scene.add(new THREE.HemisphereLight(0x9ecfff,0x17202b,1.7));
    // Sun direction is fixed in world coordinates; camera rotation never moves it.
    const sun=new THREE.DirectionalLight(0xffffff,2.2);
    sun.position.set(1,2,1);
    this.scene.add(sun);

    this.clipmap=new SphericalClipmap(this.scene,this.settings);
    this.moonClipmap=new SphericalClipmap(this.scene,{
      rings:17,baseSegments:24,ringGrowth:1.22,radius:this.moonRadius,
      amplitude:this.moonTerrainSettings.amplitude,frequency:this.moonTerrainSettings.frequency
    });
    this.solar.earth.add(this.clipmap.group);
    this.solar.moon.add(this.moonClipmap.group);
    this.syncSolarPositions();
    this.planets.push(
      this.createPlanetRenderEntry('Earth',this.planetCenter,this.radius,this.clipmap),
      this.createPlanetRenderEntry('Moon',this.moonCenter,this.moonRadius,this.moonClipmap)
    );
    this.createAvatar();

    this.camera.position.copy(this.planetCenter).add(new THREE.Vector3(this.radius+8629,0,0));
    this.camera.up.set(0,1,0);
    this.camera.lookAt(this.planetCenter);
    this.controls=new OrbitControls(this.camera,this.canvas);
    this.controls.target.copy(this.activeCenter);
    this.controls.enableRotate=true;
    this.controls.enablePan=false;
    this.controls.enableZoom=true;
    this.controls.enableDamping=false;
    this.controls.rotateSpeed=0.65;
    this.controls.zoomSpeed=this.settings.zoomSpeed;
    this.controls.minDistance=this.activeRadius+1;
    this.controls.maxDistance=this.systemViewDistance;
    // OrbitControls has no setGizmosVisible method; gizmo visibility is not
    // part of its API. Keep the standard controls without this unsupported call.
    this.controls.update();
    this.updateDepthRange();

    this.resize=new ResizeManager(canvas,(w,h,dpr)=>{
      this.camera.aspect=w/h;
      this.camera.updateProjectionMatrix();
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(w,h,false);
    });
  }

  private get activeCenter(){return this.focusedMoon?this.moonCenter:this.planetCenter;}
  private get activeRadius(){return this.focusedMoon?this.moonRadius:this.radius;}
  private get activeClipmap(){return this.focusedMoon?this.moonClipmap:this.clipmap;}
  private get activeGravity(){return this.focusedMoon?1.62:9.81;}
  private activeTerrainHeightKm(direction:THREE.Vector3){
    return this.focusedMoon
      ?terrainBlueprint.heightKm(direction,this.moonTerrainSettings,0)
      :this.terrainHeightKm(direction);
  }


  private createPlanetRenderEntry(name:string,center:THREE.Vector3,radius:number,clipmap:SphericalClipmap):PlanetRenderEntry{
    const entry:PlanetRenderEntry = {
      name,center,radius,clipmap,
      shouldRender:(camera,frustum,others)=>{
        const bound=new THREE.Sphere(center,radius+clipmap.settings.amplitude);
        if(!frustum.intersectsSphere(bound))return false;
        const toTarget=center.clone().sub(camera.position);
        const targetDistance=toTarget.length();
        if(targetDistance<=radius)return true;
        const rayDirection=toTarget.multiplyScalar(1/targetDistance);
        for(const other of others){
          if(other===entry)continue;
          const toOccluder=other.center.clone().sub(camera.position);
          const occluderRadius=other.radius+other.clipmap.settings.amplitude;
          if(toOccluder.length()<other.radius*1.001)continue;
          const along=toOccluder.dot(rayDirection);
          if(along<=0||along>=targetDistance-radius)continue;
          const closest=toOccluder.addScaledVector(rayDirection,-along).length();
          if(closest<occluderRadius)return false;
        }
        return true;
      }
    };
    return entry;
  }

  private updatePlanetRenderPass(time:number){
    this.camera.updateMatrixWorld();
    const viewProjection=new THREE.Matrix4().multiplyMatrices(
      this.camera.projectionMatrix,this.camera.matrixWorldInverse
    );
    const frustum=new THREE.Frustum().setFromProjectionMatrix(viewProjection);
    for(const planet of this.planets){
      const visible=planet.shouldRender(this.camera,frustum,this.planets);
      planet.clipmap.group.visible=visible;
      if(visible)planet.clipmap.update(this.camera,time,planet.center);
    }
  }

  private syncSolarPositions(){
    this.solar.getWorldPositionOf(this.solar.earth,this.planetCenter);
    this.solar.getWorldPositionOf(this.solar.moon,this.moonCenter);
  }

  focusMoon(){
    if(this.focusedMoon)return;
    const shift=this.moonCenter.clone().sub(this.planetCenter);
    this.camera.position.add(shift);
    this.controls.target.add(shift);
    this.focusedMoon=true;
    this.thirdPerson=false;
    this.avatar.visible=false;
    this.camera.up.set(0,1,0);
    this.controls.minDistance=this.moonRadius+1;
    this.controls.maxDistance=this.systemViewDistance;
    this.controls.update();
    this.updateDepthRange();
  }

  focusEarth(){
    if(!this.focusedMoon)return;
    const shift=this.planetCenter.clone().sub(this.moonCenter);
    this.camera.position.add(shift);
    this.controls.target.add(shift);
    this.focusedMoon=false;
    this.thirdPerson=false;
    this.avatar.visible=false;
    this.camera.up.set(0,1,0);
    this.controls.minDistance=this.radius+1;
    this.controls.maxDistance=this.systemViewDistance;
    this.controls.update();
    this.updateDepthRange();
  }

  getGravityInfo(){
    return {body:this.focusedMoon?'Moon':'Earth',surfaceGravity:this.activeGravity,
      escapeVelocity:this.focusedMoon?2.38:11.2};
  }

  private terrainHeightKm(direction:THREE.Vector3){
    // Use the exact same hash, interpolation and octave weights as the GLSL
    // displacement. This is the ground collision height in planet kilometres.
    return terrainBlueprint.heightKm(direction,this.settings,0);
  }

  private updateDepthRange(){
    // Keep enough depth precision close to the player without clipping the
    // planet or distant orbit while zooming continuously between both modes.
    const targetDistance=this.camera.position.distanceTo(this.controls.target);
    this.camera.near=this.thirdPerson
      ? Math.max(.0005,targetDistance*.000001)
      : Math.max(.05,targetDistance*.00001);
    this.camera.far=this.thirdPerson
      ? Math.max(1,targetDistance*1.5+.1)
      : Math.max(this.systemViewDistance,targetDistance+this.systemViewDistance);
    this.camera.updateProjectionMatrix();
  }

  private createAvatar(){
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
      const altitude=this.camera.position.distanceTo(this.activeCenter)-this.activeRadius;
      if(altitude>80) return;

      // Re-anchor the orbit target to the local ground without moving the camera.
      const radial=this.camera.position.clone().sub(this.activeCenter).normalize();
      const worldNorth=new THREE.Vector3(0,1,0);
      const reference=Math.abs(radial.dot(worldNorth))>.995 ? new THREE.Vector3(0,0,1) : worldNorth;
      const north=new THREE.Vector3().crossVectors(radial,new THREE.Vector3().crossVectors(reference,radial)).normalize();
      const terrainRadius=this.activeRadius+this.activeTerrainHeightKm(radial);
      const surface=this.activeCenter.clone().addScaledVector(radial,terrainRadius);

      // The avatar's origin is at its feet; local up is the planet radial.
      this.avatar.position.copy(surface).addScaledVector(radial,-.000325);
      this.avatar.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),radial);
      this.avatar.visible=true;

      // Third-person shoulder camera: target at eye level, a few metres
      // behind the character. Camera up follows local gravity, not world Y.
      const target=surface.clone().addScaledVector(radial,.0016);
      this.controls.target.copy(target);
      this.camera.up.copy(radial);
      this.camera.position.copy(target).addScaledVector(radial,.0008).addScaledVector(north,-.004);
      this.camera.lookAt(target);
      this.controls.minDistance=.003;
      this.controls.maxDistance=150000;
      this.controls.minPolarAngle=.12;
      this.controls.maxPolarAngle=Math.PI-.12;
      this.controls.rotateSpeed=0.65;
      this.controls.zoomSpeed=this.settings.zoomSpeed;
      this.thirdPerson=true;
      this.controls.update();
      this.updateDepthRange();
      return;
    }

    if(this.camera.position.distanceTo(this.controls.target)<150) return;

    // Switch back to planet-centred orbit by changing only the target.
    // Preserve camera position and orientation: no teleport or zoom snap.
    this.controls.target.copy(this.activeCenter);
    this.camera.up.set(0,1,0);
    this.camera.lookAt(this.activeCenter);
    this.controls.minDistance=this.activeRadius+1;
    this.controls.maxDistance=this.systemViewDistance;
    this.avatar.visible=false;
    this.thirdPerson=false;
    this.controls.update();
    this.updateDepthRange();
  }

  start(){
    if(this.running)return;
    this.running=true;
    const tick=()=>{
      if(!this.running)return;
      this.frame=requestAnimationFrame(tick);
      const deltaTime=Math.min(this.clock.getDelta(),0.05);
      const t=this.clock.elapsedTime;
      // Solar updates parent pivots; child bodies inherit orbital transforms.
      const previousCenter=this.planetCenter.clone();
      const previousMoon=this.moonCenter.clone();
      this.solar.update(deltaTime);
      this.syncSolarPositions();
      const orbitDelta=this.planetCenter.clone().sub(previousCenter);
      const moonDelta=this.moonCenter.clone().sub(previousMoon);
      const activeDelta=this.focusedMoon?moonDelta:orbitDelta;
      this.camera.position.add(activeDelta);
      this.controls.target.add(activeDelta);
      if(this.avatar.visible) this.avatar.position.add(activeDelta);
      this.updateCameraMode();
      if(this.settings.autoRotate && !this.thirdPerson){
        const offset=this.camera.position.clone().sub(this.controls.target);
        offset.applyAxisAngle(new THREE.Vector3(0,1,0),.0008*this.settings.rotationSpeed);
        this.camera.position.copy(this.controls.target).add(offset);
        this.camera.lookAt(this.controls.target);
      }
      this.controls.update();
      if (this.thirdPerson) {
        // Keep local gravity aligned with the avatar's radial surface normal.
        // OrbitControls uses camera.up to constrain rotation, preventing roll.
        const localUp=this.avatar.position.clone().sub(this.activeCenter).normalize();
        this.camera.up.copy(localUp);
        // Prevent the local camera from passing below the displaced ground.
        const cameraOffset=this.camera.position.clone().sub(this.activeCenter);
        const cameraRadial=cameraOffset.clone().normalize();
        const groundRadius=this.activeRadius+this.activeTerrainHeightKm(cameraRadial);
        const minCameraRadius=groundRadius+.0018;
        if (cameraOffset.length()<minCameraRadius) {
          this.camera.position.copy(this.activeCenter).addScaledVector(cameraRadial,minCameraRadius);
        }

        const up=this.avatar.position.clone().sub(this.activeCenter).normalize();
        const forward=this.controls.target.clone().sub(this.camera.position);
        forward.addScaledVector(up,-forward.dot(up)).normalize();
        if (forward.lengthSq()>1e-8) {
          const right=new THREE.Vector3().crossVectors(forward,up).normalize();
          const back=forward.clone().negate();
          this.avatar.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,up,back));
        }
      }
      this.updateDepthRange();
      this.updatePlanetRenderPass(t);
      this.renderer.render(this.scene,this.camera);
    };
    tick();
  }

  getTelemetry(){
    return{
      altitude:this.thirdPerson ? this.camera.position.distanceTo(this.controls.target) : Math.max(0,this.camera.position.distanceTo(this.activeCenter)-this.activeRadius),
      rings:this.settings.rings,
      lod:this.activeClipmap.lod,
      levels:this.activeClipmap.activeLevels,
      triangles:this.planets.reduce((sum,planet)=>sum+(planet.clipmap.group.visible?planet.clipmap.triangleCount:0),0),
      visiblePlanets:this.planets.filter(planet=>planet.clipmap.group.visible).map(planet=>planet.name)
    };
  }

  getConfig(){return this.settings;}

  updateConfig(patch:Record<string,number|boolean>){
    Object.assign(this.settings,patch);
    this.controls.zoomSpeed=Math.max(.1,Math.min(3,this.settings.zoomSpeed));
    if(!this.thirdPerson){
      this.controls.minDistance=this.activeRadius+1;
      this.controls.maxDistance=this.activeRadius+250000;
    }
    if(typeof patch.showGrid==='boolean'){
      this.clipmap.setGridVisible(patch.showGrid);
      this.moonClipmap.setGridVisible(patch.showGrid);
    }
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
    this.moonClipmap.dispose();
    this.scene.remove(this.solar);
    this.renderer.dispose();
  }
}
