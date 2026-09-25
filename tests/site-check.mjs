// Automated site QA, served under /link-meteor/ like a GitHub Pages project site.
// Checks every page at several widths in light and dark, structure and names, internal links
// and anchors, measured text contrast, keyboard menu, demo and export preview. Writes
// artifacts/evidence/site-results.json and a few screenshots. Not a screen-reader audit.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { serve } from './site-preview.mjs';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(process.env.LINK_METEOR_PLAYWRIGHT || resolve(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const evidence = resolve(import.meta.dirname, '..', process.env.LINK_METEOR_EVIDENCE_DIR || 'artifacts/evidence');
const pages = ['index.html', 'install.html', 'guide.html', 'privacy.html', 'practice.html'];
const widths = [320, 390, 768, 1024, 1440];
const result = { started: new Date().toISOString(), base: '/link-meteor/', pages: {}, checks: [], limits: ['Automated Chromium checks; not a screen-reader, real-device or cross-browser audit.', 'Contrast is measured against the nearest solid background and skips text over images.'] };
const { server, base: origin } = await serve();
const base = `${origin}/link-meteor/`;
const browser = await playwright.chromium.launch();
const problems = [];
function watch(page, label) {
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 404/.test(m.text())) problems.push(`${label}: console ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${label}: ${e.message}`));
  page.on('requestfailed', (r) => { if (!r.url().startsWith('blob:')) problems.push(`${label}: failed ${r.url()}`); });
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) problems.push(`${label}: off-site request ${u}`); });
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/definitely-missing')) problems.push(`${label}: HTTP ${r.status()} ${r.url()}`); });
}
const contrast = (page) => page.evaluate(() => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
  const lum = (c) => c.slice(0, 3).map((n) => { n /= 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; }).reduce((s, n, i) => s + n * [0.2126, 0.7152, 0.0722][i], 0);
  const solid = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); return ctx.getImageData(0, 0, 1, 1).data[3] === 255; };
  const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const s = getComputedStyle(n); if (s.backgroundImage !== 'none' && !n.matches('body,html,mark,.mark')) return null; if (solid(s.backgroundColor)) return s.backgroundColor; } return getComputedStyle(document.body).backgroundColor; };
  const out = []; let min = 99;
  for (const el of document.querySelectorAll('h1,h2,h3,p,li,a,dt,dd,th,td,button,figcaption,label,small,span,strong,code,kbd')) {
    if (!el.getClientRects().length || !el.textContent.trim() || el.closest('[aria-hidden="true"],.demo-layer,svg')) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(el); if (s.visibility === 'hidden' || Number(s.opacity) < 1) continue;
    const bg = bgOf(el); if (!bg) continue;
    const a = lum(rgba(s.color)), b = lum(rgba(bg)); const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const size = parseFloat(s.fontSize), bold = Number(s.fontWeight) >= 700; const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    min = Math.min(min, ratio);
    if (ratio + 0.01 < need && !el.closest('button:disabled')) out.push({ text: el.textContent.trim().slice(0, 60), ratio: Math.round(ratio * 100) / 100, need, color: s.color, bg });
  }
  return { min: Math.round(min * 100) / 100, failures: out.slice(0, 12) };
});
try {
  for (const name of pages) {
    const report = { layouts: [], links: 0, anchors: 0 };
    for (const scheme of ['light', 'dark']) for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: 'reduce' });
      watch(page, `${name} ${width} ${scheme}`);
      await page.goto(base + name, { waitUntil: 'networkidle' }); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(150);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (overflow) problems.push(`${name} ${width} ${scheme}: horizontal overflow`);
      const c = await contrast(page);
      for (const f of c.failures) problems.push(`${name} ${width} ${scheme}: contrast ${f.ratio} < ${f.need} for “${f.text}”`);
      report.layouts.push({ width, scheme, overflow, minContrast: c.min });
      if (width === 1440 && scheme === 'light') {
        const structure = await page.evaluate(() => {
          const heads = [...document.querySelectorAll('h1,h2,h3,h4')].filter((h) => !h.closest('[aria-hidden="true"]')).map((h) => Number(h.tagName[1]));
          let jump = false; for (let i = 1; i < heads.length; i++) if (heads[i] - heads[i - 1] > 1) jump = true;
          const unnamed = [...document.querySelectorAll('a,button,input,select,textarea')].filter((e) => e.getClientRects().length && !(e.getAttribute('aria-label') || e.textContent.trim() || e.labels?.length || e.getAttribute('title') || [...e.querySelectorAll('img[alt]')].some((i) => i.alt.trim()) || e.querySelector('[role=img][aria-label]'))).map((e) => e.outerHTML.slice(0, 80));
          return { lang: document.documentElement.lang, title: document.title, h1: document.querySelectorAll('h1').length, main: !!document.querySelector('main#main'), skip: !!document.querySelector('a.skip[href="#main"]'), imagesWithoutAlt: [...document.images].filter((i) => !i.hasAttribute('alt')).length, jump, unnamed, hrefs: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')) };
        });
        assert.equal(structure.lang, 'en'); assert.ok(structure.title); assert.equal(structure.h1, 1, `${name} h1 count`); assert.ok(structure.main && structure.skip, `${name} landmarks`);
        assert.equal(structure.imagesWithoutAlt, 0, `${name} images without alt`); assert.equal(structure.jump, false, `${name} heading levels skip`); assert.deepEqual(structure.unnamed, [], `${name} unnamed controls`);
        for (const href of new Set(structure.hrefs)) {
          if (/^(https?:|mailto:|tel:|javascript:)/.test(href)) continue;
          const url = new URL(href, base + name);
          if (url.origin !== origin) continue;
          const response = await page.request.get(url.href.split('#')[0]);
          if (response.status() !== 200) problems.push(`${name}: link ${href} → ${response.status()}`);
          report.links++;
          if (url.hash && url.hash.length > 1) {
            const target = url.pathname === new URL(base + name).pathname ? page : await browser.newPage();
            if (target !== page) await target.goto(url.href.split('#')[0]);
            const exists = await target.evaluate((id) => !!document.getElementById(id), decodeURIComponent(url.hash.slice(1)));
            if (!exists && !href.startsWith('#cited-')) problems.push(`${name}: anchor ${href} missing`);
            if (target !== page) await target.close();
            report.anchors++;
          }
        }
        report.structure = { h1: structure.h1, headingLevelsSkip: structure.jump, imagesWithoutAlt: structure.imagesWithoutAlt, unnamedControls: structure.unnamed.length };
      }
      await page.close();
    }
    result.pages[name] = report;
    console.log('checked', name);
  }
  // 404 page served for a missing path at depth.
  { const page = await browser.newPage(); watch(page, '404'); const response = await page.goto(base + 'nested/definitely-missing'); assert.equal(response.status(), 404); await page.waitForLoadState('networkidle'); assert.match(await page.locator('h1').innerText(), /isn't here/); result.checks.push('404 page renders with its styles for a missing nested path'); await page.close(); }
  // Keyboard: mobile menu.
  { const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); watch(page, 'menu'); await page.goto(base); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'menu-toggle'); await page.keyboard.press('Enter'); assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'true');
    assert.ok(await page.locator('#site-nav a[href="install.html"]').isVisible()); await page.keyboard.press('Escape'); assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'false');
    result.checks.push('Mobile menu opens from the keyboard and closes with Escape'); await page.close(); }
  // Demo drag, select all, export preview and XLSX download.
  { const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }); watch(page, 'demo'); await page.goto(base); await page.locator('#demo-count').filter({ hasText: /selected/ }).waitFor({ timeout: 8000 });
    const first = await page.locator('#demo-list a').nth(0).boundingBox(), second = await page.locator('#demo-list a').nth(1).boundingBox();
    await page.mouse.move(first.x - 10, first.y - 4); await page.mouse.down(); await page.mouse.move(second.x + second.width + 6, second.y + second.height + 2, { steps: 8 }); await page.mouse.up();
    assert.equal(await page.locator('#demo-count').innerText(), '2 links selected');
    await page.locator('#demo-all').click(); assert.equal(await page.locator('#demo-count').innerText(), '6 links selected');
    assert.equal(await page.locator('#demo-table tbody tr').count(), 6);
    // Read the six source anchors; the compact result table intentionally truncates after five.
    const expectedPairs = await page.locator('#demo-list a').evaluateAll(anchors => anchors.map(anchor => [anchor.innerText.trim(), anchor.href]));
    await writeFile(resolve(evidence, 'site-preview.expected.json'), JSON.stringify(expectedPairs, null, 2) + '\n');
    await page.locator('[role=tab][data-format=csv]').click(); const csv = await page.locator('#exporter-output pre').innerText();
    assert.ok(csv.startsWith('Anchor text,URL')); assert.ok(csv.includes(',https://journal.example.org/figures/canopy-map'), 'empty anchor stays empty in CSV');
    await page.locator('[role=tab][data-format=markdown]').click(); assert.ok((await page.locator('#exporter-output pre').innerText()).includes('[](https://journal.example.org/figures/canopy-map)'));
    await page.locator('[role=tab][data-format=xlsx]').click();
    assert.deepEqual(await page.locator('#exporter-output th[scope=col]').allTextContents(), ['Anchor text', 'URL']);
    const pending = page.waitForEvent('download'); await page.locator('#exporter-download').click(); const download = await pending;
    await download.saveAs(resolve(evidence, 'site-preview.xlsx'));
    const bytes = await (await import('node:fs/promises')).readFile(await download.path()); assert.equal(bytes.subarray(0, 2).toString(), 'PK');
    await page.locator('[role=tab][data-format=csv]').focus(); await page.keyboard.press('ArrowRight'); assert.equal(await page.evaluate(() => document.activeElement.dataset.format), 'markdown');
    result.checks.push('Demo drag selects exactly the swept links; Select all selects 6; export preview uses real CSV/Markdown/XLSX output; tabs work with arrow keys');
    await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: resolve(evidence, 'site-home.png') }); await page.close(); }
  for (const [name, width, scheme, path] of [['site-home-mobile.png', 390, 'light', ''], ['site-home-dark.png', 1440, 'dark', ''], ['site-install.png', 1440, 'light', 'install.html'], ['site-practice-page.png', 1440, 'light', 'practice.html']]) {
    const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 1000 }, colorScheme: scheme, reducedMotion: 'reduce' }); await page.goto(base + path, { waitUntil: 'networkidle' }); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(1200); await page.screenshot({ path: resolve(evidence, name) }); await page.close();
  }
  result.problems = problems;
  result.result = problems.length ? 'FAIL' : 'PASS';
} catch (error) { result.result = 'FAIL'; result.error = error.stack; result.problems = problems; console.error(error); process.exitCode = 1; }
finally { await browser.close(); server.close(); result.finished = new Date().toISOString(); await writeFile(resolve(evidence, 'site-results.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify({ result: result.result, problems: problems.slice(0, 30), count: problems.length, checks: result.checks })); if (problems.length) process.exitCode = 1; }
