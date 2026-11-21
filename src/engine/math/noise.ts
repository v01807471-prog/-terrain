/** Deterministic CPU noise for terrain sampling, graph evaluation and texture generation. */
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
function hash2(x,z){
 let h=(Math.imul(x+65536,1597334673)^Math.imul(z+65536,3812015801))>>>0;
 h=Math.imul(h^(h>>>16),2246822519)>>>0;
 h^=h>>>13;
 h=Math.imul(h,3266489917)>>>0;
 h^=h>>>16;
 return (h>>>8)/8388607.5-1;
}

function smooth01(t){
 return t*t*(3-2*t);
}

function noise2(x,z){
 const ix=Math.floor(x);
 const iz=Math.floor(z);

 const fx=smooth01(x-ix);
 const fz=smooth01(z-iz);

 const a=hash2(ix,iz);
 const b=hash2(ix+1,iz);
 const c=hash2(ix,iz+1);
 const d=hash2(ix+1,iz+1);

 return lerp(
  lerp(a,b,fx),
  lerp(c,d,fx),
  fz
 );
}

function fbm(x,z){
 let v=0;
 let a=.5;
 let total=0;

 for(let i=0;i<4;i++){
  v+=noise2(x,z)*a;
  total+=a;
  x*=2.02;
  z*=2.02;
  a*=.5;
 }

 return v/total;
}

function originalBaseHeight(x,z){
 return 6+
  fbm(x*.0048,z*.0048)*42+
  fbm(x*.018+31,z*.018-17)*12+
  fbm(x*.065-13,z*.065+42)*1.8;
}
function hashPixel(x,y,seed=0){
 let n=(Math.imul(x+seed,374761393)^Math.imul(y-seed,668265263))|0;

 n=Math.imul(n^(n>>>13),1274126177);
 n^=n>>>16;

 return (n>>>0)/4294967295;
}

// Тайлящийся value-noise для процедурных текстур 256×256.
function tnoise(x,y,p,seed){
 const ix=Math.floor(x),iy=Math.floor(y);
 const fx=smooth01(x-ix),fy=smooth01(y-iy);
 const h=(a,b)=>hashPixel(((a%p)+p)%p,((b%p)+p)%p,seed);
 const L=lerp;
 return L(L(h(ix,iy),h(ix+1,iy),fx),L(h(ix,iy+1),h(ix+1,iy+1),fx),fy);
}

function tfbm(u,v,base,oct,seed){
 let s=0,a=.5,t=0,p=base;
 for(let i=0;i<oct;i++){
  s+=tnoise(u*p,v*p,p,seed+i*7)*a;
  t+=a;p*=2;a*=.5;
 }
 return s/t;
}
function fbmXZ(x,z,o){
 let v=0,a=.5,t=0;
 for(let i=0;i<o;i++){
  v+=noise2(x,z)*a;
  t+=a;
  x*=2.02;
  z*=2.02;
  a*=.5;
 }
 return v/t;
}

function ridgedXZ(x,z,o){
 const v=1-Math.abs(fbmXZ(x,z,o));
 return v*v;
}

const NOISE_GLSL=`
float hash2(vec2 i){
 uvec2 q=uvec2(i+65536.0);
 uint h=(q.x*1597334673u)^(q.y*3812015801u);
 h=(h^(h>>16))*2246822519u;
 h^=h>>13;
 h*=3266489917u;
 h^=h>>16;
 return float(h>>8)*(1.0/8388607.5)-1.0;
}

float noise2(vec2 p){
 vec2 i=floor(p);
 vec2 f=fract(p);
 f=f*f*(3.0-2.0*f);
 float a=hash2(i);
 float b=hash2(i+vec2(1.0,0.0));
 float c=hash2(i+vec2(0.0,1.0));
 float d=hash2(i+vec2(1.0,1.0));
 return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}

float fbmXZ(float x,float z,int o){
 vec2 p=vec2(x,z);
 float v=0.0;
 float a=.5;
 float t=0.0;
 for(int i=0;i<8;i++){
  if(i>=o)break;
  v+=noise2(p)*a;
  t+=a;
  p*=2.02;
  a*=.5;
 }
 return v/t;
}

float ridgedXZ(float x,float z,int o){
 float v=1.0-abs(fbmXZ(x,z,o));
 return v*v;
}
`;
