// Records the screen clips used by the Link Meteor videos.
//
// Every clip is a real Chrome for Testing page in a task-owned profile (never a personal
// profile): the site's practice and install pages served locally, a PDF served from the same
// local server, chrome://extensions pages, and the loaded extension's own workbench. Frames are
// captured at the page's full 2x density with Page.captureScreenshot (up to about 30 fps;
// unchanged frames are skipped). Synthetic pointer positions are logged so the compositor can
// draw a visible pointer. Each clip records the version and the build digest of the loaded dist/
// folder.
//
// On-page capture has two modes, recorded in each practice-page clip's manifest:
//   extension       the loaded extension injects its content script (needs site access to
//                   the fixture origin, granted beforehand through tests/prepare-grants.mjs).
//   reconstruction  without that grant, the extension's real content/capture.js runs on the
//                   same page with real pointer input and geometry; its messages are bridged to
//                   the loaded extension, converting candidates exactly as background/card.js does.
// The PDF clip needs neither: Chrome's own toolbar action (DevTools Extensions.triggerAction,
// which needs --enable-unsafe-extension-debugging) gives the extension the same temporary access
// to the PDF's tab as a person's click on the Link Meteor icon, and everything after it is the
// extension's own reading of the PDF.
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
import {makeExport, richLinks} from '../src/core/export.js';
import {MAX_CONTEXT} from '../src/core/model.js';
import {practicePdf, PRACTICE_PDF_PATH} from './lib/practice-pdf.mjs';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(process.env.LINK_METEOR_PLAYWRIGHT || resolve(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }

const root = resolve(import.meta.dirname, '..');
const recRoot = resolve(root, '.scratch/media/rec');
const DSF = 2;
const WIDE = {width: 1280, height: 720};
const PANEL = {width: 400, height: 720};
// The PDF's tab beside the side panel: the same shape as the still's place in the picture.
const PDF_TAB = {width: 850, height: 720};
const manifest = JSON.parse(await readFile(resolve(root, 'src/manifest.json'), 'utf8'));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const ease = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

class Clip {
  constructor(page, name, meta = {}, pointer = {x: 640, y: 420}) { Object.assign(this, {page, name, meta, frames: [], events: [], writes: [], pointer: {...pointer}}); }
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
  async center(locator) {
    const box = await locator.boundingBox(); if (!box) throw new Error(`${this.name}: target not visible`);
    const vp = this.page.viewportSize(), c = {x: box.x + box.width / 2, y: box.y + box.height / 2, box};
    // A click outside the viewport would land on nothing; scroll the target into view first.
    if (c.x < 0 || c.y < 0 || c.x > vp.width || c.y > vp.height) throw new Error(`${this.name}: target outside the viewport at ${Math.round(c.x)}, ${Math.round(c.y)}`);
    return c;
  }
  async clickOn(locator, opts) { const c = await this.center(locator); await this.click(c.x, c.y, opts); return c; }
  async stop() {
    await sleep(300);
    this.capturing = false; await this.loop;
    await Promise.all(this.writes);
    await this.cdp.detach().catch(() => {});
    const data = {name: this.name, version: manifest.version, build, chrome: chromeVersion, profile: `task-owned profile ${profile}`, recordedAt: new Date().toISOString(), dsf: DSF, viewport: this.viewport, started: this.started, ended: this.now(), frames: this.frames, events: this.events, ...this.meta};
    await writeFile(resolve(this.dir, 'clip.json'), JSON.stringify(data));
    console.log(JSON.stringify({clip: this.name, frames: this.frames.length, seconds: +(data.ended - data.started).toFixed(2), mode: this.meta.mode || 'page'}));
    return data;
  }
}

// `pointer` is where the drawn pointer starts, before the clip's first move.
async function record(page, name, meta, script, pointer) {
  const clip = await new Clip(page, name, meta, pointer).start();
  try { await script(clip); }
  catch (error) { const status = await page.locator('#link-meteor-overlay .status').innerText().catch(() => '(no overlay)'); throw new Error(`${name}: ${error.message}; overlay status: ${status}`); }
  return clip.stop();
}

// Scrolls an element into view, smoothly, in whichever box scrolls it (the page, or the full
// view's Export column), with its top `top` pixels from the top of the viewport.
const reveal = (locator, top) => locator.evaluate((target, top) => {
  let box = target.parentElement;
  while (box && box !== document.body && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
  const scroller = box && box !== document.body ? box : document.scrollingElement;
  const offset = target.getBoundingClientRect().top - (scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top);
  scroller.scrollTo({top: scroller.scrollTop + offset - top, behavior: 'smooth'});
}, top);

// ---------------------------------------------------------------------------------------------
const wanted = new Set(process.argv.slice(2));
const want = (name) => !wanted.size || wanted.has(name);
await mkdir(recRoot, {recursive: true});
const port = Number(process.env.LINK_METEOR_FIXTURE_PORT || 52478);
// The site, and the demo's PDF on the same origin (so the practice page's site access covers it).
const pdfBytes = practicePdf();
const {server, base} = await serve(port, {routes: (req, res) => {
  if (new URL(req.url, 'http://x').pathname !== PRACTICE_PDF_PATH) return false;
  res.writeHead(200, {'Content-Type': 'application/pdf', 'Content-Length': pdfBytes.length, 'Cache-Control': 'no-store'}); res.end(pdfBytes);
  return true;
}});
const profile = process.env.LINK_METEOR_MEDIA_PROFILE || `media-rec-${manifest.version}`;
// The window itself runs at 2x so Chrome's own hover-refresh pointer events (sent in window
// pixels) land where the emulated 2x page expects them rather than at half the coordinates.
const run = await launch(profile, {headless: true, scale: DSF, args: [`--force-device-scale-factor=${DSF}`, '--enable-unsafe-extension-debugging']});
const {context, id} = run;
const build = (await readFile(resolve(root, '.scratch', `${profile}-build.sha256`), 'utf8')).trim();
const chromeVersion = context.browser()?.version() || '';
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
  // As if the first-run welcome card had been closed: the clips show what comes after it.
  await rpc(ui, {type: 'state.mutate', action: {type: 'settings.update', patch: {welcomeSeen: true}}});
  const origin = `${base}/*`;
  const granted = await ui.evaluate((o) => chrome.permissions.contains({origins: [o]}), origin);
  const mode = granted ? 'extension' : 'reconstruction';
  console.log(JSON.stringify({profile, version: manifest.version, extension: id, fixture: base, captureMode: mode, chrome: chromeVersion}));
  const captureSource = await readFile(resolve(root, 'src/content/capture.js'), 'utf8');

  // Reconstruction only: the capture card's messages, answered as background.js answers them.
  // Messages that need no sender tab go to the loaded extension itself; those that do are
  // converted here exactly as background/card.js converts them (occurrences), with this page as
  // the sender tab, and saved through the loaded extension.
  async function bridge(source, message) {
    const tab = {url: source.url(), title: await source.title()};
    const toLinks = (candidates, batchId = randomUUID()) => {
      const capturedAt = new Date().toISOString();
      return candidates.map((c) => {
        const text = (k) => (typeof c[k] === 'string' ? c[k] : '');
        const context = text('context').replace(/\s+/gu, ' ').trim().slice(0, MAX_CONTEXT);
        return {id: randomUUID(), anchorText: text('anchorText'), accessibleLabel: text('accessibleLabel'), url: new URL(String(c.url)).href, originalHref: text('originalHref'), sourceUrl: tab.url || text('sourceUrl'), sourceTitle: tab.title || text('sourceTitle'), frameUrl: text('frameUrl'), capturedAt, batchId, notes: '', tags: [], ...(context ? {context} : {})};
      });
    };
    if (['settings.get', 'collection.active', 'collections.list', 'capture.saved'].includes(message.type)) return rpc(ui, message);
    if (message.type === 'capture.copy') { const links = toLinks(message.links); return message.format === 'rich' ? richLinks(links) : {text: makeExport(links, {format: message.format ?? 'tsv', columns: ['anchorText', 'url']}).data}; }
    if (message.type === 'capture.commit') {
      const batchId = randomUUID(), state = await rpc(ui, {type: 'state.get'});
      const home = state.collections.find((c) => c.id === (message.collectionId || state.activeCollectionId));
      const held = message.skipSaved === true ? new Set(home.links.map((link) => link.url)) : null;
      const all = toLinks(message.links, batchId), kept = held ? all.filter((link) => !held.has(link.url)) : all;
      const links = state.settings.saveContext === false ? kept.map(({context: _left, ...link}) => link) : kept;
      const after = links.length ? await rpc(ui, {type: 'state.mutate', action: {type: 'links.append', collectionId: home.id, links}}) : state;
      return {state: after, count: links.length, skipped: all.length - links.length, batchId: links.length ? batchId : '', collectionId: home.id, warning: ''};
    }
    if (message.type === 'ui.open') return {};
    throw new Error(`Unsupported message ${message.type}`);
  }

  async function practicePage(sectionId) {
    const page = await context.newPage(); await page.setViewportSize(WIDE); await page.emulateMedia({reducedMotion: 'no-preference'});
    await page.goto(`${base}/practice.html`); await page.evaluate(() => document.fonts.ready); await page.locator('#load-more').waitFor();
    await page.evaluate((id) => { const el = document.getElementById(id); scrollTo(0, el.getBoundingClientRect().top + scrollY - 92); }, sectionId);
    if (mode === 'reconstruction') {
      await page.exposeBinding('__lmBridge', async ({page: source}, message) => {
        try { return {ok: true, data: await bridge(source, message)}; } catch (error) { return {ok: false, error: error.message}; }
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
  // Chrome's own toolbar action on a page's tab, as a person's click on the Link Meteor icon.
  async function pressToolbarIcon(page) {
    const session = await context.browser().newBrowserCDPSession();
    try {
      const {targetInfos} = await session.send('Target.getTargets', {filter: [{type: 'tab'}]});
      const tab = targetInfos.find((target) => target.url === page.url());
      if (!tab) throw new Error(`No tab target for ${page.url()}`);
      await page.bringToFront();
      await session.send('Extensions.triggerAction', {id, targetId: tab.targetId});
    } finally { await session.detach().catch(() => {}); }
  }
  // The side panel's contents at panel width, in a tab of their own.
  async function panelPage() {
    const panel = await context.newPage(); await panel.setViewportSize(PANEL); await panel.emulateMedia({reducedMotion: 'no-preference'});
    await panel.goto(uiURL); await panel.locator('#collection-heading').waitFor();
    return panel;
  }

  // Keep the wide workbench scrolled to its list so arriving rows are in view.
  const showList = async (smooth = false) => { await ui.evaluate((behavior) => { const r = document.getElementById('review'); scrollTo({top: r.getBoundingClientRect().top + scrollY - 12, behavior}); }, smooth ? 'smooth' : 'instant'); };

  if (want('demo-select') || want('demo-workbench')) {
    const page = await practicePage('reading');
    await ui.bringToFront(); await showList();
    if (want('demo-select')) results['demo-select'] = await record(page, 'demo-select', {mode, page: 'Practice page', section: 'reading'}, async (clip) => {
      await clip.move(760, 250, {ms: 500}); await clip.wait(500);
      clip.mark('shortcut'); await clip.wait(550); await arm(page); clip.mark('armed');
      await clip.wait(900);
      await sweep(clip, page, 'reading');
      await until(async () => (await overlay(page).locator('.dest').innerText()).length > 0, 'destination', 5000);
      clip.mark('destination', {text: await overlay(page).locator('.dest').innerText()});
      await clip.wait(1900);
      await clip.clickOn(overlay(page).getByRole('button', {name: 'Add to collection', exact: true})); clip.mark('added');
      await until(async () => (await overlay(page).locator('.status').innerText()).startsWith('Saved'), 'saved', 5000);
      clip.mark('status', {text: await overlay(page).locator('.status').innerText()});
      await clip.wait(3000);
    });
    await ui.bringToFront();
    if (want('demo-workbench')) results['demo-workbench'] = await record(ui, 'demo-workbench', {page: 'Link Meteor full view'}, async (clip) => {
      await clip.wait(1500);
      const rows = ui.locator('.link-row');
      clip.mark('rows', {text: await ui.locator('#result-count').innerText()});
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
      const shown = await until(async () => grouped.locator('.occurrence').count(), 'the group’s occurrences', 5000);
      clip.mark('occurrences', {text: String(shown)});
      await clip.move(870, 250, {ms: 700}); await clip.wait(300);
      // Each occurrence's own fields in turn: its anchor text, address and source page.
      const facts = grouped.locator('.occurrence .facts');
      await reveal(facts.nth(0), 150); clip.mark('first'); await clip.wait(1900);
      await reveal(facts.nth(1), 150); clip.mark('second'); await clip.wait(2300);
      const chip = ui.locator('#active-filters .chip button').first();
      await showList(true); await clip.wait(800);
      await clip.clickOn(chip); clip.mark('ungrouped'); await clip.wait(1300);
      clip.mark('total', {text: await ui.locator('#result-count').innerText()});
      // The Download button is lower in the Export column, which scrolls on its own.
      await reveal(ui.locator('#download'), 300); clip.mark('export-column'); await clip.wait(900);
      const dl = ui.waitForEvent('download', {timeout: 10000});
      await clip.clickOn(ui.locator('#download')); clip.mark('download');
      const download = await dl; await download.saveAs(resolve(recRoot, 'demo-export.xlsx'));
      clip.mark('downloaded', {file: download.suggestedFilename()});
      await clip.wait(2900);
    });
    await page.close();
  }

  if (want('demo-pdf')) {
    // The PDF in its own tab, a still of it for beside the panel, then the toolbar icon on it.
    const pdf = await context.newPage(); await pdf.setViewportSize(PDF_TAB);
    // navpanes=0 is Chrome's PDF open parameter for a viewer without its page thumbnails.
    await pdf.goto(`${base}${PRACTICE_PDF_PATH}#navpanes=0`);
    await until(() => pdf.frames().find((frame) => frame.url().startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/')), 'Chrome’s PDF viewer', 15000)
      .then((viewer) => viewer.locator('#sidenavToggle').waitFor({timeout: 10000}));
    await pdf.waitForTimeout(1500);
    await pdf.screenshot({path: resolve(recRoot, 'demo-pdf-still.jpg'), type: 'jpeg', quality: 88});
    await pressToolbarIcon(pdf); await pdf.waitForTimeout(800);
    const panel = await panelPage();
    await until(async () => (await panel.locator('#capture-label').innerText()) === 'Capture this PDF', 'Capture this PDF', 15000);
    results['demo-pdf'] = await record(panel, 'demo-pdf', {page: 'Link Meteor side panel (panel width)', pdf: PRACTICE_PDF_PATH, access: 'Chrome’s toolbar action on the PDF’s tab'}, async (clip) => {
      clip.mark('label', {text: await panel.locator('#capture-label').innerText()});
      clip.mark('scope', {text: await panel.locator('#scope-preview').innerText()});
      await clip.wait(900);
      const button = await clip.center(panel.locator('#capture'));
      await clip.move(button.x + 20, button.y + 6, {ms: 900}); await clip.wait(1500);
      await clip.click(button.x + 20, button.y + 6); clip.mark('capture');
      await panel.locator('#import-plan').waitFor({state: 'visible', timeout: 15000}); clip.mark('preview', {text: await panel.locator('#import-source').innerText()});
      clip.mark('summary', {text: await panel.locator('#import-summary-main').innerText()});
      clip.mark('pages', {text: (await panel.locator('#import-table tbody tr td:first-child').allInnerTexts()).join(' ')});
      // Rest just left of the first page number while the preview is read, covering no text.
      const first = await clip.center(panel.locator('#import-table tbody tr td').first());
      await clip.move(first.box.x - 12, first.box.y + 14, {ms: 800});
      await clip.wait(3300);
      await reveal(panel.locator('#import-commit'), 600); clip.mark('scroll'); await clip.wait(1200);
      await clip.clickOn(panel.locator('#import-commit')); clip.mark('added');
      // Out of the way of the notice that appears where the button was.
      await clip.move(300, 505, {ms: 600});
      await until(async () => (await panel.locator('#notice .msg').innerText().catch(() => '')).startsWith('Added'), 'added notice', 10000);
      clip.mark('notice', {text: await panel.locator('#notice .msg').innerText()});
      await clip.wait(2800);
    }, {x: 320, y: 640});
    await panel.close(); await pdf.close();
  }

  if (want('tut-install')) {
    const page = await context.newPage(); await page.setViewportSize(WIDE); await page.emulateMedia({reducedMotion: 'no-preference'});
    await page.goto(`${base}/install.html`); await page.evaluate(() => document.fonts.ready);
    // The install page must offer this build's version; otherwise the clip would show another one.
    const offered = await page.locator('.download-card [data-build="filename"]').innerText();
    if (offered !== `link-meteor-${manifest.version}.zip`) throw new Error(`The install page offers ${offered}, not link-meteor-${manifest.version}.zip. Package this version and run node scripts/sync-site.mjs first.`);
    results['tut-install'] = await record(page, 'tut-install', {page: 'Install · Link Meteor'}, async (clip) => {
      await clip.wait(900);
      await page.evaluate(() => { const d = document.getElementById('download'); scrollTo({top: d.getBoundingClientRect().top + scrollY - 70, behavior: 'smooth'}); });
      await clip.wait(1500);
      const dl = page.waitForEvent('download', {timeout: 10000});
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
    const panel = await panelPage(); await panel.locator('.link-row').first().waitFor();
    if (want('tut-panel')) results['tut-panel'] = await record(panel, 'tut-panel', {page: 'Link Meteor side panel (panel width)'}, async (clip) => {
      await clip.wait(1200);
      await panel.evaluate(() => scrollTo({top: document.getElementById('review').getBoundingClientRect().top + scrollY - 8, behavior: 'smooth'})); await clip.wait(1800);
      await clip.clickOn(panel.locator('#dock-export')); clip.mark('export-view'); await clip.wait(1300);
      clip.mark('target', {text: await panel.locator('#export-target').innerText()});
      const fmt = await clip.center(panel.locator('#format')); await clip.click(fmt.x, fmt.y); await panel.locator('#format').selectOption('csv'); clip.mark('csv'); await clip.wait(900);
      await reveal(panel.locator('#download'), 420); await clip.wait(900);
      const dl = panel.waitForEvent('download', {timeout: 10000});
      await clip.clickOn(panel.locator('#download')); clip.mark('download');
      const download = await dl; await download.saveAs(resolve(recRoot, 'tut-export.csv')); clip.mark('downloaded', {file: download.suggestedFilename()});
      await clip.wait(3000);
      await panel.evaluate(() => scrollTo({top: 0, behavior: 'smooth'})); await clip.wait(700);
      await clip.clickOn(panel.locator('#export-done')); await clip.wait(900);
    }, {x: 300, y: 600});
    if (want('tut-about')) results['tut-about'] = await record(panel, 'tut-about', {page: 'Link Meteor side panel (panel width)'}, async (clip) => {
      await panel.evaluate(() => scrollTo(0, 0));
      await clip.wait(900);
      await clip.clickOn(panel.locator('#help-toggle')); clip.mark('about');
      await clip.wait(1200);
      await panel.evaluate(() => { const a = document.getElementById('about-panel'); scrollTo({top: a.getBoundingClientRect().top + scrollY - 120, behavior: 'smooth'}); });
      await clip.wait(1200);
      clip.mark('credit', {text: await panel.locator('#about-panel .about-credit').innerText()});
      const issues = panel.locator('#about-panel a', {hasText: 'Report a bug'});
      const c = await clip.center(issues); await clip.move(c.x - 60, c.y, {ms: 700}); clip.mark('issues'); await clip.wait(3400);
    }, {x: 250, y: 300});
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
      await clip.wait(900);
      const card = page.locator('extensions-item').first();
      const c = await clip.center(card); await clip.move(c.x - 60, c.y - 30, {ms: 900});
      clip.mark('card', {text: `${(await card.locator('#name').innerText()).trim()} ${(await card.locator('#version').innerText()).trim()}`}); await clip.wait(2600);
    }, {x: 700, y: 500});
    if (want('tut-shortcuts')) {
      await page.goto('chrome://extensions/shortcuts'); await page.waitForTimeout(900);
      results['tut-shortcuts'] = await record(page, 'tut-shortcuts', {page: 'chrome://extensions/shortcuts'}, async (clip) => {
        await clip.wait(900);
        // The field on the same line as Link Meteor's own command (Chrome lists Activate the extension first).
        const name = manifest.commands['select-region'].description;
        const line = (await page.getByText(name, {exact: true}).boundingBox()).y;
        const fields = await Promise.all((await page.locator('cr-shortcut-input').all()).map(async (field) => ({field, box: await field.boundingBox()})));
        const {field} = fields.filter((f) => f.box).sort((a, b) => Math.abs(a.box.y - line) - Math.abs(b.box.y - line))[0];
        const c = await clip.center(field); await clip.move(c.x, c.y, {ms: 900}); clip.mark('shortcut-field', {text: name}); await clip.wait(2600);
      }, {x: 640, y: 560});
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
      results['tut-ext-before'] = await record(page, 'tut-ext-before', {page: 'chrome://extensions', profile: `separate task-owned profile ${profile}-plain, without Link Meteor`}, async (clip) => {
        await clip.wait(1000);
        await clip.clickOn(dev); clip.mark('devmode'); await clip.wait(1300);
        const load = page.locator('#loadUnpacked');
        const c = await clip.center(load); await clip.move(c.x, c.y, {ms: 900}); clip.mark('load-unpacked'); await clip.wait(2200);
      }, {x: 700, y: 400});
    } finally { await plain.close(); }
  }
  await writeFile(resolve(recRoot, 'session.json'), JSON.stringify({profile, version: manifest.version, build, chrome: chromeVersion, captureMode: mode, recordedAt: new Date().toISOString(), clips: Object.keys(results)}, null, 2));
} finally {
  await context.close(); server.close();
}
