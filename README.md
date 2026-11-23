# Quadtree Terrain from Zero

A modular Three.js terrain prototype built around an adaptive quadtree chunk system.

## Run

```bash
npm install
npm run dev
npm run typecheck
npm run build
```

## Coordinate model

Terrain tiles use a **planet-local coordinate frame**. The planet root is the local origin; camera world position is transformed into that frame before LOD selection. Chunks never follow the camera and their local positions remain stable while the planet root can be translated or rotated in a larger solar-system scene.

This avoids using huge solar-system coordinates for terrain sampling. It is a planet-centred local frame, not yet a full scene-wide floating-origin rebasing system for arbitrary astronomical distances.

## Architecture

- `config/TerrainConfig.ts` — validated quadtree and mesh settings.
- `math/PlanetLocalFrame.ts` — world-camera to planet-local conversion.
- `quadtree/QuadNode.ts`, `QuadTile.ts` — stable spatial node identity and bounds.
- `lod/QuadtreeLodSelector.ts` — distance-based adaptive subdivision.
- `culling/ChunkFrustumCuller.ts` — CPU frustum rejection in planet-local coordinates before mesh allocation.
- `geometry/TerrainHeight.ts`, `TerrainGeometryFactory.ts` — deterministic height field and chunk mesh generation.
- `render/ChunkRenderer.ts` — active chunk set, mesh reuse pool and Three.js per-mesh frustum culling.
- `render/TerrainMaterial.ts` — shader material setup.
- `shaders/*.glsl` — vertex and fragment shaders, kept outside TypeScript classes.
- `QuadtreeTerrain.ts` — high-level terrain facade.

## Current implementation

- Stable tile coordinates relative to the planet root; camera motion changes LOD selection, not chunk positions.
- Quadtree recursively splits tiles based on camera distance, with a minimum-distance floor to avoid runaway subdivision at tile boundaries.
- CPU frustum culling rejects chunks behind/outside the camera before geometry is allocated; each resulting Mesh also has Three.js frustum culling enabled.
- Chunks are reused through a mesh pool when the selected visible leaf set changes.
- Edge skirts currently hide cracks between different LOD resolutions. Skirts are a first-pass seam solution; exact neighbor-level stitching and geomorphing are future work.
- Height is generated deterministically from planet-local coordinates.
- Shader source is stored in standalone GLSL files.

## Deliberate limitations

This is the first architectural foundation, not a production planetary renderer. It does not yet include balanced-neighbor enforcement, stitch index patterns, geomorphing, asynchronous terrain data, GPU height sampling, instanced vegetation/rocks, or full scene-wide floating-origin rebasing. The planet-local frame keeps terrain coordinates small and stable for a planet-sized scene; a separate floating-origin coordinator will be needed if the whole scene spans astronomical distances.
