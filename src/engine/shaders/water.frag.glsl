
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uDelta;
uniform vec4 uDeltaInfo;
uniform float uSea;
uniform vec3 uWaterShallow;
uniform vec3 uWaterDeep;
uniform float uClarity;
uniform float uWave;
uniform float uTime;
uniform float uWaveScale;
uniform float uWaveSpeed;
uniform float uGlint;
uniform float uFoam;
uniform float uOpacity;
uniform float uShore;
uniform float uFade;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;

varying vec3 vW;

__NOISE__

float baseHeight(vec2 p){
__GRAPH_HEIGHT__
}

float dfetch(ivec2 i,float n){
 if(i.x<0||i.y<0||float(i.x)>=n||float(i.y)>=n)return 0.0;
 return texelFetch(uDelta,i,0).r;
}

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

void main(){
 vec2 p=vW.xz;
 float depth=uSea-(baseHeight(p)+deltaAt(p));
 float wid=max(.15,uShore);
 if(depth<-wid)discard;

 float dist=length(vW-cameraPosition);
 // Мелкие волны и блики гаснут с расстоянием — вдали вода не мерцает.
 float fade=1.0-smoothstep(uFade*.2,uFade,dist);
 float t=uTime*uWaveSpeed;
 float k=uWaveScale;
 vec2 d1=vec2(.8,.6);
 vec2 d2=vec2(-.5,.86);
 vec2 d3=vec2(.2,-.98);
 vec2 g=(d1*cos(dot(p,d1)*.35*k+t*1.1)*.35*k
  +d2*cos(dot(p,d2)*.8*k+t*1.6)*.8*k*fade
  +d3*cos(dot(p,d3)*1.7*k+t*2.3)*1.7*k*fade)*.05*uWave;
 vec3 N=normalize(vec3(-g.x,1.0,-g.y));
 vec3 V=normalize(cameraPosition-vW);
 float fres=.04+.96*pow(1.0-clamp(dot(N,V),0.0,1.0),4.0);
 float dd=1.0-exp(-max(depth,0.0)*uClarity);

 vec3 water=mix(uWaterShallow,uWaterDeep,dd);
 vec3 sun=normalize(uSunDirection);
 vec3 lit=water*(uAmbient*.6+uSunColor*(.3+.7*max(dot(N,sun),0.0)));
 vec3 sky=pow(uFogColor,vec3(2.2));
 vec3 color=mix(lit,sky,fres);
 float sp=pow(max(dot(reflect(-sun,N),V),0.0),mix(30.0,160.0,fade));
 color+=uSunColor*sp*1.4*uGlint*mix(.35,1.0,fade);

 float foam=(1.0-smoothstep(0.0,wid,depth))*(.55+.45*sin(dot(p,vec2(1.3,.9))*2.0*k+t*2.0))*mix(.5,1.0,fade);
 color=mix(color,vec3(.9),clamp(foam,0.0,1.0)*uFoam);

 float edge=smoothstep(-wid,0.0,depth);
 float alpha=clamp(max(mix(.3,.96,dd),fres*.8)*edge*uOpacity,0.0,1.0);

 color=pow(max(color,vec3(0.0)),vec3(1.0/2.2));
 color=mix(color,uFogColor,smoothstep(uFogNear,uFogFar,dist));
 gl_FragColor=vec4(color,alpha);
}