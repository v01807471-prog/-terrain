/** CPU and GLSL graph compilation shared by terrain rendering and previews. */
import { F, lin, NODE_TYPES } from './nodes.js';
function planGraph(G,root,stage){
 const roots=Array.isArray(root)?root:[root];
 const byId=new Map(G.nodes.map(n=>[n.id,n])),state=new Map(),steps=[],idx=new Map();
 const visit=id=>{
  if(state.get(id)===2)return;
  if(state.get(id)===1)throw new Error("Цикл в графе");
  state.set(id,1);
  const n=byId.get(id),T=n&&NODE_TYPES[n.type];
  if(!T)throw new Error("Неизвестный узел");
  if(T.g&&stage!=="fs"&&stage!=="pv")throw new Error("«"+T.t+"» работает только в цвете, а не в высоте");
  const inp=T.i.map(([name,ty,def])=>{
   const src=n.in?n.in[name]:null;
   if(src!=null&&byId.has(src)){
    visit(src);
    const so=NODE_TYPES[byId.get(src).type].o;
    if(so==="c"&&ty!=="c")throw new Error("Цвет нельзя подключить к числовому входу");
    return {s:idx.get(src),id:src,f2c:so==="f"&&ty==="c"};
   }
   if(def===null)return {w:name};
   return {k:n.d&&n.d[name]!=null?Number(n.d[name]):def,col:ty==="c"};
  });
  const p={};
  for(const [k,d] of T.p)p[k]=n.p&&n.p[k]!=null?n.p[k]:d;
  idx.set(id,steps.length);
  steps.push({id,T,inp,p});
  state.set(id,2);
 };
 for(const r of roots)visit(r.id);
 return steps;
}

function emitGL(steps,stage,sx,sz,assets){
 const ctx={X:stage==="vs"?"p.x":"pw.x",Z:stage==="vs"?"p.y":"pw.y",sx,sz,slot:name=>{let i=assets.indexOf(name);if(i<0){if(assets.length>=8)throw new Error("Максимум 8 разных текстур-ассетов в графе");i=assets.push(name)-1;}return i;}};
 const lines=[];
 for(const st of steps){
  const a=st.inp.map(q=>q.id!==undefined?(q.f2c?`vec3(g${q.id})`:`g${q.id}`):q.w?(q.w==="x"?ctx.X:ctx.Z):(q.col?`vec3(${F(q.k)})`:F(q.k)));
  lines.push(`${st.T.o==="c"?"vec3":"float"} g${st.id}=${st.T.e(a,st.p,ctx)};`);
 }
 return {code:lines.join("\n"),ret:"g"+steps[steps.length-1].id};
}

function buildCpu(steps,sx,sz){
 const vals=new Float64Array(steps.length),a=[0,0,0],c={x:0,z:0,sx,sz};
 return (x,z)=>{
  c.x=x;c.z=z;
  for(let i=0;i<steps.length;i++){
   const st=steps[i];
   for(let k=0;k<st.inp.length;k++){
    const q=st.inp[k];
    a[k]=q.s!==undefined?vals[q.s]:q.w==="x"?x:q.w==="z"?z:q.k;
   }
   vals[i]=st.T.j(a,st.p,c);
  }
  return vals[steps.length-1];
 };
}

function paramsOf(n){
 const p={};
 for(const [k,d] of NODE_TYPES[n.type].p)p[k]=n.p&&n.p[k]!=null?n.p[k]:d;
 return p;
}

// Значения входов узла-приёмника (океан/туман): считаются один раз, в точке (0,0).
function inputValues(G,n,sx,sz){
 const out={};
 for(const [name,ty,def] of NODE_TYPES[n.type].i){
  const src=n.in&&n.in[name];
  const root=src!=null?G.nodes.find(m=>m.id===src):null;
  out[name]=root?buildCpu(planGraph(G,root,"cpu"),sx,sz)(0,0):(n.d&&n.d[name]!=null?Number(n.d[name]):def);
 }
 return out;
}

