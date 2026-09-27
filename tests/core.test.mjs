import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, reduceState, queryLinks, SETTINGS_DEFAULTS } from '../src/core/model.js';

const link = (id, overrides = {}) => ({
  id, anchorText: 'Paper', accessibleLabel: '', url: 'https://example.org/paper.pdf',
  originalHref: '/paper.pdf', sourceUrl: 'https://example.org/list',
  sourceTitle: 'Reading list', frameUrl: '', capturedAt: '2026-09-25T00:00:00.000Z',
  batchId: 'batch-1', notes: '', tags: [], ...overrides,
});

test('fresh state and collection lifecycle', () => {
  const initial = createState();
  assert.equal(initial.schemaVersion, 1);
  assert.equal(initial.collections.length, 1);
  assert.equal(initial.collections[0].name, 'My research');
  assert.equal(initial.activeCollectionId, initial.collections[0].id);
  assert.deepEqual(initial.settings, { ...SETTINGS_DEFAULTS, holdOrigins: [], holdExceptions: [] });
  const created = reduceState(initial, { type: 'collection.create', name: 'Sources' });
  assert.equal(created.collections.length, 2);
  assert.equal(initial.collections.length, 1);
  const updated = reduceState(created, { type: 'collection.update', id: created.activeCollectionId, patch: { notes: 'Work', tags: ['a'] } });
  assert.equal(updated.collections[1].notes, 'Work');
  assert.deepEqual(created.collections[1].tags, []);
  const activated = reduceState(updated, { type: 'collection.activate', id: initial.activeCollectionId });
  assert.equal(activated.activeCollectionId, initial.activeCollectionId);
  const deleted = reduceState(activated, { type: 'collection.delete', id: initial.activeCollectionId });
  assert.equal(deleted.activeCollectionId, created.activeCollectionId);
  assert.equal(reduceState(deleted, { type: 'collection.delete', id: deleted.activeCollectionId }).collections.length, 1);
});

test('append preserves occurrences, removal has one positional undo, updates are immutable', () => {
  const start = createState();
  const a = link('a');
  const b = link('b', { anchorText: 'Alternate', sourceUrl: 'https://other.org/list' });
  const c = link('c', { url: 'https://example.org/other' });
  const appended = reduceState(start, { type: 'links.append', links: [a, b, c] });
  assert.deepEqual(appended.collections[0].links.map(x => x.id), ['a', 'b', 'c']);
  assert.equal(start.collections[0].links.length, 0);
  const skipped = reduceState(appended, { type: 'links.append', links: [a] });
  assert.deepEqual(skipped.collections[0].links.map(x => x.id), ['a', 'b', 'c']);
  const removed = reduceState(appended, { type: 'links.remove', ids: ['a', 'c'] });
  assert.deepEqual(removed.collections[0].links.map(x => x.id), ['b']);
  assert.deepEqual(removed.undo.indices, [0, 2]);
  const cannotReuseUndoId = reduceState(removed, { type: 'links.append', links: [a] });
  assert.deepEqual(cannotReuseUndoId.collections[0].links.map(x => x.id), ['b']);
  const restored = reduceState(cannotReuseUndoId, { type: 'links.undo' });
  assert.deepEqual(restored.collections[0].links.map(x => x.id), ['a', 'b', 'c']);
  assert.equal(restored.undo, null);
  const noted = reduceState(restored, { type: 'link.update', id: 'b', patch: { notes: 'check', tags: ['review'] } });
  assert.equal(noted.collections[0].links[1].notes, 'check');
  assert.equal(restored.collections[0].links[1].notes, '');
  assert.deepEqual(appended.collections[0].links.map(x => x.anchorText), ['Paper', 'Alternate', 'Paper']);
});

