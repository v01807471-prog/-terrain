import { PerspectiveCamera } from 'three';
import { CameraController } from './CameraController.js';

// Автоматические проверки сохранения поведения камеры и режимов перемещения.
export function runCameraControllerSelfTests(): { passed: string[] } {
  const passed: string[] = [];
  const assert = (condition: boolean, message: string): void => {
    if (!condition) throw new Error('Camera controller self-test: ' + message);
    passed.push(message);
  };

  const camera = new PerspectiveCamera(70, 1, 0.1, 1000);
  camera.position.set(0, 1.72, 18);
  const controller = new CameraController(camera);

  assert(controller.yaw === 0 && controller.pitch === -0.19, 'сохраняются начальные углы камеры');
  assert(camera.rotation.order === 'YXZ', 'камера использует прежний порядок вращения YXZ');
  assert(!controller.handleMouseMove(40, 20), 'мышь не вращает камеру без Pointer Lock');

  controller.setPointerLocked(true);
  assert(!controller.handleMouseMove(120, 120), 'первое событие после захвата указателя пропускается');
  assert(!controller.handleMouseMove(120, 120), 'второе событие после захвата указателя пропускается');
  assert(!controller.handleMouseMove(120, 120), 'третье событие после захвата указателя пропускается');
  assert(controller.handleMouseMove(1000, -1000), 'после защитных событий мышь снова управляет камерой');
  assert(Math.abs(controller.yaw + 0.264) < 1e-9, 'движение мыши ограничивается прежним пределом 120 пикселей');
  assert(Math.abs(controller.pitch - 0.074) < 1e-9, 'наклон камеры вычисляется с прежней чувствительностью');
  controller.setPointerLocked(false);
  assert(!controller.handleMouseMove(10, 10), 'после потери Pointer Lock вращение прекращается');

  const movementCamera = new PerspectiveCamera(70, 1, 0.1, 1000);
  movementCamera.position.set(0, 1.72, 18);
  const movement = new CameraController(movementCamera);
  movement.setKey('KeyW', true);
  movement.update(0.1, -100, () => 0);
  assert(Math.abs(movementCamera.position.z - 16.8) < 1e-9, 'игрок движется вперёд со скоростью 12 метров в секунду');
  assert(Math.abs(movementCamera.position.y - 1.72) < 1e-9 && movement.grounded, 'контакт с землёй восстанавливает высоту глаз');
  movement.setKey('KeyW', false);

  movement.setKey('Space', true);
  movement.update(0.1, -100, () => 0);
  assert(movementCamera.position.y > 1.72 && !movement.grounded, 'прыжок сохраняет прежний импульс и отрывает игрока от земли');
  movement.setKey('Space', false);

  const savedPosition = movementCamera.position.clone();
  assert(movement.toggleFreeCamera(), 'переключатель включает свободную камеру');
  movement.setKey('KeyW', true);
  movement.update(0.1, -100, () => -1000);
  assert(movementCamera.position.z < savedPosition.z, 'свободная камера движется по направлению взгляда');
  movement.setKey('KeyW', false);
  assert(!movement.toggleFreeCamera(), 'переключатель возвращает режим игрока');
  assert(movementCamera.position.distanceTo(savedPosition) < 1e-9, 'возврат восстанавливает сохранённую позицию игрока');

  const waterCamera = new PerspectiveCamera(70, 1, 0.1, 1000);
  waterCamera.position.set(0, 0, 0);
  const waterController = new CameraController(waterCamera);
  waterController.setKey('KeyW', true);
  waterController.update(0.1, 1, () => -100);
  assert(Math.abs(waterCamera.position.z + 0.66) < 1e-9, 'в воде горизонтальная скорость уменьшается до 55 процентов');

  movement.setKey('KeyA', true);
  movement.setKey('ShiftLeft', true);
  movement.clearKeys();
  assert(!movement.keys.KeyA && !movement.keys.ShiftLeft, 'потеря фокуса очищает все нажатые клавиши');

  return { passed };
}
