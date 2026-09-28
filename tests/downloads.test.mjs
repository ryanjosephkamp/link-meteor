// Downloading the files behind links (0.4.0) in the background, with Chrome's APIs simulated in Node:
// downloads.start, capture.download, downloads.cancel and the Download linked file menu item. The
// simulated download system behaves as Chrome for Testing was seen to: it asks every
// onDeterminingFilename listener for a name (a listener's suggestion wins, with conflictAction
// 'uniquify' adding " (1)"), reports the type the site sends, and follows onChanged, search and
// cancel. API mocks, not Chrome itself: tests/downloads-granted.mjs downloads for real.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../src/core/model.js';
import {downloadFolder, folderLabel} from '../src/core/files.js';

const EXTENSION_ID = 'meteor-id';
const event = () => ({listeners: [], addListener(fn) { this.listeners.push(fn); }, removeListener(fn) { this.listeners = this.listeners.filter((item) => item !== fn); }});
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const local = {linkMeteorState: createState()}, session = {};
const granted = new Set(['downloads']);
const calls = {download: [], search: [], cancel: [], progress: [], tabMessages: [], created: [], menus: [], inject: []};
const tabs = [
  {id: 1, windowId: 1, url: 'https://a.test/page', title: 'Page A'},
  {id: 2, windowId: 1, url: 'https://b.test/page', title: 'Page B'},
  {id: 3, windowId: 1, url: 'chrome-extension://meteor/ui/workbench.html', title: 'Link Meteor', active: true},
];
// What each simulated tab's page script answers to content.contextLink.
const contextLinks = new Map();

/* The simulated download system. */
const determining = event(), changedEvent = event();
const items = new Map(), disk = new Set(), suggestions = [];
let nextId = 1, running = 0, mostRunning = 0;
// How the fixture site answers each address: the type it sends, how the download ends and when.
function site(url) {
  const {pathname} = new URL(url);
  const spec = {mime: 'application/pdf', end: 'complete', ms: 5};
  if (pathname.endsWith('.png')) spec.mime = 'image/png';
  if (pathname.includes('paywalled')) spec.mime = 'text/html';
  if (pathname.includes('missing')) Object.assign(spec, {mime: 'text/html', end: 'interrupted', error: 'SERVER_BAD_CONTENT'});
  if (pathname.includes('slow')) spec.ms = 400;
  if (pathname.includes('medium')) spec.ms = 25;
  if (pathname.includes('early')) spec.early = true;
  if (pathname.includes('dangerous')) spec.danger = 'file';
  if (pathname.includes('vanishes')) spec.vanish = true;
  return spec;
}
function unique(name, uniquify) {
  if (!uniquify || !disk.has(name)) { disk.add(name); return name; }
  const dot = name.lastIndexOf('.');
  for (let n = 1; ; n++) {
    const candidate = dot > name.lastIndexOf('/') ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
    if (!disk.has(candidate)) { disk.add(candidate); return candidate; }
  }
}
function fire(id, delta) { for (const listener of changedEvent.listeners) listener({id, ...delta}); }
function end(item, state, error) {
  if (item.state !== 'in_progress') return;
  running--;
  Object.assign(item, {state, ...(error ? {error} : {})});
  if (state === 'interrupted') disk.delete(item.filename.slice('/Downloads/'.length)); // no file is left behind
  fire(item.id, {state: {previous: 'in_progress', current: state}, ...(error ? {error: {current: error}} : {})});
}
// Asks every listener for a name, as Chrome does; returns what each suggested.
function askNames(item, chromeName) {
  const answers = [];
  for (const listener of [...determining.listeners]) listener({...item, filename: chromeName}, (suggestion) => answers.push(suggestion ?? null));
  return answers;
}
const downloads = {
  onDeterminingFilename: determining, onChanged: changedEvent,
  async download({url, filename, conflictAction, saveAs}) {
    const spec = site(url), id = nextId++;
    calls.download.push({id, url, filename, conflictAction, saveAs});
    const item = {id, url, finalUrl: url, mime: spec.mime, state: 'in_progress', danger: 'safe', filename: '', byExtensionId: EXTENSION_ID};
    items.set(id, item);
    running++; mostRunning = Math.max(mostRunning, running);
    const determine = () => {
      const chromeName = new URL(url).pathname.split('/').pop().replace(/\.pdf$/, spec.mime === 'text/html' ? '.html' : '.pdf') || 'download';
      const [answer] = askNames(item, chromeName);
      suggestions.push({id, answer});
      // A listener's filename wins; a listener without one leaves Chrome's own name (the creator's is dropped).
      const name = answer?.filename || (determining.listeners.length ? chromeName : filename || chromeName);
      item.filename = `/Downloads/${unique(name, (answer?.conflictAction || conflictAction) === 'uniquify')}`;
      fire(id, {filename: {previous: '', current: item.filename}});
      if (spec.vanish) { items.delete(id); running--; return; }
      if (spec.danger) { item.danger = spec.danger; fire(id, {danger: {previous: 'safe', current: spec.danger}}); running--; return; }
      setTimeout(() => end(item, spec.end, spec.error), spec.ms);
    };
    if (spec.early) determine(); else setTimeout(determine, 1);
    return id;
  },
  async search({id}) { calls.search.push(id); const item = items.get(id); return item ? [structuredClone(item)] : []; },
  async cancel(id) { calls.cancel.push(id); const item = items.get(id); if (item) end(item, 'interrupted', 'USER_CANCELED'); },
};

