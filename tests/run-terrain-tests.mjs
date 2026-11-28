import { runTerrainSelfTests } from '../.test-dist/engine/terrain/selfTest.js';
import { runTerrainPhysicsSelfTests } from '../.test-dist/engine/physics/selfTest.js';
import { runStrokeHistorySelfTests } from '../.test-dist/engine/legacy/StrokeHistory.selfTest.js';
import { runStrokeJournalSelfTests } from '../.test-dist/engine/legacy/StrokeJournal.selfTest.js';
import { runBrushMathSelfTests } from '../.test-dist/engine/legacy/brushMath.selfTest.js';
import { runEditorTelemetrySelfTests } from '../.test-dist/ui/EditorTelemetry.js';
import { runClipmapLayoutSelfTests } from '../.test-dist/engine/renderer/ClipmapLayout.selfTest.js';
import { runCameraControllerSelfTests } from '../.test-dist/engine/renderer/CameraController.selfTest.js';

const suites = [
  ['Terrain и TerrainEditStore', runTerrainSelfTests()],
  ['История мазков', runStrokeHistorySelfTests()],
  ['Журнал мазков', runStrokeJournalSelfTests()],
  ['Математика кистей', runBrushMathSelfTests()],
  ['Телеметрия редактора', runEditorTelemetrySelfTests()],
  ['Размещение основного Clipmap', runClipmapLayoutSelfTests()],
  ['Контроллер камеры', runCameraControllerSelfTests()],
  ['Физический прототип', runTerrainPhysicsSelfTests()]
];
let total = 0;

for (const [name, result] of suites) {
  total += result.passed.length;
  console.log(`✓ ${name}: ${result.passed.length} проверок`);
  for (const message of result.passed) console.log(`  • ${message}`);
}

console.log(`Успешно выполнено проверок: ${total}`);
