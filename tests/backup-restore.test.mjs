// Restore, its Undo snapshot, status and discard in the background, against a small simulated
// chrome.storage.local. Like Chrome, the simulation returns stored objects with their keys in
// sorted order, so Undo's "unchanged since" check is exercised on read-back data, not on the
// objects that were written. Loaded-extension behavior is checked in tests/backup-browser.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, reduceState, createBackup, planRestore } from '../src/core/model.js';

const sorted = (value) => {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  return value;
};
const local = {};
const sets = [];
const messages = [];
let failSet = false;
globalThis.chrome = {
  storage: { local: {
    async get(key) { return key in local ? { [key]: sorted(structuredClone(local[key])) } : {}; },
    async set(value) { if (failSet) throw new Error('QUOTA_BYTES quota exceeded'); sets.push(Object.keys(value).sort()); Object.assign(local, structuredClone(value)); },
    async remove(key) { for (const name of [key].flat()) delete local[name]; },
  } },
  runtime: { sendMessage: async (message) => { messages.push(message); } },
};

const { workbenchMessages, RESTORE_UNDO_KEY } = await import('../src/background/backup.js');
const store = await import('../src/background/store.js');
const { STATE_KEY, onStateWritten, mutate } = store;
const call = (type, extra = {}) => workbenchMessages[type]({ type, ...extra });
const written = [];
onStateWritten((previous, next) => written.push([previous, next]));

const link = (id, overrides = {}) => ({ id, anchorText: `Paper ${id}`, accessibleLabel: '', url: `https://example.org/${id}.pdf`,
  originalHref: `/${id}.pdf`, sourceUrl: 'https://example.org/list', sourceTitle: 'Reading list', frameUrl: '',
  capturedAt: '2026-09-25T00:00:00.000Z', batchId: 'batch-1', notes: '', tags: [], ...overrides });

// Another machine's data: two collections, notes, tags and settings, including a hold-drag site.
function otherMachine() {
  let state = createState();
  state = reduceState(state, { type: 'links.append', links: [link('a1', { notes: 'check', tags: ['t'] }), link('a2', { anchorText: '' })] });
  state = reduceState(state, { type: 'collection.update', id: state.activeCollectionId, patch: { notes: 'Chapter 2', tags: ['thesis'] } });
  state = reduceState(state, { type: 'collection.create', name: 'Admin' });
  state = reduceState(state, { type: 'links.append', links: [link('b1', { url: 'https://admin.example/tickets/1' })] });
  state = reduceState(state, { type: 'settings.update', patch: { holdKey: 'q', holdOrigins: ['https://a.example'], holdExceptions: ['https://maps.example'], exportPrefix: 'research' } });
  return state;
}
const backup = createBackup(otherMachine(), { createdAt: '2026-09-26T12:00:00.000Z', extensionVersion: '0.3.0' });
const backupText = JSON.stringify(backup);

function reset(state = createState()) {
  for (const key of Object.keys(local)) delete local[key];
  local[STATE_KEY] = structuredClone(state);
  sets.length = 0; messages.length = 0; written.length = 0; failSet = false;
  return state;
}
const saved = () => structuredClone(local[STATE_KEY]);
const settle = () => new Promise((done) => setTimeout(done, 0));

test('a merge saves the planned state and the Undo snapshot in one storage write, then announces it', async () => {
  const fresh = reset();
  const reply = await call('backup.restore', { backup: backupText, mode: 'merge' });
  const planned = planRestore(fresh, backup, 'merge');
  const undated = (state) => ({ ...state, collections: state.collections.map(({ updatedAt, ...rest }) => rest) });
  assert.deepEqual(undated(reply.state), undated(planned.state), 'the planned state, apart from the time a joined collection was updated');
  assert.deepEqual(reply.summary, planned.summary);
  assert.deepEqual(sets, [[RESTORE_UNDO_KEY, STATE_KEY]], 'exactly one set call, holding both keys');
  assert.deepEqual(saved(), reply.state);
  assert.deepEqual(saved().collections.map((c) => c.name), ['My research', 'Admin'], 'no second My research');
  const snapshot = local[RESTORE_UNDO_KEY];
  assert.deepEqual(snapshot.before, fresh);
  assert.deepEqual(snapshot.summary, planned.summary);
  assert.ok(!Number.isNaN(Date.parse(snapshot.createdAt)));
  assert.deepEqual(messages, [{ type: 'state.changed' }]);
  await settle();
  assert.equal(written.length, 1, 'onStateWritten listeners heard the restore');
  assert.deepEqual(written[0][0], fresh);
  assert.deepEqual(written[0][1], reply.state);
});

