// The capture card's 0.4.0 messages in the background, with Chrome's APIs simulated in Node:
// capture.saved, capture.commit with skipSaved, capture.copy as rich links, capture.undoAdd,
// capture.preference, and Capture this page with content links only (capture.run and
// capture.includeLeftOut). Each handler's validation is checked. API mocks, not Chrome itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../src/core/model.js';

const event = () => ({listeners: [], addListener(fn) { this.listeners.push(fn); }});
const local = {linkMeteorState: createState()}, session = {};
const tabs = [
  {id: 1, windowId: 1, url: 'https://a.test/page', title: 'Page A'},
  {id: 2, windowId: 1, url: 'https://b.test/page', title: 'Page B'},
  {id: 3, windowId: 1, url: 'chrome-extension://meteor/ui/workbench.html', title: 'Link Meteor', active: true},
];
// What the page script's scan() returns for each tab; set by the checks.
const scans = new Map();
globalThis.chrome = {
  storage: {
    onChanged: event(),
    local: {async get(key) { return {[key]: structuredClone(local[key])}; }, async set(value) { Object.assign(local, structuredClone(value)); }},
    session: {async get(key) { return {[key]: structuredClone(session[key])}; }, async set(value) { Object.assign(session, structuredClone(value)); }, async remove(key) { delete session[key]; }},
  },
  runtime: {getURL: (path) => 'chrome-extension://meteor/' + path, sendMessage: async () => {}, onMessage: event(), onInstalled: event(), onStartup: event()},
  permissions: {async contains() { return false; }, onAdded: event(), onRemoved: event()},
  scripting: {
    async executeScript(spec) { return spec.files ? [] : [{result: scans.get(spec.target.tabId) || {links: [], warnings: []}}]; },
    async getRegisteredContentScripts() { return []; }, async unregisterContentScripts() {}, async registerContentScripts() {},
  },
  tabs: {async query() { return tabs; }, async get(id) { const tab = tabs.find((t) => t.id === id); if (!tab) throw Error('No tab'); return tab; }, async sendMessage() {}, async create() { return {id: 99}; }, async update() {}},
  windows: {async getAll() { return [{id: 1, focused: true, tabs}]; }, async update() {}},
  action: {onClicked: event()}, sidePanel: {open: async () => {}}, commands: {onCommand: event()}, contextMenus: {onClicked: event(), removeAll: async () => {}, create: () => {}},
};
await import('../src/background.js');

const WORKBENCH = {url: 'chrome-extension://meteor/ui/workbench.html', tab: tabs[2]};
const PAGE = {url: 'https://a.test/page', tab: tabs[0]}, OTHER_PAGE = {url: 'https://b.test/page', tab: tabs[1]};
const call = (message, sender = PAGE) => new Promise((resolve) => chrome.runtime.onMessage.listeners[0](message, sender, resolve));
const ok = async (message, sender) => { const reply = await call(message, sender); assert.equal(reply.ok, true, reply.error); return reply.data; };
const refused = async (message, pattern, sender) => { const reply = await call(message, sender); assert.equal(reply.ok, false, 'expected a refusal'); assert.match(reply.error, pattern); return reply.error; };
const candidate = (i, extra = {}) => ({anchorText: 'Link ' + i, url: `https://a.test/${i}`, originalHref: `/${i}`, frameUrl: 'https://a.test/page', ...extra});
const collection = (id) => local.linkMeteorState.collections.find((c) => c.id === id);
const active = () => collection(local.linkMeteorState.activeCollectionId);
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test('capture.saved: which URLs the destination holds, and nothing else; input is checked', async () => {
  const first = active().id;
  await ok({type: 'capture.commit', links: [candidate(1), candidate(2)]});
  const second = (await ok({type: 'state.mutate', action: {type: 'collection.create', name: 'Second'}}, WORKBENCH)).activeCollectionId;
  await ok({type: 'state.mutate', action: {type: 'collection.activate', id: first}}, WORKBENCH);

  assert.deepEqual(await ok({type: 'capture.saved', urls: ['https://a.test/2', 'https://a.test/3', 'https://a.test/1', 'https://a.test/2']}), {saved: ['https://a.test/2', 'https://a.test/1']}, 'unique, in the order asked, active collection by default');
  assert.deepEqual(await ok({type: 'capture.saved', collectionId: second, urls: ['https://a.test/1']}), {saved: []});
  assert.deepEqual(await ok({type: 'capture.saved', collectionId: first, urls: []}), {saved: []});
  assert.deepEqual(await ok({type: 'capture.saved', urls: ['https://a.test/1']}, WORKBENCH), {saved: ['https://a.test/1']}, 'the workbench may ask too');
  await refused({type: 'capture.saved'}, /at most 20,000 addresses/);
  await refused({type: 'capture.saved', urls: 'https://a.test/1'}, /at most 20,000 addresses/);
  await refused({type: 'capture.saved', urls: [1]}, /at most 20,000 addresses/);
  await refused({type: 'capture.saved', urls: Array.from({length: 20001}, (_, i) => `https://a.test/${i}`)}, /at most 20,000 addresses/);
  await refused({type: 'capture.saved', collectionId: 'gone', urls: []}, /no longer exists/);
  await refused({type: 'capture.saved', collectionId: 7, urls: []}, /Choose a destination/);
});

