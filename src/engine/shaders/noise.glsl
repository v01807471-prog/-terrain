
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
