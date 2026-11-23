import { hash2, smooth01, noise2, fbm, originalBaseHeight, hashPixel, tnoise, tfbm, fbmXZ, ridgedXZ } from "./math/noise.js";
import { NOISE_GLSL } from "./shaders/noise.glsl.js";
import { terrainVertexTemplate, terrainFragmentTemplate, wireFragmentShader } from "./shaders/terrain.js";
import { waterVertex, waterFragTemplate } from "./shaders/water.js";
import { makeTexture, createMacroTexture, createDetailTexture } from "./textures/procedural.js";
import { F, oc, lin, NODE_TYPES } from "./graph/nodes.js";
import { compileGraph, previewGraph } from "./graph/compiler.js";
import { QUALITY_PRESETS } from "./config/quality.js";
import { f32ToB64, b64ToF32 } from "./persistence/float32.js";
import { PRESET_GRAPHS, defaultGraph, ensureEnv } from "./legacy/graphPresets.js";
import { StrokeHistory } from "./legacy/StrokeHistory.js";

(async()=>{
try{

const THREE=await import("three");

// SCENE

const scene=new THREE.Scene();
const SKY=0x9dc7e1;
scene.background=new THREE.Color(SKY);

const camera=new THREE.PerspectiveCamera(72,innerWidth/innerHeight,.3,7000);

let pixelCap=1.6;

const renderer=new THREE.WebGLRenderer({
 antialias:true,
 powerPreference:"high-performance"
});

renderer.setPixelRatio(Math.min(devicePixelRatio,pixelCap));
renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.15;

document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xcce8ff,0x65704c,1.9));

const sun=new THREE.DirectionalLight(0xfff0d5,2.1);
sun.position.set(-65,105,55);
scene.add(sun);

// WORLD DATA

const history = new StrokeHistory(30);
const { undoStack, redoStack } = history;

let selectedTool="raise";
let brushRadius=4.5;
let brushStrength=2.2;
let brushSoft=.7;
let flattenTarget=null;
let showGrid=false;
let showTriangles=false;

// КАЧЕСТВО (меняется во вкладке "Качество", сохраняется в браузере)

const Q={...QUALITY_PRESETS.medium};
try{
 const saved=JSON.parse(localStorage.getItem("terrainQ")||"{}");
 for(const k in Q)if(k in saved&&typeof saved[k]===typeof Q[k])Q[k]=saved[k];
}catch{}
pixelCap=Q.scale;
renderer.setPixelRatio(Math.min(devicePixelRatio,pixelCap));
let GROUND_CELL=Q.cell;
let brushSlope=.35;
let flattenMode="stroke";
let pinHeight=10;
let skipMouse=0;

// CPU HEIGHT FIELD

let baseHeightFn=originalBaseHeight;
function baseHeightAt(x,z){return baseHeightFn(x,z);}

function smoothFalloff(d,r,soft){
 if(d>=r)return 0;

 const t=1-d/r;
 const edge=Math.pow(t,.4+(1-soft)*3);

 return edge*edge*(3-2*edge);
}

function heightAt(x,z){
 return baseHeightAt(x,z)+deltaAtCPU(x,z);
}

// Высота ровно по треугольникам видимой сетки LOD0 (шаг 1 м, диагональ b–c как в индексах меша).
function groundHeight(x,z){
 const c=GROUND_CELL;
 const gx=x/c,gz=z/c;
 const ix=Math.floor(gx),iz=Math.floor(gz);
 const fx=gx-ix,fz=gz-iz;
 const hA=heightAt(ix*c,iz*c),hB=heightAt((ix+1)*c,iz*c);
 const hC=heightAt(ix*c,(iz+1)*c),hD=heightAt((ix+1)*c,(iz+1)*c);
 if(fx+fz<=1)return hA+(hB-hA)*fx+(hC-hA)*fz;
 return hD+(hC-hD)*(1-fx)+(hB-hD)*(1-fz);
}

// TEXTURE

let macroTexture=createMacroTexture(THREE,Q.tex,Q.filter,Q.aniso,renderer.capabilities.getMaxAnisotropy());
let detailTexture=createDetailTexture(THREE,Q.tex,Q.filter,Q.aniso,renderer.capabilities.getMaxAnisotropy());

function rebuildTextures(){
 const old=[macroTexture,detailTexture];
 macroTexture=createMacroTexture(THREE,Q.tex,Q.filter,Q.aniso,renderer.capabilities.getMaxAnisotropy());
 detailTexture=createDetailTexture(THREE,Q.tex,Q.filter,Q.aniso,renderer.capabilities.getMaxAnisotropy());
 uniforms.uMacroTex.value=macroTexture;
 uniforms.uDetailTex.value=detailTexture;
 old.forEach(t=>t.dispose());
}

function refreshTexParams(){
 for(const t of [macroTexture,detailTexture]){
  t.magFilter=Q.filter==="pixel"?THREE.NearestFilter:THREE.LinearFilter;
  t.anisotropy=Math.min(Q.aniso,renderer.capabilities.getMaxAnisotropy());
  t.needsUpdate=true;
 }
}

// GPU SHADER
// Все уровни — одна сетка CLIP_N×CLIP_N, масштабируемая на 2^level. Центр каждого уровня
// привязан к своему шагу, поэтому вершины всегда лежат на мировой сетке (ничего не "плывёт").
// К внешнему краю уровень плавно (geomorph) сливается с геометрией следующего, а следующий
// уровень рисуется только за этой зоной — без трещин и скачков при движении.
let CLIP_LEVELS=8;
let CLIP_N=96;
let CLIP_TILE=32;
let TILES=3;
let clipVisible=0;
const clipHalf=l=>CLIP_N*GROUND_CELL*(2**l)/2;
const clipMorphEnd=l=>clipHalf(l)-2*GROUND_CELL*(2**l);

const DELTA_T=1024;
let deltaArea=Q.area,deltaRes=deltaArea/DELTA_T,deltaOrg=-deltaArea/2;
const deltaData=new Float32Array(DELTA_T*DELTA_T);
const baseCache=new Float32Array(DELTA_T*DELTA_T).fill(NaN);
const strokeMark=new Uint32Array(DELTA_T*DELTA_T);
const deltaTexture=new THREE.DataTexture(deltaData,DELTA_T,DELTA_T,THREE.RedFormat,THREE.FloatType);
deltaTexture.minFilter=THREE.NearestFilter;
deltaTexture.magFilter=THREE.NearestFilter;
deltaTexture.generateMipmaps=false;
deltaTexture.needsUpdate=true;
let deltaDirty=false;

const uniforms={
 uMacroTex:{value:macroTexture},
 uDetailTex:{value:detailTexture},
 uAlt:{value:0},
 uDetailScale:{value:Q.detailSize},
 uDetailStrength:{value:Q.detailStr},
 uDelta:{value:deltaTexture},
 uDeltaInfo:{value:new THREE.Vector4(deltaOrg,deltaOrg,1/deltaRes,DELTA_T)},
 uSunDirection:{value:new THREE.Vector3(-.45,.78,.42).normalize()},
 uSunColor:{value:new THREE.Color(0xfff0d5)},
 uAmbient:{value:new THREE.Color(0x9bb5a0)},
 uGrid:{value:0},
 uFogColor:{value:new THREE.Vector3(0x9d/255,0xc7/255,0xe1/255)},
 uFogNear:{value:700},
 uFogFar:{value:5200}
};







// GRAPH CORE
// Граф узлов компилируется в GLSL (вершинный шейдер: высота, фрагментный: цвет) и в
// CPU-вычислитель высоты (физика, кисть). Узлы описаны один раз: e — GLSL, j — CPU.





// GRAPH INSTALL

let graphOpen=false;
let terrainVertexShader="",terrainFragmentShader="";
let graph=null,reverting=false,goodTimer=0;
const DEFAULT_JSON=JSON.stringify(defaultGraph());
let goodGraphJSON=DEFAULT_JSON;

function setGraphStatus(msg,err){
 const el=document.getElementById("gStatus");
 if(el){
  el.textContent=msg;
  el.style.color=err?"#ff8a8a":"#8affc1";
 }
}

// ASSETS: встроенные и загруженные пользователем текстуры

const assets=new Map();
const fallbackTex=new THREE.DataTexture(new Uint8Array([128,128,128,255]),1,1,THREE.RGBAFormat);
fallbackTex.colorSpace=THREE.SRGBColorSpace;
fallbackTex.needsUpdate=true;
for(let i=0;i<8;i++)uniforms["uAsset"+i]={value:fallbackTex};

function assetTexture(id){
 const a=assets.get(id);
 return a?a.texture:fallbackTex;
}

function registerAsset(id,name,canvas,builtin,tex){
 if(!tex){
  tex=new THREE.CanvasTexture(canvas);
  tex.colorSpace=THREE.SRGBColorSpace;
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  tex.generateMipmaps=true;
  tex.minFilter=THREE.LinearMipmapLinearFilter;
  tex.magFilter=THREE.LinearFilter;
  tex.anisotropy=Math.min(Q.aniso,renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate=true;
 }
 const sm=document.createElement("canvas");
 sm.width=sm.height=64;
 const sctx=sm.getContext("2d");
 sctx.drawImage(canvas,0,0,64,64);
 const a={id,name,builtin,texture:tex,canvas,small:sctx.getImageData(0,0,64,64).data};
 assets.set(id,a);
 return a;
}

function assetSample(id,u,v){
 const a=assets.get(id);
 if(!a)return [.5,.5,.5];
 const N=64,ix=((Math.floor(u*N)%N)+N)%N,iy=((Math.floor(v*N)%N)+N)%N,k=(iy*N+ix)*4,d=a.small;
 return [SRGB_LUT[d[k]],SRGB_LUT[d[k+1]],SRGB_LUT[d[k+2]]];
}

const BUILTIN_ASSETS=[
 ["b_grass","Трава",(u,v)=>{const t=.75+tfbm(u,v,8,4,3)*.5+(tfbm(u,v,64,2,9)-.5)*.35;return [52*t,106*t,36*t];}],
 ["b_rock","Скала",(u,v)=>{const t=.55+tfbm(u,v,6,5,5)*.7+(tfbm(u,v,24,3,8)-.5)*.4;return [112*t,106*t,98*t];}],
 ["b_sand","Песок",(u,v,x,y)=>{const t=.85+tfbm(u,v,10,3,2)*.25+(hashPixel(x,y,7)-.5)*.18;return [214*t,190*t,140*t];}],
 ["b_dirt","Земля",(u,v,x,y)=>{const t=.6+tfbm(u,v,6,5,6)*.6+(hashPixel(x,y,3)-.5)*.2;return [112*t,80*t,52*t];}],
 ["b_snow","Снег",(u,v,x,y)=>{const t=.9+tfbm(u,v,8,3,4)*.12+(hashPixel(x,y,11)-.5)*.06;return [238*t,244*t,250*t];}],
 ["b_gravel","Гравий",(u,v,x,y)=>{const t=.5+tfbm(u,v,48,2,1)*.6+(tfbm(u,v,12,3,13)-.5)*.3+(hashPixel(x,y,19)-.5)*.2;return [130*t,126*t,120*t];}]
];

for(const [id,name,fill] of BUILTIN_ASSETS){
 const tex=makeTexture(THREE,256,fill,true,Q.filter,Q.aniso,renderer.capabilities.getMaxAnisotropy());
 const c=document.createElement("canvas");
 c.width=c.height=256;
 const cx=c.getContext("2d"),img=cx.createImageData(256,256);
 img.data.set(tex.image.data);
 cx.putImageData(img,0,0);
 registerAsset(id,name,c,true,tex);
}

// Загруженные ассеты хранятся в IndexedDB браузера.
const idbReady=(()=>{
 try{
  return new Promise((res,rej)=>{
   const r=indexedDB.open("terrainAssets",1);
   r.onupgradeneeded=()=>r.result.createObjectStore("a",{keyPath:"id"});
   r.onsuccess=()=>res(r.result);
   r.onerror=()=>rej(r.error);
  });
 }catch(e){return Promise.reject(e);}
})();
idbReady.catch(()=>{});

const idbTx=async(mode,fn)=>{
 const db=await idbReady;
 return new Promise((res,rej)=>{
  const t=db.transaction("a",mode),r=fn(t.objectStore("a"));
  t.oncomplete=()=>res(r&&r.result);
  t.onerror=()=>rej(t.error);
 });
};
const dbPut=rec=>idbTx("readwrite",st=>st.put(rec));
const dbDel=id=>idbTx("readwrite",st=>st.delete(id));
const dbAll=()=>idbTx("readonly",st=>st.getAll());

async function addUserAsset(file,id,name,persist){
 const bmp=await createImageBitmap(file);
 const sc=Math.min(1,1024/Math.max(bmp.width,bmp.height));
 const c=document.createElement("canvas");
 c.width=Math.max(1,Math.round(bmp.width*sc));
 c.height=Math.max(1,Math.round(bmp.height*sc));
 c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);
 id=id||"u_"+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
 name=name||(file.name||"текстура").replace(/\.[^.]+$/,"").slice(0,26);
 const a=registerAsset(id,name,c,false);
 if(persist){
  try{await dbPut({id,name,blob:file});}
  catch(e){setGraphStatus("Ассет не сохранён в браузере (только на эту сессию)",true);}
 }
 return a;
}

// ENVIRONMENT: океан и туман (настраиваются узлами «▶ Океан» и «▶ Туман»)

const waterU={
 uSea:{value:-6},
 uWaterShallow:{value:new THREE.Vector3(.03,.32,.36)},
 uWaterDeep:{value:new THREE.Vector3(.0,.025,.08)},
 uClarity:{value:.35},
 uWave:{value:1},
 uTime:{value:0},
 uWaveScale:{value:1},
 uWaveSpeed:{value:1},
 uGlint:{value:1},
 uFoam:{value:.75},
 uOpacity:{value:1},
 uShore:{value:.6},
 uFade:{value:220}
};





const waterMesh=new THREE.Mesh(new THREE.PlaneGeometry(2,2).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial());
waterMesh.frustumCulled=false;
waterMesh.renderOrder=10;
waterMesh.visible=false;
scene.add(waterMesh);

let seaLevel=-1e9,curFog=null;

function rebuildWater(c){
 waterMesh.material.dispose();
 waterMesh.material=new THREE.ShaderMaterial({
  uniforms:{...uniforms,...waterU},
  vertexShader:waterVertex,
  fragmentShader:waterFragTemplate.replace("__NOISE__",()=>NOISE_GLSL).replace("__GRAPH_HEIGHT__",()=>c.glHeight),
  transparent:true,
  depthWrite:false,
  side:THREE.DoubleSide
 });
}

function applyFog(){
 const f=curFog;
 const on=!f||f.on;
 const near=f&&f.near>0?f.near:Math.min(700,Q.dist*.15);
 const far=f&&f.far>0?f.far:Q.dist*.92;
 uniforms.uFogNear.value=on?near:1e8;
 uniforms.uFogFar.value=on?Math.max(far,near+1):2e8;
 const hex=f&&/^#[0-9a-f]{6}$/i.test(f.color)?f.color:"#9dc7e1";
 scene.background.set(hex);
 uniforms.uFogColor.value.set(parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255);
}

function applyEnvironment(c){
 const w=c.water;
 const on=!!(w&&w.on);
 seaLevel=on?w.level:-1e9;
 waterMesh.visible=on;
 if(on){
  waterU.uSea.value=w.level;
  waterU.uClarity.value=w.clarity;
  waterU.uWave.value=w.wave;
  waterU.uWaveScale.value=w.wscale;
  waterU.uWaveSpeed.value=w.wspeed;
  waterU.uGlint.value=w.glint;
  waterU.uFoam.value=w.foam;
  waterU.uOpacity.value=w.opacity;
  waterU.uShore.value=w.shore;
  waterU.uFade.value=w.fade;
  waterU.uWaterShallow.value.set(w.shallow[0],w.shallow[1],w.shallow[2]);
  waterU.uWaterDeep.value.set(w.deep[0],w.deep[1],w.deep[2]);
 }
 curFog=c.fog||null;
 applyFog();
}

function installCompiled(c,rebuild){
 baseHeightFn=c.js;
 terrainVertexShader=terrainVertexTemplate.replace("__NOISE__",()=>NOISE_GLSL).replace("__GRAPH_HEIGHT__",()=>c.glHeight);
 terrainFragmentShader=terrainFragmentTemplate.replace("__NOISE__",()=>NOISE_GLSL).replace("__GRAPH_COLOR__",()=>c.glColor);
 for(let i=0;i<8;i++)uniforms["uAsset"+i].value=i<c.assets.length?assetTexture(c.assets[i]):fallbackTex;
 baseCache.fill(NaN);
 rebuildWater(c);
 applyEnvironment(c);
 if(rebuild)buildClipmap();
}

// Граф сохраняется только после того, как шейдер отработал без ошибок.
function markGoodLater(){
 clearTimeout(goodTimer);
 goodTimer=setTimeout(()=>{
  goodGraphJSON=JSON.stringify(graph);
  try{localStorage.setItem("terrainGraph",goodGraphJSON);}catch{}
  setGraphStatus("Граф применён ✔");
 },1500);
}

function onGraphShaderError(log){
 console.error("Ошибка шейдера графа:",log);
 if(reverting)return;
 reverting=true;
 clearTimeout(goodTimer);
 try{
  graph=JSON.parse(goodGraphJSON);
  installCompiled(compileGraph(graph),true);
  try{localStorage.setItem("terrainGraph",goodGraphJSON);}catch{}
  renderGraph();
  setGraphStatus("Ошибка шейдера — восстановлен прошлый граф",true);
 }catch(e){console.error(e);}
 setTimeout(()=>{reverting=false;},3000);
}

renderer.debug.onShaderError=(gl,program,vs,fs)=>{
 onGraphShaderError((gl.getShaderInfoLog(vs)||"")+(gl.getShaderInfoLog(fs)||"")+(gl.getProgramInfoLog(program)||""));
};

try{
 const saved=JSON.parse(localStorage.getItem("terrainGraph")||"null");
 graph=saved&&Array.isArray(saved.nodes)?ensureEnv(saved):defaultGraph();
}catch{
 graph=defaultGraph();
}

try{
 installCompiled(compileGraph(graph),false);
}catch(err){
 console.error(err);
 graph=defaultGraph();
 installCompiled(compileGraph(graph),false);
}

markGoodLater();

// CLIPMAP GEOMETRY
// Каждый уровень разбит на тайлы 64×64: их можно отсечь по пирамиде видимости (то, что сзади,
// не рисуется), а тайлы целиком внутри "дырки" под более детальным уровнем пропускаются.

const clipmaps=[];

function createTileGeometry(tx,tz){

 const side=CLIP_TILE+1;
 const pos=new Float32Array(side*side*3);
 const idx=[];
 const ox=tx*CLIP_TILE-CLIP_N/2;
 const oz=tz*CLIP_TILE-CLIP_N/2;

 for(let z=0;z<side;z++){
  for(let x=0;x<side;x++){
   const i=(z*side+x)*3;
   pos[i]=ox+x;
   pos[i+2]=oz+z;
  }
 }

 for(let z=0;z<CLIP_TILE;z++){
  for(let x=0;x<CLIP_TILE;x++){
   const a=z*side+x,b=a+1,c=a+side,d=c+1;
   idx.push(a,c,b,b,c,d);
  }
 }

 const g=new THREE.BufferGeometry();
 g.setAttribute("position",new THREE.BufferAttribute(pos,3));
 g.setIndex(idx);
 g.boundingSphere=new THREE.Sphere(
  new THREE.Vector3(ox+CLIP_TILE/2,40,oz+CLIP_TILE/2),
  CLIP_TILE*.75+110
 );
 g.userData={ox,oz};
 return g;
}

const tileGeometries=[];

function disposeClipmap(){
 for(const clip of clipmaps){
  for(const t of clip.tiles){
   scene.remove(t.mesh);
   scene.remove(t.wireMesh);
  }
  clip.material.dispose();
  clip.wireMaterial.dispose();
 }
 tileGeometries.forEach(g=>g.dispose());
 clipmaps.length=0;
 tileGeometries.length=0;
}

// Число уровней подбирается так, чтобы покрыть Q.dist метров при сетке Q.grid.
function buildClipmap(){

 disposeClipmap();

 GROUND_CELL=Q.cell;
 CLIP_N=Q.grid;
 CLIP_TILE=CLIP_N>=192?64:Math.min(32,CLIP_N);
 TILES=CLIP_N/CLIP_TILE;
 CLIP_LEVELS=Math.max(3,Math.ceil(Math.log2(Q.dist/((CLIP_N/2-2)*GROUND_CELL)))+1);

 for(let tz=0;tz<TILES;tz++){
  for(let tx=0;tx<TILES;tx++){
   tileGeometries.push(createTileGeometry(tx,tz));
  }
 }

 for(let level=0;level<CLIP_LEVELS;level++){

  const step=GROUND_CELL*2**level;
  const outer=clipMorphEnd(level);
  const cut=level>0?clipMorphEnd(level-1):0;

  const levelUniforms={
   uStep:{value:step},
   uHalf:{value:clipHalf(level)},
   uCut:{value:cut},
   uOuter:{value:level<CLIP_LEVELS-1?outer:1e9},
   uLevel:{value:level}
  };

  // Положительный polygonOffset: более детальный уровень всегда побеждает в зоне перекрытия,
  // а линии сетки рисуются поверх поверхности.
  const material=new THREE.ShaderMaterial({
   uniforms:{...uniforms,...levelUniforms},
   vertexShader:terrainVertexShader,
   fragmentShader:terrainFragmentShader,
   side:THREE.DoubleSide,
   polygonOffset:true,
   polygonOffsetFactor:1+level,
   polygonOffsetUnits:1+level*2
  });

  const wireMaterial=new THREE.ShaderMaterial({
   uniforms:{...uniforms,...levelUniforms},
   vertexShader:terrainVertexShader,
   fragmentShader:wireFragmentShader,
   wireframe:true
  });

  const tiles=[];

  for(const geo of tileGeometries){

   const mesh=new THREE.Mesh(geo,material);
   const wireMesh=new THREE.Mesh(geo,wireMaterial);

   for(const m of [mesh,wireMesh]){
    m.scale.set(step,1,step);
   }

   mesh.renderOrder=level;
   wireMesh.renderOrder=20+level;
   wireMesh.visible=false;

   scene.add(mesh);
   scene.add(wireMesh);

   tiles.push({mesh,wireMesh,ox:geo.userData.ox,oz:geo.userData.oz});
  }

  clipmaps.push({level,step,cut,outer,tiles,material,wireMaterial});
 }

 // Туман полностью скрывает край террейна на заданной дальности.
 applyFog();
 waterMesh.scale.set(Q.dist*1.3,1,Q.dist*1.3);

 camera.far=Q.dist*1.25+300;
 camera.updateProjectionMatrix();
}

buildClipmap();

// Центр каждого уровня привязан к собственному шагу 2·step (чётность вершин сохраняется).
// LOD считается по расстоянию с учётом высоты над землёй: в полёте детальные кольца
// уходят вниз/вдаль, а мелкие уровни под тобой не рисуются.
function updateClipmaps(){

 const cx=camera.position.x;
 const cz=camera.position.z;

 const alt=Math.max(0,camera.position.y-groundHeight(cx,cz)-4);
 uniforms.uAlt.value=alt;
 waterMesh.position.set(cx,waterU.uSea.value,cz);

 let visible=0;

 for(const clip of clipmaps){

  const step=clip.step;
  const g=2*step;
  const x=Math.round(cx/g)*g;
  const z=Math.round(cz/g)*g;
  const size=CLIP_TILE*step;
  const last=clip.level===CLIP_LEVELS-1;

  for(const t of clip.tiles){

   t.mesh.position.set(x,0,z);
   t.wireMesh.position.set(x,0,z);

   const x0=x+t.ox*step,x1=x0+size;
   const z0=z+t.oz*step,z1=z0+size;

   const minD=Math.max(Math.max(x0-cx,0,cx-x1),Math.max(z0-cz,0,cz-z1),alt);
   const maxD=Math.max(Math.abs(x0-cx),Math.abs(x1-cx),Math.abs(z0-cz),Math.abs(z1-cz),alt);

   // Скрыт, если целиком под более детальным уровнем или целиком за зоной слияния.
   const show=maxD>=clip.cut&&(last||minD<clip.outer);

   t.mesh.visible=show;
   t.wireMesh.visible=show&&showTriangles;

   if(show)visible++;
  }
 }

 clipVisible=visible;
}

// EDIT LAYER
// Правки лежат в карте высот (дельта к процедурному рельефу) и применяются каждый кадр,
// пока кнопка мыши удержана. Одна и та же карта читается шейдером и CPU — физика совпадает.

function deltaAtCPU(x,z){
 const tx=(x-deltaOrg)/deltaRes,tz=(z-deltaOrg)/deltaRes;
 if(tx<-1||tz<-1||tx>=DELTA_T||tz>=DELTA_T)return 0;
 const ix=Math.floor(tx),iz=Math.floor(tz),fx=tx-ix,fz=tz-iz;
 const g=(i,j)=>(i<0||j<0||i>=DELTA_T||j>=DELTA_T)?0:deltaData[j*DELTA_T+i];
 const L=THREE.MathUtils.lerp;
 return L(L(g(ix,iz),g(ix+1,iz),fx),L(g(ix,iz+1),g(ix+1,iz+1),fx),fz);
}

function resetDelta(area){
 deltaArea=area;
 deltaRes=area/DELTA_T;
 deltaOrg=-area/2;
 deltaData.fill(0);
 baseCache.fill(NaN);
 uniforms.uDeltaInfo.value.set(deltaOrg,deltaOrg,1/deltaRes,DELTA_T);
 history.clear();
 deltaDirty=true;
}

function baseAtTexel(i,j){
 const k=j*DELTA_T+i;
 let b=baseCache[k];
 if(b!==b){
  b=baseHeightAt(deltaOrg+i*deltaRes,deltaOrg+j*deltaRes);
  baseCache[k]=b;
 }
 return b;
}

let strokeId=0,journalIdx=[],journalOld=[],strokeAnchor=null,strokeDir=[0,-1],brushButton=-1;

function beginStroke(){
 strokeId++;
 journalIdx=[];
 journalOld=[];
 strokeAnchor=null;
 flattenTarget=null;
}

function endStroke(){
 if(journalIdx.length){
  const idx=Int32Array.from(journalIdx),old=Float32Array.from(journalOld);
  const nw=new Float32Array(idx.length);
  for(let i=0;i<idx.length;i++)nw[i]=deltaData[idx[i]];
  history.record({idx,old,nw});
 }
 journalIdx=[];
 journalOld=[];
 strokeAnchor=null;
 flattenTarget=null;
}

function stamp(x,z,dt,reverse){

 const r=brushRadius,res=deltaRes,T=DELTA_T;
 const i0=Math.max(0,Math.floor((x-r-deltaOrg)/res)),i1=Math.min(T-1,Math.ceil((x+r-deltaOrg)/res));
 const j0=Math.max(0,Math.floor((z-r-deltaOrg)/res)),j1=Math.min(T-1,Math.ceil((z+r-deltaOrg)/res));
 if(i1<i0||j1<j0)return;

 const tool=selectedTool;
 const dir=reverse?-1:1;
 const rate=brushStrength*dt;
 const w0=1-Math.exp(-brushStrength*dt*3);
 const sx=strokeDir[0]*brushSlope*dir,sz=strokeDir[1]*brushSlope*dir;
 const W=i1-i0+1;
 let blur=null;

 if(tool==="smooth"){
  blur=new Float32Array(W*(j1-j0+1));
  for(let j=j0;j<=j1;j++){
   for(let i=i0;i<=i1;i++){
    let sum=0,n=0;
    for(let b=-2;b<=2;b++){
     for(let a=-2;a<=2;a++){
      const ii=i+a,jj=j+b;
      if(ii<0||jj<0||ii>=T||jj>=T)continue;
      sum+=baseAtTexel(ii,jj)+deltaData[jj*T+ii];
      n++;
     }
    }
    blur[(j-j0)*W+(i-i0)]=sum/n;
   }
  }
 }

 for(let j=j0;j<=j1;j++){
  for(let i=i0;i<=i1;i++){

   const px=deltaOrg+i*res,pz=deltaOrg+j*res;
   const d=Math.hypot(px-x,pz-z);
   if(d>=r)continue;

   const edge=Math.min(1,Math.min(i,j,T-1-i,T-1-j)/12);
   const f=smoothFalloff(d,r,brushSoft)*edge;
   if(f<=0)continue;

   const k=j*T+i;
   const cur=baseAtTexel(i,j)+deltaData[k];
   let nd=deltaData[k];

   if(tool==="raise")nd+=dir*rate*f;
   else if(tool==="lower")nd-=dir*rate*f;
   else if(tool==="flatten")nd+=(flattenTarget-cur)*w0*f;
   else if(tool==="smooth")nd+=(blur[(j-j0)*W+(i-i0)]-cur)*w0*f;
   else if(tool==="slope")nd+=(strokeAnchor.h+(px-strokeAnchor.x)*sx+(pz-strokeAnchor.z)*sz-cur)*w0*f;
   else if(tool==="noise")nd+=dir*noise2(px*1.3,pz*1.3)*rate*f*.6;

   if(strokeMark[k]!==strokeId){
    strokeMark[k]=strokeId;
    journalIdx.push(k);
    journalOld.push(deltaData[k]);
   }

   deltaData[k]=nd;
  }
 }

 deltaDirty=true;
}

function updateBrush(dt){

 const hit=(pointerLocked&&!detachedCamera&&!graphOpen)?findTerrainHit():null;

 updateGizmo(hit);

 if(brushButton<0||!hit)return;

 if(!strokeAnchor){
  strokeAnchor={x:hit.x,z:hit.z,h:heightAt(hit.x,hit.z)};
  strokeDir=[-Math.sin(yaw),-Math.cos(yaw)];
  if(Math.abs(hit.x)>deltaArea/2||Math.abs(hit.z)>deltaArea/2){
   console.warn("Вне области правок (±"+deltaArea/2+" м от центра мира)");
  }
 }

 if(selectedTool==="flatten"){
  flattenTarget=
   flattenMode==="pin"?pinHeight:
   flattenMode==="follow"?heightAt(hit.x,hit.z):
   strokeAnchor.h;
 }

 stamp(hit.x,hit.z,Math.min(dt,.05),brushButton===2);
}

function applyEntry(e,useNew){
 const a=useNew?e.nw:e.old;
 for(let i=0;i<e.idx.length;i++)deltaData[e.idx[i]]=a[i];
 deltaDirty=true;
}

function undo(){
 history.undo(applyEntry);
}

function redo(){
 history.redo(applyEntry);
}

function clearEdits(){
 const idx=[],old=[];
 for(let k=0;k<deltaData.length;k++){
  if(deltaData[k]!==0){idx.push(k);old.push(deltaData[k]);}
 }
 if(!idx.length)return;
 const e={idx:Int32Array.from(idx),old:Float32Array.from(old),nw:new Float32Array(idx.length)};
 applyEntry(e,true);
  history.record(e);
}

let deltaLast=0;

// Загрузка на GPU не чаще ~30 раз в секунду.
function flushDelta(now){
 waterU.uTime.value=now*.001;
 if(deltaDirty&&now-deltaLast>33){
  deltaTexture.needsUpdate=true;
  deltaDirty=false;
  deltaLast=now;
 }
}

// BRUSH GIZMO
// Кольцо кисти лежит на рельефе. Для «Выравнивания» показан диск на высоте цели,
// для «Склона» — наклонный диск и стрелка подъёма.

const TOOL_COLORS={raise:0x66ff88,lower:0xff6677,flatten:0x44ddff,smooth:0xffffff,slope:0xffaa44,noise:0xcc88ff};
const TOOL_NAMES={raise:"Поднять",lower:"Опустить",flatten:"Выравнивание",smooth:"Сглаживание",slope:"Склон",noise:"Шум"};
const RING_N=64;

const ringGeo=new THREE.BufferGeometry();
ringGeo.setAttribute("position",new THREE.BufferAttribute(new Float32Array((RING_N+1)*3),3));

const gizmoRing=new THREE.Line(ringGeo,new THREE.LineBasicMaterial({color:0xffffff,depthTest:false,transparent:true,opacity:.95}));
const gizmoDisc=new THREE.Mesh(
 new THREE.CircleGeometry(1,48).rotateX(-Math.PI/2),
 new THREE.MeshBasicMaterial({color:0x44ddff,transparent:true,opacity:.26,side:THREE.DoubleSide,depthWrite:false})
);
const gizmoArrow=new THREE.ArrowHelper(new THREE.Vector3(0,1,0),new THREE.Vector3(),1,0xffaa44,.8,.5);

for(const o of [gizmoRing,gizmoDisc,gizmoArrow]){
 o.frustumCulled=false;
 o.visible=false;
 o.renderOrder=100;
 scene.add(o);
}

let lastAimHeight=10,hudText="";

function pickPin(){
 pinHeight=Math.round(lastAimHeight*10)/10;
 flattenMode="pin";
 document.getElementById("fMode").value="pin";
 document.getElementById("fPin").value=pinHeight;
}

function updateGizmo(hit){

 const hud=document.getElementById("brushHud");

 gizmoRing.visible=false;
 gizmoDisc.visible=false;
 gizmoArrow.visible=false;

 if(!hit){
  if(hudText){hudText="";hud.textContent="";}
  return;
 }

 const r=brushRadius,col=TOOL_COLORS[selectedTool]||0xffffff;
 const h=heightAt(hit.x,hit.z);
 lastAimHeight=h;

 gizmoRing.material.color.setHex(col);
 const pos=ringGeo.attributes.position;

 for(let k=0;k<=RING_N;k++){
  const a=k/RING_N*Math.PI*2,x=hit.x+Math.cos(a)*r,z=hit.z+Math.sin(a)*r;
  pos.setXYZ(k,x,heightAt(x,z)+.1,z);
 }

 pos.needsUpdate=true;
 gizmoRing.visible=true;

 let info=TOOL_NAMES[selectedTool]+" · R "+r.toFixed(1)+" м · "+brushStrength.toFixed(1)+" м/с";

 if(selectedTool==="flatten"){

  const t=
   flattenMode==="pin"?pinHeight:
   (flattenMode==="stroke"&&flattenTarget!==null)?flattenTarget:h;

  gizmoDisc.material.color.setHex(col);
  gizmoDisc.position.set(hit.x,t,hit.z);
  gizmoDisc.scale.set(r,1,r);
  gizmoDisc.quaternion.identity();
  gizmoDisc.visible=true;

  info+=" · цель "+t.toFixed(1)+" м";

 }else if(selectedTool==="slope"){

  const fwd=strokeAnchor?strokeDir:[-Math.sin(yaw),-Math.cos(yaw)];
  const sgn=brushButton===2?-1:1;
  const sx=fwd[0]*brushSlope*sgn,sz=fwd[1]*brushSlope*sgn;
  const ax=strokeAnchor?strokeAnchor.x:hit.x,az=strokeAnchor?strokeAnchor.z:hit.z,ah=strokeAnchor?strokeAnchor.h:h;
  const ph=ah+(hit.x-ax)*sx+(hit.z-az)*sz;

  gizmoDisc.material.color.setHex(col);
  gizmoDisc.position.set(hit.x,ph,hit.z);
  gizmoDisc.scale.set(r,1,r);
  gizmoDisc.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(-sx,1,-sz).normalize());
  gizmoDisc.visible=true;

  gizmoArrow.position.set(hit.x,ph+.2,hit.z);
  gizmoArrow.setDirection(new THREE.Vector3(fwd[0],sx*fwd[0]+sz*fwd[1],fwd[1]).normalize());
  gizmoArrow.setLength(Math.max(2,r*.8),.8,.5);
  gizmoArrow.setColor(col);
  gizmoArrow.visible=true;

  info+=" · наклон "+Math.round(brushSlope*100)+"%";
 }

 if(info!==hudText){
  hudText=info;
  hud.textContent=info;
 }
}

