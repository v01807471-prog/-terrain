# Базовый прототип Terrain и физики

## Что уже реализовано

- Процедурный Terrain: высота вычисляется по координатам; можно подключить CPU-функцию из Blueprint через Terrain.fromGraph(graph).
- Seed участвует в стандартной процедурной основе.
- getHeight, getNormal, getSlope и sampleSurface обслуживают точечные запросы.
- TerrainEditStore хранит разреженные дельты в блоках с ленивым выделением памяти.
- clearEdits() удаляет локальные изменения и освобождает блоки.
- PhysicsWorld интегрирует сферические тела, учитывает гравитацию, контакт с heightfield, нормальный импульс, трение и вращение.
- Контакт проверяет центр и восемь дополнительных точек в проекции сферы, поэтому не ограничивается одной высотой под центром.
- Ограниченные адаптивные подшаги уменьшают вероятность туннелирования при быстром движении.
- FixedStepLoop использует аккумулятор фиксированного времени и возвращает alpha для интерполяции рендера.
- runTerrainPhysicsSelfTests() проверяет ленивую память, сброс правок, фиксированный цикл и контакт сферы с плоским Terrain.

## Минимальное использование

```ts
import { Terrain } from './terrain/index.js';
import { PhysicsWorld, FixedStepLoop } from './physics/index.js';

const terrain = new Terrain();
const physics = new PhysicsWorld(terrain);
const ball = physics.addSphere({
  id: 'ball',
  position: { x: 0, y: 18, z: 0 },
  radius: 0.5,
  mass: 1,
  friction: 0.7
});
const loop = new FixedStepLoop(physics);

// В игровом кадре:
const result = loop.advance(frameDeltaSeconds);
const renderPosition = physics.getInterpolatedPosition(ball.id, result.alpha);
```

Для Blueprint-графа вместо стандартной основы:

```ts
const terrain = Terrain.fromGraph(blueprintGraph);
```

Локальная правка и сброс:

```ts
terrain.applyEdit(12, -4, 3, 2.5); // поднять участок
terrain.clearEdits();              // вернуть исходную процедурную основу
```

## Ограничения первой версии

Это базовый heightfield-прототип, а не полноценный физический движок:
- Пока реализованы сферы и столкновение с Terrain; взаимодействия тело-тело, капсулы, транспорт и сложные rigid-body контакты ещё не добавлены.
- Контакт ищется по девяти точкам на проекции сферы; для тонких деталей и нависающих скал нужен отдельный collision mesh/SDF.
- Адаптивные подшаги — начальная защита от туннелирования, но это ещё не полноценный swept-sphere CCD.
- Материалы Terrain пока не задают физические коэффициенты трения/упругости.
- CPU Blueprint height function подключается напрямую; отдельная проверка численного совпадения CPU и GLSL ещё нужна.
- Renderer и legacy HTML runtime пока не переключены на новый Terrain API. Интеграция должна выполняться отдельным безопасным этапом.
