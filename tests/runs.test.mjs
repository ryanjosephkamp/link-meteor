// Runs (0.6.0, src/background/runs.js) with Chrome's APIs simulated, as tests/background.test.mjs
// does: a small pretend browser (tabs that load pages of a pretend site), the real background, and
// a clock the test moves by hand. Checked here: the queue and its order, pacing, Stop, the caps,
// every way a run ends, the session record and a restarted worker, one batch and its Undo, and
// the report's words.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../src/core/model.js';

/* The pretend browser ------------------------------------------------------------------------- */
const event = () => ({listeners: [], addListener(fn) { this.listeners.push(fn); }});
const local = {linkMeteorState: createState()}, session = {};
const SITE = 'https://papers.test', OTHER = 'https://other.test', WORKBENCH = 'chrome-extension://meteor/ui/workbench.html';
// Each page: its title, links, Next, what kind of document it is, and how it behaves.
const site = new Map();
const link = (anchorText, url, extra = {}) => ({anchorText, url, originalHref: url, frameUrl: '', ...extra});
function page(url, {title = '', links = 2, next = null, type = 'text/html', loadMs = 100, redirect = '', never = false, scroll = null, chrome = 0, download = false} = {}) {
  const made = typeof links === 'number' ? [...Array.from({length: links}, (_, i) => link(`${title || url} link ${i + 1}`, `${url}#link-${i + 1}`)), ...Array.from({length: chrome}, (_, i) => link(`Menu ${i + 1}`, `${SITE}/menu/${i + 1}`, {pageChrome: true}))] : links;
  site.set(url, {title, links: made, next, type, loadMs, redirect, never, scroll, download});
}
const tabs = new Map();
let nextTabId = 10, now = 0;
const timers = [];
const granted = new Set();          // origins Link Meteor has site access to
const active = new Set();           // tabs with the toolbar's temporary access
let pagesOpen = true, pdfReply = null, fileReply = null, failScripts = false;
const calls = {created: [], removed: [], updated: [], scans: [], frames: [], toPage: [], broadcasts: []};
const origin = (url) => { try { return new URL(url).origin; } catch { return ''; } };
const readable = (tab) => granted.has(origin(tab.url)) || (active.has(tab.id) && origin(tab.url) === tab.access);
const visible = (tab) => ({id: tab.id, windowId: 1, status: tab.status, ...(readable(tab) ? {url: tab.url, title: tab.title} : {})});
// A tab starts loading and is complete after the page's time; a page may move to another address.
function load(tab, url) {
  const target = site.get(url) || {title: 'Not found', links: [], type: 'text/html', loadMs: 100};
  Object.assign(tab, {status: 'loading', url, title: '', loading: (tab.loading || 0) + 1});
  if (target.never) return;
  const mine = tab.loading;
  timers.push({at: now + target.loadMs, done: () => {
    if (!tabs.has(tab.id) || tab.loading !== mine) return;
    const landed = target.redirect || url, shown = site.get(landed) || target;
    // An address the site sends as a download never shows: Chrome saves the file and closes the tab.
    // The tab says "complete", with no address, for a moment first, unless it is closed at once.
    if (shown.download === 'at once') { tabs.delete(tab.id); return; }
    if (shown.download) { Object.assign(tab, {status: 'complete', url: '', title: ''}); timers.push({at: now + 300, done: () => tabs.delete(tab.id)}); return; }
    Object.assign(tab, {status: 'complete', url: landed, title: shown.title, document: shown});
    // The toolbar's temporary access ends when the tab leaves its site.
    if (origin(landed) !== tab.access) active.delete(tab.id);
  }});
}
globalThis.chrome = {
  storage: {onChanged: event(),
    local: {async get(key) { return {[key]: structuredClone(local[key])}; }, async set(value) { Object.assign(local, structuredClone(value)); }},
    session: {async get(key) { return {[key]: structuredClone(session[key])}; }, async set(value) { Object.assign(session, structuredClone(value)); }, async remove(key) { delete session[key]; }}},
  runtime: {getURL: (path) => 'chrome-extension://meteor/' + path, onMessage: event(), onInstalled: event(), onStartup: event(), getPlatformInfo() {},
    async sendMessage(message) {
      calls.broadcasts.push(structuredClone(message));
      if (!pagesOpen) throw new Error('Could not establish connection. Receiving end does not exist.');
      if (message.type === 'run.pdf' && pdfReply) { const reply = pdfReply(message); setImmediate(() => call({type: 'run.pdfLinks', runId: message.runId, step: message.step, ...reply})); }
      if (message.type === 'run.file' && fileReply) { const reply = fileReply(message); if (reply) setImmediate(() => call({type: 'run.fileDone', runId: message.runId, step: message.step, ...reply})); }
    }},
  tabs: {
    async query() { return [...tabs.values()].map(visible); },
    async get(id) { const tab = tabs.get(id); if (!tab) throw new Error(`No tab with id: ${id}.`); return visible(tab); },
    async create({url, active: front}) { const tab = {id: nextTabId++, access: ''}; tabs.set(tab.id, tab); calls.created.push({id: tab.id, url, active: front, at: now}); load(tab, url); return visible(tab); },
    async update(id, {url} = {}) { const tab = tabs.get(id); if (!tab) throw new Error(`No tab with id: ${id}.`); if (url) { calls.updated.push({id, url, at: now}); load(tab, url); } return visible(tab); },
    async remove(id) { if (!tabs.delete(id)) throw new Error(`No tab with id: ${id}.`); calls.removed.push({id, at: now}); },
    async sendMessage(id, message) { calls.toPage.push({id, ...structuredClone(message)}); },
  },
  windows: {getAll: async () => [{id: 1, focused: true, tabs: [...tabs.values()].map(visible)}], update: async () => {}},
  permissions: {contains: async ({origins = []}) => origins.every((pattern) => granted.has(pattern.replace(/\/\*$/, ''))), onAdded: event(), onRemoved: event()},
  scripting: {
    async executeScript(spec) {
      const tab = tabs.get(spec.target.tabId);
      if (!tab) throw new Error(`No tab with id: ${spec.target.tabId}`);
      if (!readable(tab) || failScripts) throw new Error('Cannot access contents of the page. Extension manifest must request permission to access the respective host.');
      if (spec.files) return [];
      const source = String(spec.func), shown = tab.document || {links: [], type: 'text/html'};
      if (shown.type === 'error') throw new Error('Frame with ID 0 is showing error page');
      if (source.includes('contentType')) return [{result: shown.type}];
      if (source.includes('.next')) return [{result: shown.next ? (shown.next === 'button' ? {button: true} : {url: shown.next, how: 'label'}) : null}];
      if (source.includes('.scan')) {
        // After Scroll to the end first, the frames are read in a second call (background/frames.js),
        // which keeps the scrolled top document's answer: it is not another scan of the page.
        const last = calls.scans.at(-1), afterScroll = spec.target.allFrames && last?.id === tab.id && last.url === tab.url && last.options.scroll && !spec.args[0].scroll;
        if (afterScroll) calls.frames.push({id: tab.id, url: tab.url, at: now});
        else calls.scans.push({id: tab.id, url: tab.url, at: now, options: structuredClone(spec.args[0])});
        const wanted = spec.args[0].scroll;
        return [{result: {links: structuredClone(shown.links), warnings: [], inaccessibleFrames: 0, page: null, ...(wanted ? {scroll: shown.scroll || {screens: 4, of: 50, ended: 'end', text: 'Reached the end after 4 screens.'}} : {})}}];
      }
      return [{result: true}];
    },
    async getRegisteredContentScripts() { return []; }, async unregisterContentScripts() {}, async registerContentScripts() {},
  },
  bookmarks: {}, action: {onClicked: event()}, sidePanel: {open: async () => {}}, commands: {onCommand: event()}, contextMenus: {onClicked: event(), removeAll: async () => {}, create: () => {}},
};
await import('../src/background.js');
const runs = await import('../src/background/runs.js');
runs.useClock({now: () => now, sleep: (ms) => new Promise((done) => timers.push({at: now + ms, done}))});

