// Page citations (0.5.0) in the background: what a reader sent becomes a stored PageCitation within
// the model's limits (src/background/citations.js), keyed by the page's address without its
// fragment. The readers themselves run in pages: tests/access-content.mjs checks them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createState, reduceState, MAX_AUTHORS, MAX_AUTHOR} from '../src/core/model.js';
import {citationEntry, citationPages, readCitationTags} from '../src/background/citations.js';

const READ_AT = '2026-09-29T12:00:00.000Z';
const append = (pages) => {
  const state = createState();
  return reduceState(state, {type: 'links.append', collectionId: state.activeCollectionId, links: [], pages});
};

test('the longest citation a reader can send is one the model keeps', () => {
  const longest = {title: 't'.repeat(300), authors: Array.from({length: MAX_AUTHORS}, (_, i) => `${i}`.padEnd(MAX_AUTHOR, 'a')), date: 'd'.repeat(40),
    journal: 'j'.repeat(300), publisher: 'p'.repeat(300), volume: 'v'.repeat(300), issue: 'i'.repeat(300), firstPage: 'f'.repeat(300), lastPage: 'l'.repeat(300),
    doi: '10.5555/' + 'x'.repeat(292), pmid: '123456789', arxiv: 'a'.repeat(300), isbn: 'b'.repeat(300), pdfUrl: 'https://a.test/' + 'q'.repeat(1985)};
  const entry = citationEntry(longest, READ_AT);
  assert.deepEqual(entry, {...longest, readAt: READ_AT}, 'nothing is cut at the limits');
  const state = append({'https://a.test/paper': entry});
  assert.deepEqual(state.collections[0].pages['https://a.test/paper'], entry);
});

test('text past the limits is cut or left out; unknown fields, odd types and non-web PDF addresses are left out', () => {
  const entry = citationEntry({title: `  ${'word '.repeat(80)}  `, authors: [...Array.from({length: 60}, (_, i) => `Author ${i}`), 'x'.repeat(201)], date: 'd'.repeat(41),
    journal: 'j'.repeat(301), volume: 'v'.repeat(301), issue: 7, pdfUrl: 'javascript:alert(1)', firstPage: ['1'], extra: 'dropped'}, READ_AT);
  assert.equal(entry.title.length, 300);
  assert.match(entry.title, /^word word .*…$/);
  assert.equal(entry.authors.length, 50);
  assert.equal(entry.journal, 'j'.repeat(299) + '…');
  assert.deepEqual(Object.keys(entry), ['title', 'authors', 'journal', 'readAt']);
  assert.ok(append({'https://a.test/': entry}), 'the model keeps it');
  assert.equal(citationEntry({authors: ['No title']}), null);
  assert.equal(citationEntry({title: '   '}), null);
  for (const odd of [null, undefined, 'A title', ['A title'], 42]) assert.equal(citationEntry(odd), null);
});

test('codes are kept as identifiers read them: a bare DOI, PubMed digits, an arXiv ID without its prefix', () => {
  const entry = citationEntry({title: 'Codes', doi: 'https://doi.org/10.1000/ABC.123.', pmid: 'PMID: 42', arxiv: 'arXiv:2101.00001v2', isbn: '978-0-262-03384-8'}, READ_AT);
  assert.deepEqual(entry, {title: 'Codes', doi: '10.1000/ABC.123', pmid: '42', arxiv: '2101.00001v2', isbn: '978-0-262-03384-8', readAt: READ_AT});
  assert.deepEqual(Object.keys(citationEntry({title: 'Not codes', doi: 'no DOI here', pmid: 'forty-two'}, READ_AT)), ['title', 'readAt']);
});

test('citationPages keys the citation by the page’s address without its fragment, for web pages only', () => {
  assert.deepEqual(citationPages({title: 'Paper'}, 'https://a.test/paper?id=1#results', READ_AT), {'https://a.test/paper?id=1': {title: 'Paper', readAt: READ_AT}});
  assert.deepEqual(citationPages({title: 'Paper'}, 'file:///paper.html', READ_AT), {});
  assert.deepEqual(citationPages({title: 'Paper'}, '', READ_AT), {});
  assert.deepEqual(citationPages(null, 'https://a.test/', READ_AT), {});
  assert.match(citationPages({title: 'Now'}, 'https://a.test/')['https://a.test/'].readAt, /^\d{4}-\d\d-\d\dT/);
});

test('readCitationTags stands alone, as chrome.scripting.executeScript needs, and gives null where there is no page', () => {
  assert.equal(readCitationTags.length, 0);
  // Without a document it gives no citation instead of throwing.
  assert.equal(readCitationTags(), null);
});
