/** Shared node catalog and GLSL/CPU expression helpers for the procedural world graph. */
import { fbmXZ, ridgedXZ } from '../math/noise.js';
export const F=v=>{
 v=Number(v);
 if(!Number.isFinite(v))v=0;
 const t=String(v);
 const f=/[.e]/.test(t)?t:t+".0";
 return v<0?"("+f+")":f;
};
export const oc=o=>Math.max(1,Math.min(8,Math.round(Number(o)||1)));
export const lin=h=>{
 if(!/^#[0-9a-f]{6}$/i.test(h))h="#808080";
 return [1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4));
};

// i: входы [имя,тип,значение по умолчанию (null = мировая координата)], p: параметры [имя,значение,вид]
// o: тип выхода (f число / c цвет), g: только для цвета (фрагментный шейдер), sink: конечный узел
export const NODE_TYPES={
 x:{t:"Позиция X",o:"f",i:[],p:[],e:(a,p,c)=>c.X,j:(a,p,c)=>c.x},
 z:{t:"Позиция Z",o:"f",i:[],p:[],e:(a,p,c)=>c.Z,j:(a,p,c)=>c.z},
 num:{t:"Число",o:"f",i:[],p:[["v",1]],e:(a,p)=>F(p.v),j:(a,p)=>Number(p.v)},
 noise:{t:"Шум fbm [-1..1]",o:"f",i:[["x","f",null],["z","f",null]],p:[["scale",.01],["ox",0],["oz",0],["oct",4],["ns",0]],
  e:(a,p,c)=>`fbmXZ(${a[0]}*${F(p.scale)}+${F(+p.ox+c.sx(p.ns))},${a[1]}*${F(p.scale)}+${F(+p.oz+c.sz(p.ns))},${oc(p.oct)})`,
  j:(a,p,c)=>fbmXZ(a[0]*p.scale+(+p.ox+c.sx(p.ns)),a[1]*p.scale+(+p.oz+c.sz(p.ns)),oc(p.oct))},
 ridged:{t:"Хребты [0..1]",o:"f",i:[["x","f",null],["z","f",null]],p:[["scale",.01],["ox",0],["oz",0],["oct",4],["ns",0]],
  e:(a,p,c)=>`ridgedXZ(${a[0]}*${F(p.scale)}+${F(+p.ox+c.sx(p.ns))},${a[1]}*${F(p.scale)}+${F(+p.oz+c.sz(p.ns))},${oc(p.oct)})`,
  j:(a,p,c)=>ridgedXZ(a[0]*p.scale+(+p.ox+c.sx(p.ns)),a[1]*p.scale+(+p.oz+c.sz(p.ns)),oc(p.oct))},
 add:{t:"Сложить",o:"f",i:[["a","f",0],["b","f",0]],p:[],e:a=>`(${a[0]}+${a[1]})`,j:a=>a[0]+a[1]},
 sub:{t:"Вычесть",o:"f",i:[["a","f",0],["b","f",0]],p:[],e:a=>`(${a[0]}-${a[1]})`,j:a=>a[0]-a[1]},
 mul:{t:"Умножить",o:"f",i:[["a","f",1],["b","f",1]],p:[],e:a=>`(${a[0]}*${a[1]})`,j:a=>a[0]*a[1]},
 min:{t:"Минимум",o:"f",i:[["a","f",0],["b","f",0]],p:[],e:a=>`min(${a[0]},${a[1]})`,j:a=>Math.min(a[0],a[1])},
 max:{t:"Максимум",o:"f",i:[["a","f",0],["b","f",0]],p:[],e:a=>`max(${a[0]},${a[1]})`,j:a=>Math.max(a[0],a[1])},
 abs:{t:"Модуль",o:"f",i:[["a","f",0]],p:[],e:a=>`abs(${a[0]})`,j:a=>Math.abs(a[0])},
 pow:{t:"Степень",o:"f",i:[["a","f",0]],p:[["e",2]],e:(a,p)=>`pow(max(${a[0]},0.0),${F(p.e)})`,j:(a,p)=>Math.pow(Math.max(a[0],0),p.e)},
 clamp:{t:"Ограничить",o:"f",i:[["a","f",0]],p:[["lo",0],["hi",1]],e:(a,p)=>`clamp(${a[0]},${F(p.lo)},${F(p.hi)})`,j:(a,p)=>Math.min(Math.max(a[0],p.lo),p.hi)},
 smooth:{t:"Плавный переход",o:"f",i:[["a","f",0]],p:[["e0",0],["e1",1]],
  e:(a,p)=>`smoothstep(${F(p.e0)},${F(p.e1)},${a[0]})`,
  j:(a,p)=>{const t=Math.min(Math.max((a[0]-p.e0)/((p.e1-p.e0)||1e-6),0),1);return t*t*(3-2*t);}},
 mixf:{t:"Смешать числа",o:"f",i:[["a","f",0],["b","f",1],["t","f",.5]],p:[],e:a=>`mix(${a[0]},${a[1]},${a[2]})`,j:a=>a[0]+(a[1]-a[0])*a[2]},
 remap:{t:"Пересчёт диапазона",o:"f",i:[["a","f",0]],p:[["im",0],["iM",1],["om",0],["oM",1]],
  e:(a,p)=>`(${F(p.om)}+(${a[0]}-${F(p.im)})*${F((p.oM-p.om)/((p.iM-p.im)||1e-6))})`,
  j:(a,p)=>p.om+(a[0]-p.im)*((p.oM-p.om)/((p.iM-p.im)||1e-6))},
 terrace:{t:"Террасы",o:"f",i:[["a","f",0]],p:[["step",4],["sharp",1]],
  e:(a,p)=>`mix(${a[0]},floor(${a[0]}/${F(p.step||1)}+0.5)*${F(p.step||1)},${F(p.sharp)})`,
  j:(a,p)=>a[0]+(Math.floor(a[0]/(p.step||1)+.5)*(p.step||1)-a[0])*p.sharp},
 height:{t:"Высота точки",o:"f",g:1,i:[],p:[],pv:(a,p,c)=>c.h,e:()=>"vHeight"},
 slope:{t:"Уклон 0..1",o:"f",g:1,i:[],p:[],pv:(a,p,c)=>c.s,e:()=>"slopeV"},
 grass:{t:"Текстура: трава",o:"c",g:1,i:[],p:[],pv:(a,p,c)=>c.tex?c.tex.grass(c.x,c.z):[.03,.14,.02],e:()=>"grassColor"},
 rock:{t:"Текстура: скала",o:"c",g:1,i:[],p:[],pv:(a,p,c)=>c.tex?c.tex.rock(c.x,c.z):[.16,.145,.13],e:()=>"rockColor"},
 tex_asset:{t:"Текстура из ассетов",o:"c",g:1,i:[],p:[["asset","b_grass","asset"],["tile",4],["tri",0]],
  pv:(a,p,c)=>c.tex&&c.tex.asset?c.tex.asset(p.asset,c.x/(p.tile||1),c.z/(p.tile||1)):[.5,.5,.5],
  e:(a,p,c)=>{
   const U="uAsset"+c.slot(p.asset),T=F(p.tile||1);
   if(+p.tri)return `(texture2D(${U},pw/${T}).rgb*tw.y+texture2D(${U},vWorldPosition.zy/${T}).rgb*tw.x+texture2D(${U},vWorldPosition.xy/${T}).rgb*tw.z)`;
   return `mix(texture2D(${U},pw/${T}).rgb,textureLod(${U},pw/${T},12.0).rgb,smoothstep(60.0,400.0,dist))`;
  }},
 color:{t:"Цвет",o:"c",g:1,i:[],p:[["col","#808080","color"]],pv:(a,p)=>lin(p.col),e:(a,p)=>{const c=lin(p.col);return `vec3(${F(c[0])},${F(c[1])},${F(c[2])})`;}},
 cmix:{t:"Смешать цвета",o:"c",g:1,i:[["a","c",0],["b","c",0],["t","f",.5]],p:[],pv:a=>[a[0][0]+(a[1][0]-a[0][0])*a[2],a[0][1]+(a[1][1]-a[0][1])*a[2],a[0][2]+(a[1][2]-a[0][2])*a[2]],e:a=>`mix(${a[0]},${a[1]},${a[2]})`},
 cmul:{t:"Цвет × число",o:"c",g:1,i:[["a","c",0],["b","f",1]],p:[],pv:a=>[a[0][0]*a[1],a[0][1]*a[1],a[0][2]*a[1]],e:a=>`(${a[0]}*${a[1]})`},
 out_height:{t:"▶ Высота мира",o:"f",sink:1,i:[["h","f",0]],p:[],e:a=>a[0],j:a=>a[0]},
 out_color:{t:"▶ Цвет земли",o:"c",g:1,sink:1,i:[["c","c",0]],p:[],pv:a=>a[0],e:a=>a[0]},
 out_water:{t:"▶ Океан",o:"f",sink:1,i:[["level","f",-6],["clarity","f",.35],["wave","f",1],["wscale","f",1],["wspeed","f",1],["glint","f",1],["foam","f",.75],["opacity","f",1],["shore","f",.6],["fade","f",220]],p:[["on",1],["shallow","#2f9aa3","color"],["deep","#0a2c4d","color"]]},
 out_fog:{t:"▶ Туман",o:"f",sink:1,i:[["near","f",0],["far","f",0]],p:[["on",1],["color","#9dc7e1","color"]]}
};
