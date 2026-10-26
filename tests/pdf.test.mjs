// PDFs (0.6.0): src/core/pdf.js on plain data, and on real PDF bytes read in Node with the
// PDF.js files Link Meteor ships. The fixtures are written by tests/fixtures/pdf/make.mjs, with
// no packages. tests/pdf-browser.mjs reads the same fixtures inside the extension.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CONTEXT } from '../src/core/model.js';
import { MAX_IMPORT_LINKS } from '../src/core/imports.js';
import { isPdf, pdfCitation, pdfContext, pdfLinks, pdfPages, pdfSetProblem, MAX_PDF_BYTES, MAX_PDF_PAGES, MAX_PDF_SET, MAX_PDF_SET_BYTES } from '../src/core/pdf.js';
import { FACES, FIXTURES, makePdf } from './fixtures/pdf/make.mjs';
import { combinePdfs, fixture, readPdf, withPdf } from './helpers/pdf.mjs';

const rows = (links) => links.map((link) => [link.pdfPage, link.anchorText, link.url]);

test('the committed fixtures are what the generator writes', async () => {
  for (const [name, build] of Object.entries(FIXTURES)) assert.deepEqual(new Uint8Array(await fixture(name)), new Uint8Array(build()), `${name}: run node tests/fixtures/pdf/make.mjs`);
});

test('a paper: every link with its words and page, links inside it counted, other actions skipped', async () => {
  const result = await readPdf(await fixture('paper.pdf'), { address: 'https://arxiv.org/pdf/2409.11211v1#page=2' });
  assert.equal(result.pageCount, 3);
  assert.deepEqual(rows(result.links), [
    [1, '', 'https://orcid.org/0000-0002-1825-0097'], // a link over a picture keeps empty anchor text
    [1, 'example.org/code', 'https://example.org/code'],
    [1, 'here', 'https://data.example.org/set?id=7'],
    [1, 'https://github.com/example/project', 'https://github.com/example/project'], // wrapped over two lines: one link
    [1, 'https://mono.example.net/a', 'https://mono.example.net/a'], // typeset letter by letter: one word
    [1, 'arXiv:1610.10099', 'http://arxiv.org/abs/1610.10099'], // its rectangle reaches into "preprint": no stray letter
    [1, 'https://doi.org/10.5555/fixture.2026.001', 'https://doi.org/10.5555/fixture.2026.001'],
    [2, 'Write to us', 'mailto:team@example.org'],
    [2, '+1 555 0100', 'tel:+15550100'],
    [2, 'example.org/code', 'https://example.org/code'], // the same address again is another occurrence
    [2, 'a link', 'https://left.example.org/'],
    [2, 'https://long.example.org/a/very/long/path', 'https://long.example.org/a/very/long/path'], // a printed address across a page break
    [3, 'https://example.com/ref1', 'https://example.com/ref1'],
    [3, 'one', 'https://example.com/same'], // side by side on one line: two links
    [3, 'two', 'https://example.com/same'],
  ]);
  assert.equal(result.internal, 1, 'the link to Section 2');
  assert.deepEqual(result.skipped, [{ page: 1, reason: 'not-link' }, { page: 1, reason: 'not-link' }], 'a script and another file');
  assert.equal(result.linkPages, 3);
  assert.equal(result.capped, 0);
  const context = Object.fromEntries(result.links.map((link) => [`${link.pdfPage} ${link.anchorText}`, link.context]));
  assert.equal(context['1 here'], 'Our code is at example.org/code and the data is here.');
  assert.equal(context['1 https://github.com/example/project'], 'The project page has more to read: https://github.com/example/project and it ends here.');
  assert.equal(context['1 arXiv:1610.10099'], '[12] J. Doe. A study of things. arXiv preprint arXiv:1610.10099, 2016.', 'in a reference list, the reference');
  assert.equal(context['2 a link'], 'Left column words with a link', 'not the other column');
  assert.equal(context['1 '], undefined, 'a picture alone on its line has no context');
  assert.equal(result.links.find((link) => link.url.startsWith('tel:')).originalHref, 'tel:+15550100');
});