test('capture.commit with skipSaved: skipped links are left out and counted; the receipt names the batch', async () => {
  const home = active().id, before = active().links.length;
  await refused({type: 'capture.commit', links: [candidate(9)], skipSaved: 'yes'}, /skip links that are already saved/);
  assert.equal(active().links.length, before, 'a refused commit saves nothing');

  const kept = await ok({type: 'capture.commit', links: [candidate(1), candidate(5), candidate(5), candidate(2)], skipSaved: true});
  assert.equal(kept.count, 2); assert.equal(kept.skipped, 2);
  assert.equal(kept.collectionId, home); assert.match(kept.batchId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(collection(home).links.filter((l) => l.batchId === kept.batchId).map((l) => l.url), ['https://a.test/5', 'https://a.test/5'], 'repeats within one add are not "already saved"');

  const none = await ok({type: 'capture.commit', links: [candidate(1)], skipSaved: true});
  assert.deepEqual([none.count, none.skipped, none.batchId], [0, 1, ''], 'nothing added: no batch');
  const all = await ok({type: 'capture.commit', links: [candidate(1)], skipSaved: false});
  assert.deepEqual([all.count, all.skipped], [1, 0], 'without skipSaved, a saved URL is added again');
  const unset = await ok({type: 'capture.commit', links: [candidate(1)]});
  assert.deepEqual([unset.count, unset.skipped], [1, 0], 'an absent skipSaved skips nothing, as in 0.3.0');
  await refused({type: 'capture.commit', links: [candidate(3)], skipSaved: true, collectionId: 'gone'}, /no longer exists, so nothing was saved/);
});

test('capture.copy as rich links: HTML and plain text from richLinks; other formats unchanged', async () => {
  const rich = await ok({type: 'capture.copy', format: 'rich', links: [candidate(1, {anchorText: '<b>Bold & "quoted"</b>'}), candidate(2, {anchorText: ''}), candidate(3, {url: 'mailto:x@a.test'})]});
  assert.deepEqual(Object.keys(rich).sort(), ['html', 'text']);
  assert.equal(rich.html, '<ul><li><a href="https://a.test/1">&lt;b&gt;Bold &amp; &quot;quoted&quot;&lt;/b&gt;</a></li><li><a href="https://a.test/2">https://a.test/2</a></li><li><a href="mailto:x@a.test">Link 3</a></li></ul>');
  assert.equal(rich.text, '<b>Bold & "quoted"</b> (https://a.test/1)\nhttps://a.test/2\nLink 3 (mailto:x@a.test)');
  assert.deepEqual(Object.keys(await ok({type: 'capture.copy', format: 'text', links: [candidate(1)]})), ['text']);
  await refused({type: 'capture.copy', format: 'html', links: [candidate(1)]}, /or as rich links/);
  await refused({type: 'capture.copy', format: 'rich', links: [candidate(1, {url: 'javascript:alert(1)'})]}, /unsupported link scheme/);
  await refused({type: 'capture.copy', format: 'rich', links: 'nope'}, /at most 20,000 links/);
  await refused({type: 'capture.copy', format: 'rich', links: [candidate(1)]}, /capture card on a webpage/, {url: WORKBENCH.url});
});

test('capture.undoAdd removes exactly the batch that add created, from the page that added it', async () => {
  const home = active().id;
  await ok({type: 'state.mutate', action: {type: 'links.remove', collectionId: home, ids: [active().links[0].id]}}, WORKBENCH);
  const removalUndo = structuredClone(local.linkMeteorState.undo);
  assert.ok(removalUndo, 'a removal Undo is waiting in the workbench');
  const before = structuredClone(collection(home).links);
  const added = await ok({type: 'capture.commit', links: [candidate(20), candidate(21), candidate(22)]});
  assert.equal(collection(home).links.length, before.length + 3);

  await refused({type: 'capture.undoAdd', collectionId: home}, /Say which add to undo/);
  await refused({type: 'capture.undoAdd', collectionId: home, batchId: 42}, /Say which add to undo/);
  await refused({type: 'capture.undoAdd', collectionId: home, batchId: 'unknown'}, /can no longer be undone/);
  await refused({type: 'capture.undoAdd', collectionId: home, batchId: added.batchId}, /can no longer be undone/, OTHER_PAGE);
  await refused({type: 'capture.undoAdd', collectionId: home, batchId: added.batchId}, /capture card on a webpage/, {url: WORKBENCH.url});
  const undone = await ok({type: 'capture.undoAdd', collectionId: home, batchId: added.batchId});
  assert.deepEqual(undone, {count: 3});
  assert.deepEqual(collection(home).links, before, 'the collection is exactly as before the add');
  assert.deepEqual(local.linkMeteorState.undo, removalUndo, 'the workbench’s removal Undo is kept');
  await refused({type: 'capture.undoAdd', collectionId: home, batchId: added.batchId}, /can no longer be undone/); // only once

  // Refused once the batch changed: one link removed, or one link annotated.
  const shrunk = await ok({type: 'capture.commit', links: [candidate(30), candidate(31)]});
  const one = collection(home).links.find((l) => l.batchId === shrunk.batchId);
  await ok({type: 'state.mutate', action: {type: 'links.remove', collectionId: home, ids: [one.id]}}, WORKBENCH);
  await refused({type: 'capture.undoAdd', collectionId: home, batchId: shrunk.batchId}, /changed since they were added/);
  const noted = await ok({type: 'capture.commit', links: [candidate(40)]});
  const link = collection(home).links.find((l) => l.batchId === noted.batchId);
  await ok({type: 'state.mutate', action: {type: 'link.update', collectionId: home, id: link.id, patch: {notes: 'Keep this'}}}, WORKBENCH);
  await refused({type: 'capture.undoAdd', collectionId: home, batchId: noted.batchId}, /changed since they were added/);
  assert.ok(collection(home).links.some((l) => l.id === link.id), 'a refused Undo removes nothing');
  await refused({type: 'capture.undoAdd', collectionId: 'elsewhere', batchId: noted.batchId}, /can no longer be undone/);
});

test('capture.preference saves only contentOnly and skipSaved, as booleans, from a page', async () => {
  assert.deepEqual(await ok({type: 'capture.preference', contentOnly: true}), {contentOnly: true, skipSaved: false});
  assert.deepEqual(await ok({type: 'capture.preference', contentOnly: false, skipSaved: true}), {contentOnly: false, skipSaved: true});
  assert.equal(local.linkMeteorState.settings.skipSaved, true);
  const settings = structuredClone(local.linkMeteorState.settings);
  await refused({type: 'capture.preference'}, /only contentOnly and skipSaved/);
  await refused({type: 'capture.preference', skipSaved: 'true'}, /only contentOnly and skipSaved/);
  await refused({type: 'capture.preference', contentOnly: 1}, /only contentOnly and skipSaved/);
  await refused({type: 'capture.preference', skipSaved: false, theme: 'ember'}, /only contentOnly and skipSaved/);
  await refused({type: 'capture.preference', afterDrag: 'add'}, /only contentOnly and skipSaved/);
  await refused({type: 'capture.preference', skipSaved: false}, /capture card on a webpage/, {url: WORKBENCH.url});
  assert.deepEqual(local.linkMeteorState.settings, settings, 'a refused preference changes nothing');
  await ok({type: 'capture.preference', skipSaved: false});
});

test('Capture this page with content links only leaves page chrome out, counts it, and Include them adds it', async () => {
  await ok({type: 'state.mutate', action: {type: 'collection.create', name: 'Pages'}}, WORKBENCH);
  const home = active().id;
  const scan = (host, nav, content) => ({warnings: [], inaccessibleFrames: 0, links: [
    ...Array.from({length: nav}, (_, i) => ({...candidate(i, {url: `https://${host}/nav/${i}`}), pageChrome: true})),
    ...Array.from({length: content}, (_, i) => candidate(i, {url: `https://${host}/content/${i}`})),
  ]});
  scans.set(1, scan('a.test', 3, 2)); scans.set(2, scan('b.test', 4, 1));

  // Without contentOnly, pageChrome is ignored.
  const all = await ok({type: 'capture.run', tabIds: [1]}, WORKBENCH);
  assert.equal(all.report.capturedCount, 5); assert.equal(all.report.results[0].leftOut, 0);
  assert.equal(session.linkMeteorLeftOut, undefined, 'nothing is kept when nothing was left out');
  await refused({type: 'capture.includeLeftOut', batchId: all.report.batchId}, /no longer kept/, WORKBENCH);

  await ok({type: 'state.mutate', action: {type: 'settings.update', patch: {contentOnly: true}}}, WORKBENCH);
  const before = active().links.length;
  const {report} = await ok({type: 'capture.run', tabIds: [1, 2]}, WORKBENCH);
  assert.deepEqual(report.results.map((r) => [r.count, r.leftOut, r.skipped]), [[2, 3, 0], [1, 4, 0]]);
  assert.equal(report.capturedCount, 3);
  assert.equal(active().links.length, before + 3);
  assert.ok(active().links.slice(before).every((l) => l.url.includes('/content/')), 'only content links are saved');
  assert.equal(session.linkMeteorLeftOut.batchId, report.batchId);
  assert.equal(session.linkMeteorLeftOut.collectionId, home);
  assert.equal(session.linkMeteorLeftOut.total, 7);
  assert.deepEqual(session.linkMeteorLeftOut.links.map((l) => l.sourceTitle), ['Page A', 'Page A', 'Page A', 'Page B', 'Page B', 'Page B', 'Page B']);
  assert.ok(session.linkMeteorLeftOut.links.every((l) => !('pageChrome' in l) && l.batchId === report.batchId), 'kept as occurrences of this capture');
  assert.equal(session.linkMeteorCaptureReport.report.batchId, report.batchId);

  // Include them: workbench only, for the kept capture; adds to the capture's collection, once.
  await refused({type: 'capture.includeLeftOut', batchId: report.batchId}, /must be requested from the Link Meteor workbench/, PAGE);
  await refused({type: 'capture.includeLeftOut'}, /Choose a capture/, WORKBENCH);
  await refused({type: 'capture.includeLeftOut', batchId: 'another'}, /no longer kept/, WORKBENCH);
  await ok({type: 'state.mutate', action: {type: 'collection.create', name: 'Now active'}}, WORKBENCH);
  const included = await ok({type: 'capture.includeLeftOut', batchId: report.batchId}, WORKBENCH);
  assert.deepEqual([included.count, included.skipped, included.total, included.collectionId, included.name], [7, 0, 7, home, 'Pages']);
  assert.equal(collection(home).links.filter((l) => l.batchId === report.batchId).length, 10, 'all ten links of the capture, in the capture’s collection');
  assert.equal(session.linkMeteorCaptureReport.report.leftOutIncluded, 7, 'the kept report remembers it');
  assert.equal(session.linkMeteorLeftOut, undefined);
  await refused({type: 'capture.includeLeftOut', batchId: report.batchId}, /no longer kept/, WORKBENCH);

  // With skipSaved, Capture this page and Include them skip what the collection already holds.
  await ok({type: 'state.mutate', action: {type: 'collection.activate', id: home}}, WORKBENCH);
  await ok({type: 'state.mutate', action: {type: 'settings.update', patch: {skipSaved: true}}}, WORKBENCH);
  const again = await ok({type: 'capture.run', tabIds: [1]}, WORKBENCH);
  assert.deepEqual([again.report.results[0].count, again.report.results[0].skipped, again.report.results[0].leftOut], [0, 2, 3]);
  const skipped = await ok({type: 'capture.includeLeftOut', batchId: again.report.batchId}, WORKBENCH);
  assert.deepEqual([skipped.count, skipped.skipped], [0, 3]);

  // A deleted destination: nothing is added and the links stay kept.
  const next = await ok({type: 'capture.run', tabIds: [2]}, WORKBENCH);
  await ok({type: 'state.mutate', action: {type: 'collection.delete', id: home}}, WORKBENCH);
  await refused({type: 'capture.includeLeftOut', batchId: next.report.batchId}, /went to no longer exists/, WORKBENCH);
  assert.equal(session.linkMeteorLeftOut.batchId, next.report.batchId);
  await ok({type: 'state.mutate', action: {type: 'settings.update', patch: {skipSaved: false}}}, WORKBENCH);
});

test('left-out links are bounded: at most 5,000 are kept, with the true total', async () => {
  const home = active().id;
  scans.set(1, {warnings: [], links: Array.from({length: 5200}, (_, i) => ({...candidate(i, {url: `https://a.test/bound/${i}`}), pageChrome: true}))});
  const {report} = await ok({type: 'capture.run', tabIds: [1]}, WORKBENCH);
  assert.equal(report.results[0].leftOut, 5200);
  assert.equal(session.linkMeteorLeftOut.links.length, 5000);
  assert.equal(session.linkMeteorLeftOut.total, 5200);
  const included = await ok({type: 'capture.includeLeftOut', batchId: report.batchId}, WORKBENCH);
  assert.deepEqual([included.count, included.total], [5000, 5200]);
  assert.equal(collection(home).links.filter((l) => l.batchId === report.batchId).length, 5000);
  await settle();
});
