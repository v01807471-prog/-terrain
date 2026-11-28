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

  controller.setKey('KeyW', true);
  assert(controller.keys.KeyW === true, 'состояние нажатой клавиши сохраняется');
  controller.setKey('KeyW', false);
  assert(controller.keys.KeyW === false, 'состояние отпускания клавиши сохраняется');

  camera.position.set(0, 1.72, 18);
  controller.setKey('KeyW', true);
  controller.update(0.1, -100, () => 0);
  assert(Math.abs(camera.position.z - 16.8) < 1e-9, 'игрок движется вперёд со скоростью 12 метров в секунду');
  assert(Math.abs(camera.position.y - 1.72) < 1e-9 && controller.grounded, 'контакт с землёй восстанавливает высоту глаз');
  controller.setKey('KeyW', false);

  controller.setKey('Space', true);
  controller.update(0.1, -100, () => 0);
  assert(camera.position.y > 1.72 && !controller.grounded, 'прыжок сохраняет прежний импульс и отрывает игрока от земли');
  controller.setKey('Space', false);

  const savedPosition = camera.position.clone();
  assert(controller.toggleFreeCamera(), 'переключатель включает свободную камеру');
  controller.setKey('KeyW', true);
  controller.update(0.1, -100, () => -1000);
  assert(camera.position.z < savedPosition.z, 'свободная камера движется по направлению взгляда');
  controller.setKey('KeyW', false);
  assert(!controller.toggleFreeCamera(), 'переключатель возвращает режим игрока');
  assert(camera.position.distanceTo(savedPosition) < 1e-9, 'возврат восстанавливает сохранённую позицию игрока');

  const waterCamera = new PerspectiveCamera(70, 1, 0.1, 1000);
  waterCamera.position.set(0, 0, 0);
  const waterController = new CameraController(waterCamera);
  waterController.setKey('KeyW', true);
  waterController.update(0.1, 1, () => -100);
  assert(Math.abs(waterCamera.position.z + 0.66) < 1e-9, 'в воде горизонтальная скорость уменьшается до 55 процентов');

  controller.setKey('KeyA', true);
  controller.setKey('ShiftLeft', true);
  controller.clearKeys();
  assert(!controller.keys.KeyA && !controller.keys.ShiftLeft, 'потеря фокуса очищает все нажатые клавиши');

  return { passed };
}