test('a paper says what it is: arXiv’s stamp, one DOI, the largest text as its title, and no authors', async () => {
  const { citation, notes } = await readPdf(await fixture('paper.pdf'), { address: 'https://arxiv.org/pdf/2409.11211v1#page=2' });
  assert.deepEqual(citation, { arxiv: '2409.11211', arxivVersion: 'v1', arxivCategory: 'cs.CV', date: '17 Sep 2024', doi: '10.5555/fixture.2026.001',
    title: 'A Small Paper About Links', pdfUrl: 'https://arxiv.org/pdf/2409.11211v1', source: 'pdf' });
  assert.deepEqual(notes, { arxiv: 'from the stamp on page 1', doi: 'from page 1', title: 'from the first page’s largest text', authors: 'PDFs rarely name them reliably.' });
  const fromFile = (await readPdf(await fixture('paper.pdf'))).citation;
  assert.equal(fromFile.pdfUrl, undefined, 'a file has no address');
});

test('a journal article with good details: its metadata’s DOI, journal and date, and authors because they are printed', async () => {
  const { citation, notes, links } = await readPdf(await fixture('journal.pdf'));
  assert.deepEqual(citation, { doi: '10.5555/journal.2026.042', title: 'A Study of Things That Link', authors: ['Ada Example', 'Ben Sample'],
    journal: 'Journal of Fixture Studies', date: '2026-03-14', source: 'pdf' });
  assert.equal(notes.doi, 'from the PDF’s own details');
  assert.equal(notes.title, 'from the PDF’s own details');
  assert.deepEqual(rows(links), [[1, 'the archive', 'https://archive.example.org/study'], [2, 'tables', 'https://archive.example.org/study/tables.csv']]);
});

test('PDFs with nothing to add, and PDFs that can’t be read, each say so', async () => {
  const notes = await readPdf(await fixture('notes.pdf'));
  assert.equal(notes.citation, null, 'one size of type has no title');
  assert.deepEqual(rows(notes.links), [[1, 'the map', 'https://maps.example.org/site-4']]);
  const plain = await readPdf(await fixture('no-links.pdf'));
  assert.deepEqual(plain.links, [], 'an address printed without a link is not picked up');
  assert.equal(plain.citation.title, 'Words Without Links');
  const scanned = await readPdf(await fixture('empty.pdf'));
  assert.deepEqual([scanned.links, scanned.internal, scanned.citation], [[], 0, null]);
  await assert.rejects(readPdf(await fixture('password.pdf')), { name: 'PasswordException' });
  await assert.rejects(readPdf(await fixture('damaged.pdf')), { name: 'InvalidPDFException' });
  await assert.rejects(readPdf(await fixture('not-a-pdf.pdf')), { name: 'InvalidPDFException' });
  assert.equal(isPdf(await fixture('paper.pdf')), true);
  assert.equal(isPdf(await fixture('not-a-pdf.pdf')), false);
  assert.equal(isPdf(new Uint8Array([...new Uint8Array(1019), 0x25, 0x50, 0x44, 0x46, 0x2d])), true, 'within the first 1,024 bytes');
  assert.equal(isPdf(new Uint8Array([...new Uint8Array(1020), 0x25, 0x50, 0x44, 0x46, 0x2d])), false);
});

test('context is left out when the setting is off, and cut at word boundaries when long', async () => {
  const off = await readPdf(await fixture('paper.pdf'), { saveContext: false });
  assert.ok(off.links.every((link) => link.context === undefined));
  const item = (str, x) => ({ str, x, y: 100, w: str.length * 6, h: 10, rotated: false });
  const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
  const context = pdfContext([item(long, 0)], [[240, 98, 276, 110]], 'word35');
  assert.ok(context.length <= MAX_CONTEXT && context.startsWith('…') && context.endsWith('…') && context.includes('word35'), context);
  assert.ok(!/…\S*\bwor$|^…ord/.test(context), 'whole words only');
});

// Plain data: one page, 10-point text on one baseline unless a test says otherwise, in a
// typewriter face (every character 6 points wide).
const item = (str, x, extra = {}) => ({ str, x, y: 100, w: str.length * 6, h: 10, rotated: false, mono: true, ...extra });
const linkAt = (x1, x2, url, extra = {}) => ({ rect: [x1, 98, x2, 110], url, unsafeUrl: url, internal: false, ...extra });
const page = (items, annotations, number = 1) => ({ number, width: 612, height: 792, items, annotations });

