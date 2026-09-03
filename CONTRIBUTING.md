# Contributing

## The loop

```bash
npm install
npm run dev            # http://127.0.0.1:8080, assembles src/ on every request
# edit src/game.mjs or src/shell.html, refresh the browser
npm run build          # regenerate index.html
npm test               # headless gate battery, both viewports
```

Edit `src/` only. `index.html` is generated — CI fails if it does not match the sources, and
a hand edit there is lost on the next build.

## Before you open a pull request

- [ ] `npm run check` passes (`node --check` on the module, and `index.html` in sync)
- [ ] `npm test` passes on both viewports, with **zero console errors**
- [ ] `index.html` is rebuilt and committed alongside the `src/` change
- [ ] Screenshots for anything visual — a voxel world is hard to review from a diff

## House rules

**Verify the patch landed.** A string replace that does not match its anchor silently
changes nothing, and dead code has shipped that way. Assert both sides:

```python
assert old in s, "anchor missing"
s = s.replace(old, new, 1)
assert new in s, "insert failed"
```

`node --check` will not catch a temporal dead zone — a `let` declared after the block that
assigns it throws at boot and blanks the world. Boot the page after every patch.

**Prefer structural assertions to screenshots.** A screenshot cannot tell you that a bridge
has a one-block gap in the middle. Query the world's own state through `window.ATOLL`:
count the blocks in a venue, walk every step of a span, check the block under every crowd
instance.

**Do not assert on frame rate.** The test environment is a CPU software rasterizer under
variable load; its FPS numbers say nothing about a phone. Report draw calls and triangles
instead. If a movement threshold fails with the correct direction of travel, that is a test
artifact — say so rather than quietly loosening the test.

**Keep the standing rules.** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) lists the
invariants — content generated as terrain, interleaved generation and meshing, unload by
data residency, step-up assist, refusable pointer lock, clamped `dt`. Each one is there
because breaking it produced a bug.

**Original art only.** The texture atlas is painted in code at boot. No third-party game
assets, textures or names.

**No new runtime dependencies.** The game loads three.js from a CDN and nothing else. Build
and test tooling is dev-only, and `npm install` must stay optional for anyone who only
wants to play.

## Reporting a bug

Include the seed (it is in the URL hash and the menu), the quality preset, the browser and
device, and whether the HUD showed a runtime-error toast. A world is a link: paste the URL
and anyone can load the identical world.
