import test from 'node:test';
import assert from 'node:assert/strict';
import { makeExport, COLUMNS, exportFileName, fileNamePart } from '../src/core/export.js';
import { writeXlsx } from '../src/core/xlsx.js';
import { queryLinks } from '../src/core/model.js';

const source = { id: 'one', anchorText: '=1+1', accessibleLabel: '', url: 'https://example.org/a?x=1&y=2', originalHref: '/a?x=1&y=2', sourceUrl: 'https://source.org/', sourceTitle: 'a,"b"\n雪', frameUrl: '', capturedAt: '2026-09-25T00:00:00Z', batchId: 'batch', notes: '<img onerror=alert(1)>', tags: ['α'] };
const other = { ...source, id: 'two', anchorText: '', sourceUrl: 'https://other.org/', tags: ['β'] };
const rows = queryLinks([source, other], { dedupe: 'url' }).rows;

test('ordered CSV/TSV protect formulas and preserve distinct fields', () => {
  assert.equal(COLUMNS[0].key, 'anchorText');
  const csv = makeExport(rows, { format: 'csv', columns: ['anchorText', 'url', 'sourceTitle'] });
  assert.equal(csv.mime, 'text/csv;charset=utf-8');
  assert.match(csv.data, /^Anchor text,URL,Source page title\r\n/);
  assert.match(csv.data, /'=1\+1,https:\/\/example.org\/a\?x=1&y=2,"a,""b""\n雪"/);
  const tsv = makeExport(rows, { format: 'tsv', columns: ['url', 'anchorText'] });
  assert.match(tsv.data, /^URL\tAnchor text\r\n/);
  assert.match(tsv.data, /https:\/\/example.org\/a\?x=1&y=2\t'=1\+1/);
  assert.equal(rows[0].anchorText, '=1+1');
  assert.equal(source.anchorText, '=1+1');
});

test('text, Markdown, HTML, and JSON use safe data and retain provenance', () => {
  assert.equal(makeExport(rows, { format: 'text' }).data, source.url);
  const md = makeExport(rows, { format: 'markdown' }).data;
  assert.match(md, /\[\\=1\\\+1\]\(https:\/\/example\.org\/a\?x=1&y=2\)/);
  const html = makeExport(rows, { format: 'html', columns: ['notes', 'url'] }).data;
  assert.match(html, /&lt;img onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img/);
  const json = JSON.parse(makeExport(rows, { format: 'json', columns: ['url'] }).data);
  assert.deepEqual(json[0].occurrenceIds, ['one', 'two']);
  assert.equal(json[0].occurrences[1].sourceUrl, 'https://other.org/');
  assert.equal(json[0].anchorText, '=1+1');
});

test('XLSX is a ZIP with ordered inline string cells and no formulas', () => {
  const result = makeExport(rows, { format: 'xlsx', columns: ['anchorText', 'sourceTitle', 'url'] });
  assert.equal(result.extension, 'xlsx');
  assert.ok(result.data instanceof Uint8Array);
  const bytes = result.data;
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'PK\x03\x04');
  const xml = new TextDecoder().decode(bytes);
  assert.match(xml, /<t>Anchor text<\/t>/);
  assert.match(xml, /<t xml:space="preserve">=1\+1<\/t>|<t>=1\+1<\/t>/);
  assert.doesNotMatch(xml, /<f>/);
  assert.match(xml, /a,&quot;b&quot;\n雪/);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const read16 = offset => view.getUint16(offset, true);
  const read32 = offset => view.getUint32(offset, true);
  const decode = (start, length) => new TextDecoder().decode(bytes.subarray(start, start + length));
  const checksum = data => {
    const table = Array.from({ length: 256 }, (_, index) => {
      let c = index;
      for (let bit = 0; bit < 8; bit++) c = (c & 1) ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
      return c >>> 0;
    });
    let crc = 0xffffffff;
    for (const byte of data) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const names = [];
  let offset = 0;
  while (read32(offset) === 0x04034b50) {
    assert.equal(read16(offset + 8), 0, 'ZIP entry is stored');
    const size = read32(offset + 18);
    const nameLength = read16(offset + 26);
    const extraLength = read16(offset + 28);
    names.push(decode(offset + 30, nameLength));
    const start = offset + 30 + nameLength + extraLength;
    assert.equal(checksum(bytes.subarray(start, start + size)), read32(offset + 14));
    offset = start + size;
  }
  assert.equal(read32(offset), 0x02014b50, 'central directory follows entries');
  assert.deepEqual(names, ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml']);
  const end = bytes.length - 22;
  assert.equal(read32(end), 0x06054b50);
  assert.equal(read16(end + 10), names.length);
});

test('unsupported format or columns are rejected', () => {
  assert.throws(() => makeExport(rows, { format: 'pdf' }), /format/i);
  assert.throws(() => makeExport(rows, { format: 'csv', columns: [] }), /columns/i);
  assert.throws(() => makeExport(rows, { format: 'csv', columns: ['x'] }), /column/i);
});

test('text keeps valid destination strings exactly; Markdown encodes only its delimiters', () => {
  const links = [
    { anchorText: 'Email', url: 'mailto:team@example.org?subject=Plan(2026)' },
    { anchorText: 'Compose subject', url: 'mailto:?subject=Hello' },
    { anchorText: 'Compose', url: 'mailto:' },
    { anchorText: 'Call', url: 'tel:+12125550123' },
    { anchorText: 'Web', url: 'https://example.org/report(1)' },
  ];
  assert.equal(makeExport(links, { format: 'text' }).data, links.map(x => x.url).join('\n'));
  const markdown = makeExport(links, { format: 'markdown' }).data;
  assert.match(markdown, /mailto:team@example\.org\?subject=Plan%282026%29/);
  assert.match(markdown, /\[Compose subject\]\(mailto:\?subject=Hello\)/);
  assert.match(markdown, /\[Compose\]\(mailto:\)/);
  assert.match(markdown, /tel:\+12125550123/);
  assert.match(markdown, /https:\/\/example\.org\/report%281%29/);
  assert.equal(links[0].url, 'mailto:team@example.org?subject=Plan(2026)');
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'tel:', 'mailto:team@example.org\n']) {
    assert.throws(() => makeExport([{ url: bad }], { format: 'text' }), /URL/i);
    assert.throws(() => makeExport([{ anchorText: 'bad', url: bad }], { format: 'markdown' }), /URL/i);
  }
});

test('XLSX escapes OOXML control tokens and supports columns past Z', () => {
  const headers = Array.from({ length: 27 }, (_, index) => `Header ${index}`);
  const values = headers.map((_, index) => index === 26 ? '雪😀 _x0041_\u0001' : '');
  const bytes = writeXlsx(headers, [values]);
  const xml = new TextDecoder().decode(bytes);
  assert.match(xml, /<c r="AA1" t="inlineStr">/);
  assert.match(xml, /<c r="AA2" t="inlineStr">/);
  assert.match(xml, /雪😀 _x005F_x0041__x0001_/);
  assert.doesNotMatch(xml, /雪😀 _x0041_\u0001/);
  const encodedCell = xml.match(/<c r="AA2" t="inlineStr"><is><t>(.*?)<\/t><\/is><\/c>/su)?.[1];
  assert.equal(encodedCell?.replace(/_x([0-9a-fA-F]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))), values[26]);
});

