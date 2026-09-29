// File links and download names (0.4.0): src/core/files.js, and the capture card's own copy of
// the file-link rule in src/content/capture.js, which must decide exactly as the module does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FILE_TYPES, FILE_KINDS, isFileLink, fileLinks, urlFileType, knownPdf, isWebPage, downloadExtension, downloadName, downloadFolder, downloadPath, folderLabel, menuPatterns, DOWNLOAD_LIMIT, DOWNLOAD_CONFIRM_ABOVE, DOWNLOAD_PARALLEL } from '../src/core/files.js';

const root = resolve(import.meta.dirname, '..');
const link = (url, anchorText = '', accessibleLabel = '') => ({ url, anchorText, accessibleLabel });

// [url, anchor text, is a file link]
const CASES = [
  ['https://lab.test/papers/attention.pdf', 'Attention', true],
  ['https://lab.test/papers/ATTENTION.PDF', '', true],
  ['https://lab.test/papers/geometry.pdf?edition=2', '', true],
  ['https://lab.test/papers/geometry.pdf#page=3', '', true],
  ['http://lab.test/notes.docx', '', true],
  ['https://lab.test/sheet.xlsx', '', true],
  ['https://lab.test/deck.odp', '', true],
  ['https://lab.test/data/results.csv', '', true],
  ['https://lab.test/refs.bib', '', true],
  ['https://lab.test/book.epub', '', true],
  ['https://lab.test/code/archive.tar.gz', '', true],
  ['https://lab.test/img/figure-1.PNG', '', true],
  ['https://lab.test/img/photo.jpeg', '', true],
  ['https://lab.test/audio/talk.mp3', '', true],
  ['https://lab.test/video/demo.webm', '', true],
  ['https://arxiv.org/pdf/2301.00001', '', true],
  ['https://arxiv.org/pdf/2301.00001v2', '', true],
  ['https://export.arxiv.org/pdf/2301.00001', '', true],
  ['https://arxiv.org/abs/2301.00001', '', false],
  ['https://arxiv.org/pdf/', '', false],
  ['https://openreview.net/pdf?id=AbC123', '', true],
  ['https://openreview.net/forum?id=AbC123', '', false],
  ['https://openreview.net/pdf', '', false],
  ['https://dl.acm.org/doi/pdf/10.1145/1234567.1234568', '', true],
  ['https://dl.acm.org/doi/10.1145/1234567.1234568', '', false],
  ['https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1234567/pdf/main.pdf', '', true],
  ['https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1234567/pdf/', '', true],
  ['https://pmc.ncbi.nlm.nih.gov/articles/PMC1234567/pdf', '', true],
  ['https://pmc.ncbi.nlm.nih.gov/articles/PMC1234567/', '', false],
  ['https://scholar.example/download?id=7', '[PDF] arxiv.org', true],
  ['https://scholar.example/download?id=7', '  [pdf] lab.test', true],
  ['https://scholar.example/download?id=7', '[HTML] lab.test', false],
  ['https://scholar.example/download?id=7', 'Read the [PDF] here', false],
  ['https://lab.test/', '', false],
  ['https://lab.test/about.html', '', false],
  ['https://lab.test/index.htm', '', false],
  ['https://lab.test/page.php?file=a.pdf', '', false],
  ['https://lab.test/v1.2/', '', false],
  ['https://lab.test/setup.exe', '', false],
  ['https://lab.test/pdf', '', false],
  ['mailto:research@lab.test?subject=a.pdf', '', false],
  ['tel:+15550123', '', false],
  ['javascript:alert(1)//a.pdf', '', false],
  ['ftp://lab.test/a.pdf', '', false],
  ['not a url.pdf', '', false],
  ['', '[PDF] no address', false],
];

test('file links: a file type in the path, a [PDF] label, or a known PDF address', () => {
  for (const [url, anchorText, expected] of CASES) assert.equal(isFileLink(link(url, anchorText)), expected, `${url} ${anchorText}`);
  assert.equal(isFileLink(null), false);
  assert.equal(isFileLink({ url: 42 }), false);
  assert.equal(urlFileType('https://lab.test/a.PDF?x=1'), 'pdf');
  assert.equal(urlFileType('https://lab.test/a.html'), '');
  assert.equal(knownPdf('http://arxiv.org/pdf/1'), true);
  assert.equal(knownPdf('https://evil.test/arxiv.org/pdf/1'), false);
});