test('words under a link: whole words, never a neighbor’s stray letters', () => {
  // "preprint arXiv:1610.10099," is one run; the rectangle starts inside the t of preprint and ends before the comma.
  const run = item('preprint arXiv:1610.10099, 2016.', 0);
  assert.equal(pdfLinks([page([run], [linkAt(45, 150, 'http://arxiv.org/abs/1610.10099')])]).links[0].anchorText, 'arXiv:1610.10099');
  // A link over the middle of a sentence takes just its words.
  assert.equal(pdfLinks([page([item('see the project page for more', 0)], [linkAt(48, 120, 'https://p.example/')])]).links[0].anchorText, 'project page');
  // Text less than half inside the rectangle vertically is another line; rotated text is never link text.
  const above = item('line above', 0, { y: 106 }), stamp = item('arXiv:2409.11211v1', 0, { rotated: true });
  assert.equal(pdfLinks([page([above, stamp, item('the link', 0)], [linkAt(0, 60, 'https://l.example/')])]).links[0].anchorText, 'the link');
  // Nothing under it: empty, and it stays empty.
  assert.equal(pdfLinks([page([item('far away', 300)], [linkAt(0, 60, 'https://icon.example/')])]).links[0].anchorText, '');
});

test('wrapped links become one link; the same address side by side or far apart stays two', () => {
  const first = { rect: [200, 98, 320, 110], url: 'https://github.com/example/project', unsafeUrl: 'https://github.com/example/project', internal: false };
  const second = { ...first, rect: [0, 84, 90, 96] };
  const items = [item('code: https://github.com/', 164), item('example/project is here', 0, { y: 86 })];
  const wrapped = pdfLinks([page(items, [first, second])]);
  assert.deepEqual(rows(wrapped.links), [[1, 'https://github.com/example/project', 'https://github.com/example/project']]);
  // Words that wrap, and aren't an address, keep their space.
  const words = pdfLinks([page([item('read the project', 224), item('page today', 0, { y: 86 })], [{ ...first, rect: [248, 98, 320, 110], url: 'https://w.example/', unsafeUrl: 'https://w.example/' }, { ...second, rect: [0, 84, 24, 96], url: 'https://w.example/', unsafeUrl: 'https://w.example/' }])]);
  assert.deepEqual(rows(words.links), [[1, 'the project page', 'https://w.example/']]);
  // Far below, or with another link between: two links.
  const far = pdfLinks([page([item('one', 200), item('two', 0, { y: 20 })], [{ ...first, rect: [200, 98, 218, 110] }, { ...first, rect: [0, 18, 18, 30] }])]);
  assert.equal(far.links.length, 2);
  const between = pdfLinks([page(items, [first, linkAt(400, 430, 'https://other.example/'), second])]);
  assert.equal(between.links.length, 3);
  // Across a page break, words alone don't join; a printed address in two pieces does.
  const pageOne = page([item('more', 200)], [{ ...first, rect: [200, 98, 224, 110] }], 1), pageTwo = page([item('here', 0, { y: 700 })], [{ ...first, rect: [0, 698, 24, 710] }], 2);
  assert.equal(pdfLinks([pageOne, pageTwo]).links.length, 2);
});