export function compileGraph(G){
 const seed=Number(G.seed)||0;
 const sx=ns=>(seed*12.9898+(+ns||0)*47.3)%512;
 const sz=ns=>(seed*78.233+(+ns||0)*21.7)%512;
 const hn=G.nodes.find(n=>n.type==="out_height"),cn=G.nodes.find(n=>n.type==="out_color");
 if(!hn)throw new Error("В графе нет узла «Высота мира»");
 const js=buildCpu(planGraph(G,hn,"cpu"),sx,sz);
 const assets=[];
 const hv=emitGL(planGraph(G,hn,"vs"),"vs",sx,sz,[]);
 let glColor="vec3 base=grassColor;";
 if(cn){
  const cv=emitGL(planGraph(G,cn,"fs"),"fs",sx,sz,assets);
  glColor=cv.code+"\nvec3 base="+cv.ret+";";
 }
 let water=null,fog=null;
 const wn=G.nodes.find(n=>n.type==="out_water"),fn=G.nodes.find(n=>n.type==="out_fog");
 if(wn){
  const v=inputValues(G,wn,sx,sz),p=paramsOf(wn);
  water={on:+p.on?1:0,level:v.level,clarity:Math.max(.01,v.clarity),wave:v.wave,wscale:Math.max(.05,v.wscale),wspeed:v.wspeed,glint:v.glint,foam:v.foam,opacity:v.opacity,shore:v.shore,fade:Math.max(20,v.fade),shallow:lin(p.shallow),deep:lin(p.deep)};
 }
 if(fn){
  const v=inputValues(G,fn,sx,sz),p=paramsOf(fn);
  fog={on:+p.on?1:0,near:v.near,far:v.far,color:p.color};
 }
 return {js,glHeight:hv.code+"\nreturn "+hv.ret+";",glColor,water,fog,assets};
}

// Предпросмотр: все узлы считаются на CPU в сетке N×N вокруг (cx,cz); цвет — приближённо.


export function previewGraph(G,cx,cz,win,N,tex){
 const seed=Number(G.seed)||0;
 const sx=ns=>(seed*12.9898+(+ns||0)*47.3)%512;
 const sz=ns=>(seed*78.233+(+ns||0)*21.7)%512;
 const hn=G.nodes.find(n=>n.type==="out_height");
 if(!hn)throw new Error("нет высоты");
 const hf=buildCpu(planGraph(G,hn,"cpu"),sx,sz);
 const steps=planGraph(G,G.nodes,"pv");
 const vals=new Array(steps.length),a=[0,0,0];
 const store=steps.map(st=>({c:st.T.o==="c",data:new Float32Array(N*N*(st.T.o==="c"?3:1)),min:1e30,max:-1e30}));
 const H=new Float32Array(N*N);
 const px=win/N,c={x:0,z:0,h:0,s:0,sx,sz,tex};
 for(let j=0;j<N;j++){
  for(let i=0;i<N;i++){
   const x=cx-win/2+(i+.5)*px,z=cz-win/2+(j+.5)*px,e=1.5;
   const h=hf(x,z),gx=(hf(x+e,z)-h)/e,gz=(hf(x,z+e)-h)/e;
   c.x=x;c.z=z;c.h=h;c.s=1-1/Math.sqrt(1+gx*gx+gz*gz);
   H[j*N+i]=h;
   for(let si=0;si<steps.length;si++){
    const st=steps[si];
    for(let k=0;k<st.inp.length;k++){
     const q=st.inp[k];
     let v=q.s!==undefined?vals[q.s]:q.w==="x"?x:q.w==="z"?z:q.k;
     if(st.T.i[k][1]==="c"&&typeof v==="number")v=[v,v,v];
     a[k]=v;
    }
    const f=st.T.pv||st.T.j;
    const v=f?f(a,st.p,c):0;
    vals[si]=v;
    const sd=store[si],o=j*N+i;
    if(sd.c){sd.data[o*3]=v[0];sd.data[o*3+1]=v[1];sd.data[o*3+2]=v[2];}
    else{sd.data[o]=v;if(v<sd.min)sd.min=v;if(v>sd.max)sd.max=v;}
   }
  }
 }
 const map=new Map();
 steps.forEach((st,i)=>map.set(st.id,store[i]));
 return {N,H,px,map};
}
