import * as THREE from 'three';
import { frameAt, fromWorld, gravityAt, moveOnSurface, toWorld, PLANET_RADIUS } from './coordinates.js';
import { DEFAULT_PLANET, terrainHeight } from './blueprint.js';
import { PlanetPhysicsWorld } from '../physics/PlanetPhysicsWorld.js';

export function runPlanetSelfTests():{passed:string[]} {
 const passed:string[]=[];
 const position={latitude:42.5,longitude:-73.2,altitude:1234};
 const roundTrip=fromWorld(toWorld(position));
 if(Math.abs(roundTrip.latitude-position.latitude)>1e-8||Math.abs(roundTrip.longitude-position.longitude)>1e-8||Math.abs(roundTrip.altitude-position.altitude)>1e-6)throw new Error('Geodetic round trip failed');
 passed.push('Геодезические координаты преобразуются без потери широты, долготы и высоты');

 const frame=frameAt(42.5,-73.2);
 if(Math.abs(frame.up.dot(frame.east))>1e-8||Math.abs(frame.up.dot(frame.north))>1e-8||Math.abs(frame.east.dot(frame.north))>1e-8)throw new Error('Planet frame is not orthogonal');
 passed.push('Локальный базис восток/север/вверх ортогонален');

 const moved=moveOnSurface({latitude:0,longitude:0,altitude:10},1000,0);
 if(!(moved.longitude>0)||Math.abs(moved.latitude)>1e-8)throw new Error('Great-circle east movement failed');
 passed.push('Перемещение по поверхности корректно меняет долготу вдоль большой окружности');

 const gravity=gravityAt(new THREE.Vector3(PLANET_RADIUS+1000,0,0),DEFAULT_PLANET.gravity);
 if(!(gravity.x<0)||Math.abs(gravity.y)>1e-8||Math.abs(gravity.z)>1e-8)throw new Error('Gravity is not radial');
 passed.push('Гравитация направлена к центру планеты');

 const direction=new THREE.Vector3(0.3,0.8,-0.4).normalize();
 if(terrainHeight(direction)!==terrainHeight(direction.clone()))throw new Error('Terrain seed is not deterministic');
 passed.push('Процедурная высота детерминирована для одного seed');

 const physics=new PlanetPhysicsWorld(DEFAULT_PLANET);
 const floor=PLANET_RADIUS+terrainHeight(direction);
 const body=physics.addSphere(direction.clone().multiplyScalar(floor+30),1,1);
 for(let i=0;i<900;i++)physics.step(1/120);
 const expected=PLANET_RADIUS+terrainHeight(body.position.clone().normalize())+body.radius;
 if(!Number.isFinite(body.position.length())||body.position.length()<expected-0.02)throw new Error('Sphere terrain contact failed');
 passed.push('Физический шар падает к поверхности и не проваливается сквозь планету');

 return {passed};
}