test('a printed address cut off at a page’s end is one link, without the next page’s running head', () => {
  // As a typesetter leaves it: "https://" ends the page, the link goes on as a strip across the
  // foot of that page and across the next page's running head, and the address finishes below it.
  const url = 'https://thinkpython.com/code/interlock.py', part = (rect) => ({ rect, url, unsafeUrl: url, internal: false });
  const text = (str, x, y, w) => ({ str, x, y, w, h: 10, rotated: false });
  const one = page([text('For example, “shoe” and “cold” interlock to form “schooled”. Solution:', 162.5, 94, 314), text('https: //', 480.3, 94, 43.6)], [part([479.3, 90.2, 526.6, 102.2]), part([128.6, 67.8, 526.6, 73.4])], 1);
  const head = [text('102', 86.4, 723.6, 14.9), text('Chapter 10. Lists', 403.8, 723.6, 78.6)];
  const rest = [text('thinkpython. com/ code/ interlock. py', 86.4, 696, 179.5), text('.', 267.6, 696, 2.5), text('Credit: an example at a puzzle site.', 275, 696, 180)];
  const two = page([...head, ...rest], [part([85.4, 719, 483.4, 733]), part([85.4, 692.3, 268.6, 704.2])], 2);
  const read = pdfLinks([one, two]);
  assert.deepEqual(rows(read.links), [[1, url, url]], 'one link, on the page it starts on, with the address in one piece');
  assert.equal(read.links[0].context, `For example, “shoe” and “cold” interlock to form “schooled”. Solution: ${url} . Credit: an example at a puzzle site.`, 'the running head is not the link’s context');
  // The strip is known only by the piece that completes the address. Another link to the same
  // address at the top of the next page, with words of its own, is still its own occurrence.
  const other = page([...head, text('Read it here', 86.4, 696, 60)], [part([85.4, 719, 483.4, 733]), part([85.4, 692.3, 147, 704.2])], 2);
  assert.deepEqual(rows(pdfLinks([one, other]).links), [[1, 'https: //', url], [2, '102 Chapter 10. Lists Read it here', url]]);
  // An apostrophe typeset as ’ is the plain one the address has: still one printed address.
  const zipf = "http://en.wikipedia.org/wiki/Zipf's_law";
  const printed = pdfLinks([page([text('(', 129.6, 100, 3.3), text('http: // en. wikipedia. org/ wiki/ Zipf’s_ law', 132.9, 100, 216.5), text('). Specifically,', 351.2, 100, 60)], [{ rect: [131.9, 96.3, 352.2, 108.2], url: zipf, unsafeUrl: zipf, internal: false }])]);
  assert.deepEqual(rows(printed.links), [[1, 'http://en.wikipedia.org/wiki/Zipf’s_law', zipf]]);
});

test('addresses are checked again: only web, email and phone addresses are links', () => {
  const result = pdfLinks([page([item('a b c d e', 0)], [
    linkAt(0, 6, '', { unsafeUrl: 'appendix.pdf' }), linkAt(12, 18, '', { unsafeUrl: 'javascript:alert(1)' }), linkAt(24, 30, '', { unsafeUrl: '' }),
    { rect: [36, 98, 42, 110], url: '', unsafeUrl: '', internal: true }, linkAt(48, 54, 'ftp://files.example/x'), linkAt(48, 54, '', { unsafeUrl: 'www.example.org/page' }),
  ])]);
  assert.deepEqual(rows(result.links), [[1, 'e', 'https://www.example.org/page']]);
  assert.equal(result.links[0].originalHref, 'www.example.org/page', 'as written in the PDF');
  assert.equal(result.internal, 1);
  assert.equal(result.skipped.length, 4);
});

test('limits: pages, links, and the PDFs of one ZIP or one combined PDF', async () => {
  const doc = { numPages: MAX_PDF_PAGES + 1, getPage: async () => { throw new Error('never read'); } };
  await assert.rejects(pdfPages(doc), /has 2,001 pages\. Link Meteor reads PDFs of up to 2,000 pages\./);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(withPdf(await fixture('paper.pdf'), (open) => pdfPages(open, { signal: controller.signal })), /canceled/);
  const many = page([], Array.from({ length: MAX_IMPORT_LINKS + 5 }, (_, i) => linkAt(0, 6, `https://many.example/${i}`)));
  const capped = pdfLinks([many], { saveContext: false });
  assert.deepEqual([capped.links.length, capped.capped], [MAX_IMPORT_LINKS, 5]);
  assert.equal(pdfSetProblem(Array(MAX_PDF_SET).fill(1000)), '');
  assert.equal(pdfSetProblem(Array(MAX_PDF_SET + 1).fill(1000)), 'Choose up to 20 PDFs at a time.');
  assert.equal(pdfSetProblem([MAX_PDF_BYTES + 1]), 'A PDF can be at most 50 MB.');
  assert.equal(pdfSetProblem(Array(5).fill(MAX_PDF_BYTES)), 'These PDFs are more than 200 MB together. Choose fewer.');
  assert.equal(MAX_PDF_SET_BYTES, 200 * 1024 * 1024);
});

