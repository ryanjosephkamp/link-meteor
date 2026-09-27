// Versioned backup files: build, read as untrusted input, and restore by merge or replace.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, reduceState, createBackup, readBackup, planRestore, BACKUP_FORMAT, BACKUP_FORMAT_VERSION, BACKUP_LIMITS } from '../src/core/model.js';

const link = (id, overrides = {}) => ({
  id, anchorText: 'Paper', accessibleLabel: '', url: 'https://example.org/paper.pdf',
  originalHref: '/paper.pdf', sourceUrl: 'https://example.org/list', sourceTitle: 'Reading list',
  frameUrl: '', capturedAt: '2026-09-25T00:00:00.000Z', batchId: 'batch-1', notes: '', tags: [], ...overrides,
});
const deepFreeze = (value) => { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };

// Machine A: two collections with notes, tags, odd labels, a removal undo, and some settings.
function machineA() {
  let state = createState();
  const first = state.activeCollectionId;
  state = reduceState(state, { type: 'links.append', links: [
    link('a1', { anchorText: '=HYPERLINK("https://evil.example")', notes: 'check', tags: ['t'] }),
    link('a2', { anchorText: '', accessibleLabel: 'Open appendix', url: 'tel:+12125550123' }),
    link('a3', { anchorText: '<b>bold</b> [x](y)', url: 'mailto:team@example.org?subject=Plan' }),
  ] });
  state = reduceState(state, { type: 'collection.update', id: first, patch: { notes: 'Chapter 2', tags: ['thesis'] } });
  state = reduceState(state, { type: 'collection.create', name: 'Admin' });
  state = reduceState(state, { type: 'links.append', links: [link('b1', { url: 'https://admin.example/tickets/1' })] });
  state = reduceState(state, { type: 'settings.update', patch: { holdKey: 'q', holdScope: 'all', holdOrigins: ['https://a.example'], holdExceptions: ['https://maps.example'], welcomeSeen: true, exportPrefix: 'link-meteor-research', exportTimestampFormat: 'date' } });
  state = reduceState(state, { type: 'links.remove', collectionId: first, ids: ['a2'] });
  return state;
}

test('a backup holds every collection and setting, not the undo snapshot, and survives JSON', () => {
  const state = machineA();
  const backup = createBackup(state, { createdAt: '2026-09-26T12:00:00.000Z', extensionVersion: '0.3.0' });
  assert.equal(backup.format, BACKUP_FORMAT);
  assert.equal(backup.formatVersion, BACKUP_FORMAT_VERSION);
  assert.equal(backup.extensionVersion, '0.3.0');
  assert.deepEqual(Object.keys(backup.state), ['schemaVersion', 'activeCollectionId', 'collections', 'settings']);
  assert.deepEqual(backup.state.collections, state.collections);
  assert.deepEqual(backup.state.settings, state.settings);
  assert.equal(backup.state.activeCollectionId, state.activeCollectionId);
  assert.notEqual(backup.state.collections[0], state.collections[0], 'the backup does not share objects with the state');
  assert.deepEqual(readBackup(JSON.stringify(backup, null, 2)), backup);
  assert.deepEqual(readBackup(backup), backup);
  const labels = backup.state.collections[0].links.map((item) => item.anchorText);
  assert.deepEqual(labels, ['=HYPERLINK("https://evil.example")', '<b>bold</b> [x](y)'], 'formula-like and markup text stays inert data');
});

