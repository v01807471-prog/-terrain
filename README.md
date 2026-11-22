# clipmap-from-zero

A TypeScript clipmap core with a Three.js debug renderer.

## Run

```bash
npm install
npm run dev
```

## What the preview shows

- Seven nested clipmap levels with square ring geometry (outer levels have a central hole).
- A world-aligned checker texture. Checker tiles have a fixed world-space size and do not grow or shrink between levels.
- A wireframe overlay to inspect the actual mesh topology.
- Procedural hills and ridges so height continuity is visible.
- An automatically moving camera to demonstrate snapped clipmap updates.

## Seam handling

- All levels derive their origins from one shared camera-following anchor, snapped once at the finest-level interval. Levels are never snapped independently, so a coarse ring's inner boundary cannot drift away from the fine ring's outer boundary.
- Odd vertices along a fine level's outer boundary collapse onto the matching coarser boundary samples. This removes boundary T-junctions instead of merely hiding them with material.
- An eight-cell transition band geo-morphs fine-level heights toward the coarser level's interpolated surface. At the shared boundary, both levels evaluate to the same coarse edge profile.
- Coarser ring inner boundaries line up with the finer ring outer boundaries.

## Core API

The renderer-agnostic `Clipmap` accepts camera and world center independently:

```ts
const clipmap = new Clipmap({ levels: 7, baseCellSize: 1, resolution: 64 });

clipmap.setCamera({ x: 120, y: 80, z: -45 });
clipmap.setCenter({ x: 0, z: 0 });
const frame = clipmap.refresh();

// Or update both inputs atomically:
clipmap.update({
  camera: { x: 120, y: 80, z: -45 },
  center: { x: 0, z: 0 }
});
```

Use `ThreeClipmap` to attach the generated levels to a Three.js scene. The debug height function and checker material are deliberately simple and can be replaced by a terrain/planet height source without changing the core API.

## Current limitations

This is a diagnostic implementation of square clipmap rings, boundary stitching and height geomorphing. It is not yet a production planetary renderer: normals across morph zones, GPU height sampling, skirts/skirts-free edge cases for arbitrary resolutions, and large-world precision still need dedicated validation.