test('the file types cover every kind the contract names, and never web pages or programs', () => {
  assert.deepEqual(Object.keys(FILE_KINDS), ['documents', 'office', 'openDocument', 'textAndData', 'ebooks', 'archives', 'images', 'audio', 'video']);
  for (const type of ['pdf', 'docx', 'xlsx', 'pptx', 'odt', 'csv', 'json', 'epub', 'zip', 'png', 'jpg', 'svg', 'mp3', 'mp4']) assert.ok(FILE_TYPES.has(type), type);
  for (const type of ['html', 'htm', 'php', 'asp', 'exe', 'msi', 'dmg', 'apk', 'js', 'sh', 'bat']) assert.ok(!FILE_TYPES.has(type), type);
  // The workbench's File type badges are all file types too.
  for (const type of ['pdf', 'csv', 'tsv', 'xls', 'xlsx', 'ods', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'ppt', 'pptx', 'odp', 'epub', 'json', 'xml', 'zip', 'gz', 'tar', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'tif', 'tiff', 'mp3', 'mp4', 'wav', 'mov', 'webm', 'bib', 'ris']) assert.ok(FILE_TYPES.has(type), `badge ${type}`);
  assert.deepEqual([DOWNLOAD_LIMIT, DOWNLOAD_CONFIRM_ABOVE, DOWNLOAD_PARALLEL], [100, 10, 3]);
});

test('the capture card’s copy of the rule decides exactly as core/files.js', async () => {
  const script = await readFile(resolve(root, 'src/content/capture.js'), 'utf8');
  const line = script.split('\n').find((text) => text.trim().startsWith('const FILE_TYPES='));
  assert.ok(line, 'the page script defines FILE_TYPES and fileLink on one line');
  const { types, fileLink } = new Function(`${line}\nreturn {types: FILE_TYPES, fileLink};`)();
  assert.deepEqual([...types].sort(), [...FILE_TYPES].sort(), 'the same file types');
  const urls = [...new Set(CASES.map(([url]) => url))];
  for (const [url, anchorText] of [...CASES, ...urls.map((url) => [url, '[PDF] x']), ...[...FILE_TYPES].map((type) => [`https://lab.test/f.${type.toUpperCase()}?q=1`, ''])]) {
    assert.equal(fileLink(link(url, anchorText)), isFileLink(link(url, anchorText)), `${url} ${anchorText}`);
  }
});

test('fileLinks keeps one link per address, in order', () => {
  const links = [link('https://lab.test/a.pdf', 'A'), link('https://lab.test/page'), link('https://lab.test/b.png', 'B'), link('https://lab.test/a.pdf', 'A again'), link('HTTPS://LAB.TEST/b.png', 'B again')];
  assert.deepEqual(fileLinks(links).map((item) => item.anchorText), ['A', 'B']);
});

test('extensions: web pages save as .html; otherwise the address, then the type Chrome reports, then Chrome’s name', () => {
  assert.equal(downloadExtension('https://lab.test/a.pdf', { mime: 'application/pdf' }), 'pdf');
  assert.equal(downloadExtension('https://lab.test/a.pdf', { mime: 'text/html; charset=utf-8' }), 'html', 'a sign-in page is never a fake PDF');
  assert.equal(downloadExtension('https://lab.test/a.pdf', { mime: 'application/xhtml+xml' }), 'html');
  assert.equal(downloadExtension('https://lab.test/a.pdf', { mime: 'application/octet-stream' }), 'pdf', 'the address wins over a generic type');
  assert.equal(downloadExtension('https://lab.test/download?id=3', { mime: 'application/pdf' }), 'pdf');
  assert.equal(downloadExtension('https://lab.test/download?id=3', { mime: 'image/jpeg' }), 'jpg');
  assert.equal(downloadExtension('https://lab.test/download?id=3', { mime: 'application/x-thing', suggested: 'report.Thing' }), 'thing');
  assert.equal(downloadExtension('https://arxiv.org/pdf/2301.00001'), 'pdf', 'a known PDF address before Chrome answers');
  assert.equal(downloadExtension('https://lab.test/download?id=3'), '');
  assert.equal(isWebPage('TEXT/HTML;charset=utf-8'), true);
  assert.equal(isWebPage('application/pdf'), false);
});

