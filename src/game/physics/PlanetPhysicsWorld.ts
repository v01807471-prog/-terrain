import * as THREE from 'three';
import { PLANET_RADIUS, gravityAt } from '../planet/coordinates.js';
import { terrainHeight, type PlanetBlueprint } from '../planet/blueprint.js';

export interface PlanetBody {
 id:number;
 position:THREE.Vector3;
 velocity:THREE.Vector3;
 radius:number;
 mass:number;
 restitution:number;
 friction:number;
}

export class PlanetPhysicsWorld {
 private readonly bodies=new Map<number,PlanetBody>();
 private nextId=1;
 constructor(private readonly blueprint:PlanetBlueprint){}
 addSphere(position:THREE.Vector3,radius=1.25,mass=1):PlanetBody {
  const body:PlanetBody={id:this.nextId++,position:position.clone(),velocity:new THREE.Vector3(),radius,mass,restitution:0.12,friction:0.985};
  this.bodies.set(body.id,body);return body;
 }
 remove(id:number):void{this.bodies.delete(id);}
 clear():void{this.bodies.clear();}
 get all():ReadonlyMap<number,PlanetBody>{return this.bodies;}
 step(dt:number):void {
  const list=[...this.bodies.values()];
  for(const body of list){
   body.velocity.addScaledVector(gravityAt(body.position,this.blueprint.gravity),dt);
   body.position.addScaledVector(body.velocity,dt);
   const radial=body.position.clone().normalize();
   const ground=PLANET_RADIUS+terrainHeight(radial,this.blueprint);
   const minRadius=ground+body.radius;
   if(body.position.length()<minRadius){
    body.position.copy(radial.multiplyScalar(minRadius));
    const normal=body.position.clone().normalize();
    const normalSpeed=body.velocity.dot(normal);
    if(normalSpeed<0)body.velocity.addScaledVector(normal,-(1+body.restitution)*normalSpeed);
    const normalPart=normal.clone().multiplyScalar(body.velocity.dot(normal));
    const tangent=body.velocity.sub(normalPart);
    tangent.multiplyScalar(body.friction);
    body.velocity.copy(normalPart.add(tangent));
   }
  }
  for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
   const a=list[i],b=list[j],delta=b.position.clone().sub(a.position);
   const minDistance=a.radius+b.radius,distance=delta.length();
   if(distance>=minDistance)continue;
   const normal=distance>1e-8?delta.multiplyScalar(1/distance):new THREE.Vector3(1,0,0);
   const invA=1/a.mass,invB=1/b.mass,total=invA+invB;
   const correction=(minDistance-distance)*0.82/total;
   a.position.addScaledVector(normal,-correction*invA);
   b.position.addScaledVector(normal,correction*invB);
   const relative=b.velocity.clone().sub(a.velocity),normalSpeed=relative.dot(normal);
   if(normalSpeed<0){
    const impulse=-(1+Math.min(a.restitution,b.restitution))*normalSpeed/total;
    a.velocity.addScaledVector(normal,-impulse*invA);
    b.velocity.addScaledVector(normal,impulse*invB);
    const tangent=relative.addScaledVector(normal,-normalSpeed);
    if(tangent.lengthSq()>1e-8){
     tangent.normalize().multiplyScalar(Math.min(impulse*0.16,tangent.length()*0.08)/total);
     a.velocity.addScaledVector(tangent,invA);
     b.velocity.addScaledVector(tangent,-invB);
    }
   }
  }
 }
}
