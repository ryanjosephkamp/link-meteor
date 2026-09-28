// The right-click and toolbar menus and Save tabs as links (0.4.0) in the background, with Chrome's
// APIs simulated in Node: the items and their order, the title that follows the active collection,
// every item's click handler (the saved fields, the collection chosen, the page's notice and its
// Undo), and capture.tabs. The page script is a stand-in that answers content.contextLink,
// content.selectionLinks and content.notice. API mocks, not Chrome itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../src/core/model.js';

const event = () => ({listeners: [], addListener(fn) { this.listeners.push(fn); }});
const local = {linkMeteorState: createState()}, session = {};
const granted = new Set();
const menus = {items: [], updates: [], removals: 0};
const calls = {inject: [], arm: [], created: [], messages: []};
const tabs = [
  {id: 1, windowId: 1, url: 'https://a.test/page', title: '  Thesis\n  sources   page ', active: true},
  {id: 2, windowId: 1, url: 'https://b.test/', title: 'B'},
  {id: 3, windowId: 1, url: 'chrome://newtab/', title: 'New Tab'},
  {id: 4, windowId: 1, url: 'https://b.test/', title: 'B again'},
  {id: 5, windowId: 2, url: 'https://c.test/', title: 'Other window'},
  {id: 6, windowId: 1, url: 'https://a.test/other', title: 'Another page'},
];
// What each tab's page script answers: its links (content.contextLink finds by address), the
// selection's links, and the notices it was asked to show. A tab only answers once the script loaded.
const pages = new Map(tabs.map((tab) => [tab.id, {loaded: false, links: [], selection: [], notices: []}]));
const web = (url) => /^https?:/.test(url);

globalThis.chrome = {
  storage: {
    onChanged: event(),
    local: {async get(key) { return {[key]: structuredClone(local[key])}; }, async set(value) { Object.assign(local, structuredClone(value)); }},
    session: {async get(key) { return {[key]: structuredClone(session[key])}; }, async set(value) { Object.assign(session, structuredClone(value)); }, async remove(key) { delete session[key]; }},
  },
  runtime: {getURL: (path) => 'chrome-extension://meteor/' + path, sendMessage: async () => {}, onMessage: event(), onInstalled: event(), onStartup: event()},
  permissions: {async contains({permissions = [], origins = []}) { return !origins.length && permissions.every((p) => granted.has(p)); }, onAdded: event(), onRemoved: event()},
  scripting: {
    async executeScript(spec) {
      const tab = tabs.find((t) => t.id === spec.target.tabId);
      if (!web(tab.url)) throw new Error('Cannot access contents of the page.');
      if (spec.files) { calls.inject.push(tab.id); pages.get(tab.id).loaded = true; return []; }
      calls.arm.push(tab.id);
      return [{result: {links: [{anchorText: 'Scanned', url: 'https://a.test/scanned', originalHref: '/scanned', frameUrl: tab.url}], warnings: []}}];
    },
    async getRegisteredContentScripts() { return []; }, async unregisterContentScripts() {}, async registerContentScripts() {},
  },
  tabs: {
    async query(query = {}) { return tabs.filter((t) => (query.windowId === undefined || t.windowId === query.windowId) && (!query.active || t.active)); },
    async get(id) { const tab = tabs.find((t) => t.id === id); if (!tab) throw new Error('No tab with id: ' + id); return structuredClone(tab); },
    async sendMessage(tabId, message, options) {
      if (message.type === 'content.configure') return undefined;
      calls.messages.push({tabId, options, ...message});
      const page = pages.get(tabId);
      if (!page?.loaded) throw new Error('Could not establish connection. Receiving end does not exist.');
      if (message.type === 'content.contextLink') return {ok: true, data: {link: page.links.find((link) => link.url === message.url) || null}};
      if (message.type === 'content.selectionLinks') return {ok: true, data: {links: page.selection, warnings: []}};
      if (message.type === 'content.notice') { page.notices.push(message); return {ok: true, data: {}}; }
      return {ok: false, error: 'Unexpected ' + message.type};
    },
    async create(spec) { calls.created.push(spec); return {id: 99, ...spec}; },
    async update() {},
  },
  windows: {async getAll() { return [{id: 1, focused: true, tabs: tabs.filter((t) => t.windowId === 1)}, {id: 2, focused: false, tabs: tabs.filter((t) => t.windowId === 2)}]; }, async update() {}},
  action: {onClicked: event()}, sidePanel: {open: async () => {}}, commands: {onCommand: event()},
  contextMenus: {
    onClicked: event(),
    removeAll(done) { menus.items = []; menus.removals++; done?.(); },
    create(item, done) { menus.items.push(structuredClone(item)); done?.(); return item.id; },
    update(id, props, done) { menus.updates.push({id, ...props}); done?.(); },
  },
};
await import('../src/background.js');

