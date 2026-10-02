// Page details lookup (0.6.0): which request an identifier needs, and each service's answer as a
// page citation, from recorded answers (tests/fixtures/lookup). No test contacts a service;
// tests/lookup-browser.mjs runs the sandboxed frame with the test answering in the services' place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { createState, mergeCitation, reduceState } from '../src/core/model.js';
import { citeFacts } from '../src/core/cite.js';
import { LOOKUP_SERVICES, MAX_LOOKUPS, filled, lookupAllowed, lookupMissing, lookupOutcome, lookupPlan, lookupReport, lookupRequests, lookupUrl, missingWords, plainText, readAnswer, readCrossref, readDatacite, readPubmed, sameCitation, unauthored } from '../src/core/lookup.js';

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
  assert.deepEqual(mergeCitation(tags, lookup), { title: 'Title From The Page', date: '2024', readAt: 'then', authors: ['Ada, A'], doi: '10.1/x' }, 'the page’s tags keep their fields and stay the page’s');
  assert.deepEqual(filled(tags, lookup), ['authors', 'doi']);
  const pdf = { title: 'A Guess From The Largest Text', arxiv: '2409.11211', arxivCategory: 'cs.CV', pdfUrl: 'https://arxiv.org/pdf/2409.11211', source: 'pdf', readAt: 'then' };
  assert.deepEqual(mergeCitation(pdf, lookup), { arxiv: '2409.11211', arxivCategory: 'cs.CV', pdfUrl: 'https://arxiv.org/pdf/2409.11211', title: 'The Right Title', authors: ['Ada, A'], date: '2024-09-17', doi: '10.1/x', source: 'datacite', readAt: 'now' },
    'a lookup outranks what the PDF said about itself, and keeps what only the PDF knew');
  assert.deepEqual(mergeCitation(lookup, pdf), mergeCitation(pdf, lookup), 'in either order');
  assert.deepEqual(mergeCitation(lookup, { title: 'Other', journal: 'J', source: 'crossref', readAt: 'later' }), { ...lookup, journal: 'J' }, 'a second lookup only fills gaps');
  assert.deepEqual(mergeCitation(lookup, tags), { authors: ['Ada, A'], doi: '10.1/x', title: 'Title From The Page', date: '2024', readAt: 'then' }, 'tags read later take over, and keep what the lookup added');
  assert.deepEqual(mergeCitation(tags, { title: 'Read Again', readAt: 'later' }), { title: 'Read Again', readAt: 'later' }, 'tags read again replace the earlier reading, as in 0.5.0');
  assert.deepEqual(mergeCitation(undefined, lookup), lookup);
});

/* A run: which identifiers are asked about, where each answer goes, and what is said afterward. */
const DOI = '10.1371/journal.pmed.0020124';
const link = (id, url, extra = {}) => ({ id, anchorText: id, accessibleLabel: '', url, originalHref: url, sourceUrl: 'https://scholar.example.com/', sourceTitle: 'Search', frameUrl: '', capturedAt: '2026-10-01T10:00:00.000Z', batchId: 'b', notes: '', tags: [], ...extra });
const ABSTRACT = 'https://arxiv.org/abs/2409.11211', PDF = 'https://arxiv.org/pdf/2409.11211v1', DOI_ORG = `https://doi.org/${DOI}`, PLOS = `https://journals.plos.org/plosmedicine/article?id=${DOI}`;
const FULL = { title: 'A Full Citation', authors: ['Ada, A'], date: '2020', journal: 'J', readAt: 'then' };

