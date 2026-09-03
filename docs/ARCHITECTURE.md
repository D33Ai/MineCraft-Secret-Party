# Architecture

Everything lives in `src/game.mjs`, one module, in dependency order. Sections are marked
with banner comments — grep for the banner rather than trusting a line number:

```bash
grep -n '^/\* =\{4,\}' src/game.mjs
```

| Section | What it owns |
| --- | --- |
| *(prologue)* | CDN loader with three mirrors, boot watchdog, fault card, settings and quality presets |
| `constants` | chunk size (16), world height (264), sea level (34), the block table, flat lookup tables for the mesher |
| `noise` | seeded xorshift + integer hash, value noise, fBm, domain warp |
| `texture atlas` | the entire tile set painted procedurally into a canvas at boot, with mip-safe padding |
| `world` | terrain field, chunk generation, decorators, and every set piece carved as terrain |
| `THE CANOPY CITY` | greatwood trees, tiered decks, huts, pods, rope bridges |
| `meshing` | face culling, per-vertex AO, skylight and depth attenuation baked to vertex colour |
| `renderer / scene` | WebGL2 renderer, sky dome, clouds, selection box, materials |
| `chunk manager` | the generate/mesh work queue, streaming and unloading |
| `player` | physics, collision, step-up assist, swimming, flight, the glider |
| `raycast (DDA)` | block picking for break/place |
| `input` | pointer lock state machine, keyboard, touch, mouse |
| `HUD`, `COMPASS + MINIMAP`, `OBJECTIVES` | the interface layer |
| `day cycle` | sun, moon, stars, fog and light colour over a 10-minute day |
| `THE SECRET RAVE` … `THE ELEVATOR CAR` | the venue, instanced crowd, WebAudio set, FX, portal, UFOs, residents, satellite, lift |
| `POST PIPELINE` | HDR bloom and the filmic grade |
| `WILDLIFE` | seabirds, reef fish, fireflies |
| `GAMEPAD`, `EDIT PERSISTENCE` | controller input; per-seed `localStorage` edits |
| `main loop` | fixed-order update, clamped `dt`, adaptive resolution |
| `menu wiring`, `go` | settings UI, staged boot, the `window.ATOLL` hook |

## The rules this engine is built on

Each of these exists because breaking it produced a real bug.

**Content is terrain, not edits.** The rave, the city, the Aerie and the lighthouse are
generated inside the chunk pipeline as pure functions of world (x, z). They stream in and
out with the terrain, survive a reload, cost no bookkeeping, and reproduce exactly from the
seed. Nothing is "placed" after generation.

**Generation and meshing interleave** in the work queue. Draining generation first means
nothing renders until the whole world exists; the world has to appear progressively.

**Chunks unload by data residency, not mesh residency.** Generated-but-never-meshed border
chunks otherwise leak forever as the player travels.

**Actors stand on the sampled surface** (`world.topOpaque`), never on a formula that mirrors
the generator. The two always drift, and then the crowd floats.

**Movement has a one-block step-up assist** — walking only, never in flight, never two
blocks. Without it every stair tread and terrace demands a jump.

**Pointer lock can be refused.** Chrome enforces a cooldown after `Esc`. A click while
unlocked must re-request the lock rather than mine, and `pointerlockerror` and rejected
promises both have to be handled.

**Touch flight has its own vertical controls.** Toggling flight from a button while ascent
is bound to `Space` strands mobile players hovering, so **Jump** becomes **Rise** and a
**Sink** button appears.

**`dt` is clamped (~50 ms)** so a slow frame slows the simulation instead of tunnelling the
player through the floor. The FPS meter measures wall time, not clamped `dt`.

**Seeds are deterministic and live in the URL hash**, so a world is a shareable link.

**Runtime errors after boot must not blank a working world.** They surface in the HUD and
the frame loop keeps running. Before boot they are fatal and show the fault card.

## Performance

Report draw calls and triangles, not FPS — and never from a headless software rasterizer,
where the numbers are meaningless:

```js
renderer.info.render.calls
renderer.info.render.triangles
renderer.info.memory.geometries
renderer.info.programs.length
```

Quality presets scale the crowd size, the particle systems, the render distance and the
device-pixel-ratio cap; `auto` picks by device class and then scales resolution to hold
frame time. Fill rate, not geometry, is where the budget goes.

## Adding to the world

1. Write the generator as a pure function of world (x, z) and call it from the chunk
   pipeline, so it streams and persists like terrain.
2. Sample the surface with `world.topOpaque` for anything that stands on the ground.
3. New blocks go in the block table in `constants` (`def(...)`) *and* the atlas painter;
   `rebuildBlockTables()` refreshes the mesher's lookup tables.
4. Run `npm run build` and `npm test` — the smoke test reads the block table straight out of
   `src/game.mjs`, so a new non-solid block is picked up by the collision check automatically.