const WORKBENCH = {url: 'chrome-extension://meteor/ui/workbench.html', tab: {id: 50, windowId: 1, url: 'chrome-extension://meteor/ui/workbench.html'}};
const PAGE = {url: tabs[0].url, tab: tabs[0]};
const call = (message, sender = WORKBENCH) => new Promise((resolve) => chrome.runtime.onMessage.listeners[0](message, sender, resolve));
const ok = async (message, sender) => { const reply = await call(message, sender); assert.equal(reply.ok, true, reply.error); return reply.data; };
const refused = async (message, pattern, sender) => { const reply = await call(message, sender); assert.equal(reply.ok, false, 'expected a refusal'); assert.match(reply.error, pattern); };
const click = (menuItemId, tab = tabs[0], info = {}) => chrome.contextMenus.onClicked.listeners[0]({menuItemId, pageUrl: tab?.url, ...info}, tab && structuredClone(tab));
const collection = (id) => local.linkMeteorState.collections.find((c) => c.id === id);
const active = () => collection(local.linkMeteorState.activeCollectionId);
const notices = (tabId = 1) => pages.get(tabId).notices;
const lastNotice = (tabId = 1) => notices(tabId).at(-1);
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const link = (text, url, extra = {}) => ({anchorText: text, accessibleLabel: '', url, originalHref: url.replace('https://a.test', ''), sourceUrl: tabs[0].url, sourceTitle: 'Page', frameUrl: tabs[0].url, ...extra});
const reset = () => { for (const page of pages.values()) Object.assign(page, {loaded: false, notices: []}); calls.inject.length = 0; calls.messages.length = 0; calls.created.length = 0; delete session.linkMeteorActivationError; };

test('install creates every item in each context’s order, without “Link Meteor:” in the titles', async () => {
  await chrome.runtime.onInstalled.listeners[0]({reason: 'install'});
  assert.ok(menus.removals >= 1, 'old items are removed first');
  const byContext = (context) => menus.items.filter((item) => item.contexts.includes(context)).map((item) => item.title);
  assert.deepEqual(byContext('link'), ['Add link to “My research”', 'Copy link text + URL', 'Select a region']);
  assert.deepEqual(byContext('selection'), ['Capture links in the selection', 'Select a region']);
  assert.deepEqual(byContext('page'), ['Select a region', 'Capture this page', 'Save this tab as a link']);
  assert.deepEqual(byContext('action'), ['Save this tab as a link', 'Save all tabs in this window as links', 'Open the full view']);
  assert.ok(menus.items.every((item) => !/Link Meteor/.test(item.title)));
  assert.equal(new Set(menus.items.map((item) => item.id)).size, menus.items.length, 'unique IDs');
  assert.deepEqual(menus.items.map((item) => item.id).filter((id) => ['meteor-region', 'meteor-page'].includes(id)), ['meteor-region', 'meteor-page'], 'the 0.3.0 IDs are kept');
});

test('another area’s item (Download linked file) can be placed after Copy link text + URL', async () => {
  const {createMenus} = await import('../src/background/menus.js');
  await createMenus({extra: [{after: 'meteor-copy-link', id: 'meteor-download-link', title: 'Download linked file', contexts: ['link']}]});
  assert.deepEqual(menus.items.filter((item) => item.contexts.includes('link')).map((item) => item.title), ['Add link to “My research”', 'Copy link text + URL', 'Download linked file', 'Select a region']);
  // Its clicks are left to its own module.
  reset();
  await click('meteor-download-link', tabs[0], {linkUrl: 'https://a.test/paper.pdf'});
  assert.deepEqual([calls.inject, calls.messages, session.linkMeteorActivationError], [[], [], undefined]);
  await chrome.runtime.onInstalled.listeners[0]({reason: 'update'});
});

