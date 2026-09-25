// Renders site/assets/img/social-card.png (1200x630) from brand type and colors.
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(process.env.LINK_METEOR_PLAYWRIGHT || resolve(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const root = resolve(import.meta.dirname, '..');
const data = async (file) => `data:font/woff2;base64,${(await readFile(resolve(root, 'site/assets/fonts', file))).toString('base64')}`;
const font = await data('atkinson-hyperlegible-next.woff2');
const mono = await data('atkinson-hyperlegible-mono.woff2');
const html = `<!doctype html><html><head><style>
@font-face{font-family:A;src:url(${font}) format("woff2");font-weight:200 800}
@font-face{font-family:M;src:url(${mono}) format("woff2");font-weight:200 800}
html,body{margin:0;width:1200px;height:630px;overflow:hidden}
body{background:#0e1526;color:#f1f3f7;font-family:A;position:relative}
.glow{position:absolute;right:-160px;top:-220px;width:760px;height:760px;background:radial-gradient(closest-side,rgba(195,243,68,.16),transparent 70%)}
.wrap{position:absolute;inset:72px 80px}
.brand{display:flex;align-items:center;gap:16px;font-weight:750;font-size:34px}
h1{margin:70px 0 0;font-size:96px;line-height:.98;letter-spacing:-.035em;font-weight:800}
h1 span{display:block;color:#c3f344}
p{position:absolute;bottom:0;left:0;margin:0;color:#b9c0cd;font-size:28px}
.fields{position:absolute;right:0;top:0;display:grid;grid-template-columns:auto auto;gap:4px 18px;font-family:M;font-size:19px;line-height:1.5;color:#dfe3ea;padding:18px 22px;border:1px solid #2b3550;border-radius:16px;background:#151d31}
.fields b{color:#c3f344;font-weight:600}
</style></head><body><div class="glow"></div><div class="wrap">
<div class="brand"><svg width="52" height="52" viewBox="0 0 24 24"><defs><linearGradient id="t" x1="15.7" y1="8.3" x2="4" y2="20" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#c3f344"/><stop offset="1" stop-color="#c3f344" stop-opacity=".2"/></linearGradient></defs><rect width="24" height="24" rx="6.5" fill="#1b2336"/><g transform="translate(12 12) scale(.78) translate(-12 -12)"><path d="M13.2 4.6 19.4 10.8 4.6 20.4Q3.6 19.4 4.6 18.4Z" fill="url(#t)"/><circle cx="16.3" cy="7.7" r="4.4" fill="#c3f344"/></g></svg>Link Meteor</div>
<h1>Capture the trail.<span>Keep the source.</span></h1>
<p>A free, private Chrome extension for collecting links.</p>
<div class="fields"><b>Anchor text</b><span>Download PDF</span><b>URL</b><span>…/uhi-2024-0142.pdf</span><b>Source</b><span>Reading list</span></div>
</div></body></html>`;
const browser = await playwright.chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(html); await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(root, 'site/assets/img/social-card.png') });
} finally { await browser.close(); }
console.log('Rendered site/assets/img/social-card.png');