test('Markdown preserves a genuinely empty anchor label', () => {
  assert.equal(makeExport([{anchorText:'',url:'https://example.org/image'}],{format:'markdown'}).data,'[](https://example.org/image)');
});

test('export file names follow the pattern settings, in local time and without colons', () => {
  const date = new Date(2026, 8, 26, 14, 32, 59);
  const name = (options) => exportFileName({ collection: 'Urban heat islands sources', extension: 'xlsx', date, ...options });
  assert.equal(name(), 'Urban-heat-islands-sources_2026-09-26_1432.xlsx');
  assert.equal(name({ settings: { exportPrefix: 'link-meteor-research' } }), 'link-meteor-research_Urban-heat-islands-sources_2026-09-26_1432.xlsx');
  assert.equal(name({ settings: { exportTimestampFormat: 'date' } }), 'Urban-heat-islands-sources_2026-09-26.xlsx');
  assert.equal(name({ settings: { exportTimestamp: false, exportTimestampFormat: 'date' } }), 'Urban-heat-islands-sources.xlsx');
  assert.equal(exportFileName({ collection: 'Late', extension: 'csv', date: new Date(2026, 0, 2, 3, 4) }), 'Late_2026-01-02_0304.csv');
  assert.doesNotMatch(name(), /:/);
});

