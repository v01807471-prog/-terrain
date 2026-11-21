/** Terrain surface and clipmap wireframe GLSL templates. */
export const terrainVertexTemplate=`
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uDelta;
uniform vec4 uDeltaInfo;
uniform float uStep;
uniform float uHalf;
uniform float uAlt;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vHeight;

__NOISE__

float baseHeight(vec2 p){
__GRAPH_HEIGHT__
}

float dfetch(ivec2 i,float n){
 if(i.x<0||i.y<0||float(i.x)>=n||float(i.y)>=n)return 0.0;
 return texelFetch(uDelta,i,0).r;
}

// Правки: карта высот (дельта), билинейно — ровно так же считается на CPU.
float deltaAt(vec2 p){
 vec2 t=(p-uDeltaInfo.xy)*uDeltaInfo.z;
 float n=uDeltaInfo.w;
 if(t.x<-1.0||t.y<-1.0||t.x>=n||t.y>=n)return 0.0;
 vec2 fl=floor(t);
 vec2 f=t-fl;
 ivec2 i=ivec2(fl);
 return mix(
  mix(dfetch(i,n),dfetch(i+ivec2(1,0),n),f.x),
  mix(dfetch(i+ivec2(0,1),n),dfetch(i+ivec2(1,1),n),f.x),
  f.y);
}

float terrainHeight(vec2 p){
 return baseHeight(p)+deltaAt(p);
}

void main(){
 vec4 world=modelMatrix*vec4(position,1.0);
 vec2 p=world.xz;
 float s=uStep;

 vec2 cd=abs(p-cameraPosition.xz);
 float d=max(max(cd.x,cd.y),uAlt);
 float mEnd=uHalf-2.0*s;
 float k=smoothstep(mEnd-uHalf*.25,mEnd,d);

 float h0=terrainHeight(p);
 float h=h0;

 // Нечётные вершины сползают на поверхность грубого уровня (та же диагональ b–c).
 vec2 odd=mod(floor(p/s+.5),2.0);
 if(k>0.0&&odd.x+odd.y>.5){
  float hc;
  if(odd.x>.5&&odd.y>.5)hc=.5*(terrainHeight(p+vec2(s,-s))+terrainHeight(p+vec2(-s,s)));
  else if(odd.x>.5)hc=.5*(terrainHeight(p+vec2(s,0.0))+terrainHeight(p-vec2(s,0.0)));
  else hc=.5*(terrainHeight(p+vec2(0.0,s))+terrainHeight(p-vec2(0.0,s)));
  h=mix(h0,hc,k);
 }

 // Шаг нормали растёт с LOD: дальние участки сглажены и не мерцают.
 float e=.5*s*(1.0+k);
 float hx=terrainHeight(p+vec2(e,0.0));
 float hz=terrainHeight(p+vec2(0.0,e));

 vNormal=normalize(vec3(-(hx-h0)/e,1.0,-(hz-h0)/e));
 vWorldPosition=vec3(p.x,h,p.y);
 vUv=p/32.0;
 vHeight=h;

 gl_Position=projectionMatrix*viewMatrix*vec4(p.x,h,p.y,1.0);
}`;

export const terrainFragmentTemplate=`
precision highp float;
precision highp int;

uniform sampler2D uMacroTex;
uniform sampler2D uDetailTex;
uniform float uAlt;
uniform float uDetailScale;
uniform float uDetailStrength;
uniform sampler2D uAsset0;
uniform sampler2D uAsset1;
uniform sampler2D uAsset2;
uniform sampler2D uAsset3;
uniform sampler2D uAsset4;
uniform sampler2D uAsset5;
uniform sampler2D uAsset6;
uniform sampler2D uAsset7;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform float uGrid;
uniform float uStep;
uniform float uCut;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying float vHeight;

__NOISE__

void main(){
 vec2 pw=vWorldPosition.xz;
 vec3 macro=texture2D(uMacroTex,pw/16.0).rgb;
 vec3 macroAvg=textureLod(uMacroTex,pw/16.0,12.0).rgb;
 float dTex=texture2D(uDetailTex,pw/uDetailScale).r;

 // Внутреннюю область рисует более подробный уровень.
 vec2 cd=abs(vWorldPosition.xz-cameraPosition.xz);
 if(max(max(cd.x,cd.y),uAlt)<uCut)discard;

 float dist=length(vWorldPosition-cameraPosition);

 // Вдали детальная текстура заменяется средним цветом (нет мерцания).
 vec3 grassColor=mix(macro,macroAvg,smoothstep(150.0,900.0,dist));
 grassColor*=mix(1.0,dTex*2.0,uDetailStrength*(1.0-smoothstep(12.0,90.0,dist)));

 vec3 n=normalize(vNormal);

 // Скала на склонах: триплантарная проекция (без растяжения).
 vec3 tw=pow(abs(n),vec3(4.0));
 tw/=tw.x+tw.y+tw.z;
 float rd=texture2D(uDetailTex,vWorldPosition.zy/uDetailScale).r*tw.x+
  texture2D(uDetailTex,vWorldPosition.xz/uDetailScale).r*tw.y+
  texture2D(uDetailTex,vWorldPosition.xy/uDetailScale).r*tw.z;
 vec3 rockColor=vec3(.16,.145,.13)*(.55+rd*.9);
 float slopeV=1.0-clamp(n.y,0.0,1.0);

 // Цвет земли из графа мира.
__GRAPH_COLOR__

 float diffuse=max(dot(n,normalize(uSunDirection)),0.0);
 float lighting=.42+diffuse*.78;
 vec3 color=base*(uAmbient*.38+uSunColor*lighting);

 float slope=1.0-clamp(n.y,0.0,1.0);
 color*=1.0-slope*.12;

 if(uGrid>.5){
  // Клетки размером с шаг этого LOD: вдали они крупнее.
  vec2 q=vWorldPosition.xz/uStep;
  vec2 g=abs(fract(q)-.5);
  vec2 fw=fwidth(q);
  vec2 w=max(fw,vec2(.015));
  vec2 lines=smoothstep(vec2(.5)-w,vec2(.5),g);
  float fade=1.0-smoothstep(.2,.45,max(fw.x,fw.y));
  color=mix(color,vec3(.02,.04,.02),max(lines.x,lines.y)*.7*fade);
 }

 color=pow(max(color,vec3(0.0)),vec3(1.0/2.2));
 color=mix(color,uFogColor,smoothstep(uFogNear,uFogFar,dist));
 gl_FragColor=vec4(color,1.0);
}`;

export const wireFragmentShader=`
precision highp float;

uniform float uCut;
uniform float uOuter;
uniform float uAlt;
uniform float uLevel;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;

varying vec3 vWorldPosition;

void main(){
 vec2 cd=abs(vWorldPosition.xz-cameraPosition.xz);
 float dd=max(max(cd.x,cd.y),uAlt);
 if(dd<uCut||dd>=uOuter)discard;

 vec3 c=.5+.5*cos(6.28318*(uLevel/8.0+vec3(0.0,.33,.67)));
 float fog=smoothstep(uFogNear,uFogFar,length(vWorldPosition-cameraPosition));
 gl_FragColor=vec4(mix(c,uFogColor,fog),1.0);
}`;
