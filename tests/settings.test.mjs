// Additive schema-v1 settings for 0.3.0: defaults, validation and the migration of stored
// 0.2.x states. The 0.2.2 reducer is loaded from the packaged 0.2.2 ZIP to show that it keeps
// the new fields when it writes, which is why the schema version stays 1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createState, migrateState, reduceState, SETTINGS_DEFAULTS, MAX_HOLD_EXCEPTIONS } from '../src/core/model.js';
import { fileNamePart } from '../src/core/export.js';
import { readPackagedMembers } from '../scripts/verify-package.mjs';

const root = resolve(import.meta.dirname, '..');
const link = (id, overrides = {}) => ({
  id, anchorText: 'Paper', accessibleLabel: '', url: 'https://example.org/paper.pdf',
  originalHref: '/paper.pdf', sourceUrl: 'https://example.org/list', sourceTitle: 'Reading list',
  frameUrl: '', capturedAt: '2026-09-25T00:00:00.000Z', batchId: 'batch-1', notes: '', tags: [], ...overrides,
});
// A state exactly as 0.2.2 stores it: two settings fields, a removal undo snapshot, empty anchors.
const stored022 = () => ({
  schemaVersion: 1, activeCollectionId: 'c1',
  collections: [
    { id: 'c1', name: 'My research', notes: 'Chapter 2', tags: ['thesis'], createdAt: '2026-09-20T10:00:00.000Z', updatedAt: '2026-09-25T10:00:00.000Z',
      links: [link('a'), link('b', { anchorText: '', accessibleLabel: 'Open appendix', url: 'mailto:team@example.org' })] },
    { id: 'c2', name: 'Admin', notes: '', tags: [], createdAt: '2026-09-21T10:00:00.000Z', updatedAt: '2026-09-21T10:00:00.000Z', links: [] },
  ],
  settings: { holdKey: 'r', holdOrigins: ['https://en.wikipedia.org'] },
  undo: { collectionId: 'c1', links: [link('removed', { anchorText: '=SUM(1)' })], indices: [1] },
});

test('a fresh state has every setting at its default, with its own lists', () => {
  const state = createState();
  assert.equal(state.schemaVersion, 1);
  assert.deepEqual(Object.keys(state.settings), Object.keys(SETTINGS_DEFAULTS));
  assert.equal(state.settings.holdKey, 'z');
  assert.equal(state.settings.holdTrigger, 'letter');
  assert.equal(state.settings.holdScope, 'sites');
  assert.equal(state.settings.welcomeSeen, false);
  assert.deepEqual([state.settings.exportPrefix, state.settings.exportTimestamp, state.settings.exportTimestampFormat], ['', true, 'datetime']);
  assert.notEqual(state.settings.holdExceptions, SETTINGS_DEFAULTS.holdExceptions);
  assert.equal(Object.isFrozen(state.settings.holdOrigins), false);
});

test('migration fills only absent settings and keeps stored 0.2.2 data exactly', () => {
  const before = stored022();
  const snapshot = structuredClone(before);
  const migrated = migrateState(before);
  assert.deepEqual(before, snapshot, 'input is not changed');
  assert.equal(migrated.collections, before.collections, 'collections are the same objects');
  assert.equal(migrated.undo, before.undo);
  assert.deepEqual(migrated.collections, snapshot.collections);
  assert.deepEqual(migrated.settings, { ...SETTINGS_DEFAULTS, holdKey: 'r', holdOrigins: ['https://en.wikipedia.org'], holdExceptions: [] });
  assert.equal(migrateState(migrated), migrated, 'an up-to-date state is returned unchanged');
  const partial = migrateState({ ...before, settings: { ...before.settings, holdScope: 'all', welcomeSeen: true } });
  assert.equal(partial.settings.holdScope, 'all');
  assert.equal(partial.settings.welcomeSeen, true);
  assert.equal(partial.settings.exportTimestamp, true);
});

test('reducers accept a stored 0.2.2 state and write the migrated shape', () => {
  const before = stored022();
  const next = reduceState(before, { type: 'collection.create', name: 'New' });
  assert.deepEqual(next.collections.slice(0, 2), before.collections);
  assert.deepEqual(next.undo, before.undo);
  assert.equal(next.settings.holdTrigger, 'letter');
  assert.deepEqual(next.settings.holdOrigins, ['https://en.wikipedia.org']);
  const undone = reduceState(before, { type: 'links.undo' });
  assert.deepEqual(undone.collections[0].links.map((item) => item.id), ['a', 'removed', 'b']);
  assert.throws(() => migrateState({ ...before, schemaVersion: 2 }), /version 1/);
  assert.throws(() => reduceState({ ...before, settings: undefined }, { type: 'collection.create', name: 'X' }), /settings/i);
});