test('a run asks once per identifier, only where a citation lacks something, and knows where each answer goes', () => {
  const pages = {
    [ABSTRACT]: { title: 'SplatFields', pdfUrl: 'https://arxiv.org/pdf/2409.11211v1', arxiv: '2409.11211', readAt: 'then' },
    'https://doi.org/10.1000/complete': FULL,
    'https://example.org/no-identifier': { title: 'A page', readAt: 'then' },
  };
  const links = [link('a', DOI_ORG), link('b', PLOS), link('c', PDF), link('d', 'https://pubmed.ncbi.nlm.nih.gov/16060722/'), link('e', 'https://example.org/no-identifier'),
    link('f', 'https://doi.org/10.1000/complete'), link('g', 'mailto:someone@example.org'), link('h', DOI_ORG.toUpperCase().replace('HTTPS://DOI.ORG', 'https://dx.doi.org')), link('i', 'https://www.isbnsearch.org/isbn/9780262033848')];
  const plan = lookupPlan(links, pages);
  assert.deepEqual(plan.asks.map((ask) => [ask.requests.map((request) => `${request.service} ${request.identifier}`), ask.targets, ask.links]), [
    [[`crossref ${DOI}`, `datacite ${DOI}`], [DOI_ORG, PLOS, `https://dx.doi.org/${DOI.toUpperCase()}`], 3],
    [['datacite 10.48550/arXiv.2409.11211'], [ABSTRACT], 1],
    [['pubmed 16060722'], ['https://pubmed.ncbi.nlm.nih.gov/16060722/'], 1],
  ], 'one ask for a DOI three links share, whatever its case; the PDF link’s answer goes to the citation it borrows; a link without a citation gets its own address');
  assert.deepEqual([plan.without, plan.complete, plan.over], [3, 1, 0], 'no identifier (a page, an email address, an ISBN): not asked; a complete citation: not asked');
  // Only an identifier is ever part of a request.
  for (const ask of plan.asks) for (const request of ask.requests) assert.deepEqual(Object.keys(request).sort(), ['identifier', 'service', 'url']);
  assert.deepEqual(lookupPlan([], pages), { asks: [], over: 0, without: 0, complete: 0 });
});

test('what a citation lacks: a title, authors, a date or a journal, and no journal for an arXiv preprint', () => {
  const doi = lookupRequests({ doi: DOI }), arxiv = lookupRequests({ arxiv: '2409.11211' });
  assert.deepEqual(lookupMissing(undefined, doi), ['title', 'authors', 'date', 'journal']);
  assert.deepEqual(lookupMissing({ title: 'T', authors: [], date: '2020' }, doi), ['authors', 'journal']);
  assert.deepEqual(lookupMissing({ title: 'T', authors: ['Ada, A'], date: '2020' }, arxiv), [], 'a preprint with a title, authors and a date is complete');
  assert.deepEqual(lookupMissing(undefined, arxiv), ['title', 'authors', 'date']);
  assert.deepEqual(lookupMissing(FULL, doi), []);
  assert.equal(missingWords(['title', 'authors', 'date', 'journal']), 'title, authors, date or journal');
  assert.equal(missingWords(['authors', 'journal']), 'authors or journal');
  assert.equal(missingWords(['date']), 'date');
});

test('at most 200 identifiers a run; past that, the ones already asked about go last', () => {
  const links = Array.from({ length: MAX_LOOKUPS + 5 }, (_, i) => link(`n${i}`, `https://doi.org/10.1000/n${i}`));
  const plan = lookupPlan(links, {});
  assert.deepEqual([plan.asks.length, plan.over, plan.asks[0].requests[0].identifier, plan.asks.at(-1).requests[0].identifier], [200, 5, '10.1000/n0', '10.1000/n199']);
  const seen = new Set(plan.asks.slice(0, 10).map((ask) => ask.key));
  const again = lookupPlan(links, {}, { seen });
  assert.deepEqual([again.asks.length, again.over, again.asks[0].requests[0].identifier, again.asks.at(-1).requests[0].identifier], [200, 5, '10.1000/n10', '10.1000/n4'], 'the five that waited are reached');
  assert.deepEqual(lookupPlan(links.slice(0, 3), {}, { seen }).asks.map((ask) => ask.requests[0].identifier), ['10.1000/n0', '10.1000/n1', '10.1000/n2'], 'within the limit, the order is the links’');
});

