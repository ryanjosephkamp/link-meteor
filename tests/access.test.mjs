// Access and capture (0.3.0) in the background, with Chrome's APIs simulated in Node: hold-drag
// registration for chosen sites and all sites, exceptions, keeping access honest, following saved
// writes, opening many links, and the capture card's messages. API mocks, not Chrome itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../src/core/model.js';

const ALL = ['http://*/*', 'https://*/*'];
const event = () => ({listeners: [], addListener(fn) { this.listeners.push(fn); }, fire(...args) { for (const fn of this.listeners) fn(...args); }});
const local = {linkMeteorState: createState()}, session = {};
const granted = {origins: new Set(), permissions: new Set()};
let registered = [], nextTabId = 100, nextWindowId = 10, nextGroupId = 1, failUrls = new Set();
const calls = {register: [], inject: [], configure: [], created: [], windows: [], groups: [], titles: [], progress: [], tabMessages: [], bookmarks: []};
const tabs = [
  {id: 1, windowId: 1, url: 'https://a.test/page', title: 'A'},
  {id: 2, windowId: 1, url: 'https://b.test/page', title: 'B'},
  {id: 3, windowId: 1, url: 'chrome-extension://meteor/ui/workbench.html', title: 'Link Meteor', active: true},
  {id: 4, windowId: 1, url: 'https://c.test/page', title: 'C, never granted on its own'},
];
const covered = (pattern) => granted.origins.has(pattern) || (/^https?:\/\//.test(pattern) && granted.origins.has(pattern.slice(0, pattern.indexOf(':')) + '://*/*'));
const onAdded = event(), onRemoved = event(), storageChanged = event();

globalThis.chrome = {
  storage: {
    onChanged: storageChanged,
    local: {async get(key) { return {[key]: structuredClone(local[key])}; }, async set(value) { Object.assign(local, structuredClone(value)); storageChanged.fire(Object.fromEntries(Object.keys(value).map((key) => [key, {newValue: value[key]}])), 'local'); }},
    session: {async get(key) { return {[key]: structuredClone(session[key])}; }, async set(value) { Object.assign(session, structuredClone(value)); }, async remove(key) { delete session[key]; }},
  },
  runtime: {getURL: (path) => 'chrome-extension://meteor/' + path, sendMessage: async (message) => { if (message.type === 'links.progress') calls.progress.push(message); }, onMessage: event(), onInstalled: event(), onStartup: event()},
  permissions: {
    async contains({origins = [], permissions = []}) { return origins.every(covered) && permissions.every((p) => granted.permissions.has(p)); },
    async remove({origins = [], permissions = []}) { for (const o of origins) granted.origins.delete(o); for (const p of permissions) granted.permissions.delete(p); onRemoved.fire({origins, permissions}); return true; },
    onAdded, onRemoved,
  },
  scripting: {
    async executeScript(spec) { calls.inject.push(spec.target.tabId); return spec.files ? [] : [{result: {links: [], warnings: []}}]; },
    async getRegisteredContentScripts() { return structuredClone(registered); },
    async unregisterContentScripts({ids}) { registered = registered.filter((script) => !ids.includes(script.id)); },
    async registerContentScripts(scripts) { calls.register.push(structuredClone(scripts)); registered.push(...structuredClone(scripts)); },
  },
  tabs: {
    async query() { return tabs.map((tab) => ({...tab, url: /^https?:/.test(tab.url) && !covered(new URL(tab.url).origin + '/*') ? undefined : tab.url})); },
    async get(id) { const tab = tabs.find((t) => t.id === id); if (!tab) throw Error('No tab'); return tab; },
    async sendMessage(tabId, message) { if (message.type === 'content.configure') calls.configure.push({tabId, ...message}); else calls.tabMessages.push({tabId, ...message}); },
    async create(spec) { if (failUrls.has(spec.url)) throw Error('blocked'); const tab = {id: nextTabId++, ...spec}; calls.created.push(tab); return tab; },
    async group({tabIds, groupId}) { const id = groupId ?? nextGroupId++; calls.groups.push({tabIds, groupId: id}); return id; },
    async update() {},
  },
  windows: {async create(spec) { const win = {id: nextWindowId++, tabs: [{id: nextTabId++}]}; calls.windows.push({...spec, id: win.id}); calls.created.push({url: spec.url, windowId: win.id}); return win; }, async getAll() { return [{id: 1, focused: true, tabs}]; }, async update() {}},
  tabGroups: {async update(id, props) { calls.titles.push({id, ...props}); }},
  bookmarks: {async create(spec) { calls.bookmarks.push(spec); return {id: 'b' + calls.bookmarks.length}; }},
  action: {onClicked: event()}, sidePanel: {open: async () => {}}, commands: {onCommand: event()}, contextMenus: {onClicked: event(), removeAll: async () => {}, create: () => {}},
};
await import('../src/background.js');

const WORKBENCH = {url: 'chrome-extension://meteor/ui/workbench.html', tab: tabs[2]};
const PAGE = {url: 'https://a.test/page', tab: tabs[0]};
const call = (message, sender = WORKBENCH) => new Promise((resolve) => chrome.runtime.onMessage.listeners[0](message, sender, resolve));
const ok = async (message, sender) => { const reply = await call(message, sender); assert.equal(reply.ok, true, reply.error); return reply.data; };
const refused = async (message, pattern, sender) => { const reply = await call(message, sender); assert.equal(reply.ok, false); assert.match(reply.error, pattern); return reply.error; };
const until = async (fn, message) => { for (let i = 0; i < 200; i++) { if (await fn()) return; await new Promise((r) => setTimeout(r, 5)); } assert.fail(message); };
const settings = () => local.linkMeteorState.settings;
const lastConfigure = (tabId) => calls.configure.filter((c) => c.tabId === tabId).at(-1);
const grantAll = () => { granted.origins.add(ALL[0]); granted.origins.add(ALL[1]); onAdded.fire({origins: ALL}); };
const candidate = (i, extra = {}) => ({anchorText: 'Link ' + i, url: `https://a.test/${i}`, originalHref: `/${i}`, frameUrl: 'https://a.test/page', ...extra});

test('hold-drag on chosen sites registers one script for the granted origins', async () => {
  await refused({type: 'hold.configure', origin: 'https://a.test', enabled: true, key: 'z'}, /Allow access to this site/);
  granted.origins.add('https://a.test/*');
  const state = await ok({type: 'hold.configure', origin: 'https://a.test', enabled: true, key: 'z'});
  assert.deepEqual(state.settings.holdOrigins, ['https://a.test']);
  assert.deepEqual(registered.map(({id, matches, excludeMatches}) => ({id, matches, excludeMatches})), [{id: 'meteor-hold-sites', matches: ['https://a.test/*'], excludeMatches: undefined}]);
  assert.equal(registered[0].persistAcrossSessions, true);
  assert.deepEqual(lastConfigure(1), {tabId: 1, type: 'content.configure', holdKey: 'z', holdTrigger: 'letter', enabled: true});
  assert.ok(calls.inject.includes(1), 'an open tab of that site gets the script without a reload');
  await refused({type: 'hold.configure', origin: 'https://a.test/path', enabled: true, key: 'z'}, /ordinary website/);
});

test("'all' needs Chrome's all-sites grant, then covers every site with one script", async () => {
  await refused({type: 'hold.scope', scope: 'all'}, /does not have access to all sites/);
  assert.equal(settings().holdScope, 'sites');
  await refused({type: 'hold.scope', scope: 'everywhere'}, /'sites' or 'all'/);
  grantAll();
  calls.inject.length = 0;
  const state = await ok({type: 'hold.scope', scope: 'all'});
  assert.equal(state.settings.holdScope, 'all');
  assert.deepEqual(state.settings.holdOrigins, ['https://a.test'], 'chosen sites are kept for switching back');
  assert.deepEqual(registered.map(({id, matches, excludeMatches}) => ({id, matches, excludeMatches})), [{id: 'meteor-hold-all', matches: ALL, excludeMatches: undefined}]);
  assert.deepEqual(calls.inject.sort(), [1, 2, 4], 'open web tabs get the script at once');
  assert.equal(lastConfigure(4).enabled, true);
  assert.equal(lastConfigure(2).enabled, true);
});

test('exceptions become excludeMatches and switch off open tabs of that site', async () => {
  const state = await ok({type: 'hold.exception', origin: 'https://b.test', excepted: true});
  assert.deepEqual(state.settings.holdExceptions, ['https://b.test']);
  assert.deepEqual(registered[0].excludeMatches, ['https://b.test/*']);
  assert.equal(lastConfigure(2).enabled, false);
  assert.equal(lastConfigure(1).enabled, true);
  // Excepting a chosen site takes it off the chosen sites, so a site is never on both lists.
  const excepted = await ok({type: 'hold.exception', origin: 'https://a.test', excepted: true});
  assert.deepEqual(excepted.settings.holdOrigins, []);
  assert.deepEqual(excepted.settings.holdExceptions, ['https://b.test', 'https://a.test']);
  const back = await ok({type: 'hold.exception', origin: 'https://a.test', excepted: false});
  assert.deepEqual(back.settings.holdExceptions, ['https://b.test']);
  assert.equal(lastConfigure(1).enabled, true);
  await refused({type: 'hold.exception', origin: 'chrome://settings', excepted: true}, /ordinary website/);
  await refused({type: 'hold.exception', origin: 'https://b.test', excepted: 'yes'}, /exception/);
  // hold.configure turning a site on takes it off the exceptions.
  granted.origins.add('https://b.test/*');
  const on = await ok({type: 'hold.configure', origin: 'https://b.test', enabled: true, key: 'z'});
  assert.deepEqual(on.settings.holdExceptions, []);
  assert.ok(on.settings.holdOrigins.includes('https://b.test'));
  await ok({type: 'hold.exception', origin: 'https://b.test', excepted: true});
});

test('the Never list holds at most 1,000 sites', async () => {
  const before = structuredClone(local.linkMeteorState);
  local.linkMeteorState.settings.holdExceptions = Array.from({length: 1000}, (_, i) => `https://s${i}.test`);
  await refused({type: 'hold.exception', origin: 'https://one-more.test', excepted: true}, /at most 1,000 sites/);
  local.linkMeteorState = before;
  await ok({type: 'hold.exception', origin: 'https://b.test', excepted: true});
});

test('hold.settings saves the trigger and letter and reconfigures open tabs', async () => {
  const state = await ok({type: 'hold.settings', trigger: 'modifier'});
  assert.equal(state.settings.holdTrigger, 'modifier');
  assert.equal(lastConfigure(1).holdTrigger, 'modifier');
  await ok({type: 'hold.settings', key: 'Q'});
  assert.equal(settings().holdKey, 'q');
  assert.equal(settings().holdTrigger, 'modifier', 'the letter is kept while the modifier is used');
  for (const trigger of ['alt', 'shift', 'option']) await refused({type: 'hold.settings', trigger}, /'letter' or 'modifier'/);
  await refused({type: 'hold.settings', key: '1'}, /alphabetic/);
  await refused({type: 'hold.settings'}, /trigger or a letter/);
  await ok({type: 'hold.settings', trigger: 'letter', key: 'z'});
});

test('settings.get is limited to what Chrome still grants', async () => {
  const page = await ok({type: 'settings.get'}, PAGE);
  assert.equal(page.holdScope, 'all');
  granted.origins.delete(ALL[0]); granted.origins.delete(ALL[1]);
  const withheld = await ok({type: 'settings.get'}, PAGE);
  assert.equal(withheld.holdScope, 'sites', 'a page never hears all-sites access that Chrome no longer grants');
  grantAll();
  await until(async () => registered[0]?.id === 'meteor-hold-all', 'sync after the grant returns');
});

test("removing all-sites access returns the scope to 'sites' and keeps per-site grants", async () => {
  await ok({type: 'hold.configure', origin: 'https://a.test', enabled: true, key: 'z'});
  assert.equal(settings().holdScope, 'all');
  await chrome.permissions.remove({origins: ALL});
  await until(() => settings().holdScope === 'sites', 'scope returns to sites');
  await until(() => registered[0]?.id === 'meteor-hold-sites', 'the per-site script replaces the all-sites one');
  assert.equal(lastConfigure(4).enabled, false, 'a tab Chrome no longer lets Link Meteor read stops at once');
  assert.deepEqual(settings().holdOrigins, ['https://a.test'], 'the per-site grant for a.test is kept');
  assert.deepEqual(registered[0].matches, ['https://a.test/*']);
  // Removing that site's grant too prunes it.
  await chrome.permissions.remove({origins: ['https://a.test/*']});
  await until(() => settings().holdOrigins.length === 0, 'revoked site pruned');
  await until(() => registered.length === 0, 'no script without sites');
});

test('a saved write that changes hold settings re-registers scripts (onStateWritten)', async () => {
  granted.origins.add('https://a.test/*');
  const registrations = calls.register.length;
  // A write that is not a hold message, for example a restore: the background follows it.
  await ok({type: 'state.mutate', action: {type: 'settings.update', patch: {holdOrigins: ['https://a.test'], holdExceptions: ['https://c.test']}}});
  await until(() => registered[0]?.matches?.[0] === 'https://a.test/*', 'registered after the write');
  assert.ok(calls.register.length > registrations);
  // A write that changes nothing about hold-drag leaves the registration alone.
  const after = calls.register.length;
  await ok({type: 'state.mutate', action: {type: 'collection.create', name: 'Unrelated'}});
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls.register.length, after);
  // 'all' written directly without the grant is corrected back to 'sites'.
  await ok({type: 'state.mutate', action: {type: 'settings.update', patch: {holdScope: 'all'}}});
  await until(() => settings().holdScope === 'sites', 'honest scope after a direct write');
});

