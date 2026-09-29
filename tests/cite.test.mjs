// Citation formats (0.5.0): BibTeX, RIS, CSL-JSON, the annotated bibliography and the Obsidian
// note, each compared with a golden file, plus the rules every reader depends on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { citations, citeFirst, citeFacts, dateParts, CITE_FORMATS } from '../src/core/cite.js';
import { makeExport, FORMAT_EXTENSIONS } from '../src/core/export.js';
import { queryLinks } from '../src/core/model.js';
import { LINKS, PAGES, FIELDS, EXPORTED_AT, COLLECTION } from './fixtures/cite-links.mjs';

const GOLDEN = { bibtex: 'links.bib', ris: 'links.ris', csl: 'links.json', annotated: 'links-annotated.md', obsidian: 'links-obsidian.md' };
const golden = async (format) => {
  const text = await readFile(resolve(import.meta.dirname, 'fixtures', 'cite', GOLDEN[format]), 'utf8');
  // The repository keeps text files with LF; RIS is written with CRLF.
  return format === 'ris' ? text.replace(/\r?\n/g, '\r\n') : text;
};
const options = (format, extra = {}) => ({ format, pages: PAGES, fields: FIELDS, collection: COLLECTION, date: EXPORTED_AT, ...extra });
const one = (format, link, pages = {}) => citations([{ accessibleLabel: '', capturedAt: '2026-09-25T12:00:00.000Z', notes: '', tags: [], ...link }], { format, pages });

// BibTeX counts every brace, escaped or not: depth never drops below zero and ends at zero.
function balanced(text) {
  let depth = 0;
  for (const char of text) { if (char === '{') depth++; if (char === '}' && --depth < 0) return false; }
  return depth === 0;
}

test('each format equals its golden file, through makeExport with an about block', async () => {
  for (const format of CITE_FORMATS) {
    const result = makeExport(LINKS, { format, pages: PAGES, fields: FIELDS, about: { exportedAt: EXPORTED_AT, collection: COLLECTION } });
    assert.equal(result.data, await golden(format), format);
    assert.equal(result.extension, FORMAT_EXTENSIONS[format]);
    assert.equal(citations(LINKS, options(format)), result.data, `${format}: citations() is what makeExport writes`);
  }
  assert.deepEqual(Object.fromEntries(CITE_FORMATS.map((format) => [format, FORMAT_EXTENSIONS[format]])), { bibtex: 'bib', ris: 'ris', csl: 'json', annotated: 'md', obsidian: 'md' });
  assert.deepEqual(CITE_FORMATS.map((format) => makeExport(LINKS, { format }).mime), ['application/x-bibtex;charset=utf-8', 'application/x-research-info-systems;charset=utf-8', 'application/vnd.citationstyles.csl+json;charset=utf-8', 'text/markdown;charset=utf-8', 'text/markdown;charset=utf-8']);
});