globalThis.chrome = {
  storage: {
    onChanged: event(),
    local: {async get(key) { return {[key]: structuredClone(local[key])}; }, async set(value) { Object.assign(local, structuredClone(value)); }},
    session: {async get(key) { return {[key]: structuredClone(session[key])}; }, async set(value) { Object.assign(session, structuredClone(value)); }, async remove(key) { delete session[key]; }},
  },
  runtime: {id: EXTENSION_ID, getURL: (path) => 'chrome-extension://meteor/' + path, sendMessage: async (message) => { if (message.type === 'downloads.progress') calls.progress.push(message); }, onMessage: event(), onInstalled: event(), onStartup: event()},
  permissions: {async contains({permissions = [], origins = []}) { return !origins.length && permissions.every((name) => granted.has(name)); }, onAdded: event(), onRemoved: event()},
  scripting: {
    async executeScript(spec) { calls.inject.push(spec.target.tabId); return spec.files ? [] : [{result: {links: [], warnings: []}}]; },
    async getRegisteredContentScripts() { return []; }, async unregisterContentScripts() {}, async registerContentScripts() {},
  },
  tabs: {
    async query() { return tabs; }, async get(id) { const tab = tabs.find((t) => t.id === id); if (!tab) throw Error('No tab'); return tab; },
    async sendMessage(tabId, message) {
      calls.tabMessages.push({tabId, ...message});
      if (message.type === 'content.contextLink') { if (!contextLinks.has(tabId)) throw Error('Could not establish connection. Receiving end does not exist.'); return contextLinks.get(tabId); }
    },
    async create(spec) { calls.created.push(spec); return {id: 99}; }, async update() {},
  },
  windows: {async getAll() { return [{id: 1, focused: true, tabs}]; }, async update() {}},
  downloads,
  action: {onClicked: event()}, sidePanel: {open: async () => {}}, commands: {onCommand: event()},
  contextMenus: {onClicked: event(), removeAll: async () => { calls.menus.length = 0; }, create: (spec) => { calls.menus.push(spec); }},
};
await import('../src/background.js');

const WORKBENCH = {url: 'chrome-extension://meteor/ui/workbench.html', tab: tabs[2]};
const PAGE = {url: 'https://a.test/page', tab: tabs[0]};
const OTHER_PAGE = {url: 'https://b.test/page', tab: tabs[1]};
const call = (message, sender = WORKBENCH) => new Promise((resolve) => chrome.runtime.onMessage.listeners[0](message, sender, resolve));
const ok = async (message, sender) => { const reply = await call(message, sender); assert.equal(reply.ok, true, reply.error); return reply.data; };
const refused = async (message, pattern, sender) => { const reply = await call(message, sender); assert.equal(reply.ok, false, 'refused'); assert.match(reply.error, pattern); return reply.error; };
const until = async (fn, message) => { for (let i = 0; i < 400; i++) { if (await fn()) return; await sleep(5); } assert.fail(message); };
const link = (path, anchorText = '', host = 'https://files.test') => ({url: host + path, anchorText, accessibleLabel: ''});
const saved = (result) => result.results.map((item) => item.file);
const reset = () => { for (const list of Object.values(calls)) list.length = 0; suggestions.length = 0; mostRunning = running; };
const stored = () => local.linkMeteorState;

