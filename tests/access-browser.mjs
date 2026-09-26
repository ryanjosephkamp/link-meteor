// Access and capture (0.3.0) on the loaded extension, with no optional grants: Chrome for Testing,
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

const evidence = resolve(root, process.env.LINK_METEOR_EVIDENCE_DIR || '.scratch/evidence-access-capture');
const result = {started: new Date().toISOString(), browser: 'Chrome for Testing, headless, fresh temporary profile, real unpacked extension, no optional grants', checks: []};
const pass = (name, data = {}) => { result.checks.push({name, ...data}); console.log('PASS', name, Object.keys(data).length ? JSON.stringify(data) : ''); };
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
await mkdir(evidence, {recursive: true});
const fixture = await fixtureServer();
const siteB = fixture.base.replace('127.0.0.1', 'localhost');
const browser = await launchWithAction({profilePrefix: 'access-profile-'});
const downloads = await mkdtemp(resolve(scratch, 'access-downloads-'));

/* A small DevTools-protocol toolkit over the pipe. */
const js = (session, expression) => browser.evaluate(session, expression);
async function until(fn, message, timeout = 8000) {
  const start = Date.now(); let last;
  while (Date.now() - start < timeout) { last = await fn(); if (last) return last; await sleep(60); }
  throw new Error(`${message} (timed out; last: ${JSON.stringify(last)})`);
}
const pages = async () => (await browser.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'page');
async function closeOpened(before) {
  const keep = new Set(before.map((t) => t.targetId));
  for (const target of await pages()) if (!keep.has(target.targetId)) await browser.send('Target.closeTarget', {targetId: target.targetId}).catch(() => {});
  await sleep(200);
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
  const ui = await browser.attach(uiTarget);
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
  assert.equal(await browser.clickAction(siteB), 'clicked');
  await sleep(800);
  await click('capture');
  await until(async () => /38 links captured/.test(await text('capture-report')), 'capture after the second toolbar press');
  pass('Capture this page: no prompt after a toolbar press; on a new site whose address Chrome hides, a denied result says why; a toolbar press there allows it');

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
  assert.equal((await pages()).length - before.length, 30);
  await closeOpened(before);
  pass('Card with 30 links confirms first, then opens all 30 in batches');
  await js(page, card(`.querySelector('button.dismiss').click()`));

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
  assert.equal((await pages()).length - before.length, 20);
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
  assert.equal((await pages()).length, before.length, 'Cancel opens nothing');
  await click('open-links'); await until(() => visible('open-confirm'), 'confirmation again');
  const windowsBefore = await js(ui, `chrome.windows.getAll().then((w) => w.length)`);
  await click('open-confirm-window');
  await until(async () => /Opened 45 links in a new window/.test(await text('notice')), 'window opened', 30000);
  assert.equal(await js(ui, `chrome.windows.getAll().then((w) => w.length)`), windowsBefore + 1);
  assert.equal((await pages()).length - before.length, 45);
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
  const stoppedAt = (await pages()).length - before.length;
  assert.ok(stoppedAt >= 10 && stoppedAt < 150, `opened ${stoppedAt}`);
  await closeOpened(before);
  pass('Workbench: 150 links use stronger wording, open in batches with progress, and Cancel stops before the next batch', {openedBeforeStop: stoppedAt});

  await seed('Open five-twenty', 520);
  before = await pages();
  await click('open-links');
  await until(async () => /opens at most 500 at a time, so nothing was opened/.test(await text('error')), 'refused');
  assert.equal(await visible('open-confirm'), false);
  assert.equal((await pages()).length, before.length);
  assert.match(await rpcError({type: 'links.open', urls: Array.from({length: 501}, (_, i) => `${fixture.base}/x/${i}`), confirmed: true}), /at most 500/);
  pass('Workbench: 520 links are refused before anything opens, in the page and in the background');

  result.result = 'PASS';
} catch (error) {
  result.result = 'FAIL'; result.error = error.stack; console.error(error); process.exitCode = 1;
} finally {
  await browser.close(); await fixture.close();
  await rm(downloads, {recursive: true, force: true});
  result.finished = new Date().toISOString();
  await writeFile(resolve(evidence, 'access-browser-results.json'), JSON.stringify(result, null, 2) + '\n');
}
