
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
}