test('links.open: caps, confirmation, batches, progress and cancel', async () => {
  const urls = (n, prefix = 'open') => Array.from({length: n}, (_, i) => `https://a.test/${prefix}/${i}`);
  await refused({type: 'links.open', urls: []}, /at least one/);
  const created = calls.created.length;
  await refused({type: 'links.open', urls: urls(21)}, /needs a confirmation/);
  await refused({type: 'links.open', urls: urls(501), confirmed: true}, /at most 500/);
  await refused({type: 'links.open', urls: ['mailto:a@b.test']}, /Only HTTP and HTTPS/);
  await refused({type: 'links.open', urls: urls(2), mode: 'popup'}, /'tabs'/);
  assert.equal(calls.created.length, created, 'nothing opens before a request passes its checks');
  await refused({type: 'links.open', urls: urls(3)}, /Link Meteor workbench/, PAGE);

  calls.progress.length = 0;
  const twenty = await ok({type: 'links.open', urls: urls(20, 'twenty')});
  assert.deepEqual(twenty, {opened: 20, failed: 0, cancelled: false});
  const start = calls.created.length;
  failUrls.add('https://a.test/many/3');
  const many = await ok({type: 'links.open', urls: urls(45, 'many'), confirmed: true, requestId: 'r-45'});
  assert.deepEqual(many, {opened: 44, failed: 1, cancelled: false});
  const opened = calls.created.slice(start);
  assert.equal(opened.length, 44);
  assert.ok(opened.every((tab) => tab.active === false), 'background tabs');
  const progress = calls.progress.filter((p) => p.requestId === 'r-45');
  assert.deepEqual(progress.map((p) => p.opened + p.failed), [10, 20, 30, 40, 45], 'batches of at most 10');
  assert.ok(progress.every((p) => p.total === 45));

  // Cancel stops before the next batch; tabs already opened stay open.
  const running = call({type: 'links.open', urls: urls(60, 'cancel'), confirmed: true, requestId: 'r-cancel'});
  await until(() => calls.progress.some((p) => p.requestId === 'r-cancel'), 'first batch');
  assert.deepEqual(await ok({type: 'links.cancel', requestId: 'r-cancel'}), {cancelled: true});
  const cancelled = (await running).data;
  assert.equal(cancelled.cancelled, true);
  assert.ok(cancelled.opened >= 10 && cancelled.opened < 60, JSON.stringify(cancelled));
  assert.deepEqual(await ok({type: 'links.cancel', requestId: 'r-cancel'}), {cancelled: false}, 'nothing left to cancel');
});