test('Add link to “name” follows the active collection: renamed, switched, restored; other writes leave it', async () => {
  menus.updates.length = 0;
  const first = active().id;
  await ok({type: 'state.mutate', action: {type: 'collection.update', id: first, patch: {name: 'Thesis sources'}}});
  assert.deepEqual(menus.updates.at(-1), {id: 'meteor-add-link', title: 'Add link to “Thesis sources”'});
  const second = (await ok({type: 'state.mutate', action: {type: 'collection.create', name: 'Labs 100%sure'}})).activeCollectionId;
  assert.equal(menus.updates.at(-1).title, 'Add link to “Labs 100%​sure”', 'a name’s own %s is not replaced by Chrome');
  const count = menus.updates.length;
  await ok({type: 'state.mutate', action: {type: 'collection.update', id: second, patch: {notes: 'Notes only'}}});
  await ok({type: 'state.mutate', action: {type: 'links.append', collectionId: first, links: [{...link('Elsewhere', 'https://a.test/elsewhere'), id: 'x1', capturedAt: '', batchId: 'b', notes: '', tags: []}]}});
  assert.equal(menus.updates.length, count, 'writes that keep the active name change nothing');
  await ok({type: 'state.mutate', action: {type: 'collection.activate', id: first}});
  assert.equal(menus.updates.at(-1).title, 'Add link to “Thesis sources”');
  await chrome.runtime.onStartup.listeners.at(-1)();
  await settle();
  assert.equal(menus.updates.at(-1).title, 'Add link to “Thesis sources”', 'startup sets it again');
});

test('Add link: the recorded link’s fields go to the active collection, with a notice, Undo and Show links', async () => {
  reset();
  const home = active();
  pages.get(1).links = [link('Attention is all you need', 'https://a.test/paper')];
  await click('meteor-add-link', tabs[0], {linkUrl: 'https://a.test/paper', frameId: 0});
  assert.deepEqual(calls.inject, [1], 'the page script is loaded first');
  const ask = calls.messages.find((m) => m.type === 'content.contextLink');
  assert.deepEqual([ask.url, ask.options], ['https://a.test/paper', {frameId: 0}], 'asks the top frame for that address');
  const saved = active().links.at(-1);
  assert.equal(active().id, home.id);
  assert.deepEqual({anchorText: saved.anchorText, url: saved.url, originalHref: saved.originalHref, sourceUrl: saved.sourceUrl, sourceTitle: saved.sourceTitle, frameUrl: saved.frameUrl},
    {anchorText: 'Attention is all you need', url: 'https://a.test/paper', originalHref: '/paper', sourceUrl: tabs[0].url, sourceTitle: tabs[0].title, frameUrl: tabs[0].url});
  const notice = lastNotice();
  assert.equal(notice.text, 'Added 1 link to “Thesis sources”.');
  assert.deepEqual(notice.added, {collectionId: home.id, batchId: saved.batchId, name: 'Thesis sources'});
  assert.deepEqual(calls.messages.filter((m) => m.type === 'content.notice').map((m) => m.options), [{frameId: 0}], 'one notice, in the top frame');
  // The notice's Undo is capture.undoAdd from that tab, and removes exactly that add.
  await refused({type: 'capture.undoAdd', collectionId: home.id, batchId: saved.batchId}, /no longer be undone/, {url: tabs[1].url, tab: tabs[1]});
  assert.deepEqual(await ok({type: 'capture.undoAdd', collectionId: home.id, batchId: saved.batchId}, PAGE), {count: 1});
  assert.ok(!active().links.some((l) => l.id === saved.id));
});

