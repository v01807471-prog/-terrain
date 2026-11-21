# Terrain Editor

A browser-based 3D terrain editor built with Vite, TypeScript and Three.js.

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

## Current architecture

- `src/main.ts` — typed application entry point.
- `src/styles/main.css` — application styles extracted from the original HTML.
- `src/engine/terrain-engine.js` — preserved original Three.js terrain engine, isolated as a migration boundary.
- `src/types/terrain.ts` — shared domain contracts for the typed modules.

The original engine is intentionally preserved first to avoid losing existing features. Its migration into small, strictly typed modules is tracked in the project roadmap and GitHub issue. Do not add new features to the legacy engine; implement them in typed modules and migrate existing systems incrementally.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md).
