// Imports (0.5.0), the pure part: CSV and TSV edge cases, link lists, header detection, column
// guessing, every skip reason and limit of planImport, Link Meteor's JSON exports, text decoding,
// and Excel workbooks: Link Meteor's own (stored, inline strings) and deflated ones with shared
// strings built here with node:zlib. Workbook XML is read with a small XML reader below, standing
// in for the DOMParser the workbench passes; tests/imports-browser.mjs reads workbooks in Chrome.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, inflateRawSync, crc32 } from 'node:zlib';
import { createState, reduceState, MAX_CUSTOM_FIELDS, MAX_FIELD_VALUE, MAX_IMPORTED } from '../src/core/model.js';
import { makeExport } from '../src/core/export.js';
import { writeXlsx } from '../src/core/xlsx.js';
import { MAX_IMPORT_LINKS, SKIP_REASONS, decodeText, parseDelimited, sniffDelimiter, readText, parseList, trimAddress, readXlsx, readExportJson,
  isAddress, detectHeader, columnNames, dataRows, guessMapping, readingStatus, starredValue, importAddress, planImport, columnLetter } from '../src/core/imports.js';

/* A small XML reader: elements, attributes, text, CDATA and entities, with the DOM calls readXlsx
   uses. Mismatched tags give a parsererror element, as DOMParser does. */
function parseXml(text) {
  const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e) => (e[0] === '#'
    ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()]));
  const make = (name, attributes) => ({
    name, localName: name.split(':').at(-1), attributes, children: [], nodes: [],
    getAttribute(key) { return this.attributes.find((item) => item.name === key)?.value ?? null; },
    hasAttribute(key) { return this.attributes.some((item) => item.name === key); },
    get textContent() { return this.nodes.map((item) => (typeof item === 'string' ? item : item.textContent)).join(''); },
    getElementsByTagNameNS(_, local) { const found = []; const walk = (el) => { for (const item of el.children) { if (item.localName === local) found.push(item); walk(item); } }; walk(this); return found; },
  });
  const doc = make('#document', []), stack = [doc];
  const tokens = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const match of text.matchAll(tokens)) {
    const top = stack.at(-1);
    if (match[1] !== undefined) top.nodes.push(match[1]);
    else if (match[2]) { if (stack.length < 2 || stack.pop().name !== match[2]) { doc.children.push(make('parsererror', [])); break; } }
    else if (match[3]) {
      const attributes = [...match[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((item) => ({ name: item[1], localName: item[1].split(':').at(-1), value: decode(item[2] ?? item[3]) }));
      const el = make(match[3], attributes);
      top.children.push(el); top.nodes.push(el);
      if (!match[5]) stack.push(el);
    } else if (match[6] !== undefined) top.nodes.push(decode(match[6]));
  }
  if (stack.length > 1) doc.children.push(make('parsererror', []));
  doc.documentElement = doc.children[0];
  return doc;
}
const inflateRaw = async (bytes) => new Uint8Array(inflateRawSync(bytes));
const xlsx = (bytes, options = {}) => readXlsx(bytes, { inflateRaw, parseXml, ...options });

// A ZIP of [name, text] entries, deflated by default; `descriptor` writes sizes after the data, as
// streaming writers do; `method` forces another compression method number.
function zip(files, { deflate = true, descriptor = false, method, flags = 0 } = {}) {
  const parts = [], centrals = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBytes = Buffer.from(name), data = Buffer.from(content), packed = deflate ? deflateRawSync(data) : data, crc = crc32(data);
    const kind = method ?? (deflate ? 8 : 0), bits = flags | (descriptor ? 8 : 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(bits, 6); local.writeUInt16LE(kind, 8);
    local.writeUInt32LE(descriptor ? 0 : crc, 14); local.writeUInt32LE(descriptor ? 0 : packed.length, 18); local.writeUInt32LE(descriptor ? 0 : data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const trailer = Buffer.alloc(descriptor ? 16 : 0);
    if (descriptor) { trailer.writeUInt32LE(0x08074b50, 0); trailer.writeUInt32LE(crc, 4); trailer.writeUInt32LE(packed.length, 8); trailer.writeUInt32LE(data.length, 12); }
    parts.push(local, nameBytes, packed, trailer);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(bits, 8); central.writeUInt16LE(kind, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + packed.length + trailer.length;
  }
  const size = centrals.reduce((n, part) => n + part.length, 0), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, ...centrals, end]));
}