test('downloads.start saves each file into Link Meteor/<collection>, named after its anchor text', async () => {
  reset();
  const links = [
    link('/files/paper.pdf', 'Attention in small systems'), link('/files/figure.png', 'Figure 1: heat map'),
    link('/files/paywalled.pdf', 'Paywalled article'), link('/files/paper', '[PDF] fixture.test'),
    link('/files/missing.pdf', 'Missing paper'), link('/files/paper.pdf?copy=2', 'Attention in small systems'),
  ];
  const result = await ok({type: 'downloads.start', links, collectionName: 'Thesis sources', requestId: 'r-names'});
  assert.deepEqual(result.results.map((item) => [item.status, item.file]), [
    ['saved', 'Attention-in-small-systems.pdf'], ['saved', 'Figure-1-heat-map.png'], ['web-page', 'Paywalled-article.html'],
    ['saved', 'fixture.test.pdf'], ['failed', ''], ['saved', 'Attention-in-small-systems (1).pdf'],
  ]);
  assert.deepEqual([...disk].filter((path) => path.startsWith('Link Meteor/Thesis-sources/')).sort(), [
    'Link Meteor/Thesis-sources/Attention-in-small-systems (1).pdf', 'Link Meteor/Thesis-sources/Attention-in-small-systems.pdf',
    'Link Meteor/Thesis-sources/Figure-1-heat-map.png', 'Link Meteor/Thesis-sources/Paywalled-article.html', 'Link Meteor/Thesis-sources/fixture.test.pdf',
  ]);
  assert.match(result.results[4].reason, /^the site says the file isn’t there \(SERVER_BAD_CONTENT\)$/);
  assert.equal(result.results[2].mime, 'text/html');
  assert.deepEqual({total: result.total, saved: result.saved, webPages: result.webPages, failed: result.failed, cancelled: result.cancelled, held: result.held, folder: result.folder},
    {total: 6, saved: 4, webPages: 1, failed: 1, cancelled: 0, held: 0, folder: 'Link Meteor/Thesis-sources'});
  assert.equal(result.summary, 'Saved 4 files to Link Meteor › Thesis-sources in your downloads folder. 1 link gave a web page instead of a file, often a sign-in page. 1 download failed.');
  // Every download: no Save As dialog, uniquified names, and the name given once Chrome knows the type.
  assert.ok(calls.download.every((item) => item.saveAs === false && item.conflictAction === 'uniquify'));
  assert.ok(suggestions.every(({answer}) => answer.conflictAction === 'uniquify' && answer.filename.startsWith('Link Meteor/Thesis-sources/')));
  // Progress after each file, to the workbench.
  assert.deepEqual(calls.progress.map((update) => update.done), [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(calls.progress.every((update) => update.requestId === 'r-names' && update.total === 6));
  // Link Meteor looked only at its own downloads, and stopped listening afterwards.
  const mine = new Set(calls.download.map((item) => item.id));
  assert.ok(calls.search.length && calls.search.every((id) => mine.has(id)));
  assert.equal(determining.listeners.length, 0); assert.equal(changedEvent.listeners.length, 0);
});

test('the links are checked before anything downloads', async () => {
  reset();
  await refused({type: 'downloads.start', links: [], collectionName: 'X'}, /at least one link/);
  await refused({type: 'downloads.start', links: [link('/a.pdf'), {url: 'mailto:someone@a.test', anchorText: 'Mail'}]}, /Only web links \(HTTP or HTTPS\)/);
  await refused({type: 'downloads.start', links: [{url: 'javascript:alert(1)//a.pdf'}]}, /Only web links/);
  const many = Array.from({length: 101}, (_, i) => link(`/many/${i}.pdf`, `Paper ${i}`));
  await refused({type: 'downloads.start', links: many, confirmed: true}, /at most 100 files at a time, and 101 were chosen/);
  await refused({type: 'downloads.start', links: many.slice(0, 11)}, /more than 10 files needs a confirmation/);
  await refused({type: 'downloads.start', links: [link('/a.pdf')], requestId: 'x'.repeat(101)}, /request ID/);
  await refused({type: 'downloads.start', links: [link('/a.pdf')], collectionName: 7}, /collection name must be text/);
  assert.equal(calls.download.length, 0, 'nothing downloaded');
  // One file per address: twelve links to ten addresses need no confirmation.
  const repeated = [...many.slice(0, 10), many[0], many[1]];
  const result = await ok({type: 'downloads.start', links: repeated, collectionName: 'Repeats'});
  assert.equal(result.total, 10); assert.equal(calls.download.length, 10);
});

test('at most 3 files download at a time, in the order given', async () => {
  reset(); mostRunning = 0;
  const links = Array.from({length: 9}, (_, i) => link(`/medium/${i}.pdf`, `Medium ${i}`));
  const result = await ok({type: 'downloads.start', links, collectionName: 'Order', confirmed: false});
  assert.equal(result.saved, 9);
  assert.equal(mostRunning, 3);
  assert.deepEqual(calls.download.map((item) => item.url), links.map((item) => item.url));
});

test('Cancel stops the downloads in progress and starts no more; a page can’t cancel another’s', async () => {
  reset();
  const links = Array.from({length: 8}, (_, i) => link(`/slow/${i}.pdf`, `Slow ${i}`));
  const pending = call({type: 'downloads.start', links, collectionName: 'Stopped', requestId: 'r-cancel'});
  await until(() => calls.download.length === 3 && calls.search.length >= 3, 'three downloads running');
  assert.deepEqual(await ok({type: 'downloads.cancel', requestId: 'r-cancel'}, PAGE), {cancelled: false}, 'a page can’t cancel the workbench’s request');
  assert.deepEqual(await ok({type: 'downloads.cancel', requestId: 'r-cancel'}), {cancelled: true});
  const reply = await pending;
  assert.equal(reply.ok, true, reply.error);
  assert.equal(calls.download.length, 3, 'no more started after Cancel');
  assert.deepEqual(calls.cancel.sort(), calls.download.map((item) => item.id).sort(), 'only its own downloads were canceled');
  assert.equal(reply.data.cancelled, 8); assert.equal(reply.data.saved, 0);
  assert.equal(reply.data.summary, 'Canceled 8 downloads that hadn’t finished.');
  assert.deepEqual(await ok({type: 'downloads.cancel', requestId: 'r-cancel'}), {cancelled: false}, 'finished requests can’t be canceled');
});

test('Chrome may ask for a name before download() answers; the address then finds the right link', async () => {
  reset();
  const result = await ok({type: 'downloads.start', links: [link('/early/report.pdf', 'Early report')], collectionName: 'Race'});
  assert.equal(result.results[0].file, 'Early-report.pdf');
  assert.equal(result.saved, 1);
});

test('other downloads keep the names Chrome gives them, and are never looked up', async () => {
  reset();
  const pending = call({type: 'downloads.start', links: [link('/slow/mine.pdf', 'Mine')], collectionName: 'Mine', requestId: 'r-mine'});
  await until(() => determining.listeners.length === 1 && calls.download.length === 1, 'listening');
  const person = askNames({id: 900, url: 'https://elsewhere.test/mine.pdf', mime: 'application/pdf', state: 'in_progress'}, 'mine.pdf');
  const other = askNames({id: 901, url: 'https://files.test/slow/mine.pdf', mime: 'application/pdf', state: 'in_progress', byExtensionId: 'another-extension'}, 'mine.pdf');
  assert.deepEqual([person, other], [[null], [null]], 'suggest() with no name for downloads Link Meteor didn’t start');
  await ok({type: 'downloads.cancel', requestId: 'r-mine'});
  await pending;
  assert.ok(!calls.search.includes(900) && !calls.search.includes(901));
});

test('a file Chrome holds for review, and one removed from Chrome’s list, are reported and free their place', async () => {
  reset();
  const result = await ok({type: 'downloads.start', links: [link('/dangerous/tool.zip', 'Tool'), link('/files/paper.pdf', 'Paper'), link('/vanishes/gone.pdf', 'Gone')], collectionName: 'Held'});
  assert.deepEqual(result.results.map((item) => item.status), ['held', 'saved', 'failed']);
  assert.equal(result.results[2].reason, 'it was removed from Chrome’s downloads list');
  assert.equal(result.summary, 'Saved 1 file to Link Meteor › Held in your downloads folder. Chrome is holding 1 file for you to review in its downloads list. 1 download failed.');
});

test('one file: the summary names it, or says what happened', async () => {
  reset();
  let result = await ok({type: 'downloads.start', links: [link('/files/figure.png', 'Figure 2')], collectionName: 'One'});
  assert.equal(result.summary, 'Saved “Figure-2.png” to Link Meteor › One in your downloads folder.');
  result = await ok({type: 'downloads.start', links: [link('/files/paywalled.pdf', 'Behind a wall')], collectionName: 'One'});
  assert.equal(result.summary, 'The link gave a web page instead of a file, often a sign-in page. It was saved as “Behind-a-wall.html”.');
  result = await ok({type: 'downloads.start', links: [link('/files/missing.pdf', 'Gone')], collectionName: 'One'});
  assert.equal(result.summary, 'The download failed: the site says the file isn’t there (SERVER_BAD_CONTENT).');
  // Any link can be downloaded from its details; a web page there is simply saved as one.
  result = await ok({type: 'downloads.start', links: [link('/files/paywalled', 'An article page')], collectionName: 'One'});
  assert.equal(result.results[0].status, 'saved');
  assert.equal(result.summary, 'Saved “An-article-page.html” to Link Meteor › One in your downloads folder, a web page.');
});

test('capture.download from the card: only file links, into the destination’s folder, with progress to that tab', async () => {
  reset();
  const state = await ok({type: 'state.mutate', action: {type: 'collection.create', name: 'Card destination'}});
  const destination = state.activeCollectionId;
  await ok({type: 'state.mutate', action: {type: 'collection.activate', id: stored().collections[0].id}});
  const links = [link('/files/paper.pdf', 'Card paper'), link('/about', 'About the lab'), link('/files/figure.png', 'Card figure'), link('/files/paper.pdf', 'Card paper again'), link('/files/paper', '[PDF] lab.test')];
  const result = await ok({type: 'capture.download', links, collectionId: destination, requestId: 'r-card'}, PAGE);
  assert.deepEqual(calls.download.map((item) => item.url), ['https://files.test/files/paper.pdf', 'https://files.test/files/figure.png', 'https://files.test/files/paper']);
  assert.equal(result.folder, 'Link Meteor/Card-destination');
  assert.deepEqual(saved(result), ['Card-paper.pdf', 'Card-figure.png', 'lab.test.pdf']);
  const toTab = calls.tabMessages.filter((message) => message.type === 'downloads.progress');
  assert.ok(toTab.length >= 4 && toTab.every((message) => message.tabId === 1 && message.requestId === 'r-card'));
  assert.equal(calls.progress.length, 0, 'the card’s progress goes to its tab only');
  await refused({type: 'capture.download', links: [link('/about', 'About')]}, /None of the ticked links are file links/, PAGE);
  await refused({type: 'capture.download', links: [link('/files/paper.pdf', 'Paper')]}, /must start from the capture card/, {url: WORKBENCH.url});
  await refused({type: 'capture.download', links: Array.from({length: 11}, (_, i) => link(`/n/${i}.pdf`))}, /confirmation/, PAGE);
  // A page may cancel only its own request.
  const pending = call({type: 'capture.download', links: [link('/slow/card.pdf', 'Slow card')], requestId: 'r-card-slow'}, PAGE);
  await until(() => calls.download.some((item) => item.url.endsWith('/slow/card.pdf')), 'card download running');
  assert.deepEqual(await ok({type: 'downloads.cancel', requestId: 'r-card-slow'}, OTHER_PAGE), {cancelled: false});
  assert.deepEqual(await ok({type: 'downloads.cancel', requestId: 'r-card-slow'}, PAGE), {cancelled: true});
  assert.equal((await pending).data.cancelled, 1);
});

test('without download access nothing downloads, and the card’s files wait for the full view', async () => {
  reset();
  granted.delete('downloads');
  try {
    await refused({type: 'downloads.start', links: [link('/files/paper.pdf', 'Paper')], collectionName: 'X'}, /^Download access is needed\. Open the full view/);
    const links = [link('/files/paper.pdf', 'Waiting paper'), link('/about', 'Not a file'), link('/files/figure.png', 'Waiting figure')];
    await refused({type: 'capture.download', links}, /^Download access is needed/, PAGE);
    const waiting = session.linkMeteorPendingDownloads;
    assert.deepEqual({...waiting, createdAt: typeof waiting.createdAt}, {
      links: [{url: 'https://files.test/files/paper.pdf', anchorText: 'Waiting paper', accessibleLabel: ''}, {url: 'https://files.test/files/figure.png', anchorText: 'Waiting figure', accessibleLabel: ''}],
      collectionName: stored().collections.find((c) => c.id === stored().activeCollectionId).name, source: 'card', createdAt: 'string'});
    assert.equal(calls.download.length, 0);
  } finally { granted.add('downloads'); delete session.linkMeteorPendingDownloads; }
});

test('downloads.start is for the workbench only; progress notifications are not requests', async () => {
  reset();
  await refused({type: 'downloads.start', links: [link('/files/paper.pdf')]}, /must be requested from the Link Meteor workbench/, PAGE);
  assert.equal(chrome.runtime.onMessage.listeners[0]({type: 'downloads.progress', requestId: 'x'}, WORKBENCH, () => assert.fail('no reply')), false);
  assert.equal(calls.download.length, 0);
});

test('the Download linked file menu item: created on install, only for file links', async () => {
  reset();
  await chrome.runtime.onInstalled.listeners[0]();
  const item = calls.menus.find((spec) => spec.id === 'meteor-download');
  assert.deepEqual({...item, targetUrlPatterns: item.targetUrlPatterns.length > 100}, {id: 'meteor-download', title: 'Download linked file', contexts: ['link'], targetUrlPatterns: true});
  for (const pattern of ['*://*/*.pdf', '*://*/*.PDF?*', '*://*/*.png', '*://*.arxiv.org/pdf/*']) assert.ok(item.targetUrlPatterns.includes(pattern), pattern);
});

test('Download linked file saves the right-clicked link into the active collection’s folder and tells the page', async () => {
  reset();
  const folder = downloadFolder(stored().collections.find((c) => c.id === stored().activeCollectionId).name);
  contextLinks.set(1, {url: 'https://files.test/files/report.pdf', anchorText: 'Quarterly report'});
  chrome.contextMenus.onClicked.listeners[0]({menuItemId: 'meteor-download', linkUrl: 'https://files.test/files/report.pdf'}, tabs[0]);
  await until(() => calls.tabMessages.some((message) => message.type === 'downloads.progress' && message.final), 'the page is told');
  assert.deepEqual(calls.inject, [1], 'the page script is loaded with the click’s temporary access');
  assert.ok(disk.has(`${folder}/Quarterly-report.pdf`));
  const told = calls.tabMessages.find((message) => message.final);
  assert.equal(told.tabId, 1);
  assert.equal(told.text, `Saved “Quarterly-report.pdf” to ${folderLabel(folder)} in your downloads folder.`);
  // Without an answer from the page, the address names the file.
  contextLinks.delete(1); reset();
  chrome.contextMenus.onClicked.listeners[0]({menuItemId: 'meteor-download', linkUrl: 'https://files.test/files/annual%20summary.pdf'}, tabs[0]);
  await until(() => calls.tabMessages.some((message) => message.final), 'the page is told again');
  assert.ok(disk.has(`${folder}/annual-summary.pdf`));
});

test('Download linked file without access opens the full view with the link waiting', async () => {
  reset();
  granted.delete('downloads');
  try {
    contextLinks.set(1, {url: 'https://files.test/files/waiting.pdf', anchorText: 'Waiting report'});
    chrome.contextMenus.onClicked.listeners[0]({menuItemId: 'meteor-download', linkUrl: 'https://files.test/files/waiting.pdf'}, tabs[0]);
    await until(() => calls.created.length === 1, 'the full view opens');
    assert.equal(calls.created[0].url, 'chrome-extension://meteor/ui/workbench.html');
    assert.deepEqual(session.linkMeteorPendingDownloads.links, [{url: 'https://files.test/files/waiting.pdf', anchorText: 'Waiting report', accessibleLabel: ''}]);
    assert.equal(session.linkMeteorPendingDownloads.source, 'menu');
    assert.equal(calls.download.length, 0);
  } finally { granted.add('downloads'); contextLinks.delete(1); delete session.linkMeteorPendingDownloads; }
});
