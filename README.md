# clipmap-from-zero

A small, renderer-agnostic clipmap core with a Three.js adapter.

## Design

- The core accepts camera position and world-space center as independent inputs.
- The center can represent any anchor: terrain origin, planet center, streamed-world origin, etc.
- Each level doubles its cell size and snaps its origin to a stable grid.
- Rendering is an adapter; the core does not depend on Three.js or a terrain implementation.

## Quick start

```bash
npm install
npm run dev
```

## API

```ts
const clipmap = new Clipmap({ levels: 8, baseCellSize: 1, resolution: 128 });
const frame = clipmap.update({
  camera: { x: 120, y: 80, z: -45 },
  center: { x: 0, z: 0 }
});
```

Use `setCamera()`, `setCenter()` and `refresh()` when inputs arrive separately.
Use `ThreeClipmap` to attach the state to a Three.js scene.

## Scope

The first iteration provides clipmap level layout and a basic 3D grid preview. Height sampling,
geomorphing, ring stitching, streaming and model-specific integration are intentionally separate
extension points.
