import type { PhysicsWorld } from './PhysicsWorld.js';

export interface FixedStepResult {
  steps: number;
  alpha: number;
  droppedTime: number;
}

/** Аккумулятор фиксированного времени; рендер вызывается отдельно вызывающим кодом. */
export class FixedStepLoop {
  private accumulator = 0;

  constructor(
    readonly world: PhysicsWorld,
    readonly fixedDelta = 1 / 60,
    readonly maxSubSteps = 8,
    readonly maxFrameDelta = 0.1
  ) {
    if (!(fixedDelta > 0) || !Number.isInteger(maxSubSteps) || maxSubSteps < 1) {
      throw new Error('Некорректные параметры FixedStepLoop');
    }
  }

  advance(frameDelta: number): FixedStepResult {
    const accepted = Math.max(0, Math.min(frameDelta, this.maxFrameDelta));
    let droppedTime = Math.max(0, frameDelta - accepted);
    this.accumulator += accepted;
    let steps = 0;

    while (this.accumulator >= this.fixedDelta && steps < this.maxSubSteps) {
      this.world.step(this.fixedDelta);
      this.accumulator -= this.fixedDelta;
      steps++;
    }

    if (this.accumulator >= this.fixedDelta) {
      const retained = this.accumulator % this.fixedDelta;
      droppedTime += this.accumulator - retained;
      this.accumulator = retained;
    }

    return { steps, alpha: this.accumulator / this.fixedDelta, droppedTime };
  }

  reset(): void {
    this.accumulator = 0;
  }
}