test('typed file names and collection names become safe file names', () => {
  const date = new Date(2026, 8, 26, 9, 5);
  assert.equal(exportFileName({ collection: 'x', extension: 'md', date, override: '  My notes.MD ' }), 'My-notes.md', 'the typed name replaces the pattern and a typed extension is not doubled');
  assert.equal(exportFileName({ collection: 'x', extension: 'md', date, override: '???' }), 'x_2026-09-26_0905.md', 'a name with nothing usable falls back to the pattern');
  assert.equal(exportFileName({ collection: 'Résumé: “Draft” / v2', extension: 'csv', date, settings: { exportTimestamp: false } }), 'Resume-Draft-v2.csv');
  assert.equal(exportFileName({ collection: '', extension: 'txt', date }), 'links_2026-09-26_0905.txt');
  assert.equal(exportFileName({ collection: 'CON', extension: 'txt', date, settings: { exportTimestamp: false } }), 'CON_.txt');
  assert.equal(exportFileName({ collection: '..\\..\\secret', extension: 'json', date, settings: { exportTimestamp: false } }), 'secret.json');
  assert.equal(fileNamePart('雪 研究'), '雪-研究');
  assert.equal(fileNamePart('x'.repeat(200)).length, 80);
  assert.throws(() => exportFileName({ collection: 'x', extension: '.xlsx', date }), /extension/);
  assert.throws(() => exportFileName({ collection: 'x', extension: 'xlsx', date: new Date('nope') }), /valid date/);
});

/* 0.3.0: about blocks, formatted workbooks and compatibility with 0.2.2 ------------------- */

import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readPackagedMembers } from '../scripts/verify-package.mjs';
import { MAX_HYPERLINKS, hyperlinkTarget } from '../src/core/xlsx.js';

const repo = resolve(import.meta.dirname, '..');
const fixtureLinks = [
  { ...source, id: 'f1', anchorText: '=SUM(1)', url: 'https://example.org/report(1)?a=1&b=2', originalHref: '/report(1)?a=1&b=2', sourceTitle: 'Tab\there, "quoted", <b>' },
  { ...source, id: 'f2', anchorText: '', url: 'mailto:team@example.org?subject=Hi', originalHref: 'mailto:team@example.org?subject=Hi', notes: 'line one\nline two' },
  { ...source, id: 'f3', anchorText: '雪 😀 _x0041_', url: 'tel:+12125550123', originalHref: 'tel:+12125550123', tags: ['a', 'b'] },
  { ...source, id: 'f4', anchorText: '+cmd|x', url: 'http://127.0.0.1:52482/a%20b', originalHref: 'HTTP://127.0.0.1:52482/a b', frameUrl: 'https://frame.example/' },
];
const fixtureRows = [...queryLinks(fixtureLinks, {}).rows, ...rows];
const about = { exportedAt: new Date(Date.UTC(2026, 8, 26, 21, 32, 59)), collection: 'Urban heat', count: fixtureRows.length, view: 'Every occurrence; capture order, ascending', filters: ['Search: “heat”', 'Selected links only'], columns: ['anchorText', 'url'], version: '0.3.0' };
const ALL_FORMATS = ['csv', 'tsv', 'text', 'markdown', 'html', 'json', 'xlsx'];
const bytesOf = data => typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
const webRows = fixtureRows.filter(row => !/^tel:/.test(row.url));