// A workbook as Excel writes it: shared strings (with rich text runs and a phonetic guide), a
// prefixed namespace, rows and cells with gaps, numbers, booleans, errors, and formulas with and
// without cached values. Two sheets; the second is addressed by an absolute part name.
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const excelFiles = [
  ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/book.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/strings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
    + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    + '<Override PartName="/xl/worksheets/other.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
  ['_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/book.xml"/></Relationships>`],
  ['xl/book.xml', `<?xml version="1.0"?><x:workbook xmlns:x="${MAIN}" xmlns:r="${REL}"><x:sheets><x:sheet name="Labs &amp; groups" sheetId="1" r:id="rId3"/><x:sheet name="Second" sheetId="2" r:id="rId4"/></x:sheets></x:workbook>`],
  ['xl/_rels/book.xml.rels', `<?xml version="1.0"?><Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/sharedStrings" Target="strings.xml"/><Relationship Id="rId3" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId4" Type="${REL}/worksheet" Target="/xl/worksheets/other.xml"/></Relationships>`],
  ['xl/strings.xml', `<?xml version="1.0"?><x:sst xmlns:x="${MAIN}" count="6" uniqueCount="6">
    <x:si><x:t>Title</x:t></x:si><x:si><x:t>Link</x:t></x:si>
    <x:si><x:r><x:rPr><x:b/></x:rPr><x:t>Heat </x:t></x:r><x:r><x:t xml:space="preserve">and Health Lab</x:t></x:r></x:si>
    <x:si><x:t>https://heat-health.example.edu/</x:t></x:si>
    <x:si><x:t>東京</x:t><x:rPh sb="0" eb="2"><x:t>トウキョウ</x:t></x:rPh></x:si>
    <x:si><x:t>line one_x000D__x000A_line two _x005F_x0041_</x:t></x:si></x:sst>`],
  ['xl/worksheets/sheet1.xml', `<?xml version="1.0"?><x:worksheet xmlns:x="${MAIN}"><x:sheetData>
    <x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="s"><x:v>1</x:v></x:c><x:c r="D1" t="inlineStr"><x:is><x:t>Score</x:t></x:is></x:c></x:row>
    <x:row r="2"><x:c r="A2" t="s"><x:v>2</x:v></x:c><x:c r="B2" t="s"><x:v>3</x:v></x:c><x:c r="D2"><x:v>0.30000000000000004</x:v></x:c><x:c r="E2" t="b"><x:v>1</x:v></x:c></x:row>
    <x:row r="3" spans="1:5"/>
    <x:row r="4"><x:c r="A4" t="s"><x:v>4</x:v></x:c><x:c r="B4" t="str"><x:f>"https://"&amp;"tokyo.example.jp/"</x:f><x:v>https://tokyo.example.jp/</x:v></x:c><x:c r="D4"><x:f>1/0</x:f></x:c><x:c r="E4" t="e"><x:v>#DIV/0!</x:v></x:c></x:row>
    <x:row><x:c t="s"><x:v>5</x:v></x:c><x:c><x:f>SUM(D2:D4)</x:f><x:v>45231</x:v></x:c></x:row>
  </x:sheetData></x:worksheet>`],
  ['xl/worksheets/other.xml', `<?xml version="1.0"?><worksheet xmlns="${MAIN}"><sheetData><row r="7"><c r="C7" t="inlineStr"><is><t>only cell</t></is></c></row></sheetData></worksheet>`],
];

test('parseDelimited: RFC 4180 quoting, byte-order mark, CRLF, LF and CR, empty fields and stray quotes', () => {
  assert.deepEqual(parseDelimited(''), []);
  assert.deepEqual(parseDelimited('﻿Title,Link\r\nA,https://a.org\r\n'), [['Title', 'Link'], ['A', 'https://a.org']], 'the mark is dropped and the final line break ends the table');
  assert.deepEqual(parseDelimited('a,b\nc,d\re,f'), [['a', 'b'], ['c', 'd'], ['e', 'f']], 'LF, CR, and no line break at the end');
  assert.deepEqual(parseDelimited('"A, ""quoted""\r\nsecond line",https://a.org\n'), [['A, "quoted"\r\nsecond line', 'https://a.org']], 'quotes and line breaks inside a quoted field are kept');
  assert.deepEqual(parseDelimited('a,,c,\n,\n'), [['a', '', 'c', ''], ['', '']], 'empty fields, including a trailing one');
  assert.deepEqual(parseDelimited('x"y,"a"b,""'), [['x"y', 'ab', '']], 'a quote inside an unquoted field is text; text after a closing quote joins the field');
  assert.deepEqual(parseDelimited('"unterminated,still\nthe same field'), [['unterminated,still\nthe same field']], 'an unterminated quote runs to the end');
  assert.deepEqual(parseDelimited('\n\na\n'), [[''], [''], ['a']], 'blank lines are rows with one empty field');
  assert.deepEqual(parseDelimited('a\t"b\tc"\td', '\t'), [['a', 'b\tc', 'd']]);
  assert.deepEqual(parseDelimited('a;b', ';'), [['a', 'b']]);
  for (const bad of ['', ',,', '"', '\n']) assert.throws(() => parseDelimited('a', bad), /delimiter/);
  assert.throws(() => parseDelimited(null), /text/);
  const seen = [];
  assert.equal(parseDelimited('x\n'.repeat(25000), ',', { onProgress: (n) => seen.push(n) }).length, 25000);
  assert.deepEqual(seen, [10000, 20000]);
});

test('parseDelimited reads back Link Meteor’s own CSV and TSV exports', () => {
  const rows = [{ anchorText: 'Plain', url: 'https://a.example/', notes: 'Line one\nline "two", with commas', tags: ['x', 'y'] },
    { anchorText: 'Tab\there', url: 'mailto:team@example.org?subject=Plan', notes: '', tags: [] }];
  for (const [format, delimiter] of [['csv', ','], ['tsv', '\t']]) {
    const exported = makeExport(rows, { format, columns: ['anchorText', 'url', 'notes', 'tags'] }).data;
    assert.deepEqual(parseDelimited(exported, delimiter), [['Anchor text', 'URL', 'Notes', 'Tags'], ...rows.map((row) => [row.anchorText, row.url, row.notes, row.tags.join(', ')])], format);
  }
});

test('sniffDelimiter and readText choose a table or a list', () => {
  assert.equal(sniffDelimiter('Title,Link,PI\n'), ',');
  assert.equal(sniffDelimiter('Title;Link;PI\n'), ';');
  assert.equal(sniffDelimiter('﻿\n  \nTitle\tLink\n'), '\t');
  assert.equal(sniffDelimiter('"a;b;c",d\n'), ',', 'delimiters inside quotes don’t count');
  assert.equal(sniffDelimiter('just words'), ',');
  assert.deepEqual(readText('Anchor text\tURL\nA\thttps://a.org/'), { kind: 'table', delimiter: '\t', rows: [['Anchor text', 'URL'], ['A', 'https://a.org/']] }, 'cells copied from a spreadsheet');
  assert.equal(readText('See https://a.org/ today').kind, 'list');
  assert.deepEqual(readText('a;b\n1;2', { kind: 'table' }).rows, [['a', 'b'], ['1', '2']]);
  assert.equal(readText('a\tb', { kind: 'list' }).kind, 'list');
});

test('parseList: Markdown links and bare addresses, trailing punctuation, and anchor text from the words around one address', () => {
  const text = [
    '- Heat and Health Lab: https://heat-health.example.edu/.',
    '1. [Urban Canopy \\[group\\]](https://canopy.example.edu/join "Canopy") and [angled](<https://a.example/with space>)',
    'See https://en.wikipedia.org/wiki/Heat_(physics)), then (https://b.example/x).',
    'mailto:lab@example.edu, tel:+12125550123; https:// alone',
    '<https://angle.example/>',
    '* [ ] https://todo.example/ — reading list',
    'no links here',
    '[relative](/papers/1.pdf)',
  ].join('\r\n');
  assert.deepEqual(parseList(text), [
    { anchorText: 'Heat and Health Lab', href: 'https://heat-health.example.edu/', line: 1 },
    { anchorText: 'Urban Canopy [group]', href: 'https://canopy.example.edu/join', line: 2 },
    { anchorText: 'angled', href: 'https://a.example/with space', line: 2 },
    { anchorText: '', href: 'https://en.wikipedia.org/wiki/Heat_(physics)', line: 3 },
    { anchorText: '', href: 'https://b.example/x', line: 3 },
    { anchorText: '', href: 'mailto:lab@example.edu', line: 4 },
    { anchorText: '', href: 'tel:+12125550123', line: 4 },
    { anchorText: '', href: 'https://angle.example/', line: 5 },
    { anchorText: 'reading list', href: 'https://todo.example/', line: 6 },
    { anchorText: 'relative', href: '/papers/1.pdf', line: 8 },
  ]);
  assert.equal(trimAddress('https://x.org/a_(b)).'), 'https://x.org/a_(b)');
  assert.equal(trimAddress('https://x.org/path?q=1&r=2”'), 'https://x.org/path?q=1&r=2');
  assert.deepEqual(parseList(''), []);
  // Link Meteor's Markdown export: labels come back exactly; its encoded brackets stay encoded.
  const rows = [{ anchorText: 'A [tricky] *label* (1)', url: 'https://example.org/report(1)' }, { anchorText: '', url: 'https://example.org/b' }];
  assert.deepEqual(parseList(makeExport(rows, { format: 'markdown' }).data).map(({ anchorText, href }) => [anchorText, href]),
    [['A [tricky] *label* (1)', 'https://example.org/report%281%29'], ['', 'https://example.org/b']]);
  assert.deepEqual(parseList(makeExport(rows, { format: 'text' }).data).map((item) => item.href), rows.map((row) => row.url));
});

test('header detection, column names and data rows', () => {
  assert.equal(detectHeader([['Title', 'Link'], ['A', 'https://a.org']]), true, 'known names');
  assert.equal(detectHeader([['Lab', 'Where'], ['A', 'https://a.org']]), true, 'text above a column of addresses');
  assert.equal(detectHeader([['A', 'https://a.org'], ['B', 'https://b.org']]), false, 'an address in the first row');
  assert.equal(detectHeader([['', ''], ['Title', 'Link'], ['A', 'www.a.org']]), true, 'blank rows before the header are skipped');
  assert.equal(detectHeader([['Title', 'Link']]), false, 'one row is data');
  assert.equal(detectHeader([['alpha', 'beta'], ['gamma', 'delta']]), false, 'no names and no addresses');
  assert.deepEqual(columnNames([['Title', '', 'Notes', 'notes'], ['a', 'b', 'c', 'd', 'e']], true), ['Title', 'Column B', 'Notes', 'notes (2)', 'Column E']);
  assert.deepEqual(columnNames([['a', 'b'], ['c']], false), ['Column A', 'Column B']);
  assert.deepEqual(dataRows([[''], ['Title'], ['a'], [' '], ['b']], true), [['a'], ['b']]);
  assert.deepEqual(dataRows([['Title'], ['a']], false), [['Title'], ['a']]);
  assert.deepEqual([0, 25, 26, 701, 702].map(columnLetter), ['A', 'Z', 'AA', 'ZZ', 'AAA']);
  assert.equal(isAddress(' <https://x.org>'), true); assert.equal(isAddress('www.x.org'), true); assert.equal(isAddress('x.org'), false);
});

test('guessMapping: names first, then content; the destination’s columns by name; new columns proposed for the rest', () => {
  const names = ['Title', 'Website', 'Link', 'PI', 'Deadline', 'Status', 'Tags', 'Starred', 'Source page URL', 'Empty', 'Comments'];
  const rows = [['Heat Lab', 'Heat Lab site', 'https://heat.example.edu/', 'Dr. R', 'Dec 1', 'read', 'a, b', 'yes', 'https://s.example/', '', 'n']];
  const guess = guessMapping(names, rows, { fields: [{ id: 'f-pi', name: 'pi' }] });
  assert.deepEqual({ url: guess.url, anchorText: guess.anchorText, notes: guess.notes, tags: guess.tags, status: guess.status, starred: guess.starred },
    { url: 2, anchorText: 0, notes: 10, tags: 6, status: 5, starred: 7 }, 'Website holds no addresses, so Link is the address column');
  assert.deepEqual(guess.fields, [{ id: 'f-pi', column: 3 }]);
  assert.deepEqual(guess.fresh, [{ column: 1, name: 'Website', use: true }, { column: 4, name: 'Deadline', use: true },
    { column: 8, name: 'Source page URL', use: false }, { column: 9, name: 'Empty', use: false }], 'export-only and empty columns aren’t chosen');
  assert.equal(guess.overflow, 0);
  // 0.6.0: an export's PDF page column is offered, but not chosen, like the other capture details.
  assert.deepEqual(guessMapping(['Anchor text', 'URL', 'PDF page'], [['a', 'https://a.example/', '3']]).fresh, [{ column: 2, name: 'PDF page', use: false }]);
  // Without names: the column with the most addresses, and the words beside it as anchor text.
  const plain = guessMapping(['Column A', 'Column B', 'Column C'], [['Heat Lab', 'https://h.org', 'x'], ['Canopy', 'www.c.org', '']]);
  assert.deepEqual([plain.url, plain.anchorText], [1, 0]);
  assert.deepEqual(plain.fresh, [{ column: 2, name: 'Column C', use: true }]);
  // No addresses anywhere: the first column. `skip` columns aren't chosen.
  const none = guessMapping(['Folder', 'Other'], [['a', 'b']], { skip: [0] });
  assert.equal(none.url, 0);
  assert.deepEqual(none.fresh, [{ column: 1, name: 'Other', use: true }]);
  // New names stay distinct from the destination's, and only as many as the collection has room for.
  const full = Array.from({ length: MAX_CUSTOM_FIELDS - 1 }, (_, i) => ({ id: `f-${i}`, name: i ? `Col ${i}` : 'Deadline' }));
  const room = guessMapping(['URL', 'Deadline', 'deadline', 'Extra'], [['https://a.org', '1', '2', '3']], { fields: full });
  assert.deepEqual(room.fields, [{ id: 'f-0', column: 1 }]);
  assert.deepEqual(room.fresh, [{ column: 2, name: 'deadline (2)', use: true }]);
  assert.equal(room.overflow, 1);
  const long = guessMapping(['URL', 'x'.repeat(80)], [['https://a.org', 'v']]);
  assert.equal(long.fresh[0].name, 'x'.repeat(60));
});

test('addresses, reading status and stars from cells', () => {
  assert.deepEqual(importAddress(' <https://Heat.Example.edu> '), { url: 'https://heat.example.edu/' });
  assert.deepEqual(importAddress('www.example.org/a b'), { url: 'https://www.example.org/a%20b' });
  assert.deepEqual(importAddress('MAILTO:lab@example.edu'), { url: 'mailto:lab@example.edu' });
  assert.deepEqual(importAddress('tel:+12125550123'), { url: 'tel:+12125550123' });
  for (const empty of ['', '   ', '<>', undefined]) assert.deepEqual(importAddress(empty), { reason: 'no-address' });
  for (const bad of ['javascript:alert(1)', 'file:///Users/x/notes.txt', 'ftp://files.example/', 'chrome://settings', '/papers/1.pdf', 'example.org', 'tel:', 'mailto:', 'http://', 'https://exa mple.org/'])
    assert.deepEqual(importAddress(bad), { reason: 'not-link' }, bad);
  assert.deepEqual(['Read', 'done', ' FINISHED ', 'Reading', 'in progress', 'unread', 'Unread', '', 'maybe'].map(readingStatus), ['read', 'read', 'read', 'reading', 'reading', '', '', '', '']);
  assert.deepEqual(['Yes', 'y', 'TRUE', '1', 'x', '★', '✓', 'no', '', '0', 'starred'].map(starredValue), [true, true, true, true, true, true, true, false, false, false, true]);
});

test('planImport: every skip reason, the header row, numbers, labels, tags, status, stars and custom columns', () => {
  const rows = [
    ['', '', '', ''],
    ['Title', 'Link', 'Deadline', 'PI', 'Tags', 'Status', 'Star'],
    ['Heat and Health Lab', 'https://heat-health.example.edu', 'Dec 1', 'Dr. Rivera', 'heat; health, heat', 'Read', 'yes'],
    ['Ask Maya about this one', '', '', '', '', '', ''],
    ['  Heat   and Health Lab ', ' https://heat-health.example.edu/ ', 'Dec 2', '', '', '', ''],
    ['Heat and Health Lab (clinic)', 'https://heat-health.example.edu/', 'Other anchor text keeps it', '', '', '', ''],
    ['Different', 'https://heat-health.example.edu/', '', '', '', 'reading', ''],
    ['Scripted', 'javascript:alert(1)', '', '', '', '', ''],
    [],
    ['Saved before', 'https://saved.example/', '', '', '', '', ''],
    ['Mail', 'mailto:lab@example.edu', 'x'.repeat(MAX_FIELD_VALUE + 5), '', '', '', ''],
  ];
  const mapping = { header: true, url: 1, anchorText: 0, tags: 4, status: 5, starred: 6, notes: -1, fields: [{ name: 'Deadline', column: 2 }, { id: 'f-pi', column: 3 }, { name: 'Unused', column: -1 }] };
  const plan = planImport(rows, mapping, { links: [{ url: 'https://saved.example/' }], skipSaved: true, source: 'labs.csv', batchId: 'b1', importedAt: '2026-09-29T12:00:00.000Z' });
  assert.deepEqual(plan.newFields, [{ key: 'new-1', name: 'Deadline' }]);
  assert.deepEqual(plan.skipped, [{ row: 4, reason: 'no-address' }, { row: 5, reason: 'repeat', of: 3 }, { row: 8, reason: 'not-link' }, { row: 10, reason: 'saved' }]);
  assert.deepEqual(plan.counts, { rows: 8, links: 4, 'no-address': 1, 'not-link': 1, repeat: 1, saved: 1, limit: 0 });
  assert.equal(plan.cut, 1);
  assert.deepEqual(plan.links[0], { id: 'b1-1', anchorText: 'Heat and Health Lab', accessibleLabel: '', url: 'https://heat-health.example.edu/', originalHref: 'https://heat-health.example.edu',
    sourceUrl: '', sourceTitle: '', frameUrl: '', capturedAt: '2026-09-29T12:00:00.000Z', batchId: 'b1', notes: '', tags: ['heat', 'health'], imported: 'labs.csv, row 3',
    status: 'read', starred: true, fields: { 'new-1': 'Dec 1', 'f-pi': 'Dr. Rivera' } });
  assert.deepEqual(plan.links.map((link) => [link.anchorText, link.imported, link.status ?? '']), [['Heat and Health Lab', 'labs.csv, row 3', 'read'],
    ['Heat and Health Lab (clinic)', 'labs.csv, row 6', ''], ['Different', 'labs.csv, row 7', 'reading'], ['Mail', 'labs.csv, row 11', '']]);
  assert.equal(plan.links[1].fields['new-1'], 'Other anchor text keeps it', 'the same address with other anchor text is not a repeat');
  const mail = plan.links[3];
  assert.equal(mail.fields['new-1'].length, MAX_FIELD_VALUE);
  assert.ok(mail.fields['new-1'].endsWith('…'));
  assert.deepEqual(plan.preview.map((entry) => [entry.row, entry.reason || '']), [[3, ''], [4, 'no-address'], [5, 'repeat'], [6, ''], [7, ''], [8, 'not-link'], [10, 'saved'], [11, '']]);
  assert.deepEqual(plan.previewSkipped.map((entry) => entry.row), [4, 5, 8, 10]);
  assert.equal(plan.preview[1].values.anchorText, 'Ask Maya about this one');
  // Without skipSaved the saved address is added; the links pass the model's checks.
  const all = planImport(rows, mapping, { links: [{ url: 'https://saved.example/' }], source: 'labs.csv' });
  assert.equal(all.counts.saved, 0); assert.equal(all.links.length, 5);
  const state = reduceState(createState(), { type: 'links.append', links: all.links });
  assert.equal(state.collections[0].links.length, 5);
  assert.equal(state.collections[0].links[0].imported, 'labs.csv, row 3');
  assert.throws(() => planImport(rows, { header: true }), /addresses/);
  assert.throws(() => planImport('rows', { url: 0 }), /rows/);
});

test('planImport: row numbers, addresses as written, folder paths, units and the imported label’s length', () => {
  const plan = planImport([['A', 'https://a.org/x'], ['B', 'https://b.org/'], ['C', 'https://c.org/']], { url: 1, anchorText: 0, path: 2 }, { source: 'notes.md', unit: 'line', numbers: [4, 9, 12], originals: ['/x', undefined, 'c'] });
  assert.deepEqual(plan.links.map((link) => [link.imported, link.originalHref]), [['notes.md, line 4', '/x'], ['notes.md, line 9', 'https://b.org/'], ['notes.md, line 12', 'c']]);
  const folders = planImport([['A', 'https://a.org/', 'Research › Labs'], ['B', 'https://b.org/', '']], { url: 1, anchorText: 0, path: 2 }, { source: 'Bookmarks', unit: 'link' });
  assert.deepEqual(folders.links.map((link) => link.imported), ['Bookmarks › Research › Labs', 'Bookmarks, link 2']);
  const long = planImport([['https://a.org/']], { url: 0 }, { source: 'x'.repeat(400) });
  assert.equal(long.links[0].imported.length, MAX_IMPORTED);
  assert.ok(long.links[0].imported.endsWith('…'));
  let n = 0;
  assert.deepEqual(planImport([['https://a.org/'], ['https://b.org/']], { url: 0 }, { makeId: () => `id-${++n}` }).links.map((link) => link.id), ['id-1', 'id-2']);
});

test(`planImport: at most ${MAX_IMPORT_LINKS.toLocaleString('en-US')} links; the rest are one skipped entry, and the preview stays small`, () => {
  const rows = Array.from({ length: MAX_IMPORT_LINKS + 3 }, (_, i) => [`https://example.org/${i}`]);
  rows.splice(5, 0, ['']);
  const plan = planImport(rows, { url: 0 }, { preview: 10 });
  assert.equal(plan.links.length, MAX_IMPORT_LINKS);
  assert.equal(plan.counts.limit, 3);
  assert.deepEqual(plan.skipped, [{ row: MAX_IMPORT_LINKS + 2, reason: 'limit', rows: 3 }]);
  assert.equal(plan.preview.length, 10);
  assert.equal(SKIP_REASONS.limit, 'Over the 20,000-link limit');
});

test('readExportJson: Link Meteor’s JSON exports become a table with its own column names', () => {
  const exported = { about: { collection: 'Thesis', fields: [{ id: 'f-a', name: 'Deadline' }, { id: 7, name: 'bad' }] }, rows: [
    { anchorText: 'A', url: 'https://a.org/', notes: 'n', tags: ['x', 'y'], status: 'reading', starred: true, fields: { 'f-a': 'Dec 1' }, occurrences: [] },
    { url: 'mailto:b@b.org', tags: 'not a list', status: 'weird' }] };
  const table = readExportJson(`﻿${JSON.stringify(exported)}`);
  assert.deepEqual(table.names, ['Anchor text', 'URL', 'Notes', 'Tags', 'Reading status', 'Starred', 'Deadline']);
  assert.deepEqual(table.rows, [['A', 'https://a.org/', 'n', 'x, y', 'Reading', 'Yes', 'Dec 1'], ['', 'mailto:b@b.org', '', '', '', '', '']]);
  assert.deepEqual(readExportJson(JSON.stringify(exported.rows)).names.length, 6, 'an export without an about block');
  const guess = guessMapping(table.names, table.rows);
  assert.deepEqual([guess.url, guess.anchorText, guess.notes, guess.tags, guess.status, guess.starred], [1, 0, 2, 3, 4, 5]);
  const plan = planImport(table.rows, { ...guess, fields: guess.fresh.map((item) => ({ name: item.name, column: item.column })) }, { source: 'thesis.json' });
  assert.deepEqual(plan.links[0].status, 'reading'); assert.equal(plan.links[0].starred, true); assert.deepEqual(plan.links[0].tags, ['x', 'y']);
  assert.throws(() => readExportJson('{'), /isn’t valid JSON/);
  assert.throws(() => readExportJson(JSON.stringify({ format: 'link-meteor-backup', formatVersion: 3 })), /backup, not an export/);
  assert.throws(() => readExportJson(JSON.stringify({ rows: [{ href: 'x' }] })), /isn’t a Link Meteor export/);
  assert.throws(() => readExportJson('{"a":1}'), /isn’t a Link Meteor export/);
});

test('decodeText: UTF-8 with or without a mark, UTF-16 with a mark, and Windows-1252', () => {
  assert.equal(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from('Café,ü')])), 'Café,ü');
  assert.equal(decodeText(Buffer.from('plain')), 'plain');
  assert.equal(decodeText(new Uint8Array([0xff, 0xfe, ...Buffer.from('Tab\tü', 'utf16le')])), 'Tab\tü');
  assert.equal(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x41, 0x00, 0xfc])), 'Aü');
  assert.equal(decodeText(new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x20, 0x93, 0x71, 0x94])), 'Café “q”');
  assert.equal(decodeText(new Uint8Array([0x61, 0x62]).buffer), 'ab');
});

