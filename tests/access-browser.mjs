// Access and capture (0.3.0), and the capture card's 0.4.0 messages end to end (already saved, Skip
// saved, Undo after adding right away, the rich copy payload, content links only on Capture this
// page), and saving tabs as links (0.4.0 release candidate 2), and 0.5.0's context snippets and page
// citations (Capture this page, a region, saveContext off, and Save tabs as links without site
// access), on the loaded extension, with no optional grants: Chrome for Testing,
// headless, in a fresh temporary profile under .scratch/ (deleted afterwards), the real unpacked
// build, and Chrome's own toolbar action through tests/helpers/action.mjs for temporary page
// access. The workbench in its own window stands in for the side panel. Native permission prompts
// are never shown: where a check needs Chrome's answer, the workbench's chrome.permissions.request
// is replaced by a stub that declines, and the result says "simulated decline".
// Usage: npm run build, then LINK_METEOR_FIXTURE_PORT=52481 node tests/access-browser.mjs
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixtureServer, root, scratch} from './helpers/browser.mjs';
import {launchWithAction} from './helpers/action.mjs';
import {THEMES} from '../src/core/themes.js';

const evidence = resolve(root, process.env.LINK_METEOR_EVIDENCE_DIR || '.scratch/evidence-access-capture');
const result = {started: new Date().toISOString(), browser: 'Chrome for Testing, headless, fresh temporary profile, real unpacked extension, no optional grants', checks: []};
const pass = (name, data = {}) => { result.checks.push({name, ...data}); console.log('PASS', name, Object.keys(data).length ? JSON.stringify(data) : ''); };
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
await mkdir(evidence, {recursive: true});
const browser = await launchWithAction({profilePrefix: 'access-profile-'});
const fixture = await fixtureServer();
const siteB = fixture.base.replace('127.0.0.1', 'localhost');
const downloads = await mkdtemp(resolve(scratch, 'access-downloads-'));

/* A small DevTools-protocol toolkit over the pipe. */
const js = (session, expression) => browser.evaluate(session, expression);
async function until(fn, message, timeout = 8000) {
  const start = Date.now(); let last;
  while (Date.now() - start < timeout) { last = await fn(); if (last) return last; await sleep(60); }
  throw new Error(`${message} (timed out; last: ${JSON.stringify(last)})`);
}
const pages = async () => (await browser.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'page');
// Tabs opened since the snapshot `before`, by identity, so tabs still closing from an earlier
// step can't make the count wrong.
const newPages = async (before) => { const keep = new Set(before.map((t) => t.targetId)); return (await pages()).filter((t) => !keep.has(t.targetId)); };
async function closeOpened(before) {
  const closing = await newPages(before);
  for (const target of closing) await browser.send('Target.closeTarget', {targetId: target.targetId}).catch(() => {});
  // Wait until Chrome has really closed them, so the next step starts from a settled tab list.
  const ids = new Set(closing.map((t) => t.targetId));
  for (const start = Date.now(); Date.now() - start < 10000 && (await pages()).some((t) => ids.has(t.targetId));) await sleep(100);
}
async function mouse(session, type, x, y, {buttons = 0, modifiers = 0} = {}) {
  await browser.send('Input.dispatchMouseEvent', {type, x, y, button: type === 'mouseMoved' ? (buttons ? 'left' : 'none') : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1, modifiers}, session);
}
async function drag(session, from, to, {steps = 12, modifiers = 0} = {}) {
  await mouse(session, 'mouseMoved', from.x, from.y, {modifiers});
  await mouse(session, 'mousePressed', from.x, from.y, {buttons: 1, modifiers});
  for (let i = 1; i <= steps; i++) await mouse(session, 'mouseMoved', from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps, {buttons: 1, modifiers});
  await sleep(80);
  await mouse(session, 'mouseReleased', to.x, to.y, {modifiers});
}
async function key(session, key, code = key.length === 1 ? `Key${key.toUpperCase()}` : key) {
  const vk = key.length === 1 ? key.toUpperCase().charCodeAt(0) : {Enter: 13, Tab: 9, Escape: 27}[key];
  await browser.send('Input.dispatchKeyEvent', {type: 'keyDown', key, code, windowsVirtualKeyCode: vk, ...(key.length === 1 ? {text: key} : key === 'Enter' ? {text: '\r'} : {})}, session);
  await browser.send('Input.dispatchKeyEvent', {type: 'keyUp', key, code, windowsVirtualKeyCode: vk}, session);
}
async function shot(session, name) {
  const {data} = await browser.send('Page.captureScreenshot', {format: 'png'}, session);
  await writeFile(resolve(evidence, name), Buffer.from(data, 'base64'));
}
async function width(session, w, h = 900) {
  await browser.send('Emulation.setDeviceMetricsOverride', {width: w, height: h, deviceScaleFactor: 1, mobile: false}, session);
  await sleep(250);
}
const card = (expr) => `document.getElementById('link-meteor-overlay')?.shadowRoot${expr}`;