test('the packaged 0.2.2 reducer keeps 0.3.0 settings when it writes', async () => {
  const zip = await readFile(join(root, 'artifacts/link-meteor-0.2.2.zip'));
  await mkdir(join(root, '.scratch'), { recursive: true });
  const temp = await mkdtemp(join(root, '.scratch/model-022-'));
  try {
    await writeFile(join(temp, 'model.mjs'), readPackagedMembers(zip).get('core/model.js'));
    const old = await import(pathToFileURL(join(temp, 'model.mjs')).href);
    const current = reduceState(stored022(), { type: 'settings.update', patch: { holdScope: 'all', holdTrigger: 'modifier', holdExceptions: ['https://maps.example'], welcomeSeen: true, exportPrefix: 'link-meteor-research' } });
    let written = old.reduceState(current, { type: 'settings.update', patch: { holdKey: 'q' } });
    written = old.reduceState(written, { type: 'links.append', collectionId: 'c2', links: [link('from-022')] });
    written = old.reduceState(written, { type: 'collection.create', name: 'Made in 0.2.2' });
    for (const key of ['holdScope', 'holdTrigger', 'holdExceptions', 'welcomeSeen', 'exportPrefix', 'exportTimestamp', 'exportTimestampFormat']) {
      assert.deepEqual(written.settings[key], current.settings[key], `0.2.2 kept ${key}`);
    }
    assert.equal(written.settings.holdKey, 'q');
    assert.equal(written.schemaVersion, 1);
    const reread = reduceState(written, { type: 'collection.activate', id: 'c1' });
    assert.equal(reread.settings.holdScope, 'all');
    assert.deepEqual(reread.collections[1].links.map((item) => item.id), ['from-022']);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('settings.update validates every new field', () => {
  const state = createState();
  const set = (patch) => reduceState(state, { type: 'settings.update', patch }).settings;
  assert.equal(set({ holdKey: 'Q' }).holdKey, 'q');
  assert.throws(() => set({ holdKey: 'mod' }), /holdKey/);
  assert.throws(() => set({ holdKey: 'Meta' }), /holdKey/);
  assert.equal(set({ holdTrigger: 'modifier' }).holdTrigger, 'modifier');
  assert.equal(set({ holdTrigger: 'modifier' }).holdKey, 'z', 'the letter is kept for switching back');
  assert.throws(() => set({ holdTrigger: 'alt' }), /holdTrigger/);
  assert.equal(set({ holdScope: 'all' }).holdScope, 'all');
  assert.throws(() => set({ holdScope: 'everywhere' }), /holdScope/);
  assert.deepEqual(set({ holdExceptions: ['https://maps.example', 'https://maps.example', 'http://localhost:8080'] }).holdExceptions, ['https://maps.example', 'http://localhost:8080']);
  assert.throws(() => set({ holdExceptions: ['https://maps.example/path'] }), /holdExceptions entry/);
  assert.throws(() => set({ holdExceptions: ['chrome://settings'] }), /holdExceptions entry/);
  assert.throws(() => set({ holdExceptions: 'https://maps.example' }), /array/);
  const many = Array.from({ length: MAX_HOLD_EXCEPTIONS + 1 }, (_, i) => `https://site${i}.example`);
  assert.throws(() => set({ holdExceptions: many }), /at most 1000/);
  assert.equal(set({ holdExceptions: many.slice(1) }).holdExceptions.length, MAX_HOLD_EXCEPTIONS);
  assert.equal(set({ welcomeSeen: true }).welcomeSeen, true);
  assert.throws(() => set({ welcomeSeen: 'yes' }), /welcomeSeen/);
  assert.equal(set({ exportTimestamp: false }).exportTimestamp, false);
  assert.throws(() => set({ exportTimestamp: 0 }), /exportTimestamp/);
  assert.equal(set({ exportTimestampFormat: 'date' }).exportTimestampFormat, 'date');
  assert.throws(() => set({ exportTimestampFormat: 'time' }), /exportTimestampFormat/);
  assert.throws(() => set({ theme: 'ember' }), /Unsupported settings field: theme/);
});

test('export prefixes must already be safe file-name parts', () => {
  const state = createState();
  const set = (exportPrefix) => reduceState(state, { type: 'settings.update', patch: { exportPrefix } }).settings.exportPrefix;
  for (const prefix of ['', 'link-meteor-research', 'thesis_2026', 'v1.2', '研究']) {
    assert.equal(set(prefix), prefix);
    assert.equal(fileNamePart(prefix, 40), prefix);
  }
  for (const prefix of ['has space', 'a/b', 'trailing-', '.hidden', 'Résumé', 'x'.repeat(41), 42]) {
    assert.throws(() => set(prefix), /exportPrefix/, String(prefix));
  }
  // The Export settings can store whatever fileNamePart makes of typed text.
  assert.equal(set(fileNamePart('  My research: 2026 ', 40)), 'My-research-2026');
});

test('a site cannot be both a hold-drag site and an exception', () => {
  const state = reduceState(createState(), { type: 'settings.update', patch: { holdOrigins: ['https://a.example'] } });
  assert.throws(() => reduceState(state, { type: 'settings.update', patch: { holdExceptions: ['https://a.example'] } }), /both a hold-drag site and an exception/);
  const moved = reduceState(state, { type: 'settings.update', patch: { holdOrigins: [], holdExceptions: ['https://a.example'] } });
  assert.deepEqual([moved.settings.holdOrigins, moved.settings.holdExceptions], [[], ['https://a.example']]);
  assert.throws(() => reduceState({ ...state, settings: { ...state.settings, holdExceptions: ['https://a.example'] } }, { type: 'collection.create', name: 'X' }), /both/);
});

test('invalid stored values are reported, not replaced', () => {
  const state = createState();
  for (const [key, value] of [['holdScope', 'everywhere'], ['holdTrigger', 'shift'], ['welcomeSeen', 1], ['exportTimestampFormat', ''], ['holdExceptions', ['not a url']]]) {
    assert.throws(() => reduceState({ ...state, settings: { ...state.settings, [key]: value } }, { type: 'collection.create', name: 'X' }), new RegExp(`settings\\.${key}`));
  }
});

test('unknown settings fields from a later version are kept through writes', () => {
  const later = { ...createState(), settings: { ...createState().settings, theme: 'ember' } };
  const next = reduceState(later, { type: 'settings.update', patch: { holdKey: 'x' } });
  assert.equal(next.settings.theme, 'ember');
});