const ui = {url: WORKBENCH, tab: {id: 2}};
function call(message, sender = ui) { return new Promise((resolve) => chrome.runtime.onMessage.listeners[0](message, sender, resolve)); }
const ask = async (message, sender) => { const reply = await call(message, sender); if (!reply.ok) throw new Error(reply.error); return reply.data; };
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((done) => setImmediate(done)); };
// Moves the clock, running whatever falls due on the way, in order.
async function advance(ms) {
  const end = now + ms;
  for (;;) {
    await settle();
    const due = timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    now = Math.max(now, due.at); timers.splice(timers.indexOf(due), 1); due.done();
  }
  now = end; await settle();
}
const status = async () => (await ask({type: 'run.status'})).run;
async function toTheEnd(limit = 400000) {
  for (const start = now; now - start < limit;) { await advance(250); if ((await status())?.state === 'done') return status(); }
  throw new Error('The run did not end.');
}
const state = () => local.linkMeteorState;
const home = () => state().collections.find((item) => item.id === state().activeCollectionId);
const report = () => session.linkMeteorCaptureReport.report;
const rows = () => report().results.map((row) => [row.page, row.status, row.found, row.added, row.how]);
// A fresh browser and fresh saved data. A run an earlier check left going is stopped first.
async function reset({settings = {}} = {}) {
  if (session.linkMeteorRun?.state === 'running') { await call({type: 'run.stop'}); for (let i = 0; i < 100 && session.linkMeteorRun?.state === 'running'; i++) await advance(1000); }
  local.linkMeteorState = createState(); Object.assign(local.linkMeteorState.settings, settings);
  for (const key of Object.keys(session)) delete session[key];
  for (const list of Object.values(calls)) list.length = 0;
  tabs.clear(); site.clear(); granted.clear(); active.clear(); timers.length = 0;
  pagesOpen = true; pdfReply = null; fileReply = null; failScripts = false;
}
// The tab the person is looking at, after one toolbar click on it.
function clicked(url) {
  const tab = {id: nextTabId++, access: origin(url), url, title: site.get(url)?.title || '', status: 'complete', document: site.get(url)};
  tabs.set(tab.id, tab); active.add(tab.id);
  return tab;
}
const listing = (n) => `${SITE}/list?page=${n}`;
function paged(count, extra = {}) { for (let n = 1; n <= count; n++) page(listing(n), {title: `Listing, page ${n}`, links: 3, next: n < count ? listing(n + 1) : null, ...extra}); }

/* Capture selected pages ---------------------------------------------------------------------- */
test('selected pages: each in a background tab, one at a time, 2 seconds apart, closed afterward, as one batch', async () => {
  await reset(); granted.add(SITE);
  for (const n of [1, 2, 3]) page(`${SITE}/p${n}`, {title: `Paper ${n}`, links: n});
  const {runId} = await ask({type: 'run.start', kind: 'pages', collectionId: state().activeCollectionId, urls: [`${SITE}/p1`, `${SITE}/p2`, `${SITE}/p1#again`, `${SITE}/p3`]});
  assert.match(runId, /^[0-9a-f-]{36}$/);
  assert.equal((await status()).state, 'running');
  assert.equal(session.linkMeteorRun.queue.length, 3, 'a repeated address is read once');
  const done = await toTheEnd();
  assert.deepEqual(calls.created.map((tab) => [tab.url, tab.active]), [[`${SITE}/p1`, false], [`${SITE}/p2`, false], [`${SITE}/p3`, false]], 'in order, never in front');
  assert.ok(calls.created[1].at - calls.created[0].at >= 2000 && calls.created[2].at - calls.created[1].at >= 2000, 'at least 2 seconds apart');
  assert.deepEqual(calls.removed.map((tab) => tab.id), calls.created.map((tab) => tab.id), 'each tab is closed');
  assert.ok(calls.removed.every((tab, i) => i === 2 || tab.at <= calls.created[i + 1].at), 'one tab at a time');
  assert.equal(tabs.size, 0);
  assert.equal(home().links.length, 6);
  assert.equal(new Set(home().links.map((item) => item.batchId)).size, 1, 'one batch');
  assert.deepEqual(home().links.map((item) => item.sourceTitle), ['Paper 1', 'Paper 2', 'Paper 2', 'Paper 3', 'Paper 3', 'Paper 3']);
  assert.deepEqual(rows(), [[1, 'captured', 1, 1, 'Captured'], [2, 'captured', 2, 2, 'Captured'], [3, 'captured', 3, 3, 'Captured']]);
  assert.equal(report().summary, 'Captured 3 selected pages: added 6 links to “My research”.');
  assert.equal(report().note, 'The links from all 3 pages are one batch, so Undo removes them together.');
  assert.deepEqual([report().kind, report().run, report().capturedCount, report().batchId], ['run', 'pages', 6, home().links[0].batchId]);
  assert.deepEqual([done.state, done.count, done.summary, done.ended.reason], ['done', 6, report().summary, 'finished']);
  // What Link Meteor's pages were told on the way.
  const told = calls.broadcasts.filter((message) => message.type === 'run.progress' && message.runId === runId);
  assert.deepEqual([told[0].kind, told[0].step, told[0].of, told[0].links, told[0].state, told[0].title, told[0].text], ['pages', 1, 3, 0, 'running', 'Capturing selected pages', 'Page 1 of 3 · 0 links']);
  assert.ok(told.some((message) => message.text === 'Page 3 of 3 · 3 links'));
  assert.equal(told.at(-1).state, 'done');
  // The session record holds the run, never the links.
  assert.equal(JSON.stringify(session.linkMeteorRun).includes('link 1'), false);
  assert.deepEqual(calls.scans.map((scan) => scan.options), [{context: true}, {context: true}, {context: true}], 'each page is captured as Capture this page captures it');
  // The page being read shows the counter and Stop too, and may stop the run.
  assert.deepEqual(calls.toPage.map((message) => [message.id, message.type, message.text]), calls.created.map((tab, i) => [tab.id, 'content.run', `Capturing selected pages: page ${i + 1} of 3 · ${[0, 1, 3][i]} links`.replace('· 1 links', '· 1 link')]));
});

test('selected pages: no access, a redirect to another site, a slow page, a tab that closes, and nothing on the page', async () => {
  await reset(); granted.add(SITE);
  page(`${SITE}/ok`, {title: 'Readable', links: 2});
  page(`${OTHER}/elsewhere`, {title: 'Elsewhere', links: 5});
  page(`${SITE}/moved`, {redirect: `${OTHER}/elsewhere`});
  page(`${SITE}/slow`, {never: true});
  page(`${SITE}/empty`, {title: 'Nothing here', links: 0});
  page(`${SITE}/download`, {never: true});
  page(`${SITE}/broken`, {title: '', type: 'error'});
  const urls = [`${OTHER}/elsewhere`, `${SITE}/moved`, `${SITE}/slow`, `${SITE}/empty`, `${SITE}/download`, `${SITE}/broken`, `${SITE}/ok`];
  await ask({type: 'run.start', kind: 'pages', collectionId: state().activeCollectionId, urls});
  // Chrome closes a tab opened at an address it downloads instead of showing.
  for (let i = 0; i < 400 && session.linkMeteorRun.state === 'running'; i++) { await advance(250); const tab = [...tabs.values()].find((item) => item.url === `${SITE}/download`); if (tab) tabs.delete(tab.id); }
  assert.deepEqual(rows(), [
    [1, 'no-access', 0, 0, 'No access'],
    [2, 'no-access', 0, 0, 'No access: it moved to another site'],
    [3, 'not-loaded', 0, 0, 'Didn’t load within 30 seconds'],
    [4, 'empty', 0, 0, 'No links on this page'],
    [5, 'closed', 0, 0, 'The tab closed before it was read. Chrome may have downloaded this address as a file instead of showing it.'],
    [6, 'not-loaded', 0, 0, 'Didn’t load: Chrome showed an error page'],
    [7, 'captured', 2, 2, 'Captured']]);
  assert.deepEqual(calls.created.map((tab) => tab.url), urls.slice(1), 'a page without access is not opened');
  assert.equal(tabs.size, 0, 'every tab it opened is closed, read or not');
  assert.deepEqual(home().links.map((item) => item.sourceUrl), [`${SITE}/ok`, `${SITE}/ok`], 'nothing was read from the other site');
  assert.equal(report().summary, 'Captured 2 of 7 selected pages: added 2 links to “My research”.');
  const slow = calls.created.find((tab) => tab.url === `${SITE}/slow`), closed = calls.removed.find((tab) => tab.id === slow.id);
  assert.ok(closed.at - slow.at >= 30000 && closed.at - slow.at < 31000, 'a page gets 30 seconds to load');
});