function members(data) {
  return new Map([...readPackagedMembers(Buffer.from(data))].map(([name, bytes]) => [name, bytes.toString('utf8')]));
}
function cells(sheet) {
  return [...sheet.matchAll(/<c r="([A-Z]+\d+)"([^>]*)>(.*?)<\/c>/gs)].map(([, ref, attrs, body]) => ({ ref, attrs, body }));
}

test('without about, every format is byte-for-byte the packaged 0.2.2 export', async () => {
  const zip = await readFile(join(repo, 'artifacts', 'link-meteor-0.2.2.zip'));
  const packaged = readPackagedMembers(zip);
  await mkdir(join(repo, '.scratch'), { recursive: true });
  const temp = await mkdtemp(join(repo, '.scratch', 'export-022-'));
  try {
    await mkdir(join(temp, 'core'));
    for (const name of ['core/export.js', 'core/xlsx.js']) await writeFile(join(temp, name), packaged.get(name));
    const old = await import(join(temp, 'core', 'export.js'));
    for (const columns of [undefined, ['anchorText', 'url'], ['url', 'anchorText', 'sourceTitle', 'notes', 'tags', 'frameUrl', 'originalHref']]) {
      for (const format of ALL_FORMATS) {
        const input = format === 'text' || format === 'markdown' ? webRows : fixtureRows;
        const expected = old.makeExport(input, { format, columns });
        const actual = makeExport(input, { format, columns });
        assert.deepEqual(bytesOf(actual.data), bytesOf(expected.data), `${format} ${columns}`);
        assert.equal(actual.mime, expected.mime); assert.equal(actual.extension, expected.extension);
      }
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('CSV, TSV, Markdown, HTML and text match fixed 0.2.2 output, with or without about', () => {
  const small = [
    { anchorText: '=SUM(1)', url: 'https://example.org/a,b', sourceTitle: 'Say "hi"\nthere' },
    { anchorText: '', url: 'https://example.org/(x)' },
  ];
  const expected = {
    csv: 'Anchor text,URL,Source page title\r\n\'=SUM(1),"https://example.org/a,b","Say ""hi""\nthere"\r\n,https://example.org/(x),\r\n',
    tsv: 'Anchor text\tURL\tSource page title\r\n\'=SUM(1)\thttps://example.org/a,b\t"Say ""hi""\nthere"\r\n\thttps://example.org/(x)\t\r\n',
    markdown: '[\\=SUM\\(1\\)](https://example.org/a,b)\n[](https://example.org/%28x%29)',
    html: '<!doctype html><html lang="en"><meta charset="utf-8"><title>Link Meteor export</title><table><thead><tr><th scope="col">Anchor text</th><th scope="col">URL</th><th scope="col">Source page title</th></tr></thead><tbody><tr><td>=SUM(1)</td><td>https://example.org/a,b</td><td>Say &quot;hi&quot;\nthere</td></tr><tr><td></td><td>https://example.org/(x)</td><td></td></tr></tbody></table></html>',
    text: 'https://example.org/a,b\nhttps://example.org/(x)',
  };
  const smallAbout = { ...about, count: 2 };
  for (const [format, data] of Object.entries(expected)) {
    const columns = ['anchorText', 'url', 'sourceTitle'];
    assert.equal(makeExport(small, { format, columns }).data, data, format);
    assert.equal(makeExport(small, { format, columns, about: smallAbout }).data, data, `${format} ignores about`);
  }
});

test('JSON without about is the row array; with about it is {about, rows}', () => {
  const plain = makeExport(fixtureRows, { format: 'json', columns: ['url'] });
  assert.ok(Array.isArray(JSON.parse(plain.data)));
  const withAbout = makeExport(fixtureRows, { format: 'json', columns: ['url'], about });
  const parsed = JSON.parse(withAbout.data);
  assert.deepEqual(Object.keys(parsed), ['about', 'rows']);
  assert.deepEqual(parsed.rows, JSON.parse(plain.data), 'rows is exactly the 0.2.2 array');
  assert.equal(parsed.about.exportedAt, '2026-09-26T21:32:59.000Z');
  assert.match(parsed.about.exportedAtLocal, /^2026-09-2[67]T\d\d:\d\d:59[+-]\d\d:\d\d$/);
  const local = new Date(parsed.about.exportedAtLocal);
  assert.equal(local.valueOf(), about.exportedAt.valueOf(), 'the local time and its offset name the same instant');
  assert.deepEqual({ ...parsed.about, exportedAt: undefined, exportedAtLocal: undefined }, { exportedAt: undefined, exportedAtLocal: undefined, collection: 'Urban heat', count: fixtureRows.length, view: about.view, filters: about.filters, version: '0.3.0' });
  assert.equal(withAbout.mime, 'application/json;charset=utf-8');
  assert.equal(withAbout.extension, 'json');
});

test('about blocks are checked, with useful errors', () => {
  const bad = [
    [null, /about must be an object/], [{ ...about, exportedAt: '2026-09-26' }, /exportedAt/], [{ ...about, exportedAt: new Date('x') }, /exportedAt/],
    [{ ...about, collection: 3 }, /collection/], [{ ...about, count: -1 }, /count/], [{ ...about, count: 1.5 }, /count/],
    [{ ...about, view: null }, /view/], [{ ...about, filters: 'none' }, /filters/], [{ ...about, filters: [1] }, /filters/],
    [{ ...about, columns: ['nope'] }, /columns/], [{ ...about, version: 3 }, /version/],
  ];
  for (const [value, pattern] of bad) for (const format of ['json', 'xlsx', 'csv']) assert.throws(() => makeExport(rows, { format, about: value }), pattern);
  const minimal = JSON.parse(makeExport(rows, { format: 'json', about: { exportedAt: about.exportedAt, collection: 'x' } }).data).about;
  assert.deepEqual([minimal.count, minimal.view, minimal.filters, minimal.version], [rows.length, '', [], '']);
});

test('formatted XLSX: bold frozen header, filters, fitted widths, relationship hyperlinks, text cells only', () => {
  const columns = ['anchorText', 'url', 'originalHref', 'sourceTitle', 'frameUrl', 'tags'];
  const result = makeExport(fixtureRows, { format: 'xlsx', columns, about: { ...about, columns } });
  assert.equal(result.extension, 'xlsx');
  assert.equal(result.mime, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const parts = members(result.data);
  assert.deepEqual([...parts.keys()], ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/_rels/sheet1.xml.rels', 'xl/worksheets/sheet2.xml']);
  const styles = parts.get('xl/styles.xml');
  const fonts = [...styles.match(/<fonts[^>]*>(.*?)<\/fonts>/s)[1].matchAll(/<font>(.*?)<\/font>/gs)].map(match => match[1]);
  const xfs = [...styles.match(/<cellXfs[^>]*>(.*?)<\/cellXfs>/s)[1].matchAll(/<xf ([^>]*)\/>/g)].map(match => Object.fromEntries([...match[1].matchAll(/(\w+)="([^"]*)"/g)].map(([, key, value]) => [key, value])));
  const sheet = parts.get('xl/worksheets/sheet1.xml');
  assert.match(sheet, /<pane [^>]*\bySplit="1"[^>]*\bstate="frozen"[^>]*\/>/);
  assert.match(sheet, /<pane [^>]*\btopLeftCell="A2"/);
  assert.match(sheet, new RegExp(`<autoFilter ref="A1:F${fixtureRows.length + 1}"/>`));
  assert.match(parts.get('xl/workbook.xml'), new RegExp(`<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Links!\\$A\\$1:\\$F\\$${fixtureRows.length + 1}</definedName>`));
  assert.match(parts.get('xl/workbook.xml'), /<sheet name="Links" sheetId="1" r:id="rId1"\/><sheet name="About" sheetId="2" r:id="rId2"\/>/);
  const widths = [...sheet.matchAll(/<col min="(\d+)" max="(\d+)" width="(\d+)" customWidth="1"\/>/g)].map(match => Number(match[3]));
  assert.equal(widths.length, columns.length);
  assert.ok(widths.every(width => width >= 8 && width <= 80), `widths ${widths}`);
  assert.ok(widths[1] > widths[0], 'the URL column is wider than the anchor text column');
  for (const part of [...parts.entries()].filter(([name]) => name.endsWith('.xml'))) assert.doesNotMatch(part[1], /<f[ >]/, `${part[0]} has no formula`);
  const all = cells(sheet);
  assert.equal(all.length, (fixtureRows.length + 1) * columns.length);
  assert.ok(all.every(cell => /t="inlineStr"/.test(cell.attrs)), 'every cell is an inline string');
  const style = cell => Number(cell.attrs.match(/s="(\d+)"/)[1]);
  assert.ok(all.every(cell => xfs[style(cell)].numFmtId === '49'), 'every cell has the text number format');
  const header = all.filter(cell => /^[A-Z]+1$/.test(cell.ref));
  assert.ok(header.every(cell => /<b\/>/.test(fonts[Number(xfs[style(cell)].fontId)])), 'the header is bold');
  assert.ok(all.filter(cell => !/^[A-Z]+1$/.test(cell.ref)).every(cell => !/<b\/>/.test(fonts[Number(xfs[style(cell)].fontId)])), 'the body is not bold');
  const text = ref => all.find(cell => cell.ref === ref).body.replace(/^<is><t[^>]*>|<\/t><\/is>$/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  const rels = parts.get('xl/worksheets/_rels/sheet1.xml.rels');
  const targets = new Map([...rels.matchAll(/<Relationship Id="(rId\d+)" Type="http:\/\/schemas.openxmlformats.org\/officeDocument\/2006\/relationships\/hyperlink" Target="([^"]*)" TargetMode="External"\/>/g)].map(([, id, target]) => [id, target.replace(/&amp;/g, '&')]));
  const links = [...sheet.match(/<hyperlinks>(.*?)<\/hyperlinks>/s)[1].matchAll(/<hyperlink ref="([A-Z]+\d+)" r:id="(rId\d+)"\/>/g)].map(([, ref, id]) => [ref, id]);
  assert.equal(targets.size, links.length);
  for (const [ref, id] of links) assert.equal(targets.get(id), text(ref), `${ref} links to its exact text`);
  const linked = new Set(links.map(([ref]) => ref));
  assert.ok(linked.has('B2') && text('B2') === 'https://example.org/report(1)?a=1&b=2');
  assert.ok(linked.has('B3') && text('B3').startsWith('mailto:'), 'mailto is clickable');
  assert.ok(!linked.has('B4') && text('B4') === 'tel:+12125550123', 'tel stays plain text');
  assert.ok(!linked.has('C2'), 'a relative original href is not a link');
  assert.ok(!linked.has('C5'), 'an address with a space is not a link');
  assert.ok(linked.has('E5'), 'frame URLs are clickable');
  assert.ok(!linked.has('A2') && text('A2') === '=SUM(1)', 'a formula-like label stays inert text');
  assert.ok([...linked].every(ref => /^[BCE]\d+$/.test(ref)), 'only URL columns are linked');
  const about2 = cells(parts.get('xl/worksheets/sheet2.xml'));
  const aboutValues = [];
  for (const cell of about2) { const [, column, row] = cell.ref.match(/([A-Z]+)(\d+)/); (aboutValues[row - 1] ||= [])[column === 'A' ? 0 : 1] = cell.body.replace(/^<is><t[^>]*>|<\/t><\/is>$/g, ''); }
  assert.deepEqual(aboutValues.map(row => row[0]), ['Exported (local time)', 'Exported (UTC)', 'Collection', 'Links', 'View', 'Filter', 'Filter', 'Columns', 'Cells', 'Link Meteor version']);
  assert.equal(aboutValues[1][1], '2026-09-26 21:32:59 UTC');
  assert.match(aboutValues[0][1], /^2026-09-2[67] \d\d:\d\d:59 \(UTC[+-]\d\d:\d\d\)$/);
  assert.deepEqual(aboutValues.slice(2).map(row => row[1]), ['Urban heat', String(fixtureRows.length), about.view, 'Search: “heat”', 'Selected links only', 'Anchor text, URL, Original href, Source page title, Frame URL, Tags', 'Every cell is text. Nothing is a formula, number or date.', '0.3.0']);
  assert.ok(about2.every(cell => /t="inlineStr"/.test(cell.attrs)));
  assert.doesNotMatch(parts.get('xl/worksheets/sheet2.xml'), /<pane|<autoFilter|<hyperlinks/);
});

test('formatted XLSX with no filters and no rows is still a valid, filtered header', () => {
  const parts = members(makeExport([], { format: 'xlsx', about: { exportedAt: about.exportedAt, collection: '', count: 0 } }).data);
  assert.match(parts.get('xl/worksheets/sheet1.xml'), /<autoFilter ref="A1:B1"\/>/);
  assert.ok(!parts.has('xl/worksheets/_rels/sheet1.xml.rels'), 'no hyperlinks, no relationships part');
  assert.match(parts.get('xl/worksheets/sheet2.xml'), /<t>Filters<\/t>.*?<t>None<\/t>/s);
});

test('hyperlink targets are exact web or mail addresses within Excel limits', () => {
  assert.equal(hyperlinkTarget('https://example.org/a?b=1&c=2'), 'https://example.org/a?b=1&c=2');
  assert.equal(hyperlinkTarget('mailto:a@example.org'), 'mailto:a@example.org');
  for (const value of ['', 'tel:+1', 'javascript:alert(1)', '/relative', 'https://example.org/a b', 'https://example.org/\n', 'ftp://example.org/', `https://example.org/${'x'.repeat(2100)}`, 'example.org']) assert.equal(hyperlinkTarget(value), '', value);
});

test('beyond Excel’s hyperlink limit, the rest stay exact text and About says so', () => {
  const many = Array.from({ length: MAX_HYPERLINKS + 2 }, (_, index) => ({ anchorText: '', url: `https://example.org/${index}` }));
  const parts = members(makeExport(many, { format: 'xlsx', about: { ...about, count: many.length } }).data);
  const sheet = parts.get('xl/worksheets/sheet1.xml');
  assert.equal(sheet.match(/<hyperlink /g).length, MAX_HYPERLINKS);
  assert.match(sheet, new RegExp(`<c r="B${MAX_HYPERLINKS + 3}" s="1" t="inlineStr"><is><t>https://example.org/${MAX_HYPERLINKS + 1}</t>`));
  assert.match(parts.get('xl/worksheets/sheet2.xml'), /Clickable links.*The first 65,530 web and mail addresses are clickable/s);
});

test('exportFileName: overrides, the pattern settings and the extension map', async () => {
  const { FORMAT_EXTENSIONS } = await import('../src/core/export.js');
  const date = new Date(2026, 8, 26, 14, 32);
  for (const [format, extension] of Object.entries(FORMAT_EXTENSIONS)) {
    assert.equal(makeExport(webRows, { format }).extension, extension);
    assert.equal(exportFileName({ collection: 'Heat', extension, date, override: `report.${extension.toUpperCase()}` }), `report.${extension}`);
  }
  assert.equal(exportFileName({ collection: 'Heat', extension: 'xlsx', date, override: 'report.csv' }), 'report.csv.xlsx', 'only a matching extension is removed');
  assert.equal(exportFileName({ collection: 'Heat', extension: 'csv', date, override: '   ' }), 'Heat_2026-09-26_1432.csv', 'a cleared field returns to the pattern');
  assert.equal(exportFileName({ collection: 'Heat', extension: 'csv', date, override: '12:30 notes' }), '12-30-notes.csv', 'never a colon');
  assert.equal(exportFileName({ collection: 'Heat', extension: 'csv', date, settings: { exportPrefix: 'lab', exportTimestamp: false } }), 'lab_Heat.csv');
  assert.equal(exportFileName({ collection: 'Heat', extension: 'csv', date, settings: { exportPrefix: 'lab', exportTimestampFormat: 'date' } }), 'lab_Heat_2026-09-26.csv');
});
