# Terrain Editor

A browser-based 3D terrain editor built with React, TypeScript, Vite and Three.js. The rendering core uses a GPU clipmap terrain, procedural GLSL materials, and a CPU height-delta field for sculpt edits.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Development

```bash
npm install
npm run dev
```

## Quality checks

```bash
npm run typecheck
npm run build
```

## Architecture (migration in progress)

- `src/main.tsx` — React application bootstrap and engine loading.
- `src/ui/App.tsx` — React editor shell: tool rail, viewport HUD, inspector and status bar.
- `src/ui/bridge.ts` — temporary compatibility bridge to existing engine actions while controls are migrated.
- `src/styles/workspace.css` — editor workspace layout and visual system.
- `src/engine/terrain-engine.js` — original runtime, retained temporarily to preserve sculpting, undo/redo, graph, asset, water, quality and heightmap workflows.
- `src/engine/math/noise.ts` — deterministic CPU noise and graph sampling functions.
- `src/engine/shaders/*.ts` — terrain, water and shared GLSL templates.
- `src/engine/textures/procedural.ts` — procedural macro and detail texture generation.
- `src/types/terrain.ts` — shared domain contracts.

The React workspace is now the primary application chrome. Existing engine controls are bridged rather than duplicated, so the original terrain runtime remains the source of truth during migration. The large runtime file is not considered finished: the next extraction targets are graph compilation/nodes, sculpt history and brush operations, heightmap persistence, clipmap lifecycle, and renderer orchestration.

## Engineering priorities

1. Preserve current editing and graph behavior while moving responsibilities into small typed modules.
2. Keep terrain height evaluation deterministic and consistent between CPU and GPU.
3. Optimize shader instruction count, texture bandwidth, LOD transitions and render resolution with measurable profiling.
4. Build a flexible editor UX with dockable panels, contextual inspectors, keyboard shortcuts and node-graph workflows.
5. Add regression fixtures for heightmaps, brush operations, graph compilation and shader variants before replacing legacy systems.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) and [GitHub issue #1](https://github.com/v01807471-prog/-terrain/issues/1).
