// Design iteration helper: renders the workbench with simulated Chrome APIs
// (tests/preview/mock-chrome.js) and writes screenshots to .scratch/preview.
// This is a visual simulation, not extension acceptance evidence.
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(process.env.LINK_METEOR_PLAYWRIGHT || resolve(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const root = resolve(import.meta.dirname, '..');
const out = resolve(root, '.scratch/preview');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    if (path === '/ui/preview.html') {
      const html = (await readFile(resolve(root, 'src/ui/workbench.html'), 'utf8')).replace('<script type="module" src="workbench.js"></script>', '<script type="module" src="/preview/mock-chrome.js"></script><script type="module" src="workbench.js"></script>');
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return;
    }
    const file = path.startsWith('/preview/') ? resolve(root, 'tests', path.slice(1)) : resolve(root, 'src', path.slice(1));
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}/ui/preview.html`;

const shots = JSON.parse(process.argv[2] || '[]');
const defaults = [
  { name: 'panel-light', width: 380, height: 900, scenario: 'research' },
  { name: 'panel-dark', width: 380, height: 900, scenario: 'research', scheme: 'dark' },
  { name: 'wide-light', width: 1440, height: 960, scenario: 'research', tab: true },
  { name: 'wide-dark', width: 1440, height: 960, scenario: 'research', tab: true, scheme: 'dark' },
];
await mkdir(out, { recursive: true });
const browser = await playwright.chromium.launch();
const errors = [];
try {
  for (const shot of shots.length ? shots : defaults) {
    const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height }, colorScheme: shot.scheme || 'light', reducedMotion: 'reduce', deviceScaleFactor: shot.scale || 1 });
    page.on('pageerror', (error) => errors.push(`${shot.name}: ${error.message}`));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(`${shot.name}: ${message.text()}`); });
    await page.goto(`${base}?scenario=${shot.scenario || 'research'}${shot.tab ? '&tab=1' : ''}${shot.shortcut !== undefined ? `&shortcut=${encodeURIComponent(shot.shortcut)}` : ''}`);
    await page.locator('#collection-heading').waitFor();
    await page.waitForTimeout(150);
    for (const step of shot.steps || []) {
      if (step.click) await page.locator(step.click).first().click();
      if (step.check) await page.locator(step.check).first().check();
      if (step.select) await page.locator(step.select[0]).selectOption(step.select[1]);
      if (step.fill) await page.locator(step.fill[0]).fill(step.fill[1]);
      if (step.press) await page.keyboard.press(step.press);
      if (step.eval) await page.evaluate(step.eval);
      await page.waitForTimeout(step.wait || 120);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) errors.push(`${shot.name}: horizontal overflow`);
    await page.screenshot({ path: resolve(out, `${shot.name}.png`), fullPage: !!shot.full });
    await page.close();
  }
} finally { await browser.close(); server.close(); }
console.log(JSON.stringify({ out, errors }, null, 2));
