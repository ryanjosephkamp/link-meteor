// Runs (0.6.0) on the loaded extension, with no optional grants: Chrome for Testing, headless, a
// fresh temporary profile under .scratch/ (deleted afterwards), the real unpacked build, and
// Chrome's own toolbar action (tests/helpers/action.mjs) for temporary page access. The workbench
// in its own window stands in for the side panel. It checks:
// - Scroll to the end first: the counter and Stop in the workbench and on the page, the report's
//   line and Undo;
// - Follow Next through a paged fixture site with one toolbar click: every page in the same tab,
//   1.5 seconds apart, one batch, the report and Undo; the cap; a loop; a next page on another site
//   (not opened); a page that doesn't load; Stop in the workbench; Escape on the page; the tab
//   closed by the person; only one run at a time, shown in a workbench opened meanwhile;
// - Capture their pages…: the panel's words, the sites it needs, one request naming exactly those
//   sites (Chrome's prompt is stubbed: a simulated decline, then a simulated grant that the
//   background still checks, so every page is reported "No access" and none is opened), the
//   refusal above 20, and the same panel from a link's details;
// - a PDF among selected pages: the view's part, reading the PDF in its tab when asked;
// - the 320 px layout, and text contrast in every theme, light and dark.
// Nothing leaves the fixture server and nothing downloads.
//   npm run build && LINK_METEOR_FIXTURE_PORT=52620 node tests/runs-browser.mjs
// Writes runs-browser-results.json to the evidence folder.
import assert from 'node:assert/strict';
import {mkdir, readdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixtureServer, evidence} from './helpers/browser.mjs';
import {launchWithAction} from './helpers/action.mjs';
import {fixture as pdfFixture, readPdf} from './helpers/pdf.mjs';
import {THEME_IDS} from '../src/core/themes.js';

const result = {started: new Date().toISOString(), browser: 'Chrome for Testing, headless, fresh temporary profile, real unpacked extension, no optional grants; Chrome’s real toolbar action; permission requests are stubbed', checks: [], screenshots: []};
const pass = (name, data = {}) => { result.checks.push({name, ...data}); console.log('PASS', name, Object.keys(data).length ? JSON.stringify(data) : ''); };
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Every request the fixture server gets, with its time; /hang never answers and /gone hangs up.
const requests = [], hanging = new Set();
const fixture = await fixtureServer({routes: (req, res, url) => {
  requests.push({host: req.headers.host, path: url.pathname + url.search, at: Date.now()});
  if (url.pathname === '/hang') { hanging.add(res); req.on('close', () => hanging.delete(res)); return true; }
  if (url.pathname === '/gone') { req.socket.destroy(); return true; }
  return false;
}});
const browser = await launchWithAction({profilePrefix: 'runs-profile-'});
const listing = (query) => `${fixture.base}/site/runs/page.html?${query}`;
const pageRequests = (since) => requests.filter((request) => request.at >= since && /^\/(site\/runs\/page\.html|hang|gone)/.test(request.path));

const js = (session, expression) => browser.evaluate(session, expression);
async function until(fn, message, timeout = 10000) {
  const start = Date.now(); let last;
  while (Date.now() - start < timeout) { last = await fn(); if (last) return last; await sleep(80); }
  throw new Error(`${message} (timed out; last: ${JSON.stringify(last)})`);
}
async function width(session, w, h = 900) { await browser.send('Emulation.setDeviceMetricsOverride', {width: w, height: h, deviceScaleFactor: 1, mobile: false}, session); await sleep(250); }
async function shot(session, name) {
  const {data} = await browser.send('Page.captureScreenshot', {format: 'png'}, session);
  await writeFile(resolve(evidence, name), Buffer.from(data, 'base64')); result.screenshots.push(name);
}
async function key(session, name) {
  const code = {Enter: 13, Tab: 9, Escape: 27, ' ': 32}[name];
  await browser.send('Input.dispatchKeyEvent', {type: 'keyDown', key: name, code: name === ' ' ? 'Space' : name, windowsVirtualKeyCode: code, ...(name === 'Enter' ? {text: '\r'} : name === ' ' ? {text: ' '} : {})}, session);
  await browser.send('Input.dispatchKeyEvent', {type: 'keyUp', key: name, code: name === ' ' ? 'Space' : name, windowsVirtualKeyCode: code}, session);
}
// Rasterizes any CSS color to sRGB, then computes WCAG contrast against the nearest opaque background.
const CONTRAST = `(pairs) => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d', {willReadFrequently: true});
  const rgb = (color) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const lum = (c) => c.map((n) => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((s, n, i) => s + n * [.2126, .7152, .0722][i], 0);
  const bg = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(c) && !/\\/ 0\\)$/.test(c)) return c; } return getComputedStyle(document.body).backgroundColor; };
  return pairs.map(([name, selector]) => { const el = document.querySelector(selector); if (!el || !el.getClientRects().length) return {name, missing: true}; const a = lum(rgb(getComputedStyle(el).color)), b = lum(rgb(bg(el))); return {name, ratio: Math.round(((Math.max(a, b) + .05) / (Math.min(a, b) + .05)) * 100) / 100}; });
}`;
const contrast = (session, pairs) => js(session, `(${CONTRAST})(${JSON.stringify(pairs)})`);
const overflow = (session) => js(session, 'document.documentElement.scrollWidth > innerWidth');