test('what a PDF says about itself is believed only where the first page agrees', () => {
  const first = page([item('Journal of Things', 72, { y: 740, h: 9 }), item('The Real Title of the Paper', 72, { y: 700, h: 18 }), item('Ada Example and Ben Sample', 72, { y: 670 }),
    item('doi:10.5555/one.1 and doi:10.5555/two.2 are cited here, in body text that is ten points tall.', 72, { y: 640 })], []);
  // A file name as the title, and an author who isn't printed: the largest text, and no authors.
  assert.deepEqual(pdfCitation({ info: { Title: 'PLME0208_696-701.indd', Author: 'design08' }, firstPage: first }), { title: 'The Real Title of the Paper', source: 'pdf' }, 'two DOIs on the page: neither is the paper’s');
  // A title that isn't printed on the page is not trusted either.
  assert.equal(pdfCitation({ info: { Title: 'Some Other Document' }, firstPage: first }).title, 'The Real Title of the Paper');
  // Printed authors are kept, however the metadata separates them.
  for (const Author of ['Ada Example; Ben Sample', 'Ada Example and Ben Sample', 'Ada Example, Ben Sample']) assert.deepEqual(pdfCitation({ info: { Author }, firstPage: first }).authors, ['Ada Example', 'Ben Sample'], Author);
  assert.equal(pdfCitation({ info: { Author: 'Ada Example; Carl Unprinted' }, firstPage: first }).authors, undefined, 'one unprinted name: none are kept');
  // One DOI on the page is the paper's; arXiv's own DOI for the stamped paper is not a second one.
  const one = page([item('Title Here In Big Type', 72, { y: 700, h: 18 }), item('https://doi.org/10.5555/only.1 is where this was published, in ten-point body text.', 72, { y: 640 }),
    item('arXiv:2409.11211v1 [cs.CV] 17 Sep 2024', 20, { rotated: true })], []);
  const stamped = pdfCitation({ firstPage: one, links: [{ pdfPage: 1, url: 'https://doi.org/10.48550/arXiv.2409.11211' }, { pdfPage: 2, url: 'https://doi.org/10.5555/later.9' }] });
  assert.deepEqual([stamped.doi, stamped.arxiv, stamped.arxivVersion, stamped.arxivCategory, stamped.date], ['10.5555/only.1', '2409.11211', 'v1', 'cs.CV', '17 Sep 2024']);
  // The file's creation date is never a publication date, and nothing usable gives no citation.
  assert.equal(pdfCitation({ info: { CreationDate: "D:20240917120000Z" }, firstPage: page([item('same size text only', 72, { y: 700 })], []) }), null);
  assert.equal(pdfCitation({}), null);
  assert.equal(pdfCitation({ firstPage: one, address: 'file:///Users/someone/paper.pdf' }).pdfUrl, undefined);
  // A signed address over 2,000 characters: the citation without it, as for a web page's PDF address.
  const signed = `https://cdn.example.org/paper.pdf?X-Amz-Signature=${'a1'.repeat(1100)}`;
  assert.deepEqual([pdfCitation({ firstPage: one, address: signed }).pdfUrl, pdfCitation({ firstPage: one, address: 'https://cdn.example.org/paper.pdf?s=1#page=2' }).pdfUrl], [undefined, 'https://cdn.example.org/paper.pdf?s=1']);
});