test('selected pages: a PDF is read by an open Link Meteor page, or reported when none answers', async () => {
  await reset(); granted.add(SITE);
  page(`${SITE}/paper.pdf`, {title: 'paper.pdf', type: 'application/pdf'});
  page(`${SITE}/locked.pdf`, {title: 'locked.pdf', type: 'application/pdf'});
  pdfReply = (message) => message.url.endsWith('locked.pdf') ? {error: 'This PDF needs a password. Link Meteor doesn’t ask for passwords.'}
    : {links: [{url: 'https://doi.org/10.5555/a', originalHref: 'https://doi.org/10.5555/a', anchorText: 'doi:10.5555/a', pdfPage: 3, context: 'See   doi:10.5555/a for the data.', sourceUrl: message.url, sourceTitle: 'A small paper'},
      {url: 'mailto:author@example.org', originalHref: 'mailto:author@example.org', anchorText: '', pdfPage: 1, sourceUrl: message.url, sourceTitle: 'A small paper'}],
      pages: {[message.url]: {title: 'A small paper', source: 'pdf', readAt: '2026-10-02T10:00:00.000Z'}}, internal: 4, pageCount: 12};
  await ask({type: 'run.start', kind: 'pages', collectionId: state().activeCollectionId, urls: [`${SITE}/paper.pdf`, `${SITE}/locked.pdf`]});
  await toTheEnd();
  const asked = calls.broadcasts.filter((message) => message.type === 'run.pdf');
  assert.deepEqual(asked.map(({type, runId, ...rest}) => rest), [{step: 0, tabId: calls.created[0].id, url: `${SITE}/paper.pdf`, title: 'paper.pdf'}, {step: 1, tabId: calls.created[1].id, url: `${SITE}/locked.pdf`, title: 'locked.pdf'}]);
  assert.deepEqual(rows(), [[1, 'captured', 2, 2, 'Captured: a PDF, 12 pages'], [2, 'error', 0, 0, 'A PDF: This PDF needs a password. Link Meteor doesn’t ask for passwords.']]);
  assert.deepEqual(home().links.map((item) => [item.url, item.anchorText, item.pdfPage, item.sourceUrl, item.sourceTitle, item.context]), [
    ['https://doi.org/10.5555/a', 'doi:10.5555/a', 3, `${SITE}/paper.pdf`, 'A small paper', 'See doi:10.5555/a for the data.'],
    ['mailto:author@example.org', '', 1, `${SITE}/paper.pdf`, 'A small paper', undefined]]);
  assert.equal(home().pages[`${SITE}/paper.pdf`].source, 'pdf', 'what the PDF says about itself is kept as its citation');
  assert.equal(new Set(home().links.map((item) => item.batchId)).size, 1);
  assert.equal(tabs.size, 0);

  // No Link Meteor page is open: said at once. A page that is open but silent: after 60 seconds.
  await reset(); granted.add(SITE); pagesOpen = false;
  page(`${SITE}/paper.pdf`, {title: 'paper.pdf', type: 'application/pdf'});
  await ask({type: 'run.start', kind: 'pages', collectionId: state().activeCollectionId, urls: [`${SITE}/paper.pdf`]});
  await toTheEnd();
  assert.deepEqual(rows(), [[1, 'pdf-unread', 0, 0, 'A PDF: keep Link Meteor open during the run to read PDFs.']]);
  assert.ok(calls.removed[0].at - calls.created[0].at < 2000);
  await reset(); granted.add(SITE);
  page(`${SITE}/paper.pdf`, {title: 'paper.pdf', type: 'application/pdf'});
  await ask({type: 'run.start', kind: 'pages', collectionId: state().activeCollectionId, urls: [`${SITE}/paper.pdf`]});
  await toTheEnd();
  assert.deepEqual(rows(), [[1, 'pdf-unread', 0, 0, 'A PDF: keep Link Meteor open during the run to read PDFs.']]);
  assert.ok(calls.removed[0].at - calls.created[0].at >= 60000, 'an open page gets 60 seconds to answer');
});

test('a run is refused before it starts: too many pages, addresses that aren’t pages, a missing collection, a second run', async () => {
  await reset(); granted.add(SITE);
  const id = state().activeCollectionId, refusal = async (message) => (await call(message)).error;
  assert.equal(await refusal({type: 'run.start', kind: 'pages', collectionId: id, urls: Array.from({length: 21}, (_, i) => `${SITE}/p${i}`)}), 'Choose up to 20 pages at a time.');
  assert.equal(await refusal({type: 'run.start', kind: 'pages', collectionId: id, urls: []}), 'Choose at least one page to capture.');
  assert.equal(await refusal({type: 'run.start', kind: 'pages', collectionId: id, urls: ['mailto:a@example.org']}), 'Choose web pages to capture.');
  assert.equal(await refusal({type: 'run.start', kind: 'pages', collectionId: 'gone', urls: [`${SITE}/p1`]}), 'The chosen collection no longer exists, so nothing was started. Choose another destination.');
  assert.equal(await refusal({type: 'run.start', kind: 'pages', urls: [`${SITE}/p1`]}), 'Choose a collection for the links.');
  assert.equal(await refusal({type: 'run.start', kind: 'crawl', collectionId: id}), 'A run is one of: next, pages, files.');
  assert.equal(await refusal({type: 'run.start', kind: 'scroll', collectionId: id}), 'A run is one of: next, pages, files.');
  assert.equal(await refusal({type: 'run.start', kind: 'next', collectionId: id, scroll: 'yes'}), 'Say whether to scroll each page to the end first.');
  assert.equal((await call({type: 'run.start', kind: 'pages', collectionId: id, urls: [`${SITE}/p1`]}, {url: `${SITE}/p1`, tab: {id: 5}})).error, 'This action must be requested from the Link Meteor workbench.');
  assert.equal(session.linkMeteorRun, undefined, 'nothing was started');
  assert.equal(calls.created.length, 0);
  // Only one run at a time.
  page(`${SITE}/p1`, {title: 'One'}); page(`${SITE}/p2`, {title: 'Two'});
  const tab = clicked(`${SITE}/p1`);
  await ask({type: 'run.start', kind: 'pages', collectionId: id, urls: [`${SITE}/p1`, `${SITE}/p2`]});
  const busy = 'Link Meteor is already running a capture. Stop it, or wait for it to finish.';
  assert.equal(await refusal({type: 'run.start', kind: 'pages', collectionId: id, urls: [`${SITE}/p2`]}), busy);
  assert.equal(await refusal({type: 'run.start', kind: 'next', collectionId: id, tabId: tab.id}), busy);
  assert.equal(await refusal({type: 'capture.run', tabIds: [tab.id], scroll: true}), busy);
  await toTheEnd();
  assert.equal(report().capturedCount, 4);
});

test('Stop: the pause ends at once, what was saved is kept, the rest is reported as not read, and Undo removes the batch', async () => {
  await reset(); granted.add(SITE);
  for (const n of [1, 2, 3, 4]) page(`${SITE}/p${n}`, {title: `Paper ${n}`, links: 2});
  const {runId} = await ask({type: 'run.start', kind: 'pages', collectionId: state().activeCollectionId, urls: [1, 2, 3, 4].map((n) => `${SITE}/p${n}`)});
  await advance(600);
  assert.equal(home().links.length, 2, 'page 1 is read, and the run is pausing');
  // Only the page being read, or the workbench, may stop a run.
  assert.equal((await call({type: 'run.stop', runId}, {url: `${OTHER}/x`, tab: {id: 99}})).error, 'Only the page a run is reading can stop it.');
  assert.deepEqual(await ask({type: 'run.stop', runId: 'another'}), {stopped: false});
  const before = now;
  assert.deepEqual(await ask({type: 'run.stop', runId}), {stopped: true});
  await settle();
  assert.equal(now, before, 'no time had to pass');
  const done = await status();
  assert.deepEqual([done.state, done.ended.reason, done.ended.text, done.count], ['done', 'stopped', 'You pressed Stop.', 2]);
  assert.deepEqual(rows(), [[1, 'captured', 2, 2, 'Captured'], [2, 'not-read', 0, 0, 'Not read: you pressed Stop'], [3, 'not-read', 0, 0, 'Not read: you pressed Stop'], [4, 'not-read', 0, 0, 'Not read: you pressed Stop']]);
  assert.equal(report().summary, 'Captured 1 of 4 selected pages: added 2 links to “My research”.');
  assert.equal(report().note, 'You pressed Stop. The links from that page are one batch, so Undo removes them together.');
  assert.equal(calls.created.length, 1, 'nothing more was opened');
  assert.ok(calls.broadcasts.some((message) => message.type === 'run.progress' && message.state === 'stopping'));
  assert.deepEqual(await ask({type: 'run.stop', runId}), {stopped: false}, 'a run that is over has nothing to stop');

  // Undo: the batch, exactly as the run left it.
  const {batchId, collectionId} = done;
  assert.equal((await call({type: 'run.undo', collectionId, batchId: 'other'})).error, 'This run can no longer be undone. Remove its links in the list instead.');
  await ask({type: 'state.mutate', action: {type: 'link.update', id: home().links[0].id, patch: {notes: 'Read this'}}});
  assert.equal((await call({type: 'run.undo', collectionId, batchId})).error, 'These links changed since the run, so Undo is no longer possible. Remove them in the list instead.');
  await ask({type: 'state.mutate', action: {type: 'link.update', id: home().links[0].id, patch: {notes: ''}}});
  const undone = await ask({type: 'run.undo', collectionId, batchId});
  assert.deepEqual([undone.count, undone.name, undone.state.collections[0].links.length], [2, 'My research', 0]);
  assert.equal(report().undone, 2, 'the kept report remembers it');
  assert.equal((await status()).undone, true);
  assert.equal((await call({type: 'run.undo', collectionId, batchId})).error, 'This run can no longer be undone. Remove its links in the list instead.');
});