test('links.open in a new window and as a tab group, with and without tabGroups', async () => {
  const urls = Array.from({length: 12}, (_, i) => `https://a.test/w/${i}`);
  const windowResult = await ok({type: 'links.open', urls, mode: 'window'});
  assert.equal(windowResult.opened, 12);
  const win = calls.windows.at(-1);
  assert.deepEqual({url: win.url, focused: win.focused}, {url: urls[0], focused: true});
  assert.equal(windowResult.windowId, win.id);
  assert.ok(calls.created.slice(-11).every((tab) => tab.windowId === win.id));

  const groups = calls.groups.length;
  const unnamed = await ok({type: 'links.open', urls, mode: 'group', groupTitle: 'My research'});
  assert.equal(unnamed.groupTitled, false);
  assert.equal(calls.titles.length, 0, 'no name without tabGroups');
  assert.deepEqual(calls.groups.slice(groups).map((g) => g.tabIds.length), [10, 2]);
  assert.equal(new Set(calls.groups.slice(groups).map((g) => g.groupId)).size, 1, 'one group');

  granted.permissions.add('tabGroups');
  const named = await ok({type: 'links.open', urls, mode: 'group', groupTitle: 'My research'});
  assert.equal(named.groupTitled, true);
  assert.deepEqual(calls.titles.at(-1), {id: named.groupId, title: 'My research'});
});

