# Planetary World

A clean, standalone planetary exploration game entry. It is additive: the legacy application and the experimental V2 remain separate.

## Run

```bash
npm install
npm run dev
``

Open `/planet-game.html`.

## Controls

- WASD: move on the surface / steer in flight
- Mouse: look around (click the scene to capture the pointer; Escape releases it)
- Space: jump / upward thrust
- Shift: downward thrust in flight
- F: toggle flight mode
- Mouse wheel: camera distance
- B: spawn a physics sphere
- X: remove all spawned spheres

## Architecture

- `src/game/planet/coordinates.ts`: spherical world coordinates, geodetic position, local east/north/up frame, great-circle surface movement and radial gravity.
- `src/game/planet/blueprint.ts`: deterministic planet blueprint and matching CPU/GLSL procedural height function.
- `src/game/game.ts`: game loop, player controller, planet body, concentric local terrain LOD rings, atmosphere, stars and camera.
- `src/game/physics/PlanetPhysicsWorld.ts`: radial gravity, terrain contact, restitution, friction and sphere-to-sphere collision.
- `src/game/game.css`: minimal in-game HUD; no graph editor or diagnostic dashboard.

The planet is globally anchored at its center. Player altitude is measured from the generated local surface for display and contact, while geodetic coordinates are latitude/longitude. The local terrain rings reorient around the player and use the same direction-based height function as the global planetary mesh.

## Current foundation scope

This branch establishes a playable planetary prototype and the coordinate/terrain architecture. It is not yet a finished production game: terrain texturing, tile-streamed clipmap rings, robust capsule/rigid-body collision, save/load, audio, objectives and full atmosphere scattering remain subsequent implementation work.
