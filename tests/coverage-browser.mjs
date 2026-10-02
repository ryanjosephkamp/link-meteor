// Capture coverage (0.6.0) on the loaded extension, with no optional grants: Chrome for Testing,
// headless, a fresh temporary profile, the real unpacked build, and Chrome's real toolbar action
// (DevTools Extensions.triggerAction) for the temporary page access a toolbar click gives.
// - Closed components: the links inside closed shadow roots (one, nested, inside an open one, a
//   custom element, one declared in HTML, a slotted link, one in page chrome, a hidden one) through
//   Capture this page, a region, and the right-click lookup. Here the page script runs as Chrome
//   runs it, so chrome.dom.openOrClosedShadowRoot is the real one.
// - Frames from other sites: with only the toolbar's access, the frames the page can't read are
//   named by site in the report, the frames it can read are read once each with their frameUrl,
//   and Allow these sites asks for exactly those sites in the click. Chrome's prompt is never
//   shown: the workbench's chrome.permissions.request is replaced by a stub (a simulated decline,
//   then a simulated accept, which gives no real access).
// - A lazy frame not yet loaded and a frame that never finishes loading don't hold the capture.
// - The report's frames line and button at 320 px, with measured contrast in light and dark.
// The fixture server answers as three sites: 127.0.0.1, localhost and third.localhost.
//   npm run build && LINK_METEOR_FIXTURE_PORT=52630 node tests/coverage-browser.mjs
// Writes coverage-browser-results.json and screenshots to the evidence folder.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixtureServer, evidence} from './helpers/browser.mjs';
import {launchWithAction} from './helpers/action.mjs';

const result = {started: new Date().toISOString(), browser: 'Chrome for Testing, headless, fresh temporary profile, real unpacked extension, no optional grants; Chrome’s real toolbar action; Chrome’s permission prompt replaced by a stub', checks: [], screenshots: []};
const pass = (name, data = {}) => { result.checks.push({name, ...data}); console.log('PASS', name, Object.keys(data).length ? JSON.stringify(data) : ''); };
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// /site/coverage/slow.html never finishes loading: its first bytes arrive, the rest never does.
const held = new Set();
const fixture = await fixtureServer({routes: (req, res, url) => {
  if (url.pathname !== '/site/coverage/slow.html') return false;
  res.writeHead(200, {'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store'});
  res.write('<!doctype html><title>Slow frame</title><p>Still loading: <a href="/f/slow">Slow link</a></p>' + ' '.repeat(2048));
  held.add(res); return true;
}});
const port = new URL(fixture.base).port, other = fixture.other, third = `http://third.localhost:${port}`;
const folder = '/site/coverage/';
const browser = await launchWithAction({profilePrefix: 'coverage-profile-'});

const js = (session, expression) => browser.evaluate(session, expression);
async function until(fn, message, timeout = 10000) {
  const start = Date.now(); let last;
  while (Date.now() - start < timeout) { last = await fn(); if (last) return last; await sleep(60); }
  throw new Error(`${message} (timed out; last: ${JSON.stringify(last)})`);
}
async function mouse(session, type, x, y, {button = 'left', buttons = 0} = {}) {
  await browser.send('Input.dispatchMouseEvent', {type, x, y, button: type === 'mouseMoved' ? (buttons ? 'left' : 'none') : button, buttons, clickCount: type === 'mouseMoved' ? 0 : 1}, session);
}
async function drag(session, from, to, steps = 12) {
  await mouse(session, 'mouseMoved', from.x, from.y);
  await mouse(session, 'mousePressed', from.x, from.y, {buttons: 1});
  for (let i = 1; i <= steps; i++) await mouse(session, 'mouseMoved', from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps, {buttons: 1});
  await sleep(80);
  await mouse(session, 'mouseReleased', to.x, to.y);
}
async function width(session, w, h = 900) {
  await browser.send('Emulation.setDeviceMetricsOverride', {width: w, height: h, deviceScaleFactor: 1, mobile: false}, session);
  await sleep(250);
}
async function shot(session, name) {
  const {data} = await browser.send('Page.captureScreenshot', {format: 'png'}, session);
  await writeFile(resolve(evidence, name), Buffer.from(data, 'base64')); result.screenshots.push(name);
}
const card = (expr) => `document.getElementById('link-meteor-overlay')?.shadowRoot${expr}`;
const path = (url) => { const at = new URL(url); return at.pathname + at.search; };

