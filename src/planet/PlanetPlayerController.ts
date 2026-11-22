import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

type HeightSampler = (worldDirection: THREE.Vector3) => number;

/**
 * Third-person surface controller. World units are kilometres, matching Solar
 * and SphericalClipmap. The character position is planet-relative in meaning,
 * but stored in world space so orbital translation can be applied without a
 * scene transition.
 */
export class PlanetPlayerController {
  private active = false;
  private readonly keys = new Set<string>();
  private readonly center = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly up = new THREE.Vector3(1, 0, 0);
  private readonly east = new THREE.Vector3();
  private readonly north = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly tangentMove = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly cameraOffset = new THREE.Vector3();
  private readonly cameraRadial = new THREE.Vector3();
  private radius = 6371;
  private gravity = 9.81;
  private yaw = 0;
  private pitch = 0.18;
  private cameraDistance = 0.0045;
  private grounded = true;
  private jumpQueued = false;
  private pointerLocked = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly controls: OrbitControls,
    private readonly avatar: THREE.Group,
    private readonly sampleHeight: HeightSampler
  ) {
    canvas.addEventListener('click', this.onCanvasClick);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clearKeys);
    window.addEventListener('wheel', this.onWheel, { passive: true });
  }

  get isActive(): boolean { return this.active; }
  get worldPosition(): THREE.Vector3 { return this.position; }

  enter(center: THREE.Vector3, radius: number, direction: THREE.Vector3): void {
    this.active = true;
    this.center.copy(center);
    this.radius = radius;
    this.velocity.set(0, 0, 0);
    this.grounded = true;
    this.cameraDistance = 0.0045;
    this.up.copy(direction).normalize();
    this.position.copy(center).addScaledVector(this.up, radius + this.sampleHeight(this.up) + 0.00008);
    this.yaw = 0;
    this.pitch = 0.18;
    this.avatar.visible = true;
    this.controls.enabled = false;
    this.updateFrame();
    this.updateCamera();
  }

  shiftWorld(delta: THREE.Vector3): void {
    if (!this.active) return;
    this.position.add(delta);
    this.center.add(delta);
  }

  update(dt: number, center: THREE.Vector3, radius: number, gravity: number): void {
    if (!this.active) return;
    this.center.copy(center);
    this.radius = radius;
    this.gravity = gravity;
    this.updateFrame();

    const forwardInput = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
    const sideInput = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
    this.forward.copy(this.north).multiplyScalar(Math.cos(this.yaw))
      .addScaledVector(this.east, Math.sin(this.yaw)).normalize();
    this.right.crossVectors(this.forward, this.up).normalize();
    this.tangentMove.copy(this.forward).multiplyScalar(forwardInput)
      .addScaledVector(this.right, sideInput);
    if (this.tangentMove.lengthSq() > 1) this.tangentMove.normalize();

    const footOffset = 0.00008; // 8 cm
    const surfaceHeight = this.sampleHeight(this.up);
    const surfaceRadius = radius + surfaceHeight;
    const radialDistance = this.position.distanceTo(center);

    if (this.grounded && this.jumpQueued) {
      this.velocity.copy(this.up).multiplyScalar(0.0065); // 6.5 m/s
      this.grounded = false;
    }
    this.jumpQueued = false;

    if (this.grounded) {
      const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      const speed = sprint ? 0.011 : 0.0065; // 6.5 / 11 m/s
      const distance = speed * dt * this.tangentMove.length();
      if (distance > 0) {
        const tangent = this.tangentMove.clone().normalize();
        const angle = distance / Math.max(radius, 1);
        this.up.multiplyScalar(Math.cos(angle)).addScaledVector(tangent, Math.sin(angle)).normalize();
      }
      const nextHeight = this.sampleHeight(this.up);
      this.position.copy(center).addScaledVector(this.up, radius + nextHeight + footOffset);
      this.velocity.set(0, 0, 0);
    } else {
      const gravityKm = gravity * 0.001 * (radius / Math.max(radialDistance, radius * 0.1)) ** 2;
      this.velocity.addScaledVector(this.up, -gravityKm * dt);
      this.velocity.addScaledVector(this.tangentMove, 0.012 * dt);
      this.position.addScaledVector(this.velocity, dt);

      const radial = this.position.clone().sub(center).normalize();
      const ground = radius + this.sampleHeight(radial);
      if (this.position.distanceTo(center) <= ground + footOffset) {
        this.position.copy(center).addScaledVector(radial, ground + footOffset);
        const normalSpeed = this.velocity.dot(radial);
        if (normalSpeed < 0) this.velocity.addScaledVector(radial, -normalSpeed);
        this.grounded = true;
      }
      this.up.copy(radial);
    }

    this.updateFrame();
    this.avatar.position.copy(this.position);
    const back = this.forward.clone().negate();
    this.avatar.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(this.right, this.up, back)
    );
    this.updateCamera();
  }

  detach(): void {
    if (!this.active) return;
    this.active = false;
    this.keys.clear();
    this.avatar.visible = false;
    this.controls.enabled = true;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    const radial = this.position.clone().sub(this.center).normalize();
    this.camera.position.copy(this.center).addScaledVector(radial, this.radius + this.cameraDistance);
    this.controls.target.copy(this.center);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.center);
    this.controls.minDistance = this.radius + 1;
    this.controls.update();
  }

  dispose(): void {
    this.canvas.removeEventListener('click', this.onCanvasClick);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clearKeys);
    window.removeEventListener('wheel', this.onWheel);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private updateFrame(): void {
    this.up.copy(this.position).sub(this.center).normalize();
    const reference = Math.abs(this.up.y) > 0.995
      ? new THREE.Vector3(0, 0, 1)
      : new THREE.Vector3(0, 1, 0);
    this.east.crossVectors(reference, this.up).normalize();
    this.north.crossVectors(this.up, this.east).normalize();
    this.forward.copy(this.north).multiplyScalar(Math.cos(this.yaw))
      .addScaledVector(this.east, Math.sin(this.yaw)).normalize();
    this.right.crossVectors(this.forward, this.up).normalize();
  }

  private updateCamera(): void {
    this.target.copy(this.position).addScaledVector(this.up, 0.00145);
    const horizontalDistance = this.cameraDistance * Math.cos(this.pitch);
    this.cameraOffset.copy(this.forward).multiplyScalar(-horizontalDistance)
      .addScaledVector(this.up, this.cameraDistance * (0.32 + Math.sin(this.pitch)));
    this.camera.position.copy(this.target).add(this.cameraOffset);
    this.camera.lookAt(this.target.clone().addScaledVector(this.forward, 0.012));
    this.camera.up.copy(this.up);
    this.controls.target.copy(this.target);

    this.cameraRadial.copy(this.camera.position).sub(this.center).normalize();
    const cameraGround = this.radius + this.sampleHeight(this.cameraRadial) + 0.0002;
    const cameraRadius = this.camera.position.distanceTo(this.center);
    if (cameraRadius < cameraGround) {
      this.camera.position.copy(this.center).addScaledVector(this.cameraRadial, cameraGround);
      this.camera.lookAt(this.target);
    }
  }

  private onCanvasClick = (): void => {
    if (this.active && !this.pointerLocked) void this.canvas.requestPointerLock();
  };

  private onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    if (!this.pointerLocked) this.keys.clear();
  };

  private onMouseMove = (event: MouseEvent): void => {
    if (!this.active || !this.pointerLocked) return;
    this.yaw -= event.movementX * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * 0.0018, -0.85, 0.9);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.active) return;
    if (['Space', 'ShiftLeft', 'ShiftRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) {
      event.preventDefault();
    }
    if (event.code === 'Space' && !event.repeat) this.jumpQueued = true;
    this.keys.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private clearKeys = (): void => { this.keys.clear(); };

  private onWheel = (event: WheelEvent): void => {
    if (!this.active) return;
    this.cameraDistance *= Math.exp(event.deltaY * 0.002);
    if (this.cameraDistance > 150) {
      this.detach();
      return;
    }
    this.cameraDistance = THREE.MathUtils.clamp(this.cameraDistance, 0.003, 150);
  };
}