test('combining PDFs: every page in order, with its links and text, readable again', async () => {
  const parts = [await fixture('paper.pdf'), await fixture('journal.pdf'), await fixture('notes.pdf')];
  const combined = await combinePdfs(parts);
  assert.deepEqual([combined.pages, combined.counts], [7, [3, 2, 2]]);
  assert.equal(isPdf(combined.bytes), true);
  const result = await readPdf(combined.bytes);
  assert.equal(result.pageCount, 7);
  const each = await Promise.all(parts.map((bytes) => readPdf(bytes)));
  const offsets = [0, 3, 5];
  assert.deepEqual(rows(result.links), each.flatMap((part, i) => part.links.map((link) => [link.pdfPage + offsets[i], link.anchorText, link.url])));
  const reversed = await readPdf((await combinePdfs([parts[2], parts[0]])).bytes);
  assert.deepEqual(rows(reversed.links).slice(0, 2), [[1, 'the map', 'https://maps.example.org/site-4'], [3, '', 'https://orcid.org/0000-0002-1825-0097']], 'the order is the list’s');
  // A part that can't be opened is refused by name before anything is written.
  await assert.rejects(combinePdfs([parts[0], await fixture('password.pdf')]), { name: 'PasswordException', part: 1 });
  await assert.rejects(combinePdfs([await fixture('damaged.pdf'), parts[0]]), { name: 'InvalidPDFException', part: 0 });
  await assert.rejects(combinePdfs([]), /at least one PDF/);
  await assert.rejects(combinePdfs(Array(21).fill(parts[2])), /Choose up to 20 PDFs at a time\./);
  assert.deepEqual(new Uint8Array((await combinePdfs([parts[2]])).bytes), new Uint8Array(parts[2]), 'one PDF alone is itself');
  // A PDF built on the spot, to show the generator is usable from a test.
  assert.equal((await readPdf(makePdf({ pages: [[{ parts: ['Only ', { text: 'this', url: 'https://only.example/' }] }]] }))).links[0].anchorText, 'this');
});

// Lines in a proportional face, as TeX sets them: one text run per line, spaces as gaps, justified
// to a column. The reader gives a run's width, not each character's.
const typeset = (face, sentences, width = 468) => makePdf({ pages: [sentences.map((parts) => ({ face, size: 10, width, leading: 1.5, parts }))] });
const anchors = async (bytes) => (await readPdf(bytes, { saveContext: false })).links.map((link) => link.anchorText);

test('anchor text in proportional type: the link’s whole words, without a letter more or less', async () => {
  const sentences = [
    ['The code, the data and the trained weights are on our ', { text: 'project page', url: 'https://p.example/' }, ', which we keep up to date.'],
    ['These languages are documented in the ', { text: 'supplemental material', url: 'https://github.com/openai/gpt-3' }, '. In order to better understand translation capability, we'],
    [{ text: 'Mamba', url: 'https://github.com/state-spaces/mamba' }, ' is a selective state space model with linear time scaling in the length of the sequence.'],
    ['We illustrate it with a minimal iterative jitter ', { text: 'in', url: 'https://in.example/' }, ' the attention maps of a large Transformer model.'],
  ];
  for (const face of Object.keys(FACES)) {
    assert.deepEqual(await anchors(typeset(face, sentences, 520)), ['project page', 'supplemental material', 'Mamba', 'in'], face);
    assert.deepEqual(await anchors(typeset(face, sentences, 0)), ['project page', 'supplemental material', 'Mamba', 'in'], `${face}, not justified`);
  }
  // Many sentences, each with a link over one to four of its words, in two column widths.
  let seed = 11;
  const random = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor((seed / 2147483648) * n); };
  const words = 'the of and a to in is we our model project page code data results see method this paper with for at on by from available Section Table Figure GitHub repository released Python implementation dataset benchmark training evaluation arXiv large small mini fast slow simple in-context learning Transformer attention BERT GPT-3 LLaMA ImageNet COCO Wikipedia 2023 12 3.5 multi-task zero-shot fine-tuned We It All illustrated minimal iterative jitter'.split(' ');
  for (const face of Object.keys(FACES)) {
    for (const width of [468, 240]) {
      const expected = [], lines = [];
      while (lines.length < 30) {
        const sentence = Array.from({ length: 4 + random(10) }, () => words[random(words.length)]);
        if ([...sentence.join(' ')].reduce((sum, char) => sum + FACES[face].widths[char.charCodeAt(0) - 32] / 100, 0) > width * 0.95) continue;
        const from = random(sentence.length), to = from + 1 + random(Math.min(4, sentence.length - from));
        const before = sentence.slice(0, from).join(' '), after = sentence.slice(to).join(' ');
        lines.push([before && `${before} `, { text: sentence.slice(from, to).join(' '), url: `https://x.example/${lines.length}` }, `${after && ` ${after}`}.`].filter(Boolean));
        expected.push(sentence.slice(from, to).join(' '));
      }
      assert.deepEqual(await anchors(typeset(face, lines, width)), expected, `${face}, ${width} points`);
    }
  }
});

