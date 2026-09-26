// Records the screen clips used by the Link Meteor videos.
//
// Every clip is a real Chrome for Testing page in a task-owned profile (never a personal
// profile): the site's practice and install pages served locally, chrome://extensions pages,
// and the loaded extension's own workbench. Frames are captured at the page's full 2x density
// with Page.captureScreenshot (up to about 30 fps; unchanged frames are skipped). Synthetic
// pointer positions are logged so the compositor can draw a visible pointer. Each clip records
// the version and the build digest of the loaded dist/ folder.
//
// On-page capture has two modes, recorded in each clip's manifest:
//   extension       the loaded extension injects its content script (needs site access to
//                   the fixture origin, granted beforehand through tests/prepare-grants.mjs).
//   reconstruction  without that grant, the extension's real content/capture.js runs on the
//                   same page with real pointer input and geometry; its save/copy messages are
//                   bridged to the loaded extension (state.mutate links.append, makeExport tsv),
//                   converting candidates exactly as background.js does.
//
// Usage: node media/record.mjs [clip ...]      (clips default to all)
// Env:   LINK_METEOR_MEDIA_PROFILE (default media-rec-<version>), LINK_METEOR_FIXTURE_PORT.
import {randomUUID} from 'node:crypto';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {launch, rpc, until} from '../tests/helpers/browser.mjs';
import {serve} from '../tests/site-preview.mjs';
import {makeExport} from '../src/core/export.js';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(process.env.LINK_METEOR_PLAYWRIGHT || resolve(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }

const root = resolve(import.meta.dirname, '..');
const recRoot = resolve(root, '.scratch/media/rec');
const DSF = 2;
const WIDE = {width: 1280, height: 720};
const PANEL = {width: 400, height: 720};
const manifest = JSON.parse(await readFile(resolve(root, 'src/manifest.json'), 'utf8'));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const ease = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

class Clip {
  constructor(page, name, meta = {}) { Object.assign(this, {page, name, meta, frames: [], events: [], writes: [], pointer: {x: 640, y: 420}}); }
  now() { return Date.now() / 1000; }
  async start() {
    this.dir = resolve(recRoot, this.name);
    await rm(this.dir, {recursive: true, force: true});
    await mkdir(resolve(this.dir, 'frames'), {recursive: true});
    const vp = this.page.viewportSize();
    this.viewport = vp;
    this.cdp = await this.page.context().newCDPSession(this.page);
    // Captures from a second session would otherwise reset Playwright's viewport emulation and
    // reflow the page to the bare headless window; apply the same metrics on this session.
    await this.cdp.send('Emulation.setDeviceMetricsOverride', {width: vp.width, height: vp.height, deviceScaleFactor: DSF, mobile: false});
    const lm = await this.cdp.send('Page.getLayoutMetrics');
    this.meta.viewportCheck = {inner: await this.page.evaluate(() => [innerWidth, innerHeight, visualViewport.height]), css: lm.cssVisualViewport, layout: lm.cssLayoutViewport};
    if (process.env.LINK_METEOR_MEDIA_DEBUG) console.log(JSON.stringify({clip: this.name, ...this.meta.viewportCheck}));
    // Paced full-density capture at the emulated 2x viewport (the headless screencast is 1x). ~29 fps;
    // an unchanged frame is not stored again, and the compositor holds the previous one.
    let n = 0, last = null;
    await this.page.bringToFront();
    this.started = this.now();
    this.capturing = true;
    this.loop = (async () => {
      while (this.capturing) {
        const tick = Date.now();
        const {data} = await this.cdp.send('Page.captureScreenshot', {format: 'jpeg', quality: 90, optimizeForSpeed: true}).catch(() => ({}));
        if (data && data !== last) {
          last = data;
          const file = `frames/${String(n++).padStart(5, '0')}.jpg`;
          this.frames.push({file, t: tick / 1000});
          this.writes.push(writeFile(resolve(this.dir, file), Buffer.from(data, 'base64')));
        }
        await sleep(Math.max(0, 33 - (Date.now() - tick)));
      }
    })();
    this.events.push({t: this.now(), type: 'pointer', ...this.pointer, hidden: true});
    await sleep(350);
    return this;
  }
  mark(label, data = {}) { this.events.push({t: this.now(), type: 'mark', label, ...data}); }
  async wait(ms) { await sleep(ms); }
  async move(x, y, {ms} = {}) {
    const from = {...this.pointer};
    const dist = Math.hypot(x - from.x, y - from.y);
    ms ??= Math.max(320, Math.min(1000, 260 + dist * 0.85));
    const steps = Math.max(2, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const k = ease(i / steps);
      this.pointer = {x: from.x + (x - from.x) * k, y: from.y + (y - from.y) * k};
      await this.page.mouse.move(this.pointer.x, this.pointer.y);
      this.events.push({t: this.now(), type: 'pointer', ...this.pointer});
      await sleep(16);
    }
  }
  async down() { await this.page.mouse.down(); this.events.push({t: this.now(), type: 'down', ...this.pointer}); }
  async up() { await this.page.mouse.up(); this.events.push({t: this.now(), type: 'up', ...this.pointer}); }
  async click(x, y, opts) { await this.move(x, y, opts); await sleep(140); await this.down(); await sleep(90); await this.up(); }
  async center(locator) { const box = await locator.boundingBox(); if (!box) throw new Error(`${this.name}: target not visible`); return {x: box.x + box.width / 2, y: box.y + box.height / 2, box}; }
  async clickOn(locator, opts) { const c = await this.center(locator); await this.click(c.x, c.y, opts); return c; }
  async stop() {
    await sleep(300);
    this.capturing = false; await this.loop;
    await Promise.all(this.writes);
    await this.cdp.detach().catch(() => {});
    const data = {name: this.name, version: manifest.version, build, recordedAt: new Date().toISOString(), dsf: DSF, viewport: this.viewport, started: this.started, ended: this.now(), frames: this.frames, events: this.events, ...this.meta};
    await writeFile(resolve(this.dir, 'clip.json'), JSON.stringify(data));
    console.log(JSON.stringify({clip: this.name, frames: this.frames.length, seconds: +(data.ended - data.started).toFixed(2), mode: this.meta.mode || 'page'}));
    return data;
  }
}

async function record(page, name, meta, script) {
  const clip = await new Clip(page, name, meta).start();
  try { await script(clip); }
  catch (error) { const status = await page.locator('#link-meteor-overlay .status').innerText().catch(() => '(no overlay)'); throw new Error(`${name}: ${error.message}; overlay status: ${status}`); }
  return clip.stop();
}

// ---------------------------------------------------------------------------------------------
const wanted = new Set(process.argv.slice(2));
const want = (name) => !wanted.size || wanted.has(name);
await mkdir(recRoot, {recursive: true});
const port = Number(process.env.LINK_METEOR_FIXTURE_PORT || 52478);
const {server, base} = await serve(port);
const profile = process.env.LINK_METEOR_MEDIA_PROFILE || `media-rec-${manifest.version}`;
// The window itself runs at 2x so Chrome's own hover-refresh pointer events (sent in window
// pixels) land where the emulated 2x page expects them rather than at half the coordinates.
const run = await launch(profile, {headless: true, scale: DSF, args: [`--force-device-scale-factor=${DSF}`]});
const {context, id} = run;
const build = (await readFile(resolve(root, '.scratch', `${profile}-build.sha256`), 'utf8')).trim();
const results = {};
try {
  for (const old of context.pages()) await old.close();
  const uiURL = `chrome-extension://${id}/ui/workbench.html`;
  const ui = await context.newPage(); await ui.setViewportSize(WIDE); await ui.emulateMedia({reducedMotion: 'no-preference'});
  await ui.goto(uiURL); await ui.locator('#collection-heading').waitFor();
  await ui.evaluate(() => chrome.storage.local.clear()); await ui.reload(); await ui.locator('#collection-heading').waitFor();
  await rpc(ui, {type: 'state.mutate', action: {type: 'collection.create', name: 'Urban heat islands: sources'}});
  const firstId = (await rpc(ui, {type: 'state.get'})).collections[0].id;
  await rpc(ui, {type: 'state.mutate', action: {type: 'collection.delete', id: firstId}});
  const origin = `${base}/*`;
  const granted = await ui.evaluate((o) => chrome.permissions.contains({origins: [o]}), origin);
  const mode = granted ? 'extension' : 'reconstruction';
  console.log(JSON.stringify({profile, version: manifest.version, extension: id, fixture: base, captureMode: mode}));
  const captureSource = await readFile(resolve(root, 'src/content/capture.js'), 'utf8');

  async function practicePage(sectionId) {
    const page = await context.newPage(); await page.setViewportSize(WIDE); await page.emulateMedia({reducedMotion: 'no-preference'});
    await page.goto(`${base}/practice.html`); await page.evaluate(() => document.fonts.ready); await page.locator('#load-more').waitFor();
    await page.evaluate((id) => { const el = document.getElementById(id); scrollTo(0, el.getBoundingClientRect().top + scrollY - 92); }, sectionId);
    if (mode === 'reconstruction') {
      // Bridge the real content script's messages to the loaded extension, mirroring background.js.
      await page.exposeBinding('__lmBridge', async ({page: source}, message) => {
        const tab = {url: source.url(), title: await source.title()};
        const toLinks = (candidates) => { const batchId = randomUUID(), capturedAt = new Date().toISOString(); return candidates.map((c) => { const text = (k) => (typeof c[k] === 'string' ? c[k] : ''); return {id: randomUUID(), anchorText: text('anchorText'), accessibleLabel: text('accessibleLabel'), url: new URL(String(c.url)).href, originalHref: text('originalHref'), sourceUrl: tab.url || text('sourceUrl'), sourceTitle: tab.title || text('sourceTitle'), frameUrl: text('frameUrl'), capturedAt, batchId, notes: '', tags: []}; }); };
        try {
          if (message.type === 'settings.get') return {ok: true, data: await rpc(ui, {type: 'settings.get'})};
          if (message.type === 'collection.active') return {ok: true, data: await rpc(ui, {type: 'collection.active'})};
          if (message.type === 'capture.copy') return {ok: true, data: {text: makeExport(toLinks(message.links), {format: 'tsv', columns: ['anchorText', 'url']}).data}};
          if (message.type === 'capture.commit') { const links = toLinks(message.links); const state = links.length ? await rpc(ui, {type: 'state.mutate', action: {type: 'links.append', links}}) : await rpc(ui, {type: 'state.get'}); return {ok: true, data: {state, count: links.length, warning: ''}}; }
          if (message.type === 'ui.open') return {ok: true, data: {}};
          return {ok: false, error: `Unsupported message ${message.type}`};
        } catch (error) { return {ok: false, error: error.message}; }
      });
      await page.evaluate(`globalThis.chrome={runtime:{onMessage:{addListener(){}},sendMessage:(m)=>window.__lmBridge(m)},storage:{onChanged:{addListener(){}}}};\n${captureSource}`);
    }
    return page;
  }
  async function arm(page) {
    if (mode === 'extension') {
      const tab = (await rpc(ui, {type: 'tabs.list'})).tabs.find((t) => t.url === page.url());
      await rpc(ui, {type: 'capture.arm', tabId: tab.id});
    } else await page.evaluate(() => globalThis.__linkMeteor.arm());
    await page.locator('#link-meteor-overlay').waitFor();
  }
  const overlay = (page) => page.locator('#link-meteor-overlay');
  async function sweep(clip, page, sectionId, {startInset = 6, ms = 1700} = {}) {
    const box = await page.locator('#' + sectionId).boundingBox();
    await clip.move(box.x + startInset, box.y + startInset, {ms: 700});
    await clip.wait(250); await clip.down(); clip.mark('drag-start');
    await clip.move(box.x + box.width - 5, box.y + box.height - 5, {ms});
    await clip.wait(350); await clip.up(); clip.mark('released');
    const count = await overlay(page).locator('.count').innerText();
    clip.mark('count', {text: count});
    return count;
  }

  // Keep the wide workbench scrolled to its list so arriving rows are in view.
  const showList = async (smooth = false) => { await ui.evaluate((behavior) => { const r = document.getElementById('review'); scrollTo({top: r.getBoundingClientRect().top + scrollY - 12, behavior}); }, smooth ? 'smooth' : 'instant'); };

  if (want('demo-select') || want('demo-workbench')) {
    const page = await practicePage('reading');
    await ui.bringToFront(); await showList();
    results['demo-select'] = await record(page, 'demo-select', {mode, page: 'Practice page', section: 'reading'}, async (clip) => {
      await clip.move(760, 250, {ms: 500}); await clip.wait(500);
      clip.mark('shortcut'); await clip.wait(550); await arm(page); clip.mark('armed');
      await clip.wait(900);
      await sweep(clip, page, 'reading');
      await clip.wait(1900);
      await clip.clickOn(overlay(page).getByRole('button', {name: 'Add to collection', exact: true})); clip.mark('added');
      await until(async () => (await overlay(page).locator('.status').innerText()).startsWith('Saved'), 'saved', 5000);
      clip.mark('status', {text: await overlay(page).locator('.status').innerText()});
      await clip.wait(3000);
    });
    await ui.bringToFront();
    results['demo-workbench'] = await record(ui, 'demo-workbench', {page: 'Link Meteor full view'}, async (clip) => {
      await clip.wait(1500);
      const rows = ui.locator('.link-row');
      const imageRow = rows.filter({hasText: 'No anchor text'}).first();
      // Bring the image link's row up into view before pointing at it.
      await imageRow.evaluate((row) => scrollBy({top: row.getBoundingClientRect().top - 430, behavior: 'smooth'})); await clip.wait(1000);
      // Rest the pointer past the short "No anchor text" line so it covers none of the row's text.
      const {box} = await clip.center(imageRow.locator('.cell-anchor'));
      await clip.move(box.x + 300, box.y + 10, {ms: 800}); clip.mark('empty-anchor'); await clip.wait(2300);
      clip.mark('list-top'); await showList(true); await clip.wait(800);
      await clip.clickOn(ui.locator('#filters-toggle')); clip.mark('view-open'); await clip.wait(700);
      const group = await clip.center(ui.locator('#dedupe'));
      await clip.click(group.x, group.y); await ui.locator('#dedupe').selectOption('url'); clip.mark('grouped'); await clip.wait(900);
      await clip.clickOn(ui.locator('#filters-toggle')); await clip.wait(500);
      await showList(); await clip.wait(900);
      const grouped = rows.filter({hasText: '×2'}).first();
      await clip.clickOn(grouped.locator('.row-details summary')); clip.mark('details');
      await clip.wait(900);
      await ui.evaluate(() => scrollBy({top: 260, behavior: 'smooth'})); await clip.wait(2600);
      const chip = ui.locator('#active-filters .chip button').first();
      await ui.evaluate(() => { const r = document.getElementById('review'); scrollTo({top: r.getBoundingClientRect().top + scrollY - 12, behavior: 'smooth'}); }); await clip.wait(800);
      await clip.clickOn(chip); clip.mark('ungrouped'); await clip.wait(1300);
      const dl = ui.waitForEvent('download');
      await clip.clickOn(ui.locator('#download')); clip.mark('download');
      const download = await dl; await download.saveAs(resolve(recRoot, 'demo-export.xlsx'));
      clip.mark('downloaded', {file: download.suggestedFilename()});
      await clip.wait(2900);
    });
    await page.close();
  }

  if (want('tut-install')) {
    const page = await context.newPage(); await page.setViewportSize(WIDE); await page.emulateMedia({reducedMotion: 'no-preference'});
    await page.goto(`${base}/install.html`); await page.evaluate(() => document.fonts.ready);
    results['tut-install'] = await record(page, 'tut-install', {page: 'Install · Link Meteor'}, async (clip) => {
      await clip.wait(900);
      await page.evaluate(() => { const d = document.getElementById('download'); scrollTo({top: d.getBoundingClientRect().top + scrollY - 70, behavior: 'smooth'}); });
      await clip.wait(1500);
      const dl = page.waitForEvent('download');
      await clip.clickOn(page.locator('.download-card .btn')); clip.mark('download');
      const download = await dl; clip.mark('downloaded', {file: download.suggestedFilename()}); await download.delete();
      await clip.wait(1800);
    });
    await page.close();
  }

  if (want('tut-capture')) {
    const page = await practicePage('results');
    await ui.bringToFront(); await showList();
    results['tut-capture'] = await record(page, 'tut-capture', {mode, page: 'Practice page', section: 'results'}, async (clip) => {
      await clip.move(800, 300, {ms: 500}); await clip.wait(500);
      clip.mark('shortcut'); await clip.wait(550); await arm(page); clip.mark('armed'); await clip.wait(800);
      await sweep(clip, page, 'results', {ms: 1500});
      await clip.wait(1600);
      await clip.clickOn(overlay(page).getByRole('button', {name: 'Copy text + URL', exact: true})); clip.mark('copy');
      await until(async () => (await overlay(page).locator('.status').innerText()).length > 0, 'copy status', 5000);
      clip.mark('copy-status', {text: await overlay(page).locator('.status').innerText()});
      await clip.wait(2000);
      await clip.clickOn(overlay(page).getByRole('button', {name: 'Add to collection', exact: true})); clip.mark('added');
      await until(async () => (await overlay(page).locator('.status').innerText()).startsWith('Saved'), 'saved', 5000);
      clip.mark('status', {text: await overlay(page).locator('.status').innerText()});
      await clip.wait(3000);
    });
    await page.screenshot({path: resolve(recRoot, 'tut-capture-still.jpg'), type: 'jpeg', quality: 88});
    await page.close();
  }

  if (want('tut-panel') || want('tut-about')) {
    const panel = await context.newPage(); await panel.setViewportSize(PANEL); await panel.emulateMedia({reducedMotion: 'no-preference'});
    await panel.goto(uiURL); await panel.locator('.link-row').first().waitFor();
    if (want('tut-panel')) results['tut-panel'] = await record(panel, 'tut-panel', {page: 'Link Meteor side panel (panel width)'}, async (clip) => {
      clip.pointer = {x: 300, y: 600};
      await clip.wait(1200);
      await panel.evaluate(() => scrollTo({top: document.getElementById('review').getBoundingClientRect().top + scrollY - 8, behavior: 'smooth'})); await clip.wait(1800);
      await clip.clickOn(panel.locator('#dock-export')); clip.mark('export-view'); await clip.wait(1300);
      const fmt = await clip.center(panel.locator('#format')); await clip.click(fmt.x, fmt.y); await panel.locator('#format').selectOption('csv'); clip.mark('csv'); await clip.wait(900);
      const dl = panel.waitForEvent('download');
      await clip.clickOn(panel.locator('#download')); clip.mark('download');
      const download = await dl; await download.saveAs(resolve(recRoot, 'tut-export.csv')); clip.mark('downloaded', {file: download.suggestedFilename()});
      await clip.wait(3000);
      await clip.clickOn(panel.locator('#export-done')); await clip.wait(900);
    });
    if (want('tut-about')) results['tut-about'] = await record(panel, 'tut-about', {page: 'Link Meteor side panel (panel width)'}, async (clip) => {
      await panel.evaluate(() => scrollTo(0, 0));
      clip.pointer = {x: 250, y: 300};
      await clip.wait(900);
      await clip.clickOn(panel.locator('#help-toggle')); clip.mark('about');
      await clip.wait(1200);
      await panel.evaluate(() => { const a = document.getElementById('about-panel'); scrollTo({top: a.getBoundingClientRect().top + scrollY - 120, behavior: 'smooth'}); });
      await clip.wait(1200);
      const issues = panel.locator('#about-panel a', {hasText: 'Report a bug'});
      const c = await clip.center(issues); await clip.move(c.x - 60, c.y, {ms: 700}); clip.mark('issues'); await clip.wait(3400);
    });
    await panel.close();
  }

  if (want('tut-ext-after') || want('tut-shortcuts')) {
    const page = await context.newPage(); await page.setViewportSize(WIDE);
    await page.goto('chrome://extensions');
    await page.waitForTimeout(800);
    const dev = page.locator('#devMode');
    if ((await dev.getAttribute('aria-pressed')) !== 'true' && !(await dev.isChecked().catch(() => false))) await dev.click();
    await page.waitForTimeout(600);
    if (want('tut-ext-after')) results['tut-ext-after'] = await record(page, 'tut-ext-after', {page: 'chrome://extensions'}, async (clip) => {
      clip.pointer = {x: 700, y: 500};
      await clip.wait(900);
      const card = page.locator('extensions-item').first();
      const c = await clip.center(card); await clip.move(c.x - 60, c.y - 30, {ms: 900}); clip.mark('card'); await clip.wait(2600);
    });
    if (want('tut-shortcuts')) {
      await page.goto('chrome://extensions/shortcuts'); await page.waitForTimeout(900);
      results['tut-shortcuts'] = await record(page, 'tut-shortcuts', {page: 'chrome://extensions/shortcuts'}, async (clip) => {
        clip.pointer = {x: 640, y: 560};
        await clip.wait(900);
        const field = page.locator('cr-shortcut-input').first();
        const c = await clip.center(field); await clip.move(c.x, c.y, {ms: 900}); clip.mark('shortcut-field'); await clip.wait(2600);
      });
    }
    await page.close();
  }

  if (want('tut-ext-before')) {
    // A second task-owned profile without Link Meteor shows the page before Load unpacked.
    const plainDir = resolve(root, '.scratch', `${profile}-plain`);
    const plain = await playwright.chromium.launchPersistentContext(plainDir, {executablePath: playwright.chromium.executablePath(), headless: true, viewport: WIDE, deviceScaleFactor: DSF, args: ['--disable-background-networking', '--disable-component-update', `--force-device-scale-factor=${DSF}`]});
    try {
      const page = plain.pages()[0] || await plain.newPage();
      await page.goto('chrome://extensions'); await page.waitForTimeout(900);
      const dev = page.locator('#devMode');
      if ((await dev.getAttribute('aria-pressed')) === 'true') { await dev.click(); await page.waitForTimeout(400); }
      results['tut-ext-before'] = await record(page, 'tut-ext-before', {page: 'chrome://extensions', profile: 'separate task-owned profile without Link Meteor'}, async (clip) => {
        clip.pointer = {x: 700, y: 400};
        await clip.wait(1000);
        await clip.clickOn(dev); clip.mark('devmode'); await clip.wait(1300);
        const load = page.locator('#loadUnpacked');
        const c = await clip.center(load); await clip.move(c.x, c.y, {ms: 900}); clip.mark('load-unpacked'); await clip.wait(2200);
      });
    } finally { await plain.close(); }
  }
  await writeFile(resolve(recRoot, 'session.json'), JSON.stringify({profile, version: manifest.version, build, captureMode: mode, recordedAt: new Date().toISOString(), clips: Object.keys(results)}, null, 2));
} finally {
  await context.close(); server.close();
}