test('what a run saves: tags are never replaced, a PDF’s guess is, and Undo puts every citation back exactly', async () => {
  const article = readAnswer('crossref', DOI, { status: 200, body: await recorded('crossref-article.json') }).citation;
  const preprint = readAnswer('datacite', '10.48550/arXiv.2409.11211', { status: 200, body: await recorded('datacite-arxiv.json') }).citation;
  const tags = { title: 'Title From The Page', date: '2024', readAt: '2026-09-30T09:00:00.000Z' };
  const pdf = { title: 'A Guess From The Largest Text', date: '17 Sep 2024', arxiv: '2409.11211', arxivCategory: 'cs.CV', pdfUrl: PDF, source: 'pdf', readAt: '2026-09-29T09:00:00.000Z' };
  const earlier = { title: 'Looked Up Earlier', authors: ['Ada, A'], date: '2020', journal: 'J', doi: '10.1000/looked-up', source: 'crossref', readAt: '2026-10-01T00:00:00.000Z' };
  const links = [link('a', DOI_ORG), link('b', PLOS), link('c', PDF), link('d', 'https://doi.org/10.1000/looked-up'), link('e', 'https://doi.org/10.1000/nobody'), link('f', 'https://doi.org/10.1000/down')];
  let state = reduceState(createState(), { type: 'links.append', links, pages: { [PLOS]: tags, [PDF]: pdf, 'https://doi.org/10.1000/looked-up': earlier } });
  const before = state.collections[0].pages;
  const plan = lookupPlan(links, before);
  assert.deepEqual(plan.asks.map((ask) => [ask.targets, ask.links]), [[[PLOS], 2], [[PDF], 1], [['https://doi.org/10.1000/nobody'], 1], [['https://doi.org/10.1000/down'], 1]],
    'the doi.org link already uses the PLOS page’s citation (the same DOI), so the answer goes there; the citation an earlier lookup gave lacks nothing, so it isn’t asked about again');
  const readAt = '2026-10-02T12:00:00.000Z';
  const outcome = lookupOutcome([{ ask: plan.asks[0], citation: article }, { ask: plan.asks[1], citation: preprint }, { ask: plan.asks[2] }, { ask: plan.asks[3], error: 'Crossref answered 503.' }], before, readAt);
  assert.deepEqual(outcome.pages, { [PLOS]: { ...article, readAt }, [PDF]: { ...preprint, readAt } }, 'only core/lookup.js’s reading of each answer is saved');
  assert.deepEqual(outcome.before, { [PLOS]: tags, [PDF]: pdf });
  assert.deepEqual([outcome.papers, outcome.replaced, outcome.same, outcome.missing, outcome.failed, outcome.error], [{ title: 0, authors: 2, date: 0, journal: 1, other: 0 }, 1, 0, 1, 1, 'Crossref answered 503.']);
  state = reduceState(state, { type: 'links.append', links: [], pages: outcome.pages });
  const after = state.collections[0].pages;
  assert.deepEqual(after[PLOS], mergeCitation(tags, { ...article, readAt }));
  assert.deepEqual([after[PLOS].title, after[PLOS].date, after[PLOS].readAt, after[PLOS].source, after[PLOS].authors, after[PLOS].journal], ['Title From The Page', '2024', tags.readAt, undefined, ['Ioannidis, John P. A.'], 'PLoS Medicine'], 'the page’s own tags are never replaced');
  assert.deepEqual([after[PDF].title, after[PDF].date, after[PDF].source, after[PDF].arxivCategory, after[PDF].pdfUrl, after[PDF].authors.length], [preprint.title, '2024-09-17', 'datacite', 'cs.CV', PDF, 7], 'a title guessed from a PDF is replaced; what only the PDF knew stays');
  assert.equal(after[DOI_ORG], undefined, 'no second copy for the link that borrows it');
  // A second run finds nothing new, and writes nothing.
  const second = lookupOutcome([{ ask: plan.asks[0], citation: article }, { ask: plan.asks[1], citation: preprint }], after, '2026-10-03T00:00:00.000Z');
  assert.deepEqual([second.pages, second.before, second.same, second.papers], [{}, {}, 2, { title: 0, authors: 0, date: 0, journal: 0, other: 0 }]);
  // Undo.
  state = reduceState(state, { type: 'pages.restore', pages: outcome.before });
  assert.deepEqual(state.collections[0].pages, before, 'every citation is exactly as before');
  assert.equal(sameCitation({ a: '1', b: ['x'] }, { b: ['x'], a: '1' }), true);
  assert.equal(sameCitation({ a: '1' }, undefined), false);
  assert.equal(sameCitation(undefined, null), true);
});

test('a lookup that adds only other details says so', () => {
  const pages = { [DOI_ORG]: { title: 'T', authors: ['Ada, A'], date: '2020', readAt: 'then' } };
  const plan = lookupPlan([link('a', DOI_ORG)], pages);
  const outcome = lookupOutcome([{ ask: plan.asks[0], citation: { title: 'Other', publisher: 'P', source: 'datacite' } }], pages, 'now');
  assert.deepEqual([outcome.papers, outcome.replaced, Object.keys(outcome.pages)], [{ title: 0, authors: 0, date: 0, journal: 0, other: 1 }, 0, [DOI_ORG]]);
  assert.equal(lookupReport({ ...outcome, asked: 1 }), 'Added other details, such as the publisher.');
});

