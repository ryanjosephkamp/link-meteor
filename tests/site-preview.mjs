// Serves site/ on 127.0.0.1 and screenshots pages at several widths into .scratch/site-preview.
// Also fails on console errors, failed requests, horizontal overflow and off-site requests.
// `node tests/site-preview.mjs --serve [port]` only serves the site for browsing (default port 8123).
import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, resolve, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(process.env.LINK_METEOR_PLAYWRIGHT || resolve(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const root = resolve(import.meta.dirname, '../site');
const out = resolve(import.meta.dirname, '../.scratch/site-preview');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json', '.zip': 'application/zip', '.txt': 'text/plain', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.vtt': 'text/vtt; charset=utf-8', '.xml': 'application/xml' };
export async function serve(port = 0) {
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/link-meteor') path = '/link-meteor/';
    if (path.startsWith('/link-meteor/')) path = path.slice('/link-meteor'.length); // GitHub Pages project path
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(resolve(root, '.' + path));
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    try {
      if ((await stat(file)).isFile()) {
        const body = await readFile(file), type = types[extname(file)] || 'application/octet-stream';
        // Byte ranges let the video player seek, as GitHub Pages allows.
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
        if (range && (range[1] || range[2])) {
          const start = range[1] ? Number(range[1]) : Math.max(0, body.length - Number(range[2])), end = range[1] && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
          if (start >= body.length || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${body.length}` }); res.end(); return; }
          res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': end - start + 1 }); res.end(body.subarray(start, end + 1)); return;
        }
        res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': body.length }); res.end(body); return;
      }
    } catch { /* 404 */ }
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(await readFile(resolve(root, '404.html')).catch(() => 'Not found'));
  });
  await new Promise((done) => server.listen(port, '127.0.0.1', done));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === '--serve') {
  const { base } = await serve(Number(process.argv[3] || 8123));
  console.log(`Serving site/ at ${base}/ (also ${base}/link-meteor/). Press Control-C to stop.`);
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const shots = JSON.parse(process.argv[2] || '[{"path":"/","name":"home-1440","width":1440,"height":1000,"full":true},{"path":"/","name":"home-390","width":390,"height":844,"full":true}]');
  await mkdir(out, { recursive: true });
  const { server, base } = await serve();
  const browser = await playwright.chromium.launch();
  const problems = [];
  try {
    for (const shot of shots) {
      const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height }, colorScheme: shot.scheme || 'light', reducedMotion: shot.motion || 'reduce' });
      page.on('console', (m) => { if (m.type() === 'error') problems.push(`${shot.name}: console ${m.text()}`); });
      page.on('pageerror', (e) => problems.push(`${shot.name}: ${e.message}`));
      page.on('requestfailed', (r) => problems.push(`${shot.name}: failed ${r.url()}`));
      page.on('request', (r) => { if (!r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) problems.push(`${shot.name}: off-site request ${r.url()}`); });
      page.on('response', (r) => { if (r.status() >= 400) problems.push(`${shot.name}: ${r.status()} ${r.url()}`); });
      await page.goto(base + shot.path, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      for (const step of shot.steps || []) { if (step.click) await page.locator(step.click).first().click(); if (step.eval) await page.evaluate(step.eval); await page.waitForTimeout(step.wait || 200); }
      await page.waitForTimeout(shot.wait || 400);
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) problems.push(`${shot.name}: horizontal overflow`);
      await page.screenshot({ path: resolve(out, `${shot.name}.png`), fullPage: !!shot.full });
      await page.close();
    }
  } finally { await browser.close(); server.close(); }
  console.log(JSON.stringify({ out, problems }, null, 2));
}