test('BibTeX: @article only with a journal, Zotero escaping, raw url and doi, balanced braces, unique keys', () => {
  const bib = citations(LINKS, options('bibtex'));
  const entries = bib.trim().split(/\n\n(?=@)/);
  assert.equal(entries.length, LINKS.length);
  for (const entry of entries) {
    assert.ok(balanced(entry), `balanced braces:\n${entry}`);
    assert.match(entry, /^@(misc|article)\{[a-z0-9]+,\n( {2}[A-Za-z]+ *= \{.*\},\n)* {2}[A-Za-z]+ *= \{.*\}\n\}$/, entry);
    assert.doesNotMatch(entry, /howpublished|= \{\}/, 'no howpublished and no empty fields');
  }
  const keys = entries.map((entry) => /^@\w+\{([^,]+),/.exec(entry)[1]);
  assert.equal(new Set(keys).size, keys.length, 'keys are unique');
  assert.deepEqual(keys, ['surface', 'okafor2025', 'okafor2025a', 'attention', 'heat', 'full', 'urban', 'heata', 'surfacea', 'download', 'coolstreets', 'organization', 'write']);
  assert.deepEqual(entries.map((entry) => entry.slice(1, entry.indexOf('{'))), ['misc', 'article', 'article', 'misc', 'misc', 'misc', 'misc', 'misc', 'misc', 'misc', 'misc', 'misc', 'misc']);
  // Escaping, exactly as Zotero writes it.
  assert.equal(one('bibtex', { anchorText: '# $ % & _ \\ ~ ^ { } < > |', url: 'https://example.org/' }).split('\n')[1],
    '  title        = {\\# \\$ \\% \\& \\_ {\\textbackslash} {\\textasciitilde} {\\textasciicircum} \\{\\vphantom{\\}} \\vphantom{\\{}\\} {\\textless} {\\textgreater} {\\textbar}},');
  // url and doi stay raw, except for what would unbalance the entry.
  assert.match(bib, /url {10}= \{https:\/\/example\.org\/a_b\?q=%7Bx%7D&y=%20\}/);
  assert.match(bib, /doi {10}= \{10\.5555\/cool\.2025\.0007\}/);
  assert.match(bib, /eprint {7}= \{1706\.03762v5\},\n {2}archivePrefix = \{arXiv\}/);
  assert.match(bib, /isbn {9}= \{9780306406157\}/);
  assert.match(bib, /urldate {6}= \{2026-09-25\}/);
  // "Family, Given" stays split for BibTeX to read; any other name is kept whole in braces.
  assert.match(bib, /author {7}= \{Okafor, Amara and \{Jun Watanabe\}\}/);
  assert.match(bib, /author {7}= \{\{World Health Organization\} and \{Smith, Jr\., John\}\}/);
  assert.match(one('bibtex', { anchorText: 'x', url: 'https://j.example/a' }, { 'https://j.example/a': { title: 'T', authors: ['Barnes and Noble, Inc', 'Smith, Anna and Bea'] } }), /author {7}= \{\{Barnes and Noble\}, Inc and Smith, \{Anna and Bea\}\}/);
  // Keys: the title's first word when there are no authors, skipping articles; a, b… for repeats.
  const keysOf = (titles) => citations(titles.map((anchorText, i) => ({ anchorText, url: `https://example.org/${i}`, capturedAt: '', tags: [] })), { format: 'bibtex' }).match(/^@\w+\{[^,]+/gm).map((line) => line.split('{')[1]);
  assert.deepEqual(keysOf(['The heat', 'Heat', 'A heat map', 'Über Städte', '雪', '2024 report', 'Heat']), ['heat', 'heata', 'heatb', 'uber', 'link', 'report', 'heatc']);
  assert.equal(citations([], { format: 'bibtex' }), '');
});

test('RIS: CRLF only, two-letter tags with two spaces and a hyphen, ER on every record, dates as YYYY/MM/DD/', () => {
  const ris = citations(LINKS, options('ris'));
  assert.doesNotMatch(ris, /[^\r]\n/, 'every line ends with CRLF');
  const records = ris.split('\r\n\r\n').filter(Boolean);
  assert.equal(records.length, LINKS.length);
  for (const record of records) {
    const lines = record.replace(/\r\n$/, '').split('\r\n');
    assert.match(lines[0], /^TY {2}- (JOUR|ELEC)$/);
    assert.equal(lines.at(-1), 'ER  - ');
    for (const line of lines) assert.match(line, /^[A-Z][A-Z0-9] {2}- /, line);
    assert.ok(lines.slice(0, -1).every((line) => line.length > 6), 'no empty values');
  }
  assert.match(ris, /\r\nY2 {2}- 2026\/09\/25\/\r\n/);
  assert.match(ris, /\r\nPY {2}- 2025\r\nDA {2}- 2025\/03\/14\/\r\n/);
  assert.match(ris, /\r\nAU {2}- Okafor, Amara\r\nAU {2}- Jun Watanabe\r\n/);
  assert.match(ris, /\r\nN1 {2}- Primary source for chapter 2\. Table 3 has the canopy thresholds\.\r\n/, 'a note is one line');
  assert.match(one('ris', { anchorText: 'x', url: 'https://j.example/a' }, { 'https://j.example/a': { title: 'T', date: 'March 2024' } }), /PY {2}- 2024\r\nDA {2}- 2024\/03\/\/\r\n/);
  assert.equal(citations([], { format: 'ris' }), '');
});

test('CSL-JSON: an array of items with id and type, names split only when printed "Family, Given"', () => {
  const items = JSON.parse(citations(LINKS, options('csl')));
  assert.ok(Array.isArray(items));
  assert.equal(items.length, LINKS.length);
  const known = new Set(['id', 'type', 'title', 'author', 'issued', 'container-title', 'volume', 'issue', 'page', 'DOI', 'PMID', 'PMCID', 'ISBN', 'URL', 'accessed', 'note', 'keyword']);
  for (const item of items) {
    assert.equal(typeof item.id, 'string'); assert.ok(item.id);
    assert.ok(['article-journal', 'webpage'].includes(item.type));
    assert.ok(Object.keys(item).every((key) => known.has(key)), Object.keys(item).join());
    assert.ok(Object.values(item).every((value) => value !== '' && value !== null), 'empty fields are left out');
    for (const name of item.author || []) assert.ok((Object.keys(name).join() === 'family,given' && name.family && name.given) || Object.keys(name).join() === 'literal');
    for (const date of [item.issued, item.accessed].filter(Boolean)) assert.ok(date.literal || (date['date-parts'].length === 1 && date['date-parts'][0].every(Number.isInteger)));
  }
  assert.equal(new Set(items.map((item) => item.id)).size, items.length);
  const byId = Object.fromEntries(items.map((item) => [item.id, item]));
  assert.deepEqual(byId.okafor2025.author, [{ family: 'Okafor', given: 'Amara' }, { literal: 'Jun Watanabe' }]);
  assert.deepEqual(byId.organization.author, [{ literal: 'World Health Organization' }, { literal: 'Smith, Jr., John' }]);
  assert.deepEqual([byId.okafor2025.issued, byId.okafor2025.accessed, byId.organization.issued], [{ 'date-parts': [[2025, 3, 14]] }, { 'date-parts': [[2026, 9, 25]] }, { literal: 'n.d.' }]);
  assert.deepEqual([byId.heat.PMID, byId.full.PMCID, byId.urban.ISBN, byId.surface.DOI], ['31452104', 'PMC6702837', '9780306406157', '10.5555/uhi.2024.0142']);
  assert.equal(byId.okafor2025['container-title'], 'Journal of Example Climate');
  assert.equal(byId.coolstreets['container-title'], 'cool-streets.example.org', 'a web page\'s container is its site');
  assert.equal('container-title' in byId.surface, false, 'a DOI resolver is not a site');
  assert.equal(byId.okafor2025.page, '45-52');
  assert.equal(citations([], { format: 'csl' }), '[]\n');
});

test('Markdown formats escape page text and notes, and follow the collection and export time', () => {
  const annotated = citations(LINKS, options('annotated'));
  assert.ok(annotated.startsWith('# Urban heat islands: thesis sources\n\nAn annotated bibliography of 13 links, exported from Link Meteor on 2026-09-29.\n\n1. '));
  assert.match(annotated, /\n2\. Okafor, Amara; Jun Watanabe \(2025\)\. Cooling cities: a review of street-level interventions\. \*Journal of Example Climate\*, 12\(3\), 45–52\. <https:\/\/doi\.org\/10\.5555\/cool\.2025\.0007>\n/);
  assert.match(annotated, /\n {3}> Across forty mid-sized cities/);
  assert.match(annotated, /\n11\. <https:\/\/www\.cool-streets\.example\.org\/>\n/, 'an address used as the title is written once');
  const obsidian = citations(LINKS, options('obsidian'));
  assert.ok(obsidian.startsWith('---\ntitle: "Urban heat islands: thesis sources"\ncreated: 2026-09-29T11:26\ntags:\n  - "chapter-2"\n  - "canopy"\n  - "review"\n  - "heat-island"\nsource: Link Meteor\n---\n\n- ['));
  assert.match(obsidian, /\n {2}Principal investigator:: Dr\. Okafor\n {2}Deadline:: =March 1\n {2}> Across/);
  assert.match(obsidian, /\n- \[Download the dataset\]\(https:\/\/data\.example\.com\/files\/stations\.csv\)\n/, 'the accessible label stands in for missing anchor text');
  for (const text of [annotated, obsidian]) {
    assert.match(text, /Heat & cooling: 50% of \\#cities\\_\{2024\} \\\\ \\~ \^ \\<b\\> \\\| \\\$5 =\\= \\\[draft\\\]/);
    assert.match(text, /\\- = not a list/); assert.match(text, /\\#\\# not a heading/);
  }
  // Without an about block: a plain heading and title, and no export time.
  assert.ok(citations(LINKS.slice(0, 1), { format: 'annotated' }).startsWith('# Links\n\nAn annotated bibliography of 1 link, exported from Link Meteor.\n\n1. '));
  assert.ok(citations([], { format: 'obsidian' }) === '---\ntitle: "Links"\ntags: []\nsource: Link Meteor\n---\n');
  assert.equal(citations([{ anchorText: 'x', url: 'https://example.org/a(1)', tags: ['true', 'x y', '#a/b', '12'] }], { format: 'obsidian' }).split('\n').slice(2, 6).join('\n'), 'tags:\n  - "true"\n  - "x-y"\n  - "a/b"');
  assert.match(citations([{ anchorText: 'x', url: 'https://example.org/a(1)', tags: [] }], { format: 'obsidian' }), /\[x\]\(https:\/\/example\.org\/a%281%29\)/);
});

test('citeFirst is the first entry as written; citeFacts counts what the entries hold', () => {
  for (const format of CITE_FORMATS) {
    const first = citeFirst(LINKS, options(format));
    if (format === 'csl') assert.deepEqual(JSON.parse(first), JSON.parse(citations(LINKS, options(format)))[0]);
    else assert.ok(citations(LINKS, options(format)).includes(first) && first.length > 20, format);
    assert.equal(citeFirst([], options(format)), '');
  }
  assert.ok(citeFirst(LINKS, options('bibtex')).startsWith('@misc{surface,\n  title        = {Surface temperature'));
  assert.deepEqual(citeFacts(LINKS, PAGES), { entries: 13, identified: 3, authorsAndDate: 2, pageTitles: 3, addressTitles: 1, notes: 2, contexts: 2 });
  assert.deepEqual(citeFacts([], PAGES), { entries: 0, identified: 0, authorsAndDate: 0, pageTitles: 0, addressTitles: 0, notes: 0, contexts: 0 });
});

test('grouped rows use their first occurrence; nothing but the rows, pages, name, columns and time matters', () => {
  const repeat = { ...LINKS[0], id: 'cite-repeat', anchorText: 'Another label', notes: 'Second note' };
  const rows = queryLinks([...LINKS, repeat], { dedupe: 'url' }).rows;
  assert.equal(rows.length, LINKS.length);
  for (const format of CITE_FORMATS) assert.equal(citations(rows, options(format)), citations(LINKS, options(format)), format);
  assert.throws(() => citations(LINKS, { format: 'endnote' }), /Unsupported citation format/);
  assert.throws(() => citations(LINKS, { format: 'bibtex', pages: [] }), /pages must be an object/);
  assert.throws(() => citations(LINKS, { format: 'obsidian', date: new Date('x') }), /valid date/);
  assert.throws(() => makeExport(LINKS, { format: 'csl', pages: null }), /pages must be an object/);
});

test('dates as pages print them', () => {
  const cases = [['2025/03/14', [2025, 3, 14]], ['2025-03-14T10:00:00Z', [2025, 3, 14]], ['2025-03', [2025, 3]], ['2025', [2025]],
    ['14 March 2025', [2025, 3, 14]], ['March 14, 2025', [2025, 3, 14]], ['Mar. 3rd 2025', [2025, 3, 3]], ['2019 Aug 23', [2019, 8, 23]], ['2019 Aug', [2019, 8]],
    ['Published online: 2024-11-02', [2024, 11, 2]], ['03/04/2025', [2025]], ['Spring 2024', [2024]], ['2025-02-30', [2025, 2]], ['2025-13-01', [2025]],
    ['May 2025', [2025, 5]], ['n.d.', []], ['', []], ['12345', []]];
  for (const [text, parts] of cases) assert.deepEqual(dateParts(text), parts, text);
});
