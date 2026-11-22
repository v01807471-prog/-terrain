import * as THREE from 'three';

/**
 * Hierarchical solar-system scene graph.
 * Solar is the root; Earth orbits the Sun; the Moon orbits Earth.
 * Child positions are local, so parent motion propagates automatically.
 */
export class Solar extends THREE.Group {
  readonly sun:THREE.Mesh;
  readonly earthOrbit=new THREE.Group();
  readonly earth=new THREE.Group();
  readonly moonOrbit=new THREE.Group();
  readonly moon=new THREE.Group();
  readonly bodies:Array<{name:string;node:THREE.Object3D;radius:number}>;

  readonly earthOrbitRadius=30000;
  readonly moonOrbitRadius=38440;
  readonly earthOrbitSpeed=0.00005;
  readonly moonOrbitSpeed=0.00012;

  constructor(){
    super();
    this.name='Solar';

    this.sun=new THREE.Mesh(
      new THREE.SphereGeometry(3500,48,32),
      new THREE.MeshBasicMaterial({color:0xffc45c})
    );
    this.sun.name='Sun';
    this.add(this.sun);

    this.earthOrbit.name='EarthOrbit';
    this.earthOrbit.rotation.y=Math.PI;
    this.add(this.earthOrbit);

    this.earth.name='Earth';
    this.earth.position.set(this.earthOrbitRadius,0,0);
    this.earthOrbit.add(this.earth);

    this.moonOrbit.name='MoonOrbit';
    this.moonOrbit.rotation.x=0.089;
    this.moonOrbit.rotation.y=1.15;
    this.earth.add(this.moonOrbit);

    this.moon.name='Moon';
    this.moon.position.set(this.moonOrbitRadius,0,0);
    this.moonOrbit.add(this.moon);

    this.bodies=[
      {name:'Sun',node:this.sun,radius:3500},
      {name:'Earth',node:this.earth,radius:6371},
      {name:'Moon',node:this.moon,radius:1737}
    ];
    this.updateMatrixWorld(true);
  }

  update(deltaSeconds:number){
    this.earthOrbit.rotation.y+=this.earthOrbitSpeed*deltaSeconds;
    this.moonOrbit.rotation.y+=this.moonOrbitSpeed*deltaSeconds;
    this.updateMatrixWorld(true);
  }

  getWorldPositionOf(body:THREE.Object3D,target=new THREE.Vector3()){
    this.updateMatrixWorld(true);
    return body.getWorldPosition(target);
  }
}