test('what a run says, in plain words', () => {
  const none = { title: 0, authors: 0, date: 0, journal: 0, other: 0 };
  assert.equal(lookupReport({ asked: 7, papers: { ...none, authors: 6, date: 2 }, missing: 1 }), 'Filled in authors for 6 papers, dates for 2. 1 wasn’t found.');
  assert.equal(lookupReport({ asked: 6, papers: { title: 3, authors: 5, date: 3, journal: 3, other: 0 }, replaced: 1, missing: 1, without: 1 }),
    'Filled in titles for 3 papers, authors for 5, dates for 3, journals for 3. Replaced details read from a PDF for 1. 1 wasn’t found. Not looked up: 1 link with no DOI, arXiv ID or PubMed ID.');
  assert.equal(lookupReport({ asked: 1, papers: { ...none, title: 1, authors: 1, date: 1, journal: 1 } }), 'Filled in the title, authors, date and journal.');
  assert.equal(lookupReport({ asked: 1, papers: { ...none, authors: 1 }, replaced: 1 }), 'Filled in the authors. Replaced details read from the PDF.');
  assert.equal(lookupReport({ asked: 1, papers: none, missing: 1 }), 'This paper wasn’t found.');
  assert.equal(lookupReport({ asked: 1, papers: none, same: 1 }), 'The services had nothing new for this paper.');
  assert.equal(lookupReport({ asked: 1, papers: none, failed: 1, error: 'Crossref sent an answer Link Meteor couldn’t read.' }), 'This paper couldn’t be looked up: Crossref sent an answer Link Meteor couldn’t read.');
  assert.equal(lookupReport({ asked: 5, papers: none, same: 2, missing: 3 }), '2 papers had nothing new. 3 weren’t found.');
  assert.equal(lookupReport({ asked: 4, papers: { ...none, other: 1 }, failed: 3, error: 'Crossref answered 503.', ended: 'failures', left: 2 }),
    'Added other details for 1 paper. 3 couldn’t be looked up: Crossref answered 503. The lookup stopped after 3 papers in a row couldn’t be looked up. 2 papers weren’t asked about.');
  assert.equal(lookupReport({ asked: 1, papers: { ...none, authors: 1 }, ended: 'stopped', left: 2 }), 'Filled in authors for 1 paper. You stopped the lookup. 2 papers weren’t asked about.');
  assert.equal(lookupReport({ asked: 0, papers: none, ended: 'stopped', left: 3 }), 'You stopped the lookup. 3 papers weren’t asked about.');
  assert.equal(lookupReport({ asked: 2, papers: { ...none, title: 2 }, ended: 'limit', reason: 'NCBI asked Link Meteor to slow down, so the lookup stopped here.', left: 1 }),
    'Filled in titles for 2 papers. NCBI asked Link Meteor to slow down, so the lookup stopped here. 1 paper wasn’t asked about.');
  assert.equal(lookupReport({ asked: 2, papers: { ...none, title: 2 }, ended: 'off', left: 0 }), 'Filled in titles for 2 papers. Page details lookup was turned off, so the lookup stopped.');
  assert.equal(lookupReport({ asked: 0, papers: none, without: 3, complete: 2 }), 'Nothing to look up: 3 links with no DOI, arXiv ID or PubMed ID, and 2 links that already have these details.');
  assert.equal(lookupReport({ asked: 0, papers: none, complete: 1 }), 'Nothing to look up: 1 link that already has these details.');
  assert.equal(lookupReport({}), 'Nothing to look up.');
  assert.equal(lookupReport({ asked: 200, papers: { ...none, authors: 1234 }, over: 14 }), 'Filled in authors for 1,234 papers. Link Meteor looks up 200 papers at a time. 14 more are waiting: click Look up details again.');
});

