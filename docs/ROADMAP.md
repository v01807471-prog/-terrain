# Terrain Editor — engineering roadmap

The goal is a powerful, extensible terrain authoring tool. Work in small vertical slices; preserve existing behavior and keep the build green.

## Phase 0 — Foundation
- [x] Move to Vite and strict TypeScript project configuration.
- [x] Extract HTML, CSS and the existing Three.js engine into separate files.
- [x] Keep the existing terrain editor features working during the migration.
- [ ] Add automated smoke tests and CI build/typecheck.
- [ ] Establish formatting and lint rules.

## Phase 1 — Typed engine architecture
- [ ] Replace the legacy IIFE with an explicit `TerrainApplication` lifecycle (init, update, resize, dispose).
- [ ] Split renderer, scene, camera, input, world and UI into independent modules.
- [ ] Introduce typed configuration, event bus and dependency boundaries.
- [ ] Remove direct DOM lookups from terrain algorithms; use typed UI adapters.
- [ ] Add unit tests for deterministic terrain algorithms.

## Phase 2 — Terrain data and editing
- [ ] Create a canonical heightfield data model with configurable resolution and world scale.
- [ ] Separate brush algorithms: raise/lower, flatten, smooth, slope, noise, terrace, ramp and plateau.
- [ ] Add pressure/tilt-ready brush input, falloff curves, symmetry and stroke interpolation.
- [ ] Make undo/redo transactional, bounded and serializable.
- [ ] Support non-destructive layers, masks, blending and per-layer visibility/locking.
- [ ] Add selection, region editing and transform tools.

## Phase 3 — Procedural generation
- [ ] Build a typed node graph with validation, cycle detection and deterministic seeds.
- [ ] Add noise families (Perlin/Simplex/Worley), domain warping and fractal composition.
- [ ] Add erosion: hydraulic, thermal, talus and sediment transport.
- [ ] Add rivers, watersheds, coastlines, biomes and spline-based roads.
- [ ] Support reusable graph presets and custom nodes.

## Phase 4 — Rendering and performance
- [ ] Keep clipmap/LOD rendering while isolating GPU resources and shaders.
- [ ] Add adaptive LOD, frustum/occlusion culling and GPU profiling.
- [ ] Add material layers, splat maps, triplanar mapping and texture painting.
- [ ] Add water, atmosphere, vegetation scattering and lighting presets.
- [ ] Move expensive generation and erosion jobs to Web Workers/GPU compute where appropriate.

## Phase 5 — Import, export and production workflow
- [ ] Versioned project format with migrations and autosave.
- [ ] Import/export PNG, RAW, 16/32-bit heightmaps and tiled terrain.
- [ ] Export meshes and textures to glTF/GLB and common game-engine workflows.
- [ ] Add asset library, presets, project settings and recovery snapshots.
- [ ] Add keyboard shortcut manager, command palette and contextual tool help.

## Phase 6 — Reliability and extensibility
- [ ] Plugin API for tools, generators, importers and exporters.
- [ ] Public typed API and stable extension points.
- [ ] Performance budgets, regression fixtures and large-world stress tests.
- [ ] Accessibility, localization and responsive editor layout.

## Definition of done
- Strict TypeScript checks pass; no new untyped code in the legacy engine.
- Existing editing, graph, import/export and camera workflows remain functional.
- New algorithms have deterministic tests and documented performance characteristics.
- Large projects remain responsive and can be saved/reopened without data loss.