test('Add link goes to the active collection, even after the card chose another', async () => {
  reset();
  const home = active().id;
  const other = local.linkMeteorState.collections.find((c) => c.id !== home).id;
  pages.get(1).links = [link('Chosen elsewhere', 'https://a.test/chosen')];
  await ok({type: 'capture.commit', links: [link('Card add', 'https://a.test/card')], collectionId: other}, PAGE);
  await click('meteor-add-link', tabs[0], {linkUrl: 'https://a.test/chosen'});
  assert.equal(active().links.at(-1).anchorText, 'Chosen elsewhere');
  assert.equal(collection(other).links.at(-1).anchorText, 'Card add');
});

test('Add link: a link the page can’t find is saved with its address only, and the notice says so', async () => {
  reset();
  pages.get(1).links = [];
  await click('meteor-add-link', tabs[0], {linkUrl: 'https://framed.test/paper', frameId: 7, frameUrl: 'https://framed.test/embed'});
  const saved = active().links.at(-1);
  assert.deepEqual({anchorText: saved.anchorText, accessibleLabel: saved.accessibleLabel, url: saved.url, originalHref: saved.originalHref, frameUrl: saved.frameUrl},
    {anchorText: '', accessibleLabel: '', url: 'https://framed.test/paper', originalHref: '', frameUrl: 'https://framed.test/embed'});
  assert.equal(lastNotice().text, 'Added 1 link to “Thesis sources”. Link Meteor couldn’t read its text on this page, so it was saved with its address only.');
  // Unsupported schemes are refused, and nothing is saved.
  const before = active().links.length;
  await click('meteor-add-link', tabs[0], {linkUrl: 'javascript:alert(1)'});
  assert.equal(active().links.length, before);
  assert.equal(lastNotice().text, 'Link Meteor saves only web, email and phone links, so this link wasn’t added.');
  assert.equal(lastNotice().added, undefined);
});

test('Add link with Skip saved: an address already saved adds nothing, and the notice has no Undo', async () => {
  reset();
  await ok({type: 'state.mutate', action: {type: 'settings.update', patch: {skipSaved: true}}});
  pages.get(1).links = [link('Again', 'https://framed.test/paper')];
  const before = active().links.length;
  await click('meteor-add-link', tabs[0], {linkUrl: 'https://framed.test/paper'});
  assert.equal(active().links.length, before);
  assert.equal(lastNotice().text, 'Nothing was added: 1 link was already in “Thesis sources”.');
  assert.equal(lastNotice().added, undefined);
  await ok({type: 'state.mutate', action: {type: 'settings.update', patch: {skipSaved: false}}});
});

test('Copy link text + URL: two tab-separated columns with a header, on the page’s clipboard; nothing is saved', async () => {
  reset();
  const before = active().links.length;
  pages.get(1).links = [link('=HYPERLINK("x") Paper', 'https://a.test/paper')];
  await click('meteor-copy-link', tabs[0], {linkUrl: 'https://a.test/paper'});
  const notice = lastNotice();
  assert.equal(notice.text, 'Copied anchor text and URL as two spreadsheet columns.');
  assert.equal(notice.copy, 'Anchor text\tURL\r\n"\'=HYPERLINK(""x"") Paper"\thttps://a.test/paper\r\n', 'as the card copies: formula text kept inert');
  assert.equal(notice.added, undefined);
  assert.equal(active().links.length, before);
  await click('meteor-copy-link', tabs[0], {linkUrl: 'https://a.test/unknown'});
  assert.equal(lastNotice().copy, 'Anchor text\tURL\r\n\thttps://a.test/unknown\r\n');
  assert.match(lastNotice().text, /^Copied the URL\. Link Meteor couldn’t read this link’s text/);
});

test('Capture links in the selection: every selected link in one add, with the notice; an empty selection saves nothing', async () => {
  reset();
  pages.get(1).selection = [link('One', 'https://a.test/1'), link('Two', 'https://a.test/2'), link('One again', 'https://a.test/1')];
  const before = active().links.length;
  await click('meteor-selection', tabs[0], {selectionText: 'One Two One again'});
  const added = active().links.slice(before);
  assert.deepEqual(added.map((l) => l.anchorText), ['One', 'Two', 'One again']);
  assert.equal(new Set(added.map((l) => l.batchId)).size, 1);
  assert.equal(lastNotice().text, 'Added 3 links to “Thesis sources”.');
  assert.equal(lastNotice().added.batchId, added[0].batchId);
  pages.get(1).selection = [];
  await click('meteor-selection', tabs[0]);
  assert.equal(active().links.length, before + 3);
  assert.equal(lastNotice().text, 'No links in the selection, so nothing was added.');
});