try {
  await mkdir(evidence, {recursive: true});
  const {targetId: uiTarget} = await browser.newWindow(browser.extensionUrl());
  const ui = await browser.attach(uiTarget);
  await until(() => js(ui, `!!document.getElementById('collection-heading') && !!window.chrome?.runtime`), 'workbench loaded');
  await width(ui, 1280, 1000);
  await sleep(600);
  const rpc = (message) => js(ui, `chrome.runtime.sendMessage(${JSON.stringify(message)}).then((r) => { if (!r?.ok) throw new Error(r?.error || 'no response'); return r.data; })`);
  const rpcError = (message) => js(ui, `chrome.runtime.sendMessage(${JSON.stringify(message)}).then((r) => r.ok ? '' : r.error)`);
  const state = () => rpc({type: 'state.get'});
  const $ = (id) => `document.getElementById(${JSON.stringify(id)})`;
  const click = (id) => js(ui, `${$(id)}.click()`);
  const text = (id) => js(ui, `${$(id)}.innerText`);
  const visible = (id) => js(ui, `!${$(id)}.closest('[hidden]') && ${$(id)}.getClientRects().length > 0`);
  const disabled = (id) => js(ui, `${$(id)}.disabled`);
  const check = (id, on) => js(ui, `(() => { const box = ${$(id)}; if (box.checked !== ${on}) box.click(); return box.checked; })()`);
  const notice = () => js(ui, `document.querySelector('#notice:not([hidden]) .msg')?.innerText || ''`);
  const error = () => js(ui, `document.querySelector('#error:not([hidden]) .msg')?.innerText || ''`);
  const quiet = () => js(ui, `(() => { for (const id of ['notice', 'error']) document.getElementById(id).hidden = true; return true; })()`);
  const report = () => js(ui, `(() => { const box = document.getElementById('capture-report'); if (box.hidden) return null;
    return {head: box.querySelector('.run-head strong')?.innerText || '', title: box.querySelector('.run-head')?.innerText || box.querySelector('h3')?.innerText || '', note: box.querySelector('.run-note')?.innerText || '', scroll: box.querySelector('.report-scroll span')?.innerText || '',
      undo: !!box.querySelector('.run-head .link-btn, .report-scroll .link-btn'),
      columns: [...box.querySelectorAll('.run-table th')].map((cell) => cell.innerText),
      rows: [...box.querySelectorAll('.run-table tbody tr')].map((row) => [...row.cells].map((cell) => cell.innerText))}; })()`);
  const running = () => rpc({type: 'run.status'}).then(({run}) => run && run.state !== 'done' ? run : null);
  const idle = (timeout = 60000) => until(async () => !(await running()), 'the run to end', timeout);
  const collection = async (name) => (await state()).collections.find((item) => item.name === name);
  // A new, open collection for each check, so its links are that check's alone.
  const fresh = async (name) => { await rpc({type: 'state.mutate', action: {type: 'collection.create', name}}); await until(async () => (await text('collection-heading')).trim() === name, `collection ${name} open`); };
  // The page's own notice.
  const pageNotice = (session) => js(session, `(() => { const root = document.getElementById('link-meteor-run-notice')?.shadowRoot; return root ? {text: root.querySelector('.run-text').textContent, stop: !root.querySelector('.run-stop').hidden} : null; })()`);

  await rpc({type: 'state.mutate', action: {type: 'settings.update', patch: {welcomeSeen: true}}});
  // Stands in for Chrome's prompt: records each request and answers as the check says.
  await js(ui, `(() => { window.__requests = []; window.__answer = false; chrome.permissions.request = async (request) => { window.__requests.push({request, activeGesture: navigator.userActivation.isActive}); return window.__answer; }; return true; })()`);

  // The tab the runs read, with the toolbar's temporary access and nothing more.
  const {targetId: pageTarget} = await browser.newTab(`${fixture.base}/site/runs/feed.html?batches=3`);
  const page = await browser.attach(pageTarget);
  await width(page, 1100, 700);
  await until(() => js(page, `document.querySelectorAll('.item').length === 10`), 'the feed');
  assert.equal(await browser.clickAction(fixture.base), 'clicked');
  await until(async () => /Field notes feed/.test(await text('scope-preview')), 'the workbench sees the tab');
  await sleep(600);
  // Moves the tab the runs read. A page Chrome couldn't load ends the toolbar's access to the tab, as
  // another site would, so each move ends with one more toolbar click.
  const go = async (url, ready) => { await browser.navigate(page, url); await until(() => js(page, ready), `the page ${url}`); assert.equal(await browser.clickAction(fixture.base), 'clicked'); await sleep(600); };
  const counter = (pattern) => async () => (await visible('run-progress')) && pattern.test(await text('run-text'));
  assert.equal(await js(ui, `chrome.permissions.contains({origins: ['${fixture.base}/*']})`), false, 'no site access: only the toolbar click');

  /* 1. The two choices under Capture this page. */
  assert.equal(await visible('capture-further'), true);
  assert.deepEqual(await js(ui, `[...document.querySelectorAll('#capture-further small')].map((item) => item.innerText)`), [
    'For pages that load more as you scroll. Stops at the end, at 50 screens, at 5,000 links or after 2 minutes.',
    'Moves this tab to the page’s own Next link and captures each page. Stops when there is no Next or the next page is on a site Link Meteor can’t read.']);
  assert.deepEqual(await js(ui, `[${$('further-scroll')}.checked, ${$('further-next')}.checked, ${$('follow-pages')}.value, ${$('capture-further')}.getAttribute('role'), ${$('capture-further')}.getAttribute('aria-label')]`), [false, false, '20', 'group', 'Go further than this screen']);
  assert.deepEqual(await js(ui, `[${$('further-scroll')}.labels[0].innerText.split('\\n')[0], ${$('further-next')}.getAttribute('aria-label'), ${$('follow-pages')}.getAttribute('aria-label')]`), ['Scroll to the end first', 'Follow Next', 'Pages to follow, 2 to 20']);
  // The choices belong to This page and the links in it.
  await js(ui, `document.querySelector('input[name="capture-what"][value="tabs"]').click()`);
  assert.equal(await visible('capture-further'), false, 'hidden when saving the tabs themselves');
  await js(ui, `document.querySelector('input[name="capture-what"][value="links"]').click()`);
  assert.equal(await visible('capture-further'), true);
  // The number of pages is saved, and only 2 to 20 are taken.
  await js(ui, `(() => { const input = ${$('follow-pages')}; input.value = '25'; input.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  await until(async () => /Follow Next reads 2 to 20 pages in one run\./.test(await error()), 'the refusal of 25 pages');
  assert.equal((await state()).settings.followPages, 20);
  assert.equal(await js(ui, `${$('follow-pages')}.value`), '20');
  await quiet();
  pass('Under Capture this page: Scroll to the end first and Follow Next, each with its limits in words; the number of pages takes 2 to 20');

  /* 2. Scroll to the end first, alone. */
  await fresh('Scrolled');
  await check('further-scroll', true);
  await click('capture');
  await until(() => visible('run-progress'), 'the progress line');
  assert.equal(await js(ui, `${$('run-progress')}.getAttribute('role')`), 'status');
  assert.equal(await text('run-title'), 'Scrolling the page');
  await until(async () => /^Scrolling: screen \d+ of up to 50 · \d+ links so far$/.test(await text('run-text')), 'the scroll counter');
  assert.deepEqual([await disabled('capture'), await disabled('arm'), await disabled('further-scroll'), await disabled('run-stop')], [true, true, true, false]);
  await until(async () => /^Scrolling: screen \d+ of up to 50 · \d+ links$/.test((await pageNotice(page))?.text || ''), 'the counter on the page');
  assert.equal((await pageNotice(page)).stop, true);
  assert.match(await rpcError({type: 'run.start', kind: 'next', collectionId: (await state()).activeCollectionId}), /already running a capture/);
  await until(async () => /^Capture finished: 61 links from this page\. Reached the end after \d+ screens\.$/.test(await notice()), 'the scroll’s notice', 60000);
  assert.equal(await visible('run-progress'), false);
  assert.deepEqual([await disabled('capture'), await disabled('arm'), await disabled('further-scroll')], [false, false, false]);
  let shown = await report();
  assert.match(shown.title, /^61 links captured/);
  assert.match(shown.scroll, /^Scrolled \d+ screens to the end of the page\.$/);
  assert.equal(shown.undo, true);
  let home = await collection('Scrolled');
  assert.equal(home.links.length, 61);
  assert.equal(new Set(home.links.map((link) => link.batchId)).size, 1, 'one batch');
  assert.deepEqual(home.links.filter((link) => /^Field note \d+$/.test(link.anchorText)).map((link) => link.anchorText), Array.from({length: 30}, (_, i) => `Field note ${i + 1}`));
  assert.match((await pageNotice(page)).text, /^Reached the end after \d+ screens\. 61 links found\.$/);
  await js(ui, `document.querySelector('#capture-report .report-scroll .link-btn').click()`);
  await until(async () => (await notice()) === 'Undone: removed 61 links from “Scrolled”.', 'the Undo notice');
  assert.equal((await collection('Scrolled')).links.length, 0);
  assert.equal((await report()).undo, false);
  assert.match(await js(ui, `document.querySelector('#capture-report .report-scroll').innerText`), /Undone: removed 61 links\.$/, 'the report says it is undone');
  await check('further-scroll', false);
  pass('Scroll to the end first: a counter with Stop in the workbench and on the page, every batch of the feed in one batch of links, and Undo', {links: 61});

  /* 3. Follow Next through a paged site, with one toolbar click. */
  await go(listing('of=3&next=text'), `document.title === 'Listing, page 1'`);
  await until(async () => /Listing, page 1/.test(await text('scope-preview')), 'the workbench sees the listing');
  await fresh('Followed');
  await check('further-next', true);
  let since = Date.now();
  await click('capture');
  await until(() => visible('run-progress'), 'the progress line');
  assert.equal(await text('run-title'), 'Following Next');
  await until(async () => /^Page [1-3] of up to 20 · \d+ links so far( · now on “Listing, page [1-3]”)?$/.test(await text('run-text')), 'the run’s counter');
  assert.equal(await js(ui, 'document.activeElement.id'), 'run-stop', 'focus is on Stop');
  await until(async () => /^Following Next: page [1-3] of up to 20 · \d+ links?$/.test((await pageNotice(page))?.text || ''), 'the counter on the page');
  // A workbench opened meanwhile shows the run too.
  const {targetId: secondTarget} = await browser.newWindow(browser.extensionUrl());
  const second = await browser.attach(secondTarget);
  await until(() => js(second, `!!document.getElementById('run-progress') && !document.getElementById('run-progress').hidden`), 'the run in a workbench opened meanwhile');
  assert.equal(await js(second, `document.getElementById('run-title').innerText`), 'Following Next');
  assert.equal(await js(second, `document.getElementById('capture').disabled`), true);
  await browser.send('Target.closeTarget', {targetId: secondTarget});
  await until(async () => /^Followed Next through 3 pages/.test(await notice()), 'the run’s notice', 60000);
  assert.equal(await notice(), 'Followed Next through 3 pages: added 40 links to “Followed”. Page 3 has no Next link.');
  assert.equal(await visible('run-progress'), false);
  shown = await report();
  assert.equal(shown.head, 'Followed Next through 3 pages: added 40 links to “Followed”.');
  assert.deepEqual(shown.columns, ['Page', 'Title', 'Found', 'Added', 'How it ended']);
  assert.deepEqual(shown.rows, [['1', 'Listing, page 1', '13', '13', 'Captured'], ['2', 'Listing, page 2', '14', '14', 'Captured'], ['3', 'Listing, page 3', '13', '13', 'Captured']]);
  assert.equal(shown.note, 'Page 3 has no Next link. Your tab is on page 3. The links from all 3 pages are one batch, so Undo removes them together.');
  home = await collection('Followed');
  assert.equal(home.links.length, 40);
  assert.equal(new Set(home.links.map((link) => link.batchId)).size, 1, 'one batch');
  assert.deepEqual([...new Set(home.links.map((link) => link.sourceTitle))], ['Listing, page 1', 'Listing, page 2', 'Listing, page 3'], 'each link keeps the page it was on');
  assert.equal(await js(page, 'document.title'), 'Listing, page 3', 'the same tab was moved');
  assert.deepEqual(await pageNotice(page), {text: 'Followed Next through 3 pages: added 40 links to “Followed”. Page 3 has no Next link.', stop: false});
  const loads = pageRequests(since).map((request) => request.at);
  assert.equal(loads.length, 2, 'two pages were loaded, each once');
  assert.ok(loads[1] - loads[0] >= 1500, `pages are at least 1.5 seconds apart (${loads[1] - loads[0]} ms)`);
  assert.equal(await js(ui, `chrome.permissions.contains({origins: ['${fixture.base}/*']})`), false, 'still no site access');
  // Undo removes all three pages' links together.
  await js(ui, `document.querySelector('#notice button').click()`);
  await until(async () => (await notice()) === 'Undone: removed 40 links from “Followed”.', 'the Undo notice');
  assert.equal((await collection('Followed')).links.length, 0);
  assert.match((await report()).title, /Undone: removed 40 links\./);
  assert.equal((await report()).undo, false);
  assert.match(await rpcError({type: 'run.undo', collectionId: home.id, batchId: home.links[0].batchId}), /can no longer be undone/);
  pass('Follow Next reads three pages in the same tab after one toolbar click, 1.5 seconds apart, as one batch; the report lists each page; Undo removes them together', {links: 40, gapMs: loads[1] - loads[0]});

  /* 4. The cap, with Scroll to the end first on each page. */
  await go(listing('of=3&next=aria&tall=1'), `document.title === 'Listing, page 1'`);
  await fresh('Capped');
  await js(ui, `(() => { const input = ${$('follow-pages')}; input.value = '2'; input.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  await until(async () => (await state()).settings.followPages === 2, 'followPages saved');
  await check('further-scroll', true);
  await click('capture');
  await until(async () => /^Followed Next through 2 pages/.test(await notice()), 'the capped run', 60000);
  assert.equal(await notice(), 'Followed Next through 2 pages: added 27 links to “Capped”. Stopped at 2 pages, the limit you set. The last page has a Next link.');
  shown = await report();
  assert.equal(shown.rows.length, 2);
  assert.match(shown.rows[0][4], /^Captured · scrolled \d+ screens to the end$/);
  assert.match(shown.note, /^Stopped at 2 pages, the limit you set\. The last page has a Next link\. Your tab is on page 2\./);
  assert.equal(await js(page, 'document.title'), 'Listing, page 2');
  await check('further-scroll', false);
  await js(ui, `(() => { const input = ${$('follow-pages')}; input.value = '20'; input.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  await until(async () => (await state()).settings.followPages === 20, 'followPages back to 20');
  pass('The cap: with 2 pages set, the run stops at page 2 and says the page has a Next link; with Scroll to the end first, each page is scrolled');

  /* 5. A loop, a next page on another site, and a page that doesn't load. */
  const follow = async (query, name, ends, timeout = 60000) => {
    await go(listing(query), `document.title === 'Listing, page 1'`);
    await fresh(name);
    since = Date.now();
    await click('capture');
    await until(async () => (await notice()).endsWith(ends), `${name}: ${ends}`, timeout);
    return report();
  };
  shown = await follow('p=1&of=2&next=raquo&after=loop', 'Looped', 'Next goes to a page already read in this run.');
  assert.deepEqual(shown.rows.map((row) => row[4]), ['Captured', 'Captured']);
  assert.equal(pageRequests(since).length, 1, 'page 1 was not loaded again');
  shown = await follow('of=1&next=arrow&after=other', 'Crossed', `Next goes to localhost:${new URL(fixture.base).port}, which Link Meteor has no access to.`);
  assert.equal(shown.rows.length, 1);
  assert.equal(requests.filter((request) => request.at >= since && request.host.startsWith('localhost')).length, 0, 'the other site was not opened');
  assert.equal(await js(page, 'location.host'), new URL(fixture.base).host, 'the tab stayed where it was');
  // Chrome hides an error page from Link Meteor as it hides another site, so the words cover both.
  shown = await follow('of=1&next=older&after=gone', 'Gone', 'Next led to a page Link Meteor can’t read: it didn’t load, or it is on a site Link Meteor has no access to.');
  assert.deepEqual(shown.rows.map((row) => row[4]), ['Captured', 'Not read: it didn’t load, or it moved to a site without access']);
  shown = await follow('of=1&next=rel-link&after=hang', 'Hung', 'The next page didn’t load within 30 seconds.', 60000);
  assert.deepEqual(shown.rows.map((row) => [row[0], row[2], row[4]]), [['1', '12', 'Captured'], ['2', '', 'Didn’t load within 30 seconds']]);
  assert.equal((await collection('Hung')).links.length, 12, 'what was read is kept');
  for (const res of hanging) res.destroy();
  pass('Follow Next ends, each in its own words: a loop, a next page on a site without access (not opened), a page Chrome can’t load, and a page that doesn’t load in 30 seconds');

  /* 6. Stop in the workbench, and Escape on the page. */
  await go(listing('of=12&next=text-page'), `document.title === 'Listing, page 1'`);
  await fresh('Stopped');
  await click('capture');
  await until(counter(/^Page 2 of up to 20/), 'page 2 of the run', 30000);
  await js(ui, `${$('run-stop')}.focus()`);
  await key(ui, 'Enter');
  await until(async () => (await notice()).endsWith('You pressed Stop.'), 'the stopped run', 30000);
  shown = await report();
  assert.equal(shown.rows[0][4], 'Captured');
  assert.equal(shown.rows.at(-1)[4], 'Not read: you pressed Stop');
  assert.ok(shown.rows.length <= 3);
  home = await collection('Stopped');
  assert.ok(home.links.length >= 13, 'what it had is kept');
  assert.equal(await visible('run-progress'), false);
  const stoppedAt = shown.rows.length;
  await go(listing('of=12&next=text-page'), `document.title === 'Listing, page 1'`);
  await fresh('Escaped');
  await click('capture');
  await until(async () => /page 2 of up to 20/.test((await pageNotice(page))?.text || ''), 'page 2 on the page', 30000);
  await key(page, 'Escape');
  await until(async () => (await notice()).endsWith('You pressed Stop.'), 'the run stopped from the page', 30000);
  assert.ok((await collection('Escaped')).links.length >= 13);
  pass('Stop in the workbench (by keyboard) and Escape on the page each end the run; what it had is kept, and the report says so', {rows: stoppedAt});

  /* 7. The tab closed by the person. */
  const {targetId: doomedTarget} = await browser.newTab(listing('of=12&next=text&doomed=1'));
  const doomed = await browser.attach(doomedTarget);
  await until(() => js(doomed, `document.title === 'Listing, page 1'`), 'the second tab');
  assert.equal(await browser.clickAction(listing('of=12&next=text&doomed=1')), 'clicked');
  await sleep(1000);
  await fresh('Closed');
  await until(async () => /Listing, page 1/.test(await text('scope-preview')), 'the workbench sees the second tab');
  await click('capture');
  await until(counter(/^Page 2 of up to 20/), 'page 2 of the run', 30000);
  await browser.send('Target.closeTarget', {targetId: doomedTarget});
  await until(async () => (await notice()).endsWith('The tab was closed.'), 'the run ended by the closed tab', 30000);
  assert.ok((await collection('Closed')).links.length >= 13);
  assert.match((await report()).rows.at(-1)[4], /the tab was closed$/i);
  await check('further-next', false);
  pass('Closing the tab ends the run, with what it had kept');

  /* A PDF among selected pages: the view reads it in its tab when the background asks (run.pdf)
     and answers with its links (run.pdfLinks). Without site access the background never opens a
     page, so here a second view asks in its place, about a PDF tab with the toolbar's access. */
  const tabIds = () => js(ui, 'chrome.tabs.query({}).then((tabs) => tabs.map((tab) => tab.id))');
  const idsBefore = new Set(await tabIds());
  const pdfUrl = `${fixture.base}/pdf/paper.pdf`;
  const {targetId: pdfTarget} = await browser.newTab(pdfUrl);
  await sleep(1800);
  const pdfTabId = (await tabIds()).find((id) => !idsBefore.has(id));
  assert.equal(await browser.clickAction(pdfUrl), 'clicked');
  await sleep(800);
  await js(ui, `(() => { window.__answers = []; const original = chrome.runtime.sendMessage.bind(chrome.runtime); chrome.runtime.sendMessage = (message) => { if (message?.type === 'run.pdfLinks') window.__answers.push(message); return original(message); }; return true; })()`);
  const {targetId: askerTarget} = await browser.newWindow(browser.extensionUrl());
  const asker = await browser.attach(askerTarget);
  await until(() => js(asker, `!!document.getElementById('collection-heading') && !!window.chrome?.runtime`), 'the view that asks');
  await js(asker, `chrome.runtime.sendMessage(${JSON.stringify({type: 'run.pdf', runId: 'run-pdf-check', step: 2, tabId: pdfTabId, url: pdfUrl, title: 'paper.pdf'})}).then(() => true, () => true)`);
  const answered = await until(() => js(ui, 'window.__answers[0]'), 'the view’s answer', 30000);
  const asNode = await readPdf(await pdfFixture('paper.pdf'), {address: pdfUrl});
  assert.deepEqual([answered.type, answered.runId, answered.step, answered.pageCount, answered.internal], ['run.pdfLinks', 'run-pdf-check', 2, asNode.pageCount, asNode.internal]);
  assert.deepEqual(answered.links.map((link) => [link.url, link.anchorText, link.pdfPage, link.context || '']), asNode.links.map((link) => [link.url, link.anchorText, link.pdfPage, link.context || '']), 'the links, their words, pages and context, as the file reads in Node');
  assert.ok(answered.links.length > 0 && answered.links.every((link) => link.sourceUrl === pdfUrl && link.sourceTitle === (asNode.citation?.title || 'paper.pdf')), 'the PDF is its links’ source page');
  assert.deepEqual(Object.keys(answered.pages), [pdfUrl]);
  assert.deepEqual([answered.pages[pdfUrl].source, answered.pages[pdfUrl].title, typeof answered.pages[pdfUrl].readAt], ['pdf', asNode.citation.title, 'string']);
  // A tab the view can't read is answered too, with the reason.
  await js(asker, `chrome.runtime.sendMessage(${JSON.stringify({type: 'run.pdf', runId: 'run-pdf-check', step: 3, tabId: 999999, url: pdfUrl, title: ''})}).then(() => true, () => true)`);
  const refused = await until(() => js(ui, 'window.__answers[1]'), 'the view’s answer for a tab it can’t read', 30000);
  assert.deepEqual([refused.step, refused.error, refused.links], [3, 'Link Meteor has no access to that page.', undefined]);
  await browser.send('Target.closeTarget', {targetId: askerTarget});
  await browser.send('Target.closeTarget', {targetId: pdfTarget});
  pass('A PDF among selected pages: the view reads it in its tab and answers with its links, their pages and what the PDF says about itself; a tab it can’t read is answered with the reason', {links: answered.links.length, pages: answered.pageCount});

  /* 8. Capture their pages…: the panel. */
  await fresh('Sources');
  const sources = (await state()).activeCollectionId;
  const L = (id, anchorText, url) => ({id, anchorText, accessibleLabel: '', url, originalHref: url, sourceUrl: 'https://search.example.org/results', sourceTitle: 'Search results', frameUrl: '', capturedAt: '2026-10-01T10:00:00.000Z', batchId: 'seed', notes: '', tags: []});
  const pageA = listing('of=1&source=a'), pageB = listing('of=1&source=b'), pageC = `${fixture.other}/site/runs/page.html?of=1&source=c`;
  await rpc({type: 'state.mutate', action: {type: 'links.append', collectionId: sources, links: [
    L('s1', 'First source', pageA), L('s2', 'Second source', pageB), L('s3', 'Third source', pageC), L('s4', 'First source again', pageA),
    L('s5', 'Write to the author', 'mailto:author@example.org'), L('s6', 'The data', `${fixture.base}/files/data.csv`),
    ...Array.from({length: 21}, (_, i) => L(`m${i}`, `Many ${i + 1}`, listing(`of=1&many=${i + 1}`)))]}});
  await until(() => js(ui, `document.querySelectorAll('.link-row').length === 27`), 'the seeded rows');
  assert.equal(await visible('pages-selected'), false, 'no button without a selection');
  // Each tick redraws the list, so every row is found again before it is ticked.
  const select = (indexes) => js(ui, `(() => { for (const index of ${JSON.stringify(indexes)}) { const box = document.querySelectorAll('.link-row .row-select')[index]; if (!box.checked) box.click(); } return true; })()`);
  await select([0, 1, 2, 3, 4, 5]);
  await until(() => visible('pages-selected'), 'Capture their pages… shows');
  assert.equal(await text('pages-selected'), 'Capture their pages…');
  await js(ui, `${$('pages-selected')}.focus()`); await key(ui, 'Enter');
  await until(() => visible('pages-panel'), 'the panel');
  assert.equal(await js(ui, 'document.activeElement.id'), 'pages-destination');
  assert.equal(await js(ui, `${$('pages-selected')}.getAttribute('aria-expanded')`), 'true');
  assert.equal(await text('pages-title'), 'Capture the links on 3 selected pages');
  assert.deepEqual(await js(ui, `[...document.querySelectorAll('#pages-panel .pages-facts li')].map((item) => item.innerText)`), [
    'Each page opens in a background tab, one at a time, is captured and closed.',
    '20 pages at most in one run, 2 seconds apart. You can stop at any time.',
    'Only these 3 pages are read. The links found are saved, never followed.']);
  const hostA = new URL(fixture.base).host, hostC = new URL(fixture.other).host;
  await until(async () => /^Needs access/.test(await text('pages-access')), 'the sites it needs');
  assert.equal(await text('pages-access'), `Needs access to 2 sites: ${hostA} (2 pages), ${hostC} (1 page)`);
  assert.equal(await text('pages-allow'), 'Allow these 2 sites');
  assert.equal(await text('pages-help'), 'Left out: 1 link points to a file, not a page; 1 link is an email or phone link. Pages load as they would if you opened them yourself, signed in as you are. An address that moves to another site is read only if Link Meteor has access to that site too.');
  assert.deepEqual([await text('pages-apply'), await disabled('pages-apply')], ['Capture 3 pages', true], 'Capture waits for access');
  assert.equal(await js(ui, `${$('pages-destination')}.selectedOptions[0].innerText`), 'Sources (27 links)', 'the links go to the open collection unless another is chosen');
  await width(ui, 1280, 1000);
  await js(ui, `${$('pages-panel')}.scrollIntoView({block: 'center'})`); await shot(ui, 'runs-pages-panel.png');
  // A simulated decline, then a simulated grant: one request, in the click, naming exactly those sites.
  await js(ui, `${$('pages-allow')}.focus()`); await key(ui, 'Enter');
  await until(async () => /was declined, so nothing changed/.test(await error()), 'the declined request');
  assert.equal(await disabled('pages-apply'), true);
  await quiet();
  await js(ui, 'window.__answer = true');
  await js(ui, `${$('pages-allow')}.focus()`); await key(ui, 'Enter');
  await until(async () => !(await disabled('pages-apply')), 'Capture is ready once access is there');
  const asked = await js(ui, 'window.__requests');
  assert.deepEqual(asked.map((entry) => entry.request), [{origins: [`${fixture.base}/*`, `${fixture.other}/*`]}, {origins: [`${fixture.base}/*`, `${fixture.other}/*`]}]);
  assert.ok(asked.every((entry) => entry.activeGesture), 'asked in the click');
  assert.match(await text('pages-access'), /^Link Meteor has access to the 2 sites these pages are on\.$/);
  assert.equal(await visible('pages-allow'), false);
  assert.equal(await js(ui, 'document.activeElement.id'), 'pages-apply');
  // The grant was only simulated, so the background, which asks Chrome itself, opens nothing.
  const tabsBefore = await js(ui, 'chrome.tabs.query({}).then((tabs) => tabs.length)');
  since = Date.now();
  await key(ui, 'Enter');
  await until(async () => /^Captured 0 of 3 selected pages/.test(await notice()), 'the run of pages without access');
  assert.equal(await notice(), 'Captured 0 of 3 selected pages: no links were added to “Sources”.');
  shown = await report();
  assert.deepEqual(shown.rows.map((row) => [row[0], row[4]]), [['1', 'No access'], ['2', 'No access'], ['3', 'No access']]);
  assert.equal(shown.undo, false);
  assert.equal(pageRequests(since).length, 0, 'no page was opened');
  assert.equal(await js(ui, 'chrome.tabs.query({}).then((tabs) => tabs.length)'), tabsBefore);
  assert.equal(await visible('pages-panel'), false);
  pass('Capture their pages…: the panel says what will happen and which sites it needs; one request names exactly those sites; without real access every page is reported “No access” and none is opened', {simulated: 'Chrome’s prompt was stubbed: a decline, then a grant'});

  // More than 20 pages are refused, in the panel and by the background.
  await click('clear-selection');
  await select(Array.from({length: 21}, (_, i) => i + 6));
  await js(ui, `${$('pages-selected')}.focus()`); await key(ui, 'Enter');
  await until(() => visible('pages-panel'), 'the panel for 21 pages');
  assert.equal(await text('pages-title'), 'Capture the links on 21 selected pages');
  assert.equal(await text('pages-help'), 'Choose up to 20 pages at a time.');
  assert.equal(await disabled('pages-apply'), true);
  assert.equal(await rpcError({type: 'run.start', kind: 'pages', collectionId: sources, urls: Array.from({length: 21}, (_, i) => listing(`of=1&many=${i + 1}`))}), 'Choose up to 20 pages at a time.');
  assert.equal(await rpcError({type: 'run.start', kind: 'pages', collectionId: sources, urls: ['mailto:author@example.org']}), 'Choose web pages to capture.');
  await key(ui, 'Escape');
  await until(async () => !(await visible('pages-panel')), 'Escape closes the panel');
  assert.equal(await js(ui, 'document.activeElement.id'), 'pages-selected', 'focus returns to the button');
  // The same panel from a link's details, for that one page.
  await click('clear-selection');
  await js(ui, `document.querySelector('.link-row .row-details summary').click()`);
  await until(() => js(ui, `!!document.querySelector('.link-row .occurrence-pages button')`), 'Capture its page… in the details');
  assert.deepEqual(await js(ui, `(() => { const row = document.querySelector('.link-row .occurrence-pages'); return [row.querySelector('button').innerText, row.querySelector('button').getAttribute('aria-label'), row.querySelector('.help').innerText]; })()`),
    ['Capture its page…', 'Capture the links on the page First source points to', 'Opens this link’s page in a background tab and saves the links on it.']);
  await js(ui, `[...document.querySelectorAll('.link-row')][4].querySelector('.row-details summary').click()`);
  await until(() => js(ui, `!![...document.querySelectorAll('.link-row')][4].querySelector('.occurrence')`), 'the email link’s details');
  assert.equal(await js(ui, `!![...document.querySelectorAll('.link-row')][4].querySelector('.occurrence-pages')`), false, 'an email link has no page to capture');
  await js(ui, `document.querySelector('.link-row .occurrence-pages button').click()`);
  await until(() => visible('pages-panel'), 'the panel for one page');
  assert.equal(await text('pages-title'), 'Capture the links on the page “First source” points to');
  assert.equal(await text('pages-apply'), 'Capture 1 page');
  // A new collection needs a name.
  await js(ui, `(() => { const select = ${$('pages-destination')}; select.value = '__new'; select.dispatchEvent(new Event('change', {bubbles: true})); return true; })()`);
  assert.equal(await text('pages-help'), 'Name the new collection.');
  assert.deepEqual([await disabled('pages-apply'), await js(ui, `${$('pages-new')}.getAttribute('aria-invalid')`), await js(ui, 'document.activeElement.id')], [true, 'true', 'pages-new']);
  pass('More than 20 pages are refused with “Choose up to 20 pages at a time.”; Escape closes the panel; a link’s details open it for that one page; a new collection needs a name');

  /* 9. 320 px, and contrast in light and dark. */
  await width(ui, 320);
  assert.equal(await overflow(ui), false, 'the panel at 320');
  await js(ui, `${$('pages-panel')}.scrollIntoView({block: 'start'})`); await shot(ui, 'runs-pages-panel-320.png');
  assert.equal(await js(ui, `(() => { const box = document.querySelector('#capture-report .table-scroll'); return box.scrollWidth <= box.clientWidth; })()`), true, 'at 320 the report’s rows stack, so nothing scrolls sideways');
  assert.deepEqual(await js(ui, `[document.querySelector('#capture-report .run-table').getAttribute('role'), document.querySelector('#capture-report .run-table tbody tr').getAttribute('role'), document.querySelector('#capture-report .run-table td').getAttribute('role'), document.querySelector('#capture-report .run-table th').getAttribute('role')]`), ['table', 'row', 'cell', 'columnheader'], 'stacked or not, it is a table to a screen reader');
  await js(ui, `${$('capture-report')}.scrollIntoView({block: 'start'})`); await shot(ui, 'runs-report-320.png');
  // A run in progress: its next page never answers, so the progress line stays to be measured.
  await width(ui, 1280, 1000);
  await key(ui, 'Escape');
  await go(listing('of=1&next=text&after=hang'), `document.title === 'Listing, page 1'`);
  await check('further-next', true);
  await click('capture');
  await until(counter(/^Page 2 of up to 20/), 'a run waiting for its next page', 30000);
  await width(ui, 320);
  assert.equal(await overflow(ui), false, 'the choices and the progress line at 320');
  await js(ui, `${$('capture-further')}.scrollIntoView({block: 'start'})`); await shot(ui, 'runs-progress-320.png');
  const measured = [];
  // A window nobody looks at draws no frames, so a color in transition would stay where it started.
  // For the measurements, colors change at once.
  await js(ui, `(() => { const style = document.createElement('style'); style.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }'; document.head.append(style); return true; })()`);
  // Every theme, light and dark, chosen as a person would choose it in Appearance.
  const setTheme = async (theme, appearance) => {
    await rpc({type: 'state.mutate', action: {type: 'settings.update', patch: {theme, appearance}}});
    await until(() => js(ui, `document.documentElement.dataset.theme === ${JSON.stringify(theme)} && (${JSON.stringify(appearance)} === 'system' || document.documentElement.dataset.scheme === ${JSON.stringify(appearance)})`), `${theme} ${appearance} applied`);
    await sleep(300);
  };
  const measure = async (pairs, name, selector) => {
    for (const theme of THEME_IDS) for (const value of ['light', 'dark']) {
      await setTheme(theme, value);
      measured.push(...(await contrast(ui, pairs)).map((entry) => ({...entry, name: `${theme} ${value} ${entry.name}`})));
      if (theme !== 'meteor') continue;
      await js(ui, `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block: 'start'})`); await shot(ui, `${name}-${value}.png`);
    }
  };
  await width(ui, 1280, 1000);
  await measure([['Scroll to the end first, during a run', '#capture-further .name-check > span'], ['its limits', '#further-scroll-help'], ['Follow Next, during a run', 'label[for="further-next"]'], ['pages', '#follow-pages'], ['Follow Next’s limits', '#further-next-help'],
    ['run title', '#run-title'], ['run counter', '#run-text'], ['Stop', '#run-stop']], 'runs-progress', '.capture');
  for (const res of hanging) res.destroy();
  await click('run-stop');
  await idle(40000);
  await until(async () => (await report())?.rows.length === 2, 'the stopped run’s report');
  await quiet();
  await measure([['Scroll to the end first, when it can be chosen', '#capture-further .name-check > span'], ['Follow Next, when it can be chosen', 'label[for="further-next"]'], ['report head', '#capture-report .run-head strong'], ['Undo', '#capture-report .run-head .link-btn'], ['report column', '#capture-report .run-table th'], ['report cell', '#capture-report .run-table td.num'], ['report page', '#capture-report .run-table td.title a'],
    ['how it ended', '#capture-report .run-table td.how'], ['how it ended early', '#capture-report .run-table tr.is-problem td.how'], ['report note', '#capture-report .run-note']], 'runs-report', '.capture');
  // The panel, with the selection it needs.
  await select([0, 1, 2]);
  await click('pages-selected');
  await until(() => visible('pages-panel'), 'the panel again');
  await measure([['Capture their pages…', '#pages-selected'], ['panel title', '#pages-title'], ['fact', '#pages-panel .pages-facts li'], ['access', '#pages-access'], ['access heading', '#pages-access strong'], ['Add to', '#pages-panel label'], ['help', '#pages-help'], ['Capture', '#pages-apply'], ['Cancel', '#pages-cancel'],
    ['Capture its page…', '.occurrence-pages .btn'], ['what it does', '.occurrence-pages .help']], 'runs-pages-panel', '#review');
  await setTheme('meteor', 'system');
  for (const entry of measured) { assert.ok(!entry.missing, `${entry.name} missing`); assert.ok(entry.ratio >= 4.5, `${entry.name} contrast ${entry.ratio}`); }
  result.contrast = measured;
  pass(`At 320 px nothing overflows; text contrast is at least 4.5:1 in all ${THEME_IDS.length} themes, light and dark, for the choices, the progress line, the report and the panel`, {measured: measured.length, lowest: Math.min(...measured.map((entry) => entry.ratio))});

  /* 10. Nothing downloaded, and only the fixture server was asked. */
  assert.deepEqual(await readdir(resolve(browser.profile, 'home/Downloads')).catch(() => []), [], 'no file landed in Downloads');
  assert.ok(requests.every((request) => /^(127\.0\.0\.1|localhost):\d+$/.test(request.host)), 'only the fixture server was asked');
  pass('Nothing was downloaded, and nothing but the fixture server was asked', {requests: requests.length});
  result.status = 'PASS';
} catch (error) {
  result.status = 'FAIL'; result.error = String(error?.stack || error); console.error(error); process.exitCode = 1;
} finally {
  for (const res of hanging) res.destroy();
  await browser.close(); await fixture.close();
  result.finished = new Date().toISOString();
  await writeFile(resolve(evidence, 'runs-browser-results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(result.status, `${result.checks.length} checks`);
}
