/** Procedural albedo and micro-detail textures used by the terrain material. */
import { hashPixel, tfbm } from '../math/noise.js';
type Three = typeof import('three');
export function makeTexture(THREE:Three,size:number,fill:(u:number,v:number,x:number,y:number)=>number[],srgb:boolean,filter:string,anisotropy:number,maxAnisotropy:number){
 const data=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const c=fill(x/size,y/size,x,y),i=(y*size+x)*4;
  data[i]=THREE.MathUtils.clamp(c[0],0,255);data[i+1]=THREE.MathUtils.clamp(c[1],0,255);data[i+2]=THREE.MathUtils.clamp(c[2],0,255);data[i+3]=255;
 }
 const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);
 texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
 texture.magFilter=filter==='pixel'?THREE.NearestFilter:THREE.LinearFilter;
 texture.minFilter=THREE.LinearMipmapLinearFilter;
 texture.anisotropy=Math.min(anisotropy,maxAnisotropy);texture.generateMipmaps=true;
 if(srgb)texture.colorSpace=THREE.SRGBColorSpace;
 texture.needsUpdate=true;return texture;
}
export function createMacroTexture(THREE:Three,size:number,filter:string,anisotropy:number,maxAnisotropy:number){
 return makeTexture(THREE,size,(u,v)=>{const n=tfbm(u,v,4,5,11),m=tfbm(u,v,8,4,41),d=tfbm(u,v,2,3,71);const tone=.7+n*.6,hue=(m-.5)*.5,dark=Math.max(0,d-.58)*2.2,k=1-dark*.3;return [54*tone*(1+hue)*k,108*tone*k,38*tone*(1-hue)*k]},true,filter,anisotropy,maxAnisotropy);
}
export function createDetailTexture(THREE:Three,size:number,filter:string,anisotropy:number,maxAnisotropy:number){
 return makeTexture(THREE,size,(u,v,x,y)=>{const f=hashPixel(x,y,5),blade=tfbm(u,v,32,3,23),val=(f*.45+blade*.55)*255;return [val,val,val]},false,filter,anisotropy,maxAnisotropy);
}
