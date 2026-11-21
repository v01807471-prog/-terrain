
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
}