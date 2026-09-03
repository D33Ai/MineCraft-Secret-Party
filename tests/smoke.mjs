#!/usr/bin/env node
/* Headless gate battery for the shipped build.
 *
 *   node tests/smoke.mjs                 desktop 1280x720 and mobile 390x844
 *   node tests/smoke.mjs --desktop       one viewport only
 *   node tests/smoke.mjs --mobile
 *   node tests/smoke.mjs --headed        watch it run
 *
 * The world has too many interacting systems to verify by looking at it, so
 * this asserts against the world's own state through the window.ATOLL hook
 * rather than eyeballing a screenshot. Frame rate here is meaningless — it is
 * a CPU software rasterizer — so nothing below asserts on FPS.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HASH = (process.argv.find((a) => a.startsWith('--hash=')) || '--hash=#q=low').slice(7);
const HEADED = process.argv.includes('--headed');
/* The game pulls three.js from a CDN by design (three mirrors, self-healing).
   Offline mode serves the cached copy from .cache/ instead, for CI without
   egress or a browser behind a proxy that cannot reach the mirrors.
   `node scripts/fetch-engine.mjs` populates the cache. */
const OFFLINE = process.argv.includes('--offline');
const ONLY = process.argv.includes('--mobile') ? ['mobile']
  : process.argv.includes('--desktop') ? ['desktop']
  : ['desktop', 'mobile'];

const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split('?')[0].split('#')[0]));
  const file = join(ROOT, rel === '/' ? '/index.html' : rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('no'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

/* Online mode needs egress for the CDN; honour a proxy when one is configured. */
const proxyUrl = OFFLINE ? null
  : (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy);

const engine = {};
if (OFFLINE) {
  const version = (await readFile(join(ROOT, 'src/game.mjs'), 'utf8')).match(/three@(\d+\.\d+\.\d+)/)?.[1];
  for (const f of ['module.js', 'core.js']) {
    engine[f] = await readFile(join(ROOT, '.cache', `three-${version}.${f}`), 'utf8').catch(() => null);
  }
  if (!engine['module.js'] || !engine['core.js']) {
    console.error(`smoke: offline mode needs .cache/three-${version}.{module,core}.js — run \`npm run fetch-engine\` first`);
    process.exit(2);
  }
  console.log(`smoke: offline — serving cached three ${version} in place of the CDN`);
}
const browser = await chromium.launch({
  headless: !HEADED,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
  // The local test server must never go through a proxy, or every request 405s.
  ...(proxyUrl ? { proxy: { server: proxyUrl, bypass: '127.0.0.1,localhost' } } : {})
});

const VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 720 } },
  mobile: {
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  }
};

/* Block ids that the player can stand inside, read straight out of the block
   table in src/game.mjs, so the collision check below tracks the real game. */
const gameSrc = await readFile(join(ROOT, 'src/game.mjs'), 'utf8');
const idOf = Object.fromEntries(
  [...gameSrc.slice(gameSrc.indexOf('const AIR = 0'), gameSrc.indexOf('// atlas tile indices'))
    .matchAll(/\b([A-Z][A-Z_0-9]*)\s*=\s*(\d+)/g)].map((m) => [m[1], Number(m[2])])
);
const PASSABLE = [...gameSrc.matchAll(/def\((\w+),\s*\{([^}]*)\}/g)]
  .filter((m) => /solid:\s*false/.test(m[2]))
  .map((m) => idOf[m[1]])
  .filter((id) => id !== undefined);
if (PASSABLE.length < 4) { console.error('smoke: could not read the block table from src/game.mjs'); process.exit(2); }

const results = [];