test('capture card: collections.list, commit to a chosen collection, copy formats', async () => {
  const second = (await ok({type: 'state.mutate', action: {type: 'collection.create', name: 'Card destination'}})).activeCollectionId;
  const first = local.linkMeteorState.collections[0].id;
  await ok({type: 'state.mutate', action: {type: 'collection.activate', id: first}});
  const list = await ok({type: 'collections.list'}, PAGE);
  assert.equal(list.activeCollectionId, first);
  assert.deepEqual(list.collections.find((c) => c.id === second), {id: second, name: 'Card destination', count: 0});
  assert.ok(Object.keys(list.collections[0]).every((key) => ['id', 'name', 'count'].includes(key)), 'names and counts only');

  const saved = await ok({type: 'capture.commit', links: [candidate(1), candidate(2)], collectionId: second}, PAGE);
  assert.equal(saved.count, 2);
  assert.equal(saved.state.activeCollectionId, first, 'the active collection does not change');
  const destination = saved.state.collections.find((c) => c.id === second);
  assert.deepEqual(destination.links.map((l) => l.anchorText), ['Link 1', 'Link 2']);
  assert.equal(new Set(destination.links.map((l) => l.batchId)).size, 1);

  const before = JSON.stringify(local.linkMeteorState.collections);
  await refused({type: 'capture.commit', links: [candidate(3)], collectionId: 'gone'}, /no longer exists, so nothing was saved/, PAGE);
  assert.equal(JSON.stringify(local.linkMeteorState.collections), before);
  await refused({type: 'capture.commit', links: [candidate(3)]}, /capture card on a webpage/);

  const tsv = await ok({type: 'capture.copy', links: [candidate(1, {anchorText: '=SUM(1)'})]}, PAGE);
  assert.equal(tsv.text, "Anchor text\tURL\r\n'=SUM(1)\thttps://a.test/1\r\n");
  assert.equal((await ok({type: 'capture.copy', format: 'text', links: [candidate(1), candidate(2)]}, PAGE)).text, 'https://a.test/1\nhttps://a.test/2');
  assert.equal((await ok({type: 'capture.copy', format: 'markdown', links: [candidate(1, {anchorText: ''})]}, PAGE)).text, '[](https://a.test/1)');
  await refused({type: 'capture.copy', format: 'csv', links: [candidate(1)]}, /tsv, text or markdown/, PAGE);
});