test('readXlsx reads Link Meteor’s own workbooks: plain and formatted, with its About sheet', async () => {
  const headers = ['Anchor text', 'URL', 'Notes'];
  const rows = [['=1+1', 'https://example.org/report(1)', 'literal _x0001_ and control \u0001'], ['雪 😀', 'tel:+12125550123', ' spaced '], ['', 'mailto:a@b.org', 'Line\nbreak']];
  const plain = await xlsx(writeXlsx(headers, rows));
  assert.deepEqual(plain, { sheets: ['Links'], sheet: 0, rows: [headers, ...rows], numbers: [1, 2, 3, 4] });
  const formatted = writeXlsx(headers, rows, { linkColumns: [1], about: [['Collection', 'Thesis'], ['Links', '3']] });
  const links = await xlsx(formatted);
  assert.deepEqual(links.sheets, ['Links', 'About']);
  assert.deepEqual(links.rows, [headers, ...rows]);
  assert.deepEqual((await xlsx(formatted, { sheet: 1 })).rows, [['Collection', 'Thesis'], ['Links', '3']]);
  // The workbook the Export panel downloads, through the whole import: header, mapping and plan.
  const exported = makeExport([{ anchorText: 'A', url: 'https://a.org/', notes: 'n', tags: ['t'] }], { format: 'xlsx', columns: ['anchorText', 'url', 'notes', 'tags'],
    about: { exportedAt: new Date('2026-09-29T12:00:00Z'), collection: 'Thesis', version: '0.5.0' } });
  const book = await xlsx(exported.data);
  assert.equal(detectHeader(book.rows), true);
  const guess = guessMapping(columnNames(book.rows, true), dataRows(book.rows, true));
  const plan = planImport(book.rows, { header: true, ...guess }, { source: 'Thesis.xlsx', numbers: book.numbers });
  assert.deepEqual(plan.links.map((link) => [link.anchorText, link.url, link.notes, link.tags, link.imported]), [['A', 'https://a.org/', 'n', ['t'], 'Thesis.xlsx, row 2']]);
});