test('a printed address in a typewriter face, wrapped after its dot, reads in one piece', () => {
  // As GPT-4's references have it: the link's first rectangle stops short of the dot that ends its line.
  const url = 'https://github.com/inverse-scaling/prize', at = (str, x, y, w, mono) => ({ str, x, y, w, h: 10, rotated: false, mono });
  const items = [at('Sam Bowman, and Ethan Perez. The Inverse Scaling Prize, 2022. URL', 129.579, 151.755, 296.7, false), at('https://github.', 429.224, 151.755, 78.441, true),
    at('com/inverse-scaling/prize', 129.579, 140.846, 131.222, true), at('.', 260.8, 140.846, 2.5, false)];
  const read = pdfLinks([page(items, [{ rect: [428.227, 148.545, 504.996, 159.668], url, unsafeUrl: url, internal: false }, { rect: [128.583, 137.636, 261.801, 148.759], url, unsafeUrl: url, internal: false }])]);
  assert.deepEqual(rows(read.links), [[1, url, url]]);
  assert.equal(read.links[0].context, `Sam Bowman, and Ethan Perez. The Inverse Scaling Prize, 2022. URL ${url}.`);
  // Punctuation around a printed address isn't the address's.
  const wrapped = pdfLinks([page([item('see (https://x.example/a).', 0)], [linkAt(29, 145, 'https://x.example/a')])]);
  assert.equal(wrapped.links[0].anchorText, 'https://x.example/a');
});

test('words that spell the end of an address keep their spaces; only an address split across lines is joined', () => {
  const url = 'https://example.org/linkmeteor';
  assert.equal(pdfLinks([page([item('Read about Link Meteor here.', 0)], [linkAt(66, 132, url)])]).links[0].anchorText, 'Link Meteor');
  // Wrapped onto the next line, still two words.
  const wrapped = pdfLinks([page([item('Read about Link', 300), item('Meteor here.', 0, { y: 86 })], [linkAt(366, 390, url), { ...linkAt(0, 36, url), rect: [0, 84, 36, 96] }])]);
  assert.deepEqual(rows(wrapped.links), [[1, 'Link Meteor', url]]);
});

test('the same address on lines one under the other is each line’s own link: a mirror, a table’s rows', () => {
  const url = 'https://x.example/file';
  const mirrors = pdfLinks([page([item('Download: https://x.example/file', 0), item('Mirror: https://x.example/file', 0, { y: 86 })],
    [linkAt(60, 192, url), { ...linkAt(48, 180, url), rect: [48, 84, 180, 96] }])]);
  assert.deepEqual(rows(mirrors.links), [[1, url, url], [1, url, url]]);
  // A table whose first column links "UCI" to one address on every row.
  const uci = 'https://archive.ics.uci.edu/';
  const table = pdfLinks([page([0, 1, 2].flatMap((row) => [item('UCI', 0, { y: 100 - 14 * row }), item(`${48842 + row}`, 200, { y: 100 - 14 * row }), item('14', 300, { y: 100 - 14 * row })]),
    [0, 1, 2].map((row) => ({ ...linkAt(0, 18, uci), rect: [0, 98 - 14 * row, 18, 110 - 14 * row] })))]);
  assert.deepEqual(rows(table.links), [[1, 'UCI', uci], [1, 'UCI', uci], [1, 'UCI', uci]]);
});

test('an address cut off at the foot of a column goes on at the top of the next: one link', () => {
  const url = 'https://example.org/a/very/long/path';
  const read = pdfLinks([page([item('the code is at https://example.org/a/very/', 72, { y: 80 }), item('long/path and the rest of the words.', 320, { y: 700 })],
    [{ ...linkAt(0, 0, url), rect: [156, 78, 324, 90] }, { ...linkAt(0, 0, url), rect: [320, 698, 374, 710] }])]);
  assert.deepEqual(rows(read.links), [[1, url, url]]);
  // Words alone don't join across a column break.
  const two = pdfLinks([page([item('see example.org', 72, { y: 80 }), item('example.org again', 320, { y: 700 })],
    [{ ...linkAt(0, 0, 'https://example.org/'), rect: [96, 78, 162, 90] }, { ...linkAt(0, 0, 'https://example.org/'), rect: [320, 698, 386, 710] }])]);
  assert.equal(two.links.length, 2);
});

