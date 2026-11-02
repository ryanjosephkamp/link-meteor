// Moving and copying links to another collection (0.5.0 RC2), with Chrome's APIs simulated in Node:
// links.transfer (everything travels, columns matched or created, page citations carried, repeats
// skipped and left in place, one write) and links.transferUndo (both collections back as they were,
// refused once anything it would remove changed). API mocks, not Chrome itself;
// tests/move-browser.mjs runs the real extension.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createState, reduceState, transferLinks, MAX_CUSTOM_FIELDS} from '../src/core/model.js';
import {TRANSFERS_KEY} from '../src/background/transfer.js';

const event = () => ({listeners: [], addListener(fn) { this.listeners.push(fn); }});
const local = {}, session = {};
let failWrites = false;
globalThis.chrome = {
  storage: {
    onChanged: event(),
    local: {async get(key) { return {[key]: structuredClone(local[key])}; }, async set(value) { if (failWrites) throw new Error('QUOTA_BYTES quota exceeded'); Object.assign(local, structuredClone(value)); }},
    session: {async get(key) { return {[key]: structuredClone(session[key])}; }, async set(value) { Object.assign(session, structuredClone(value)); }, async remove(key) { delete session[key]; }},
  },
  runtime: {getURL: (path) => 'chrome-extension://meteor/' + path, sendMessage: async () => {}, onMessage: event(), onInstalled: event(), onStartup: event()},
  permissions: {async contains() { return false; }, onAdded: event(), onRemoved: event()},
  scripting: {async executeScript() { return []; }, async getRegisteredContentScripts() { return []; }, async unregisterContentScripts() {}, async registerContentScripts() {}},
  tabs: {async query() { return []; }, async get() { throw Error('No tab'); }, async sendMessage() {}, async create() { return {id: 99}; }, async update() {}},
  windows: {async getAll() { return []; }, async update() {}},
  action: {onClicked: event()}, sidePanel: {open: async () => {}}, commands: {onCommand: event()}, contextMenus: {onClicked: event(), removeAll: async () => {}, create: () => {}},
};
await import('../src/background.js');

const WORKBENCH = {url: 'chrome-extension://meteor/ui/workbench.html'};
const call = (message, sender = WORKBENCH) => new Promise((resolve) => chrome.runtime.onMessage.listeners[0](message, sender, resolve));
const ok = async (message) => { const reply = await call(message); assert.equal(reply.ok, true, reply.error); return reply.data; };
const refused = async (message, pattern) => { const reply = await call(message); assert.equal(reply.ok, false, 'expected a refusal'); assert.match(reply.error, pattern); };
const state = () => local.linkMeteorState;
const collection = (id) => state().collections.find((item) => item.id === id);
const withoutTimes = (item) => { const {updatedAt: _u, ...rest} = item; return rest; };

const ABSTRACT = 'https://arxiv.org/abs/2409.11211', SCHOLAR = 'https://scholar.example/search?q=splat';
const link = (i, extra = {}) => ({id: `l${i}`, anchorText: `Link ${i}`, accessibleLabel: '', url: `https://site${i}.example/`, originalHref: `/${i}`, sourceUrl: SCHOLAR,
  sourceTitle: 'Search', frameUrl: '', capturedAt: `2026-09-2${i % 10}T10:00:00.000Z`, batchId: 'b1', notes: '', tags: [], ...extra});

// Two collections: Reading (the open one, with columns and page citations) and Thesis.
function seed() {
  let s = createState();
  const reading = s.activeCollectionId;
  s = reduceState(s, {type: 'collection.update', id: reading, patch: {name: 'Reading'}});
  s = reduceState(s, {type: 'fields.add', collectionId: reading, name: 'Deadline'});
  s = reduceState(s, {type: 'fields.add', collectionId: reading, name: 'PI'});
  const [deadline, pi] = s.collections[0].fields.map((field) => field.id);
  s = reduceState(s, {type: 'links.append', collectionId: reading, links: [
    link(1, {notes: 'Read first', tags: ['heat'], context: 'Around link 1, in prose.', status: 'reading', starred: true, fields: {[deadline]: 'Dec 1', [pi]: 'Okafor'}}),
    link(2),
    link(3, {url: 'https://arxiv.org/pdf/2409.11211', sourceUrl: ABSTRACT, fields: {[pi]: 'Mihajlovic'}}),
    link(4, {url: 'https://shared.example/'}),
    link(5),
  ], pages: {
    [ABSTRACT]: {title: 'SplatFields', authors: ['Mihajlovic, Marko'], pdfUrl: 'https://arxiv.org/pdf/2409.11211', arxiv: '2409.11211'},
    'https://site1.example/': {title: 'Site one'},
    'https://elsewhere.example/': {title: 'Unused'},
  }});
  s = reduceState(s, {type: 'collection.create', name: 'Thesis'});
  const thesis = s.activeCollectionId;
  s = reduceState(s, {type: 'fields.add', collectionId: thesis, name: 'pi'});
  s = reduceState(s, {type: 'links.append', collectionId: thesis, links: [link(9, {url: 'https://shared.example/'})]});
  s = reduceState(s, {type: 'collection.activate', id: reading});
  // An earlier removal's Undo, which a move and its Undo leave alone.
  s = reduceState(s, {type: 'links.append', collectionId: reading, links: [link(7)]});
  s = reduceState(s, {type: 'links.remove', collectionId: reading, ids: ['l7']});
  local.linkMeteorState = s;
  delete session[TRANSFERS_KEY];
  return {reading, thesis, deadline, pi};
}