// PLAYER AND CAMERA

const EYE_HEIGHT=1.72;

let yaw=0;
let pitch=-.19;
let verticalVelocity=0;
let grounded=false;
let detachedCamera=false;

const savedPlayerPosition=new THREE.Vector3();

camera.position.set(
 0,
 heightAt(0,18)+EYE_HEIGHT,
 18
);

camera.rotation.order="YXZ";
camera.rotation.set(pitch,yaw,0);

const keys=Object.create(null);

let pointerLocked=false;

renderer.domElement.addEventListener("click",()=>{

 if(!pointerLocked){
  renderer.domElement.requestPointerLock();
 }
});

document.addEventListener("pointerlockchange",()=>{

 pointerLocked=
  document.pointerLockElement===renderer.domElement;

 // Браузер присылает "скачок" мыши сразу после повторного захвата — пропускаем его.
 skipMouse=3;

 if(!pointerLocked){
  brushButton=-1;
  endStroke();
 }
});

document.addEventListener("mousemove",e=>{

 if(!pointerLocked)return;

 if(skipMouse>0){
  skipMouse--;
  return;
 }

 const mx=THREE.MathUtils.clamp(e.movementX,-120,120);
 const my=THREE.MathUtils.clamp(e.movementY,-120,120);

 yaw-=mx*.0022;
 pitch-=my*.0022;

 pitch=THREE.MathUtils.clamp(pitch,-1.5,1.5);

 camera.rotation.set(pitch,yaw,0,"YXZ");
});