test('restoring the same file twice by merge adds nothing the second time', async () => {
  reset();
  await call('backup.restore', { backup: backupText, mode: 'merge' });
  const once = saved();
  const again = await call('backup.restore', { backup: backup, mode: 'merge' });
  assert.equal(again.summary.linksAdded, 0);
  assert.equal(again.summary.linksSkipped, 3);
  assert.equal(again.summary.collectionsAdded, 0);
  assert.deepEqual(saved(), once);
  assert.deepEqual(local[RESTORE_UNDO_KEY].before, once, 'the next restore replaces the snapshot');
});

test('a replace saves the backup exactly and keeps what it replaced for Undo', async () => {
  let local0 = reduceState(createState(), { type: 'links.append', links: [link('x1'), link('x2')] });
  local0 = reduceState(local0, { type: 'links.remove', ids: ['x1'] });
  reset(local0);
  const reply = await call('backup.restore', { backup: backupText, mode: 'replace' });
  assert.deepEqual(saved().collections, backup.state.collections);
  assert.deepEqual(saved().settings, backup.state.settings);
  assert.equal(saved().undo, null);
  assert.equal(reply.summary.linksRemoved, 1);
  assert.deepEqual(local[RESTORE_UNDO_KEY].before, local0);
  const undone = await call('backup.undo');
  assert.deepEqual(undone.state, local0);
  assert.deepEqual(saved(), local0, 'Undo brings back the removal undo snapshot too');
});

test('a failed restore write changes neither the state nor an earlier snapshot, and announces nothing', async () => {
  reset();
  await call('backup.restore', { backup: backupText, mode: 'merge' });
  const state = saved(); const snapshot = structuredClone(local[RESTORE_UNDO_KEY]);
  messages.length = 0; await settle(); written.length = 0;
  failSet = true;
  await assert.rejects(call('backup.restore', { backup: backupText, mode: 'replace' }), /Could not save the restore\. Nothing was changed/);
  failSet = false;
  assert.deepEqual(saved(), state);
  assert.deepEqual(local[RESTORE_UNDO_KEY], snapshot);
  assert.deepEqual(messages, []);
  await settle();
  assert.equal(written.length, 0);
});

test('invalid files and modes are refused with the reader\'s message before anything is written', async () => {
  const fresh = reset();
  await assert.rejects(call('backup.restore', { backup: '{"format":', mode: 'merge' }), /not valid JSON/);
  await assert.rejects(call('backup.restore', { backup: { ...backup, formatVersion: 2 }, mode: 'merge' }), /newer version of Link Meteor/);
  const bad = structuredClone(backup); bad.state.collections[0].links[0].url = 'javascript:alert(1)';
  await assert.rejects(call('backup.restore', { backup: bad, mode: 'replace' }), /url/);
  await assert.rejects(call('backup.restore', { backup: backupText, mode: 'overwrite' }), /merge' or 'replace/);
  assert.deepEqual(sets, []);
  assert.deepEqual(saved(), fresh);
  assert.equal(RESTORE_UNDO_KEY in local, false);
});

test('Undo puts the previous state back only while the saved state is the one the restore wrote', async () => {
  const fresh = reset();
  await call('backup.restore', { backup: backupText, mode: 'merge' });
  const restored = saved();
  // Anything the person changes afterwards blocks Undo, which says why and keeps both.
  await mutate({ type: 'collection.create', name: 'Made after the restore' });
  const changed = saved(); const snapshot = structuredClone(local[RESTORE_UNDO_KEY]);
  await assert.rejects(call('backup.undo'), /changed after this restore.*both kept/);
  assert.deepEqual(saved(), changed);
  assert.deepEqual(local[RESTORE_UNDO_KEY], snapshot);
  assert.notEqual((await call('backup.status')).undo, null);
  // Back to exactly the restored state (same content, new key order), Undo is allowed again.
  local[STATE_KEY] = structuredClone(restored);
  messages.length = 0;
  const undone = await call('backup.undo');
  assert.deepEqual(undone.state, fresh);
  assert.deepEqual(saved(), fresh);
  assert.equal(RESTORE_UNDO_KEY in local, false, 'Undo clears the snapshot');
  assert.deepEqual(messages, [{ type: 'state.changed' }]);
  assert.deepEqual(await call('backup.status'), { undo: null });
  await assert.rejects(call('backup.undo'), /no restore to undo/);
});