/* Follow Next --------------------------------------------------------------------------------- */
test('Follow Next: the same tab, each page loaded, a 1.5 second pause, then captured; it ends where there is no Next', async () => {
  await reset({settings: {skipSaved: true, contentOnly: true}});
  paged(3, {chrome: 2});
  site.get(listing(2)).links.push(link('Seen before', `${listing(1)}#link-1`));
  const tab = clicked(listing(1));
  const {runId} = await ask({type: 'run.start', kind: 'next', tabId: tab.id, collectionId: state().activeCollectionId});
  const done = await toTheEnd();
  assert.deepEqual(calls.updated.map((move) => [move.id, move.url]), [[tab.id, listing(2)], [tab.id, listing(3)]], 'the same tab moves to each next page');
  assert.equal(calls.created.length, 0, 'no other tab is opened');
  // Each page: loaded (100 ms here), then a 1.5 second pause, then captured.
  assert.deepEqual(calls.scans.map((scan) => scan.url), [listing(1), listing(2), listing(3)]);
  for (const [i, move] of calls.updated.entries()) assert.ok(calls.scans[i + 1].at - move.at >= 1600 && calls.scans[i + 1].at - move.at < 2300, `page ${i + 2} was read ${calls.scans[i + 1].at - move.at} ms after the move`);
  assert.deepEqual(rows(), [[1, 'captured', 5, 3, 'Captured'], [2, 'captured', 6, 3, 'Captured'], [3, 'captured', 5, 3, 'Captured']]);
  assert.equal(home().links.length, 9);
  assert.equal(new Set(home().links.map((item) => item.batchId)).size, 1, 'one batch');
  assert.equal(report().summary, 'Followed Next through 3 pages: added 9 links to “My research”. 1 was already saved and skipped. 6 navigation links were left out.');
  assert.equal(report().note, 'Page 3 has no Next link. Your tab is on page 3. The links from all 3 pages are one batch, so Undo removes them together.');
  assert.deepEqual([done.ended.reason, done.count, report().read, report().found, report().skipped, report().leftOut], ['no-next', 9, 3, 16, 1, 6]);
  assert.equal(session.linkMeteorLeftOut, undefined, 'a run only counts what it leaves out');
  // The counter, in the workbench and on the page.
  const told = calls.broadcasts.filter((message) => message.type === 'run.progress' && message.runId === runId);
  assert.deepEqual([told[0].title, told[0].text, told[0].step, told[0].of], ['Following Next', 'Page 1 of up to 20 · 0 links', 1, 20]);
  assert.ok(told.some((message) => message.text === 'Page 3 of up to 20 · 6 links' && message.page === 'Listing, page 3'));
  const onPage = calls.toPage.filter((message) => message.type === 'content.run').map((message) => message.done ? `done: ${message.text}` : message.text);
  assert.deepEqual(onPage, ['Following Next: page 1 of up to 20 · 0 links', 'Following Next: page 2 of up to 20 · 3 links', 'Following Next: page 3 of up to 20 · 6 links', 'done: Followed Next through 3 pages: added 9 links to “My research”. Page 3 has no Next link.']);
  assert.ok(calls.toPage.every((message) => message.id === tab.id));
});

test('Follow Next: the cap, a loop, another site with and without access, a button, and Scroll to the end first on each page', async () => {
  // The cap is the saved number of pages.
  await reset({settings: {followPages: 2}}); paged(5);
  let tab = clicked(listing(1));
  await ask({type: 'run.start', kind: 'next', tabId: tab.id, collectionId: state().activeCollectionId, scroll: true});
  await toTheEnd();
  assert.equal(report().note, 'Stopped at 2 pages, the limit you set. The last page has a Next link. Your tab is on page 2. The links from all 2 pages are one batch, so Undo removes them together.');
  assert.deepEqual(rows().map((row) => row[4]), ['Captured · scrolled 4 screens to the end', 'Captured · scrolled 4 screens to the end']);
  assert.deepEqual(calls.scans.map((scan) => [scan.options.scroll.lead, scan.options.scroll.links, scan.options.context]), [['Following Next: page 1 of up to 2 · ', 0, true], ['Following Next: page 2 of up to 2 · ', 3, true]], 'each page is scrolled first, with the run’s own counter');
  assert.equal(calls.scans[0].options.scroll.runId, session.linkMeteorRun.runId);
  assert.equal(tabs.get(tab.id).url, listing(2));
  await reset({settings: {followPages: 2}}); paged(2);
  tab = clicked(listing(1));
  await ask({type: 'run.start', kind: 'next', tabId: tab.id, collectionId: state().activeCollectionId});
  await toTheEnd();
  assert.match(report().note, /^Stopped at 2 pages, the limit you set\. Your tab is on page 2\./, 'at the cap with no Next, it doesn’t claim there is one');

  // A loop: Next goes to a page already read.
  await reset(); paged(2); site.get(listing(2)).next = listing(1);
  tab = clicked(listing(1));
  await ask({type: 'run.start', kind: 'next', tabId: tab.id, collectionId: state().activeCollectionId});
  await toTheEnd();
  assert.deepEqual([report().ended.reason, report().ended.text, calls.updated.length, rows().length], ['loop', 'Next goes to a page already read in this run.', 1, 2]);

  // Another site: not opened without access, and said by name.
  await reset(); page(listing(1), {title: 'Listing, page 1', next: `${OTHER}/list?page=2`}); page(`${OTHER}/list?page=2`, {title: 'Elsewhere, page 2'});
  tab = clicked(listing(1));
  await ask({type: 'run.start', kind: 'next', tabId: tab.id, collectionId: state().activeCollectionId});
  await toTheEnd();
  assert.deepEqual([report().ended.reason, report().ended.text, calls.updated.length], ['no-access', 'Next goes to other.test, which Link Meteor has no access to.', 0]);
  assert.equal(tabs.get(tab.id).url, listing(1), 'the tab stays where it was');
  // With access to both sites, Next may cross.
  await reset(); granted.add(SITE); granted.add(OTHER);
  page(listing(1), {title: 'Listing, page 1', next: `${OTHER}/list?page=2`}); page(`${OTHER}/list?page=2`, {title: 'Elsewhere, page 2'});
  tab = clicked(listing(1));
  await ask({type: 'run.start', kind: 'next', tabId: tab.id, collectionId: state().activeCollectionId});
  await toTheEnd();
  assert.deepEqual(rows().map((row) => [row[1], row[4]]), [['captured', 'Captured'], ['captured', 'Captured']]);
  assert.deepEqual(home().links.map((item) => item.sourceTitle), ['Listing, page 1', 'Listing, page 1', 'Elsewhere, page 2', 'Elsewhere, page 2']);

  // Next is a button: nothing to go to, and said so.
  await reset(); page(listing(1), {title: 'Listing, page 1', next: 'button'});
  tab = clicked(listing(1));
  await ask({type: 'run.start', kind: 'next', tabId: tab.id, collectionId: state().activeCollectionId});
  await toTheEnd();
  assert.equal(report().ended.text, 'On page 1, Next is a button without an address, which Follow Next can’t use.');
});

test('Follow Next: a page that doesn’t load, a redirect off the site, a PDF, the tab closed or moved, no access, and Stop', async () => {
  // 30 seconds to load.
  await reset(); page(listing(1), {title: 'Listing, page 1', next: listing(2)}); page(listing(2), {never: true});
  let tab = clicked(listing(1));
  await ask({type: 'run.start', kind: 'next', tabId: tab.id, collectionId: state().activeCollectionId});
  await toTheEnd();
  assert.deepEqual(rows(), [[1, 'captured', 2, 2, 'Captured'], [2, 'not-loaded', 0, 0, 'Didn’t load within 30 seconds']]);
  assert.equal(report().note, 'The next page didn’t load within 30 seconds. The links from that page are one batch, so Undo removes them together.');
  assert.ok(now - calls.updated[0].at >= 30000);

  // The next address moves to another site: the toolbar's access is gone, and Chrome hides the tab.
  await reset(); page(listing(1), {title: 'Listing, page 1', next: listing(2)}); page(listing(2), {redirect: `${OTHER}/landing`}); page(`${OTHER}/landing`, {title: 'Elsewhere'});
  tab = clicked(listing(1));
  await ask({type: 'run.start', kind: 'next', tabId: tab.id, collectionId: state().activeCollectionId});
  await toTheEnd();
  assert.deepEqual(rows()[1], [2, 'no-access', 0, 0, 'Not read: it didn’t load, or it moved to a site without access']);
  assert.equal(report().ended.text, 'Next led to a page Link Meteor can’t read: it didn’t load, or it is on a site Link Meteor has no access to.');
  assert.equal(home().links.length, 2);

  // Next leads to a PDF.
  await reset(); page(listing(1), {title: 'Listing, page 1', next: `${SITE}/paper.pdf`}); page(`${SITE}/paper.pdf`, {title: 'paper.pdf', type: 'application/pdf'});
  tab = clicked(listing(1));
  await ask({type: 'run.start', kind: 'next', tabId: tab.id, collectionId: state().activeCollectionId});
  await toTheEnd();
  assert.deepEqual([rows()[1][4], report().ended.text], ['A PDF: capture it by itself to read its links', 'Next led to a PDF, which Follow Next doesn’t read.']);

  // The person closes the tab while the next page loads, or moves it during the pause.
  await reset(); paged(3, {loadMs: 5000});
  tab = clicked(listing(1));
  await ask({type: 'run.start', kind: 'next', tabId: tab.id, collectionId: state().activeCollectionId});
  await advance(1000); tabs.delete(tab.id);
  await toTheEnd();
  assert.deepEqual([rows().at(-1)[4], report().ended.text, home().links.length], ['Not read: the tab was closed', 'The tab was closed.', 3]);
  await reset(); paged(3); page(`${SITE}/somewhere-else`, {title: 'Somewhere else'});
  tab = clicked(listing(1));
  await ask({type: 'run.start', kind: 'next', tabId: tab.id, collectionId: state().activeCollectionId});
  await advance(700); load(tabs.get(tab.id), `${SITE}/somewhere-else`);
  await toTheEnd();
  assert.deepEqual([rows().at(-1)[4], report().ended.text, home().links.length], ['Not read: the tab went to another page', 'The tab went to another page.', 3]);

  // No access to the first page at all.
  await reset(); paged(2);
  tab = clicked(listing(1)); active.delete(tab.id);
  await ask({type: 'run.start', kind: 'next', tabId: tab.id, collectionId: state().activeCollectionId});
  await toTheEnd();
  assert.deepEqual([rows()[0][4], report().ended.text, report().summary], ['No access', 'Link Meteor has no access to this page. Click the Link Meteor toolbar icon on it, then try again.', 'Followed Next through 0 pages: no links were added to “My research”.']);
  assert.equal(report().note, report().ended.text);

  // Stop on the page being read (its Stop button or Escape), during the pause on page 2.
  await reset(); paged(4);
  tab = clicked(listing(1));
  const {runId} = await ask({type: 'run.start', kind: 'next', tabId: tab.id, collectionId: state().activeCollectionId});
  await advance(600);
  assert.deepEqual(await ask({type: 'run.stop', runId}, {url: listing(2), tab: {id: tab.id}}), {stopped: true});
  await settle();
  assert.deepEqual(rows(), [[1, 'captured', 3, 3, 'Captured'], [2, 'not-read', 0, 0, 'Not read: you pressed Stop']]);
  assert.equal(report().note, 'You pressed Stop. The links from that page are one batch, so Undo removes them together.');
  assert.equal(calls.toPage.some((message) => message.halt), false, 'the page that pressed Stop isn’t told again');
  // Stop in the workbench reaches the page, where a scroll may be going.
  await reset(); paged(4);
  tab = clicked(listing(1));
  const second = await ask({type: 'run.start', kind: 'next', tabId: tab.id, collectionId: state().activeCollectionId});
  await advance(600);
  await ask({type: 'run.stop', runId: second.runId});
  await settle();
  assert.deepEqual(calls.toPage.filter((message) => message.halt).map(({id, runId: stopped, halt}) => [id, stopped, halt]), [[tab.id, second.runId, true]]);
  assert.equal((await status()).ended.reason, 'stopped');
});

