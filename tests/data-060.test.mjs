// The data 1.0.0 adds (src/core/model.js): a link's PDF page, where a citation was read, arXiv's
// version and category, the citation restore action, two settings, and backup format 4.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_FORMAT_VERSION, CITATION_SOURCES, MAX_PAGES, MAX_PDF_PAGES, SETTINGS_DEFAULTS, createBackup, createState, migrateState, planRestore, readBackup, reduceState, transferLinks } from '../src/core/model.js';

const link = (id, url, extra = {}) => ({ id, anchorText: id, accessibleLabel: '', url, originalHref: url, sourceUrl: 'https://arxiv.org/pdf/2409.11211v1', sourceTitle: 'SplatFields', frameUrl: '', capturedAt: '2026-10-02T10:00:00.000Z', batchId: 'b1', notes: '', tags: [], ...extra });
const PDF = 'https://arxiv.org/pdf/2409.11211v1';
const fromPdf = { title: 'SplatFields', arxiv: '2409.11211', arxivVersion: 'v1', arxivCategory: 'cs.CV', date: '17 Sep 2024', pdfUrl: PDF, source: 'pdf', readAt: '2026-10-02T10:00:00.000Z' };
const home = (state) => state.collections.find((item) => item.id === state.activeCollectionId);

test('a link read from a PDF keeps its page; other values are refused', () => {
  const state = reduceState(createState(), { type: 'links.append', links: [link('a', 'https://a.example/', { pdfPage: 3 }), link('b', 'https://b.example/')], pages: { [PDF]: fromPdf } });
  assert.deepEqual(home(state).links.map((item) => item.pdfPage), [3, undefined]);
  for (const pdfPage of [0, -1, 1.5, '3', MAX_PDF_PAGES + 1, null]) assert.throws(() => reduceState(createState(), { type: 'links.append', links: [link('c', 'https://c.example/', { pdfPage })] }), /pdfPage must be a page number from 1 to 2,000/, String(pdfPage));
  assert.equal(reduceState(createState(), { type: 'links.append', links: [link('d', 'https://d.example/', { pdfPage: MAX_PDF_PAGES })] }).collections[0].links[0].pdfPage, MAX_PDF_PAGES);
});

test('a citation says where it was read, and keeps arXiv’s version and category', () => {
  const state = reduceState(createState(), { type: 'links.append', links: [link('a', 'https://a.example/', { pdfPage: 1 })], pages: { [PDF]: fromPdf } });
  assert.deepEqual(home(state).pages[PDF], fromPdf);
  assert.deepEqual(CITATION_SOURCES, ['pdf', 'crossref', 'datacite', 'pubmed']);
  assert.throws(() => reduceState(createState(), { type: 'links.append', links: [], pages: { [PDF]: { ...fromPdf, source: 'the internet' } } }), /source must be one of pdf, crossref, datacite, pubmed/);
  assert.throws(() => reduceState(createState(), { type: 'links.append', links: [], pages: { [PDF]: { ...fromPdf, arxivVersion: 'version-one' } } }), /arxivVersion can be at most 8 characters/);
});

test('a page’s own tags are never replaced by what a PDF or a lookup said, and gaps are filled', () => {
  const tags = { title: 'From the Page’s Tags', authors: ['Mihajlovic, Marko'], readAt: '2026-10-01T00:00:00.000Z' };
  let state = reduceState(createState(), { type: 'links.append', links: [link('a', PDF)], pages: { [PDF]: tags } });
  state = reduceState(state, { type: 'links.append', links: [], pages: { [PDF]: fromPdf } });
  assert.deepEqual(home(state).pages[PDF], { arxiv: '2409.11211', arxivVersion: 'v1', arxivCategory: 'cs.CV', date: '17 Sep 2024', pdfUrl: PDF, title: 'From the Page’s Tags', authors: ['Mihajlovic, Marko'], readAt: '2026-10-01T00:00:00.000Z',
    filled: { arxiv: 'pdf', arxivVersion: 'pdf', arxivCategory: 'pdf', date: 'pdf', pdfUrl: 'pdf' } });
  // The other way around: the PDF was read first, then the page's tags.
  let later = reduceState(createState(), { type: 'links.append', links: [link('a', PDF)], pages: { [PDF]: fromPdf } });
  later = reduceState(later, { type: 'links.append', links: [], pages: { [PDF]: tags } });
  assert.equal(home(later).pages[PDF].title, 'From the Page’s Tags');
  assert.equal(home(later).pages[PDF].arxivCategory, 'cs.CV', 'what only the PDF knew is kept');
  assert.equal(home(later).pages[PDF].source, undefined);
  assert.equal(home(later).pages[PDF].filled.arxivCategory, 'pdf', 'and marked as the PDF’s');
});