test('each kind of later change blocks Undo: links, removal undo, activation and settings', async () => {
  const changes = [
    { type: 'link.update', id: 'a1', patch: { notes: 'edited' } },
    { type: 'links.remove', ids: ['a2'] },
    { type: 'collection.activate', id: '__second__' },
    { type: 'settings.update', patch: { holdKey: 'k' } },
    { type: 'settings.update', patch: { exportTimestamp: false } },
  ];
  for (const change of changes) {
    reset();
    await call('backup.restore', { backup: backupText, mode: 'merge' });
    const action = change.id === '__second__' ? { ...change, id: saved().collections[1].id } : change;
    await mutate({ ...action, collectionId: action.type.startsWith('link') ? saved().collections[0].id : undefined });
    await assert.rejects(call('backup.undo'), /changed after this restore/, JSON.stringify(change));
  }
});

test('the background dropping hold-drag access it no longer has does not block Undo', async () => {
  let local0 = reduceState(createState(), { type: 'settings.update', patch: { holdOrigins: ['https://mine.example'] } });
  reset(local0);
  const allSites = structuredClone(backup); allSites.state.settings.holdScope = 'all';
  allSites.state.settings.holdOrigins = ['https://a.example', 'https://b.example', 'https://c.example'];
  await call('backup.restore', { backup: allSites, mode: 'replace' });
  // What the access upkeep writes when Chrome grants neither all sites nor b.example.
  await mutate({ type: 'settings.update', patch: { holdScope: 'sites', holdOrigins: ['https://a.example', 'https://c.example'] } });
  const undone = await call('backup.undo');
  assert.deepEqual(undone.state, local0);
  // A site added afterwards is a change by the person, so Undo refuses.
  reset(local0);
  await call('backup.restore', { backup: allSites, mode: 'replace' });
  await mutate({ type: 'settings.update', patch: { holdOrigins: ['https://a.example', 'https://b.example', 'https://c.example', 'https://new.example'] } });
  await assert.rejects(call('backup.undo'), /changed after this restore/);
  // So is switching all-sites mode on when the restore left it off.
  reset(local0);
  await call('backup.restore', { backup: backupText, mode: 'replace' });
  await mutate({ type: 'settings.update', patch: { holdScope: 'all' } });
  await assert.rejects(call('backup.undo'), /changed after this restore/);
});

test('status reports the last restore without its saved state, and discarding frees the snapshot', async () => {
  reset();
  assert.deepEqual(await call('backup.status'), { undo: null });
  await call('backup.restore', { backup: backupText, mode: 'merge' });
  const status = await call('backup.status');
  assert.deepEqual(Object.keys(status.undo).sort(), ['createdAt', 'summary']);
  assert.equal(status.undo.summary.mode, 'merge');
  assert.equal(status.undo.summary.linksAdded, 3);
  const state = saved();
  assert.deepEqual(await call('backup.discardUndo'), {});
  assert.equal(RESTORE_UNDO_KEY in local, false);
  assert.deepEqual(saved(), state, 'discarding keeps the restored data');
  assert.deepEqual(await call('backup.status'), { undo: null });
  await assert.rejects(call('backup.undo'), /no restore to undo/);
});

test('Undo still works after the service worker restarts: nothing is kept in memory', async () => {
  const fresh = reset();
  await call('backup.restore', { backup: backupText, mode: 'merge' });
  const restarted = await import('../src/background/backup.js?restarted');
  assert.notEqual(restarted.workbenchMessages, workbenchMessages);
  assert.equal((await restarted.workbenchMessages['backup.status']()).undo.summary.mode, 'merge');
  assert.deepEqual((await restarted.workbenchMessages['backup.undo']()).state, fresh);
});

test('a failed Undo write keeps the restored state and its snapshot', async () => {
  reset();
  await call('backup.restore', { backup: backupText, mode: 'merge' });
  const state = saved(); const snapshot = structuredClone(local[RESTORE_UNDO_KEY]);
  failSet = true;
  await assert.rejects(call('backup.undo'), /Could not undo the restore\. Nothing was changed/);
  failSet = false;
  assert.deepEqual(saved(), state);
  assert.deepEqual(local[RESTORE_UNDO_KEY], snapshot);
});

test('restores wait their turn in the state queue with other writes', async () => {
  reset();
  const [, restored, created] = await Promise.all([
    mutate({ type: 'links.append', links: [link('first')] }),
    call('backup.restore', { backup: backupText, mode: 'merge' }),
    mutate({ type: 'collection.create', name: 'Queued after' }),
  ]);
  assert.deepEqual(restored.state.collections[0].links.map((x) => x.id), ['first', 'a1', 'a2']);
  assert.deepEqual(created.collections.map((c) => c.name), ['My research', 'Admin', 'Queued after']);
  assert.deepEqual(local[RESTORE_UNDO_KEY].before.collections[0].links.map((x) => x.id), ['first']);
});
