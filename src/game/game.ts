import * as THREE from 'three';
import './game.css';
import { DEFAULT_PLANET, terrainHeight, terrainHeightGLSL } from './planet/blueprint.js';
import { PLANET_RADIUS, frameAt, fromWorld, gravityAt, moveOnSurface, toWorld, type GeoPosition } from './planet/coordinates.js';

const root=document.querySelector<HTMLElement>('#game-root');
if(!root) throw new Error('Game root not found');
root.innerHTML=`
 <section class="game-shell">
  <div class="game-hud"><div class="brand"><span class="brand-mark">◉</span><div><b>PLANETARY WORLD</b><small>OPEN PLANET SIMULATION</small></div></div><div class="location"><span id="coordinates">0.00° N · 0.00° E</span><b id="altitude">0 m</b></div><button id="flight" class="flight">ПОЛЁТ: ВЫКЛ.</button></div>
  <div id="viewport" class="viewport"></div>
  <div class="crosshair"></div>
  <div class="bottom-hud"><div class="status"><i></i><span id="surface-state">НА ПОВЕРХНОСТИ</span></div><div class="controls">WASD — движение <span>·</span> мышь — обзор <span>·</span> Space — прыжок / тяга <span>·</span> Shift — тормоз <span>·</span> F — режим полёта</div></div>
  <div class="hint" id="hint">Кликни по миру, чтобы захватить мышь · Esc — освободить</div>
 </section>`;
const viewport=document.querySelector<HTMLElement>('#viewport')!;
const coordinates=document.querySelector<HTMLElement>('#coordinates')!;
const altitudeLabel=document.querySelector<HTMLElement>('#altitude')!;
const surfaceState=document.querySelector<HTMLElement>('#surface-state')!;
const flightButton=document.querySelector<HTMLButtonElement>('#flight')!;
const hint=document.querySelector<HTMLElement>('#hint')!;

const scene=new THREE.Scene();
scene.background=new THREE.Color('#020611');
const camera=new THREE.PerspectiveCamera(68,1,0.1,80_000_000);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.1;
viewport.append(renderer.domElement);

const blueprint=DEFAULT_PLANET;
const terrainGLSL=terrainHeightGLSL(blueprint);
const planetVertex=`
 uniform float uRadius;
 varying vec3 vDirection;
 varying float vHeight;
 varying vec3 vWorld;
 ${terrainGLSL}
 void main(){
  vec3 direction=normalize(position);
  float h=planetHeight(direction);
  vec3 world=direction*(uRadius+h);
  vDirection=direction;vHeight=h;vWorld=world;
  gl_Position=projectionMatrix*viewMatrix*vec4(world,1.0);
 }`;
const planetFragment=`
 varying vec3 vDirection;varying float vHeight;varying vec3 vWorld;
 uniform vec3 uSun;
 void main(){
  vec3 n=normalize(vDirection);
  float slope=1.0-max(0.0,dot(normalize(cross(dFdx(vWorld),dFdy(vWorld))),n));
  float broad=clamp((vHeight+900.0)/2800.0,0.0,1.0);
  vec3 low=mix(vec3(0.055,0.16,0.105),vec3(0.19,0.28,0.16),broad);
  vec3 high=mix(vec3(0.25,0.24,0.20),vec3(0.76,0.78,0.76),clamp((vHeight-2100.0)/2600.0,0.0,1.0));
  vec3 color=mix(low,high,clamp((vHeight-900.0)/2600.0,0.0,1.0));
  color=mix(color,vec3(0.035,0.18,0.25),smoothstep(-260.0,-80.0,vHeight)*0.9);
  float light=0.22+0.78*max(0.0,dot(n,normalize(uSun)));
  gl_FragColor=vec4(color*light,1.0);
 }`;
const planetMaterial=new THREE.ShaderMaterial({
 uniforms:{uRadius:{value:blueprint.radius},uSun:{value:new THREE.Vector3(-0.4,0.7,0.5).normalize()}},
 vertexShader:planetVertex,fragmentShader:planetFragment
});
const planet=new THREE.Mesh(new THREE.SphereGeometry(1,256,160),planetMaterial);
planet.frustumCulled=false;scene.add(planet);

