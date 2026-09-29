// Research data (0.5.0): context, reading status, stars, imported labels and page citations, in
// the model, queries and backups. Data rules only; the workbench suites cover the UI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, reduceState, queryLinks, createBackup, readBackup, planRestore, pageKey, MAX_CONTEXT, MAX_PAGES, BACKUP_FORMAT_VERSION } from '../src/core/model.js';

const link = (id, extra = {}) => ({ id, anchorText: `Paper ${id}`, accessibleLabel: '', url: `https://doi.org/10.5555/${id}`, originalHref: '/', sourceUrl: 'https://review.example.net/articles/cooling#refs', sourceTitle: 'Cooling cities', frameUrl: '', capturedAt: '2026-09-29T00:00:00.000Z', batchId: 'b1', notes: '', tags: [], ...extra });
const citation = { title: 'Cooling cities: a review', authors: ['Okafor, Amara', '  Jun   Watanabe '], date: '2025/03/14', journal: 'Journal of Example Climate', doi: '10.5555/cool.2025.0007', readAt: '2026-09-29T00:00:00.000Z' };
function seeded(extraLinks = []) {
  let state = createState();
  const collectionId = state.activeCollectionId;
  state = reduceState(state, { type: 'links.append', collectionId, links: [link('a', { context: 'Across forty cities, Paper a found that…' }), link('b'), link('c', { imported: 'labs.csv, row 3' }), ...extraLinks],
    pages: { 'https://review.example.net/articles/cooling': citation } });
  return { state, collectionId };
}

test('new fields are optional, checked and normalized; a 0.4.0 state needs nothing', () => {
  const { state } = seeded();
  const [a, b, c] = state.collections[0].links;
  assert.equal(a.context, 'Across forty cities, Paper a found that…');
  assert.equal('context' in b || 'status' in b || 'starred' in b, false);
  assert.equal(c.imported, 'labs.csv, row 3');
  assert.deepEqual(state.collections[0].pages['https://review.example.net/articles/cooling'].authors, ['Okafor, Amara', 'Jun Watanabe'], 'names tidied');
  const append = (extra) => reduceState(state, { type: 'links.append', links: [link('z', extra)] });
  assert.throws(() => append({ context: 'x'.repeat(MAX_CONTEXT + 1) }), /context can be at most 400/);
  assert.throws(() => append({ status: 'done' }), /status must be 'reading' or 'read'/);
  assert.throws(() => append({ starred: 'yes' }), /starred must be true or false/);
  assert.equal('starred' in append({ starred: false }).collections[0].links.at(-1), false, 'false is stored as absent');
  assert.equal('context' in append({ context: '' }).collections[0].links.at(-1), false);
  assert.throws(() => reduceState(state, { type: 'links.append', links: [link('y')], pages: { 'https://x.example/a#b': {} } }), /invalid page address/);
  assert.throws(() => reduceState(state, { type: 'links.append', links: [link('y')], pages: { 'https://x.example/a': { title: 'T', color: 'red' } } }), /Unsupported pages entry field: color/);
  assert.equal(pageKey('https://review.example.net/articles/cooling#refs'), 'https://review.example.net/articles/cooling');
  assert.equal(pageKey('mailto:a@example.org'), '');
});

test('links.status and links.star change many links; clearing removes the field', () => {
  let { state, collectionId } = seeded();
  state = reduceState(state, { type: 'links.status', collectionId, ids: ['a', 'b'], status: 'read' });
  state = reduceState(state, { type: 'links.star', collectionId, ids: ['b'], starred: true });
  const byId = () => Object.fromEntries(state.collections[0].links.map((item) => [item.id, [item.status || '', !!item.starred]]));
  assert.deepEqual(byId(), { a: ['read', false], b: ['read', true], c: ['', false] });
  state = reduceState(state, { type: 'links.status', collectionId, ids: ['a'], status: '' });
  state = reduceState(state, { type: 'links.star', collectionId, ids: ['b'], starred: false });
  assert.deepEqual(byId(), { a: ['', false], b: ['read', false], c: ['', false] });
  assert.equal('status' in state.collections[0].links[0], false);
  assert.throws(() => reduceState(state, { type: 'links.status', collectionId, ids: ['a'], status: 'finished' }), /status must be/);
  assert.equal(reduceState(state, { type: 'links.star', collectionId, ids: ['nope'], starred: true }), state, 'no match, no change');
});