test('Select a region arms the page; Capture this page captures it and opens the full view; Open the full view opens it', async () => {
  reset(); calls.arm.length = 0;
  await click('meteor-region', tabs[0]);
  assert.deepEqual(calls.arm, [1]);
  const before = active().links.length;
  await click('meteor-page', tabs[0]);
  assert.equal(active().links.at(-1).anchorText, 'Scanned');
  assert.equal(active().links.length, before + 1);
  assert.equal(calls.created.at(-1).url, 'chrome-extension://meteor/ui/workbench.html');
  await click('meteor-full-view', tabs[0]);
  assert.equal(calls.created.length, 2);
});

test('Save this tab as a link: the tab’s title and address, with the notice and Undo', async () => {
  reset();
  const before = active().links.length;
  await click('meteor-save-tab', tabs[0]);
  const saved = active().links.at(-1);
  assert.equal(active().links.length, before + 1);
  assert.deepEqual({anchorText: saved.anchorText, accessibleLabel: saved.accessibleLabel, url: saved.url, originalHref: saved.originalHref, sourceUrl: saved.sourceUrl, sourceTitle: saved.sourceTitle, frameUrl: saved.frameUrl},
    {anchorText: 'Thesis sources page', accessibleLabel: '', url: tabs[0].url, originalHref: tabs[0].url, sourceUrl: tabs[0].url, sourceTitle: tabs[0].title, frameUrl: ''});
  assert.equal(lastNotice().text, 'Saved this tab as a link in “Thesis sources”.');
  assert.deepEqual(await ok({type: 'capture.undoAdd', collectionId: active().id, batchId: saved.batchId}, PAGE), {count: 1});
  assert.equal(active().links.length, before);
  // From the toolbar on a browser page: nothing to save, and the page can't show a notice, so the full view explains.
  await click('meteor-save-tab', tabs[2]);
  assert.equal(session.linkMeteorActivationError, 'This tab isn’t a web page, so it can’t be saved as a link.');
  assert.equal(calls.created.at(-1).url, 'chrome-extension://meteor/ui/workbench.html');
});

test('Save all tabs in this window: without tab access, the full view opens with that choice ready', async () => {
  reset();
  const before = active().links.length;
  await click('meteor-save-window', tabs[0]);
  assert.equal(active().links.length, before, 'nothing is saved');
  assert.deepEqual(calls.created, [{url: 'chrome-extension://meteor/ui/workbench.html', windowId: 1}]);
  const {what, scope, view} = session.linkMeteorOpenIntent;
  assert.deepEqual({what, scope, view}, {what: 'tabs', scope: 'window', view: 'links'});
  assert.deepEqual(notices(), []);
});

test('Save all tabs in this window: web pages of that window only, repeated addresses and browser pages skipped', async () => {
  reset(); granted.add('tabs');
  const before = active().links.length;
  await click('meteor-save-window', tabs[0]);
  const added = active().links.slice(before);
  assert.deepEqual(added.map((l) => [l.anchorText, l.url]), [['Thesis sources page', tabs[0].url], ['B', 'https://b.test/'], ['Another page', 'https://a.test/other']]);
  assert.equal(lastNotice().text, 'Saved 3 tabs as links in “Thesis sources”; 1 skipped: not a web page; 1 skipped: a repeated address.');
  const report = session.linkMeteorCaptureReport.report;
  assert.deepEqual({kind: report.kind, saved: report.saved, skipped: report.skipped, repeated: report.repeated, unsupported: report.unsupported, capturedCount: report.capturedCount}, {kind: 'tabs', saved: 3, skipped: 1, repeated: 1, unsupported: 1, capturedCount: 3});
  assert.deepEqual(report.results.map((r) => [r.tabId, r.status, r.count, r.skipped]), [[1, 'success', 1, 0], [2, 'success', 1, 0], [3, 'unsupported', 0, 0], [4, 'success', 0, 1], [6, 'success', 1, 0]]);
  // Undo from that page removes the whole save.
  assert.deepEqual(await ok({type: 'capture.undoAdd', collectionId: active().id, batchId: added[0].batchId}, PAGE), {count: 3});
  // From a tab that can't show the notice, the full view opens at the saved tabs.
  reset();
  await click('meteor-save-window', tabs[2]);
  assert.deepEqual({view: session.linkMeteorOpenIntent.view, batchId: session.linkMeteorOpenIntent.batchId}, {view: 'links', batchId: session.linkMeteorCaptureReport.report.batchId});
  assert.equal(calls.created.at(-1).url, 'chrome-extension://meteor/ui/workbench.html');
  assert.equal(session.linkMeteorActivationError, undefined);
  granted.delete('tabs');
});