/* A restarted worker --------------------------------------------------------------------------- */
test('a restarted worker: selected pages go on with the rest; Follow Next and a scroll end as interrupted', async () => {
  await reset(); granted.add(SITE);
  for (const n of [1, 2, 3]) page(`${SITE}/p${n}`, {title: `Paper ${n}`, links: 2});
  const id = state().activeCollectionId;
  // What the last worker left: page 1 read, page 2 open in a background tab, page 3 still to read.
  const orphan = {id: nextTabId++, access: '', url: `${SITE}/p2`, title: 'Paper 2', status: 'complete', document: site.get(`${SITE}/p2`)};
  tabs.set(orphan.id, orphan);
  session.linkMeteorRun = {runId: 'run-left', kind: 'pages', state: 'running', stopping: false, collectionId: id, name: 'My research', batchId: 'batch-left', scroll: false,
    queue: [1, 2, 3].map((n) => ({url: `${SITE}/p${n}`})), at: 1, seen: [], results: [{page: 1, url: `${SITE}/p1`, title: 'Paper 1', status: 'captured', found: 2, added: 2, skipped: 0, leftOut: 0, how: 'Captured'}],
    links: 2, doing: {index: 1, tabId: orphan.id}, live: null, page: null, ended: null, startedAt: '2026-10-02T10:00:00.000Z'};
  assert.equal((await call({type: 'run.start', kind: 'pages', collectionId: id, urls: [`${SITE}/p3`]})).error, 'Link Meteor is already running a capture. Stop it, or wait for it to finish.', 'the run that was left counts as going');
  assert.equal(tabs.has(orphan.id), false, 'the tab it had opened is closed');
  await toTheEnd();
  assert.deepEqual(rows(), [[1, 'captured', 2, 2, 'Captured'], [2, 'interrupted', 0, 0, 'Interrupted: Chrome stopped Link Meteor’s background worker'], [3, 'captured', 2, 2, 'Captured']]);
  assert.deepEqual(calls.created.map((tab) => tab.url), [`${SITE}/p3`]);
  assert.deepEqual([report().runId, report().batchId, report().capturedCount, report().ended.reason], ['run-left', 'batch-left', 2, 'finished'], 'the batch is counted as it is saved');

  // Follow Next can't know where the tab is, so it ends there, and says so.
  await reset(); paged(3);
  const tab = clicked(listing(2));
  session.linkMeteorRun = {runId: 'next-left', kind: 'next', state: 'running', stopping: false, collectionId: state().activeCollectionId, name: 'My research', batchId: 'batch-next', scroll: false, tabId: tab.id, cap: 20,
    queue: [{url: listing(1)}, {url: listing(2)}], at: 1, seen: [listing(1)], results: [{page: 1, url: listing(1), title: 'Listing, page 1', status: 'captured', found: 3, added: 3, skipped: 0, leftOut: 0, how: 'Captured'}],
    links: 3, doing: {index: 1}, live: null, page: null, ended: null, startedAt: '2026-10-02T10:00:00.000Z'};
  await runs.resumeRun();
  await settle();
  assert.deepEqual([report().ended.reason, report().ended.text], ['interrupted', 'Chrome stopped Link Meteor’s background worker, so the run ended early.']);
  assert.deepEqual(rows().map((row) => row[4]), ['Captured', 'Interrupted: Chrome stopped Link Meteor’s background worker']);
  assert.equal(calls.updated.length, 0, 'the tab is left alone');
  assert.equal((await status()).state, 'done');

  // A scroll's own answer is lost with the worker; the record is closed so the next run can start.
  await reset(); page(`${SITE}/feed`, {title: 'Feed'});
  const feed = clicked(`${SITE}/feed`);
  session.linkMeteorRun = {runId: 'scroll-left', kind: 'scroll', state: 'running', stopping: false, collectionId: state().activeCollectionId, name: 'My research', batchId: '', tabId: feed.id, queue: [], at: 0, results: [], links: 0, doing: {index: 0}, live: {screen: 7, of: 50, links: 90}, ended: null, startedAt: '2026-10-02T10:00:00.000Z'};
  const again = await ask({type: 'capture.run', tabIds: [feed.id], scroll: true});
  assert.equal(again.report.capturedCount, 2, 'a new capture starts once the left one is closed');
  assert.notEqual(session.linkMeteorRun.runId, 'scroll-left');
});

/* Scroll to the end first, alone -------------------------------------------------------------- */
test('capture.run with scroll: one page through Capture this page’s own pipeline, with a counter, Stop and Undo', async () => {
  await reset(); page(`${SITE}/feed`, {title: 'Feed', links: 4, scroll: {screens: 50, of: 50, ended: 'screens', text: 'Stopped at 50 screens. The page may have more.'}});
  const tab = clicked(`${SITE}/feed`);
  assert.equal((await call({type: 'capture.run', tabIds: [tab.id, 99], scroll: true})).error, 'Scroll to the end first works on one page at a time. Choose This page.');
  const pending = ask({type: 'capture.run', tabIds: [tab.id], scroll: true});
  await settle();
  const {state: saved, report: answer} = await pending;
  const record = session.linkMeteorRun;
  assert.deepEqual(calls.scans.map((scan) => scan.options), [{context: true, scroll: {runId: record.runId}}]);
  assert.equal(calls.frames.length, 1, 'the frames are read once, after the scroll, and joined to the scrolled page');
  assert.deepEqual(answer.results[0].scroll, {screens: 50, of: 50, ended: 'screens', text: 'Stopped at 50 screens. The page may have more.'});
  assert.deepEqual([answer.capturedCount, answer.collectionId, saved.collections[0].links.length], [4, state().activeCollectionId, 4]);
  assert.equal(session.linkMeteorCaptureReport.report.collectionId, answer.collectionId, 'the kept report names the collection, for Undo in any view');
  assert.deepEqual([record.kind, record.state, record.batchId, record.count, record.ended.reason], ['scroll', 'done', answer.batchId, 4, 'screens']);
  const told = calls.broadcasts.filter((message) => message.type === 'run.progress');
  assert.deepEqual([told[0].kind, told[0].state, told[0].title, told[0].text], ['scroll', 'running', 'Scrolling the page', 'Scrolling: screen 1 of up to 50 · 0 links']);
  assert.equal(told.at(-1).state, 'done');
  const undone = await ask({type: 'run.undo', collectionId: answer.collectionId, batchId: answer.batchId});
  assert.equal(undone.count, 4);
  assert.equal(home().links.length, 0);

  // The page's counter is passed on, only from the page being scrolled and only for this run.
  await reset(); page(`${SITE}/feed`, {title: 'Feed', links: 4});
  const feed = clicked(`${SITE}/feed`);
  const original = chrome.scripting.executeScript;
  let release;
  chrome.scripting.executeScript = async (spec) => { if (String(spec.func).includes('.scan')) await new Promise((done) => { release = done; }); return original(spec); };
  const slow = ask({type: 'capture.run', tabIds: [feed.id], scroll: true});
  await settle();
  const {runId} = session.linkMeteorRun;
  calls.broadcasts.length = 0;
  await ask({type: 'run.scroll', runId, screen: 9, of: 50, links: 412}, {url: `${SITE}/feed`, tab: {id: feed.id}});
  await ask({type: 'run.scroll', runId, screen: 30, of: 50, links: 999}, {url: `${OTHER}/x`, tab: {id: 77}});
  await ask({type: 'run.scroll', runId: 'another', screen: 30, of: 50, links: 999}, {url: `${SITE}/feed`, tab: {id: feed.id}});
  assert.deepEqual(calls.broadcasts.map((message) => [message.type, message.step, message.of, message.links, message.text]), [['run.progress', 9, 50, 412, 'Scrolling: screen 9 of up to 50 · 412 links']]);
  assert.deepEqual(await ask({type: 'run.stop', runId}), {stopped: true});
  assert.deepEqual(calls.toPage.filter((message) => message.halt).map((message) => message.id), [feed.id], 'Stop in the workbench reaches the page that is scrolling');
  release(); await slow;
  chrome.scripting.executeScript = original;
  assert.equal((await status()).state, 'done');
});