test('names come from the anchor text, made safe, with one extension', () => {
  assert.equal(downloadName(link('https://lab.test/x/2301.pdf', 'Attention in small systems')), 'Attention-in-small-systems.pdf');
  assert.equal(downloadName(link('https://lab.test/x/2301.pdf', 'Geometry, “frames” & 雪: part 2/3')), 'Geometry-frames-雪-part-2-3.pdf');
  assert.equal(downloadName(link('https://lab.test/x/2301.pdf', 'Café résumé')), 'Cafe-resume.pdf');
  assert.equal(downloadName(link('https://lab.test/x/2301.pdf', 'paper.PDF')), 'paper.pdf', 'no doubled extension');
  assert.equal(downloadName(link('https://scholar.example/download?id=7', '[PDF] arxiv.org'), { mime: 'application/pdf' }), 'arxiv.org.pdf', 'the [PDF] label comes off');
  assert.equal(downloadName(link('https://lab.test/x/2301.pdf', '', 'Open the appendix')), 'Open-the-appendix.pdf', 'the accessible label next');
  assert.equal(downloadName(link('https://lab.test/x/Report%20Final.pdf', '   ')), 'Report-Final.pdf', 'then the address’s own name');
  assert.equal(downloadName(link('https://arxiv.org/pdf/2301.00001v2', ''), { mime: 'application/pdf' }), '2301.00001v2.pdf');
  assert.equal(downloadName(link('https://lab.test/', ''), { mime: 'application/pdf' }), 'file.pdf');
  assert.equal(downloadName(link('https://lab.test/', '...'), {}), 'file');
  assert.equal(downloadName(link('https://lab.test/a.pdf', 'Paywalled article'), { mime: 'text/html' }), 'Paywalled-article.html');
  assert.equal(downloadName(link('https://lab.test/a.pdf', 'CON')), 'CON_.pdf', 'Windows device names');
  assert.equal(downloadName(link('https://lab.test/a.pdf', 'nul.backup')), 'nul_.backup.pdf');
  assert.equal(downloadName(link('https://lab.test/a.pdf', '.hidden')), 'hidden.pdf', 'never a hidden file');
  assert.equal(downloadName(link('https://lab.test/a.pdf', '=SUM(1,2)')), 'SUM-1-2.pdf');
  const long = downloadName(link('https://lab.test/a.pdf', 'x'.repeat(300)));
  assert.equal(long, `${'x'.repeat(100)}.pdf`);
});

test('folders: Link Meteor/<collection name>, made safe', () => {
  assert.equal(downloadFolder('Thesis sources'), 'Link Meteor/Thesis-sources');
  assert.equal(downloadFolder(''), 'Link Meteor/links');
  assert.equal(downloadFolder('../../etc'), 'Link Meteor/etc');
  assert.equal(downloadFolder('aux'), 'Link Meteor/aux_');
  assert.equal(downloadPath(link('https://lab.test/f.png', 'Figure 1: heat map'), 'Urban heat islands', { mime: 'image/png' }), 'Link Meteor/Urban-heat-islands/Figure-1-heat-map.png');
  assert.equal(folderLabel('Link Meteor/Urban-heat-islands'), 'Link Meteor › Urban-heat-islands');
  for (const name of ['a/b', 'a\\b', 'C:\\x', '~', '...']) assert.doesNotMatch(downloadFolder(name).slice('Link Meteor/'.length), /[\\/:~]|^\.|\.$/);
});

test('the menu item’s address patterns are valid match patterns for every file type', () => {
  const patterns = menuPatterns();
  const valid = /^\*:\/\/(\*|\*\.[a-z0-9.-]+|[a-z0-9.-]+)\/[^\s]*$/;
  for (const pattern of patterns) assert.match(pattern, valid, pattern);
  for (const type of FILE_TYPES) {
    for (const ext of [type, type.toUpperCase()]) { assert.ok(patterns.includes(`*://*/*.${ext}`), ext); assert.ok(patterns.includes(`*://*/*.${ext}?*`), `${ext}?`); }
  }
  assert.ok(patterns.includes('*://*.arxiv.org/pdf/*'));
  assert.ok(patterns.includes('*://*.openreview.net/pdf?*'));
  assert.equal(new Set(patterns).size, patterns.length, 'no repeats');
});