function toggleFreeCamera(){

 detachedCamera=!detachedCamera;

 const info=document.getElementById("modeInfo");

 if(detachedCamera){

  savedPlayerPosition.copy(camera.position);
  verticalVelocity=0;

  info.textContent=
   "FREE CAMERA · WASD · SPACE/CTRL · SHIFT · V — RETURN";

  console.info("Free camera enabled");

 }else{

  camera.position.copy(savedPlayerPosition);

  verticalVelocity=0;
  grounded=true;

  info.textContent="PLAYER MODE · V — FREE CAMERA";

  console.info("Player camera restored");
 }
}

document.addEventListener("keydown",e=>{

 if(e.target&&/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;

 if(e.code==="KeyN"&&!e.repeat){
  toggleGraph();
  return;
 }

 if(graphOpen)return;

 if(e.code==="KeyF"&&!e.repeat&&pointerLocked)pickPin();

 keys[e.code]=true;

 if(e.code==="KeyV"&&!e.repeat){
  toggleFreeCamera();
 }

 if(e.code==="KeyG"&&!e.repeat){

  showGrid=!showGrid;
  uniforms.uGrid.value=showGrid?1:0;
 }

 if(e.code==="KeyT"&&!e.repeat){

  showTriangles=!showTriangles;

  

  document.getElementById("wGrid").textContent=
   showTriangles?"TRIANGLES ON":"OFF";
 }

 if(e.code==="KeyZ"&&!e.repeat)undo();
 if(e.code==="KeyY"&&!e.repeat)redo();

 if([
  "KeyW","KeyA","KeyS","KeyD",
  "Space","ShiftLeft",
  "ControlLeft","ControlRight"
 ].includes(e.code)){
  e.preventDefault();
 }
});

document.addEventListener("keyup",e=>{
 keys[e.code]=false;
});

window.addEventListener("blur",()=>{
 for(const k in keys)keys[k]=false;
});

function updateMovement(dt){

 if(detachedCamera){

  const speed=keys.ShiftLeft?100:35;

  const forward=new THREE.Vector3();
  camera.getWorldDirection(forward);

  const right=new THREE.Vector3()
   .crossVectors(forward,camera.up)
   .normalize();

  if(keys.KeyW)camera.position.addScaledVector(forward,speed*dt);
  if(keys.KeyS)camera.position.addScaledVector(forward,-speed*dt);
  if(keys.KeyD)camera.position.addScaledVector(right,speed*dt);
  if(keys.KeyA)camera.position.addScaledVector(right,-speed*dt);

  if(keys.Space)camera.position.y+=speed*dt;

  if(keys.ControlLeft||keys.ControlRight){
   camera.position.y-=speed*dt;
  }

  return;
 }

 const inWater=(camera.position.y-EYE_HEIGHT)<seaLevel-.4;
 const speed=(keys.ShiftLeft?25:12)*(inWater?.55:1);

 const forward=new THREE.Vector3(
  -Math.sin(yaw),
  0,
  -Math.cos(yaw)
 );

 const right=new THREE.Vector3(
  Math.cos(yaw),
  0,
  -Math.sin(yaw)
 );

 if(keys.KeyW)camera.position.addScaledVector(forward,speed*dt);
 if(keys.KeyS)camera.position.addScaledVector(forward,-speed*dt);
 if(keys.KeyD)camera.position.addScaledVector(right,speed*dt);
 if(keys.KeyA)camera.position.addScaledVector(right,-speed*dt);

 const ground=groundHeight(camera.position.x,camera.position.z);
 const feet=camera.position.y-EYE_HEIGHT;
 const snap=Math.max(.7,speed*dt*2);

 // Прилипание к склону при спуске, иначе игрок "падает" шагами.
 if(grounded&&!keys.Space&&feet-ground<=snap){

  camera.position.y=ground+EYE_HEIGHT;
  verticalVelocity=0;

 }else{

  if(inWater){
   verticalVelocity-=5*dt;
   verticalVelocity*=Math.exp(-2.5*dt);
   if(keys.Space)verticalVelocity=Math.max(verticalVelocity,3.2);
  }else verticalVelocity-=24*dt;

  if(keys.Space&&grounded&&!inWater){
   verticalVelocity=8.5;
   grounded=false;
  }

  camera.position.y+=verticalVelocity*dt;
 }

 if(camera.position.y-EYE_HEIGHT<=ground+1e-4){

  camera.position.y=ground+EYE_HEIGHT;
  verticalVelocity=0;
  grounded=true;

 }else{

  grounded=false;
 }
}

// TERRAIN RAYCAST

const raycaster=new THREE.Raycaster();

function findTerrainHit(){

 raycaster.setFromCamera(
  new THREE.Vector2(0,0),
  camera
 );

 const origin=raycaster.ray.origin;
 const direction=raycaster.ray.direction;

 let previousT=0;

 let previousDelta=
  origin.y-heightAt(origin.x,origin.z);

 for(let t=.5;t<2500;t+=Math.max(.5,t*.02)){

  const x=origin.x+direction.x*t;
  const y=origin.y+direction.y*t;
  const z=origin.z+direction.z*t;

  const delta=y-heightAt(x,z);

  if(
   (previousDelta>=0&&delta<=0)||
   (previousDelta<=0&&delta>=0)
  ){

   let lo=previousT;
   let hi=t;

   for(let i=0;i<18;i++){

    const mid=(lo+hi)*.5;

    const mx=origin.x+direction.x*mid;
    const my=origin.y+direction.y*mid;
    const mz=origin.z+direction.z*mid;

    const md=my-heightAt(mx,mz);

    if(
     (previousDelta>=0&&md>=0)||
     (previousDelta<0&&md<0)
    ){
     lo=mid;
    }else{
     hi=mid;
    }
   }

   const hitT=(lo+hi)*.5;

   return new THREE.Vector3(
    origin.x+direction.x*hitT,
    origin.y+direction.y*hitT,
    origin.z+direction.z*hitT
   );
  }

  previousT=t;
  previousDelta=delta;
 }

 return null;
}

document.addEventListener("mousedown",e=>{

 if(!pointerLocked||detachedCamera)return;
 if(e.button!==0&&e.button!==2)return;

 if(brushButton>=0)endStroke();

 brushButton=e.button;
 beginStroke();
});

document.addEventListener("mouseup",e=>{

 if(e.button!==brushButton)return;

 brushButton=-1;
 endStroke();
});

window.addEventListener("blur",()=>{
 brushButton=-1;
 endStroke();
});

document.addEventListener("contextmenu",e=>{
 e.preventDefault();
});

// DEVELOPER UI

const panel=document.getElementById("devPanel");
const toggle=document.getElementById("devToggle");

toggle.onclick=()=>{

 panel.classList.toggle("open");

 toggle.textContent=
  panel.classList.contains("open")
   ?"Developer ▴"
   :"Developer ▾";
};

document.getElementById("closeDev").onclick=()=>{

 panel.classList.remove("open");
 toggle.textContent="Developer ▾";
};

document.querySelectorAll(".devTab").forEach(btn=>{

 btn.onclick=()=>{

  document.querySelectorAll(".devTab").forEach(b=>{
   b.classList.toggle("active",b===btn);
  });

  document.querySelectorAll(".devPage").forEach(p=>{
   p.classList.toggle(
    "active",
    p.id==="tab-"+btn.dataset.tab
   );
  });
 };
});

document.querySelectorAll("[data-tool]").forEach(btn=>{

 btn.onclick=()=>{

  selectedTool=btn.dataset.tool;

  document.querySelectorAll("[data-tool]").forEach(b=>{
   b.classList.toggle("active",b===btn);
  });

  flattenTarget=null;
 };
});

function bindRange(id,label,callback){

 const el=document.getElementById(id);
 const out=document.getElementById(label);

 el.addEventListener("input",()=>{

  const v=Number(el.value);

  out.textContent=v.toFixed(1);

  callback(v);
 });
}

bindRange("brushRadius","radiusValue",v=>brushRadius=v);
bindRange("brushStrength","strengthValue",v=>brushStrength=v);
bindRange("brushSoftness","softValue",v=>brushSoft=v);

document.getElementById("undo").onclick=undo;
document.getElementById("redo").onclick=redo;
document.getElementById("clearEdits").onclick=clearEdits;

// GRAPH EDITOR UI

const gEl=id=>document.getElementById(id);
const nodeById=id=>graph.nodes.find(n=>n.id===id);
let pendingOut=null,gTimer=0,pvTimer=0,gZoom=1,selectedId=null;

function dependsOn(a,b,seen=new Set()){
 if(a===b)return true;
 if(seen.has(a))return false;
 seen.add(a);
 const n=nodeById(a);
 if(!n)return false;
 return Object.values(n.in||{}).some(s=>s!=null&&dependsOn(s,b,seen));
}

function scheduleApply(){
 clearTimeout(gTimer);
 setGraphStatus("…применение");
 schedulePreview();
 gTimer=setTimeout(applyGraph,500);
}

function applyGraph(){
 clearTimeout(gTimer);
 try{
  installCompiled(compileGraph(graph),true);
  setGraphStatus("Компиляция…");
  markGoodLater();
 }catch(err){
  setGraphStatus(err.message,true);
 }
}

function addNode(type,p){
 if(type.startsWith("out_")&&graph.nodes.some(n=>n.type===type)){setGraphStatus("Такой узел уже есть",true);return;}
 const sc=gEl("graphScroll");
 const id=graph.nodes.reduce((m,n)=>Math.max(m,n.id),0)+1;
 graph.nodes.push({id,type,x:Math.round((sc.scrollLeft+80)/gZoom/12)*12,y:Math.round((sc.scrollTop+80)/gZoom/12)*12,p:p||{},d:{},in:{}});
 selectedId=id;
 renderGraph();
}

function removeNode(id){
 graph.nodes=graph.nodes.filter(n=>n.id!==id);
 for(const n of graph.nodes){
  for(const k of Object.keys(n.in||{}))if(n.in[k]===id)delete n.in[k];
 }
 pendingOut=null;
 renderGraph();
 scheduleApply();
}

function connect(src,dst,port){
 const sn=nodeById(src),dn=nodeById(dst);
 if(!sn||!dn||src===dst)return;
 const so=NODE_TYPES[sn.type].o;
 const ty=NODE_TYPES[dn.type].i.find(i=>i[0]===port)[1];
 if(so==="c"&&ty!=="c"){setGraphStatus("Цвет нельзя подключить к числу",true);return;}
 if(dependsOn(src,dst)){setGraphStatus("Так получится цикл",true);return;}
 dn.in[port]=src;
 pendingOut=null;
 renderGraph();
 scheduleApply();
}

function drawLinks(){
 const cv=gEl("graphCanvas").getBoundingClientRect(),z=gZoom;
 const parts=[];
 for(const n of graph.nodes){
  for(const [name,src] of Object.entries(n.in||{})){
   if(src==null||!nodeById(src))continue;
   const a=document.querySelector('.gout[data-node="'+src+'"]');
   const b=document.querySelector('.gin[data-node="'+n.id+'"][data-port="'+name+'"]');
   if(!a||!b)continue;
   const ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();
   const x1=(ra.left+ra.width/2-cv.left)/z,y1=(ra.top+ra.height/2-cv.top)/z;
   const x2=(rb.left+rb.width/2-cv.left)/z,y2=(rb.top+rb.height/2-cv.top)/z;
   const col=NODE_TYPES[nodeById(src).type].o==="c"?"#ffb86b":"#7fd1ff";
   parts.push('<path d="M'+x1+' '+y1+' C'+(x1+70)+' '+y1+','+(x2-70)+' '+y2+','+x2+' '+y2+'" stroke="'+col+'" stroke-width="2" fill="none" opacity=".9"/>');
  }
 }
 gEl("graphLinks").innerHTML=parts.join("");
}

function numInput(value,onchange){
 const i=document.createElement("input");
 i.type="number";
 i.step="any";
 i.value=value;
 i.onchange=()=>onchange(Number(i.value));
 return i;
}

const PV_N=64,PV_W=128;

const LBL={
 scale:"масштаб",ox:"сдвиг X",oz:"сдвиг Z",oct:"октавы",ns:"сид узла",v:"значение",e:"степень",lo:"мин",hi:"макс",
 e0:"от",e1:"до",im:"вход от",iM:"вход до",om:"выход от",oM:"выход до",step:"шаг (м)",sharp:"резкость",
 col:"цвет",color:"цвет",on:"вкл (1/0)",shallow:"мелкая вода",deep:"глубокая вода",
 x:"X",z:"Z",a:"A",b:"B",t:"доля",h:"высота",c:"цвет",level:"уровень моря (м)",clarity:"прозрачность",
 wave:"высота волн",wscale:"размер волн",wspeed:"скорость волн",glint:"блики",foam:"пена",opacity:"непрозрачность",
 shore:"мягкость берега (м)",fade:"дальность деталей (м)",near:"начало (0=авто)",far:"конец (0=авто)",
 asset:"ассет",tile:"размер тайла (м)",tri:"триплан (1/0)"
};

function schedulePreview(){
 clearTimeout(pvTimer);
 pvTimer=setTimeout(updatePreviews,120);
}

const SRGB_LUT=Float32Array.from({length:256},(_,i)=>{const v=i/255;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);});