/* Another kind ---------------------------------------------------------------------------------- */
test('another kind of run stands on the same engine: its own steps and words; the queue, pacing, Stop and progress are the engine’s', async () => {
  await reset();
  // A kind that saves no links and shows its own report, as a run that gets files would.
  runs.KINDS.sample = {
    title: 'Getting PDFs', saves: false, report: false, pause: 2000,
    async begin(message) { if (!Array.isArray(message.urls) || !message.urls.length) throw new Error('Choose at least one PDF.'); return {queue: message.urls.map((url) => ({url}))}; },
    counter: (run) => { const step = Math.min(run.at + 1, run.queue.length); return {step, of: run.queue.length, links: 0, text: `Getting PDF ${step} of ${run.queue.length}`}; },
    async step(job, item) {
      const reply = await runs.engine.ask(job, {type: 'run.pdf', runId: job.run.runId, step: job.run.at, url: item.url}, 5000);
      return {row: runs.engine.unread(item, reply ? `Got ${reply.size} bytes` : job.stopped ? 'Not read: you pressed Stop' : 'No answer', reply ? 'got' : 'missed')};
    },
    words: ({run}) => ({head: `Got ${run.results.filter((row) => row.status === 'got').length} of ${run.queue.length} PDFs.`, ended: run.ended?.reason === 'stopped' ? 'You pressed Stop.' : ''}),
  };
  try {
    const asked = [];
    pdfReply = (message) => { asked.push({url: message.url, at: now}); return {size: 1000 + message.step}; };
    assert.equal((await call({type: 'run.start', kind: 'sample', urls: []})).error, 'Choose at least one PDF.');
    const {runId} = await ask({type: 'run.start', kind: 'sample', urls: [`${SITE}/a.pdf`, `${SITE}/b.pdf`, `${SITE}/c.pdf`]});
    const done = await toTheEnd();
    assert.deepEqual(asked.map((item) => item.url), [`${SITE}/a.pdf`, `${SITE}/b.pdf`, `${SITE}/c.pdf`]);
    assert.ok(asked[1].at - asked[0].at >= 2000 && asked[2].at - asked[1].at >= 2000, 'the engine paces the steps');
    assert.deepEqual(done.results.map((row) => [row.page, row.status, row.how]), [[1, 'got', 'Got 1000 bytes'], [2, 'got', 'Got 1001 bytes'], [3, 'got', 'Got 1002 bytes']]);
    assert.deepEqual([done.state, done.summary, done.count, done.collectionId, done.ended.reason], ['done', 'Got 3 of 3 PDFs.', 0, '', 'finished']);
    assert.equal(session.linkMeteorCaptureReport, undefined, 'a kind with its own report leaves the capture report alone');
    assert.equal(state().collections[0].links.length, 0, 'nothing is saved');
    const told = calls.broadcasts.filter((message) => message.type === 'run.progress' && message.runId === runId);
    assert.deepEqual([told[0].title, told[0].text, told.at(-1).state], ['Getting PDFs', 'Getting PDF 1 of 3', 'done']);
    assert.ok(told.some((message) => message.text === 'Getting PDF 3 of 3'));
    // Stop, while a step waits for its answer.
    pdfReply = null;
    const second = await ask({type: 'run.start', kind: 'sample', urls: [`${SITE}/a.pdf`, `${SITE}/b.pdf`]});
    await advance(1000);
    await ask({type: 'run.stop', runId: second.runId});
    await settle();
    const stopped = await status();
    assert.deepEqual([stopped.state, stopped.ended.reason, stopped.summary], ['done', 'stopped', 'Got 0 of 2 PDFs.']);
    assert.deepEqual(stopped.results.map((row) => row.how), ['Not read: you pressed Stop', 'Not read: you pressed Stop']);
  } finally { delete runs.KINDS.sample; }
});

test('a page’s line in the report follows what the capture says: frames it couldn’t read, and a PDF', () => {
  const item = {url: `${SITE}/p1`}, result = {tabId: 1, title: 'Paper 1', url: `${SITE}/p1`, status: 'success', count: 4, leftOut: 1, skipped: 2, warning: '', error: ''};
  assert.deepEqual(runs.engine.rowOf(result, item), {url: `${SITE}/p1`, title: 'Paper 1', found: 7, added: 4, skipped: 2, leftOut: 1, status: 'captured', how: 'Captured'});
  assert.equal(runs.engine.rowOf({...result, frames: {read: 1, unread: 2, sites: ['ads.test'], left: []}}, item).how, 'Captured · 2 frames from other sites weren’t read');
  assert.equal(runs.engine.rowOf({...result, frames: {read: 3, unread: 1, sites: ['ads.test'], left: []}, scroll: {screens: 6, of: 50, ended: 'end', text: 'Reached the end after 6 screens.'}}, item).how, 'Captured · scrolled 6 screens to the end · 1 frame from other sites wasn’t read');
  assert.equal(runs.engine.rowOf({...result, frames: {read: 2, unread: 0, sites: [], left: []}}, item).how, 'Captured');
  assert.equal(runs.engine.rowOf({...result, count: 0, skipped: 3, leftOut: 0}, item).how, 'Captured: nothing new');
  assert.deepEqual([runs.engine.rowOf({...result, status: 'pdf', count: 0, leftOut: 0, skipped: 0}, item).status, runs.engine.rowOf({...result, status: 'pdf', count: 0, leftOut: 0, skipped: 0}, item).how], ['pdf-unread', 'A PDF: capture it by itself to read its links']);
  assert.equal(runs.engine.rowOf({...result, status: 'unsupported', count: 0, leftOut: 0, skipped: 0, warning: 'Browser-internal pages, the Chrome Web Store, and incognito pages cannot be captured.'}, item).how, 'Browser-internal pages, the Chrome Web Store, and incognito pages cannot be captured.');
});

/* PDF files: one ZIP, or one combined PDF ------------------------------------------------------- */
// The Link Meteor page that started the run fetches each file through the tab the background
// names (run.file), and answers run.fileDone. Here the test answers in that page's place.
const pdf = (name, site = SITE) => `${site}/files/${name}.pdf`;
const fileRows = (run) => run.results.map((row) => [row.page, row.title, row.status, row.how]);
const SET_WORDS = 'These PDFs are more than 200 MB together. Choose fewer.';
const UNANSWERED = 'The Link Meteor page that started this didn’t answer, so the run ended. Keep it open until the PDFs are fetched.';

test('PDF files: through the person’s own tab where it is on the PDF’s site, one at a time, 2 seconds apart; nothing is saved', async () => {
  await reset(); page(`${SITE}/list`, {title: 'Papers'});
  const tab = clicked(`${SITE}/list`), asked = [];
  fileReply = (message) => { asked.push({tabId: message.tabId, url: message.url, step: message.step, at: now}); return {ok: true, size: 1000 + message.step}; };
  // No collection is named: nothing is saved. The addresses lose their # part; the page a link was
  // captured from is kept only where it is a page of the PDF's own site, and not itself a file (a
  // link read out of a PDF names that PDF, which Chrome might download instead of showing).
  const {runId} = await ask({type: 'run.start', kind: 'files', tabId: tab.id, files: [{url: `${pdf('a')}#page=2`, from: `${SITE}/list`, name: 'A.pdf'}, {url: pdf('b'), from: `${OTHER}/elsewhere`, name: 'B.pdf'}, {url: pdf('c'), from: pdf('the-paper-that-cites-it'), name: 'C.pdf'}]});
  assert.deepEqual(session.linkMeteorRun.queue, [{url: pdf('a'), name: 'A.pdf', from: `${SITE}/list`}, {url: pdf('b'), name: 'B.pdf'}, {url: pdf('c'), name: 'C.pdf'}]);
  const first = (await status());
  assert.deepEqual([first.kind, first.title, first.text, first.step, first.of, first.state], ['files', 'Getting PDFs', 'Getting PDF 1 of 3', 1, 3, 'running']);
  const done = await toTheEnd();
  assert.deepEqual(asked.map((item) => [item.tabId, item.url, item.step]), [[tab.id, pdf('a'), 0], [tab.id, pdf('b'), 1], [tab.id, pdf('c'), 2]], 'each file is asked for through the person’s own tab');
  assert.ok(asked[1].at - asked[0].at >= 2000 && asked[2].at - asked[1].at >= 2000, '2 seconds apart');
  assert.equal(calls.created.length, 0, 'no tab is opened');
  assert.deepEqual(done.results.map((row) => [row.page, row.url, row.title, row.status, row.how, row.size]), [[1, pdf('a'), 'A.pdf', 'got', 'Fetched', 1000], [2, pdf('b'), 'B.pdf', 'got', 'Fetched', 1001], [3, pdf('c'), 'C.pdf', 'got', 'Fetched', 1002]]);
  assert.deepEqual([done.state, done.summary, done.ended.reason, done.ended.text, done.count, done.collectionId], ['done', 'Fetched 3 PDFs.', 'finished', '', 0, '']);
  assert.equal(session.linkMeteorCaptureReport, undefined, 'the page that asked shows its own report');
  assert.equal(state().collections[0].links.length, 0, 'no link is saved');
  const told = calls.broadcasts.filter((message) => message.type === 'run.progress' && message.runId === runId);
  assert.ok(told.some((message) => message.text === 'Getting PDF 2 of 3' && message.page === 'B.pdf'), 'the counter names the file in hand');
});

