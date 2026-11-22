import { runTerrainSelfTests } from '../.test-dist/engine/terrain/selfTest.js';
import { runTerrainPhysicsSelfTests } from '../.test-dist/engine/physics/selfTest.js';
import { runPlanetSelfTests } from '../.test-dist/game/planet/selfTest.js';

const suites = [
  ['Terrain и TerrainEditStore', runTerrainSelfTests()],
  ['Физический прототип', runTerrainPhysicsSelfTests()],
  ['Планетарная система', runPlanetSelfTests()]
];
let total = 0;

for (const [name, result] of suites) {
  total += result.passed.length;
  console.log(`✓ ${name}: ${result.passed.length} проверок`);
  for (const message of result.passed) console.log(`  • ${message}`);
}

console.log(`Успешно выполнено проверок: ${total}`);