test('capture card: export names and encodings, bookmarks, opening and review', async () => {
  const second = local.linkMeteorState.collections.find((c) => c.name === 'Card destination').id;
  const csv = await ok({type: 'capture.export', format: 'csv', links: [candidate(1)], collectionId: second}, PAGE);
  assert.match(csv.fileName, /^Card-destination_\d{4}-\d{2}-\d{2}_\d{4}\.csv$/);
  assert.equal(csv.encoding, 'utf8');
  assert.equal(csv.data, 'Anchor text,URL\r\nLink 1,https://a.test/1\r\n');
  const xlsx = await ok({type: 'capture.export', format: 'xlsx', links: [candidate(1)]}, PAGE);
  assert.match(xlsx.fileName, /^My-research_.*\.xlsx$/, 'the active collection names it without a choice');
  assert.equal(xlsx.encoding, 'base64');
  assert.equal(Buffer.from(xlsx.data, 'base64').subarray(0, 2).toString(), 'PK');
  const json = await ok({type: 'capture.export', format: 'json', links: [candidate(1)]}, PAGE);
  assert.equal(JSON.parse(json.data)[0].occurrences.length, 1, 'JSON rows keep their occurrence');

  const error = await refused({type: 'capture.bookmark', links: [candidate(1)], name: 'Card destination'}, /^Bookmark access is needed/, PAGE);
  assert.match(error, /full view/);
  granted.permissions.add('bookmarks');
  const bookmarked = await ok({type: 'capture.bookmark', links: [candidate(1), candidate(2, {url: 'mailto:x@a.test'})], name: 'Card destination'}, PAGE);
  assert.equal(bookmarked.count, 1, 'web links only');
  assert.deepEqual(calls.bookmarks.map((b) => b.title), ['Card destination', 'Link 1']);

  calls.tabMessages.length = 0;
  const opened = await ok({type: 'capture.open', links: [candidate(1), candidate(1), candidate(2)], mode: 'group', collectionId: second, requestId: 'card-1'}, PAGE);
  assert.equal(opened.opened, 2, 'unique web links');
  assert.equal(calls.titles.at(-1).title, 'Card destination', 'the group is named after the destination');
  assert.deepEqual(calls.tabMessages.filter((m) => m.type === 'links.progress').map((m) => [m.tabId, m.requestId, m.opened]), [[1, 'card-1', 2]]);
  assert.ok(calls.created.slice(-2).every((tab) => tab.windowId === 1), 'tabs open in the page’s window');
  await refused({type: 'capture.open', links: Array.from({length: 21}, (_, i) => candidate(i))}, /needs a confirmation/, PAGE);
  await refused({type: 'capture.open', links: [candidate(1, {url: 'tel:+1555'})]}, /no.*web links|nothing to open/i, PAGE);
  // A page cannot cancel someone else's opening.
  const other = call({type: 'links.open', urls: Array.from({length: 30}, (_, i) => `https://a.test/x/${i}`), confirmed: true, requestId: 'workbench-1'});
  await until(() => calls.progress.some((p) => p.requestId === 'workbench-1'), 'workbench batch');
  assert.deepEqual(await ok({type: 'links.cancel', requestId: 'workbench-1'}, PAGE), {cancelled: false});
  assert.equal((await other).data.cancelled, false);

  // Review (capture.commit with review) and ui.open keep the view and batch for the full view.
  const reviewed = await ok({type: 'capture.commit', links: [candidate(9)], review: true, collectionId: second}, PAGE);
  const batchId = reviewed.state.collections.find((c) => c.id === second).links.at(-1).batchId;
  assert.deepEqual({view: session.linkMeteorOpenIntent.view, batchId: session.linkMeteorOpenIntent.batchId}, {view: 'links', batchId});
  assert.equal(calls.created.at(-1).url, 'chrome-extension://meteor/ui/workbench.html');
  await ok({type: 'ui.open', view: 'export', batchId: 'b-1'}, PAGE);
  assert.deepEqual({view: session.linkMeteorOpenIntent.view, batchId: session.linkMeteorOpenIntent.batchId}, {view: 'export', batchId: 'b-1'});
  assert.ok(!Number.isNaN(Date.parse(session.linkMeteorOpenIntent.createdAt)));
  await refused({type: 'ui.open', view: 'settings'}, /'links' or 'export'/, PAGE);
});