function texIndex(tex,u,v){
 const N=tex.image.width;
 const ix=((Math.floor(u*N)%N)+N)%N,iy=((Math.floor(v*N)%N)+N)%N;
 return (iy*N+ix)*4;
}

const texSampler={
 grass:(x,z)=>{
  const d=macroTexture.image.data,k=texIndex(macroTexture,x/16,z/16);
  return [SRGB_LUT[d[k]],SRGB_LUT[d[k+1]],SRGB_LUT[d[k+2]]];
 },
 rock:(x,z)=>{
  const sc=uniforms.uDetailScale.value,d=detailTexture.image.data;
  const m=.55+d[texIndex(detailTexture,x/sc,z/sc)]/255*.9;
  return [.16*m,.145*m,.13*m];
 },
 asset:(id,u,v)=>assetSample(id,u,v)
};

const g8=v=>Math.round(255*Math.pow(Math.min(Math.max(v,0),1),1/2.2));
const hexRGB=h=>/^#[0-9a-f]{6}$/i.test(h)?[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)):[128,128,128];

// Текстуры базовых узлов «Трава»/«Скала» как canvas (кэшируются).
const canvasCache=new WeakMap();
function texCanvas(tex,tint){
 let c=canvasCache.get(tex);
 if(c)return c;
 const N=tex.image.width,d=tex.image.data;
 c=document.createElement("canvas");
 c.width=c.height=N;
 const ctx=c.getContext("2d"),img=ctx.createImageData(N,N);
 for(let i=0;i<N*N;i++){
  if(tint){
   const m=.55+d[i*4]/255*.9;
   img.data[i*4]=g8(.16*m);img.data[i*4+1]=g8(.145*m);img.data[i*4+2]=g8(.13*m);
  }else{
   img.data[i*4]=d[i*4];img.data[i*4+1]=d[i*4+1];img.data[i*4+2]=d[i*4+2];
  }
  img.data[i*4+3]=255;
 }
 ctx.putImageData(img,0,0);
 canvasCache.set(tex,c);
 return c;
}

