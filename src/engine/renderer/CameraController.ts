import { Vector3, type Camera } from 'three';

export interface CameraControllerOptions {
  readonly yaw?: number;
  readonly pitch?: number;
  readonly eyeHeight?: number;
}

/**
 * Управляет режимами камеры, вводом и перемещением игрока.
 * Модуль не создаёт DOM-обработчики: legacy runtime передаёт сюда события ввода,
 * а сам контроллер отвечает за состояние и движение камеры.
 */
export class CameraController {
  readonly keys: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
  readonly savedPlayerPosition = new Vector3();

  yaw: number;
  pitch: number;
  verticalVelocity = 0;
  grounded = false;
  detached = false;
  pointerLocked = false;

  private readonly eyeHeight: number;
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private mouseEventsToSkip = 0;

  constructor(
    private readonly camera: Camera,
    options: CameraControllerOptions = {}
  ) {
    this.yaw = options.yaw ?? 0;
    this.pitch = options.pitch ?? -0.19;
    this.eyeHeight = options.eyeHeight ?? 1.72;

    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  setPointerLocked(locked: boolean): void {
    this.pointerLocked = locked;
    // Первые события после захвата указателя могут содержать скачок координат.
    this.mouseEventsToSkip = 3;
  }

  handleMouseMove(movementX: number, movementY: number): boolean {
    if (!this.pointerLocked) return false;

    if (this.mouseEventsToSkip > 0) {
      this.mouseEventsToSkip--;
      return false;
    }

    const mx = Math.max(-120, Math.min(120, movementX));
    const my = Math.max(-120, Math.min(120, movementY));

    this.yaw -= mx * 0.0022;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - my * 0.0022));
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    return true;
  }

  setKey(code: string, pressed: boolean): void {
    this.keys[code] = pressed;
  }

  clearKeys(): void {
    for (const code in this.keys) this.keys[code] = false;
  }

  toggleFreeCamera(): boolean {
    this.detached = !this.detached;

    if (this.detached) {
      this.savedPlayerPosition.copy(this.camera.position);
      this.verticalVelocity = 0;
    } else {
      this.camera.position.copy(this.savedPlayerPosition);
      this.verticalVelocity = 0;
      this.grounded = true;
    }

    return this.detached;
  }

  /**
   * Обновляет движение с прежними скоростями, гравитацией и водным режимом.
   * Временные векторы переиспользуются; кадровый вызов не выделяет объекты.
   */
  update(
    dt: number,
    seaLevel: number,
    groundHeight: (x: number, z: number) => number
  ): void {
    const position = this.camera.position;
    const keys = this.keys;

    if (this.detached) {
      const speed = keys.ShiftLeft ? 100 : 35;
      this.camera.getWorldDirection(this.forward);
      this.right.crossVectors(this.forward, this.camera.up).normalize();

      if (keys.KeyW) position.addScaledVector(this.forward, speed * dt);
      if (keys.KeyS) position.addScaledVector(this.forward, -speed * dt);
      if (keys.KeyD) position.addScaledVector(this.right, speed * dt);
      if (keys.KeyA) position.addScaledVector(this.right, -speed * dt);

      if (keys.Space) position.y += speed * dt;
      if (keys.ControlLeft || keys.ControlRight) position.y -= speed * dt;
      return;
    }

    const inWater = (position.y - this.eyeHeight) < seaLevel - 0.4;
    const speed = (keys.ShiftLeft ? 25 : 12) * (inWater ? 0.55 : 1);
    const step = speed * dt;
    const sinYaw = Math.sin(this.yaw);
    const cosYaw = Math.cos(this.yaw);

    if (keys.KeyW) {
      position.x += -sinYaw * step;
      position.z += -cosYaw * step;
    }
    if (keys.KeyS) {
      position.x += sinYaw * step;
      position.z += cosYaw * step;
    }
    if (keys.KeyD) {
      position.x += cosYaw * step;
      position.z += -sinYaw * step;
    }
    if (keys.KeyA) {
      position.x += -cosYaw * step;
      position.z += sinYaw * step;
    }

    const ground = groundHeight(position.x, position.z);
    const feet = position.y - this.eyeHeight;
    const snap = Math.max(0.7, speed * dt * 2);

    // Прилипание к склону при спуске, иначе игрок «падает» шагами.
    if (this.grounded && !keys.Space && feet - ground <= snap) {
      position.y = ground + this.eyeHeight;
      this.verticalVelocity = 0;
    } else {
      if (inWater) {
        this.verticalVelocity -= 5 * dt;
        this.verticalVelocity *= Math.exp(-2.5 * dt);
        if (keys.Space) this.verticalVelocity = Math.max(this.verticalVelocity, 3.2);
      } else {
        this.verticalVelocity -= 24 * dt;
      }

      if (keys.Space && this.grounded && !inWater) {
        this.verticalVelocity = 8.5;
        this.grounded = false;
      }

      position.y += this.verticalVelocity * dt;
    }

    if (position.y - this.eyeHeight <= ground + 1e-4) {
      position.y = ground + this.eyeHeight;
      this.verticalVelocity = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
  }
}