test('files that are not valid backups are refused with a reason', () => {
  const good = createBackup(machineA(), { extensionVersion: '0.3.0' });
  const variant = (change) => { const copy = structuredClone(good); change(copy); return copy; };
  const refuse = (input, pattern) => assert.throws(() => readBackup(input), pattern);
  refuse('{"format":', /not valid JSON/);
  refuse('[]', /not a Link Meteor backup/);
  refuse(JSON.stringify([good.state.collections[0].links]), /not a Link Meteor backup/);
  refuse(variant((b) => { b.format = 'other'; }), /not a Link Meteor backup/);
  refuse(variant((b) => { b.formatVersion = 2; }), /newer version of Link Meteor \(backup format 2\)\. Update Link Meteor/);
  refuse(variant((b) => { b.formatVersion = '1'; }), /unknown format version/);
  refuse(variant((b) => { b.state.schemaVersion = 2; }), /schema version 1/);
  refuse(variant((b) => { b.state.collections = []; }), /nonempty array/);
  refuse(variant((b) => { b.state.activeCollectionId = 'missing'; }), /activeCollectionId/);
  refuse(variant((b) => { b.state.collections[1].links.push(structuredClone(b.state.collections[0].links[0])); }), /lists link a1 twice/);
  refuse(variant((b) => { b.state.collections.push(structuredClone(b.state.collections[0])); }), /lists collection .* twice/);
  refuse(variant((b) => { b.state.collections[0].links[0].url = 'javascript:alert(1)'; }), /url/);
  refuse(variant((b) => { b.state.collections[0].links[0].url = 'https://example.org/a b'; }), /url/);
  refuse(variant((b) => { b.state.collections[0].links[0].id = ''; }), /link\.id/);
  refuse(variant((b) => { b.state.collections[0].name = '  '; }), /collection\.name/);
  refuse(variant((b) => { b.state.collections[0].tags = 'x'; }), /collection\.tags/);
  refuse(variant((b) => { b.state.settings.holdKey = 'mod'; }), /holdKey/);
  refuse(variant((b) => { b.state.settings.holdExceptions = ['https://a.example']; }), /both a hold-drag site and an exception/);
  refuse(variant((b) => { b.state.settings.exportPrefix = '../../etc'; }), /exportPrefix/);
  refuse(variant((b) => { b.state.collections = Array.from({ length: BACKUP_LIMITS.collections + 1 }, () => null); }), /at most 10,000 collections/);
  refuse(variant((b) => { b.state.collections[0].links = new Array(BACKUP_LIMITS.links + 1).fill(null); }), /at most 250,000 links/);
  refuse(' '.repeat(BACKUP_LIMITS.bytes + 1), /larger than 50 MB/);
});

test('readers keep only contract fields and fill settings missing from older backups', () => {
  const good = createBackup(machineA(), { extensionVersion: '0.3.0' });
  const raw = structuredClone(good);
  raw.state.collections[0].links[0].secret = 'x';
  raw.state.collections[0].color = 'red';
  raw.state.settings = { holdKey: 'q', holdOrigins: ['https://a.example'], theme: 'ember' };
  raw.state.undo = { collectionId: 'x', links: [], indices: [] };
  // JSON.parse makes "__proto__" an own property; it must not reach the saved objects.
  const text = JSON.stringify(raw).replace('"secret":"x"', '"secret":"x","__proto__":{"polluted":true}');
  assert.match(text, /"__proto__"/);
  const read = readBackup(text);
  const first = read.state.collections[0].links[0];
  assert.equal('secret' in first, false);
  assert.equal(Object.hasOwn(first, '__proto__'), false);
  assert.equal(Object.getPrototypeOf(first), Object.prototype);
  assert.equal(first.polluted, undefined);
  assert.equal({}.polluted, undefined);
  assert.equal('color' in read.state.collections[0], false);
  assert.equal('undo' in read.state, false);
  assert.deepEqual(read.state.settings, { ...createState().settings, holdKey: 'q', holdOrigins: ['https://a.example'] });
});

test('merging into a fresh install joins the default collection by name and adds the rest', () => {
  const backup = createBackup(machineA(), { extensionVersion: '0.3.0' });
  const fresh = createState();
  const { state, summary } = planRestore(fresh, JSON.stringify(backup), 'merge');
  assert.deepEqual(state.collections.map((c) => c.name), ['My research', 'Admin'], 'no second My research');
  assert.equal(state.collections[0].id, fresh.collections[0].id, 'the local collection keeps its ID');
  assert.equal(state.activeCollectionId, fresh.activeCollectionId);
  assert.deepEqual(state.collections[0].links, backup.state.collections[0].links, 'links keep order and every field');
  assert.equal(state.collections[0].notes, 'Chapter 2', 'empty local notes take the backup notes');
  assert.deepEqual(state.collections[0].tags, ['thesis']);
  assert.deepEqual(state.collections[1], backup.state.collections[1], 'an added collection is kept exactly');
  assert.equal(state.settings.holdKey, 'z', 'single-value settings stay local');
  assert.equal(state.settings.holdScope, 'sites');
  assert.deepEqual(state.settings.holdOrigins, ['https://a.example']);
  assert.deepEqual(state.settings.holdExceptions, ['https://maps.example']);
  assert.deepEqual(summary, { mode: 'merge', backupCreatedAt: backup.createdAt, backupExtensionVersion: '0.3.0', collectionsInBackup: 2, linksInBackup: 3,
    collectionsAdded: 1, collectionsMatched: 1, linksAdded: 3, linksSkipped: 0, collectionsRemoved: 0, linksRemoved: 0, settingsChanged: ['holdOrigins', 'holdExceptions'] });
  const again = planRestore(state, backup, 'merge');
  assert.equal(again.summary.linksAdded, 0);
  assert.equal(again.summary.linksSkipped, 3);
  assert.equal(again.summary.collectionsAdded, 0);
  assert.deepEqual(again.state.collections, state.collections, 'restoring twice changes nothing');
});