function nodeTileCanvas(n){
 if(n.type==="grass")return texCanvas(macroTexture,false);
 if(n.type==="rock")return texCanvas(detailTexture,true);
 if(n.type==="tex_asset"){
  const a=assets.get((n.p||{}).asset);
  return a?a.canvas:null;
 }
 return null;
}

// Рисует превью узла в контекст W×W. Возвращает подпись.
function paintNode(ctx,W,n,res){

 const p=n.p||{};
 const tile=nodeTileCanvas(n);
 ctx.imageSmoothingEnabled=true;
 ctx.imageSmoothingQuality="high";

 if(tile){
  ctx.drawImage(tile,0,0,W,W);
  return "текстура "+tile.width+"×"+tile.height;
 }

 if(n.type==="color"||n.type==="out_fog"){
  const c=hexRGB(n.type==="color"?p.col:(p.color||"#9dc7e1"));
  ctx.fillStyle="rgb("+c[0]+","+c[1]+","+c[2]+")";
  ctx.fillRect(0,0,W,W);
  return n.type==="out_fog"?(+(p.on!=null?p.on:1)?"туман вкл":"туман выкл"):"";
 }

 if(n.type==="out_water"){
  const a=hexRGB(p.shallow||"#2f9aa3"),b=hexRGB(p.deep||"#0a2c4d");
  const gr=ctx.createLinearGradient(0,0,0,W);
  gr.addColorStop(0,"rgb("+a.join(",")+")");
  gr.addColorStop(1,"rgb("+b.join(",")+")");
  ctx.fillStyle=gr;
  ctx.fillRect(0,0,W,W);
  return +(p.on!=null?p.on:1)?"мелко → глубоко":"океан выкл";
 }

 if(!res||!res.map.has(n.id)){
  ctx.fillStyle="#000";
  ctx.fillRect(0,0,W,W);
  return "";
 }

 const s=res.map.get(n.id),N=res.N;
 const tmp=document.createElement("canvas");
 tmp.width=tmp.height=N;
 const tctx=tmp.getContext("2d"),img=tctx.createImageData(N,N),d=img.data;
 const put=(o,r,g,b)=>{d[o*4]=r;d[o*4+1]=g;d[o*4+2]=b;d[o*4+3]=255;};
 let text="";

 if(n.type==="out_height"){

  const H=res.H;
  let lo=1e30,hi=-1e30;
  for(let i=0;i<N*N;i++){lo=Math.min(lo,H[i]);hi=Math.max(hi,H[i]);}
  const k=hi>lo?1/(hi-lo):0;

  for(let j=0;j<N;j++){
   for(let i=0;i<N;i++){
    const dx=(H[j*N+Math.min(i+1,N-1)]-H[j*N+Math.max(i-1,0)])/(2*res.px);
    const dz=(H[Math.min(j+1,N-1)*N+i]-H[Math.max(j-1,0)*N+i])/(2*res.px);
    const sh=Math.min(Math.max(.62-(dx*.8+dz*.5)*1.4,.12),1.1);
    const t=(H[j*N+i]-lo)*k;
    put(j*N+i,Math.min(255,sh*(40+160*t)),Math.min(255,sh*(110+80*t)),Math.min(255,sh*(60+110*t)));
   }
  }
  text="рельеф "+lo.toFixed(0)+" … "+hi.toFixed(0)+" м";

 }else if(s.c){

  for(let o=0;o<N*N;o++)put(o,g8(s.data[o*3]),g8(s.data[o*3+1]),g8(s.data[o*3+2]));
  text="цвет";

 }else{

  const lo=s.min,hi=s.max,k=hi>lo?1/(hi-lo):0;
  for(let o=0;o<N*N;o++){
   const v=Math.round(255*(s.data[o]-lo)*k);
   put(o,v,v,v);
  }
  text=lo.toFixed(2)+" … "+hi.toFixed(2);
 }

 tctx.putImageData(img,0,0);
 ctx.drawImage(tmp,0,0,W,W);
 return text;
}

