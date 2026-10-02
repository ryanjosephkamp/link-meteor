// PDF files (0.6.0): which links are PDFs and how their files are named (src/core/files.js), the
// ZIP they go into (src/core/zip.js), read back by the release ZIP reader, and a PDF combined from
// the fixtures in an order of the person's choosing, read back with the shipped PDF.js. The run
// that fetches the files is checked in tests/runs.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isPdfLink, pdfLinks, pdfFileName, uniqueNames, fileLinks, downloadName } from '../src/core/files.js';
import { zip } from '../src/core/zip.js';
import { pdfSetProblem, MAX_PDF_SET, MAX_PDF_BYTES, MAX_PDF_SET_BYTES } from '../src/core/pdf.js';
import { readPackagedMembers } from '../scripts/verify-package.mjs';
import { fixture, readPdf, combinePdfs } from './helpers/pdf.mjs';

const link = (anchorText, url, extra = {}) => ({ anchorText, url, ...extra });

test('a PDF link ends in .pdf, is a known PDF address, or is labeled [PDF] with no other file type', () => {
  for (const item of [
    link('Paper', 'https://example.org/papers/one.pdf'),
    link('Paper', 'https://example.org/papers/ONE.PDF?download=1#page=3'),
    link('', 'https://arxiv.org/pdf/2409.11211v1'),
    link('Review', 'https://openreview.net/pdf?id=abc123'),
    link('[PDF] example.org', 'https://example.org/view/123'),
    link('  [pdf] A page that is a PDF', 'http://example.org/get?id=9'),
  ]) assert.equal(isPdfLink(item), true, item.url);
  for (const item of [
    link('Slides', 'https://example.org/talk.pptx'),
    link('[PDF] PostScript in fact', 'https://example.org/paper.ps'),
    link('A web page', 'https://example.org/papers/one'),
    link('PDF of the paper', 'https://example.org/papers/one'),
    link('Paper', 'mailto:someone@example.org?subject=paper.pdf'),
    link('Paper', 'ftp://example.org/paper.pdf'),
    link('Paper', 'not an address.pdf'),
  ]) assert.equal(isPdfLink(item), false, item.url);
});

test('the PDFs among the chosen links: one per address, in the list’s order, other files left out', () => {
  const links = [
    link('Second', 'https://example.org/b.pdf'), link('A picture', 'https://example.org/figure.png'), link('First', 'https://example.org/a.pdf'),
    link('Second again', 'https://example.org/b.pdf'), link('A page', 'https://example.org/'), link('[PDF] third', 'https://example.org/c'),
  ];
  assert.deepEqual(pdfLinks(links).map((item) => item.anchorText), ['Second', 'First', '[PDF] third']);
  assert.equal(fileLinks(links).length, 4, 'Download files still takes every file');
});

test('a PDF’s file name is the one Download files gives it, always ending .pdf', () => {
  const cases = [
    [link('A small paper about links', 'https://example.org/x/paper.pdf'), 'A-small-paper-about-links.pdf'],
    [link('[PDF] arxiv.org', 'https://arxiv.org/pdf/2409.11211v1'), 'arxiv.org.pdf'],
    [link('', 'https://arxiv.org/pdf/2409.11211v1'), '2409.11211v1.pdf'],
    [link('', 'https://example.org/files/Field%20notes%20(final).pdf'), 'Field-notes-final.pdf'],
    [link('report.pdf', 'https://example.org/get?id=7', { anchorText: '[PDF] report.pdf' }), 'report.pdf'],
    [link('Größe: “Über/Unter” — 50%?', 'https://example.org/a.pdf'), 'Große-Uber-Unter-50.pdf'],
    [link('../../etc/passwd', 'https://example.org/a.pdf'), 'etc-passwd.pdf'],
    [link('a\\b:c*d?e"f<g>h|i', 'https://example.org/a.pdf'), 'a-b-c-d-e-f-g-h-i.pdf'],
    [link('CON', 'https://example.org/a.pdf'), 'CON_.pdf'],
    [link('研究 論文 ①', 'https://example.org/a.pdf'), '研究-論文-1.pdf'],
    [link('🙂', 'https://example.org/papers/smile.pdf'), 'smile.pdf'],
    [link('', 'https://example.org/'), 'file.pdf', true],
    [link('x'.repeat(300), 'https://example.org/a.pdf'), `${'x'.repeat(100)}.pdf`],
  ];
  for (const [item, name, notPdf] of cases) {
    assert.equal(pdfFileName(item), name, `${item.anchorText} ${item.url}`);
    if (!notPdf) assert.equal(isPdfLink(item), true, item.url);
    assert.match(pdfFileName(item), /^[\p{L}\p{N}._-]+\.pdf$/u, 'only letters, digits, dots, underscores and hyphens');
  }
  // The same name Download files uses once Chrome reports a PDF.
  assert.equal(pdfFileName(cases[0][0]), downloadName(cases[0][0], { mime: 'application/pdf' }));
});