try {
  // Nothing opens at install: only the startup blank page exists before this suite opens anything.
  await sleep(1200);
  const atInstall = (await pages()).map((t) => t.url);
  assert.deepEqual(atInstall.filter((url) => url !== 'about:blank'), [], `pages at install: ${atInstall}`);
  pass('Nothing opens a tab at install', {pages: atInstall});

  await browser.send('Browser.setDownloadBehavior', {behavior: 'allow', downloadPath: downloads, eventsEnabled: true});
  const {targetId: pageTarget} = await browser.newTab(`${fixture.base}/index.html`);
  const page = await browser.attach(pageTarget);
  await width(page, 1280, 1000);
  await sleep(1200);
  const {targetId: uiTarget} = await browser.newWindow(browser.extensionUrl());
  let ui = await browser.attach(uiTarget);
  await until(() => js(ui, `!!document.getElementById('collection-heading') && !!window.chrome?.runtime`), 'workbench loaded');
  await sleep(600);
  const rpc = (message) => js(ui, `chrome.runtime.sendMessage(${JSON.stringify(message)}).then((r) => { if (!r?.ok) throw new Error(r?.error || 'no response'); return r.data; })`);
  const rpcError = (message) => js(ui, `chrome.runtime.sendMessage(${JSON.stringify(message)}).then((r) => r.ok ? '' : r.error)`);
  const state = () => rpc({type: 'state.get'});
  const click = (id) => js(ui, `document.getElementById(${JSON.stringify(id)}).click()`);
  const text = (id) => js(ui, `document.getElementById(${JSON.stringify(id)}).innerText`);
  const visible = (id) => js(ui, `!document.getElementById(${JSON.stringify(id)}).closest('[hidden]') && document.getElementById(${JSON.stringify(id)}).getClientRects().length > 0`);
  // Stands in for Chrome's prompt: records each request and declines it (simulated decline).
  const declinePrompts = () => js(ui, `(() => { window.__requests = []; chrome.permissions.request = async (request) => { window.__requests.push(request); return false; }; return true; })()`);
  await declinePrompts();

  /* 1. Welcome card. */
  assert.equal((await state()).settings.welcomeSeen, false);
  assert.equal(await visible('welcome'), true);
  assert.equal(await text('welcome-allow'), 'Allow on all sites (recommended)');
  assert.equal(await text('welcome-later'), 'Choose sites later');
  await width(ui, 320);
  assert.equal(await js(ui, 'document.documentElement.scrollWidth > innerWidth'), false);
  await shot(ui, 'access-welcome-320.png');
  await js(ui, 'document.activeElement?.blur(); window.focus(); true');
  await key(ui, 'Tab');
  const order = [await js(ui, 'document.activeElement.id')];
  for (let i = 0; i < 2; i++) { await key(ui, 'Tab'); order.push(await js(ui, 'document.activeElement.id')); }
  assert.deepEqual(order, ['welcome-allow', 'welcome-later', 'welcome-close']);
  await js(ui, `document.getElementById('welcome-later').focus()`);
  await key(ui, 'Enter');
  await until(async () => (await state()).settings.welcomeSeen === true, 'welcomeSeen after Choose sites later');
  await until(async () => !(await visible('welcome')), 'card hidden');
  assert.equal((await state()).settings.holdScope, 'sites');
  assert.deepEqual(await js(ui, 'window.__requests'), [], 'Choose sites later asks for nothing');
  pass('Welcome card on a fresh profile; keyboard order Allow, Later, Close at 320 px; Choose sites later sets welcomeSeen', {order});

  await rpc({type: 'state.mutate', action: {type: 'settings.update', patch: {welcomeSeen: false}}});
  await until(() => visible('welcome'), 'card shows again for the decline check');
  await click('welcome-allow');
  await until(async () => /declined/.test(await text('welcome-outcome-text')), 'decline outcome');
  assert.deepEqual(await js(ui, 'window.__requests'), [{origins: ['http://*/*', 'https://*/*']}]);
  const declined = await state();
  assert.equal(declined.settings.welcomeSeen, true); assert.equal(declined.settings.holdScope, 'sites');
  assert.match(await text('welcome-outcome-text'), /still works site by site/);
  await shot(ui, 'access-welcome-declined-320.png');
  await click('welcome-done');
  await until(async () => !(await visible('welcome')), 'card hidden after Done');
  pass('Allow requests http and https in the click; a (simulated) decline says so plainly and sets welcomeSeen');

  await rpc({type: 'state.mutate', action: {type: 'settings.update', patch: {welcomeSeen: false}}});
  await until(() => visible('welcome'), 'card shows for the close check');
  await click('welcome-close');
  await until(async () => (await state()).settings.welcomeSeen === true, 'welcomeSeen after Close');
  pass('Close sets welcomeSeen');
  await width(ui, 1440, 1000);

  /* 2. Settings. */
  assert.equal(await js(ui, `document.getElementById('all-sites').checked`), false);
  assert.match(await rpcError({type: 'hold.scope', scope: 'all'}), /does not have access to all sites/);
  await js(ui, `(() => { window.__requests = []; const box = document.getElementById('all-sites'); box.checked = true; box.dispatchEvent(new Event('change')); return true; })()`);
  await until(async () => /declined/.test(await text('error')), 'switch decline message');
  assert.equal(await js(ui, `document.getElementById('all-sites').checked`), false, 'the switch shows the true state');
  assert.deepEqual(await js(ui, 'window.__requests'), [{origins: ['http://*/*', 'https://*/*']}]);
  const triggers = await js(ui, `[...document.querySelectorAll('#hold-trigger option')].map((o) => [o.value, o.textContent])`);
  assert.deepEqual(triggers, [['letter', 'A letter key'], ['modifier', process.platform === 'darwin' ? 'Command' : 'Ctrl']]);
  await js(ui, `(() => { const s = document.getElementById('hold-trigger'); s.value = 'modifier'; s.dispatchEvent(new Event('change')); return true; })()`);
  await until(async () => (await state()).settings.holdTrigger === 'modifier', 'modifier saved');
  await until(async () => !(await visible('hold-letter-row')), 'letter row hidden');
  assert.match(await text('hold-trigger-help'), /plain (Command|Ctrl)-click still opens links/);
  await js(ui, `(() => { const s = document.getElementById('hold-trigger'); s.value = 'letter'; s.dispatchEvent(new Event('change')); return true; })()`);
  await until(async () => (await state()).settings.holdTrigger === 'letter', 'letter saved');
  await rpc({type: 'hold.exception', origin: siteB, excepted: true});
  await until(async () => (await text('hold-exceptions')).includes(siteB), 'exception listed');
  assert.equal(await text('exception-count'), '1');
  await js(ui, `document.querySelector('#hold-exceptions button').click()`);
  await until(async () => (await state()).settings.holdExceptions.length === 0, 'exception removed');
  await until(async () => (await text('hold-exceptions-empty')).length > 0 && await visible('hold-exceptions-empty'), 'empty list note');
  const reasons = {allSites: await text('all-sites-help'), site: await text('hold-help'), tabGroups: await text('open-group-help')};
  assert.ok(Object.values(reasons).every((reason) => reason.length > 40));
  await shot(ui, 'access-settings.png');
  pass('Settings: the all-sites switch shows the true state; the trigger offers a letter or the modifier only; the Never list lists and removes; each permission has a reason', {triggers, reasons});

  /* 3. Capture this page: toolbar access, then a newly visited site. */
  await js(ui, 'window.__requests = []; true');
  assert.equal(await browser.clickAction(fixture.base), 'clicked');
  await until(async () => /Meteor Research Lab/.test(await text('scope-preview')), 'current page preview after the toolbar press');
  await sleep(400);
  await click('capture');
  await until(async () => /37 links captured/.test(await text('capture-report')), 'capture after toolbar press');
  assert.deepEqual(await js(ui, 'window.__requests'), [], 'a readable page is captured without a prompt');
  await browser.navigate(page, `${siteB}/index.html`); await sleep(1500);
  await until(async () => /hides its address/.test(await text('scope-preview')), 'hidden address preview');
  await click('capture');
  await until(async () => /Access denied/.test(await text('capture-report')), 'denied on the new site');
  assert.match(await text('capture-report'), /Chrome hides this tab’s address and contents from Link Meteor/);
  assert.deepEqual(await js(ui, 'window.__requests'), [], 'no site to ask for while Chrome hides the address');
  // The denied result offers the welcome card's request instead. The prompt is stubbed to decline here.
  assert.equal(await js(ui, `document.querySelector('#capture-report .report-allow')?.textContent`), 'Allow on all sites');
  await js(ui, `document.querySelector('#capture-report .report-allow').click(); true`);
  await until(async () => /request for access to all sites was declined/.test(await text('error')), 'declined all-sites offer');
  assert.deepEqual(await js(ui, 'window.__requests'), [{origins: ['http://*/*', 'https://*/*']}], 'the denied result asks for all sites in the click');
  assert.equal(await js(ui, `chrome.runtime.sendMessage({type:'state.get'}).then((reply) => reply.data.settings.holdScope)`), 'sites', 'a decline changes nothing');
  await js(ui, 'window.__requests = []; true');
  assert.equal(await browser.clickAction(siteB), 'clicked');
  await sleep(800);
  await click('capture');
  await until(async () => /38 links captured/.test(await text('capture-report')), 'capture after the second toolbar press');
  pass('Capture this page: no prompt after a toolbar press; on a new site whose address Chrome hides, a denied result says why and offers all sites (a decline changes nothing); a toolbar press there allows it');

  /* 4. The capture card, armed through the toolbar action. */
  await browser.navigate(page, `${fixture.base}/index.html`); await sleep(1200);
  assert.equal(await browser.clickAction(fixture.base), 'clicked');
  await sleep(500);
  const target = (await rpc({type: 'state.mutate', action: {type: 'collection.create', name: 'Card target'}})).activeCollectionId;
  const home = (await state()).collections[0].id;
  await rpc({type: 'state.mutate', action: {type: 'collection.activate', id: home}});
  const pageTab = (await rpc({type: 'tabs.list'})).targetTabId;
  await rpc({type: 'capture.arm', tabId: pageTab});
  await until(() => js(page, `!!document.getElementById('link-meteor-overlay')`), 'overlay');
  const bib = await js(page, `(() => { scrollTo(0, 0); const r = document.getElementById('bibliography').getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height}; })()`);
  await drag(page, {x: bib.x + 4, y: bib.y + 4}, {x: bib.x + bib.w - 4, y: bib.y + bib.h - 4});
  await until(async () => (await js(page, card(`.querySelector('.count')?.textContent`))) === '5 links selected', `card count ${JSON.stringify(bib)}`).catch(async (error) => { console.log(await js(page, `JSON.stringify({overlay: !!document.getElementById('link-meteor-overlay'), count: ${card(`.querySelector('.count')?.textContent`)}, badge: ${card(`.querySelector('.badge')?.textContent`)}, bar: ${card(`.querySelector('.bar')?.style.display`)}, y: scrollY})`)); await shot(page, 'debug-card.png'); throw error; });
  await until(async () => /^Adds to My research/.test(await js(page, card(`.querySelector('.dest').innerText`))), 'default destination');
  await js(page, card(`.querySelector('.dest-change').click()`));
  await js(page, `(() => { const select = ${card(`.querySelector('.dest-select')`)}; select.value = ${JSON.stringify(target)}; select.dispatchEvent(new Event('change')); return true; })()`);
  assert.match(await js(page, card(`.querySelector('.dest').innerText`)), /^Adds to Card target/);
  await js(page, card(`.querySelectorAll('.preview input')[4].click()`));
  assert.equal(await js(page, card(`.querySelector('.count').textContent`)), '4 of 5 links selected');
  assert.equal(await js(page, card(`.querySelector('.open-label').textContent`)), 'Open 3 in tabs');
  await js(page, card(`.querySelector('button.add').click()`));
  await until(async () => /Saved 4 links to “Card target”/.test(await js(page, card(`.querySelector('.status').textContent`))), 'saved to the chosen collection');
  const afterSave = await state();
  assert.equal(afterSave.activeCollectionId, home);
  assert.equal(afterSave.collections.find((c) => c.id === target).links.length, 4);
  pass('Card destination picker saves the ticked links to the chosen collection', {saved: 4});

  await js(page, card(`.querySelector('button.copy').click()`));
  await until(async () => /^Copied anchor text and URL/.test(await js(page, card(`.querySelector('.status').textContent`))), 'copied');
  await js(page, card(`.querySelector('button.copy').focus()`));
  await key(page, 'u');
  await until(async () => /^Copied 4 URLs, one per line/.test(await js(page, card(`.querySelector('.status').textContent`))), 'copied URLs');
  await key(page, 'k');
  await until(async () => /^Copied 4 Markdown links/.test(await js(page, card(`.querySelector('.status').textContent`))), 'copied Markdown');
  pass('Card copy formats: table, URLs (U) and Markdown (K)');

  let before = await pages();
  await js(page, card(`.querySelector('button.open').click()`));
  await until(async () => /Opened 3 links in new tabs/.test(await js(page, card(`.querySelector('.status').textContent`))), 'card opened');
  const openedByCard = (await pages()).filter((t) => !before.some((b) => b.targetId === t.targetId)).map((t) => new URL(t.url).pathname).sort();
  assert.deepEqual(openedByCard, ['/appendix', '/papers/attention.pdf', '/papers/geometry.pdf']);
  await closeOpened(before);
  pass('Card Open 3 in tabs opens the unique ticked web links at once', {opened: openedByCard});

  await js(page, card(`.querySelector('button.copy').focus()`));
  await key(page, 'd');
  const file = await until(async () => (await readdir(downloads)).find((name) => name.endsWith('.xlsx')), 'downloaded workbook');
  assert.match(file, /^Card-target_\d{4}-\d{2}-\d{2}_\d{4}\.xlsx$/);
  assert.equal((await readFile(resolve(downloads, file))).subarray(0, 2).toString(), 'PK');
  pass('Card Download this selection (D) saves a workbook named after the chosen collection', {file});

  await js(page, card(`.querySelector('button.m-bookmark').click()`));
  await until(async () => /^Bookmark access is needed/.test(await js(page, card(`.querySelector('.status').textContent`))), 'bookmark needs access');
  assert.equal(await js(page, card(`.querySelector('.status button').textContent`)), 'Open the full view');
  pass('Card Bookmark this selection without access explains it and offers the full view');

  before = await pages();
  await js(page, card(`.querySelector('button.review').click()`));
  const review = await until(async () => (await pages()).find((t) => t.url.startsWith(browser.extensionUrl()) && !before.some((b) => b.targetId === t.targetId)), 'review tab');
  const reviewSession = await browser.attach(review.targetId);
  await until(() => js(reviewSession, `/Selected capture/.test(document.getElementById('active-filters')?.innerText || '')`).catch(() => false), 'review shows only that capture');
  assert.equal(await js(reviewSession, `document.getElementById('collection-heading').textContent`), 'Card target');
  assert.equal(await js(reviewSession, `document.querySelectorAll('.link-row').length`), 4);
  assert.deepEqual(await js(reviewSession, `chrome.storage.session.get('linkMeteorOpenIntent')`), {}, 'the intent is applied once, then removed');
  await closeOpened(before);
  pass('Card Review opens the full view at that capture, in its collection, once');
  await js(page, card(`.querySelector('button.dismiss').click()`));

  // More than 20 on the card: confirmation, then opening.
  await js(page, `(() => { document.body.insertAdjacentHTML('afterbegin', '<div id="many" style="display:grid;grid-template-columns:repeat(15,60px);gap:2px;padding:10px;background:#fff">' + Array.from({length: 30}, (_, i) => '<a href="/card/' + i + '" style="font:9px/12px sans-serif">C' + i + '</a>').join('') + '</div>'); scrollTo(0, 0); return true; })()`);
  await rpc({type: 'capture.arm', tabId: pageTab});
  await until(() => js(page, `!!document.getElementById('link-meteor-overlay')`), 'overlay again');
  const many = await js(page, `(() => { const r = document.getElementById('many').getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height}; })()`);
  await drag(page, {x: many.x + 2, y: many.y + 2}, {x: many.x + many.w - 2, y: many.y + many.h - 2});
  await until(async () => (await js(page, card(`.querySelector('.count')?.textContent`))) === '30 links selected', 'thirty');
  await js(page, card(`.querySelector('button.open').click()`));
  assert.equal(await js(page, card(`.querySelector('.confirm-text').textContent`)), 'Open 30 links in new tabs?');
  before = await pages();
  await js(page, card(`.querySelector('.confirm-yes').click()`));
  await until(async () => /Opened 30 links in new tabs/.test(await js(page, card(`.querySelector('.status').textContent`))), 'thirty opened', 20000);
  assert.equal((await newPages(before)).length, 30);
  await closeOpened(before);
  pass('Card with 30 links confirms first, then opens all 30 in batches');
  await js(page, card(`.querySelector('button.dismiss').click()`));

  /* 4b. The 0.4.0 card messages end to end: Undo after adding right away, already saved, Skip saved,
     the card's preferences, the rich copy payload, and content links only on Capture this page. */
  await browser.navigate(page, `${fixture.base}/index.html`); await sleep(1200);
  assert.equal(await browser.clickAction(fixture.base), 'clicked');
  await sleep(500);
  const savedCheck = (await rpc({type: 'state.mutate', action: {type: 'collection.create', name: 'Saved check'}})).activeCollectionId;
  const links = async (id) => (await state()).collections.find((c) => c.id === id).links;
  // A saved capture setting reaches the open page script through content.configure.
  const setCapture = async (patch) => { await rpc({type: 'state.mutate', action: {type: 'settings.update', patch}}); await sleep(800); };
  const cardValue = (expr) => js(page, card(expr));
  const bibRegion = async (withGrid = false) => {
    const r = await js(page, `(() => { const bib = document.getElementById('bibliography'); scrollTo(0, bib.getBoundingClientRect().top + scrollY - 20); const a = bib.getBoundingClientRect(), b = ${withGrid ? `document.querySelector('.grid').getBoundingClientRect()` : 'a'}; return {x: Math.min(a.x, b.x), y: a.y, w: Math.max(a.right, b.right) - Math.min(a.x, b.x), h: b.bottom - a.y}; })()`);
    await rpc({type: 'capture.arm', tabId: pageTab});
    await until(() => js(page, `!!document.getElementById('link-meteor-overlay')`), 'overlay for 0.4.0');
    await drag(page, {x: r.x + 4, y: r.y + 4}, {x: r.x + r.w - 4, y: r.y + r.h - 4});
  };

  // A theme or appearance change reaches a card already open on the page, through the real background.
  const hostVar = (name) => js(page, `document.getElementById('link-meteor-overlay')?.style.getPropertyValue('${name}').trim()`);
  await setCapture({afterDrag: 'card'});
  await bibRegion();
  await until(async () => (await cardValue(`.querySelector('.count')?.textContent`)) === '5 links selected', 'card for the theme check');
  await setCapture({theme: 'ember', appearance: 'dark'});
  await until(async () => (await hostVar('--k-accent')) === THEMES.ember.card.dark.accent, 'Ember dark reaches the open card');
  assert.equal(await hostVar('color-scheme'), 'dark');
  await setCapture({appearance: 'light'});
  await until(async () => (await hostVar('--k-ground')) === THEMES.ember.card.light.ground && (await hostVar('color-scheme')) === 'light', 'the light scheme reaches the open card');
  assert.equal(await hostVar('--k-hl'), THEMES.ember.highlight);
  await setCapture({theme: 'meteor', appearance: 'system'});
  await key(page, 'Escape');
  pass('A theme or appearance change restyles a card already open on the page, without a reload (content.configure from the background)');

  // Add right away, then Undo: capture.commit and capture.undoAdd through the real background.
  await setCapture({afterDrag: 'add', skipSaved: false, contentOnly: false});
  await bibRegion();
  await until(async () => /^Added 5 links to “Saved check”\.$/.test(await cardValue(`.querySelector('.notice-text')?.textContent`)), 'added right away');
  assert.equal((await links(savedCheck)).length, 5);
  assert.equal(await cardValue(`.querySelector('.bar').style.display`), '', 'no card after adding right away');
  const undoBefore = (await state()).undo;
  await js(page, card(`.querySelector('.notice-undo').click()`));
  await until(async () => /^Removed 5 links from “Saved check”\.$/.test(await cardValue(`.querySelector('.notice-text').textContent`)), 'undone');
  assert.equal((await links(savedCheck)).length, 0, 'Undo removed exactly that add');
  assert.deepEqual((await state()).undo, undoBefore, 'the workbench’s removal Undo is untouched');
  await js(page, card(`.querySelector('.notice-show').click()`));
  assert.equal(await cardValue(`.querySelector('button.add').disabled`), false, 'after Undo the card can add again');
  await js(page, card(`.querySelector('button.add').click()`));
  await until(async () => /^Saved 5 links to “Saved check”\./.test(await cardValue(`.querySelector('.status').textContent`)), 'saved from the card');
  await key(page, 'Escape');
  pass('Add right away saves at once and says so; Undo (capture.undoAdd) removes exactly that add; Show links then adds again from the card');

  // Already saved and Skip saved on a region with 5 saved and 4 new links.
  await setCapture({afterDrag: 'card', skipSaved: true});
  await bibRegion(true);
  await until(async () => (await cardValue(`.querySelector('.count')?.textContent`)) === '9 links selected', 'nine links');
  await until(async () => (await cardValue(`.querySelectorAll('.preview .tag:not([hidden])').length`)) === 5, 'five marked Saved');
  const marked = await js(page, `[...${card(`.querySelectorAll('.preview li')`)}].map((li) => li.querySelector('.t').textContent + (li.querySelector('.tag').hidden ? '' : ' [Saved]'))`);
  assert.deepEqual(marked.filter((row) => row.endsWith('[Saved]')), ['Attention in small systems [Saved]', 'Geometry, “frames” & 雪 [Saved]', 'Download PDF [Saved]', 'No anchor text (labeled “Open illustrated appendix”) [Saved]', 'Visible label [Saved]'], JSON.stringify(marked));
  assert.equal(await cardValue(`.querySelector('.skip-saved').checked`), true, 'Skip saved starts from the setting');
  assert.equal(await cardValue(`.querySelector('.skip-text').textContent`), 'Skip the 5 links already saved');
  // Make this the default: capture.preference saves skipSaved.
  await js(page, card(`.querySelector('.skip-saved').click()`));
  await js(page, card(`.querySelector('.skip-remember').click()`));
  await until(async () => (await state()).settings.skipSaved === false, 'skipSaved saved from the card');
  await js(page, card(`.querySelector('.skip-saved').click()`));
  assert.equal(await cardValue(`.querySelector('.skip-saved').checked`), true);
  pass('Already saved: the card asks capture.saved and marks the 5 saved rows; Skip saved starts from the setting; Make this the default saves it (capture.preference)', {marked});

  // The rich copy payload: capture.copy with format 'rich' through the real background, on the clipboard.
  await browser.send('Browser.grantPermissions', {origin: fixture.base, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']});
  await browser.send('Emulation.setFocusEmulationEnabled', {enabled: true}, page);
  await js(page, card(`.querySelector('button.copy').focus()`));
  await key(page, 'l');
  await until(async () => /^Copied 9 links as rich links\./.test(await cardValue(`.querySelector('.status').textContent`)), 'rich copy');
  const clip = await js(page, `navigator.clipboard.read().then(async ([item]) => ({types: item.types, html: await (await item.getType('text/html')).text(), text: (await (await item.getType('text/plain')).text()).replace(/\\r\\n/g, '\\n')}))`);
  assert.ok(clip.types.includes('text/html') && clip.types.includes('text/plain'), JSON.stringify(clip.types));
  assert.match(clip.html, new RegExp(`<a href="${fixture.base}/papers/attention\\.pdf">Attention in small systems</a>`));
  assert.match(clip.html, /<a href="https:\/\/example\.org\/telescope">Open-sky telescope<\/a>/);
  assert.match(clip.text, new RegExp(`^Attention in small systems \\(${fixture.base}/papers/attention\\.pdf\\)\\n`));
  const payload = await rpc({type: 'capture.copy', format: 'rich', links: [{anchorText: 'A & B', url: `${fixture.base}/x?a=1&b=2`}, {anchorText: '', url: 'mailto:lab@example.org'}]});
  assert.deepEqual(payload, {html: `<ul><li><a href="${fixture.base}/x?a=1&amp;b=2">A &amp; B</a></li><li><a href="mailto:lab@example.org">mailto:lab@example.org</a></li></ul>`, text: `A & B (${fixture.base}/x?a=1&b=2)\nmailto:lab@example.org`});
  pass('Copy as rich links (L) puts the background’s HTML and plain text on the clipboard; the payload escapes anchor text and URLs', {types: clip.types});

  // Adding with Skip saved: capture.commit skips the 5 saved links and says so.
  await js(page, card(`.querySelector('button.add').click()`));
  await until(async () => /^Added 4 links to “Saved check”; 5 were already saved\.$/.test(await cardValue(`.querySelector('.status').textContent`)), 'skipped');
  assert.equal((await links(savedCheck)).length, 9);
  await key(page, 'Escape');
  pass('Skip saved: the card’s Add skips the 5 links already saved and says “Added 4 links …; 5 were already saved”');

  // Content links only on Capture this page: page chrome (a page-level header and footer, nav, aside) is left out, reported, and Include them adds it.
  await setCapture({contentOnly: true, skipSaved: false});
  await js(page, `(() => { scrollTo(0, 0); document.body.insertAdjacentHTML('afterbegin', '<header id="lm-header"></header>'); document.querySelector('main').insertAdjacentHTML('afterbegin', '<nav><a href="/nav/one">Nav one</a> <a href="/nav/two">Nav two</a></nav><aside><iframe id="lm-frame" src="/frame.html" style="height:60px"></iframe></aside>'); document.body.insertAdjacentHTML('beforeend', '<footer><a href="/foot">Footer link</a></footer>'); document.getElementById('lm-header').attachShadow({mode: 'open'}).innerHTML = '<a href="/banner">Banner link</a>'; return true; })()`);
  await until(() => js(page, `!!document.getElementById('lm-frame').contentDocument?.getElementById('frame-link')`), 'frame in the aside');
  await click('capture');
  await until(async () => /37 links captured/.test(await text('capture-report')) && /Left out 5 navigation links/.test(await text('capture-report')), 'content-only capture');
  const captured = await js(ui, `chrome.storage.session.get('linkMeteorCaptureReport').then((v) => v.linkMeteorCaptureReport.report)`);
  assert.deepEqual(captured.results.map((r) => [r.status, r.count, r.leftOut]), [['success', 37, 5]]);
  const inBatch = async () => (await links(savedCheck)).filter((l) => l.batchId === captured.batchId).map((l) => new URL(l.url).pathname);
  assert.deepEqual((await inBatch()).filter((path) => /^\/(nav\/|foot$|banner$|frame-source$)/.test(path)), ['/frame-source'], 'page chrome is not saved; the page’s own content frame is');
  assert.equal(await js(ui, `document.querySelector('#capture-report .report-left-out button')?.textContent`), 'Include them');
  await shot(ui, 'access-capture-left-out.png');
  await js(ui, `document.querySelector('#capture-report .report-left-out button').click(); true`);
  await until(async () => /Included 5 navigation links/.test(await text('capture-report')), 'included');
  const included = await inBatch();
  assert.equal(included.length, 42);
  assert.deepEqual(included.slice(-5).sort(), ['/banner', '/foot', '/frame-source', '/nav/one', '/nav/two']);
  assert.match(await text('notice'), /Added 5 navigation links to “Saved check”/);
  assert.equal((await js(ui, `chrome.storage.session.get('linkMeteorCaptureReport').then((v) => v.linkMeteorCaptureReport.report.leftOutIncluded)`)), 5);
  assert.match(await rpcError({type: 'capture.includeLeftOut', batchId: captured.batchId}), /no longer kept/, 'only once');
  await setCapture({contentOnly: false});
  pass('Capture this page with content links only leaves out 5 links in header (shadow root), nav, aside (frame) and footer, reports them, and Include them adds them once', {captured: 37, leftOut: 5});

  /* 4b2. 0.5.0: context snippets and page citations through the real background. */
  const researchUrl = `${fixture.base}/research/highwire.html`;
  const RESEARCH_CONTEXT = {'/r/canopy': 'Across forty mid-sized cities, the canopy study found that shaded blocks stayed cooler in the afternoon.',
    '/r/data': 'Dataset: urban heat records (2019 to 2023)', '/r/quote': 'As one planner put it, trees are infrastructure, not decoration.', '/r/only': undefined};
  const RESEARCH_CITATION = {title: 'Cooling cities: a review of street-level interventions', authors: ['Okafor, Adaeze', 'Lindqvist, Tove', 'Ramírez-Soto, Julián'], date: '2024/03/15',
    journal: 'Journal of Synthetic Urban Climate', publisher: 'Meteor Fixture Press', volume: '12', issue: '3', firstPage: '201', lastPage: '219',
    doi: '10.5555/cool.2024.0312', pmid: '31234567', isbn: '978-0-262-03384-8', pdfUrl: `${fixture.base}/research/cooling.pdf`};
  const researchIn = async (id, batchId) => {
    const home = (await state()).collections.find((c) => c.id === id), batch = home.links.filter((l) => !batchId || l.batchId === batchId);
    const {readAt, ...citation} = home.pages?.[researchUrl] || {};
    return {citation, readAt, contexts: Object.fromEntries(batch.map((l) => [new URL(l.url).pathname, l.context])), count: batch.length};
  };
  const pickContexts = (contexts) => Object.fromEntries(Object.keys(RESEARCH_CONTEXT).map((path) => [path, contexts[path]]));
  const lastReport = () => js(ui, `chrome.storage.session.get('linkMeteorCaptureReport').then((v) => v.linkMeteorCaptureReport.report)`);
  await browser.navigate(page, researchUrl); await sleep(1200);
  assert.equal(await browser.clickAction(researchUrl), 'clicked');
  const researchPages = (await rpc({type: 'state.mutate', action: {type: 'collection.create', name: 'Research pages'}})).activeCollectionId;
  await until(async () => /Cooling cities/.test(await text('scope-preview')), 'the research page is the current page');
  await click('capture');
  await until(async () => (await lastReport()).results?.[0]?.url === researchUrl, 'the research page captured');
  const byPage = await researchIn(researchPages);
  assert.equal(byPage.count, 14);
  assert.deepEqual(byPage.citation, RESEARCH_CITATION, 'the page’s own citation tags, keyed by its address');
  assert.ok(Date.parse(byPage.readAt) > 0);
  assert.deepEqual(pickContexts(byPage.contexts), RESEARCH_CONTEXT);
  assert.equal(byPage.contexts['/r/comparison'].length <= 400 && byPage.contexts['/r/comparison'].startsWith('…'), true);
  pass('Capture this page saves each link’s context and the page’s citation tags (Highwire, DOI read as a DOI) under the page’s address', {links: byPage.count});
  // The function Save tabs as links runs, through Chrome's real executeScript, on this page (readable
  // after the toolbar press): the same citation as the page script's, before the background tidies it.
  const tabRead = await js(ui, `import(chrome.runtime.getURL('background/citations.js')).then(({readCitationTags}) => chrome.scripting.executeScript({target: {tabId: ${pageTab}}, func: readCitationTags, injectImmediately: true})).then(([answer]) => answer.result)`);
  assert.deepEqual(tabRead, {...RESEARCH_CITATION, doi: 'doi:10.5555/cool.2024.0312'}, 'as printed; the background reads the DOI from it');
  pass('Save tabs as links’ reader runs through Chrome’s executeScript as a stand-alone function and reads the same citation tags');

  // A region from the card: the ticked links keep their context, and the page's citation goes with them.
  const researchCard = (await rpc({type: 'state.mutate', action: {type: 'collection.create', name: 'Research card'}})).activeCollectionId;
  await rpc({type: 'capture.arm', tabId: pageTab});
  await until(() => js(page, `!!document.getElementById('link-meteor-overlay')`), 'overlay on the research page');
  const blocks = await js(page, `(() => { scrollTo(0, 0); const b = document.getElementById('blocks').getBoundingClientRect(); return {x: b.x, y: b.y, w: b.width, h: b.height}; })()`);
  await drag(page, {x: blocks.x + 4, y: blocks.y + 4}, {x: blocks.x + blocks.w - 4, y: blocks.y + blocks.h - 4});
  await until(async () => (await cardValue(`.querySelector('.count')?.textContent`)) === '12 links selected', 'twelve links in the blocks');
  await js(page, card(`.querySelector('button.add').click()`));
  await until(async () => /^Saved 12 links to “Research card”/.test(await cardValue(`.querySelector('.status').textContent`)), 'region saved');
  await key(page, 'Escape');
  const byCard = await researchIn(researchCard);
  assert.deepEqual([byCard.count, byCard.citation], [12, RESEARCH_CITATION]);
  assert.deepEqual(pickContexts(byCard.contexts), RESEARCH_CONTEXT);
  pass('A region saved from the card keeps each link’s context and the page’s citation tags', {links: byCard.count});

  // Save the words around each link: a checkbox under After a drag; off, captures keep no context.
  assert.equal(await js(ui, `document.querySelector('label:has(#save-context)').textContent.trim()`), 'Save the words around each link');
  assert.match(await text('save-context-help'), /400 characters of the text around it on its page\. Saved in this browser\.$/);
  assert.equal(await js(ui, `document.getElementById('save-context').checked`), true, 'on by default');
  await js(ui, `document.getElementById('save-context').click(); true`);
  await until(async () => (await state()).settings.saveContext === false, 'saveContext off');
  const reportBefore = (await lastReport()).batchId;
  await click('capture');
  await until(async () => (await lastReport()).batchId !== reportBefore, 'captured again with saveContext off');
  const withoutContext = await researchIn(researchCard, (await lastReport()).batchId);
  assert.deepEqual([withoutContext.count, Object.values(withoutContext.contexts).filter((value) => value !== undefined)], [14, []], 'no link keeps context');
  assert.equal(withoutContext.citation.title, RESEARCH_CITATION.title, 'the page’s citation is still read');
  await js(ui, `document.getElementById('save-context').click(); true`);
  await until(async () => (await state()).settings.saveContext === true && await js(ui, `document.getElementById('save-context').checked`), 'saveContext on again');
  pass('Save the words around each link (After a drag): on by default; off, Capture this page keeps no context but still reads the page’s citation');
  await browser.navigate(page, `${fixture.base}/index.html`); await sleep(800);

  /* 4c. Save tabs as links (release candidate 2): three fixture tabs, each made readable by a toolbar
     press on it (this profile has no tabs permission), saved with their own titles and addresses. */
  const tabsBefore = await pages();
  const tabPaths = ['/empty.html', '/frame.html', '/index.html?tab=3'];
  const tabTitles = {'/empty.html': 'Empty fixture', '/frame.html': 'Embedded fixture', '/index.html?tab=3': 'Meteor Research Lab — deterministic fixture'};
  for (const path of tabPaths) {
    const {targetId} = await browser.newTab(fixture.base + path);
    await sleep(700);
    await browser.send('Target.activateTarget', {targetId});
    assert.equal(await browser.clickAction(fixture.base + path), 'clicked');
  }
  await sleep(800);
  const listed = (await rpc({type: 'tabs.list'})).tabs;
  const fixtureTabs = tabPaths.map((path) => listed.find((tab) => tab.url === fixture.base + path));
  assert.ok(fixtureTabs.every(Boolean), `each pressed tab shows its address: ${JSON.stringify(listed.map((tab) => tab.url))}`);
  const hiddenTab = listed.find((tab) => !tab.url);
  const labTabs = (await rpc({type: 'state.mutate', action: {type: 'collection.create', name: 'Lab tabs'}})).activeCollectionId;
  const {report: tabsReport} = await rpc({type: 'capture.tabs', scope: 'selected', tabIds: [...fixtureTabs.map((tab) => tab.id), ...(hiddenTab ? [hiddenTab.id] : [])]});
  assert.deepEqual([tabsReport.kind, tabsReport.saved, tabsReport.skipped, tabsReport.unsupported], ['tabs', 3, 0, 0]);
  const savedTabs = (await state()).collections.find((c) => c.id === labTabs).links;
  const fields = ({anchorText, accessibleLabel, url, originalHref, sourceUrl, sourceTitle, frameUrl}) => ({anchorText, accessibleLabel, url, originalHref, sourceUrl, sourceTitle, frameUrl});
  assert.deepEqual(savedTabs.map(fields), tabPaths.map((path) => ({anchorText: tabTitles[path], accessibleLabel: '', url: fixture.base + path, originalHref: fixture.base + path, sourceUrl: fixture.base + path, sourceTitle: tabTitles[path], frameUrl: ''})));
  assert.deepEqual([...new Set(savedTabs.map((link) => link.batchId))], [tabsReport.batchId], 'one batch for the save');
  if (hiddenTab) assert.deepEqual([tabsReport.results.at(-1).status, tabsReport.results.at(-1).error], ['denied', 'Chrome hides this tab’s address from Link Meteor.']);
  // 0.5.0: a toolbar press is not site access, so no tab's citation tags are read, and nothing asks.
  assert.deepEqual(tabsReport.citations, {tabs: 3, read: 0, found: 0, needAccess: 3});
  assert.equal((await state()).collections.find((c) => c.id === labTabs).pages, undefined, 'no citation without site access');
  pass('Save tabs as links (capture.tabs): three fixture tabs become three links with their titles and addresses, in one batch; a tab Chrome hides is reported, not saved; without site access no citation tags are read (This page’s tab, with the toolbar’s temporary access, is)', {saved: savedTabs.length, hidden: !!hiddenTab});

  // The workbench: The tabs themselves, with This page.
  await js(ui, `document.querySelector('input[name="capture-what"][value="tabs"]').click(); true`);
  await until(async () => (await text('capture-label')) === 'Save this tab as a link', 'the button for This page');
  assert.match(await text('scope-preview'), /Saves the tab’s title and address as one link\.$/);
  const inventoryNow = await rpc({type: 'tabs.list'});
  const targetUrl = inventoryNow.tabs.find((tab) => tab.id === inventoryNow.targetTabId)?.url;
  await click('capture');
  await until(async () => /^Saved 1 tab as a link/.test(await text('capture-report')), 'this tab saved');
  // This page's tab is the one the toolbar press gave temporary access to, so its citation tags are read.
  assert.match(await text('notice'), /^Saved 1 tab as a link\. Read the tab’s citation details\.$/);
  assert.match(await text('capture-report'), /Read the tab’s citation details\./);
  const thisTab = (await state()).collections.find((c) => c.id === labTabs).links.at(-1);
  assert.equal(thisTab.anchorText, tabTitles[new URL(thisTab.url).pathname + new URL(thisTab.url).search]);
  if (targetUrl) assert.equal(thisTab.url, targetUrl);
  await width(ui, 320);
  assert.equal(await js(ui, 'document.documentElement.scrollWidth > innerWidth'), false);
  assert.equal(await js(ui, `(() => { const label = document.getElementById('capture-label'); return label.scrollWidth <= label.clientWidth; })()`), true, 'the button’s words are not cut short at 320 px');
  await shot(ui, 'access-tabs-this-page-320.png');
  await width(ui, 1280);
  pass('The tabs themselves with This page: the button says Save this tab as a link, saves the current tab, and fits at 320 px');

  // Pick tabs, with Chrome's tab-access answer stubbed to allow (simulated accept): the three
  // tabs' addresses come from the real toolbar presses above.
  await js(ui, `(() => { window.__requests = []; chrome.permissions.request = async (request) => { window.__requests.push(request); return true; }; return true; })()`);
  await js(ui, `document.querySelector('input[name="scope"][value="selected"]').click(); true`);
  await until(() => visible('tab-picker'), 'tab picker');
  await click('tabs-none');
  for (const tab of fixtureTabs) await js(ui, `document.querySelector('#tab-options input[data-tab-id="${tab.id}"]').click(); true`);
  await until(async () => (await text('capture-label')) === 'Save 3 tabs as links', 'the button counts the picked tabs');
  await shot(ui, 'access-tabs-pick-three.png');
  await click('capture');
  await until(async () => /^Saved 3 tabs as links/.test(await text('capture-report')), 'three tabs saved from the workbench');
  assert.match(await text('notice'), /^Saved 3 tabs as links\. Read no citation details; the tabs need site access\.$/);
  assert.match(await text('capture-report'), /Read no citation details; the tabs need site access\./);
  assert.ok((await js(ui, 'window.__requests')).every((request) => JSON.stringify(request) === '{"permissions":["tabs"]}'), 'only tab access is asked for, never a site');
  assert.deepEqual((await state()).collections.find((c) => c.id === labTabs).links.slice(-3).map((link) => link.anchorText), tabPaths.map((path) => tabTitles[path]));
  pass('Pick tabs: three tabs chosen, the button says Save 3 tabs as links, and the report says Saved 3 tabs as links and that reading citation details needs site access (tab access: simulated accept)');

  // Save all tabs in this window from the toolbar menu, without tab access: the menu leaves this open
  // intent and opens the full view, which has the choice ready, says why, and asks in the save click.
  await js(ui, `chrome.storage.session.set({linkMeteorOpenIntent: {view: 'links', batchId: '', what: 'tabs', scope: 'window', createdAt: new Date().toISOString()}}).then(() => true)`);
  await js(ui, 'location.reload(); true');
  await sleep(1500);
  await until(() => js(ui, `!!document.getElementById('collection-heading') && !!document.querySelector('input[name="capture-what"][value="tabs"]')?.checked`).catch(() => false), 'The tabs themselves chosen from the intent');
  await declinePrompts();
  assert.equal(await js(ui, `document.querySelector('input[name="scope"]:checked').value`), 'window');
  await until(async () => /needs Chrome to show Link Meteor your open tabs’ titles and addresses/.test(await text('notice')), 'the reason');
  assert.match(await text('capture-label'), /^Save \d+ tabs? as links?$/);
  assert.equal(await js(ui, 'document.activeElement?.id'), 'capture', 'focus is on the save button');
  await shot(ui, 'access-tabs-from-menu.png');
  await click('capture');
  await until(async () => /Tab access was declined/.test(await text('error')), 'declined');
  assert.deepEqual(await js(ui, 'window.__requests'), [{permissions: ['tabs']}], 'the save click asks for tab access');
  assert.deepEqual(await js(ui, `chrome.storage.session.get('linkMeteorOpenIntent')`), {}, 'the intent is applied once');
  pass('Save all tabs in this window without tab access: the full view opens with The tabs themselves and This window, says why, and asks in the save click (simulated decline)');
  await js(ui, `document.querySelector('input[name="capture-what"][value="links"]').click(); document.querySelector('input[name="scope"][value="current"]').click(); true`);
  await closeOpened(tabsBefore);

  /* 5. The workbench opener's tiers, with local fixture URLs. */
  const seed = async (name, n) => {
    const id = (await rpc({type: 'state.mutate', action: {type: 'collection.create', name}})).activeCollectionId;
    const links = Array.from({length: n}, (_, i) => ({id: `${name}-${i}`, anchorText: `${name} ${i}`, accessibleLabel: '', url: `${fixture.base}/tier/${name.replace(/\W/g, '')}/${i}`, originalHref: '', sourceUrl: `${fixture.base}/index.html`, sourceTitle: 'Tier fixture', frameUrl: '', capturedAt: new Date().toISOString(), batchId: 'tier', notes: '', tags: []}));
    await rpc({type: 'state.mutate', action: {type: 'links.append', collectionId: id, links}});
    await until(async () => (await text('open-label')).includes(String(n)), `${name} rendered`);
    return id;
  };
  await seed('Open twenty', 20);
  assert.equal(await text('open-label'), 'Open 20 web links');
  before = await pages();
  await click('open-links');
  await until(async () => /Opened 20 links in new tabs/.test(await text('notice')), 'twenty opened', 20000);
  assert.equal(await visible('open-confirm'), false, 'no confirmation up to 20');
  assert.equal((await newPages(before)).length, 20);
  await closeOpened(before);
  pass('Workbench: 20 links open without a confirmation');

  await js(ui, 'window.__requests = []; true');
  before = await pages();
  await click('open-group');
  await until(async () => /unnamed tab group/.test(await text('notice')), 'unnamed group', 20000);
  assert.deepEqual(await js(ui, 'window.__requests'), [{permissions: ['tabGroups']}], 'Chrome is asked for tab-group access when a group is chosen');
  const grouped = await js(ui, `chrome.tabs.query({}).then((tabs) => tabs.filter((t) => t.groupId !== -1).map((t) => t.groupId))`);
  assert.equal(grouped.length, 20); assert.equal(new Set(grouped).size, 1);
  await closeOpened(before);
  pass('Workbench: a tab group without tab-group access (simulated decline) opens unnamed, with a note', {groupedTabs: grouped.length});

  await seed('Open forty-five', 45);
  await click('open-links');
  await until(() => visible('open-confirm'), 'confirmation');
  assert.equal(await text('open-confirm-text'), 'Open 45 web links in new tabs?');
  const buttons = await js(ui, `[...document.querySelectorAll('#open-confirm button')].map((b) => [b.id, b.textContent])`);
  assert.deepEqual(buttons, [['open-confirm-yes', 'Open 45 tabs'], ['open-confirm-window', 'Open in a new window'], ['open-confirm-group', 'Open as a tab group'], ['open-confirm-no', 'Cancel']]);
  before = await pages();
  await click('open-confirm-no');
  await sleep(300);
  assert.equal((await newPages(before)).length, 0, 'Cancel opens nothing');
  await click('open-links'); await until(() => visible('open-confirm'), 'confirmation again');
  const windowsBefore = await js(ui, `chrome.windows.getAll().then((w) => w.length)`);
  await click('open-confirm-window');
  await until(async () => /Opened 45 links in a new window/.test(await text('notice')), 'window opened', 30000);
  assert.equal(await js(ui, `chrome.windows.getAll().then((w) => w.length)`), windowsBefore + 1);
  assert.equal((await newPages(before)).length, 45);
  await closeOpened(before);
  pass('Workbench: 45 links confirm inline (Open 45 tabs, new window, tab group, Cancel); a new window opens all 45', {buttons});

  await seed('Open one-fifty', 150);
  await click('open-links'); await until(() => visible('open-confirm'), 'strong confirmation');
  assert.match(await text('open-confirm-text'), /^Open 150 web links\? That is a lot of tabs at once/);
  assert.equal(await js(ui, `document.getElementById('open-confirm').classList.contains('open-confirm-strong')`), true);
  await shot(ui, 'access-open-strong.png');
  before = await pages();
  await click('open-confirm-yes');
  await until(() => visible('open-progress'), 'progress shown');
  await until(async () => /Opening [1-9]\d* of 150 links/.test(await text('open-progress-text')), 'progress after a batch', 15000);
  await shot(ui, 'access-open-progress.png');
  await click('open-cancel-progress');
  await until(async () => /Stopped after opening \d+ of 150 links/.test(await text('notice')), 'stopped', 20000);
  const stoppedAt = (await newPages(before)).length;
  assert.ok(stoppedAt >= 10 && stoppedAt < 150, `opened ${stoppedAt}`);
  await closeOpened(before);
  pass('Workbench: 150 links use stronger wording, open in batches with progress, and Cancel stops before the next batch', {openedBeforeStop: stoppedAt});

  await seed('Open five-twenty', 520);
  before = await pages();
  await click('open-links');
  await until(async () => /opens at most 500 at a time, so nothing was opened/.test(await text('error')), 'refused');
  assert.equal(await visible('open-confirm'), false);
  assert.equal((await newPages(before)).length, 0);
  assert.match(await rpcError({type: 'links.open', urls: Array.from({length: 501}, (_, i) => `${fixture.base}/x/${i}`), confirmed: true}), /at most 500/);
  pass('Workbench: 520 links are refused before anything opens, in the page and in the background');

  /* 6. After an upgrade: a state saved by 0.2.2 (no welcomeSeen) shows the welcome card once. */
  const current = await state();
  await js(ui, `chrome.storage.local.set({linkMeteorState: ${JSON.stringify({...current, settings: {holdKey: 'r', holdOrigins: []}})}}).then(() => true)`);
  await js(ui, 'location.reload(); true');
  await sleep(1500);
  await until(() => js(ui, `!!document.getElementById('welcome') && !document.getElementById('welcome').hidden`).catch(() => false), 'welcome card after an upgrade');
  assert.equal(await text('welcome-key'), 'R');
  assert.equal((await state()).settings.welcomeSeen, false);
  await click('welcome-later');
  await until(async () => (await state()).settings.welcomeSeen === true, 'answered after the upgrade');
  pass('A state saved by 0.2.2 shows the welcome card once, with the saved hold key');

  /* 7. After Link Meteor restarts in place (reinstalled from its folder, as an update does), region
     selection still works on a page that was already open, without reloading it. The test does not
     use chrome.runtime.reload(): in Chrome for Testing that unloads a command-line extension for good. */
  await js(page, 'window.__keep = 1');
  assert.equal(await browser.clickAction(fixture.base), 'clicked');
  await click('arm');
  await until(() => js(page, `!!document.getElementById('link-meteor-overlay')`), 'region selection before restart');
  await key(page, 'Escape');
  await js(ui, 'chrome.storage.session.set({restartProbe: 1}).then(() => true)');
  const reinstalled = await browser.send('Extensions.loadUnpacked', {path: browser.extension});
  assert.equal(reinstalled.id, browser.extensionId);
  await sleep(2000);
  const reopened = await browser.newWindow(browser.extensionUrl());
  ui = await browser.attach(reopened.targetId);
  await until(() => js(ui, `!!document.getElementById('collection-heading') && !!chrome.runtime?.id`).catch(() => false), 'workbench reopened');
  assert.deepEqual(await js(ui, `chrome.storage.session.get('restartProbe')`), {}, 'the restart cleared session storage, so it really happened');
  assert.equal(await browser.clickAction(fixture.base), 'clicked');
  await sleep(600);
  const {tabId} = await rpc({type: 'capture.arm'});
  await until(() => js(page, `document.querySelectorAll('#link-meteor-overlay').length === 1`), 'region selection after restart');
  assert.equal(await js(ui, `chrome.tabs.sendMessage(${tabId}, {type: 'links.progress'}).then(() => 'delivered', (error) => error.message)`), 'delivered', 'a connected page script answers');
  assert.equal(await js(page, 'window.__keep'), 1, 'the fixture page was not reloaded');
  await key(page, 'Escape');
  assert.equal(await js(page, `document.querySelectorAll('#link-meteor-overlay').length`), 0);
  pass('After Link Meteor restarts in place, region selection works on the same unreloaded page and its script answers messages');

  result.result = 'PASS';
} catch (error) {
  result.result = 'FAIL'; result.error = error.stack; console.error(error); process.exitCode = 1;
} finally {
  await browser.close(); await fixture.close();
  await rm(downloads, {recursive: true, force: true});
  result.finished = new Date().toISOString();
  await writeFile(resolve(evidence, 'access-browser-results.json'), JSON.stringify(result, null, 2) + '\n');
}
