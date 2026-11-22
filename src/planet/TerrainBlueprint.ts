export interface TerrainSettings { seed:number; amplitude:number; frequency:number; }
export const terrainBlueprint = {
  version: 1,
  shader: /* glsl */ `
    uniform float uTime;
    uniform float uAmplitude;
    uniform float uFrequency;
    uniform float uDetailFade;
    varying vec3 vNormal;
    varying float vHeight;
    float hash(vec3 p){p=fract(p*0.3183099+vec3(.1,.2,.3));p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
    float noise3(vec3 p){
      vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
      return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
    }
    vec3 displacePlanet(vec3 p,float radius){
      vec3 d=normalize(p);
      float broad=noise3(d*uFrequency);
      float medium=noise3(d*uFrequency*2.13);
      float fine=noise3(d*uFrequency*5.7);
      // Fade small-scale octaves with camera altitude, keeping broad landforms.
      float n=broad*.65+mix(medium,.5,uDetailFade)*.25+mix(fine,.5,uDetailFade)*.1;
      // Planet units are kilometres; the GUI amplitude is specified in metres.
      float reliefKm=uAmplitude*.001;
      return d*(radius+(n-.48)*reliefKm);
    }`,
  height(direction: {x:number;y:number;z:number}, settings:TerrainSettings) {
    const {x,y,z}=direction, f=settings.frequency;
    const wave=Math.sin(x*f*1.7+y*f*.73+settings.seed)*Math.cos(z*f*1.31-x*f*.41);
    return (wave*.5+Math.sin((x+y+z)*f*.43+settings.seed*2)*.25)*settings.amplitude;
  },
};
