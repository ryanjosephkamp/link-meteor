// Design iteration helper: injects the real content script into the local fixture
// with simulated extension messaging, drives a mouse drag and saves screenshots.
// A visual simulation only; tests/browser.mjs exercises the loaded extension.
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(process.env.LINK_METEOR_PLAYWRIGHT || resolve(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const root = resolve(import.meta.dirname, '..');
const out = resolve(root, '.scratch/preview');
await mkdir(out, { recursive: true });
const server = createServer(async (req, res) => {
  const name = new URL(req.url, 'http://x').pathname === '/frame.html' ? 'frame.html' : 'index.html';
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(await readFile(resolve(root, 'tests/fixtures', name)));
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const script = await readFile(resolve(root, 'src/content/capture.js'), 'utf8');
const mock = `globalThis.chrome={runtime:{onMessage:{addListener(){}},sendMessage:async(m)=>({ok:true,data:m.type==='collection.active'?{name:'Thesis sources',count:18}:m.type==='settings.get'?{holdKey:'z',holdOrigins:[]}:m.type==='capture.copy'?{text:'x'}:{count:(m.links||[]).length,warning:''}})},storage:{onChanged:{addListener(){}}}};`;
const browser = await playwright.chromium.launch();
try {
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, colorScheme: scheme });
    await page.goto(`${base}/index.html`);
    if (scheme === 'dark') await page.addStyleTag({ content: 'body{background:#15171c!important;color:#e7e9ee!important}section{background:#1e2128!important;border-color:#343844!important}a{color:#8fd3c1!important}h1,h2{color:#f1f3f6!important}' });
    await page.evaluate(`${mock}\n${script}`);
    await page.evaluate(() => globalThis.__linkMeteor.arm());
    await page.screenshot({ path: resolve(out, `overlay-armed-${scheme}.png`) });
    const box = await page.locator('#bibliography').boundingBox();
    await page.mouse.move(box.x + 4, box.y + 4); await page.mouse.down();
    await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4, { steps: 10 });
    await page.screenshot({ path: resolve(out, `overlay-drag-${scheme}.png`) });
    await page.mouse.up();
    await page.waitForTimeout(250);
    await page.screenshot({ path: resolve(out, `overlay-bar-${scheme}.png`) });
    await page.locator('#link-meteor-overlay').getByRole('button', { name: 'Add to collection', exact: true }).click();
    await page.waitForTimeout(150);
    await page.locator('#link-meteor-overlay').locator('.bar').screenshot({ path: resolve(out, `overlay-added-${scheme}.png`) });
    await page.close();
  }
} finally { await browser.close(); server.close(); }
console.log('saved overlay previews to', out);