const patchVertex=`
 uniform float uRadius;uniform vec3 uUp;uniform vec3 uEast;uniform vec3 uNorth;
 varying vec3 vDirection;varying float vHeight;varying vec3 vWorld;
 ${terrainGLSL}
 void main(){
  vec3 direction=normalize(uUp+uEast*(position.x/uRadius)+uNorth*(position.y/uRadius));
  float h=planetHeight(direction);
  vec3 world=direction*(uRadius+h+1.5);
  vDirection=direction;vHeight=h;vWorld=world;
  gl_Position=projectionMatrix*viewMatrix*vec4(world,1.0);
 }`;
const patchFragment=`
 varying vec3 vDirection;varying float vHeight;varying vec3 vWorld;uniform vec3 uSun;
 void main(){
  vec3 n=normalize(vDirection);float h=vHeight;
  vec3 grass=mix(vec3(0.075,0.20,0.095),vec3(0.29,0.35,0.17),clamp((h+500.0)/2600.0,0.0,1.0));
  vec3 rock=mix(vec3(0.27,0.25,0.21),vec3(0.56,0.53,0.47),clamp((h-1200.0)/2600.0,0.0,1.0));
  vec3 color=mix(grass,rock,smoothstep(1250.0,3300.0,h));
  color=mix(color,vec3(0.86,0.89,0.91),smoothstep(3400.0,5100.0,h));
  color=mix(color,vec3(0.035,0.18,0.25),1.0-smoothstep(-260.0,-90.0,h));
  float light=0.24+0.76*max(0.0,dot(n,normalize(uSun)));
  gl_FragColor=vec4(color*light,1.0);
 }`;
const patchMaterial=new THREE.ShaderMaterial({
 uniforms:{uRadius:{value:blueprint.radius},uUp:{value:new THREE.Vector3(1,0,0)},uEast:{value:new THREE.Vector3(0,0,1)},uNorth:{value:new THREE.Vector3(0,1,0)},uSun:{value:new THREE.Vector3(-0.4,0.7,0.5).normalize()}},
 vertexShader:patchVertex,fragmentShader:patchFragment,side:THREE.DoubleSide
});
const patch=new THREE.Mesh(new THREE.PlaneGeometry(180_000,180_000,320,320),patchMaterial);
patch.frustumCulled=false;scene.add(patch);