try {
  await mkdir(evidence, {recursive: true});
  const {targetId: uiTarget} = await browser.newWindow(browser.extensionUrl());
  const ui = await browser.attach(uiTarget);
  await until(() => js(ui, `!!document.getElementById('collection-heading') && !!window.chrome?.runtime`), 'workbench loaded');
  await sleep(600);
  const rpc = (message) => js(ui, `chrome.runtime.sendMessage(${JSON.stringify(message)}).then((r) => { if (!r?.ok) throw new Error(r?.error || 'no response'); return r.data; })`);
  const state = () => rpc({type: 'state.get'});
  const active = async () => { const s = await state(); return s.collections.find((c) => c.id === s.activeCollectionId); };
  const batch = async (batchId) => (await active()).links.filter((link) => link.batchId === batchId);
  const text = (id) => js(ui, `document.getElementById(${JSON.stringify(id)}).innerText`);
  const click = (selector) => js(ui, `document.querySelector(${JSON.stringify(selector)}).click(); true`);
  // Stands in for Chrome's prompt: records each request, and answers as told.
  const answerPrompts = (answer) => js(ui, `(() => { window.__requests = []; chrome.permissions.request = async (request) => { window.__requests.push(request); return ${answer}; }; return true; })()`);
  const requests = () => js(ui, 'window.__requests');
  await answerPrompts(false);
  await rpc({type: 'state.mutate', action: {type: 'settings.update', patch: {welcomeSeen: true}}});
  // Opens a page in a new tab, presses the toolbar action there, and returns its session and tab id.
  const open = async (url) => {
    const {targetId} = await browser.newTab(url);
    const session = await browser.attach(targetId);
    await width(session, 1280, 1000);
    await until(() => js(session, `document.readyState !== 'loading' && !!document.querySelector('main, body')`), `loaded ${url}`);
    await sleep(900);
    assert.equal(await browser.clickAction(url), 'clicked');
    await sleep(700);
    return {session, targetId, tabId: (await rpc({type: 'tabs.list'})).targetTabId};
  };
  const closeTab = (page) => browser.send('Target.closeTarget', {targetId: page.targetId}).catch(() => {});
  const fields = (links) => links.map((link) => [link.anchorText, path(link.url), link.frameUrl ? path(link.frameUrl) : '']);

  /* 1. Closed components: Capture this page. */
  const components = `${fixture.base}${folder}components.html`;
  const page = await open(components);
  assert.equal(await js(page.session, `document.getElementById('closed-host').shadowRoot`), null, 'the page’s own scripts can’t see into the component');
  const run = await rpc({type: 'capture.run', tabIds: [page.tabId]});
  assert.deepEqual([run.report.results[0].status, run.report.results[0].warning, run.report.results[0].frames], ['success', '', undefined]);
  const here = `${folder}components.html`;
  const COMPONENT_LINKS = [
    ['Light link', '/c/light', here], ['Closed one', '/c/closed-one', here], ['Closed two', '/c/closed-two', here], ['Closed one, again', '/c/closed-one', here],
    ['Outer closed link', '/c/outer', here], ['Inner closed link', '/c/inner', here], ['Open link', '/c/open', here], ['Closed inside open', '/c/closed-in-open', here],
    ['Custom element link', '/c/custom', here], ['Declared closed link', '/c/declared', here], ['Slotted link', '/c/slotted', here], ['Navigation link in a closed component', '/c/nav', here],
  ];
  const saved = await batch(run.report.batchId);
  assert.deepEqual(fields(saved), COMPONENT_LINKS, 'every link once, in page order; the hidden component’s link is left out');
  assert.equal(saved.find((link) => link.anchorText === 'Closed two').context, 'The first source the component names is Closed one, and then Closed two, the same address as Closed one, again.');
  assert.ok(saved.every((link) => link.sourceUrl === components && link.sourceTitle === 'Closed components — coverage fixture'));
  pass('Closed components: Capture this page saves the links inside closed shadow roots (nested, inside an open root, a custom element, declared in HTML, slotted, in navigation), each once, with its words around it; a hidden component gives none', {links: saved.length});

  // Content links only: a closed component inside navigation is page chrome.
  await rpc({type: 'state.mutate', action: {type: 'settings.update', patch: {contentOnly: true}}});
  const contentRun = await rpc({type: 'capture.run', tabIds: [page.tabId]});
  assert.deepEqual([contentRun.report.results[0].count, contentRun.report.results[0].leftOut], [11, 1]);
  assert.equal((await batch(contentRun.report.batchId)).some((link) => link.anchorText.startsWith('Navigation link')), false);
  await rpc({type: 'state.mutate', action: {type: 'settings.update', patch: {contentOnly: false}}});
  pass('Content links only: a link in a closed component inside navigation is left out and counted');

  /* 2. Closed components: a region, its highlights, and the right-click lookup. */
  await rpc({type: 'capture.arm', tabId: page.tabId});
  await until(() => js(page.session, `!!${card('')}`), 'the selection layer on the page');
  const from = await js(page.session, `(() => { const r = document.getElementById('closed').getBoundingClientRect(); return {x: r.left + 2, y: r.top + 2}; })()`);
  const to = await js(page.session, `(() => { const r = document.getElementById('mixed').getBoundingClientRect(); return {x: r.right - 2, y: r.bottom - 2}; })()`);
  await drag(page.session, from, to);
  await until(() => js(page.session, `${card(`.querySelector('.count')?.textContent`)} === '7 links selected'`), 'seven links in the region');
  const region = await js(page.session, `(() => { const root = ${card('')}; return {rows: [...root.querySelectorAll('.preview .t')].map((row) => row.textContent), hits: root.querySelectorAll('.hit').length, warning: root.querySelector('.warning').textContent}; })()`);
  assert.deepEqual(region, {rows: ['Closed one', 'Closed two', 'Closed one, again', 'Outer closed link', 'Inner closed link', 'Open link', 'Closed inside open'], hits: 7, warning: ''});
  // The highlights sit on the links: each closed link's box (the fixture hands its boxes to the test).
  const boxes = await js(page.session, `(() => { const root = ${card('')}; const hits = [...root.querySelectorAll('.hit')].map((hit) => hit.getBoundingClientRect()); return window.fixtureBoxes().map((box) => hits.some((hit) => Math.abs(hit.left - box.left) < 1.5 && Math.abs(hit.top - box.top) < 1.5 && Math.abs(hit.width - box.width) < 1.5)); })()`);
  assert.deepEqual(boxes, [true, true, true, true, true, true, true], 'a highlight on each closed link');
  await shot(page.session, 'coverage-closed-region.png');
  await js(page.session, `${card(`.querySelector('button.add')`)}.click(); true`);
  await until(async () => /^Saved 7 links/.test(await js(page.session, card(`.querySelector('.status').textContent`))), 'the region saved');
  const regionSaved = (await active()).links.slice(-7);
  assert.deepEqual(fields(regionSaved), COMPONENT_LINKS.slice(1, 8));
  assert.equal(regionSaved[0].context, saved[1].context);
  await js(page.session, `${card(`.querySelector('.dismiss')`)}.click(); true`);
  pass('Closed components: a region selects the links inside closed shadow roots, highlights each where it is, and saves them with their context', {selected: region.rows});

  // The right-clicked link: a closed root hides it from the event, so it is found under the pointer.
  const again = await js(page.session, `window.fixtureBoxes()[2]`);
  await mouse(page.session, 'mousePressed', again.left + 4, again.top + again.height / 2, {button: 'right', buttons: 2});
  await mouse(page.session, 'mouseReleased', again.left + 4, again.top + again.height / 2, {button: 'right'});
  const ask = (message) => js(ui, `chrome.tabs.sendMessage(${page.tabId}, ${JSON.stringify(message)}, {frameId: 0})`);
  let reply = await ask({type: 'content.contextLink', url: `${fixture.base}/c/closed-one`});
  assert.deepEqual([reply.ok, reply.data.link.anchorText, reply.data.link.context], [true, 'Closed one, again', saved[1].context], 'the right-clicked one of two links with that address');
  reply = await ask({type: 'content.contextLink', url: `${fixture.base}/c/inner`});
  assert.equal(reply.data.link.anchorText, 'Inner closed link', 'another address: found in a closed root inside a closed root');
  pass('Closed components: the right-click lookup answers the link under the pointer inside a closed shadow root, and finds any other by its address');
  await closeTab(page);

  /* 3. Frames from other sites, with only the toolbar's access. */
  await rpc({type: 'state.mutate', action: {type: 'collection.create', name: 'Frames'}});
  const framesUrl = `${fixture.base}${folder}frames.html`;
  // Every frame has loaded: until then a frame from another site holds an empty page of this site.
  const framesLoaded = `window.fixtureFramesLoaded?.() === true`;
  const frames = await open(framesUrl);
  await until(() => js(frames.session, framesLoaded), 'the frames loaded');
  await sleep(600);
  await until(async () => /Frames from other sites/.test(await text('scope-preview')), 'the frames page is the current page');
  const storedReport = () => js(ui, `(async () => (await chrome.storage.session.get('linkMeteorCaptureReport')).linkMeteorCaptureReport.report)()`);
  const reportShown = (title) => until(async () => new RegExp(`captured\\s*from ${title}`).test(await text('capture-report')), `the report for ${title}`);
  await click('#capture');
  await reportShown('Frames from other sites');
  const report = await storedReport();
  const hosts = {here: new URL(fixture.base).host, other: new URL(other).host, third: new URL(third).host};
  const NOT_READ = `6 frames weren’t read: 5 from other sites (${hosts.other} and ${hosts.third}), which Link Meteor has no access to, and 1 sandboxed frame of this site, which the toolbar’s temporary access doesn’t cover. Allow those sites and this one (${hosts.here}) to include their links.`;
  // Each unread frame is kept with its site and its place among the page's frames (none for the one inside a closed component).
  const LEFT = [{site: other, at: '0.1'}, {site: other, at: '1'}, {site: third, at: '2'}, {site: other, at: '3'}, {site: other, at: null}, {site: fixture.base, at: '4'}];
  assert.deepEqual(report.results.map((item) => [item.status, item.count, item.warning, item.frames]), [['success', 4, NOT_READ, {read: 0, unread: 6, sites: [fixture.base, other, third], left: LEFT}]]);
  // What the page itself can reach is read once, each link with the frame it was in. The hidden
  // frame from the other site is neither read nor counted.
  const READ = [
    ['Top link', '/f/top', `${folder}frames.html`],
    ['Inner link same', '/f/inner-same', `${folder}inner.html?same`],
    ['Leaf link same-nested-this', '/f/leaf-same-nested-this', `${folder}leaf.html?same-nested-this`],
    ['Written link', '/f/written', 'srcdoc'],
  ];
  const firstLinks = await batch(report.batchId);
  assert.deepEqual(fields(firstLinks), READ);
  assert.ok(firstLinks.every((link) => link.sourceUrl === framesUrl), 'every link’s source is the page');
  const shown = await js(ui, `(() => { const item = document.querySelector('#capture-report .report-item'), allow = item.querySelector('.report-frames-allow'); return {title: document.querySelector('#capture-report h3').firstChild.textContent, status: item.querySelector('.status').textContent, detail: item.querySelector('.detail.warn').textContent, label: allow.textContent, hint: allow.title, type: allow.type}; })()`);
  assert.deepEqual(shown, {title: '4 links captured', status: '4 links', detail: NOT_READ, label: 'Allow these sites', type: 'button',
    hint: `Chrome asks to allow Link Meteor on ${hosts.here}, ${hosts.other}, ${hosts.third}. Then the page’s frames from those sites are read and their links added.`});
  assert.deepEqual(await requests(), [], 'capturing asks for nothing');
  pass('Frames with only the toolbar’s access: the frames the page can reach are read once each, with their frameUrl; the five frames from other sites and the sandboxed frame are named by site in the report, which offers Allow these sites; a hidden frame is neither read nor counted', {links: fields(firstLinks), warning: NOT_READ});

  // The report's line and button: 320 px, the keyboard, and measured contrast in light and dark.
  const contrast = (pairs) => js(ui, `(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d', {willReadFrequently: true});
    const rgb = (color) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
    const lum = (c) => c.map((n) => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((s, n, i) => s + n * [.2126, .7152, .0722][i], 0);
    const bg = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(c) && !/\\/ 0\\)$/.test(c)) return c; } return getComputedStyle(document.body).backgroundColor; };
    return ${JSON.stringify(pairs)}.map(([name, selector]) => { const el = document.querySelector(selector); if (!el) return {name, missing: true}; const a = lum(rgb(getComputedStyle(el).color)), b = lum(rgb(bg(el))); return {name, ratio: Math.round(((Math.max(a, b) + .05) / (Math.min(a, b) + .05)) * 100) / 100}; });
  })()`);
  const pairs = [['frames line', '#capture-report .report-item .detail.warn'], ['Allow these sites', '#capture-report .report-frames-allow'], ['page name', '#capture-report .report-item .page'], ['status', '#capture-report .report-item .status']];
  const measured = [];
  await width(ui, 320);
  await js(ui, `document.getElementById('capture-report').scrollIntoView({block: 'start'}); true`);
  for (const scheme of ['light', 'dark']) {
    await rpc({type: 'state.mutate', action: {type: 'settings.update', patch: {appearance: scheme}}});
    await until(() => js(ui, `document.documentElement.dataset.scheme === ${JSON.stringify(scheme)}`), `${scheme} appearance`);
    await sleep(300);
    for (const entry of await contrast(pairs)) { assert.ok(!entry.missing, `${scheme} ${entry.name} missing`); assert.ok(entry.ratio >= 4.5, `${scheme} ${entry.name} contrast ${entry.ratio}`); measured.push({scheme, ...entry}); }
    assert.equal(await js(ui, 'document.documentElement.scrollWidth > innerWidth'), false, `no horizontal overflow at 320 px (${scheme})`);
    assert.equal(await js(ui, `(() => { const box = document.getElementById('capture-report').getBoundingClientRect(); return [...document.querySelectorAll('#capture-report *')].some((el) => { const r = el.getBoundingClientRect(); return r.width && (r.right > box.right + 0.5 || r.left < box.left - 0.5); }); })()`), false, `nothing leaves the report at 320 px (${scheme})`);
    await shot(ui, `coverage-frames-report-320-${scheme}.png`);
  }
  await rpc({type: 'state.mutate', action: {type: 'settings.update', patch: {appearance: 'system'}}});
  // The button is reached with Tab from the report's Dismiss button, and shows a focus ring.
  await js(ui, `document.querySelector('#capture-report .report-head button').focus(); true`);
  await browser.send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9}, ui);
  await browser.send('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9}, ui);
  const focused = await js(ui, `(() => { const el = document.activeElement, style = getComputedStyle(el); return {allow: el.classList.contains('report-frames-allow'), ring: style.outlineStyle, wide: parseFloat(style.outlineWidth) >= 2, tall: el.getBoundingClientRect().height >= 24}; })()`);
  assert.deepEqual(focused, {allow: true, ring: 'solid', wide: true, tall: true});
  await width(ui, 1280);
  pass('The report’s frames line and Allow these sites at 320 px: nothing overflows, the button is reached by keyboard with a visible focus ring, and text contrast is at least 4.5:1 in light and dark', {contrast: measured});

  // Allow these sites, with Chrome's answer simulated: a decline changes nothing and says so.
  const linkCount = async () => (await active()).links.length;
  const before = await linkCount();
  await click('#capture-report .report-frames-allow');
  await until(async () => /was declined/.test(await text('error')), 'the decline is said');
  const ASKED = [{origins: [`${fixture.base}/*`, `${other}/*`, `${third}/*`]}];
  assert.deepEqual(await requests(), ASKED, 'one request, for exactly the named sites');
  assert.equal(await text('error').then((value) => value.replace(/\s*Dismiss\s*$/, '')), `Chrome’s request for access to ${hosts.here}, ${hosts.other} and ${hosts.third} was declined, so nothing changed. The frames from those sites are still not read.`);
  assert.deepEqual([await linkCount(), (await storedReport()).capturedCount, await js(ui, `document.querySelector('#capture-report .report-frames-allow').disabled`)], [before, 4, false]);
  pass('Allow these sites asks Chrome once, in the click, for exactly the sites the report names; a decline (simulated) changes nothing and says so', {asked: ASKED});

  // A simulated accept gives no real access, so the page is read again and the frames still can't
  // be read: nothing is added, nothing is counted twice, and the report still says what is left.
  await answerPrompts(true);
  await click('#capture-report .report-frames-allow');
  await until(async () => /still couldn’t be read/.test(await text('notice')), 'the second reading is reported');
  assert.deepEqual(await requests(), ASKED);
  assert.equal(await text('notice'), `Link Meteor now has access to ${hosts.here}, ${hosts.other} and ${hosts.third}, but the frames from those sites still couldn’t be read. The capture report says what is left.`);
  const after = await storedReport();
  assert.deepEqual([await linkCount(), after.batchId, after.capturedCount, after.results[0].count, after.results[0].warning, after.results[0].frames], [before, report.batchId, 4, 4, NOT_READ, report.results[0].frames]);
  assert.deepEqual(fields(await batch(report.batchId)), READ, 'the links of the first reading, none of them twice');
  assert.deepEqual(await js(ui, `(() => { const allow = document.querySelector('#capture-report .report-frames-allow'); return [allow.textContent, allow.disabled, document.activeElement === allow, document.querySelector('#capture-report h3').firstChild.textContent]; })()`), ['Allow these sites', false, true, '4 links captured']);
  // Refused in plain words: a capture whose report is no longer the kept one.
  const refused = (message) => js(ui, `chrome.runtime.sendMessage(${JSON.stringify(message)}).then((r) => r.ok ? 'accepted' : r.error)`);
  assert.equal(await refused({type: 'capture.frames', tabId: frames.tabId, batchId: 'not-this-capture'}), 'That capture’s report is no longer kept. Capture the page again to include its frames.');
  await answerPrompts(false);
  // What the notice says when frames are read after a real Allow (the words only; the granted check sees them for real).
  const words = await js(ui, `import(chrome.runtime.getURL('ui/workbench/frames.js')).then(({framesAdded}) => [
    framesAdded({count: 7, skipped: 0, leftOut: 0, frames: 6}, ['http://a.example', 'http://b.example']), framesAdded({count: 1, skipped: 2, leftOut: 1, frames: 1}, ['http://a.example']),
    framesAdded({count: 0, skipped: 0, leftOut: 0, frames: 2}, ['http://a.example']), framesAdded({count: 0, skipped: 3, leftOut: 0, frames: 1}, ['http://a.example']), framesAdded({count: 0, skipped: 0, leftOut: 0, frames: 0}, ['http://a.example'])])`);
  assert.deepEqual(words, ['Added 7 links from 6 more frames.', 'Added 1 link from 1 more frame. Skipped 2 links already saved. Left out 1 navigation link.', 'Read 2 more frames: no links Link Meteor can read there.',
    'Read 1 more frame: nothing new was added. Skipped 3 links already saved.', 'Link Meteor now has access to a.example, but the frames from that site still couldn’t be read. The capture report says what is left.']);
  pass('After Chrome allows the sites (simulated, so without real access) the page is read again into the same capture: nothing is added twice, the report is kept as it was, and the notice says the frames still couldn’t be read; a request for another capture is refused', {notice: await text('notice')});

  // A region on that page: frames from other sites can't be selected, and the card says how many.
  await rpc({type: 'capture.arm', tabId: frames.tabId});
  await until(() => js(frames.session, `!!${card('')}`), 'the selection layer on the frames page');
  const whole = await js(frames.session, `(() => { const r = document.querySelector('main').getBoundingClientRect(); return {from: {x: r.left + 2, y: Math.max(2, r.top + 2)}, to: {x: r.right - 2, y: Math.min(innerHeight - 4, r.bottom - 2)}}; })()`);
  await drag(frames.session, whole.from, whole.to);
  await until(() => js(frames.session, `/links? selected$/.test(${card(`.querySelector('.count')?.textContent`)} || '')`), 'a region on the frames page');
  const regionFrames = await js(frames.session, `(() => { const root = ${card('')}; return {rows: [...root.querySelectorAll('.preview .t')].map((row) => row.textContent), warning: root.querySelector('.warning').textContent}; })()`);
  assert.deepEqual(regionFrames.rows.filter((row) => /nested-other|other|third|aside|component/.test(row)), [], 'no link from a frame the page can’t reach');
  assert.equal(regionFrames.warning, `Links inside 6 frames aren’t included: a selection can’t reach into frames from other sites (${hosts.other} and ${hosts.third}) or sandboxed frames. Capture this page reads them where Link Meteor has access.`);
  await js(frames.session, `${card(`.querySelector('.dismiss')`)}.click(); true`);
  pass('A region on a page with frames from other sites: their links can’t be selected, and the card counts those frames and names their sites', {rows: regionFrames.rows, warning: regionFrames.warning});
  await closeTab(frames);

  // One other site and no sandboxed frame: the words and the button are singular.
  const single = await open(`${framesUrl}?without=third,sandboxed`);
  await until(() => js(single.session, framesLoaded), 'the frames loaded again');
  await sleep(600);
  const singleRun = await rpc({type: 'capture.run', tabIds: [single.tabId]});
  assert.deepEqual([singleRun.report.results[0].count, singleRun.report.results[0].warning, singleRun.report.results[0].frames],
    [4, `4 frames from another site weren’t read, because Link Meteor has no access to ${hosts.other}. Allow that site to include their links.`, {read: 0, unread: 4, sites: [other], left: [{site: other, at: '0.1'}, {site: other, at: '1'}, {site: other, at: '2'}, {site: other, at: null}]}]);
  await until(async () => (await js(ui, `document.querySelector('#capture-report .report-frames-allow')?.textContent`)) === 'Allow this site', 'the report offers Allow this site');
  await click('#capture-report .report-frames-allow');
  await until(async () => /was declined/.test(await text('error')), 'the single decline is said');
  assert.deepEqual(await requests(), [{origins: [`${other}/*`]}]);
  await closeTab(single);
  pass('One other site: the report says “another site”, the button says Allow this site, and it asks for that one site');

  /* 4. Frames that aren't ready don't hold the capture. */
  const loading = await open(`${fixture.base}${folder}loading.html`);
  await until(() => js(loading.session, `document.getElementById('slow-other').contentDocument === null`), 'the other site’s slow frame began to load');
  const started = Date.now();
  const loadingRun = await rpc({type: 'capture.run', tabIds: [loading.tabId]});
  const took = Date.now() - started;
  const loadingLinks = fields(await batch(loadingRun.report.batchId));
  assert.ok(took < 8000, `the capture took ${took} ms`);
  assert.deepEqual(loadingLinks.filter(([name]) => name !== 'Slow link'), [['Loading top link', '/f/loading-top', `${folder}loading.html`]]);
  assert.ok(loadingLinks.filter(([name]) => name === 'Slow link').length <= 1, 'the frame still loading is read at most once');
  assert.deepEqual([loadingRun.report.results[0].status, loadingRun.report.results[0].frames, loadingRun.report.results[0].warning],
    ['success', {read: 0, unread: 1, sites: [other], left: [{site: other, at: '1'}]}, `1 frame from another site wasn’t read, because Link Meteor has no access to ${hosts.other}. Allow that site to include its links.`]);
  assert.equal(await js(loading.session, `document.getElementById('lazy').contentDocument.URL`), 'about:blank', 'the lazy frame was never loaded');
  await closeTab(loading);
  pass('A frame that never finishes loading and a lazy frame not yet loaded don’t hold the capture: the page is read as it is', {ms: took, links: loadingLinks});

  result.result = 'PASS';
} catch (error) {
  result.result = 'FAIL'; result.error = error.stack; console.error(error); process.exitCode = 1;
} finally {
  for (const res of held) res.destroy();
  await browser.close(); await fixture.close();
  result.finished = new Date().toISOString();
  await writeFile(resolve(evidence, 'coverage-browser-results.json'), JSON.stringify(result, null, 2) + '\n').catch(() => {});
}