function updatePreviews(){

 if(!graphOpen)return;

 let res=null;

 try{
  res=previewGraph(graph,camera.position.x,camera.position.z,Number(gEl("gWin").value),PV_N,texSampler);
 }catch(e){}

 for(const cv of document.querySelectorAll("canvas[data-pv]")){
  const n=nodeById(Number(cv.dataset.pv));
  if(!n)continue;
  const text=paintNode(cv.getContext("2d"),cv.width,n,res);
  const cap=cv.nextElementSibling;
  if(cap)cap.textContent=text;
 }
}

function openLightbox(n){

 const cv=gEl("gLbCanvas"),ctx=cv.getContext("2d");
 let res=null;

 if(!nodeTileCanvas(n)&&!["color","out_fog","out_water"].includes(n.type)){
  try{res=previewGraph(graph,camera.position.x,camera.position.z,Number(gEl("gWin").value),160,texSampler);}catch(e){}
 }

 const text=paintNode(ctx,cv.width,n,res);
 gEl("gLbCap").textContent=NODE_TYPES[n.type].t+(text?" · "+text:"");
 gEl("gLightbox").style.display="flex";
}

function closeLightbox(){
 gEl("gLightbox").style.display="none";
}

function selectNode(id){
 selectedId=id;
 document.querySelectorAll(".gnode").forEach(e=>e.classList.toggle("sel",Number(e.dataset.id)===id));
}

function renderGraph(){

 const host=gEl("graphNodes");
 host.innerHTML="";

 for(const n of graph.nodes){

  const T=NODE_TYPES[n.type];
  if(!T)continue;
  n.in=n.in||{};n.p=n.p||{};n.d=n.d||{};

  const el=document.createElement("div");
  el.className="gnode"+(T.o==="c"?" gcol":"")+(selectedId===n.id?" sel":"");
  el.dataset.id=n.id;
  el.style.left=n.x+"px";
  el.style.top=n.y+"px";
  el.addEventListener("pointerdown",()=>selectNode(n.id),true);

  const head=document.createElement("div");
  head.className="ghead";
  head.textContent=T.t;
  el.appendChild(head);

  head.onpointerdown=e=>{
   const sx=e.clientX,sy=e.clientY,x0=n.x,y0=n.y;
   head.setPointerCapture(e.pointerId);
   head.onpointermove=ev=>{
    n.x=Math.max(0,Math.round((x0+(ev.clientX-sx)/gZoom)/12)*12);
    n.y=Math.max(0,Math.round((y0+(ev.clientY-sy)/gZoom)/12)*12);
    el.style.left=n.x+"px";
    el.style.top=n.y+"px";
    drawLinks();
   };
   head.onpointerup=()=>{head.onpointermove=null;head.onpointerup=null;};
  };

  const cv=document.createElement("canvas");
  cv.className="gpv";
  cv.width=cv.height=PV_W;
  cv.dataset.pv=n.id;
  cv.onclick=()=>openLightbox(n);
  el.appendChild(cv);

  const cap=document.createElement("div");
  cap.className="gcap";
  el.appendChild(cap);

  for(const [name,ty,def] of T.i){
   const row=document.createElement("div");
   row.className="grow";
   const dot=document.createElement("span");
   dot.className="gdot gin"+(ty==="c"?" col":"");
   dot.dataset.node=n.id;
   dot.dataset.port=name;
   dot.onclick=()=>{
    if(pendingOut!=null)connect(pendingOut,n.id,name);
    else if(n.in[name]!=null){delete n.in[name];renderGraph();scheduleApply();}
   };
   const lab=document.createElement("label");
   lab.textContent=LBL[name]||name;
   row.append(dot,lab);
   if(def!==null&&ty==="f"&&n.in[name]==null){
    row.appendChild(numInput(n.d[name]!=null?n.d[name]:def,v=>{n.d[name]=v;scheduleApply();}));
   }
   el.appendChild(row);
  }

  for(const [k,d,kind] of T.p){
   const row=document.createElement("div");
   row.className="grow";
   const lab=document.createElement("label");
   lab.textContent=LBL[k]||k;
   row.appendChild(lab);
   if(kind==="color"){
    const c=document.createElement("input");
    c.type="color";
    c.value=n.p[k]!=null?n.p[k]:d;
    c.onchange=()=>{n.p[k]=c.value;scheduleApply();};
    row.appendChild(c);
   }else if(kind==="asset"){
    const sel=document.createElement("select");
    const cur=n.p[k]!=null?n.p[k]:d;
    if(!assets.has(cur)){
     const o=document.createElement("option");
     o.value=cur;o.textContent="(нет ассета)";
     sel.appendChild(o);
    }
    for(const a of assets.values()){
     const o=document.createElement("option");
     o.value=a.id;o.textContent=a.name;
     sel.appendChild(o);
    }
    sel.value=cur;
    sel.onchange=()=>{n.p[k]=sel.value;scheduleApply();};
    row.appendChild(sel);
   }else{
    row.appendChild(numInput(n.p[k]!=null?n.p[k]:d,v=>{n.p[k]=v;scheduleApply();}));
   }
   el.appendChild(row);
  }

  // Нижняя строка: удаление слева, выход справа.
  const foot=document.createElement("div");
  foot.className="gfoot";

  if(n.type!=="out_height"&&n.type!=="out_color"){
   const del=document.createElement("button");
   del.className="gdelbtn";
   del.textContent="Удалить";
   del.onclick=()=>removeNode(n.id);
   foot.appendChild(del);
  }else foot.appendChild(document.createElement("span"));

  if(!T.sink){
   const out=document.createElement("span");
   const sub=document.createElement("span");
   sub.className="gsub";
   sub.textContent="выход";
   const od=document.createElement("span");
   od.className="gdot gout"+(T.o==="c"?" col":"")+(pendingOut===n.id?" sel":"");
   od.dataset.node=n.id;
   od.onclick=e=>{e.stopPropagation();pendingOut=pendingOut===n.id?null:n.id;renderGraph();};
   out.append(sub,od);
   foot.appendChild(out);
  }

  el.appendChild(foot);
  host.appendChild(el);
 }

 drawLinks();
 schedulePreview();
}

function toggleGraph(force){
 graphOpen=force===undefined?!graphOpen:force;
 gEl("graphOverlay").classList.toggle("open",graphOpen);
 document.body.classList.toggle("graph-open",graphOpen);
 if(graphOpen){
  document.exitPointerLock();
  gEl("gSeed").value=graph.seed||0;
  applyZoom();
  renderGraph();
 }else closeLightbox();
}

