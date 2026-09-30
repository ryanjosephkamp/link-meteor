// Identifiers read from addresses (0.5.0): DOI, arXiv, PubMed, PMC and ISBN. Derived, never stored.
import test from 'node:test';
import assert from 'node:assert/strict';
import { identifiersOf, doiIn, isbnValid, citationFor, arxivDate } from '../src/core/identifiers.js';

const of = (url, extra = {}, pages) => identifiersOf({ url, originalHref: '', ...extra }, pages);

test('DOIs from doi.org, /doi/ paths, doi= values and publisher paths, tidied', () => {
  assert.deepEqual(of('https://doi.org/10.5555/uhi.2024.0142'), { doi: '10.5555/uhi.2024.0142' });
  assert.deepEqual(of('http://dx.doi.org/10.1038/nature12373'), { doi: '10.1038/nature12373' });
  assert.equal(of('https://dl.acm.org/doi/pdf/10.1145/3313831.3376135').doi, '10.1145/3313831.3376135');
  assert.equal(of('https://onlinelibrary.wiley.com/doi/full/10.1002/joc.1234').doi, '10.1002/joc.1234');
  assert.equal(of('https://link.springer.com/article/10.1007/s00704-019-02925-9').doi, '10.1007/s00704-019-02925-9');
  assert.equal(of('https://example.org/resolve?doi=10.1016%2FS0140-6736(20)30183-5').doi, '10.1016/S0140-6736(20)30183-5', 'decoded, balanced parentheses kept');
  assert.equal(of('https://example.org/files/10.1234/abc.pdf').doi, '10.1234/abc', 'the file extension belongs to the address');
  assert.equal(doiIn('see doi:10.1234/xyz).'), '10.1234/xyz', 'trailing punctuation and an unbalanced parenthesis trimmed');
  assert.deepEqual(of('https://example.org/v10.5/page'), {}, 'a version number is not a DOI');
  assert.deepEqual(of('mailto:someone@example.org'), {});
});

test('arXiv IDs, new and old style, from abs, pdf and html addresses and arXiv DOIs', () => {
  assert.equal(of('https://arxiv.org/abs/1706.03762').arxiv, '1706.03762');
  assert.equal(of('https://arxiv.org/pdf/2401.12345v2').arxiv, '2401.12345v2');
  assert.equal(of('https://arxiv.org/pdf/2401.12345v2.pdf').arxiv, '2401.12345v2');
  assert.equal(of('https://export.arxiv.org/abs/hep-th/9901001').arxiv, 'hep-th/9901001');
  assert.equal(of('https://arxiv.org/abs/math.GT/0309136').arxiv, 'math.GT/0309136');
  assert.deepEqual(of('https://doi.org/10.48550/arXiv.2401.12345'), { doi: '10.48550/arXiv.2401.12345', arxiv: '2401.12345' });
  assert.deepEqual(of('https://arxiv.org/list/cs.LG/recent'), {});
});

test('PubMed and PMC IDs from current and older NCBI addresses', () => {
  assert.equal(of('https://pubmed.ncbi.nlm.nih.gov/31452104/').pmid, '31452104');
  assert.equal(of('https://www.ncbi.nlm.nih.gov/pubmed/31452104').pmid, '31452104');
  assert.equal(of('https://pmc.ncbi.nlm.nih.gov/articles/PMC6702837/').pmcid, 'PMC6702837');
  assert.equal(of('https://www.ncbi.nlm.nih.gov/pmc/articles/pmc6702837/').pmcid, 'PMC6702837');
  assert.deepEqual(of('https://pubmed.ncbi.nlm.nih.gov/?term=heat'), {});
});

test('ISBNs with valid check digits only', () => {
  assert.equal(isbnValid('978-0-306-40615-7'), '9780306406157');
  assert.equal(isbnValid('0-306-40615-2'), '0306406152');
  assert.equal(isbnValid('080442957X'), '080442957X');
  assert.equal(isbnValid('9780306406158'), '', 'a wrong check digit');
  assert.equal(of('https://openlibrary.org/isbn/9780306406157').isbn, '9780306406157');
  assert.equal(of('https://search.worldcat.org/isbn/0306406152').isbn, '0306406152');
  assert.equal(of('https://books.google.com/books?vid=ISBN9780306406157').isbn, '9780306406157');
  assert.equal(of('https://shop.example.com/item?ean=9780306406157').isbn, '9780306406157');
  assert.deepEqual(of('https://shop.example.com/item?ean=4006381333931'), {}, 'an EAN that is not a book');
  assert.deepEqual(of('https://www.amazon.com/dp/0306406152'), {}, 'shop product codes are not read as ISBNs');
});

test('the original href and the link\'s own page citation also count', () => {
  assert.equal(of('https://journal.example.org/articles/42', { originalHref: 'https://doi.org/10.5555/abc' }).doi, '10.5555/abc');
  const pages = { 'https://journal.example.org/articles/42': { title: 'A paper', doi: '10.5555/own', pmid: '123456', isbn: '978-0-306-40615-7' } };
  assert.deepEqual(of('https://journal.example.org/articles/42#results', {}, pages), { doi: '10.5555/own', pmid: '123456', isbn: '9780306406157' });
});

// 0.5.0 RC2: the citation a link uses, and dates from arXiv IDs.
test('citationFor: the link\'s own page, else a page that names it as its PDF, shares its DOI or its arXiv ID', () => {
  const pages = {
    'https://arxiv.org/abs/2409.11211': { title: 'SplatFields', pdfUrl: 'https://arxiv.org/pdf/2409.11211', readAt: '2026-09-30T10:00:00.000Z' },
    'https://journal.example/a/42': { title: 'Cooling', doi: '10.5555/Cool.1', pmid: '31452104' },
    'https://doi.org/10.5555/other.2': { title: 'By its address' },
  };
  const of = (url) => citationFor({ url }, pages);
  assert.deepEqual(of('https://arxiv.org/abs/2409.11211#x'), { key: 'https://arxiv.org/abs/2409.11211', citation: pages['https://arxiv.org/abs/2409.11211'], reason: 'own' });
  assert.equal(of('https://arxiv.org/pdf/2409.11211').reason, 'pdf');
  assert.equal(of('https://arxiv.org/pdf/2409.11211v3').reason, 'arxiv', 'another version of the same paper');
  assert.equal(of('https://journal.example/doi/pdf/10.5555/cool.1').reason, 'doi');
  assert.equal(of('https://publisher.example/x?doi=10.5555/other.2').citation.title, 'By its address');
  assert.equal(of('https://arxiv.org/pdf/2501.00001'), null);
  assert.equal(citationFor({ url: 'https://arxiv.org/pdf/2409.11211' }, undefined), null);
  // identifiersOf takes what the borrowed citation adds.
  assert.deepEqual(identifiersOf({ url: 'https://journal.example/doi/pdf/10.5555/cool.1' }, pages), { doi: '10.5555/cool.1', pmid: '31452104' });
});

test('arxivDate: the year and month an ID was first submitted', () => {
  assert.deepEqual(arxivDate('2409.11211'), [2024, 9]);
  assert.deepEqual(arxivDate('0704.0001v2'), [2007, 4]);
  assert.deepEqual(arxivDate('hep-th/9901001'), [1999, 1]);
  assert.deepEqual(arxivDate('math.GT/0309136'), [2003, 9]);
  assert.deepEqual(arxivDate('2413.00001'), [], 'no thirteenth month');
  assert.deepEqual(arxivDate(''), []);
});
