#!/usr/bin/env node
/* Cache the three.js build the game loads, so the smoke test can run without
 * reaching a CDN (offline CI, restricted egress, a flaky mirror day).
 * The version is read from the loader in src/game.mjs so the cache can never
 * drift from what the game actually imports.
 *
 *   node scripts/fetch-engine.mjs   →  .cache/three-<version>.module.js
 */
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const game = await readFile(join(ROOT, 'src/game.mjs'), 'utf8');
const version = (game.match(/three@(\d+\.\d+\.\d+)/) || [])[1];
if (!version) { console.error('fetch-engine: no three@<version> found in the CDN loader'); process.exit(1); }

/* three's ESM build is two files: three.module.js re-exports three.core.js.
   Both must be cached or the offline route serves a cycle. */
const FILES = ['three.module.js', 'three.core.js'];
const dest = (f) => join(ROOT, '.cache', `three-${version}.${f.replace('three.', '')}`);
if (FILES.every((f) => existsSync(dest(f)))) { console.log(`fetch-engine: three ${version} already cached in .cache/`); process.exit(0); }

await mkdir(join(ROOT, '.cache'), { recursive: true });
const tmp = join(ROOT, '.cache', 'tmp');
await mkdir(tmp, { recursive: true });
// npm pack rather than a CDN fetch: wherever `npm install` works, this works.
execFileSync('npm', ['pack', `three@${version}`, '--silent', '--pack-destination', tmp], { stdio: ['ignore', 'ignore', 'inherit'] });
execFileSync('tar', ['-xzf', join(tmp, `three-${version}.tgz`), '-C', tmp, ...FILES.map((f) => `package/build/${f}`)]);
for (const f of FILES) await copyFile(join(tmp, 'package/build', f), dest(f));
await rm(tmp, { recursive: true, force: true });
console.log(`fetch-engine: cached three ${version} → ` + FILES.map((f) => dest(f).slice(ROOT.length + 1)).join(', '));
