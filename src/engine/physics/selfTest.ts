import { Terrain } from '../terrain/Terrain.js';
import { FixedStepLoop } from './FixedStepLoop.js';
import { PhysicsWorld } from './PhysicsWorld.js';

/** Простые проверки без стороннего test runner; выбрасывают ошибку при нарушении инварианта. */
export function runTerrainPhysicsSelfTests(): { passed: string[] } {
  const passed: string[] = [];
  const assert = (condition: boolean, message: string) => {
    if (!condition) throw new Error('Terrain physics self-test: ' + message);
    passed.push(message);
  };
  const terrain = new Terrain(() => 0, { editCellSize: 0.5, editChunkSize: 16 });
  const original = terrain.getHeight(0, 0);
  assert(terrain.edits.allocatedChunkCount === 0, 'нет заранее выделенных блоков высот');
  terrain.applyEdit(0, 0, 2, 3);
  assert(terrain.getHeight(0, 0) > original + 2.9, 'локальная правка меняет высоту');
  assert(terrain.edits.allocatedChunkCount > 0, 'память выделяется при первой правке');
  terrain.clearEdits();
  assert(Math.abs(terrain.getHeight(0, 0) - original) < 1e-5, 'очистка возвращает исходную высоту');
  assert(terrain.edits.allocatedChunkCount === 0, 'после очистки блоки освобождены');
  const physics = new PhysicsWorld(terrain);
  const ball = physics.addSphere({ id: 'test-ball', position: { x: 0, y: 2, z: 0 }, radius: 0.25, mass: 1 });
  const loop = new FixedStepLoop(physics);
  let totalSteps = 0;
  for (let i = 0; i < 240; i++) totalSteps += loop.advance(1 / 60).steps;
  assert(totalSteps === 240, 'фиксированный цикл выполняет ожидаемое число шагов');
  assert(Number.isFinite(ball.position.y) && Number.isFinite(ball.velocity.y), 'состояние сферы остаётся конечным');
  assert(ball.position.y >= ball.radius - 0.015, 'сфера не проваливается сквозь плоский Terrain');
  assert(ball.grounded, 'сфера распознаёт контакт с Terrain');

  const pairWorld = new PhysicsWorld(terrain);
  const left = pairWorld.addSphere({
    id: 'pair-left', position: { x: -0.24, y: 5, z: 0 }, radius: 0.25,
    mass: 1, restitution: 0.2, velocity: { x: 1, y: 0, z: 0 }
  });
  const right = pairWorld.addSphere({
    id: 'pair-right', position: { x: 0.24, y: 5, z: 0 }, radius: 0.25,
    mass: 1, restitution: 0.2, velocity: { x: -1, y: 0, z: 0 }
  });
  pairWorld.step(1 / 60);
  const pairDistance = Math.hypot(
    right.position.x - left.position.x,
    right.position.y - left.position.y,
    right.position.z - left.position.z
  );
  assert(pairDistance >= left.radius + right.radius - 0.005, 'две сферы не остаются взаимно проникшими');
  assert(left.velocity.x < right.velocity.x, 'импульс меняет относительные скорости сталкивающихся сфер');
  assert(Math.abs(left.mass * left.velocity.x + right.mass * right.velocity.x) < 0.02,
    'столкновение сфер сохраняет линейный импульс по оси контакта');
  return { passed };
}
