#!/usr/bin/env node
/* Development server: assembles src/ on every request, so a browser refresh is
 * the whole edit loop. Nothing is written to disk — run `npm run build` when
 * you are ready to commit the shipped index.html.
 *
 *   npm run dev            http://127.0.0.1:8080
 *   npm run dev -- 3000    another port
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const MARKER = '/*__GAME__*/\n';
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

async function assemble() {
  const [shell, game] = await Promise.all([
    readFile(join(ROOT, 'src/shell.html'), 'utf8'),
    readFile(join(ROOT, 'src/game.mjs'), 'utf8')
  ]);
  if (!shell.includes(MARKER)) throw new Error('src/shell.html has lost its /*__GAME__*/ marker');
  return shell.replace(MARKER, game);
}

createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split('?')[0].split('#')[0]));
  try {
    if (rel === '/' || rel === '/index.html') {
      const html = await assemble();
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }
    const file = join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (e) {
    const fatal = e.code !== 'ENOENT';
    res.writeHead(fatal ? 500 : 404, { 'Content-Type': 'text/plain' });
    res.end(fatal ? String(e.message) : 'not found');
    if (fatal) console.error('serve:', e.message);
  }
}).listen(PORT, () => {
  console.log(`ATOLL dev server  →  http://127.0.0.1:${PORT}/`);
  console.log('serving src/shell.html + src/game.mjs assembled on the fly; refresh to pick up edits');
});