for(const [type,T] of Object.entries(NODE_TYPES)){
 if(type==="out_height"||type==="out_color")continue;
 const o=document.createElement("option");
 o.value=type;
 o.textContent=T.t;
 gEl("gAdd").appendChild(o);
}

gEl("gAddBtn").onclick=()=>addNode(gEl("gAdd").value);
gEl("gClose").onclick=()=>toggleGraph(false);
gEl("openGraph").onclick=()=>toggleGraph(true);
gEl("gApply").onclick=applyGraph;
gEl("gWin").onchange=schedulePreview;

gEl("gSeed").onchange=e=>{graph.seed=Number(e.target.value)||0;scheduleApply();};
gEl("gRand").onclick=()=>{
 graph.seed=Math.floor(Math.random()*99999);
 gEl("gSeed").value=graph.seed;
 scheduleApply();
};

gEl("gPresetBtn").onclick=()=>{
 graph=PRESET_GRAPHS[gEl("gPreset").value](graph.seed||0);
 pendingOut=null;
 renderGraph();
 applyGraph();
};

gEl("gExport").onclick=()=>{
 const blob=new Blob([JSON.stringify(graph,null,1)],{type:"application/json"});
 const url=URL.createObjectURL(blob);
 const a=document.createElement("a");
 a.href=url;
 a.download="world-graph.json";
 a.click();
 URL.revokeObjectURL(url);
};

gEl("gImport").onclick=()=>gEl("gFile").click();

gEl("gFile").onchange=async e=>{
 const file=e.target.files[0];
 if(!file)return;
 try{
  const g=JSON.parse(await file.text());
  if(!g||!Array.isArray(g.nodes))throw new Error("Неверный файл графа");
  ensureEnv(g);
  compileGraph(g);
  graph=g;
  gEl("gSeed").value=graph.seed||0;
  renderGraph();
  applyGraph();
 }catch(err){
  setGraphStatus(err.message,true);
 }
 e.target.value="";
};

gEl("fMode").onchange=e=>{flattenMode=e.target.value;};
gEl("fPin").onchange=e=>{pinHeight=Number(e.target.value)||0;};
gEl("fPick").onclick=pickPin;

// GRAPH VIEW: масштаб, прокрутка, ассеты

function applyZoom(){
 gEl("graphCanvas").style.transform="scale("+gZoom+")";
 gEl("graphZoomBox").style.width=3200*gZoom+"px";
 gEl("graphZoomBox").style.height=2000*gZoom+"px";
 gEl("gZoomVal").textContent=Math.round(gZoom*100)+"%";
 drawLinks();
}

function setZoom(z,fx,fy){
 const gs=gEl("graphScroll");
 z=Math.min(1.6,Math.max(.35,z));
 if(fx===undefined){fx=gs.clientWidth/2;fy=gs.clientHeight/2;}
 const cx=(gs.scrollLeft+fx)/gZoom,cy=(gs.scrollTop+fy)/gZoom;
 gZoom=z;
 applyZoom();
 gs.scrollLeft=cx*z-fx;
 gs.scrollTop=cy*z-fy;
}

function fitGraph(){
 const gs=gEl("graphScroll");
 let x0=1e9,y0=1e9,x1=0,y1=0;
 for(const n of graph.nodes){
  x0=Math.min(x0,n.x);y0=Math.min(y0,n.y);
  x1=Math.max(x1,n.x+240);y1=Math.max(y1,n.y+340);
 }
 gZoom=Math.min(1.2,Math.max(.35,Math.min(gs.clientWidth/(x1-x0+80),gs.clientHeight/(y1-y0+80))));
 applyZoom();
 gs.scrollLeft=(x0-40)*gZoom;
 gs.scrollTop=(y0-40)*gZoom;
}

gEl("gZoomIn").onclick=()=>setZoom(gZoom*1.2);
gEl("gZoomOut").onclick=()=>setZoom(gZoom/1.2);
gEl("gFit").onclick=fitGraph;

{
 const gs=gEl("graphScroll");

 gs.addEventListener("wheel",e=>{
  if(!e.ctrlKey&&!e.metaKey)return;
  e.preventDefault();
  const r=gs.getBoundingClientRect();
  setZoom(gZoom*(e.deltaY<0?1.1:1/1.1),e.clientX-r.left,e.clientY-r.top);
 },{passive:false});

 // Перетаскивание фона прокручивает граф (полосы прокрутки не затрагиваются).
 gs.addEventListener("pointerdown",e=>{
  const bg=[gs,gEl("graphZoomBox"),gEl("graphCanvas"),gEl("graphNodes")];
  if(!bg.includes(e.target))return;
  if(e.target===gs&&(e.offsetX>gs.clientWidth||e.offsetY>gs.clientHeight))return;
  pendingOut=null;
  selectNode(null);
  document.querySelectorAll(".gdot.sel").forEach(d=>d.classList.remove("sel"));
  const sx=e.clientX,sy=e.clientY,l=gs.scrollLeft,t=gs.scrollTop;
  gs.setPointerCapture(e.pointerId);
  gs.onpointermove=ev=>{gs.scrollLeft=l-(ev.clientX-sx);gs.scrollTop=t-(ev.clientY-sy);};
  gs.onpointerup=()=>{gs.onpointermove=null;gs.onpointerup=null;};
 });
}