test('readXlsx reads deflated workbooks with shared strings, gaps, numbers, booleans, errors and cached formula values', async () => {
  const bytes = zip(excelFiles);
  const book = await xlsx(bytes);
  assert.deepEqual(book.sheets, ['Labs & groups', 'Second']);
  assert.equal(book.sheet, 0);
  assert.deepEqual(book.rows, [
    ['Title', 'Link', '', 'Score'],
    ['Heat and Health Lab', 'https://heat-health.example.edu/', '', '0.30000000000000004', 'TRUE'],
    ['東京', 'https://tokyo.example.jp/', '', '', '#DIV/0!'],
    ['line one\r\nline two _x0041_', '45231'],
  ], 'phonetic guides left out, empty rows dropped, formulas as their cached values, and a formula without one empty');
  assert.deepEqual(book.numbers, [1, 2, 4, 5]);
  assert.deepEqual(await xlsx(bytes, { sheet: 1 }), { sheets: ['Labs & groups', 'Second'], sheet: 1, rows: [['', '', 'only cell']], numbers: [7] });
  assert.equal((await xlsx(bytes, { sheet: 9 })).sheet, 0, 'a sheet that doesn’t exist reads the first');
  assert.deepEqual((await xlsx(zip(excelFiles, { descriptor: true }))).rows, book.rows, 'sizes written after the data');
  assert.deepEqual((await xlsx(zip(excelFiles, { deflate: false }))).rows, book.rows, 'stored entries');
  const plan = planImport(book.rows, { header: true, url: 1, anchorText: 0 }, { source: 'labs.xlsx', numbers: book.numbers });
  assert.deepEqual(plan.links.map((link) => link.imported), ['labs.xlsx, row 2', 'labs.xlsx, row 4']);
  assert.deepEqual(plan.skipped, [{ row: 5, reason: 'not-link' }]);
});