test('pages.restore sets or removes citations exactly, for a lookup’s Undo', () => {
  const other = 'https://doi.org/10.1/x';
  let state = reduceState(createState(), { type: 'links.append', links: [link('a', PDF), link('b', other)], pages: { [PDF]: fromPdf } });
  const before = { [PDF]: home(state).pages[PDF], [other]: null };
  state = reduceState(state, { type: 'links.append', links: [], pages: { [PDF]: { title: 'Looked Up', authors: ['Ada, A'], source: 'datacite', readAt: 'now' }, [other]: { title: 'Other', source: 'crossref', readAt: 'now' } } });
  assert.equal(home(state).pages[PDF].title, 'Looked Up');
  state = reduceState(state, { type: 'pages.restore', pages: before });
  assert.deepEqual(home(state).pages, { [PDF]: fromPdf }, 'back to exactly what was there');
  assert.throws(() => reduceState(state, { type: 'pages.restore', pages: { 'not an address': null } }), /invalid page address/);
  assert.throws(() => reduceState(state, { type: 'pages.restore', pages: { [PDF]: { title: 7 } } }), /must be text/);
  assert.throws(() => reduceState(state, { type: 'pages.restore', pages: [] }), /pages must be an object/);
});

test('two settings: how far Follow Next goes, and the lookup, which is off', () => {
  assert.equal(SETTINGS_DEFAULTS.followPages, 20);
  assert.equal(SETTINGS_DEFAULTS.lookupDetails, false);
  // A 0.5.0 state gains both defaults, and the lookup stays off.
  const old = createState(); delete old.settings.followPages; delete old.settings.lookupDetails;
  const migrated = migrateState(old);
  assert.deepEqual([migrated.settings.followPages, migrated.settings.lookupDetails], [20, false]);
  const set = (patch) => reduceState(createState(), { type: 'settings.update', patch }).settings;
  assert.equal(set({ followPages: 2 }).followPages, 2);
  assert.equal(set({ lookupDetails: true }).lookupDetails, true);
  for (const followPages of [1, 21, 2.5, '5', null]) assert.throws(() => set({ followPages }), /followPages must be a whole number from 2 to 20/, String(followPages));
  assert.throws(() => set({ lookupDetails: 'yes' }), /lookupDetails must be true or false/);
});

test('a merge keeps every local page citation as it is, whatever it was read from, and adds only the backup’s other pages', () => {
  const lookup = { title: 'Looked Up', authors: ['Mihajlovic, Marko'], source: 'datacite', readAt: '2026-10-20T00:00:00.000Z' };
  const tags = { title: 'From the Page’s Tags', journal: 'ECCV', readAt: '2026-10-01T00:00:00.000Z' };
  const OTHER = 'https://b.example/', NEW = 'https://c.example/';
  // [local, backup] for the PDF's address: a weaker local reading, the same kind of reading, and a stronger one.
  for (const [local, theirs] of [[fromPdf, tags], [fromPdf, lookup], [lookup, tags], [lookup, { ...lookup, title: 'Their Lookup', journal: 'J' }], [tags, { ...tags, title: 'Their Tags' }], [tags, fromPdf]]) {
    const here = reduceState(createState(), { type: 'links.append', links: [link('a', PDF)], pages: { [PDF]: local } });
    for (const extra of [[], [link('b', OTHER)]]) {
      // The backup has the same link, sometimes one more, and its own reading of the same page.
      const there = reduceState(createState(), { type: 'links.append', links: [link('a', PDF), ...extra], pages: { [PDF]: theirs } });
      const merged = home(planRestore(here, createBackup(there, { extensionVersion: '1.0.0' }), 'merge').state);
      assert.deepEqual(merged.pages, { [PDF]: local }, `local ${local.source || 'tags'} against the backup’s ${theirs.source || 'tags'}, ${extra.length ? 'with' : 'without'} a new link`);
    }
  }
  // A page only the backup knows (here, the link's source page) is added, even when nothing else changes.
  const here = reduceState(createState(), { type: 'links.append', links: [link('a', PDF, { sourceUrl: NEW })], pages: { [PDF]: lookup } });
  const there = reduceState(createState(), { type: 'links.append', links: [link('a', PDF, { sourceUrl: NEW })], pages: { [PDF]: tags, [NEW]: tags } });
  assert.deepEqual(home(planRestore(here, createBackup(there, { extensionVersion: '1.0.0' }), 'merge').state).pages, { [NEW]: tags, [PDF]: lookup });
});

