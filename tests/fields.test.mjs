// Custom columns (0.4.0): per collection, named, filled in by hand, plain text. Data rules only;
// the workbench suites cover the UI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, reduceState, queryLinks, createBackup, readBackup, planRestore, MAX_CUSTOM_FIELDS, MAX_FIELD_VALUE } from '../src/core/model.js';

const link = (id, extra = {}) => ({ id, anchorText: `Lab ${id}`, accessibleLabel: '', url: `https://${id}.example/`, originalHref: '/', sourceUrl: 'https://list.example/', sourceTitle: 'Labs', frameUrl: '', capturedAt: '2026-09-28T00:00:00.000Z', batchId: 'b1', notes: '', tags: [], ...extra });
function withColumns(names = ['Principal investigator', 'Deadline']) {
  let state = createState();
  const collectionId = state.activeCollectionId;
  state = reduceState(state, { type: 'links.append', collectionId, links: [link('a'), link('b'), link('c')] });
  for (const name of names) state = reduceState(state, { type: 'fields.add', collectionId, name });
  return { state, collectionId, fields: state.collections[0].fields };
}

test('a 0.3.0 state has no custom columns and needs no migration', () => {
  const state = createState();
  assert.equal('fields' in state.collections[0], false);
  assert.deepEqual(reduceState(state, { type: 'collection.update', id: state.activeCollectionId, patch: { notes: 'x' } }).collections[0].fields, undefined);
});

test('columns are added, named, renamed and limited', () => {
  const { state, collectionId, fields } = withColumns();
  assert.deepEqual(fields.map((field) => field.name), ['Principal investigator', 'Deadline']);
  assert.match(fields[0].id, /^f-/);
  assert.throws(() => reduceState(state, { type: 'fields.add', collectionId, name: 'deadline' }), /Two custom columns are named/);
  assert.throws(() => reduceState(state, { type: 'fields.add', collectionId, name: '   ' }), /nonempty/);
  assert.throws(() => reduceState(state, { type: 'fields.add', collectionId, name: 'x'.repeat(61) }), /at most 60/);
  const renamed = reduceState(state, { type: 'fields.rename', collectionId, fieldId: fields[1].id, name: '  Application   deadline ' });
  assert.equal(renamed.collections[0].fields[1].name, 'Application deadline');
  let many = withColumns([]).state;
  for (let i = 0; i < MAX_CUSTOM_FIELDS; i++) many = reduceState(many, { type: 'fields.add', collectionId: many.activeCollectionId, name: `Column ${i}` });
  assert.throws(() => reduceState(many, { type: 'fields.add', collectionId: many.activeCollectionId, name: 'One more' }), /at most 20 custom columns/);
});

test('values are set per link, filled on many, searched, and removed with their column', () => {
  const { state, collectionId, fields } = withColumns();
  const [pi, due] = fields.map((field) => field.id);
  let next = reduceState(state, { type: 'link.update', collectionId, id: 'a', patch: { fields: { [pi]: 'Dr. Rivera' } } });
  assert.deepEqual(next.collections[0].links[0].fields, { [pi]: 'Dr. Rivera' });
  assert.throws(() => reduceState(next, { type: 'link.update', collectionId, id: 'a', patch: { fields: { 'f-other': 'x' } } }), /No custom column/);
  assert.throws(() => reduceState(next, { type: 'link.update', collectionId, id: 'a', patch: { fields: { [pi]: 'x'.repeat(MAX_FIELD_VALUE + 1) } } }), /at most 2,000/);
  next = reduceState(next, { type: 'fields.fill', collectionId, fieldId: due, ids: ['a', 'b'], value: 'March 1' });
  assert.deepEqual(next.collections[0].links.map((item) => item.fields?.[due] ?? ''), ['March 1', 'March 1', '']);
  assert.deepEqual(queryLinks(next.collections[0].links, { search: 'rivera' }).rows.map((row) => row.id), ['a']);
  // An emptied value is dropped, and a link with no values has no fields object.
  const cleared = reduceState(next, { type: 'link.update', collectionId, id: 'b', patch: { fields: { [due]: '' } } });
  assert.equal('fields' in cleared.collections[0].links[1], false);
  // Removing a column removes its values; restore puts both back at the same place.
  const removed = reduceState(next, { type: 'fields.remove', collectionId, fieldId: due });
  assert.deepEqual(removed.collections[0].fields.map((field) => field.id), [pi]);
  assert.equal(removed.collections[0].links[1].fields, undefined);
  const restored = reduceState(removed, { type: 'fields.restore', collectionId, field: fields[1], index: 1, values: { a: 'March 1', b: 'March 1' } });
  assert.deepEqual(restored.collections[0].fields, fields);
  assert.deepEqual(restored.collections[0].links.map((item) => item.fields?.[due] ?? ''), ['March 1', 'March 1', '']);
});

test('stored values are checked: only column ids as keys, and orphans are tolerated', () => {
  const { state, fields } = withColumns();
  const orphan = structuredClone(state);
  orphan.collections[0].links[0].fields = { 'f-gone': 'kept but unused' };
  assert.doesNotThrow(() => reduceState(orphan, { type: 'collection.activate', id: orphan.activeCollectionId }));
  const polluted = JSON.parse(JSON.stringify(state).replace('"batchId":"b1"', '"batchId":"b1","fields":{"__proto__":{"x":1}}'));
  assert.throws(() => reduceState(polluted, { type: 'collection.activate', id: polluted.activeCollectionId }), /invalid column id/);
  assert.equal({}.x, undefined);
  void fields;
});

test('backups keep columns and values; merge joins columns by name and remaps values', () => {
  const { state, collectionId, fields } = withColumns();
  const [pi] = fields.map((field) => field.id);
  const filled = reduceState(state, { type: 'link.update', collectionId, id: 'a', patch: { fields: { [pi]: 'Dr. Rivera' } } });
  const backup = readBackup(JSON.stringify(createBackup(filled, { extensionVersion: '0.4.0' })));
  assert.deepEqual(backup.state.collections[0].fields, fields);
  assert.deepEqual(backup.state.collections[0].links[0].fields, { [pi]: 'Dr. Rivera' });
  // Another computer: same collection name, a column of the same name (different id), and new links.
  let other = createState();
  other = reduceState(other, { type: 'fields.add', collectionId: other.activeCollectionId, name: 'principal INVESTIGATOR' });
  const otherPi = other.collections[0].fields[0].id;
  const fresh = structuredClone(backup);
  fresh.state.collections[0].links = [link('z', { fields: { [pi]: 'Dr. Okafor' } })];
  const { state: merged, summary } = planRestore(other, fresh, 'merge');
  const collection = merged.collections.find((item) => item.name === 'My research');
  assert.deepEqual(collection.fields.map((field) => field.name), ['principal INVESTIGATOR', 'Deadline']);
  assert.deepEqual(collection.links.find((item) => item.id === 'z').fields, { [otherPi]: 'Dr. Okafor' });
  assert.equal(summary.fieldsAdded, 1);
  // Replace takes the backup's columns exactly.
  assert.deepEqual(planRestore(other, backup, 'replace').state.collections[0].fields, fields);
});
