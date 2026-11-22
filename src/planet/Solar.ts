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

  // Scene units are kilometres: mean astronomical distances and orbital periods.
  readonly earthOrbitRadius=149597870.7;
  readonly moonOrbitRadius=384400;
  readonly earthOrbitSpeed=1.991e-7;
  readonly moonOrbitSpeed=2.662e-6;

  constructor(){
    super();
    this.name='Solar';

    this.sun=new THREE.Mesh(
      new THREE.SphereGeometry(696340,64,48),
      new THREE.MeshBasicMaterial({color:0xffc45c})
    );
    this.sun.name='Sun';
    this.add(this.sun);

    this.earthOrbit.name='EarthOrbit';
    this.earthOrbit.rotation.y=Math.PI;
    this.earthOrbit.add(this.createOrbitLine(this.earthOrbitRadius,0x6b91b8,0.42));
    this.add(this.earthOrbit);

    this.earth.name='Earth';
    this.earth.position.set(this.earthOrbitRadius,0,0);
    this.earthOrbit.add(this.earth);

    this.moonOrbit.name='MoonOrbit';
    this.moonOrbit.rotation.x=0.089;
    this.moonOrbit.rotation.y=0.35;
    this.moonOrbit.add(this.createOrbitLine(this.moonOrbitRadius,0xb8c5d6,0.58));
    this.earth.add(this.moonOrbit);

    this.moon.name='Moon';
    this.moon.position.set(this.moonOrbitRadius,0,0);
    this.moonOrbit.add(this.moon);

    this.bodies=[
      {name:'Sun',node:this.sun,radius:696340},
      {name:'Earth',node:this.earth,radius:6371},
      {name:'Moon',node:this.moon,radius:1737}
    ];
    this.updateMatrixWorld(true);
  }

  private createOrbitLine(radius:number,color:number,opacity:number){
    const points:THREE.Vector3[]=[];
    const segments=256;
    for(let i=0;i<segments;i++){
      const angle=(i/segments)*Math.PI*2;
      points.push(new THREE.Vector3(Math.cos(angle)*radius,0,Math.sin(angle)*radius));
    }
    const geometry=new THREE.BufferGeometry().setFromPoints(points);
    const material=new THREE.LineBasicMaterial({color,transparent:true,opacity,depthWrite:false});
    const line=new THREE.LineLoop(geometry,material);
    line.name=`OrbitGuide-${radius}`;
    line.frustumCulled=false;
    return line;
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
