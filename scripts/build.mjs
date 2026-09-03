#!/usr/bin/env node
/* Assemble src/shell.html + src/game.mjs into the shipped single-file build.
 *
 * The game ships as one self-contained .html — that is the whole point of it:
 * no bundler, no install, double-click and play. But 6,600 lines of JavaScript
 * inside an .html file is miserable to edit, so development happens in split
 * sources and this script substitutes one into the other.
 *
 *   node scripts/build.mjs            write index.html
 *   node scripts/build.mjs --check    verify index.html matches the sources
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = '/*__GAME__*/\n';
const OUT = join(ROOT, 'index.html');
const CHECK = process.argv.includes('--check');

const shell = await readFile(join(ROOT, 'src/shell.html'), 'utf8');
const game = await readFile(join(ROOT, 'src/game.mjs'), 'utf8');

// A silent no-op replace ships dead code. Assert the anchor, then assert the insert.
const hits = shell.split(MARKER).length - 1;
if (hits !== 1) {
  console.error(`build: expected exactly one ${MARKER.trim()} marker in src/shell.html, found ${hits}`);
  process.exit(1);
}
const built = shell.replace(MARKER, game);
if (!built.includes(game.slice(0, 200))) {
  console.error('build: substitution did not land');
  process.exit(1);
}

// Every DOM id the game reaches for with $() must exist in the shell.
const wanted = new Set([...game.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
const present = new Set([...shell.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const missing = [...wanted].filter((id) => !present.has(id));
if (missing.length) {
  console.error('build: game references DOM ids that the shell does not define: ' + missing.join(', '));
  process.exit(1);
}

// All three CDN mirrors must survive an edit, or a single outage takes the game down.
for (const host of ['esm.sh', 'cdn.jsdelivr.net', 'unpkg.com']) {
  if (!game.includes(host)) {
    console.error(`build: CDN mirror ${host} is missing from the loader`);
    process.exit(1);
  }
}

if (CHECK) {
  const current = await readFile(OUT, 'utf8').catch(() => null);
  if (current === built) {
    console.log('build: index.html is in sync with src/ (' + built.length.toLocaleString() + ' bytes)');
    process.exit(0);
  }
  console.error('build: index.html is STALE — run `npm run build` and commit the result');
  process.exit(1);
}

await writeFile(OUT, built);
console.log(
  `build: index.html written — ${built.length.toLocaleString()} bytes, ` +
  `${built.split('\n').length.toLocaleString()} lines, ${wanted.size} DOM ids checked`
);