test('merging keeps local names, notes, precedence and the undo snapshot', () => {
  const a = machineA();
  const backup = createBackup(a, { extensionVersion: '0.3.0' });
  let b = createState();
  b = reduceState(b, { type: 'collection.update', id: b.activeCollectionId, patch: { name: 'Mine', notes: 'Local notes', tags: ['local'] } });
  b = { ...b, collections: [{ ...b.collections[0], id: backup.state.collections[0].id }], activeCollectionId: backup.state.collections[0].id };
  b = reduceState(b, { type: 'links.append', links: [link('local-1'), link('a1', { notes: 'edited here' })] });
  b = reduceState(b, { type: 'settings.update', patch: { holdOrigins: ['https://maps.example'], holdTrigger: 'modifier' } });
  b = reduceState(b, { type: 'links.remove', ids: ['local-1'] });
  const input = deepFreeze(structuredClone(b));
  const { state, summary } = planRestore(input, backup, 'merge');
  const mine = state.collections[0];
  assert.equal(mine.name, 'Mine', 'joined by ID, local name kept');
  assert.equal(mine.notes, 'Local notes');
  assert.deepEqual(mine.tags, ['local', 'thesis']);
  assert.deepEqual(mine.links.map((x) => x.id), ['a1', 'a3']);
  assert.equal(mine.links[0].notes, 'edited here', 'an occurrence already here keeps local edits');
  assert.equal(summary.linksSkipped, 1);
  assert.deepEqual(state.undo, b.undo, 'the removal undo stays available');
  assert.equal(state.settings.holdTrigger, 'modifier');
  assert.deepEqual(state.settings.holdOrigins, ['https://maps.example', 'https://a.example']);
  assert.deepEqual(state.settings.holdExceptions, [], 'a local hold-drag site is not turned into an exception');
  const skipsUndo = planRestore(b, createBackup(reduceState(createState(), { type: 'links.append', links: [link('local-1')] })), 'merge');
  assert.equal(skipsUndo.summary.linksSkipped, 1, 'an occurrence held for Undo is not restored twice');
});

test('replacing restores the backup exactly and clears the removal undo', () => {
  const backup = createBackup(machineA(), { extensionVersion: '0.3.0' });
  let local = reduceState(createState(), { type: 'links.append', links: [link('x1'), link('x2')] });
  local = reduceState(local, { type: 'links.remove', ids: ['x1'] });
  const { state, summary } = planRestore(local, backup, 'replace');
  assert.deepEqual(state.collections, backup.state.collections);
  assert.equal(state.activeCollectionId, backup.state.activeCollectionId);
  assert.deepEqual(state.settings, backup.state.settings);
  assert.equal(state.undo, null);
  assert.equal(summary.collectionsRemoved, 1);
  assert.equal(summary.linksRemoved, 1);
  assert.equal(summary.linksAdded, 3);
  const seen = reduceState(local, { type: 'settings.update', patch: { welcomeSeen: true } });
  const unseen = createBackup(createState());
  assert.equal(planRestore(seen, unseen, 'replace').state.settings.welcomeSeen, true, 'the welcome card is not shown again');
});

test('the backup.restore action saves the planned state', () => {
  const backup = createBackup(machineA());
  const local = createState();
  assert.deepEqual(reduceState(local, { type: 'backup.restore', backup, mode: 'replace' }), planRestore(local, backup, 'replace').state);
  const merged = reduceState(local, { type: 'backup.restore', backup: JSON.stringify(backup), mode: 'merge' });
  assert.equal(merged.collections.length, 2);
  assert.throws(() => reduceState(local, { type: 'backup.restore', backup, mode: 'overwrite' }), /merge' or 'replace/);
  assert.throws(() => reduceState(local, { type: 'backup.restore', backup: { format: 'x' }, mode: 'merge' }), /not a Link Meteor backup/);
  assert.throws(() => planRestore(local, backup, 'append'), /merge' or 'replace/);
});