test('Look up details in the Export panel is for exactly the papers its “no authors yet” line counts', () => {
  const pages = { [ABSTRACT]: { title: 'SplatFields', authors: ['Mihajlovic, Marko'], pdfUrl: PDF, arxiv: '2409.11211', readAt: 'then' }, [PLOS]: { title: 'Tags', authors: [' '], readAt: 'then' } };
  const rows = [link('a', DOI_ORG), link('b', PLOS), link('c', PDF), link('d', 'https://pubmed.ncbi.nlm.nih.gov/16060722/'), link('e', 'https://example.org/'), link('f', 'https://arxiv.org/abs/1706.03762')];
  assert.deepEqual(unauthored(rows, pages).map((row) => row.id), ['a', 'b', 'f'], 'a DOI or an arXiv ID, and no authors; the PDF link borrows its abstract page’s authors');
  assert.equal(unauthored(rows, pages).length, citeFacts(rows, pages).unauthored);
  assert.equal(unauthored(rows, {}).length, citeFacts(rows, {}).unauthored);
  assert.ok(lookupPlan(unauthored(rows, pages), pages).asks.length === 2 && lookupPlan(unauthored(rows, pages), pages).without === 0, 'each of them can be asked about (two share a DOI)');
});

/* The workbench: the same words as the privacy page, and no other way out. */
const words = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
test('Online lookups says, word for word, what the contract, the privacy page and the store draft say', async () => {
  const html = await readFile(resolve(root, 'src/ui/workbench.html'), 'utf8');
  const box = /<div id="lookup-sends" class="sends">([\s\S]*?)<\/div>/.exec(html)[1];
  const all = (pattern) => [...box.matchAll(pattern)].map((match) => words(match[1]));
  const [what] = all(/<p class="sends-what">([\s\S]*?)<\/p>/g), services = all(/<li>([\s\S]*?)<\/li>/g), rest = all(/<p class="sends-not">([\s\S]*?)<\/p>/g);
  assert.equal(services.length, 3);
  const said = `${what} ${services[0]}; ${services[1]}; and ${services[2]}. ${rest.join(' ')}`;
  const contract = /^- \*\*Page details lookup\.\*\* "(.+)"$/m.exec(await readFile(resolve(root, 'docs/CONTRACTS.md'), 'utf8'))[1].replaceAll('*', '');
  assert.equal(said, contract, 'the workbench and the contract');
  const plain = (text) => text.replaceAll('*', '').replaceAll('’', "'");
  for (const file of ['docs/PRIVACY.md', 'CHROMEWEBSTORE.md']) assert.ok(plain(await readFile(resolve(root, file), 'utf8')).includes(plain(said)), `the workbench and ${file}`);
  const site = words(await readFile(resolve(root, 'site/privacy.html'), 'utf8')).replaceAll('’', "'");
  for (const part of [what, ...services, ...rest]) assert.ok(site.includes(plain(part)), `the workbench and the site’s privacy page: ${part}`);
  // The switch is off in the page as shipped, and described by those words.
  assert.match(html, /<input id="lookup-details" type="checkbox" role="switch" class="switch" aria-describedby="lookup-help lookup-sends">/);
  for (const service of Object.values(LOOKUP_SERVICES)) assert.ok(box.includes(`<b>${service.name}</b> (<code>${service.host}</code>)`), `${service.name} and its address`);
});

test('only the sandboxed frame can make a request, and only lookup.js creates it', async () => {
  const folders = ['src', 'src/background', 'src/content', 'src/core', 'src/ui', 'src/ui/workbench'];
  const files = (await Promise.all(folders.map(async (folder) => (await readdir(resolve(root, folder))).filter((name) => name.endsWith('.js')).map((name) => `${folder}/${name}`)))).flat();
  const using = async (pattern) => (await Promise.all(files.map(async (file) => (pattern.test(await readFile(resolve(root, file), 'utf8')) ? file : '')))).filter(Boolean);
  // pdf-tab.js's request runs in the PDF's own tab, as that page (see "Reading a PDF's file").
  assert.deepEqual(await using(/\bfetch\(/), ['src/ui/lookup-frame.js', 'src/ui/workbench/pdf-tab.js']);
  assert.deepEqual(await using(/XMLHttpRequest|WebSocket|sendBeacon|EventSource/), []);
  assert.deepEqual(await using(/lookup-frame\.html/), ['src/ui/workbench/lookup.js'], 'the frame is created in one place');
  const lookup = await readFile(resolve(root, 'src/ui/workbench/lookup.js'), 'utf8');
  assert.equal([...lookup.matchAll(/postMessage\(/g)].length, 1);
  assert.match(lookup, /postMessage\(\{ type: 'lookup', id, service, identifier \}, '\*'\)/, 'the frame is handed an identifier and its service, nothing else');
  assert.equal([...lookup.matchAll(/createElement\('iframe'\)/g)].length, 1);
});
