// Renders assets/brand SVG masters into the packaged PNG icons.
// Uses an already installed Playwright + Chromium; nothing is downloaded.
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(process.env.LINK_METEOR_PLAYWRIGHT || resolve(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }

const jobs = [[16, 'icon-16.svg'], [32, 'icon.svg'], [48, 'icon.svg'], [128, 'icon-128.svg']];
const browser = await playwright.chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [size, file] of jobs) {
    const svg = await readFile(resolve(root, 'assets/brand', file), 'utf8');
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}img{display:block}</style><img width="${size}" height="${size}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`);
    await page.locator('img').evaluate(img => img.decode());
    await writeFile(resolve(root, 'src/icons', `${size}.png`), await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
  }
} finally { await browser.close(); }
console.log(`Rendered ${jobs.length} icons into src/icons.`);
