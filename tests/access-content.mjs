// SIMULATION: the real content script (src/content/capture.js) loaded into ordinary pages of the
// local fixture server in Chrome for Testing, with a stub `chrome` object standing in for the
// extension. Pointer, keyboard and click events are real browser input; every Link Meteor message
// is answered by the stub, so this checks the page script's own behavior, not the background.
// Writes access-content-results.json to LINK_METEOR_EVIDENCE_DIR (default .scratch/evidence-access-capture).
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixtureServer, playwright, root} from './helpers/browser.mjs';

const evidence = resolve(root, process.env.LINK_METEOR_EVIDENCE_DIR || '.scratch/evidence-access-capture');
const source = await readFile(resolve(root, 'src/content/capture.js'), 'utf8');
const result = {started: new Date().toISOString(), kind: 'simulation: real page script, stub chrome object, real input events in Chrome for Testing', checks: []};
const pass = (name, data = {}) => { result.checks.push({name, ...data}); console.log('PASS', name, Object.keys(data).length ? JSON.stringify(data) : ''); };

// The stub answers like the background would, and records every message.
function stub({platform, trigger = 'modifier', key = 'z'}) {
  const init = ({platform, trigger, key}) => {
    if (platform) {
      Object.defineProperty(Navigator.prototype, 'platform', {get: () => platform, configurable: true});
      Object.defineProperty(Navigator.prototype, 'userAgentData', {get: () => undefined, configurable: true});
    }
    const sent = [], clicks = [], downs = [];
    let listener = null;
    const collections = [{id: 'c1', name: 'My research', count: 0}, {id: 'c2', name: 'Second collection', count: 3}];
    const reply = (message) => {
      switch (message.type) {
        case 'settings.get': return {holdKey: key, holdTrigger: trigger, holdScope: 'all', holdOrigins: [], holdExceptions: []};
        case 'collections.list': return {activeCollectionId: 'c1', collections};
        case 'collection.active': return {name: 'My research', count: 0};
        case 'capture.commit': {
          const id = message.collectionId || 'c1';
          const links = message.links.map((link, i) => ({...link, id: 'saved-' + i, batchId: 'batch-1'}));
          return {state: {activeCollectionId: 'c1', collections: collections.map(c => ({...c, links: c.id === id ? links : []}))}, count: links.length, warning: ''};
        }
        case 'capture.copy': return {text: message.links.map(link => link.url).join('\n')};
        case 'capture.open': return {opened: new Set(message.links.map(l => l.url)).size, failed: 0, cancelled: false, ...(message.mode === 'group' ? {groupId: 7, groupTitled: false} : {})};
        case 'capture.export': return {fileName: 'My-research_2026-09-26_1432.csv', mime: 'text/csv;charset=utf-8', encoding: 'utf8', data: 'Anchor text,URL\r\n'};
        case 'capture.bookmark': throw new Error('Bookmark access is needed. Open the full view and use Save as bookmarks there; Chrome asks for access once.');
        case 'ui.open': case 'links.cancel': return {};
        default: throw new Error('Unexpected message ' + message.type);
      }
    };
    const chrome = {
      runtime: {
        sendMessage: async (message) => { sent.push(JSON.parse(JSON.stringify(message))); try { return {ok: true, data: reply(message)}; } catch (error) { return {ok: false, error: error.message}; } },
        onMessage: {addListener: (fn) => { listener = fn; }},
      },
      storage: {onChanged: {addListener() {}}},
    };
    window.chrome = chrome; // writable, not configurable
    window.__stub = {sent, clicks, downs, deliver: (message) => listener?.(message)};
    // Page listeners in the bubble phase: they see what the page would see.
    document.addEventListener('click', (event) => { clicks.push({target: event.target.id || event.target.tagName, meta: event.metaKey, ctrl: event.ctrlKey, prevented: event.defaultPrevented}); if (event.target.closest?.('a')) event.preventDefault(); });
    document.addEventListener('pointerdown', (event) => { downs.push({target: event.target.id || event.target.tagName, prevented: event.defaultPrevented}); });
  };
  return {init, arg: {platform, trigger, key}};
}

