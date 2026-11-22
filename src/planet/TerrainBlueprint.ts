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
  heightKm(direction: {x:number;y:number;z:number}, settings: {amplitude:number;frequency:number}, detailFade=0) {
    const fract=(v:number)=>v-Math.floor(v);
    const hash=(ix:number,iy:number,iz:number)=>{
      const px=fract(ix*.3183099+.1)*17;
      const py=fract(iy*.3183099+.2)*17;
      const pz=fract(iz*.3183099+.3)*17;
      return fract(px*py*pz*(px+py+pz));
    };
    const noise=(x:number,y:number,z:number)=>{
      const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
      const fx=fract(x),fy=fract(y),fz=fract(z);
      const sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy),sz=fz*fz*(3-2*fz);
      const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
      const a=mix(hash(ix,iy,iz),hash(ix+1,iy,iz),sx);
      const b=mix(hash(ix,iy+1,iz),hash(ix+1,iy+1,iz),sx);
      const c=mix(hash(ix,iy,iz+1),hash(ix+1,iy,iz+1),sx);
      const d=mix(hash(ix,iy+1,iz+1),hash(ix+1,iy+1,iz+1),sx);
      return mix(mix(a,b,sy),mix(c,d,sy),sz);
    };
    const f=settings.frequency;
    const broad=noise(direction.x*f,direction.y*f,direction.z*f);
    const medium=noise(direction.x*f*2.13,direction.y*f*2.13,direction.z*f*2.13);
    const fine=noise(direction.x*f*5.7,direction.y*f*5.7,direction.z*f*5.7);
    const n=broad*.65+(medium+(0.5-medium)*detailFade)*.25+(fine+(0.5-fine)*detailFade)*.1;
    return (n-.48)*settings.amplitude*.001;
  },
  height(direction: {x:number;y:number;z:number}, settings:TerrainSettings) {
    const {x,y,z}=direction, f=settings.frequency;
    const wave=Math.sin(x*f*1.7+y*f*.73+settings.seed)*Math.cos(z*f*1.31-x*f*.41);
    return (wave*.5+Math.sin((x+y+z)*f*.43+settings.seed*2)*.25)*settings.amplitude;
  },
};