test('a link over two lines, given as one rectangle per line, takes only those lines’ words', async () => {
  // Courier at 11 points: 6.6 points a character. "see the project" / "page for details".
  const bytes = makePdf({ pages: [[{ parts: ['see the project'] }, { parts: ['page for details'] },
    { area: 'https://q.example/', boxes: [[98.4, 717, 171, 731], [72, 699, 98.4, 713]] }]] });
  const { links } = await readPdf(bytes);
  assert.deepEqual(rows(links), [[1, 'the project page', 'https://q.example/']]);
  // Its one rectangle alone covers both lines whole.
  assert.equal(pdfLinks([page([item('see the project', 0), item('page for details', 0, { y: 86 })], [{ ...linkAt(0, 0, 'https://q.example/'), rect: [0, 84, 96, 110] }])]).links[0].anchorText, 'see the project page for details');
});

test('text turned sideways, as on a landscape page, is read as the link’s words', async () => {
  const bytes = makePdf({ pages: [[{ rotate: 'example.org/data', x: 300, y: 200, url: 'https://example.org/data' }, { rotate: 'the downward words', x: 400, y: 600, turn: 270, url: 'https://down.example/' }]] });
  const { links } = await readPdf(bytes);
  assert.deepEqual(rows(links), [[1, 'example.org/data', 'https://example.org/data'], [1, 'the downward words', 'https://down.example/']]);
});

test('in a reference list, a link’s context is the whole reference; elsewhere, its line', () => {
  const ref = (str, x, y) => item(str, x, { y });
  const labeled = [ref('[1] A. Author and B. Author. A first title that runs on', 72, 700), ref('over two lines. In Proc. Things, 2020.', 96, 689),
    ref('[2] C. Writer. A second title, with its code at', 72, 678), ref('https://code.example/two and more words. 2021.', 96, 667), ref('[3] D. Person. The third one. 2022.', 72, 656)];
  const url = 'https://code.example/two', at = { ...linkAt(0, 0, url), rect: [96, 665, 240, 677] };
  assert.equal(pdfLinks([page(labeled, [at])]).links[0].context, '[2] C. Writer. A second title, with its code at https://code.example/two and more words. 2021.');
  // Without labels: each reference set out to the left of its other lines, with gaps between.
  const hanging = [ref('Ada Example. A first title that runs on', 72, 700), ref('over two lines. 2020.', 82, 689),
    ref('Ben Sample. A second title, with its code at', 72, 671), ref('https://code.example/two and more words. 2021.', 82, 660), ref('Carl Third. The third one,', 72, 642), ref('on two lines. 2022.', 82, 631)];
  assert.equal(pdfLinks([page(hanging, [{ ...at, rect: [82, 658, 226, 670] }])]).links[0].context, 'Ben Sample. A second title, with its code at https://code.example/two and more words. 2021.');
  // A paragraph of prose (its first line set in, not out) keeps the line the link is on.
  const prose = [ref('A paragraph begins here, set in from the left as paragraphs are,', 90, 700), ref('and its code is at https://code.example/two for anyone', 72, 689), ref('who wants it, and then it goes on to its end.', 72, 678)];
  assert.equal(pdfLinks([page(prose, [{ ...at, rect: [186, 687, 330, 699] }])]).links[0].context, 'and its code is at https://code.example/two for anyone');
});

test('a DOI on page 1 is the paper’s own only when it isn’t a repository’s code or data', () => {
  const first = (line) => page([item('A Paper With Code And Data', 72, { y: 700, h: 18 }), item(line, 72, { y: 640 }), item('arXiv:2409.11211v1 [cs.CV] 17 Sep 2024', 20, { rotated: true })], []);
  const zenodo = pdfCitation({ firstPage: first('Code and weights: https://doi.org/10.5281/zenodo.5371628 (archived).') });
  assert.deepEqual([zenodo.arxiv, zenodo.doi], ['2409.11211', undefined], 'the code’s DOI is not the paper’s');
  assert.equal(pdfCitation({ firstPage: first('Published as doi:10.5555/journal.1, data at doi:10.6084/m9.figshare.42.') }).doi, '10.5555/journal.1');
});
