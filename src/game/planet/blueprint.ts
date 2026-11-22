import * as THREE from 'three';
import { PLANET_RADIUS } from './coordinates.js';
export interface PlanetBlueprint {version:1;seed:number;radius:number;seaLevel:number;heightAmplitude:number;continentalScale:number;mountainScale:number;detailScale:number;atmosphereHeight:number;gravity:number;}
export const DEFAULT_PLANET:PlanetBlueprint={version:1,seed:1731,radius:PLANET_RADIUS,seaLevel:-120,heightAmplitude:4200,continentalScale:2.4,mountainScale:18,detailScale:5,atmosphereHeight:100_000,gravity:9.81};
function hash3(x:number,y:number,z:number,seed:number):number{const v=Math.sin(x*127.1+y*311.7+z*74.7+seed*0.013)*43758.5453123;return (v-Math.floor(v))*2-1;}
function noise3(p:THREE.Vector3,seed:number):number {
 const ix=Math.floor(p.x),iy=Math.floor(p.y),iz=Math.floor(p.z),fx=p.x-ix,fy=p.y-iy,fz=p.z-iz;
 const sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy),sz=fz*fz*(3-2*fz);
 const a=THREE.MathUtils.lerp(hash3(ix,iy,iz,seed),hash3(ix+1,iy,iz,seed),sx);
 const b=THREE.MathUtils.lerp(hash3(ix,iy+1,iz,seed),hash3(ix+1,iy+1,iz,seed),sx);
 const c=THREE.MathUtils.lerp(hash3(ix,iy,iz+1,seed),hash3(ix+1,iy,iz+1,seed),sx);
 const d=THREE.MathUtils.lerp(hash3(ix,iy+1,iz+1,seed),hash3(ix+1,iy+1,iz+1,seed),sx);
 return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a,b,sy),THREE.MathUtils.lerp(c,d,sy),sz);
}
export function terrainHeight(direction:THREE.Vector3,b:PlanetBlueprint=DEFAULT_PLANET):number {
 const p=direction.clone().normalize(),continent=noise3(p.clone().multiplyScalar(b.continentalScale),b.seed);
 const mountain=Math.max(0,noise3(p.clone().multiplyScalar(b.mountainScale),b.seed+31));
 const detail=noise3(p.clone().multiplyScalar(b.mountainScale*4),b.seed+97);
 return continent*b.heightAmplitude*0.58+Math.pow(mountain,2.2)*b.heightAmplitude*0.72+detail*b.detailScale;
}
export function terrainHeightGLSL(b:PlanetBlueprint=DEFAULT_PLANET):string {
 const seed=b.seed.toFixed(1),cs=b.continentalScale.toFixed(3),ms=b.mountainScale.toFixed(3),amp=(b.heightAmplitude*0.58).toFixed(3),peak=(b.heightAmplitude*0.72).toFixed(3),detail=b.detailScale.toFixed(3);
 return 'float hashPlanet(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7))+'+seed+'*0.013)*43758.5453123)*2.0-1.0;}\n'
 +'float noisePlanet(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);float a=mix(hashPlanet(i),hashPlanet(i+vec3(1,0,0)),f.x);float b=mix(hashPlanet(i+vec3(0,1,0)),hashPlanet(i+vec3(1,1,0)),f.x);float c=mix(hashPlanet(i+vec3(0,0,1)),hashPlanet(i+vec3(1,0,1)),f.x);float d=mix(hashPlanet(i+vec3(0,1,1)),hashPlanet(i+vec3(1,1,1)),f.x);return mix(mix(a,b,f.y),mix(c,d,f.y),f.z);}\n'
 +'float planetHeight(vec3 direction){vec3 n=normalize(direction);float continent=noisePlanet(n*'+cs+');float mountain=max(0.0,noisePlanet(n*'+ms+'));float detail=noisePlanet(n*'+(b.mountainScale*4).toFixed(3)+');return continent*'+amp+'+pow(mountain,2.2)*'+peak+'+detail*'+detail+';}';
}