document.addEventListener("keydown",e=>{
 if(!graphOpen)return;
 if(e.code==="Escape"&&gEl("gLightbox").style.display==="flex"){closeLightbox();return;}
 if(e.target&&/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;
 if(e.code==="Delete"&&selectedId!=null){
  const n=nodeById(selectedId);
  if(n&&n.type!=="out_height"&&n.type!=="out_color"){
   removeNode(selectedId);
   selectedId=null;
  }
 }
});

gEl("gLightbox").onclick=closeLightbox;

function renderAssetPanel(){

 const list=gEl("assetList");
 list.innerHTML="";

 for(const a of assets.values()){

  const row=document.createElement("div");
  row.className="assetItem";

  const th=document.createElement("canvas");
  th.width=th.height=112;
  const tctx=th.getContext("2d");
  tctx.imageSmoothingQuality="high";
  tctx.drawImage(a.canvas,0,0,112,112);
  th.onclick=()=>{
   const cv=gEl("gLbCanvas");
   cv.getContext("2d").drawImage(a.canvas,0,0,cv.width,cv.height);
   gEl("gLbCap").textContent=a.name+" · "+a.canvas.width+"×"+a.canvas.height;
   gEl("gLightbox").style.display="flex";
  };

  const name=document.createElement("span");
  name.textContent=a.name+(a.builtin?"":" ★");
  name.title=a.id;

  const add=document.createElement("button");
  add.className="tool";
  add.textContent="＋";
  add.title="Добавить узел с этой текстурой";
  add.onclick=()=>addNode("tex_asset",{asset:a.id});

  row.append(th,name,add);

  if(!a.builtin){
   const del=document.createElement("button");
   del.className="tool";
   del.textContent="✕";
   del.title="Удалить ассет";
   del.onclick=()=>removeAsset(a.id);
   row.appendChild(del);
  }

  list.appendChild(row);
 }
}

function removeAsset(id){
 const a=assets.get(id);
 if(!a)return;
 a.texture.dispose();
 assets.delete(id);
 dbDel(id).catch(()=>{});
 for(const n of graph.nodes)if(n.type==="tex_asset"&&n.p&&n.p.asset===id)n.p.asset="b_grass";
 renderAssetPanel();
 renderGraph();
 scheduleApply();
}

gEl("gAssets").onclick=()=>gEl("assetPanel").classList.toggle("open");
gEl("assetUpload").onclick=()=>gEl("assetFile").click();

gEl("assetFile").onchange=async e=>{
 for(const f of e.target.files){
  try{await addUserAsset(f,null,null,true);}
  catch(err){setGraphStatus("Не удалось прочитать изображение: "+f.name,true);}
 }
 e.target.value="";
 renderAssetPanel();
 renderGraph();
};

async function loadUserAssets(){
 try{
  const recs=await dbAll();
  for(const r of recs||[])await addUserAsset(r.blob,r.id,r.name,false);
  renderAssetPanel();
  renderGraph();
  // Привязать загруженные текстуры к уже собранному шейдеру.
  if(graph.nodes.some(n=>n.type==="tex_asset"))applyGraph();
 }catch(e){}
}

renderAssetPanel();
loadUserAssets();

// BRUSH EXTRAS

document.getElementById("brushSlope").oninput=e=>{
 brushSlope=Number(e.target.value);
 document.getElementById("slopeValue").textContent=brushSlope.toFixed(2);
};

function setRangeValue(id,label,v){
 document.getElementById(id).value=v;
 document.getElementById(label).textContent=v.toFixed(1);
}

// Колесо: радиус, Shift+колесо: сила.
document.addEventListener("wheel",e=>{

 if(!pointerLocked)return;
 e.preventDefault();

 const k=(e.deltaY||e.deltaX)<0?1.12:1/1.12;

 if(e.shiftKey){
  brushStrength=THREE.MathUtils.clamp(brushStrength*k,.1,10);
  setRangeValue("brushStrength","strengthValue",brushStrength);
 }else{
  brushRadius=THREE.MathUtils.clamp(brushRadius*k,1,24);
  setRangeValue("brushRadius","radiusValue",brushRadius);
 }
},{passive:false});

// QUALITY UI

const qEl=id=>document.getElementById(id);
const qFields={grid:"qGrid",cell:"qCell",area:"qArea",dist:"qDist",tex:"qTex",aniso:"qAniso",scale:"qScale",filter:"qFilter"};

function syncQUI(){

 for(const k in qFields)qEl(qFields[k]).value=String(Q[k]);

 qEl("qDetailSize").value=Q.detailSize;
 qEl("qDetailSizeV").textContent=Q.detailSize.toFixed(2);
 qEl("qDetailStr").value=Q.detailStr;
 qEl("qDetailStrV").textContent=Q.detailStr.toFixed(2);

 qEl("qInfo").textContent=
  "Уровней LOD: "+CLIP_LEVELS+
  " · вершин на уровень: "+((CLIP_N+1)**2).toLocaleString()+
  " · тайлов: "+clipmaps.length*TILES*TILES;
}

function applyRenderScale(){
 pixelCap=Q.scale;
 renderer.setPixelRatio(Math.min(devicePixelRatio,pixelCap));
 renderer.setSize(innerWidth,innerHeight);
}

function applyQ(key){

 if(key==="grid"||key==="dist"||key==="cell")buildClipmap();
 else if(key==="area")resetDelta(Q.area);
 else if(key==="tex")rebuildTextures();
 else if(key==="filter"||key==="aniso")refreshTexParams();
 else if(key==="scale")applyRenderScale();

 uniforms.uDetailScale.value=Q.detailSize;
 uniforms.uDetailStrength.value=Q.detailStr;

 try{localStorage.setItem("terrainQ",JSON.stringify(Q));}catch{}

 syncQUI();
}

for(const k in qFields){
 qEl(qFields[k]).onchange=e=>{
  Q[k]=k==="filter"?e.target.value:Number(e.target.value);
  applyQ(k);
 };
}

qEl("qDetailSize").oninput=e=>{Q.detailSize=Number(e.target.value);applyQ("detailSize");};
qEl("qDetailStr").oninput=e=>{Q.detailStr=Number(e.target.value);applyQ("detailStr");};

document.querySelectorAll("[data-preset]").forEach(b=>{
 b.onclick=()=>{
  Object.assign(Q,QUALITY_PRESETS[b.dataset.preset]);
  if(deltaArea!==Q.area)resetDelta(Q.area);
  buildClipmap();
  rebuildTextures();
  applyRenderScale();
  applyQ("preset");
  console.info("Пресет качества:",b.dataset.preset);
 };
});

syncQUI();

// IMPORT / EXPORT


document.getElementById("exportWorld").onclick=()=>{

 const T=DELTA_T;
 let x0=T,x1=-1,z0=T,z1=-1;

 for(let j=0;j<T;j++){
  for(let i=0;i<T;i++){
   if(Math.abs(deltaData[j*T+i])>1e-5){
    if(i<x0)x0=i;
    if(i>x1)x1=i;
    if(j<z0)z0=j;
    if(j>z1)z1=j;
   }
  }
 }

 if(x1<0){
  console.warn("Нет правок для экспорта");
  return;
 }

 const w=x1-x0+1,h=z1-z0+1,out=new Float32Array(w*h);
 for(let j=0;j<h;j++){
  out.set(deltaData.subarray((z0+j)*T+x0,(z0+j)*T+x0+w),j*w);
 }

 const data={version:13,area:deltaArea,t:T,x0,z0,w,h,data:f32ToB64(out)};

 const blob=new Blob([JSON.stringify(data)],{type:"application/json"});
 const url=URL.createObjectURL(blob);
 const a=document.createElement("a");

 a.href=url;
 a.download="height-world-clipmap.json";
 a.click();

 URL.revokeObjectURL(url);
};

document.getElementById("importWorld").onclick=()=>{
 document.getElementById("importFile").click();
};

document.getElementById("importFile").onchange=async e=>{

 const file=e.target.files[0];

 if(!file)return;

 try{

  const data=JSON.parse(await file.text());

  if(data.version!==13||typeof data.data!=="string"){
   throw new Error("Нужен файл версии 13 (старые форматы со списком правок не поддерживаются)");
  }

  if(data.area!==deltaArea){
   if(![128,256,512].includes(data.area))throw new Error("Неверная область правок");
   Q.area=data.area;
   resetDelta(data.area);
   syncQUI();
  }

  const arr=b64ToF32(data.data);
  const T=DELTA_T;

  if(arr.length!==data.w*data.h||data.x0<0||data.z0<0||data.x0+data.w>T||data.z0+data.h>T){
   throw new Error("Повреждённый файл");
  }

  const idx=[],old=[];
  for(let j=0;j<data.h;j++){
   for(let i=0;i<data.w;i++){
    const k=(data.z0+j)*T+data.x0+i;
    idx.push(k);
    old.push(deltaData[k]);
    deltaData[k]=arr[j*data.w+i];
   }
  }

  const entry={idx:Int32Array.from(idx),old:Float32Array.from(old),nw:new Float32Array(idx.length)};
  for(let i=0;i<idx.length;i++)entry.nw[i]=deltaData[idx[i]];
  history.record(entry);
  deltaDirty=true;

  console.info("Импортировано текселей:",idx.length);

 }catch(err){

  console.error("Ошибка импорта:",err);
 }

 e.target.value="";
};

// CONSOLE

const consoleOutput=document.getElementById("consoleOutput");

function addLog(level,args){

 const line=document.createElement("div");

 line.style.color=
  level==="error"?"#ff8f8f":
  level==="warn"?"#ffd27a":
  "#b8d7e8";

 line.textContent=
  "["+new Date().toLocaleTimeString()+"] "+
  level.toUpperCase()+": "+
  Array.from(args).map(v=>{

   if(typeof v==="object"){
    try{
     return JSON.stringify(v);
    }catch{
     return String(v);
    }
   }

   return String(v);

  }).join(" ");

 consoleOutput.appendChild(line);

 while(consoleOutput.children.length>500){
  consoleOutput.removeChild(consoleOutput.firstChild);
 }

 consoleOutput.scrollTop=consoleOutput.scrollHeight;
}

for(const level of ["log","info","warn","error"]){

 const original=console[level].bind(console);

 console[level]=(...args)=>{
  original(...args);
  addLog(level,args);
 };
}

window.addEventListener("error",e=>{
 addLog("error",[e.message]);
});

window.addEventListener("unhandledrejection",e=>{
 addLog("error",[e.reason]);
});

document.getElementById("clearConsole").onclick=()=>{
 consoleOutput.textContent="";
};

// PERFORMANCE

const msCanvas=document.getElementById("msCanvas");
const ctx=msCanvas.getContext("2d");

const samples=[];

let stages={
 move:0,
 world:0,
 build:0,
 render:0,
 total:0
};

function drawGraph(){

 const w=msCanvas.width;
 const h=msCanvas.height;

 ctx.clearRect(0,0,w,h);

 const top=12;
 const bottom=22;
 const ph=h-top-bottom;

 const max=Math.max(
  8,
  ...samples.map(s=>s.total)
 )*1.15;

 ctx.font="11px monospace";
 ctx.fillStyle="#91a7b2";

 for(let i=0;i<=4;i++){

  const y=top+ph*i/4;

  ctx.strokeStyle="#ffffff18";
  ctx.beginPath();
  ctx.moveTo(40,y);
  ctx.lineTo(w-8,y);
  ctx.stroke();

  ctx.fillText(
   (max*(1-i/4)).toFixed(1),
   4,
   y+4
  );
 }

 const series=[
  ["move","#7fc8a9"],
  ["world","#83a9df"],
  ["build","#e6b66d"],
  ["render","#c18be0"]
 ];

 const n=samples.length;

 if(n<2)return;

 const xx=i=>40+i/(n-1)*(w-50);

 let base=Array(n).fill(0);

 for(const [key,color] of series){

  ctx.beginPath();

  samples.forEach((s,i)=>{

   const y=top+ph*(1-(base[i]+s[key])/max);

   if(i===0)ctx.moveTo(xx(i),y);
   else ctx.lineTo(xx(i),y);
  });

  for(let i=n-1;i>=0;i--){
   ctx.lineTo(
    xx(i),
    top+ph*(1-base[i]/max)
   );
  }

  ctx.closePath();
  ctx.fillStyle=color+"99";
  ctx.fill();

  base=base.map((v,i)=>v+samples[i][key]);
 }
}

let lastPanelUpdate=0;

function updatePanel(now,dt){

 if(now-lastPanelUpdate<150)return;

 lastPanelUpdate=now;

 samples.push({...stages});

 if(samples.length>120){
  samples.shift();
 }

 const set=(id,v)=>{
  document.getElementById(id).textContent=v;
 };

 const avg=samples.reduce(
  (a,s)=>a+s.total,
  0
 )/Math.max(1,samples.length);

 const parts=[
  ["Movement",stages.move],
  ["Clipmap",stages.world],
  ["Geometry",stages.build],
  ["Render CPU",stages.render]
 ];

 const heavy=parts.reduce(
  (a,b)=>a[1]>b[1]?a:b
 );

 set("mFps",Math.round(1/Math.max(dt,.0001))+" FPS");
 set("mFrame",stages.total.toFixed(2)+" ms");
 set("mTiles",clipVisible+" / "+clipmaps.length*TILES*TILES);
 set("mLod",clipmaps.map(c=>c.step+"→"+Math.round(c.outer)).join(" · "));

 set(
  "mTris",
  renderer.info.render.triangles.toLocaleString()
 );

 set(
  "mPos",
  [camera.position.x,camera.position.y,camera.position.z]
   .map(v=>v.toFixed(1))
   .join(", ")
 );

 set("pTotal",stages.total.toFixed(2)+" ms");
 set("pAvg",avg.toFixed(2)+" ms");

 set(
  "pHeavy",
  heavy[0]+" · "+heavy[1].toFixed(2)+" ms"
 );

 set("tMove",stages.move.toFixed(2)+" ms");
 set("tWorld",stages.world.toFixed(2)+" ms");
 set("tBuild","0.00 ms");
 set("tRender",stages.render.toFixed(2)+" ms");

 set("wEdits",undoStack.length);

 if(
  panel.classList.contains("open")&&
  document.getElementById("tab-performance").classList.contains("active")
 ){
  drawGraph();
 }
}

// RESIZE

window.addEventListener("resize",()=>{

 camera.aspect=innerWidth/innerHeight;
 camera.updateProjectionMatrix();

 renderer.setSize(innerWidth,innerHeight);

 renderer.setPixelRatio(
  Math.min(devicePixelRatio,pixelCap)
 );
});

// START

updateClipmaps();

console.info("Dynamic Height World 13 initialized");
console.info("Clipmap: levels/grid from quality settings, tiles, frustum + hole culling, altitude-aware LOD");
console.info("Physics uses the same triangles as the LOD0 mesh");
console.info("V: free camera | T: triangle wireframe (color = LOD) | G: LOD cell grid");

let last=performance.now();

function animate(now){

 requestAnimationFrame(animate);

 const dt=Math.min((now-last)/1000,.04);

 last=now;

 let t=performance.now();

 updateMovement(dt);
 updateBrush(dt);

 const moveMs=performance.now()-t;

 t=performance.now();

 updateClipmaps();

 const worldMs=performance.now()-t;

 const buildMs=0;

 t=performance.now();

 flushDelta(now);
 renderer.render(scene,camera);

 const renderMs=performance.now()-t;

 stages={
  move:moveMs,
  world:worldMs,
  build:buildMs,
  render:renderMs,
  total:moveMs+worldMs+buildMs+renderMs
 };

 updatePanel(now,dt);
}

requestAnimationFrame(animate);

}catch(err){

 console.error(err);

 const el=document.createElement("pre");

 el.style.cssText=
  "position:fixed;inset:0;background:#211;color:white;padding:30px;overflow:auto";

 el.textContent=err.stack||String(err);

 document.body.appendChild(el);
}

})();
