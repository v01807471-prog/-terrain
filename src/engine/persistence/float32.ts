/** Compact base64 serialization for Float32 heightfield buffers. */
export function f32ToB64(arr){
 const u=new Uint8Array(arr.buffer,arr.byteOffset,arr.byteLength);
 let str="";
 for(let i=0;i<u.length;i+=32768)str+=String.fromCharCode.apply(null,u.subarray(i,i+32768));
 return btoa(str);
}

export function b64ToF32(b){
 const str=atob(b),u=new Uint8Array(str.length);
 for(let i=0;i<str.length;i++)u[i]=str.charCodeAt(i);
 return new Float32Array(u.buffer);
}