test('a move takes everything to the end of the destination, skips repeats, matches or creates columns, and carries citations', async () => {
  const {reading, thesis, deadline, pi} = seed();
  const before = structuredClone(state());
  const result = await ok({type: 'links.transfer', mode: 'move', fromCollectionId: reading, toCollectionId: thesis, ids: ['l1', 'l3', 'l4']});
  assert.deepEqual([result.moved, result.skipped, result.fields, result.name, result.createdCollection], [2, 1, 1, 'Thesis', false]);
  assert.equal(state().activeCollectionId, reading, 'the open collection stays open');
  assert.deepEqual(collection(reading).links.map((item) => item.id), ['l2', 'l4', 'l5'], 'the repeat stays where it was');
  const home = collection(thesis);
  assert.deepEqual(home.links.map((item) => item.id), ['l9', 'l1', 'l3'], 'moved links keep their ids and order, at the end');
  // Columns: "PI" matches Thesis's "pi" by name; "Deadline" is created there.
  const [piThere, deadlineThere] = home.fields.map((field) => field.id);
  assert.deepEqual(home.fields.map((field) => field.name), ['pi', 'Deadline']);
  const moved = home.links[1], original = before.collections[0].links[0];
  assert.deepEqual(moved.fields, {[deadlineThere]: 'Dec 1', [piThere]: 'Okafor'});
  const {fields: _a, ...movedRest} = moved, {fields: _b, ...originalRest} = original;
  assert.deepEqual(movedRest, originalRest, 'notes, tags, context, status, star and capture details travel');
  assert.deepEqual(home.links[2].fields, {[piThere]: 'Mihajlovic'});
  assert.ok(deadline && pi);
  // Citations: the moved links' own page and the page one borrows from; not unused ones.
  assert.deepEqual(Object.keys(home.pages).sort(), [ABSTRACT, 'https://site1.example/'].sort());
  assert.ok(collection(reading).pages[ABSTRACT], 'the source keeps its citations');
  assert.deepEqual(state().undo, before.undo, 'an earlier removal keeps its Undo');
  assert.equal(session[TRANSFERS_KEY].length, 1);
});

test('Undo of a move puts both collections back exactly, with the earlier removal still undoable', async () => {
  const {reading, thesis} = seed();
  const before = structuredClone(state());
  const {transferId} = await ok({type: 'links.transfer', mode: 'move', fromCollectionId: reading, toCollectionId: thesis, ids: ['l3', 'l1', 'l5']});
  const undone = await ok({type: 'links.transferUndo', transferId});
  assert.deepEqual([undone.mode, undone.count, undone.fieldsRemoved, undone.collectionRemoved], ['move', 3, 1, false]);
  assert.deepEqual(state().collections.map(withoutTimes), before.collections.map(withoutTimes));
  assert.deepEqual(state().undo, before.undo);
  assert.equal(state().activeCollectionId, before.activeCollectionId);
  await refused({type: 'links.transferUndo', transferId}, /can no longer be undone/);
});

test('a copy to a new collection: new ids, the source unchanged, the new collection not opened; Undo removes it', async () => {
  const {reading} = seed();
  const before = structuredClone(state());
  const result = await ok({type: 'links.transfer', mode: 'copy', fromCollectionId: reading, newCollection: '  Chapter   two ', ids: ['l1', 'l2']});
  assert.deepEqual([result.moved, result.skipped, result.fields, result.name, result.createdCollection], [2, 0, 2, 'Chapter two', true]);
  const home = collection(result.collectionId);
  assert.equal(home.name, 'Chapter two');
  assert.equal(state().activeCollectionId, reading);
  assert.deepEqual(collection(reading).links, before.collections[0].links, 'the source is unchanged');
  assert.equal(home.links.length, 2);
  assert.ok(home.links.every((item) => !['l1', 'l2'].includes(item.id)), 'copies get new ids');
  assert.equal(home.links[0].notes, 'Read first');
  assert.deepEqual(home.fields.map((field) => field.name), ['Deadline', 'PI']);
  await ok({type: 'links.transferUndo', transferId: result.transferId});
  assert.deepEqual(state().collections.map(withoutTimes), before.collections.map(withoutTimes));
});