test('repeated names get (2), (3) before the extension, whatever their case', () => {
  assert.deepEqual(uniqueNames(['Paper.pdf', 'Notes.pdf', 'Paper.pdf', 'paper.pdf', 'Paper.pdf']), ['Paper.pdf', 'Notes.pdf', 'Paper (2).pdf', 'paper (3).pdf', 'Paper (4).pdf']);
  assert.deepEqual(uniqueNames(['a.pdf', 'a (2).pdf', 'a.pdf', 'a.pdf']), ['a.pdf', 'a (2).pdf', 'a (3).pdf', 'a (4).pdf'], 'a number already taken is passed over');
  assert.deepEqual(uniqueNames(['a.pdf', 'a.pdf', 'a (2).pdf']), ['a.pdf', 'a (2).pdf', 'a (2) (2).pdf']);
  assert.deepEqual(uniqueNames(['file', 'file', '.hidden', '.hidden', 'v1.2.pdf', 'v1.2.pdf']), ['file', 'file (2)', '.hidden', '.hidden (2)', 'v1.2.pdf', 'v1.2 (2).pdf']);
  assert.deepEqual(uniqueNames([]), []);
  const many = uniqueNames(Array.from({ length: 20 }, () => 'Same.pdf'));
  assert.equal(new Set(many.map((name) => name.toLowerCase())).size, 20);
  assert.equal(many[19], 'Same (20).pdf');
});

test('the ZIP holds the PDFs and nothing else, each byte for byte, under its own name', async () => {
  const names = ['paper.pdf', 'journal.pdf', 'notes.pdf', 'password.pdf'];
  const files = await Promise.all(names.map(fixture));
  // Two links with the same words, one with odd characters, one PDF that needs a password.
  const links = [link('A study', 'https://example.org/1.pdf'), link('A study', 'https://example.org/2.pdf'), link('Notes: “field” / lab — 2026', 'https://example.org/3.pdf'), link('', 'https://example.org/locked/review-2022.pdf')];
  const entries = uniqueNames(links.map(pdfFileName));
  assert.deepEqual(entries, ['A-study.pdf', 'A-study (2).pdf', 'Notes-field-lab-2026.pdf', 'review-2022.pdf']);
  const archive = zip(entries.map((name, index) => [name, new Uint8Array(files[index])]));
  const members = readPackagedMembers(Buffer.from(archive));
  assert.deepEqual([...members.keys()], entries, 'no index, no folder, nothing but the PDFs');
  for (const [index, name] of entries.entries()) assert.ok(members.get(name).equals(files[index]), `${name} is what the site sent`);
  assert.equal(archive.length, files.reduce((sum, file, index) => sum + file.length + 76 + 2 * Buffer.byteLength(entries[index]), 22), 'stored, not compressed');
  assert.deepEqual(archive, zip(entries.map((name, index) => [name, new Uint8Array(files[index])])), 'the same files give the same ZIP');
  // A PDF that needs a password goes in as it is, and still needs it.
  await assert.rejects(readPdf(members.get('review-2022.pdf')), { name: 'PasswordException' });
});

test('a combined PDF follows the list’s order, and a part that can’t be opened is named', async () => {
  const [paper, journal, notes, locked, damaged] = await Promise.all(['paper.pdf', 'journal.pdf', 'notes.pdf', 'password.pdf', 'damaged.pdf'].map(fixture));
  const pages = { paper: (await readPdf(paper)).pageCount, journal: (await readPdf(journal)).pageCount, notes: (await readPdf(notes)).pageCount };
  // The order the person arranged: notes, paper, journal.
  const made = await combinePdfs([notes, paper, journal]);
  assert.deepEqual(made.counts, [pages.notes, pages.paper, pages.journal]);
  assert.equal(made.pages, pages.notes + pages.paper + pages.journal);
  const again = await readPdf(made.bytes), first = await readPdf(paper);
  assert.equal(again.pageCount, made.pages);
  // The paper's links are all there, on their pages after the notes' pages.
  const moved = again.links.filter((item) => item.pdfPage > pages.notes && item.pdfPage <= pages.notes + pages.paper);
  assert.deepEqual(moved.map((item) => [item.url, item.pdfPage - pages.notes]), first.links.map((item) => [item.url, item.pdfPage]));
  // Another order gives another PDF with the same pages.
  const other = await combinePdfs([journal, notes, paper]);
  assert.deepEqual([other.counts, other.pages], [[pages.journal, pages.notes, pages.paper], made.pages]);
  assert.deepEqual((await readPdf(other.bytes)).links.filter((item) => item.pdfPage > pages.journal + pages.notes).map((item) => item.url), first.links.map((item) => item.url));
  // One PDF alone is itself.
  assert.deepEqual((await combinePdfs([paper])).bytes, new Uint8Array(paper));
  // A part that needs a password, or is damaged, is refused by its place in the list.
  await assert.rejects(combinePdfs([notes, locked, paper]), (error) => error.name === 'PasswordException' && error.part === 1);
  await assert.rejects(combinePdfs([notes, paper, damaged]), (error) => error.part === 2);
});

test('the limits, in the words the panel uses', () => {
  assert.equal(pdfSetProblem(Array(MAX_PDF_SET).fill(0)), '');
  assert.equal(pdfSetProblem(Array(MAX_PDF_SET + 1).fill(0)), 'Choose up to 20 PDFs at a time.');
  assert.equal(pdfSetProblem([MAX_PDF_BYTES]), '');
  assert.equal(pdfSetProblem([MAX_PDF_BYTES + 1]), 'A PDF can be at most 50 MB.');
  assert.equal(pdfSetProblem(Array(4).fill(MAX_PDF_BYTES)), '');
  assert.equal(pdfSetProblem([...Array(4).fill(MAX_PDF_BYTES), 1]), 'These PDFs are more than 200 MB together. Choose fewer.');
  assert.equal(MAX_PDF_SET_BYTES, 4 * MAX_PDF_BYTES);
});