test('page citations merge, newer readings win, and at most MAX_PAGES are kept', () => {
  let { state, collectionId } = seeded();
  state = reduceState(state, { type: 'links.append', collectionId, links: [link('d')], pages: { 'https://review.example.net/articles/cooling': { ...citation, title: 'Cooling cities (revised)', readAt: '2026-09-30T00:00:00.000Z' } } });
  assert.equal(state.collections[0].pages['https://review.example.net/articles/cooling'].title, 'Cooling cities (revised)');
  // Pages arrive even when every link was already saved.
  const again = reduceState(state, { type: 'links.append', collectionId, links: [link('d')], pages: { 'https://other.example.org/p': { title: 'Other', readAt: '2026-10-01T00:00:00.000Z' } } });
  assert.equal(again.collections[0].pages['https://other.example.org/p'].title, 'Other');
  const many = Object.fromEntries(Array.from({ length: MAX_PAGES }, (_, i) => [`https://p.example.org/${i}`, { title: `P${i}`, readAt: `2026-10-02T00:00:${String(i % 60).padStart(2, '0')}.000Z` }]));
  const full = reduceState(state, { type: 'links.append', collectionId, links: [link('e')], pages: many });
  assert.equal(Object.keys(full.collections[0].pages).length, MAX_PAGES);
  assert.equal(full.collections[0].pages['https://review.example.net/articles/cooling'], undefined, 'the oldest reading went first');
});

test('queryLinks filters by reading status and stars, and searches context and imported labels', () => {
  let { state, collectionId } = seeded();
  state = reduceState(state, { type: 'links.status', collectionId, ids: ['b'], status: 'reading' });
  state = reduceState(state, { type: 'links.star', collectionId, ids: ['c'], starred: true });
  const ids = (options) => queryLinks(state.collections[0].links, options).rows.map((row) => row.id);
  assert.deepEqual(ids({ status: 'unread' }), ['a', 'c']);
  assert.deepEqual(ids({ status: 'reading' }), ['b']);
  assert.deepEqual(ids({ starred: true }), ['c']);
  assert.deepEqual(ids({ search: 'forty cities' }), ['a']);
  assert.deepEqual(ids({ search: 'labs.csv' }), ['c']);
  assert.throws(() => ids({ status: 'done' }), /Invalid status/);
  assert.deepEqual(ids({ typeGroup: 'Web pages' }), ['a', 'b', 'c'], 'the file-type groups Insights shows');
  assert.deepEqual(ids({ typeGroup: 'PDF' }), []);
});

test('backup format 3 keeps the new fields and only the page citations a link refers to', () => {
  let { state, collectionId } = seeded();
  state = reduceState(state, { type: 'links.status', collectionId, ids: ['a'], status: 'read' });
  state = reduceState(state, { type: 'links.star', collectionId, ids: ['a'], starred: true });
  state = reduceState(state, { type: 'links.append', collectionId, links: [link('f')], pages: { 'https://orphan.example.org/': { title: 'Nobody links here' } } });
  const backup = readBackup(JSON.stringify(createBackup(state, { extensionVersion: '0.5.0' })));
  assert.equal(backup.formatVersion, BACKUP_FORMAT_VERSION);
  const saved = backup.state.collections[0];
  assert.deepEqual([saved.links[0].status, saved.links[0].starred, saved.links[0].context, saved.links[2].imported], ['read', true, 'Across forty cities, Paper a found that…', 'labs.csv, row 3']);
  assert.deepEqual(Object.keys(saved.pages), ['https://review.example.net/articles/cooling'], 'the orphan is left out');
});

test('a merge keeps local status, stars and page citations, and adds the backup\'s new links with theirs', () => {
  let { state, collectionId } = seeded();
  state = reduceState(state, { type: 'links.star', collectionId, ids: ['a'], starred: true });
  const backup = structuredClone(createBackup(state, { extensionVersion: '0.5.0' }));
  const incoming = backup.state.collections[0];
  incoming.links[0].starred = undefined; delete incoming.links[0].starred; // the other computer never starred a
  incoming.links.push(link('g', { status: 'reading', starred: true }));
  incoming.pages['https://review.example.net/articles/cooling'] = { ...citation, title: 'Their reading' };
  const merged = planRestore(state, backup, 'merge').state.collections[0];
  assert.equal(merged.links.find((item) => item.id === 'a').starred, true, 'local star kept');
  assert.deepEqual([merged.links.find((item) => item.id === 'g').status, merged.links.find((item) => item.id === 'g').starred], ['reading', true]);
  assert.equal(merged.pages['https://review.example.net/articles/cooling'].title, 'Cooling cities: a review', 'the local reading kept');
});