test('PDF files on other sites: not opened without access; with access, a background tab on the PDF’s own site, closed afterward', async () => {
  await reset(); granted.add(OTHER);
  page(`${SITE}/list`, {title: 'Papers'}); page(`${OTHER}/article`, {title: 'An article'}); page(`${OTHER}/`, {title: 'Front page'});
  const tab = clicked(`${SITE}/list`), asked = [];
  fileReply = (message) => { asked.push({tabId: message.tabId, url: message.url, at: now}); return {ok: true, size: 5}; };
  const started = now;
  await ask({type: 'run.start', kind: 'files', tabId: tab.id, files: [
    {url: 'https://third.test/z.pdf', name: 'Z.pdf'},                           // a site without access
    {url: pdf('x', OTHER), from: `${OTHER}/article`, name: 'X.pdf'},           // captured from a page of its own site
    {url: pdf('y', OTHER), from: `${SITE}/list`, name: 'Y.pdf'}]});            // captured from a page of another site
  const done = await toTheEnd();
  assert.deepEqual(fileRows(done), [[1, 'Z.pdf', 'no-access', 'No access'], [2, 'X.pdf', 'got', 'Fetched'], [3, 'Y.pdf', 'got', 'Fetched']]);
  assert.deepEqual(calls.created.map((item) => [item.url, item.active]), [[`${OTHER}/article`, false], [`${OTHER}/`, false]], 'the page the link came from, else the site’s front page, in the background');
  assert.deepEqual(asked.map((item) => [item.tabId, item.url]), [[calls.created[0].id, pdf('x', OTHER)], [calls.created[1].id, pdf('y', OTHER)]], 'the file is asked for through that tab');
  assert.deepEqual(calls.removed.map((item) => item.id), calls.created.map((item) => item.id), 'each tab is closed again');
  assert.ok(asked[0].at - started < 2000, 'a file that was never asked for costs no pause');
  assert.ok(asked[1].at - asked[0].at >= 2000, 'files that were asked for are 2 seconds apart');
  assert.equal(done.summary, 'Fetched 2 of 3 PDFs.');
  // With access to the site of the person's tab too, but the tab on another page: still a background tab.
  await reset(); granted.add(SITE); page(`${SITE}/`, {title: 'Front'});
  fileReply = () => ({ok: true, size: 5});
  await ask({type: 'run.start', kind: 'files', files: [{url: pdf('a'), name: 'A.pdf'}]});
  assert.deepEqual(fileRows(await toTheEnd()), [[1, 'A.pdf', 'got', 'Fetched']]);
  assert.deepEqual(calls.created.map((item) => item.url), [`${SITE}/`]);
});

test('PDF files whose address moves to another site: opened by itself and read where it lands; a download says so', async () => {
  // The person's own tab can't get it (the page's request fails), so its own address is opened.
  await reset(); granted.add(SITE); granted.add(OTHER);
  page(`${SITE}/list`, {title: 'Papers'}); page(pdf('moved'), {redirect: pdf('real', OTHER)}); page(pdf('real', OTHER), {title: 'real.pdf', type: 'application/pdf'});
  let tab = clicked(`${SITE}/list`), asked = [];
  fileReply = (message) => { asked.push({tabId: message.tabId, url: message.url}); return message.url ? {reason: 'failed'} : {ok: true, size: 9}; };
  await ask({type: 'run.start', kind: 'files', tabId: tab.id, files: [{url: pdf('moved'), from: `${SITE}/list`, name: 'Moved.pdf'}]});
  let done = await toTheEnd();
  assert.deepEqual(fileRows(done), [[1, 'Moved.pdf', 'got', 'Fetched']]);
  assert.deepEqual(calls.created.map((item) => item.url), [pdf('moved')], 'only the PDF’s own address is opened: the site’s page already failed');
  assert.deepEqual(asked, [{tabId: tab.id, url: pdf('moved')}, {tabId: calls.created[0].id, url: ''}], 'read from the tab’s own address once Chrome shows it');
  assert.equal(tabs.has(calls.created[0].id), false);

  // Without the person's tab: a page of the site first, then the address itself.
  await reset(); granted.add(SITE); granted.add(OTHER);
  page(`${SITE}/`, {title: 'Front'}); page(pdf('moved'), {redirect: pdf('real', OTHER)}); page(pdf('real', OTHER), {type: 'application/pdf'});
  fileReply = (message) => (message.url ? {reason: 'failed'} : {ok: true, size: 9});
  await ask({type: 'run.start', kind: 'files', files: [{url: pdf('moved'), name: 'Moved.pdf'}]});
  assert.deepEqual(fileRows(await toTheEnd()), [[1, 'Moved.pdf', 'got', 'Fetched']]);
  assert.deepEqual(calls.created.map((item) => item.url), [`${SITE}/`, pdf('moved')]);
  assert.deepEqual(calls.removed.map((item) => item.id), calls.created.map((item) => item.id));

  // It lands on a site Link Meteor can't read: closed unread.
  await reset(); granted.add(SITE);
  page(`${SITE}/list`); page(pdf('moved'), {redirect: pdf('real', OTHER)}); page(pdf('real', OTHER), {type: 'application/pdf'});
  tab = clicked(`${SITE}/list`); asked = [];
  fileReply = (message) => { asked.push(message.url); return {reason: 'failed'}; };
  await ask({type: 'run.start', kind: 'files', tabId: tab.id, files: [{url: pdf('moved'), name: 'Moved.pdf'}]});
  assert.deepEqual(fileRows(await toTheEnd()), [[1, 'Moved.pdf', 'no-access', 'No access: it moved to another site']]);
  assert.deepEqual(asked, [pdf('moved')], 'nothing is asked of a tab Link Meteor can’t read');
  assert.equal(tabs.has(calls.created[0].id), false, 'the tab is closed');

  // With the toolbar's access only, no tab is opened at all.
  await reset(); page(`${SITE}/list`); page(pdf('moved'), {redirect: pdf('real', OTHER)});
  tab = clicked(`${SITE}/list`);
  fileReply = () => ({reason: 'failed'});
  await ask({type: 'run.start', kind: 'files', tabId: tab.id, files: [{url: pdf('moved'), name: 'Moved.pdf'}]});
  assert.deepEqual(fileRows(await toTheEnd()), [[1, 'Moved.pdf', 'no-access', 'Not fetched: the address may move to another site, which Link Meteor has no access to']]);
  assert.equal(calls.created.length, 0);

  // An address the site sends as a download: Chrome saves it and closes the tab.
  await reset(); granted.add(SITE); granted.add(OTHER);
  page(`${SITE}/list`); page(pdf('moved'), {redirect: pdf('sent', OTHER)}); page(pdf('sent', OTHER), {download: true});
  tab = clicked(`${SITE}/list`);
  fileReply = () => ({reason: 'failed'});
  page(pdf('quick'), {redirect: pdf('sent-at-once', OTHER)}); page(pdf('sent-at-once', OTHER), {download: 'at once'}); page(pdf('gone'), {never: true});
  await ask({type: 'run.start', kind: 'files', tabId: tab.id, files: [{url: pdf('moved'), name: 'Moved.pdf'}, {url: pdf('quick'), name: 'Quick.pdf'}, {url: pdf('gone'), name: 'Gone.pdf'}]});
  done = await toTheEnd();
  const DOWNLOADED = 'Chrome downloaded this one instead of showing it. It is in your Downloads folder, not in this file.';
  assert.deepEqual(fileRows(done), [[1, 'Moved.pdf', 'downloaded', DOWNLOADED], [2, 'Quick.pdf', 'downloaded', DOWNLOADED], [3, 'Gone.pdf', 'not-loaded', 'Didn’t load within 30 seconds']]);
  assert.equal(tabs.size, 1, 'only the person’s own tab is left');
  assert.equal(done.summary, 'Fetched 0 of 3 PDFs.');
  // A tab that stays open without an address Link Meteor can see is on a site without access, not a download.
  await reset(); granted.add(SITE);
  page(`${SITE}/list`); page(pdf('moved'), {redirect: pdf('real', OTHER)}); page(pdf('real', OTHER), {type: 'application/pdf'});
  tab = clicked(`${SITE}/list`);
  fileReply = () => ({reason: 'failed'});
  const began = now;
  await ask({type: 'run.start', kind: 'files', tabId: tab.id, files: [{url: pdf('moved'), name: 'Moved.pdf'}]});
  assert.deepEqual(fileRows(await toTheEnd()), [[1, 'Moved.pdf', 'no-access', 'No access: it moved to another site']]);
  assert.ok(now - began >= 2000, 'after the 2 seconds Chrome takes to close a tab it downloads from');
});