test('readXlsx refuses what it can’t read, with a reason', async () => {
  await assert.rejects(xlsx(Buffer.from('Title,Link\n')), /isn’t an Excel workbook/);
  await assert.rejects(xlsx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Uint8Array(30)])), /older \.xls workbook or a password-protected one/);
  const good = zip(excelFiles);
  await assert.rejects(xlsx(good.subarray(0, good.length - 22)), /damaged/, 'no end of the file list');
  await assert.rejects(xlsx(zip(excelFiles, { flags: 1 })), /password-protected/);
  await assert.rejects(xlsx(zip(excelFiles, { deflate: false, method: 12 })), /compression method/);
  await assert.rejects(readXlsx(good, { parseXml }), /inflateRaw/);
  await assert.rejects(readXlsx(good, { inflateRaw }), /parseXml/);
  await assert.rejects(xlsx(zip(excelFiles.filter(([name]) => !name.startsWith('xl/book')))), /isn’t an Excel workbook/, 'no workbook part');
  await assert.rejects(xlsx(zip(excelFiles.map(([name, text]) => [name, name.endsWith('sheet1.xml') ? '<worksheet><sheetData>' : text]))), /damaged/, 'XML that doesn’t parse');
  await assert.rejects(xlsx(zip(excelFiles.map(([name, text]) => [name, name === 'xl/book.xml' ? `<workbook xmlns="${MAIN}"><sheets/></workbook>` : text]))), /no sheets/);
  await assert.rejects(xlsx(zip(excelFiles.filter(([name]) => !name.endsWith('sheet1.xml')))), /can’t be read: it may be a chart sheet/);
  // A part that claims to be larger than Link Meteor unpacks is refused before it is read.
  const huge = zip(excelFiles, { deflate: false });
  const view = new DataView(huge.buffer);
  for (let at = huge.length - 23; at > 0; at--) if (view.getUint32(at, true) === 0x02014b50 && Buffer.from(huge.subarray(at + 46, at + 46 + 24)).toString().startsWith('xl/worksheets/sheet1.xml')) { view.setUint32(at + 24, 200 * 1024 * 1024, true); break; }
  await assert.rejects(xlsx(huge), /too large/);
});

test('the test’s workbook ZIP reads back with node:zlib (a check of the fixture itself)', () => {
  const bytes = zip([['a.txt', 'hello hello hello']]);
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(inflateRawSync(bytes.subarray(30 + 5, 30 + 5 + view.getUint32(18, true))).toString(), 'hello hello hello');
});