test('filters and reversible dedup retain matched provenance', () => {
  const links = [
    link('a', { anchorText: 'Paper', tags: ['research'] }),
    link('b', { anchorText: 'Alternate', sourceUrl: 'https://other.org/list' }),
    link('c', { anchorText: 'Paper', sourceUrl: 'https://other.org/list' }),
    link('d', { anchorText: '', url: 'https://other.org/index.html', sourceUrl: 'not-a-url' }),
  ];
  const all = queryLinks(links, { dedupe: 'url' });
  assert.equal(all.matchedCount, 4);
  assert.equal(all.occurrenceCount, 4);
  assert.deepEqual(all.rows[0].occurrenceIds, ['a', 'b', 'c']);
  assert.deepEqual(all.rows[0].occurrences.map(x => x.sourceUrl), ['https://example.org/list', 'https://other.org/list', 'https://other.org/list']);
  assert.equal(queryLinks(links, { dedupe: 'url-anchor' }).rows.length, 3);
  assert.deepEqual(queryLinks(links, { search: 'research', dedupe: 'url' }).rows[0].occurrenceIds, ['a']);
  assert.deepEqual(queryLinks(links, { relation: 'internal' }).rows.map(x => x.id), ['a']);
  assert.deepEqual(queryLinks(links, { relation: 'external' }).rows.map(x => x.id), ['b', 'c']);
  assert.deepEqual(queryLinks(links, { fileType: 'pdf' }).rows.map(x => x.id), ['a', 'b', 'c']);
  assert.deepEqual(queryLinks(links, { domain: 'other.org' }).rows.map(x => x.id), ['d']);
  assert.deepEqual(links.map(x => x.id), ['a', 'b', 'c', 'd']);
});

test('invalid actions and payloads fail descriptively', () => {
  const state = createState();
  assert.throws(() => reduceState({ ...state, settings: undefined }, { type: 'collection.create', name: 'X' }), /settings/i);
  assert.throws(() => reduceState(state, { type: 'unknown' }), /unknown/i);
  assert.throws(() => reduceState(state, { type: 'links.append', links: [link('bad', { url: 'javascript:alert(1)' })] }), /url/i);
  assert.throws(() => reduceState(state, { type: 'settings.update', patch: { holdKey: 'ctrl' } }), /holdKey/i);
  assert.throws(() => reduceState(state, { type: 'collection.activate', id: 'missing' }), /collection/i);
  assert.throws(() => queryLinks([], { dedupe: 'invalid' }), /dedupe/i);
});

test('mixed web, email, and telephone destinations retain separate occurrences', () => {
  const state = createState();
  const mixed = [
    link('web'),
    link('email', { anchorText: 'Write us', url: 'mailto:team@example.org?subject=Plan(2026)' }),
    link('recipientless', { anchorText: 'Compose subject', url: 'mailto:?subject=Hello' }),
    link('empty-mailto', { anchorText: 'Compose', url: 'mailto:' }),
    link('phone', { anchorText: 'Call us', url: 'tel:+12125550123' }),
  ];
  const captured = reduceState(state, { type: 'links.append', links: mixed });
  assert.deepEqual(captured.collections[0].links.map(item => item.url), mixed.map(item => item.url));
  assert.deepEqual(queryLinks(captured.collections[0].links).rows.map(row => row.id), ['web', 'email', 'recipientless', 'empty-mailto', 'phone']);
  assert.equal(queryLinks(captured.collections[0].links, { relation: 'external' }).matchedCount, 0);
  assert.throws(() => reduceState(state, { type: 'links.append', links: [link('script', { url: 'javascript:alert(1)' })] }), /url/i);
  assert.throws(() => reduceState(state, { type: 'links.append', links: [link('data', { url: 'data:text/html,hi' })] }), /url/i);
  assert.throws(() => reduceState(state, { type: 'links.append', links: [link('empty-phone', { url: 'tel:' })] }), /url/i);
  assert.throws(() => reduceState(state, { type: 'links.append', links: [link('whitespace', { url: 'mailto:team@example.org\n' })] }), /url/i);
});
