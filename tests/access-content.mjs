// SIMULATION: the real content script (src/content/capture.js) loaded into ordinary pages of the
// local fixture server in Chrome for Testing, with a stub `chrome` object standing in for the
// extension. Pointer, keyboard and click events are real browser input; every Link Meteor message
// is answered by the stub, so this checks the page script's own behavior, not the background.
// 0.4.0: After a drag (card, copy in every format, add with Undo), the notice, content links only
// with Include them, the filters, already saved, Skip saved and rich copy on the clipboard.
// Writes access-content-results.json to LINK_METEOR_EVIDENCE_DIR (default .scratch/evidence-access-capture).
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromePath, fixtureServer, headlessArgs, playwright, root} from './helpers/browser.mjs';
import {cardTheme} from '../src/core/themes.js';

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
    let listener = null, batches = 0, lastAdd = {};
    const collections = [{id: 'c1', name: 'My research', count: 0}, {id: 'c2', name: 'Second collection', count: 3}];
    // URLs each collection already holds (0.4.0: capture.saved and skipSaved), set by the checks.
    const held = {c1: [], c2: []};
    const reply = (message) => {
      switch (message.type) {
        case 'settings.get': return {holdKey: key, holdTrigger: trigger, holdScope: 'all', holdOrigins: [], holdExceptions: []};
        case 'collections.list': return {activeCollectionId: 'c1', collections};
        case 'collection.active': return {name: 'My research', count: 0};
        case 'capture.saved': return {saved: [...new Set(message.urls)].filter((url) => held[message.collectionId || 'c1'].includes(url))};
        case 'capture.commit': {
          const id = message.collectionId || 'c1', batchId = 'batch-' + ++batches;
          const kept = message.skipSaved ? message.links.filter((link) => !held[id].includes(link.url)) : message.links;
          const links = kept.map((link, i) => ({...link, id: 'saved-' + i, batchId}));
          lastAdd = window.__stub.lastAdd = {batchId, collectionId: id, count: links.length};
          return {state: {activeCollectionId: 'c1', collections: collections.map(c => ({...c, links: c.id === id ? links : []}))}, count: links.length, skipped: message.links.length - kept.length, batchId: links.length ? batchId : '', collectionId: id, warning: ''};
        }
        case 'capture.undoAdd': {
          if (window.__stub.refuseUndo) throw new Error('These links changed since they were added, so Undo is no longer possible. Remove them in the full view instead.');
          if (message.batchId !== lastAdd.batchId || message.collectionId !== lastAdd.collectionId) throw new Error('Unknown add');
          return {count: lastAdd.count};
        }
        case 'capture.preference': return {contentOnly: message.contentOnly ?? true, skipSaved: message.skipSaved ?? false};
        case 'capture.copy': return message.format === 'rich'
          ? {html: `<ul>${message.links.map((link) => `<li><a href="${link.url}">${link.anchorText || link.url}</a></li>`).join('')}</ul>`, text: message.links.map((link) => link.anchorText ? `${link.anchorText} (${link.url})` : link.url).join('\n')}
          : {text: message.links.map(link => link.url).join('\n')};
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
      storage: {onChanged: {addListener() {}, removeListener() {}}},
    };
    window.chrome = chrome; // writable, not configurable
    window.__stub = {sent, clicks, downs, held, deliver: (message) => listener?.(message)};
    // Page listeners in the bubble phase: they see what the page would see.
    document.addEventListener('click', (event) => { clicks.push({target: event.target.id || event.target.tagName, meta: event.metaKey, ctrl: event.ctrlKey, prevented: event.defaultPrevented}); if (event.target.closest?.('a')) event.preventDefault(); });
    document.addEventListener('pointerdown', (event) => { downs.push({target: event.target.id || event.target.tagName, prevented: event.defaultPrevented}); });
  };
  return {init, arg: {platform, trigger, key}};
}