for (const name of ONLY) {
  const checks = [];
  const ok = (label, pass, detail = '') => { checks.push({ label, pass, detail }); };

  const context = await browser.newContext({ ...VIEWPORTS[name], ignoreHTTPSErrors: !!proxyUrl });
  const page = await context.newPage();
  const errors = [];
  if (OFFLINE) {
    // three.module.js re-exports ./three.core.js, so serve each by name.
    await page.route(/(esm\.sh|cdn\.jsdelivr\.net|unpkg\.com)/, (route) =>
      route.fulfill({
        status: 200, contentType: 'text/javascript',
        body: /three\.core\.js/.test(route.request().url()) ? engine['core.js'] : engine['module.js']
      }));
  }
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/favicon|404 \(Not Found\)/.test(t)) errors.push(t);
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', (r) => { if (!/favicon/.test(r.url())) errors.push('REQFAIL: ' + r.url() + ' ' + (r.failure()?.errorText || '')); });

  console.log(`\n=== ${name.toUpperCase()} ${VIEWPORTS[name].viewport.width}x${VIEWPORTS[name].viewport.height} ===`);
  await page.goto(BASE + HASH, { waitUntil: 'load', timeout: 60_000 });

  // 1. boot, and no fault card
  const booted = await page.waitForFunction('window.__atollBooted === true', null, { timeout: 180_000 })
    .then(() => true).catch(() => false);
  const fault = await page.evaluate(() => {
    const el = document.getElementById('fault');
    return getComputedStyle(el).display === 'none' ? null : document.getElementById('faultBody').textContent;
  });
  ok('boots', booted);
  ok('no fault card', !fault, fault ? fault.slice(0, 160) : '');
  if (!booted) { results.push({ name, checks, errors }); await context.close(); continue; }

  // 2. the world actually generated
  const world = await page.evaluate(() => ({
    version: window.ATOLL.version, chunks: window.ATOLL.chunkCount,
    crowd: window.ATOLL.crowd, residents: window.ATOLL.residents,
    rave: !!window.ATOLL.rave, city: !!window.ATOLL.city,
    aerie: !!window.ATOLL.aerie, portal: !!window.ATOLL.portal
  }));
  ok('chunks streamed', world.chunks > 20, `${world.chunks} chunks`);
  ok('set pieces built', world.rave && world.city && world.aerie && world.portal,
    `rave=${world.rave} city=${world.city} aerie=${world.aerie} portal=${world.portal}`);
  ok('crowd instanced', world.crowd > 0, `${world.crowd} groups, ${world.residents} residents`);

  // 3. drive it: enter, walk, look, break, place, fly, hotbar, night
  await page.evaluate(() => document.getElementById('btnPlay').click());
  await page.waitForTimeout(1200);
  const before = await page.evaluate(() => { const p = window.ATOLL.player.pos; return { x: p.x, y: p.y, z: p.z }; });
  await page.evaluate(() => {
    const k = (code, type) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    window.__k = k;
    k('KeyW', 'keydown'); k('ShiftLeft', 'keydown');
  });
  for (let i = 0; i < 25; i++) {
    await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { movementX: 9, movementY: 0 })));
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(2000);
  await page.evaluate(() => { window.__k('KeyW', 'keyup'); window.__k('ShiftLeft', 'keyup'); });
  const after = await page.evaluate(() => { const p = window.ATOLL.player.pos; return { x: p.x, y: p.y, z: p.z }; });
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  /* Distance is not a stable quantity here: dt is clamped, and a CPU software
     rasterizer under variable load turns "blocks per second" into noise. So
     assert only that the simulation advanced the player, and report the number.
     The deterministic assertion is the containment check below. */
  ok('player simulation advances', moved > 0.05, moved.toFixed(2) + ' blocks walked');

  /* Collision containment: no part of the player's AABB may sit inside a solid
     block. The passable ids are derived from the block table in src/game.mjs so
     this check cannot drift when blocks are added. */
  const clipping = await page.evaluate((passable) => {
    const p = window.ATOLL.player, w = window.ATOLL.world, hw = p.W / 2 - 0.001;
    const inside = [];
    for (const dx of [-hw, hw]) for (const dz of [-hw, hw]) for (const dy of [0.05, p.H / 2, p.H - 0.05]) {
      const bx = Math.floor(p.pos.x + dx), by = Math.floor(p.pos.y + dy), bz = Math.floor(p.pos.z + dz);
      const id = w.get(bx, by, bz);
      if (!passable.includes(id)) inside.push({ id, x: bx, y: by, z: bz });
    }
    return { count: inside.length, sample: inside[0] || null };
  }, PASSABLE);
  ok('player is not inside a block', clipping.count === 0,
    clipping.count ? `${clipping.count} of 12 samples clipping, e.g. ${JSON.stringify(clipping.sample)}` : 'clear');

  // 4. drive the rest of the input surface: break, place, flight, hotbar, day cycle
  await page.evaluate(() => {
    const c = document.getElementById('c');
    c.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));   // break
    c.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));   // place
    window.__k('KeyF', 'keydown'); window.__k('KeyF', 'keyup');                   // flight
    window.__k('Digit5', 'keydown'); window.__k('Digit5', 'keyup');               // hotbar slot
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 }));               // scroll the hotbar
    const t = document.getElementById('tod');
    t.value = 880; t.dispatchEvent(new Event('input', { bubbles: true }));        // push it to night
  });
  await page.waitForTimeout(1200);
  const hotbar = await page.evaluate(() => ({
    slots: document.querySelectorAll('#hotbar .slot').length,
    selected: document.getElementById('blockName').textContent
  }));
  ok('hotbar renders', hotbar.slots === 10, `${hotbar.slots} slots, selected "${hotbar.selected}"`);

  // Edits survive a chunk round-trip — the persistence path that makes builds stick.
  const persisted = await page.evaluate(() => {
    const p = window.ATOLL.player.pos;
    const x = Math.floor(p.x), z = Math.floor(p.z);
    const y = window.ATOLL.surfaceAt(x, z) + 1;
    const PLANK = 13;
    window.ATOLL.world.set(x, y, z, PLANK);
    const cx = x >> 4, cz = z >> 4;
    window.ATOLL.world.chunks.delete(window.ATOLL.world.key(cx, cz));
    window.ATOLL.world.ensure(cx, cz);
    return window.ATOLL.world.get(x, y, z) === PLANK;
  });
  ok('edits persist across chunk reload', persisted);

  // 5. teleports to each landmark leave the player inside the world, not in a wall
  const travel = await page.evaluate(async () => {
    const out = {};
    for (const [k, fn] of [['rave', 'gotoRave'], ['city', 'gotoCity'], ['aerie', 'gotoAerie'], ['overlook', 'gotoOverlook']]) {
      window.ATOLL[fn]();
      await new Promise((r) => requestAnimationFrame(r));
      const p = window.ATOLL.player.pos;
      out[k] = Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) && p.y > 0;
    }
    return out;
  });
  ok('landmark travel', Object.values(travel).every(Boolean), JSON.stringify(travel));

  // 6. reseed rebuilds the world (catches queue starvation)
  await page.evaluate(() => document.getElementById('btnNew').click());
  await page.waitForTimeout(4000);
  const reseeded = await page.evaluate(() => window.ATOLL.chunkCount);
  ok('reseed rebuilds chunks', reseeded > 20, `${reseeded} chunks`);

  // 7. no HUD element off-screen or overlapping another at this viewport
  const ui = await page.evaluate(() => {
    const box = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { id, ...b.toJSON() }; };
    const hit = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    const stats = box('stats'), hotbar = box('hotbar'), blockName = box('blockName');
    const touchOn = getComputedStyle(document.getElementById('touch')).display !== 'none';
    let touchClash = false;
    if (touchOn) for (const id of ['bJump', 'bFly', 'bMine', 'bPlace', 'stick']) touchClash ||= hit(box(id), hotbar);
    const offscreen = [stats, hotbar, blockName]
      .filter((b) => b.left < -1 || b.top < -1 || b.right > innerWidth + 1 || b.bottom > innerHeight + 1)
      .map((b) => b.id);
    return { statsVsHotbar: hit(stats, hotbar), touchClash, touchOn, offscreen };
  });
  ok('HUD fits the viewport', ui.offscreen.length === 0, ui.offscreen.join(', '));
  ok('HUD does not overlap itself', !ui.statsVsHotbar && !ui.touchClash, JSON.stringify(ui));
  ok('touch controls match the device', ui.touchOn === (name === 'mobile'), `touch UI ${ui.touchOn ? 'on' : 'off'}`);

  // 8. the assertion that finds the most bugs
  ok('zero console + page errors', errors.length === 0, errors.slice(0, 6).join(' | ').slice(0, 400));

  for (const c of checks) console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.label}${c.detail ? '  ·  ' + c.detail : ''}`);
  results.push({ name, checks, errors });
  await context.close();
}

await browser.close();
server.close();

const failed = results.flatMap((r) => r.checks.filter((c) => !c.pass).map((c) => `${r.name}: ${c.label}`));
const total = results.reduce((n, r) => n + r.checks.length, 0);
console.log(`\n${total - failed.length}/${total} checks passed`);
if (failed.length) { failed.forEach((f) => console.log('  FAIL  ' + f)); process.exit(1); }