const fixture = await fixtureServer();
const browser = await playwright.chromium.launch({executablePath: playwright.chromium.executablePath(), headless: true});
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const card = (page) => page.locator('#link-meteor-overlay');
async function load(page, path, options) {
  const {init, arg} = stub(options);
  await page.addInitScript(init, arg);
  await page.goto(fixture.base + path);
  await page.addScriptTag({content: source});
  await page.waitForFunction(() => window.__stub.sent.some((m) => m.type === 'settings.get'));
  await sleep(50);
}
const sent = (page, type) => page.evaluate((type) => window.__stub.sent.filter((m) => !type || m.type === type), type);
const clicks = (page) => page.evaluate(() => window.__stub.clicks.splice(0));
const statusMatches = (page, pattern) => page.waitForFunction((source) => new RegExp(source).test(document.getElementById('link-meteor-overlay')?.shadowRoot.querySelector('.status')?.textContent || ''), pattern.source);

try {
  await mkdir(evidence, {recursive: true});
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, acceptDownloads: true});

  /* Modifier trigger on macOS: Command. */
  const page = await context.newPage();
  await load(page, '/index.html', {platform: 'MacIntel', trigger: 'modifier'});
  const paper = await page.locator('#paper-one').boundingBox();
  const px = paper.x + 10, py = paper.y + paper.height / 2;

  // A plain Command-click passes through: no overlay, the page sees the click and an unprevented press.
  await page.keyboard.down('Meta'); await page.mouse.click(px, py); await page.keyboard.up('Meta');
  await sleep(100);
  assert.equal(await card(page).count(), 0);
  let seen = await clicks(page);
  assert.deepEqual(seen, [{target: 'paper-one', meta: true, ctrl: false, prevented: false}]);
  assert.equal((await page.evaluate(() => window.__stub.downs.at(-1))).prevented, false);
  pass('Plain Command-click on a link passes through to the page untouched');

  // Below the threshold (5 px), still a click: no selection starts.
  await page.keyboard.down('Meta'); await page.mouse.move(px, py); await page.mouse.down(); await page.mouse.move(px + 3, py + 4, {steps: 3}); await page.mouse.up(); await page.keyboard.up('Meta');
  await sleep(100);
  assert.equal(await card(page).count(), 0);
  seen = await clicks(page);
  assert.equal(seen.length, 1); assert.equal(seen[0].target, 'paper-one');
  pass('A Command-press that moves 5 px stays a click and starts no selection');

  // Without the modifier, dragging never starts a selection.
  await page.mouse.move(px, py); await page.mouse.down(); await page.mouse.move(px + 60, py + 60, {steps: 6}); await page.mouse.up();
  await sleep(100);
  assert.equal(await card(page).count(), 0);
  await clicks(page);
  pass('A drag without the modifier does nothing');

  // Command-drag past 6 px from a link starts the selection; the click that ends it is suppressed.
  const bib = await page.locator('#bibliography').boundingBox();
  await page.keyboard.down('Meta'); await page.mouse.move(bib.x + 4, bib.y + 4); await page.mouse.down();
  await page.mouse.move(bib.x + 7, bib.y + 7);
  assert.equal(await card(page).count(), 0, 'no overlay before 6 px');
  await page.mouse.move(bib.x + bib.width - 4, bib.y + bib.height - 4, {steps: 12});
  await page.waitForFunction(() => document.getElementById('link-meteor-overlay')?.shadowRoot.querySelector('.badge')?.textContent === '5 links');
  await page.mouse.up(); await page.keyboard.up('Meta');
  await sleep(100);
  assert.equal(await card(page).locator('.count').innerText(), '5 links selected');
  assert.deepEqual(await clicks(page), [], 'the click that ends the drag never reaches the page');
  const selection = await page.evaluate(() => getSelection().toString());
  pass('Command-drag of 6 px or more starts selection; the ending click is suppressed once', {pageTextSelected: selection.length});

  // The next click is an ordinary click again.
  await card(page).locator('button.dismiss').click(); await clicks(page);
  await page.mouse.click(px, py); await sleep(50);
  assert.equal((await clicks(page)).length, 1);
  pass('Only one click is suppressed; the next click reaches the page');

  // Command-drag starting on a link opens the selection instead of dragging the link away.
  await page.keyboard.down('Meta'); await page.mouse.move(px, py); await page.mouse.down();
  await page.mouse.move(px + 40, py + 90, {steps: 10});
  await page.waitForFunction(() => !!document.getElementById('link-meteor-overlay'));
  await page.mouse.up(); await page.keyboard.up('Meta'); await sleep(100);
  assert.ok(Number.parseInt(await card(page).locator('.count').innerText()) >= 1);
  await clicks(page);
  await page.keyboard.press('Escape'); await sleep(50);
  assert.equal(await card(page).count(), 0);
  pass('Command-drag that starts on a link selects instead of dragging the link');

  // Editable targets never start a selection.
  await page.locator('#typing').scrollIntoViewIfNeeded();
  const typing = await page.locator('#typing').boundingBox();
  await page.keyboard.down('Meta'); await page.mouse.move(typing.x + 5, typing.y + 5); await page.mouse.down(); await page.mouse.move(typing.x + 80, typing.y + 60, {steps: 8}); await page.mouse.up(); await page.keyboard.up('Meta');
  await sleep(100);
  assert.equal(await card(page).count(), 0);
  await clicks(page);
  pass('A Command-drag that starts in a text field starts no selection');

  // content.configure turns it off at once, without a reload.
  await page.evaluate(() => scrollTo(0, 0));
  await page.evaluate(() => window.__stub.deliver({type: 'content.configure', holdKey: 'z', holdTrigger: 'modifier', enabled: false}));
  await page.keyboard.down('Meta'); await page.mouse.move(bib.x + 4, bib.y + 4); await page.mouse.down(); await page.mouse.move(bib.x + 200, bib.y + 120, {steps: 8}); await page.mouse.up(); await page.keyboard.up('Meta');
  await sleep(100);
  assert.equal(await card(page).count(), 0);
  assert.equal((await clicks(page)).length, 1, 'with hold-drag off, the drag ends in an ordinary click');
  await page.evaluate(() => window.__stub.deliver({type: 'content.configure', holdKey: 'q', holdTrigger: 'letter', enabled: true}));
  await page.keyboard.down('q'); await page.mouse.move(bib.x + 4, bib.y + 4); await page.mouse.down(); await page.mouse.move(bib.x + bib.width - 4, bib.y + bib.height - 4, {steps: 8}); await page.mouse.up(); await page.keyboard.up('q');
  await sleep(100);
  assert.equal(await card(page).locator('.count').innerText(), '5 links selected');
  assert.deepEqual(await clicks(page), []);
  pass('content.configure switches off, then to the letter Q, without a reload');

  /* The card: ticking, destination, shortcuts, actions. */
  const shadow = card(page);
  const boxes = shadow.locator('.preview input[type=checkbox]');
  assert.equal(await boxes.count(), 5);
  await boxes.nth(1).uncheck();
  assert.equal(await shadow.locator('.count').innerText(), '4 of 5 links selected');
  assert.equal(await shadow.locator('.open-label').innerText(), 'Open 3 in tabs', 'two ticked links share one PDF URL');
  await shadow.getByRole('button', {name: 'Copy text + URL', exact: true}).click();
  await page.waitForFunction(() => window.__stub.sent.some((m) => m.type === 'capture.copy'));
  let copy = (await sent(page, 'capture.copy')).at(-1);
  assert.equal(copy.links.length, 4); assert.equal(copy.format, 'tsv');
  assert.ok(!copy.links.some((link) => link.originalHref === '/papers/geometry.pdf?edition=2'));
  pass('Unticking a link in the preview leaves it out of every action', {sent: copy.links.length});

  // One-letter shortcuts work while focus is inside the card, and show in tooltips.
  const titles = await shadow.locator('button[data-key]').evaluateAll((buttons) => buttons.map((b) => [b.textContent.trim(), b.title, b.getAttribute('aria-keyshortcuts')]));
  assert.ok(titles.every(([, title, key]) => title.endsWith(`(${key})`)), JSON.stringify(titles));
  await shadow.locator('button.copy').focus();
  await page.keyboard.press('u');
  await page.waitForFunction(() => window.__stub.sent.filter((m) => m.type === 'capture.copy').length === 2);
  copy = (await sent(page, 'capture.copy')).at(-1);
  assert.equal(copy.format, 'text');
  await page.keyboard.press('k');
  await page.waitForFunction(() => window.__stub.sent.filter((m) => m.type === 'capture.copy').length === 3);
  assert.equal((await sent(page, 'capture.copy')).at(-1).format, 'markdown');
  await statusMatches(page, /Copied 4 Markdown links/);
  pass('Shortcuts U and K copy URLs and Markdown while focus is in the card', {shortcuts: titles.map(([, , key]) => key).join('')});

  // Typing in the page never triggers card shortcuts.
  const before = (await sent(page)).length;
  await page.locator('#typing').click();
  await page.keyboard.type('ucokd');
  await sleep(100);
  assert.equal((await sent(page)).length, before);
  assert.equal(await page.locator('#typing').inputValue(), 'ucokd');
  pass('Typing in the page does not trigger card shortcuts');

  // The More menu: opens, moves with arrow keys, and Escape closes only the menu.
  await shadow.locator('button.copy').focus();
  await page.keyboard.press('m');
  assert.equal(await shadow.locator('.menu').isVisible(), true);
  assert.equal(await shadow.locator('button.menu-toggle').getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.getElementById('link-meteor-overlay').shadowRoot.activeElement.className), 'm-group');
  await page.keyboard.press('Escape');
  assert.equal(await shadow.locator('.menu').isVisible(), false);
  assert.equal(await shadow.locator('.bar').isVisible(), true);
  const items = await shadow.locator('.menu [role=menuitem]').evaluateAll((list) => list.map((b) => b.firstChild.textContent));
  assert.deepEqual(items, ['Open in a new window', 'Open as a tab group', 'Copy URLs', 'Copy as Markdown', 'Download this selection', 'Bookmark this selection']);
  pass('The More menu lists six actions, moves with the arrow keys and closes on Escape', {items});

  // Destination picker on the "Adds to" line.
  assert.match(await shadow.locator('.dest').innerText(), /^Adds to My research/);
  await shadow.locator('.dest-change').click();
  await shadow.locator('.dest-select').selectOption('c2');
  assert.match(await shadow.locator('.dest').innerText(), /^Adds to Second collection/);
  await shadow.getByRole('button', {name: 'Add to collection', exact: true}).click();
  await page.waitForFunction(() => window.__stub.sent.some((m) => m.type === 'capture.commit'));
  const commit = (await sent(page, 'capture.commit')).at(-1);
  assert.equal(commit.collectionId, 'c2'); assert.equal(commit.links.length, 4);
  await statusMatches(page, /Saved 4 links to “Second collection”/);
  assert.match(await shadow.locator('.dest').innerText(), /^Saved to Second collection/);
  pass('The destination picker sends collectionId and the receipt names that collection');

  // Review after saving opens the full view at that capture.
  await shadow.getByRole('button', {name: 'Review', exact: true}).click();
  await page.waitForFunction(() => window.__stub.sent.some((m) => m.type === 'ui.open'));
  assert.deepEqual((await sent(page, 'ui.open')).at(-1), {type: 'ui.open', view: 'links', batchId: 'batch-1'});
  pass('Review after saving opens the full view at that capture (ui.open with view and batchId)');

  // Open N in tabs: 1 to 20 opens without a confirmation.
  await shadow.locator('button.open').click();
  await page.waitForFunction(() => window.__stub.sent.some((m) => m.type === 'capture.open'));
  const open = (await sent(page, 'capture.open')).at(-1);
  assert.equal(open.mode, 'tabs'); assert.equal(open.confirmed, false); assert.ok(open.requestId); assert.equal(open.collectionId, 'c2');
  await statusMatches(page, /Opened 3 links in new tabs/);
  pass('Open 3 in tabs opens at once, with no confirmation');

  // Download this selection saves through a link in the card.
  const downloading = page.waitForEvent('download');
  await shadow.locator('button.copy').focus(); await page.keyboard.press('d');
  const download = await downloading;
  assert.equal(download.suggestedFilename(), 'My-research_2026-09-26_1432.csv');
  assert.equal((await sent(page, 'capture.export')).at(-1).format, 'xlsx');
  pass('Download this selection saves the file name the background chose', {file: download.suggestedFilename()});

  // Bookmarking without access says so and offers the full view.
  await shadow.locator('button.copy').focus(); await page.keyboard.press('b');
  await page.waitForFunction(() => /Bookmark access is needed/.test(document.getElementById('link-meteor-overlay').shadowRoot.querySelector('.status').textContent));
  assert.equal(await shadow.getByRole('button', {name: 'Open the full view', exact: true}).isVisible(), true);
  await shadow.getByRole('button', {name: 'Open the full view', exact: true}).click();
  await page.waitForFunction(() => window.__stub.sent.filter((m) => m.type === 'ui.open').length === 2);
  assert.deepEqual((await sent(page, 'ui.open')).at(-1), {type: 'ui.open', view: 'export', batchId: 'batch-1'});
  pass('Bookmark without access explains it and offers the full view at the export panel');
  await page.keyboard.press('Escape'); await sleep(50);
  assert.equal(await card(page).count(), 0);

  /* Opening tiers on the card, with many links. */
  async function region(count) {
    await page.evaluate((count) => {
      document.body.innerHTML = `<div id="grid" style="display:grid;grid-template-columns:repeat(20,60px);gap:2px;padding:20px">${Array.from({length: count}, (_, i) => `<a href="/many/${i}" style="font:9px/12px sans-serif">L${i}</a>`).join('')}</div>`;
    }, count);
    const box = await page.locator('#grid').boundingBox();
    await page.keyboard.down('q'); await page.mouse.move(box.x + 2, box.y + 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height - 2, {steps: 6}); await page.mouse.up(); await page.keyboard.up('q');
    await page.waitForFunction((count) => document.getElementById('link-meteor-overlay')?.shadowRoot.querySelector('.count')?.textContent === `${count} links selected`, count);
  }
  await region(45);
  await shadow.locator('button.open').click();
  assert.equal(await shadow.locator('.confirm').isVisible(), true);
  assert.equal(await shadow.locator('.confirm-text').innerText(), 'Open 45 links in new tabs?');
  assert.deepEqual(await shadow.locator('.confirm button:visible').allInnerTexts(), ['Open 45', 'New window', 'Cancel']);
  const opensBefore = (await sent(page, 'capture.open')).length;
  await shadow.locator('.confirm-window').click();
  await page.waitForFunction((n) => window.__stub.sent.filter((m) => m.type === 'capture.open').length === n + 1, opensBefore);
  const confirmed = (await sent(page, 'capture.open')).at(-1);
  assert.equal(confirmed.mode, 'window'); assert.equal(confirmed.confirmed, true); assert.equal(confirmed.links.length, 45);
  pass('45 links: the card confirms (Open 45, New window, Cancel) before opening');
  await page.keyboard.press('Escape');

  await region(150);
  await shadow.locator('button.open').click();
  assert.match(await shadow.locator('.confirm-text').innerText(), /^Open 150 links in new tabs\? That is a lot of tabs at once/);
  assert.equal(await shadow.locator('.confirm').evaluate((el) => el.classList.contains('strong')), true);
  await page.keyboard.press('Escape');
  assert.equal(await shadow.locator('.confirm').isVisible(), false, 'Escape cancels the confirmation first');
  assert.equal(await shadow.locator('.bar').isVisible(), true);
  pass('150 links: stronger wording; Escape cancels only the confirmation');
  await page.keyboard.press('Escape');

  await region(520);
  const refused = (await sent(page, 'capture.open')).length;
  await shadow.locator('button.open').click();
  assert.match(await shadow.locator('.status').innerText(), /at most 500 links at a time, and 520 are ticked/);
  assert.equal((await sent(page, 'capture.open')).length, refused);
  pass('520 links: refused before anything is sent');
  await page.keyboard.press('Escape');

  // Progress and Cancel on the card.
  await page.evaluate(() => {
    const original = window.chrome.runtime.sendMessage;
    window.chrome.runtime.sendMessage = (message) => message.type === 'capture.open'
      ? new Promise((done) => { window.__finishOpen = (value) => done({ok: true, data: value}); window.__stub.sent.push(message); })
      : original(message);
  });
  await region(30);
  await shadow.locator('button.open').click(); await shadow.locator('.confirm-yes').click();
  await page.waitForFunction(() => !!window.__finishOpen);
  const requestId = (await sent(page, 'capture.open')).at(-1).requestId;
  await page.evaluate((requestId) => window.__stub.deliver({type: 'links.progress', requestId, opened: 10, failed: 0, total: 30}), requestId);
  assert.equal(await shadow.locator('.progress-text').innerText(), 'Opening 10 of 30 links…');
  await shadow.locator('.progress-cancel').click();
  await page.waitForFunction(() => window.__stub.sent.some((m) => m.type === 'links.cancel'));
  assert.equal((await sent(page, 'links.cancel')).at(-1).requestId, requestId);
  await page.evaluate(() => window.__finishOpen({opened: 10, failed: 0, cancelled: true}));
  await page.waitForFunction(() => /Stopped after opening 10 of 30 links/.test(document.getElementById('link-meteor-overlay').shadowRoot.querySelector('.status').textContent));
  pass('The card shows progress and cancels its own opening');
  await page.screenshot({path: resolve(evidence, 'access-content-card.png')});
  await page.keyboard.press('Escape');

  /* Ctrl elsewhere: a Windows platform uses Ctrl, and Command does nothing. */
  const windows = await context.newPage();
  await load(windows, '/index.html', {platform: 'Win32', trigger: 'modifier'});
  const wbib = await windows.locator('#bibliography').boundingBox();
  await windows.keyboard.down('Meta'); await windows.mouse.move(wbib.x + 4, wbib.y + 4); await windows.mouse.down(); await windows.mouse.move(wbib.x + 200, wbib.y + 150, {steps: 8}); await windows.mouse.up(); await windows.keyboard.up('Meta');
  await sleep(100);
  assert.equal(await card(windows).count(), 0);
  await windows.keyboard.down('Control'); await windows.mouse.move(wbib.x + 4, wbib.y + 4); await windows.mouse.down(); await windows.mouse.move(wbib.x + wbib.width - 4, wbib.y + wbib.height - 4, {steps: 12}); await windows.mouse.up(); await windows.keyboard.up('Control');
  await windows.waitForFunction(() => document.getElementById('link-meteor-overlay')?.shadowRoot.querySelector('.count')?.textContent === '5 links selected');
  pass('On Windows and Linux the modifier is Ctrl, not Command');

  result.result = 'PASS';
} catch (error) {
  result.result = 'FAIL'; result.error = error.stack; console.error(error); process.exitCode = 1;
} finally {
  await browser.close(); await fixture.close();
  result.finished = new Date().toISOString();
  await writeFile(resolve(evidence, 'access-content-results.json'), JSON.stringify(result, null, 2) + '\n');
}
