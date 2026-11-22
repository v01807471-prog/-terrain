import * as THREE from 'three';
export const PLANET_RADIUS = 6_371_000;
export const DEG = Math.PI / 180;
export interface GeoPosition { latitude:number; longitude:number; altitude:number; }
export interface PlanetFrame { up:THREE.Vector3; east:THREE.Vector3; north:THREE.Vector3; }
export function frameAt(latitude:number,longitude:number):PlanetFrame {
 const lat=latitude*DEG,lon=longitude*DEG;
 const up=new THREE.Vector3(Math.cos(lat)*Math.cos(lon),Math.sin(lat),Math.cos(lat)*Math.sin(lon)).normalize();
 const east=new THREE.Vector3(-Math.sin(lon),0,Math.cos(lon)).normalize();
 const north=new THREE.Vector3().crossVectors(east,up).normalize();
 return {up,east,north};
}
export function toWorld(p:GeoPosition):THREE.Vector3{return frameAt(p.latitude,p.longitude).up.multiplyScalar(PLANET_RADIUS+p.altitude);}
export function fromWorld(world:THREE.Vector3):GeoPosition {
 const r=world.length(),n=world.clone().normalize();
 return {latitude:Math.asin(THREE.MathUtils.clamp(n.y,-1,1))/DEG,longitude:Math.atan2(n.z,n.x)/DEG,altitude:r-PLANET_RADIUS};
}
export function moveOnSurface(p:GeoPosition,eastMeters:number,northMeters:number):GeoPosition {
 const f=frameAt(p.latitude,p.longitude),t=f.east.multiplyScalar(eastMeters).addScaledVector(f.north,northMeters),d=t.length();
 if(d<1e-8)return {...p};
 const angle=d/PLANET_RADIUS,n=f.up.multiplyScalar(Math.cos(angle)).addScaledVector(t.normalize(),Math.sin(angle)).normalize();
 return {latitude:Math.asin(THREE.MathUtils.clamp(n.y,-1,1))/DEG,longitude:Math.atan2(n.z,n.x)/DEG,altitude:p.altitude};
}
export function gravityAt(world:THREE.Vector3,surfaceGravity=9.81):THREE.Vector3 {
 const radius=Math.max(world.length(),PLANET_RADIUS*0.1);
 return world.clone().normalize().multiplyScalar(-surfaceGravity*(PLANET_RADIUS/radius)**2);
}