test('a merge that changes only which pages are kept is saved: the pages are compared, not counted', () => {
  const at = (i) => new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString();
  const full = Object.fromEntries(Array.from({ length: MAX_PAGES }, (_, i) => [`https://p.example.org/${i}`, { title: `P${i}`, readAt: at(i) }]));
  const NEW = 'https://new.example/';
  const here = reduceState(createState(), { type: 'links.append', links: [link('a', PDF, { sourceUrl: NEW })], pages: full });
  // The backup holds the same link and one newer page: the oldest local reading makes room for it.
  const there = reduceState(createState(), { type: 'links.append', links: [link('a', PDF, { sourceUrl: NEW })], pages: { [NEW]: { title: 'Newer', readAt: '2026-10-25T00:00:00.000Z' } } });
  const pages = home(planRestore(here, createBackup(there, { extensionVersion: '1.0.0' }), 'merge').state).pages;
  assert.equal(Object.keys(pages).length, MAX_PAGES);
  assert.equal(pages[NEW].title, 'Newer');
  assert.equal(pages['https://p.example.org/0'], undefined, 'the oldest reading made room');
});

test('backup format 4 keeps the new fields, and a restore brings them back', () => {
  let state = reduceState(createState(), { type: 'settings.update', patch: { followPages: 7, lookupDetails: true } });
  state = reduceState(state, { type: 'links.append', links: [link('a', 'https://a.example/', { pdfPage: 12, context: 'Words on the line.' })], pages: { [PDF]: fromPdf } });
  const backup = createBackup(state, { extensionVersion: '1.0.0' });
  assert.equal(BACKUP_FORMAT_VERSION, 4);
  assert.equal(backup.formatVersion, 4);
  assert.equal(backup.state.collections[0].links[0].pdfPage, 12);
  assert.deepEqual(backup.state.collections[0].pages[PDF], fromPdf);
  assert.deepEqual([backup.state.settings.followPages, backup.state.settings.lookupDetails], [7, true]);
  const restored = planRestore(createState(), JSON.stringify(backup), 'replace').state;
  assert.equal(home(restored).links[0].pdfPage, 12);
  assert.deepEqual(home(restored).pages[PDF], fromPdf);
  // An older release refuses a format it doesn't know, with the update message, instead of dropping fields.
  assert.throws(() => readBackup(JSON.stringify({ ...backup, formatVersion: 5 })), /newer version of Link Meteor \(backup format 5\)/);
  assert.throws(() => readBackup(JSON.stringify({ ...backup, state: { ...backup.state, collections: [{ ...backup.state.collections[0], links: [{ ...backup.state.collections[0].links[0], pdfPage: 0 }] }] } })), /pdfPage/);
});

test('moving a PDF’s links takes their pages and the PDF’s citation along', () => {
  let state = reduceState(createState(), { type: 'links.append', links: [link('a', 'https://a.example/', { pdfPage: 2 }), link('b', 'https://b.example/', { pdfPage: 5 })], pages: { [PDF]: fromPdf } });
  const from = state.activeCollectionId;
  const moved = transferLinks(state, { fromCollectionId: from, ids: ['a', 'b'], mode: 'move', newCollection: 'Reading' });
  const target = moved.state.collections.find((item) => item.name === 'Reading');
  assert.deepEqual(target.links.map((item) => item.pdfPage), [2, 5]);
  assert.deepEqual(target.pages[PDF], fromPdf);
});