test('capture.tabs: scopes, a chosen collection, Skip saved, hidden and closed tabs; input is checked', async () => {
  const home = active().id;
  const report = (await ok({type: 'capture.tabs', scope: 'selected', tabIds: [2, 4, 3, 5, 2]})).report;
  assert.deepEqual(report.results.map((r) => [r.tabId, r.status, r.count, r.skipped]), [[2, 'success', 1, 0], [4, 'success', 0, 1], [3, 'unsupported', 0, 0], [5, 'success', 1, 0]], 'IDs are taken once, in order');
  assert.equal(report.results[1].warning, 'The same address as another tab in this save.');
  assert.equal(report.results[2].warning, 'Not a web page. Only HTTP and HTTPS pages can be saved as links.');
  // Skip saved applies, per tab.
  tabs.push({id: 8, windowId: 3, url: 'https://d.test/fresh', title: 'Fresh'});
  await ok({type: 'state.mutate', action: {type: 'settings.update', patch: {skipSaved: true}}});
  const again = (await ok({type: 'capture.tabs', scope: 'selected', tabIds: [2, 8]})).report;
  assert.deepEqual(again.results.map((r) => [r.tabId, r.count, r.skipped, r.warning]), [[2, 0, 1, 'Already saved in this collection.'], [8, 1, 0, '']]);
  assert.deepEqual([again.saved, again.skipped, again.repeated], [1, 1, 0]);
  await ok({type: 'state.mutate', action: {type: 'settings.update', patch: {skipSaved: false}}});
  tabs.pop();
  // This window and All windows without tab IDs; This page is the active tab.
  assert.deepEqual((await ok({type: 'capture.tabs', scope: 'window'})).report.results.map((r) => r.tabId), [1, 2, 3, 4, 6]);
  assert.deepEqual((await ok({type: 'capture.tabs', scope: 'all'})).report.results.map((r) => r.tabId), [1, 2, 3, 4, 6, 5]);
  assert.deepEqual((await ok({type: 'capture.tabs', scope: 'current'})).report.results.map((r) => r.tabId), [1]);
  // A chosen collection; a hidden address; a closed tab.
  const other = local.linkMeteorState.collections.find((c) => c.id !== home).id;
  tabs.push({id: 7, windowId: 1, title: ''});
  const mixed = await ok({type: 'capture.tabs', scope: 'selected', tabIds: [6, 7, 404], collectionId: other});
  assert.equal(collection(other).links.at(-1).url, 'https://a.test/other');
  assert.deepEqual(mixed.report.results.map((r) => [r.tabId, r.status]), [[6, 'success'], [7, 'denied'], [404, 'error']]);
  assert.equal(mixed.report.results[1].error, 'Chrome hides this tab’s address from Link Meteor.');
  tabs.pop();
  await refused({type: 'capture.tabs', scope: 'selected'}, /Select at least one tab/);
  await refused({type: 'capture.tabs', scope: 'somewhere'}, /'current', 'selected', 'window' or 'all'/);
  await refused({type: 'capture.tabs', scope: 'selected', tabIds: ['2']}, /at most 20,000 tabs/);
  await refused({type: 'capture.tabs', scope: 'selected', tabIds: [2], collectionId: 'gone'}, /no longer exists/);
  await refused({type: 'capture.tabs', scope: 'selected', tabIds: [2]}, /workbench/, PAGE);
});
