
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
}