import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ResizeManager } from './ResizeManager';
import { SphericalClipmap } from '../planet/SphericalClipmap';
import { terrainBlueprint } from '../planet/TerrainBlueprint';
import { Solar } from '../planet/Solar';
import { PlanetPlayerController } from '../planet/PlanetPlayerController';

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
  private player:PlanetPlayerController;
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
  private flatTestActive=false;
  private readonly flatTestGroup=new THREE.Group();
  private savedCameraPosition=new THREE.Vector3();
  private savedCameraTarget=new THREE.Vector3();
  private savedCameraUp=new THREE.Vector3(0,1,0);
  private settings={rings:17,baseSegments:24,ringGrowth:1.22,radius:6371,amplitude:1100,frequency:5.2,zoomSpeed:1.1,rotationSpeed:1,autoRotate:false,showGrid:true};

  constructor(private canvas:HTMLCanvasElement) {
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance',logarithmicDepthBuffer:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.setSize(innerWidth,innerHeight,false);
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.scene.background=new THREE.Color('#07111e');
    this.solar=new Solar();
    this.scene.add(this.solar);

    // Diagnostic-only flat clipmap: fixed topology, no terrain shader, no LOD.
    // Units in this project are kilometres: a 20 km square patch,
    // with one-kilometre reference grid lines.
    const flatGeometry=new THREE.PlaneGeometry(20,20,128,128);
    flatGeometry.rotateX(-Math.PI/2);
    const flatMaterial=new THREE.ShaderMaterial({
      vertexShader:`void main(){vec4 worldPosition=modelMatrix*vec4(position,1.0);gl_Position=projectionMatrix*viewMatrix*worldPosition;}`,
      fragmentShader:`void main(){gl_FragColor=vec4(0.18,0.48,0.72,1.0);}`
    });
    const flatSurface=new THREE.Mesh(flatGeometry,flatMaterial);
    const flatGrid=new THREE.GridHelper(20,20,0x22d3ee,0x36516a);
    flatGrid.position.y=0.015;
    this.flatTestGroup.add(flatSurface,flatGrid);
    this.flatTestGroup.visible=false;
    this.scene.add(this.flatTestGroup);
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
    this.player=new PlanetPlayerController(this.canvas,this.camera,this.controls,this.avatar,(direction)=>this.activeTerrainHeightKm(direction));

    // Start in playable surface mode instead of leaving the camera in orbit.
    // The player controller places the avatar on the same procedural height
    // field used by the terrain shader and owns the third-person camera.
    this.player.enter(this.planetCenter,this.radius,new THREE.Vector3(1,0,0));
    this.thirdPerson=true;
    this.updateDepthRange();

    this.resize=new ResizeManager(canvas,(w,h,dpr)=>{
      this.camera.aspect=w/h;
      this.camera.updateProjectionMatrix();
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(w,h,false);
    });
  }

  enterFlatClipmapTest(worldOffset:number){
    if(this.player.isActive){this.player.detach();this.thirdPerson=false;}
    if(!this.flatTestActive){
      this.savedCameraPosition.copy(this.camera.position);
      this.savedCameraTarget.copy(this.controls.target);
      this.savedCameraUp.copy(this.camera.up);
    }
    this.flatTestActive=true;
    this.solar.visible=false;
    this.flatTestGroup.visible=true;
    this.flatTestGroup.position.set(worldOffset,0,0);
    const center=this.flatTestGroup.position;
    this.camera.position.set(center.x+0,center.y+14,center.z+18);
    this.camera.up.set(0,1,0);
    this.controls.target.copy(center);
    this.controls.minDistance=.1;
    this.controls.maxDistance=this.systemViewDistance;
    this.camera.near=.001;
    this.camera.far=1000;
    this.camera.lookAt(center);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  exitFlatClipmapTest(){
    if(!this.flatTestActive)return;
    this.flatTestActive=false;
    this.flatTestGroup.visible=false;
    this.solar.visible=true;
    this.camera.position.copy(this.savedCameraPosition);
    this.camera.up.copy(this.savedCameraUp);
    this.controls.target.copy(this.savedCameraTarget);
    this.controls.minDistance=this.thirdPerson ? 0.003 : this.activeRadius+1;
    this.controls.maxDistance=this.thirdPerson?150000:this.systemViewDistance;
    this.controls.update();
    this.updateDepthRange();
  }

  private get activeCenter(){return this.focusedMoon?this.moonCenter:this.planetCenter;}
  private get activeRadius(){return this.focusedMoon?this.moonRadius:this.radius;}
  private get activeClipmap(){return this.focusedMoon?this.moonClipmap:this.clipmap;}
  private get activeGravity(){return this.focusedMoon?1.62:9.81;}
  private activePlanetLocalDirection(worldDirection:THREE.Vector3){
    const body=this.focusedMoon?this.solar.moon:this.solar.earth;
    const bodyWorldRotation=new THREE.Quaternion();
    body.getWorldQuaternion(bodyWorldRotation);
    return worldDirection.clone().applyQuaternion(bodyWorldRotation.invert()).normalize();
  }

  private activeTerrainHeightKm(worldDirection:THREE.Vector3){
    // The shader samples the height field in the celestial body's local frame.
    // Collision and avatar placement must use that exact same direction.
    const localDirection=this.activePlanetLocalDirection(worldDirection);
    return this.focusedMoon
      ?terrainBlueprint.heightKm(localDirection,this.moonTerrainSettings,0)
      :this.terrainHeightKm(localDirection);
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
    this.player.detach();
    this.thirdPerson=false;
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
    this.player.detach();
    this.thirdPerson=false;
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
    this.avatar.name='Player';
    this.avatar.visible=false;
    this.scene.add(this.avatar);

    // Clean built-in humanoid placeholder. All dimensions are kilometres;
    // the character is 1.8 m tall and its origin is at the feet.
    const skin=new THREE.MeshStandardMaterial({color:0xd9a77e,roughness:.82});
    const suit=new THREE.MeshStandardMaterial({color:0x263f59,roughness:.9});
    const accent=new THREE.MeshStandardMaterial({color:0xe0a43b,roughness:.75});
    const boot=new THREE.MeshStandardMaterial({color:0x18232d,roughness:.95});
    const add=(geometry:THREE.BufferGeometry,material:THREE.Material,x:number,y:number,z:number)=>{
      const mesh=new THREE.Mesh(geometry,material);
      mesh.position.set(x,y,z);
      mesh.castShadow=true;
      mesh.receiveShadow=true;
      this.avatar.add(mesh);
      return mesh;
    };
    add(new THREE.CapsuleGeometry(.00017,.00048,5,10),suit,0,.00102,0);
    add(new THREE.SphereGeometry(.00017,12,8),accent,0,.00058,0);
    add(new THREE.SphereGeometry(.00013,16,12),skin,0,.00161,0);
    // Neck
    add(new THREE.CylinderGeometry(.000055,.000065,.00009,8),skin,0,.00143,0);
    // Arms, slightly angled away from the torso.
    for(const side of [-1,1]){
      const arm=add(new THREE.CapsuleGeometry(.000065,.00040,4,8),suit,side*.000255,.00102,0);
      arm.rotation.z=side*-.16;
      const hand=add(new THREE.SphereGeometry(.00007,8,6),skin,side*.00030,.00072,-.000015);
      const leg=add(new THREE.CapsuleGeometry(.00009,.00043,4,8),suit,side*.000095,.00031,0);
      leg.rotation.z=side*-.025;
      add(new THREE.BoxGeometry(.00019,.00011,.00034),boot,side*.000095,.000075,-.000065);
    }
    // Small chest marker makes the character's facing direction readable.
    add(new THREE.BoxGeometry(.00019,.00012,.000025),accent,0,.00113,-.000174);
  }

  private updateCameraMode(){
    this.thirdPerson=this.player.isActive;
    if(this.thirdPerson)return;
    const altitude=this.camera.position.distanceTo(this.activeCenter)-this.activeRadius;
    if(altitude>80)return;

    // Enter surface mode at the exact procedural ground height. The player
    // controller owns movement, gravity, mouse look and the local camera.
    const radial=this.camera.position.clone().sub(this.activeCenter).normalize();
    this.player.enter(this.activeCenter,this.activeRadius,radial);
    this.thirdPerson=true;
    this.updateDepthRange();
  }

  start(){
    if(this.running)return;
    this.running=true;
    const tick=()=>{
      if(!this.running)return;
      this.frame=requestAnimationFrame(tick);
      if(this.flatTestActive){
        this.controls.update();
        this.renderer.render(this.scene,this.camera);
        return;
      }
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
      if(this.player.isActive) this.player.shiftWorld(activeDelta);
      this.updateCameraMode();
      if(this.settings.autoRotate && !this.thirdPerson){
        const offset=this.camera.position.clone().sub(this.controls.target);
        offset.applyAxisAngle(new THREE.Vector3(0,1,0),.0008*this.settings.rotationSpeed);
        this.camera.position.copy(this.controls.target).add(offset);
        this.camera.lookAt(this.controls.target);
      }
      if(this.player.isActive){
        this.player.update(deltaTime,this.activeCenter,this.activeRadius,this.activeGravity);
        this.thirdPerson=true;
      }else{
        this.controls.update();
        this.thirdPerson=false;
      }
      this.updateDepthRange();
      this.updatePlanetRenderPass(t);
      this.renderer.render(this.scene,this.camera);
    };
    tick();
  }

  getTelemetry(){
    return{
      altitude:this.flatTestActive
        ? this.camera.position.distanceTo(this.flatTestGroup.position)
        : this.thirdPerson ? this.camera.position.distanceTo(this.controls.target) : Math.max(0,this.camera.position.distanceTo(this.activeCenter)-this.activeRadius),
      testMode:this.flatTestActive,
      testOffset:this.flatTestActive?this.flatTestGroup.position.x:0,
      surfaceMode:this.player.isActive,
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
      this.controls.maxDistance=this.systemViewDistance;
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
    this.player.dispose();
    this.scene.remove(this.avatar);
    this.scene.remove(this.flatTestGroup);
    this.flatTestGroup.traverse(object=>{if(object instanceof THREE.Mesh){object.geometry.dispose();const material=object.material;if(Array.isArray(material))material.forEach(m=>m.dispose());else material.dispose();}else if(object instanceof THREE.Line){object.geometry.dispose();const material=object.material;if(Array.isArray(material))material.forEach(m=>m.dispose());else material.dispose();}});
    this.resize.dispose();
    this.clipmap.dispose();
    this.moonClipmap.dispose();
    this.scene.remove(this.solar);
    this.renderer.dispose();
  }
}