test('PDF files: a file asked for a second time, through another tab, is not cut short by the first question’s time limit', async () => {
  await reset(); granted.add(SITE); granted.add(OTHER);
  page(`${SITE}/list`); page(pdf('moved'), {redirect: pdf('real', OTHER)}); page(pdf('real', OTHER), {type: 'application/pdf'});
  const tab = clicked(`${SITE}/list`), asked = [];
  // The person's own tab fails at once; the second question, through the PDF's own tab, is answered late.
  fileReply = (message) => { asked.push({url: message.url, at: now}); return message.url ? {reason: 'failed'} : null; };
  const {runId} = await ask({type: 'run.start', kind: 'files', tabId: tab.id, files: [{url: pdf('moved'), name: 'Moved.pdf'}]});
  await advance(1000);
  assert.deepEqual(asked.map((item) => item.url), [pdf('moved'), ''], 'asked twice for the same file');
  // Past the first question's 2 minutes, and still inside the second one's.
  await advance(120000 - now + asked[0].at + 50);
  assert.ok(now - asked[1].at < 120000);
  assert.equal((await status()).state, 'running');
  assert.deepEqual(await ask({type: 'run.fileDone', runId, step: 0, ok: true, size: 11}), {taken: true}, 'the late answer is still taken');
  const done = await toTheEnd();
  assert.deepEqual(done.results.map((row) => [row.status, row.how, row.size]), [['got', 'Fetched', 11]]);
});

test('PDF files: what the page that fetches one says decides its line; a set over the limit, or no answer, ends the run', async () => {
  await reset(); page(`${SITE}/list`);
  let tab = clicked(`${SITE}/list`);
  const replies = [{reason: 'not-pdf'}, {reason: 'size'}, {reason: 'status'}, {ok: true, size: 7}, {reason: 'set-size'}];
  fileReply = (message) => replies[message.step];
  await ask({type: 'run.start', kind: 'files', tabId: tab.id, files: ['signin', 'huge', 'missing', 'fine', 'last', 'never'].map((name) => ({url: pdf(name), name: `${name}.pdf`}))});
  let done = await toTheEnd();
  assert.deepEqual(fileRows(done), [
    [1, 'signin.pdf', 'not-pdf', 'Not a PDF: the site asked to sign in, or the address has expired.'],
    [2, 'huge.pdf', 'too-large', 'A PDF can be at most 50 MB.'],
    [3, 'missing.pdf', 'status', 'The site answered with an error instead of the PDF.'],
    [4, 'fine.pdf', 'got', 'Fetched'],
    [5, 'last.pdf', 'too-large', SET_WORDS],
    [6, '', 'not-read', 'Not read']]);
  assert.deepEqual([done.ended.reason, done.ended.text, done.summary], ['too-large', SET_WORDS, 'Fetched 1 of 6 PDFs.']);
  assert.equal(calls.created.length, 0, 'a file the site refused is not tried again in a tab');

  // The page that started the run is gone: the first file ends the run.
  await reset(); page(`${SITE}/list`); tab = clicked(`${SITE}/list`); pagesOpen = false;
  await ask({type: 'run.start', kind: 'files', tabId: tab.id, files: [{url: pdf('a'), name: 'A.pdf'}, {url: pdf('b'), name: 'B.pdf'}]});
  done = await toTheEnd();
  assert.deepEqual(fileRows(done), [[1, 'A.pdf', 'no-answer', UNANSWERED], [2, '', 'not-read', 'Not read']]);
  assert.deepEqual([done.ended.reason, done.ended.text], ['no-answer', UNANSWERED]);
  // A page that is open but never answers gets 2 minutes.
  await reset(); page(`${SITE}/list`); tab = clicked(`${SITE}/list`);
  fileReply = () => null;
  await ask({type: 'run.start', kind: 'files', tabId: tab.id, files: [{url: pdf('a'), name: 'A.pdf'}]});
  await advance(119000);
  assert.equal((await status()).state, 'running');
  await advance(2000);
  assert.deepEqual([(await status()).state, (await status()).ended.reason], ['done', 'no-answer']);

  // Stop, while a file is being fetched: it and the rest are not read, and an answer that comes later is not taken.
  await reset(); page(`${SITE}/list`); tab = clicked(`${SITE}/list`);
  fileReply = () => null;
  const {runId} = await ask({type: 'run.start', kind: 'files', tabId: tab.id, files: [{url: pdf('a'), name: 'A.pdf'}, {url: pdf('b'), name: 'B.pdf'}]});
  await advance(1000);
  await ask({type: 'run.stop', runId});
  await settle();
  done = await status();
  assert.deepEqual([done.state, done.ended.reason, done.ended.text, done.summary], ['done', 'stopped', 'You pressed Stop.', 'Fetched 0 of 2 PDFs.']);
  assert.deepEqual(fileRows(done), [[1, 'A.pdf', 'not-read', 'Not read: you pressed Stop'], [2, '', 'not-read', 'Not read: you pressed Stop']]);
  assert.deepEqual(await ask({type: 'run.fileDone', runId, step: 0, ok: true, size: 5}), {taken: false});
});

test('PDF files are refused before a run starts: none, more than 20, and addresses that aren’t on the web; a restarted worker goes on', async () => {
  await reset();
  const refusal = async (message) => (await call(message)).error;
  assert.equal(await refusal({type: 'run.start', kind: 'files'}), 'Choose at least one PDF.');
  assert.equal(await refusal({type: 'run.start', kind: 'files', files: []}), 'Choose at least one PDF.');
  assert.equal(await refusal({type: 'run.start', kind: 'files', files: Array.from({length: 21}, (_, i) => ({url: pdf(`p${i}`)}))}), 'Choose up to 20 PDFs at a time.');
  assert.equal(await refusal({type: 'run.start', kind: 'files', files: [{url: pdf('a')}, {url: 'file:///Users/me/paper.pdf'}]}), 'Choose PDFs at web addresses.');
  assert.equal(await refusal({type: 'run.start', kind: 'files', files: [{}]}), 'Choose PDFs at web addresses.');
  assert.equal((await call({type: 'run.start', kind: 'files', files: [{url: pdf('a')}]}, {url: `${SITE}/list`, tab: {id: 5}})).error, 'This action must be requested from the Link Meteor workbench.');
  assert.equal((await call({type: 'run.fileDone', runId: 'x', step: 0, ok: true, size: 1}, {url: `${SITE}/list`, tab: {id: 5}})).error, 'This action must be requested from the Link Meteor workbench.');
  assert.equal(session.linkMeteorRun, undefined, 'nothing was started');
  // 20 are taken.
  page(`${SITE}/list`); const tab = clicked(`${SITE}/list`);
  fileReply = () => ({ok: true, size: 1});
  await ask({type: 'run.start', kind: 'files', tabId: tab.id, files: Array.from({length: 20}, (_, i) => ({url: pdf(`p${i}`), name: `P${i}.pdf`}))});
  assert.equal((await call({type: 'run.start', kind: 'files', files: [{url: pdf('a')}]})).error, 'Link Meteor is already running a capture. Stop it, or wait for it to finish.', 'one run at a time');
  assert.equal((await toTheEnd()).summary, 'Fetched 20 PDFs.');

  // What the last worker left: file 1 fetched, file 2 in hand with a background tab open, file 3 to come.
  await reset(); granted.add(SITE); page(`${SITE}/`, {title: 'Front'});
  const orphan = {id: nextTabId++, access: '', url: `${SITE}/`, title: 'Front', status: 'complete', document: site.get(`${SITE}/`)};
  tabs.set(orphan.id, orphan);
  fileReply = () => ({ok: true, size: 3});
  session.linkMeteorRun = {runId: 'files-left', kind: 'files', state: 'running', stopping: false, collectionId: '', name: '', batchId: 'batch-left', scroll: false,
    queue: ['a', 'b', 'c'].map((name) => ({url: pdf(name), name: `${name}.pdf`})), at: 1, seen: [], results: [{page: 1, url: pdf('a'), title: 'a.pdf', status: 'got', found: 0, added: 0, skipped: 0, leftOut: 0, how: 'Fetched', size: 3}],
    links: 0, doing: {index: 1, tabId: orphan.id}, live: null, page: null, ended: null, startedAt: '2026-10-02T10:00:00.000Z'};
  await runs.resumeRun();
  assert.equal(tabs.has(orphan.id), false, 'the tab it had opened is closed');
  const done = await toTheEnd();
  assert.deepEqual(fileRows(done), [[1, 'a.pdf', 'got', 'Fetched'], [2, '', 'interrupted', 'Interrupted: Chrome stopped Link Meteor’s background worker'], [3, 'c.pdf', 'got', 'Fetched']]);
  assert.deepEqual([done.runId, done.summary, done.ended.reason], ['files-left', 'Fetched 2 of 3 PDFs.', 'finished']);
});