const fixture = await fixtureServer();
const browser = await playwright.chromium.launch({executablePath: chromePath(), headless: true, args: headlessArgs()});
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
  await statusMatches(page, /^Copied anchor text and URL/);
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
  await statusMatches(page, /^Copied 4 URLs, one per line/);
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
  assert.deepEqual(items, ['Open in a new window', 'Open as a tab group', 'Copy URLs', 'Copy as Markdown', 'Copy as rich links', 'Download this selection', 'Bookmark this selection']);
  pass('The More menu lists seven actions, moves with the arrow keys and closes on Escape', {items});

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

  /* 0.4.0: content links only, filters, already saved, Skip saved, rich copy, and After a drag. */
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {origin: fixture.base});
  await page.bringToFront();
  const CAPTURE = {afterDrag: 'card', afterDragFormat: 'tsv', contentOnly: false, skipSaved: false};
  const configure = (capture, card) => page.evaluate(([capture, card]) => window.__stub.deliver({type: 'content.configure', holdKey: 'q', holdTrigger: 'letter', enabled: true, capture, ...(card ? {card} : {})}), [capture, card]);
  const inCard = (fn, arg) => page.evaluate(([source, arg]) => new Function('root', 'arg', `return (${source})(root, arg)`)(document.getElementById('link-meteor-overlay')?.shadowRoot, arg), [fn.toString(), arg]);
  const cardText = (selector) => inCard((root, selector) => root?.querySelector(selector)?.textContent ?? null, selector);
  const cardWait = (fn, arg) => page.waitForFunction(([source, arg]) => { const root = document.getElementById('link-meteor-overlay')?.shadowRoot; return !!root && new Function('root', 'arg', `return (${source})(root, arg)`)(root, arg); }, [fn.toString(), arg]);
  const rowState = () => inCard((root) => [...root.querySelectorAll('.preview li')].map((li) => ({text: li.querySelector('.t').textContent, on: li.querySelector('input').checked, saved: !li.querySelector('.tag').hidden})));
  const ticked = async () => (await rowState()).filter((row) => row.on).map((row) => row.text);
  const clipboard = () => page.evaluate(async () => { const [item] = await navigator.clipboard.read(); const read = async (type) => item.types.includes(type) ? (await (await item.getType(type)).text()).replace(/\r\n/g, '\n') : ''; return {types: item.types, html: await read('text/html'), text: await read('text/plain')}; }); // Windows keeps CRLF on the clipboard
  const noticeShown = () => inCard((root) => !!root && !root.querySelector('.notice').hidden);
  // A page with links in every kind of page chrome, including an open shadow root and a same-origin frame.
  async function landmarks() {
    await page.evaluate(() => {
      document.body.innerHTML = `<div id="landmarks" style="width:760px;padding:16px;font:14px/22px sans-serif">
        <header><a href="/home">Home</a> · <a href="https://www.example.org/about">About us</a></header>
        <nav><a href="/section/1">Section one</a> · <a href="/section/2">Section two</a> · <span id="nav-host"></span></nav>
        <main><p><a href="/papers/one.pdf">Paper one</a> · <a href="/papers/two.PDF?copy=1">Paper two</a> · <a href="https://other.example/report.pdf">Other report</a></p>
        <p><a href="https://other.example/article">Other article</a> · <a href="/local/page">Local page</a> · <a href="mailto:lab@example.org">Email the lab</a></p>
        <article><div role="navigation"><a href="/contents">Contents</a></div></article></main>
        <aside><a href="/related">Related</a><br><iframe id="aside-frame" src="/frame.html" style="width:320px;height:70px;border:0"></iframe></aside>
        <div role="contentinfo"><a href="/legal">Legal</a></div>
        <footer><a href="/contact">Contact</a></footer></div>`;
      document.getElementById('nav-host').attachShadow({mode: 'open'}).innerHTML = '<a href="/shadowed">Shadow link</a>';
      scrollTo(0, 0);
    });
    await page.waitForFunction(() => document.getElementById('aside-frame').contentDocument?.getElementById('frame-link'));
  }
  async function dragLandmarks() {
    const box = await page.locator('#landmarks').boundingBox();
    await page.keyboard.down('q'); await page.mouse.move(box.x + 2, box.y + 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height - 2, {steps: 6}); await page.mouse.up(); await page.keyboard.up('q');
  }
  const CHROME_LINKS = ['Home', 'About us', 'Section one', 'Section two', 'Shadow link', 'Contents', 'Related', 'Source inside a frame', 'Legal', 'Contact'];
  const CONTENT_LINKS = ['Paper one', 'Paper two', 'Other report', 'Other article', 'Local page', 'Email the lab'];
  await landmarks();
  await page.evaluate((base) => { window.__stub.held.c1 = [base + '/papers/one.pdf', base + '/local/page']; window.__stub.held.c2 = ['https://other.example/article']; }, fixture.base);
  await configure({...CAPTURE, contentOnly: true});

  // Content links only: page chrome starts unticked, with a count and Include them.
  await dragLandmarks();
  await cardWait((root) => root.querySelector('.count')?.textContent === '6 of 16 links selected');
  let rows = await rowState();
  assert.deepEqual(rows.filter((row) => row.on).map((row) => row.text), CONTENT_LINKS);
  assert.deepEqual(rows.filter((row) => !row.on).map((row) => row.text), CHROME_LINKS);
  assert.equal(await cardText('.leftout-text'), 'Left out 10 navigation links.');
  assert.equal(await shadow.getByRole('button', {name: 'Include them', exact: true}).isVisible(), true);
  pass('Content links only: header, nav (with its shadow root), role=navigation, aside (with its same-origin frame), contentinfo and footer links start unticked, and the card says how many', {leftOut: CHROME_LINKS.length});

  // Already saved: asked when the card opens (the remembered destination, Second collection), and again when the destination changes.
  await cardWait((root) => [...root.querySelectorAll('.preview .tag')].some((tag) => !tag.hidden));
  let check = (await sent(page, 'capture.saved')).at(-1);
  assert.equal(check.collectionId, 'c2'); assert.equal(check.urls.length, 16);
  assert.deepEqual((await rowState()).filter((row) => row.saved).map((row) => row.text), ['Other article']);
  assert.equal(await cardText('.skip-text'), 'Skip the link already saved');
  assert.equal(await shadow.locator('.skip-saved').isChecked(), false, 'Skip saved starts from the skipSaved setting (off)');
  await shadow.locator('.dest-change').click();
  await shadow.locator('.dest-select').selectOption('c1');
  await cardWait((root) => [...root.querySelectorAll('.preview li')].filter((li) => !li.querySelector('.tag').hidden).length === 2);
  check = (await sent(page, 'capture.saved')).at(-1);
  assert.equal(check.collectionId, 'c1');
  assert.deepEqual((await rowState()).filter((row) => row.saved).map((row) => row.text), ['Paper one', 'Local page']);
  assert.equal(await cardText('.skip-text'), 'Skip the 2 links already saved');
  assert.equal(await shadow.locator('.preview li').filter({hasText: 'Paper one'}).locator('.tag').innerText(), 'Saved', 'marked with text, not only color');
  pass('Already saved: capture.saved is asked for the destination when the card opens and when it changes; matching rows say Saved', {checks: (await sent(page, 'capture.saved')).length});

  // Include them ticks the navigation links again and offers to remember the choice.
  await shadow.getByRole('button', {name: 'Include them', exact: true}).click();
  assert.equal(await cardText('.count'), '16 links selected');
  assert.equal(await cardText('.leftout-text'), 'Included 10 navigation links.');
  assert.equal(await inCard((root) => root.activeElement?.textContent), 'Always include them', 'focus moves to the offer');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__stub.sent.some((m) => m.type === 'capture.preference'));
  assert.deepEqual((await sent(page, 'capture.preference')).at(-1), {type: 'capture.preference', contentOnly: false});
  await cardWait((root) => /^From now on, navigation links are included/.test(root.querySelector('.leftout-text').textContent));
  pass('Include them ticks the 10 navigation links again; Always include them saves only contentOnly: false (capture.preference)');

  // Filters: chips above the preview, with state shown by aria-pressed and a check mark, by mouse and keyboard.
  const chips = await inCard((root) => [...root.querySelectorAll('.chips button')].map((chip) => [chip.textContent, chip.getAttribute('aria-pressed')]));
  assert.deepEqual(chips, [['All', 'true'], ['Other sites', 'false'], ['PDFs', 'false'], ['Same site', 'false']]);
  assert.ok(await inCard((root) => root.querySelector('.chips').compareDocumentPosition(root.querySelector('.preview')) & Node.DOCUMENT_POSITION_FOLLOWING), 'chips sit above the preview');
  const chip = (name) => shadow.locator('.chips button').filter({hasText: new RegExp(`^${name}$`)});
  await chip('PDFs').click();
  assert.deepEqual(await ticked(), ['Paper one', 'Paper two', 'Other report']);
  assert.equal(await cardText('.count'), '3 of 16 links selected');
  const marks = await inCard((root) => [...root.querySelectorAll('.chips button')].map((chip) => [chip.getAttribute('aria-pressed'), getComputedStyle(chip.querySelector('svg')).display]));
  assert.deepEqual(marks, [['false', 'none'], ['false', 'none'], ['true', 'block'], ['false', 'none']], 'the chosen chip shows a check mark as well as its color');
  await chip('Other sites').click();
  assert.deepEqual(await ticked(), ['About us', 'Other report', 'Other article']);
  await chip('Same site').focus(); await page.keyboard.press('Enter');
  assert.deepEqual(await ticked(), ['Home', 'Section one', 'Section two', 'Shadow link', 'Paper one', 'Paper two', 'Local page', 'Contents', 'Related', 'Source inside a frame', 'Legal', 'Contact']);
  assert.equal(await chip('Same site').getAttribute('aria-pressed'), 'true');
  await shadow.locator('.preview li').filter({hasText: 'Home'}).locator('input').uncheck();
  assert.equal(await cardText('.count'), '11 of 16 links selected');
  await chip('All').focus(); await page.keyboard.press('Space');
  assert.equal(await cardText('.count'), '15 of 16 links selected', 'All ticks what the filters unticked, not what was unticked by hand');
  assert.deepEqual((await rowState()).filter((row) => !row.on).map((row) => row.text), ['Home']);
  await chip('PDFs').click(); await chip('PDFs').click();
  assert.equal(await chip('All').getAttribute('aria-pressed'), 'true', 'choosing a filter again goes back to All');
  assert.equal(await cardText('.count'), '15 of 16 links selected');
  await shadow.locator('.preview li').filter({hasText: 'Home'}).locator('input').check();
  await chip('PDFs').click(); await page.mouse.move(5, 5); await sleep(400);
  await page.screenshot({path: resolve(evidence, 'access-content-card-filters.png')});
  await chip('All').click();
  pass('Filters All, Other sites, PDFs and Same site untick what doesn’t match; All ticks those again; keyboard and aria-pressed work', {chips: chips.map(([name]) => name)});

  // Skip saved: the card's own choice, with an offer to make it the default.
  assert.equal(await shadow.locator('.skip-remember').isVisible(), false);
  await shadow.locator('.skip-saved').check();
  assert.equal(await shadow.locator('.skip-remember').isVisible(), true);
  await shadow.locator('.skip-remember').click();
  await page.waitForFunction(() => window.__stub.sent.filter((m) => m.type === 'capture.preference').length === 2);
  assert.deepEqual((await sent(page, 'capture.preference')).at(-1), {type: 'capture.preference', skipSaved: true});
  await statusMatches(page, /^From now on, links already saved are skipped when adding/);
  assert.equal(await shadow.locator('.skip-remember').isVisible(), false);
  pass('Skip saved starts from the setting; Make this the default saves only skipSaved (capture.preference)');

  // Rich copy on the card: More menu and the L shortcut; HTML and plain text on the clipboard.
  await shadow.locator('button.copy').focus();
  await page.keyboard.press('l');
  await statusMatches(page, /^Copied 16 links as rich links\. Paste into Google Docs, Word or Notion/);
  assert.equal((await sent(page, 'capture.copy')).at(-1).format, 'rich');
  let copied = await clipboard();
  assert.ok(copied.types.includes('text/html') && copied.types.includes('text/plain'), JSON.stringify(copied.types));
  assert.match(copied.html, new RegExp(`<a href="${fixture.base}/papers/one\\.pdf">Paper one</a>`));
  assert.match(copied.text, new RegExp(`^Home \\(${fixture.base}/home\\)\\n`));
  await page.evaluate(() => navigator.clipboard.writeText('reset'));
  const clearStatus = () => inCard((root) => { root.querySelector('.status').textContent = ''; });
  await clearStatus();
  await shadow.locator('button.menu-toggle').click();
  await shadow.getByRole('menuitem', {name: /^Copy as rich links/}).click();
  await page.waitForFunction(() => window.__stub.sent.filter((m) => m.type === 'capture.copy' && m.format === 'rich').length === 2);
  await statusMatches(page, /^Copied 16 links as rich links/);
  assert.match((await clipboard()).html, /Other article<\/a>/);
  // Where the async clipboard is unavailable (a plain-HTTP page), a copy event still carries both types.
  await page.evaluate(() => { window.__write = navigator.clipboard.write; navigator.clipboard.write = () => Promise.reject(new Error('unavailable')); return navigator.clipboard.writeText('reset'); });
  await clearStatus();
  await shadow.locator('button.copy').focus(); await page.keyboard.press('l');
  await page.waitForFunction(() => window.__stub.sent.filter((m) => m.type === 'capture.copy' && m.format === 'rich').length === 3);
  await statusMatches(page, /^Copied 16 links as rich links/);
  copied = await clipboard();
  assert.match(copied.html, /Paper two<\/a>/); assert.match(copied.text, /^Home \(/);
  await page.evaluate(() => { navigator.clipboard.write = window.__write; });
  pass('Copy as rich links (More menu and L) puts HTML and plain text on the clipboard, also through the copy-event fallback', {types: copied.types});

  // Adding with Skip saved sends skipSaved and says how many were skipped.
  await shadow.getByRole('button', {name: 'Add to collection', exact: true}).click();
  await statusMatches(page, /^Added 14 links to “My research”; 2 were already saved\.$/);
  const skippedCommit = (await sent(page, 'capture.commit')).at(-1);
  assert.equal(skippedCommit.skipSaved, true); assert.equal(skippedCommit.collectionId, 'c1'); assert.equal(skippedCommit.links.length, 16);
  assert.equal(await shadow.locator('.skip').isVisible(), false, 'Skip saved hides once the links are added');
  pass('Skip saved: capture.commit gets skipSaved, and the receipt says “Added 14 links …; 2 were already saved”');
  await page.keyboard.press('Escape');

  // The notice follows the card theme: an Ember light card from content.configure.
  const ember = cardTheme('ember', 'light');
  await configure({...CAPTURE, afterDrag: 'copy', contentOnly: true}, ember);

  // After a drag: copy right away, with a notice.
  await dragLandmarks();
  await cardWait((root) => /^Copied/.test(root.querySelector('.notice-text').textContent));
  assert.equal(await cardText('.notice-text'), 'Copied 6 links as a table. Left out 10 navigation links.');
  assert.equal(await inCard((root) => getComputedStyle(root.querySelector('.bar')).display), 'none', 'no card');
  let copyRequest = (await sent(page, 'capture.copy')).at(-1);
  assert.equal(copyRequest.format, 'tsv'); assert.deepEqual(copyRequest.links.map((link) => link.anchorText), CONTENT_LINKS);
  assert.equal((await clipboard()).text, copyRequest.links.map((link) => link.url).join('\n'));
  assert.deepEqual(await inCard((root) => [...root.querySelectorAll('.notice button')].filter((b) => !b.hidden).map((b) => b.getAttribute('aria-label') || b.textContent)), ['Show links', 'Close notice']);
  await sleep(400); await page.screenshot({path: resolve(evidence, 'access-content-notice-ember-light.png')});
  const themed = await inCard((root) => [getComputedStyle(root.querySelector('.notice')).backgroundColor, getComputedStyle(root.querySelector('.notice-text')).color]);
  const resolved = await page.evaluate((colors) => colors.map((color) => { const probe = document.createElement('i'); probe.style.color = color; document.body.append(probe); const value = getComputedStyle(probe).color; probe.remove(); return value; }), [ember.light['--k-ground'], ember.light['--k-strong']]);
  assert.deepEqual(themed, resolved, 'the notice uses the card roles --k-ground and --k-strong');
  await shadow.getByRole('button', {name: 'Show links', exact: true}).click();
  assert.equal(await shadow.locator('.bar').isVisible(), true);
  assert.equal(await shadow.locator('.notice').isVisible(), false);
  assert.equal(await cardText('.count'), '6 of 16 links selected', 'Show links opens the card with the same links');
  assert.equal(await cardText('.leftout-text'), 'Left out 10 navigation links.');
  assert.equal(await inCard((root) => root.activeElement?.className), 'copy primary');
  await page.keyboard.press('Escape');
  assert.equal(await card(page).count(), 0);
  pass('After a drag, copy: copies the content links as a table at once; the notice is themed like the card (Ember light), and Show links opens the card with the same links', {notice: themed});

  for (const [format, as] of [['text', 'as URLs'], ['markdown', 'as Markdown'], ['rich', 'as rich links']]) {
    await configure({...CAPTURE, afterDrag: 'copy', afterDragFormat: format, contentOnly: true});
    const before = (await sent(page, 'capture.copy')).length;
    await dragLandmarks();
    await page.waitForFunction((n) => window.__stub.sent.filter((m) => m.type === 'capture.copy').length === n + 1, before);
    await cardWait((root, as) => root.querySelector('.notice-text').textContent.includes(as), as);
    assert.equal(await cardText('.notice-text'), `Copied 6 links ${as}. Left out 10 navigation links.`);
    assert.equal((await sent(page, 'capture.copy')).at(-1).format, format);
    if (format === 'rich') assert.match((await clipboard()).html, /<a href="[^"]+\/papers\/one\.pdf">Paper one<\/a>/);
    if (format === 'markdown') { await shadow.getByRole('button', {name: 'Close notice', exact: true}).click(); assert.equal(await card(page).count(), 0); }
    else { await page.keyboard.press('Escape'); assert.equal(await card(page).count(), 0, 'Escape closes the notice'); }
  }
  pass('After a drag, copy in every format (URLs, Markdown, rich links); the close button and Escape close the notice');

  // The notice closes itself after about 8 seconds, unless it has focus; a new drag replaces it.
  await configure({...CAPTURE, afterDrag: 'copy'});
  await dragLandmarks();
  await page.waitForFunction(() => /^Copied 16 links as a table\.$/.test(document.getElementById('link-meteor-overlay')?.shadowRoot.querySelector('.notice-text')?.textContent || ''));
  const shown = Date.now();
  await page.waitForFunction(() => !document.getElementById('link-meteor-overlay'), null, {timeout: 12000});
  const lasted = Date.now() - shown;
  assert.ok(lasted >= 7000 && lasted < 10000, `closed after ${lasted} ms`);
  await dragLandmarks();
  await cardWait((root) => /^Copied/.test(root.querySelector('.notice-text').textContent));
  await inCard((root) => root.querySelector('.notice-show').focus());
  const copies = (await sent(page, 'capture.copy')).length;
  await dragLandmarks();
  await page.waitForFunction((n) => window.__stub.sent.filter((m) => m.type === 'capture.copy').length === n + 1, copies);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#link-meteor-overlay').length), 1, 'a new drag replaces the notice');
  await cardWait((root) => /^Copied/.test(root.querySelector('.notice-text').textContent));
  await inCard((root) => root.querySelector('.notice-show').focus());
  await sleep(9000);
  assert.equal(await noticeShown(), true, 'still open after 9 seconds with focus');
  await page.keyboard.press('Escape');
  assert.equal(await card(page).count(), 0);
  pass('The notice closes itself after about 8 seconds, stays while it has focus, and a new drag replaces it', {closedAfterMs: lasted});

  // After a drag: add right away, with Undo and Show links.
  await configure({...CAPTURE, afterDrag: 'add', skipSaved: true});
  await dragLandmarks();
  await cardWait((root) => /^Added/.test(root.querySelector('.notice-text').textContent));
  assert.equal(await cardText('.notice-text'), 'Added 14 links to “My research”; 2 were already saved.');
  const quickCommit = (await sent(page, 'capture.commit')).at(-1);
  assert.equal(quickCommit.skipSaved, true); assert.equal(quickCommit.collectionId, 'c1'); assert.equal(quickCommit.links.length, 16);
  assert.deepEqual(await inCard((root) => [...root.querySelectorAll('.notice button')].filter((b) => !b.hidden).map((b) => b.getAttribute('aria-label') || b.textContent)), ['Undo', 'Show links', 'Close notice']);
  await shadow.getByRole('button', {name: 'Undo', exact: true}).click();
  await cardWait((root) => /^Removed/.test(root.querySelector('.notice-text').textContent));
  assert.equal(await cardText('.notice-text'), 'Removed 14 links from “My research”.');
  const added = await page.evaluate(() => window.__stub.lastAdd);
  assert.deepEqual((await sent(page, 'capture.undoAdd')).at(-1), {type: 'capture.undoAdd', collectionId: 'c1', batchId: added.batchId}, 'Undo names the batch that add created');
  assert.equal(await shadow.locator('.notice-undo').isVisible(), false);
  assert.equal(await inCard((root) => root.activeElement?.textContent), 'Show links', 'focus moves from Undo to Show links');
  await page.keyboard.press('Enter');
  assert.equal(await shadow.locator('.bar').isVisible(), true);
  assert.equal(await shadow.getByRole('button', {name: 'Add to collection', exact: true}).isEnabled(), true, 'after Undo the card can add again');
  assert.match(await shadow.locator('.dest').innerText(), /^Adds to My research/);
  await page.keyboard.press('Escape');
  pass('After a drag, add: commits at once with skipSaved; the notice has Undo (capture.undoAdd) and Show links; after Undo the card can add again');

  // Undo from the card after Show links, and a refused Undo explains itself.
  await configure({...CAPTURE, afterDrag: 'add'});
  await dragLandmarks();
  await cardWait((root) => /^Added 16 links to “My research”\.$/.test(root.querySelector('.notice-text').textContent));
  await shadow.getByRole('button', {name: 'Show links', exact: true}).click();
  assert.match(await cardText('.status'), /^Added 16 links to “My research”\.Undo$/);
  assert.match(await shadow.locator('.dest').innerText(), /^Saved to My research/);
  const undos = (await sent(page, 'capture.undoAdd')).length;
  await shadow.locator('.status button').click();
  await statusMatches(page, /^Removed 16 links from “My research”\.$/);
  assert.equal((await sent(page, 'capture.undoAdd')).length, undos + 1);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.__stub.refuseUndo = true; });
  await dragLandmarks();
  await cardWait((root) => /^Added/.test(root.querySelector('.notice-text').textContent));
  await shadow.getByRole('button', {name: 'Undo', exact: true}).click();
  await cardWait((root) => /changed since they were added/.test(root.querySelector('.notice-text').textContent));
  assert.equal(await shadow.locator('.notice-undo').isVisible(), false);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.__stub.refuseUndo = false; });
  await configure(CAPTURE);
  pass('Undo also works from the card after Show links; a refused Undo says why in the notice');

  /* Page chrome is judged like HTML's landmarks: a header or footer counts only at page level. */
  const articlePage = await context.newPage();
  await load(articlePage, '/index.html', {platform: 'MacIntel', trigger: 'modifier'});
  const chromeFlags = await articlePage.evaluate(() => {
    document.body.innerHTML = `<header><a href="/site">Site home</a></header>
      <main><article><header><h1><a href="/post">Post title</a></h1></header><p><a href="/cited">Cited paper</a></p><footer><a href="/tags">Post tags</a></footer></article>
      <section><header><a href="/section-top">Section top</a></header></section></main>
      <footer><a href="/about">About the site</a></footer>`;
    return Object.fromEntries(globalThis.__linkMeteor.scan().links.map((link) => [new URL(link.url).pathname, !!link.pageChrome]));
  });
  assert.deepEqual(chromeFlags, {'/site': true, '/post': false, '/cited': false, '/tags': false, '/section-top': false, '/about': true});
  await articlePage.close();
  pass('Content links only keeps a post’s own header and footer links: only page-level headers and footers are page chrome', chromeFlags);

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
