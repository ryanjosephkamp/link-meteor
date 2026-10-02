// Page details lookup (0.6.0): which request an identifier needs, and each service's answer as a
// page citation, from recorded answers (tests/fixtures/lookup). No test contacts a service;
// tests/lookup-browser.mjs runs the sandboxed frame with the test answering in the services' place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createState, mergeCitation, reduceState } from '../src/core/model.js';
import { LOOKUP_SERVICES, filled, lookupAllowed, lookupRequests, lookupUrl, plainText, readAnswer, readCrossref, readDatacite, readPubmed } from '../src/core/lookup.js';

const root = resolve(import.meta.dirname, '..');
const recorded = (name) => readFile(resolve(root, 'tests/fixtures/lookup', name), 'utf8');
const json = async (name) => JSON.parse(await recorded(name));

test('each identifier goes to one service, with nothing but the identifier in the address', () => {
  assert.deepEqual(lookupRequests({ doi: '10.1371/journal.pmed.0020124', pmid: '16060722' }), [
    { service: 'crossref', identifier: '10.1371/journal.pmed.0020124', url: 'https://api.crossref.org/works/10.1371%2Fjournal.pmed.0020124' },
    { service: 'datacite', identifier: '10.1371/journal.pmed.0020124', url: 'https://api.datacite.org/dois/10.1371%2Fjournal.pmed.0020124' },
  ], 'a DOI: Crossref, then DataCite if Crossref doesn’t have it; the PubMed ID isn’t needed');
  assert.deepEqual(lookupRequests({ arxiv: '2409.11211v1' }), [{ service: 'datacite', identifier: '10.48550/arXiv.2409.11211', url: 'https://api.datacite.org/dois/10.48550%2FarXiv.2409.11211' }]);
  assert.deepEqual(lookupRequests({ doi: '10.48550/arXiv.2409.11211', arxiv: '2409.11211' }).map((request) => request.service), ['datacite'], 'arXiv’s own DOI goes straight to DataCite');
  assert.deepEqual(lookupRequests({ arxiv: 'hep-th/9901001' })[0].identifier, '10.48550/arXiv.hep-th/9901001');
  assert.deepEqual(lookupRequests({ pmid: '16060722' }), [{ service: 'pubmed', identifier: '16060722', url: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=16060722' }]);
  assert.deepEqual(lookupRequests({ isbn: '9780262033848', pmcid: 'PMC1182327' }), [], 'nothing to look up without a DOI, an arXiv ID or a PubMed ID');
  assert.deepEqual(lookupRequests(), []);
});

test('only the three services, and only identifiers of the right shape', () => {
  assert.deepEqual(Object.values(LOOKUP_SERVICES).map((service) => service.host), ['api.crossref.org', 'api.datacite.org', 'eutils.ncbi.nlm.nih.gov']);
  assert.equal(lookupAllowed('crossref', '10.1234/abc'), true);
  for (const [service, identifier] of [['crossref', 'https://evil.example/'], ['crossref', '10.1234/a b'], ['crossref', ''], ['pubmed', '12a'], ['pubmed', '1234567890'], ['pubmed', '1&db=other'], ['wayback', '10.1234/abc'], ['__proto__', '1'], ['crossref', '10.1234/' + 'x'.repeat(300)], ['crossref', 1012]]) {
    assert.equal(lookupAllowed(service, identifier), false, `${service} ${identifier}`);
    assert.equal(lookupUrl(service, identifier), '');
  }
  // An identifier can't change the address's shape: it is one encoded path or query part.
  assert.equal(lookupUrl('crossref', '10.1234/a?b=c#d'), 'https://api.crossref.org/works/10.1234%2Fa%3Fb%3Dc%23d');
});

test('the sandboxed frame names the same three addresses, and the manifest lets it reach only those', async () => {
  const frame = await readFile(resolve(root, 'src/ui/lookup-frame.js'), 'utf8');
  const manifest = JSON.parse(await readFile(resolve(root, 'src/manifest.json'), 'utf8'));
  const hosts = Object.values(LOOKUP_SERVICES).map((service) => `https://${service.host}`);
  assert.deepEqual([...frame.matchAll(/https:\/\/[a-z.]+/g)].map((match) => match[0]), hosts, 'the frame’s addresses');
  assert.deepEqual(manifest.sandbox, { pages: ['ui/lookup-frame.html'] });
  assert.equal(manifest.content_security_policy.sandbox, `sandbox allow-scripts; default-src 'none'; script-src 'self'; connect-src ${hosts.join(' ')}`);
  assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self'; object-src 'none'; base-uri 'none'; connect-src 'none'", 'Link Meteor’s own pages are unchanged');
  assert.match(frame, /credentials: 'omit', referrerPolicy: 'no-referrer'/);
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.optional_host_permissions, ['http://*/*', 'https://*/*'], 'no permission was added for the lookup');
  for (const [service, identifier] of [['crossref', '10.1371/journal.pmed.0020124'], ['datacite', '10.48550/arXiv.2409.11211'], ['pubmed', '16060722']]) {
    const prefix = lookupUrl(service, identifier).slice(0, lookupUrl(service, identifier).indexOf(encodeURIComponent(identifier)));
    assert.ok(frame.includes(prefix), `the frame builds ${prefix}… as core/lookup.js does`);
  }
});

test('Crossref: a journal article and a book chapter', async () => {
  assert.deepEqual(readCrossref(await json('crossref-article.json')), { title: 'Why Most Published Research Findings Are False', authors: ['Ioannidis, John P. A.'], date: '2005-08-30',
    journal: 'PLoS Medicine', publisher: 'Public Library of Science (PLoS)', volume: '2', issue: '8', firstPage: 'e124', doi: '10.1371/journal.pmed.0020124', source: 'crossref' });
  const chapter = readCrossref(await json('crossref-chapter.json'));
  assert.equal(chapter.title, 'SplatFields: Neural Gaussian Splats for Sparse 3D and 4D Reconstruction', 'odd spaces are made plain');
  assert.deepEqual(chapter.authors, ['Mihajlovic, Marko', 'Prokudin, Sergey', 'Tang, Siyu', 'Maier, Robert', 'Bogo, Federica', 'Tung, Tony', 'Boyer, Edmond']);
  assert.deepEqual([chapter.journal, chapter.firstPage, chapter.lastPage, chapter.isbn, chapter.source], ['Computer Vision – ECCV 2024', '313', '332', '9783031726262', 'crossref']);
  assert.equal(readCrossref({ message: {} }), null);
  assert.equal(readCrossref(null), null);
});

test('DataCite: an arXiv preprint, dated when it was submitted, with no journal', async () => {
  const preprint = readDatacite(await json('datacite-arxiv.json'));
  assert.deepEqual(preprint, { title: 'SplatFields: Neural Gaussian Splats for Sparse 3D and 4D Reconstruction',
    authors: ['Mihajlovic, Marko', 'Prokudin, Sergey', 'Tang, Siyu', 'Maier, Robert', 'Bogo, Federica', 'Tung, Tony', 'Boyer, Edmond'],
    date: '2024-09-17', publisher: 'arXiv', doi: '10.48550/arxiv.2409.11211', arxiv: '2409.11211', source: 'datacite' });
  assert.equal(readDatacite({ data: { attributes: { titles: [] } } }), null);
});

test('PubMed: names read as family and initials, the date as printed', async () => {
  assert.deepEqual(readPubmed(await json('pubmed-article.json'), '16060722'), { title: 'Why most published research findings are false', authors: ['Ioannidis, JP'], date: '2005 Aug',
    journal: 'PLoS medicine', volume: '2', issue: '8', firstPage: 'e124', doi: '10.1371/journal.pmed.0020124', pmid: '16060722', source: 'pubmed' });
  assert.equal(readPubmed({ result: { uids: ['1'], 1: { uid: '1', error: 'cannot get document summary' } } }, '1'), null);
  assert.equal(readPubmed(await json('pubmed-article.json'), '999'), null, 'the answer must be for the ID asked');
});

test('an answer is a citation, a miss, or a reason to stop', async () => {
  assert.equal(readAnswer('crossref', '10.1371/journal.pmed.0020124', { status: 200, body: await recorded('crossref-article.json') }).citation.title, 'Why Most Published Research Findings Are False');
  assert.deepEqual(readAnswer('crossref', '10.5555/none', { status: 404, body: await recorded('crossref-missing.txt') }), { missing: true });
  assert.deepEqual(readAnswer('datacite', '10.5555/none', { status: 404, body: await recorded('datacite-missing.json') }), { missing: true });
  assert.deepEqual(readAnswer('pubmed', '16060722', { status: 429, body: '' }), { error: 'NCBI asked Link Meteor to slow down, so the lookup stopped here.', stop: true });
  assert.deepEqual(readAnswer('crossref', '10.1/x', { status: 503, body: '' }), { error: 'Crossref answered 503.' });
  assert.deepEqual(readAnswer('crossref', '10.1/x', { status: 200, body: '<html>not json' }), { error: 'Crossref sent an answer Link Meteor couldn’t read.' });
  assert.deepEqual(readAnswer('crossref', '10.1/x', { status: 200, body: '{"message":{}}' }), { missing: true });
});

test('answers are untrusted text: tags and entities are made plain, and every field is cut to its limit', () => {
  assert.equal(plainText('A <i>tale</i> of <script>alert(1)</script>two &amp; three&#8212;four&nbsp;five\n\tsix'), 'A tale of alert(1)two & three—four five six');
  assert.equal(plainText('&#0;&#xD800;&bogus;'), '&bogus;');
  assert.equal(plainText({ evil: true }), '');
  assert.equal(plainText('x'.repeat(400)).length, 300);
  const hostile = readCrossref({ message: { title: ['<b>T</b>' + 'x'.repeat(500)], author: Array.from({ length: 80 }, (_, i) => ({ family: `<i>F${i}</i>`, given: 'G'.repeat(400) })), page: '1-2', volume: { not: 'text' }, DOI: 42 } });
  assert.equal(hostile.title.length, 300);
  assert.equal(hostile.authors.length, 50);
  assert.ok(hostile.authors.every((name) => name.length <= 200 && !name.includes('<')));
  assert.deepEqual([hostile.volume, hostile.doi], [undefined, '42']);
  // What comes out is something the model accepts as a page citation.
  const state = reduceState(createState(), { type: 'links.append', links: [], pages: { 'https://doi.org/10.1/x': { ...hostile, readAt: '2026-10-02T00:00:00.000Z' } } });
  assert.equal(state.collections[0].pages['https://doi.org/10.1/x'].source, 'crossref');
});

test('what a lookup adds: only what was missing over a page’s own tags, everything over what a PDF said', () => {
  const lookup = { title: 'The Right Title', authors: ['Ada, A'], date: '2024-09-17', doi: '10.1/x', source: 'datacite', readAt: 'now' };
  const tags = { title: 'Title From The Page', date: '2024', readAt: 'then' };
  const filledTags = { title: 'Title From The Page', date: '2024', readAt: 'then', authors: ['Ada, A'], doi: '10.1/x', filled: { authors: 'datacite', doi: 'datacite' } };
  assert.deepEqual(mergeCitation(tags, lookup), filledTags, 'the page’s tags keep their fields and stay the page’s; what the lookup gave is marked');
  assert.deepEqual(filled(tags, lookup), ['authors', 'doi']);
  const pdf = { title: 'A Guess From The Largest Text', arxiv: '2409.11211', arxivCategory: 'cs.CV', pdfUrl: 'https://arxiv.org/pdf/2409.11211', source: 'pdf', readAt: 'then' };
  const overPdf = { ...lookup, arxiv: '2409.11211', arxivCategory: 'cs.CV', pdfUrl: 'https://arxiv.org/pdf/2409.11211', filled: { arxiv: 'pdf', arxivCategory: 'pdf', pdfUrl: 'pdf' } };
  assert.deepEqual(mergeCitation(pdf, lookup), overPdf, 'a lookup outranks what the PDF said about itself, and keeps what only the PDF knew');
  assert.deepEqual(mergeCitation(lookup, pdf), overPdf, 'in either order');
  assert.deepEqual(mergeCitation(lookup, { title: 'Other', journal: 'J', source: 'crossref', readAt: 'later' }), { ...lookup, journal: 'J', filled: { journal: 'crossref' } }, 'a second lookup only fills gaps');
  assert.deepEqual(mergeCitation(lookup, tags), filledTags, 'tags read later take over, and keep what the lookup added');
  assert.deepEqual(mergeCitation(tags, { title: 'Read Again', readAt: 'later' }), { title: 'Read Again', readAt: 'later' }, 'tags read again replace the earlier reading, as in 0.5.0');
  // Capturing the page again keeps what a lookup filled in, unless the page now gives it itself.
  assert.deepEqual(mergeCitation(filledTags, { title: 'Read Again', readAt: 'later' }), { title: 'Read Again', readAt: 'later', authors: ['Ada, A'], doi: '10.1/x', filled: { authors: 'datacite', doi: 'datacite' } },
    'the page’s own date is gone with the old reading; the looked-up authors and DOI stay');
  assert.deepEqual(mergeCitation(filledTags, { title: 'Read Again', authors: ['Ada, Anna'], readAt: 'later' }), { title: 'Read Again', authors: ['Ada, Anna'], readAt: 'later', doi: '10.1/x', filled: { doi: 'datacite' } }, 'the page’s own authors replace the looked-up ones');
  // Everything passes the model, and a made-up `filled` is refused or dropped.
  const key = 'https://doi.org/10.1/x';
  let state = reduceState(createState(), { type: 'links.append', links: [], pages: { [key]: tags } });
  state = reduceState(state, { type: 'links.append', links: [], pages: { [key]: lookup } });
  assert.deepEqual(state.collections[0].pages[key], filledTags);
  assert.throws(() => reduceState(createState(), { type: 'links.append', links: [], pages: { [key]: { title: 'T', filled: { title: 'somewhere' } } } }), /filled must name one of/);
  assert.throws(() => reduceState(createState(), { type: 'links.append', links: [], pages: { [key]: { title: 'T', filled: { bogus: 'pdf' } } } }), /Unsupported pages entry field: bogus/);
  assert.equal(reduceState(createState(), { type: 'links.append', links: [], pages: { [key]: { title: 'T', filled: { authors: 'pdf' } } } }).collections[0].pages[key].filled, undefined, 'a mark for a field that isn’t there is dropped');
  assert.deepEqual(mergeCitation(undefined, lookup), lookup);
});