test('Undo is refused once the links or what the transfer created changed, and says what to do', async () => {
  let {reading, thesis} = seed();
  let result = await ok({type: 'links.transfer', mode: 'move', fromCollectionId: reading, toCollectionId: thesis, ids: ['l1']});
  local.linkMeteorState = reduceState(state(), {type: 'link.update', collectionId: thesis, id: 'l1', patch: {notes: 'Edited later'}});
  await refused({type: 'links.transferUndo', transferId: result.transferId}, /changed since.*Move them back instead/);
  ({reading} = seed());
  result = await ok({type: 'links.transfer', mode: 'copy', fromCollectionId: reading, newCollection: 'Scratch', ids: ['l2']});
  local.linkMeteorState = reduceState(state(), {type: 'links.append', collectionId: result.collectionId, links: [link(8)]});
  await refused({type: 'links.transferUndo', transferId: result.transferId}, /new collection changed since/);
  let other;
  ({reading, thesis: other} = seed());
  result = await ok({type: 'links.transfer', mode: 'copy', fromCollectionId: reading, toCollectionId: other, ids: ['l1']});
  const created = collection(other).fields.find((field) => field.name === 'Deadline').id;
  local.linkMeteorState = reduceState(state(), {type: 'link.update', collectionId: other, id: 'l9', patch: {fields: {[created]: 'Soon'}}});
  await refused({type: 'links.transferUndo', transferId: result.transferId}, /Other links now have values in the columns/);
});

test('refusals: the same collection, links already there, a missing destination, no room for a column, a failed write', async () => {
  const {reading, thesis} = seed();
  await refused({type: 'links.transfer', mode: 'move', fromCollectionId: reading, toCollectionId: reading, ids: ['l1']}, /Choose a different collection/);
  await refused({type: 'links.transfer', mode: 'copy', fromCollectionId: reading, toCollectionId: thesis, ids: ['l4']}, /That link is already in “Thesis”, so nothing was copied/);
  await refused({type: 'links.transfer', mode: 'move', fromCollectionId: reading, toCollectionId: 'gone', ids: ['l1']}, /no longer exists/);
  await refused({type: 'links.transfer', mode: 'move', fromCollectionId: reading, toCollectionId: thesis, newCollection: 'Both', ids: ['l1']}, /Choose one destination/);
  await refused({type: 'links.transfer', mode: 'move', fromCollectionId: reading, newCollection: 'x'.repeat(121), ids: ['l1']}, /at most 120 characters/);
  await refused({type: 'links.transfer', mode: 'drop', fromCollectionId: reading, toCollectionId: thesis, ids: ['l1']}, /move or copy/);
  await refused({type: 'links.transfer', mode: 'move', fromCollectionId: reading, toCollectionId: thesis, ids: []}, /Choose the links/);
  let s = state();
  for (let i = 1; i < MAX_CUSTOM_FIELDS; i++) s = reduceState(s, {type: 'fields.add', collectionId: thesis, name: `Full ${i}`});
  local.linkMeteorState = s;
  const before = structuredClone(state());
  await refused({type: 'links.transfer', mode: 'move', fromCollectionId: reading, toCollectionId: thesis, ids: ['l1']}, /no room for the column “Deadline”.*Nothing was moved/);
  assert.deepEqual(state(), before);
  const fresh = seed();
  const unchanged = structuredClone(state());
  failWrites = true;
  await refused({type: 'links.transfer', mode: 'move', fromCollectionId: fresh.reading, toCollectionId: fresh.thesis, ids: ['l1']}, /Could not save this, so nothing was moved/);
  failWrites = false;
  assert.deepEqual(state(), unchanged);
  assert.equal(session[TRANSFERS_KEY], undefined);
});

test('transferLinks is pure: the same input gives the same output, and the input is untouched', () => {
  seed();
  const input = structuredClone(state()), copy = structuredClone(input);
  const {reading, thesis} = {reading: input.collections[0].id, thesis: input.collections[1].id};
  const first = transferLinks(input, {mode: 'copy', fromCollectionId: reading, toCollectionId: thesis, ids: ['l2']}, {newId: () => 'fixed'});
  assert.deepEqual(input, copy);
  assert.equal(first.state.collections[1].links.at(-1).id, 'fixed');
  assert.deepEqual(first.record, {mode: 'copy', fromCollectionId: reading, toCollectionId: thesis, createdCollection: false, fields: [], ids: ['fixed'], positions: [], fieldMap: [], pages: []});
});