const atmosphereMaterial=new THREE.ShaderMaterial({
 transparent:true,depthWrite:false,side:THREE.BackSide,
 uniforms:{uCamera:{value:new THREE.Vector3()},uRadius:{value:blueprint.radius},uAtmosphere:{value:blueprint.atmosphereHeight}},
 vertexShader:`varying vec3 vWorld;void main(){vec4 w=modelMatrix*vec4(position,1.0);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
 fragmentShader:`varying vec3 vWorld;uniform vec3 uCamera;uniform float uRadius;uniform float uAtmosphere;void main(){vec3 ray=normalize(vWorld-uCamera);vec3 radial=normalize(vWorld);float rim=1.0-abs(dot(ray,radial));float density=exp(-max(0.0,length(uCamera)-uRadius)/uAtmosphere);float alpha=pow(clamp(rim,0.0,1.0),2.2)*0.34*density;gl_FragColor=vec4(0.20,0.48,0.95,alpha);}`
});
const atmosphere=new THREE.Mesh(new THREE.SphereGeometry(blueprint.radius+blueprint.atmosphereHeight,128,80),atmosphereMaterial);
atmosphere.frustumCulled=false;scene.add(atmosphere);

const starCount=6500,starPositions=new Float32Array(starCount*3);
let random=blueprint.seed>>>0;
const rand=()=>{random=(random*1664525+1013904223)>>>0;return random/4294967296;};
for(let i=0;i<starCount;i++){
 const y=rand()*2-1,a=rand()*Math.PI*2,r=Math.sqrt(1-y*y),d=18_000_000+rand()*8_000_000;
 starPositions[i*3]=Math.cos(a)*r*d;starPositions[i*3+1]=y*d;starPositions[i*3+2]=Math.sin(a)*r*d;
}
const starGeometry=new THREE.BufferGeometry();starGeometry.setAttribute('position',new THREE.BufferAttribute(starPositions,3));
const stars=new THREE.Points(starGeometry,new THREE.PointsMaterial({color:'#dce8ff',size:12000,sizeAttenuation:true,transparent:true,opacity:0.85}));
scene.add(stars);

const sun=new THREE.DirectionalLight(0xffffff,2.2);sun.position.set(-8_000_000,12_000_000,9_000_000);scene.add(sun);
scene.add(new THREE.AmbientLight(0x7895c8,0.32));

const playerGeometry=new THREE.CapsuleGeometry(0.42,0.9,6,12);
const playerMaterial=new THREE.MeshStandardMaterial({color:'#e4b47b',roughness:0.8});
const player=new THREE.Mesh(playerGeometry,playerMaterial);player.castShadow=false;scene.add(player);

let geo:GeoPosition={latitude:48.2,longitude:16.37,altitude:2};
let worldPosition=toWorld(geo);
worldPosition.setLength(surfaceRadius(worldPosition.clone().normalize())+1.15);
let velocity=new THREE.Vector3();
let onGround=true,flightMode=false;
let yaw=0,pitch=-0.18,cameraDistance=7.5;
let pointerLocked=false;
const keys=new Set<string>();
const upAxis=new THREE.Vector3(0,1,0);
const cameraTarget=new THREE.Vector3();
const cameraOffset=new THREE.Vector3();
const clock=new THREE.Clock();

function surfaceRadius(direction:THREE.Vector3):number{return blueprint.radius+terrainHeight(direction,blueprint);}
function updatePlanetFrame():void {
 geo=fromWorld(worldPosition);
 const f=frameAt(geo.latitude,geo.longitude);
 patchMaterial.uniforms.uUp.value.copy(f.up);
 patchMaterial.uniforms.uEast.value.copy(f.east);
 patchMaterial.uniforms.uNorth.value.copy(f.north);
 patch.position.copy(f.up).multiplyScalar(blueprint.radius);
 atmosphereMaterial.uniforms.uCamera.value.copy(camera.position);
 player.position.copy(worldPosition);
 player.quaternion.setFromUnitVectors(upAxis,f.up);
 const altitude=worldPosition.length()-surfaceRadius(f.up);
 coordinates.textContent=`${Math.abs(geo.latitude).toFixed(3)}° ${geo.latitude>=0?'N':'S'} · ${Math.abs(geo.longitude).toFixed(3)}° ${geo.longitude>=0?'E':'W'}`;
 altitudeLabel.textContent=altitude>=1000?`${(altitude/1000).toFixed(2)} km`:`${Math.round(altitude)} m`;
 const atmosphereFactor=THREE.MathUtils.clamp(altitude/blueprint.atmosphereHeight,0,1);
 scene.background=new THREE.Color().lerpColors(new THREE.Color('#78b9e8'),new THREE.Color('#020611'),THREE.MathUtils.smoothstep(atmosphereFactor,0.05,0.95));
 surfaceState.textContent=onGround?'НА ПОВЕРХНОСТИ':altitude>blueprint.atmosphereHeight?'КОСМОС':flightMode?'ПОЛЁТ':'СВОБОДНОЕ ПАДЕНИЕ';
 flightButton.textContent=flightMode?'ПОЛЁТ: ВКЛ.':'ПОЛЁТ: ВЫКЛ.';
 flightButton.classList.toggle('active',flightMode);
}
function updateCamera():void {
 const f=frameAt(geo.latitude,geo.longitude);
 const forward=f.north.clone().multiplyScalar(Math.cos(yaw)).addScaledVector(f.east,Math.sin(yaw));
 const right=new THREE.Vector3().crossVectors(f.up,forward).normalize();
 const look=forward.multiplyScalar(Math.cos(pitch)).addScaledVector(f.up,Math.sin(pitch)).normalize();
 cameraTarget.copy(worldPosition).addScaledVector(f.up,1.2);
 cameraOffset.copy(look).multiplyScalar(-cameraDistance).addScaledVector(f.up,Math.sin(-pitch)*cameraDistance*0.35);
 camera.position.copy(cameraTarget).add(cameraOffset);
 camera.up.copy(f.up);
 camera.lookAt(cameraTarget.clone().addScaledVector(look,20));
 camera.near=Math.max(0.1,Math.min(10,geo.altitude*0.00001+0.1));
 camera.far=Math.max(80_000_000,geo.altitude+40_000_000);
 camera.updateProjectionMatrix();
 atmosphereMaterial.uniforms.uCamera.value.copy(camera.position);
}
function movePlayer(dt:number):void {
 const f=frameAt(geo.latitude,geo.longitude);
 const forward=f.north.clone().multiplyScalar(Math.cos(yaw)).addScaledVector(f.east,Math.sin(yaw)).normalize();
 const right=new THREE.Vector3().crossVectors(forward,f.up).normalize();
 const forwardInput=(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0);
 const sideInput=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0);
 const input=new THREE.Vector3().addScaledVector(forward,forwardInput).addScaledVector(right,sideInput);
 if(input.lengthSq()>1)input.normalize();
 const gravity=gravityAt(worldPosition,blueprint.gravity);
 if(flightMode){
  const thrust=input.multiplyScalar(45).addScaledVector(f.up,((keys.has('Space')?1:0)-(keys.has('ShiftLeft')||keys.has('ShiftRight')?1:0))*65);
  velocity.addScaledVector(gravity.add(thrust),dt);
  velocity.multiplyScalar(Math.exp(-0.035*dt));
  worldPosition.addScaledVector(velocity,dt);
  onGround=false;
 }else{
  const speed=7.5;
  const tangent=input.multiplyScalar(speed);
  if(onGround&&keys.has('Space')){velocity.addScaledVector(f.up,6.5);onGround=false;}
  if(onGround){
   const moved=moveOnSurface(geo,tangent.dot(f.east)*dt,tangent.dot(f.north)*dt);
   geo=moved;
   worldPosition=toWorld({...geo,altitude:0});
   worldPosition.setLength(surfaceRadius(worldPosition.clone().normalize())+1.15);
   velocity.set(0,0,0);
  }else{
   velocity.addScaledVector(gravity,dt);
   velocity.addScaledVector(input,dt*7);
   worldPosition.addScaledVector(velocity,dt);
  }
 }
 const direction=worldPosition.clone().normalize();
 const floor=surfaceRadius(direction);
 const radius=worldPosition.length();
 if(radius<=floor+1.15){
  worldPosition.copy(direction.multiplyScalar(floor+1.15));
  const radialVelocity=velocity.dot(direction);
  if(radialVelocity<0)velocity.addScaledVector(direction,-radialVelocity);
  onGround=true;
 }else onGround=false;
}
function animate():void {
 const dt=Math.min(clock.getDelta(),0.04);
 movePlayer(dt);
 updatePlanetFrame();
 updateCamera();
 renderer.render(scene,camera);
 requestAnimationFrame(animate);
}
function resize():void{
 const w=viewport.clientWidth,h=viewport.clientHeight;
 if(!w||!h)return;
 camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);
}
const observer=new ResizeObserver(resize);observer.observe(viewport);resize();

renderer.domElement.addEventListener('click',()=>{if(!pointerLocked)renderer.domElement.requestPointerLock();});
document.addEventListener('pointerlockchange',()=>{pointerLocked=document.pointerLockElement===renderer.domElement;hint.classList.toggle('hidden',pointerLocked);});
document.addEventListener('mousemove',e=>{if(!pointerLocked)return;yaw-=e.movementX*0.0022;pitch=THREE.MathUtils.clamp(pitch+e.movementY*0.0018,-1.35,1.25);});
document.addEventListener('keydown',e=>{
 if(['Space','ShiftLeft','ShiftRight','KeyW','KeyA','KeyS','KeyD'].includes(e.code))e.preventDefault();
 if(e.code==='KeyF'&&!e.repeat){flightMode=!flightMode;velocity.set(0,0,0);onGround=false;}
 keys.add(e.code);
});
document.addEventListener('keyup',e=>keys.delete(e.code));
document.addEventListener('wheel',e=>{cameraDistance=THREE.MathUtils.clamp(cameraDistance+e.deltaY*0.012,3,1500);},{passive:true});
flightButton.addEventListener('click',()=>{flightMode=!flightMode;onGround=false;});
document.addEventListener('pointerlockchange',()=>{if(!pointerLocked)keys.clear();});
window.addEventListener('blur',()=>keys.clear());
updatePlanetFrame();updateCamera();requestAnimationFrame(animate);
window.addEventListener('beforeunload',()=>{observer.disconnect();renderer.dispose();planet.geometry.dispose();planetMaterial.dispose();patch.geometry.dispose();patchMaterial.dispose();atmosphere.geometry.dispose();atmosphereMaterial.dispose();starGeometry.dispose();playerGeometry.dispose();playerMaterial.dispose();});
