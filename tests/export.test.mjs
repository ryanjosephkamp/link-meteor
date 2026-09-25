import test from 'node:test';
import assert from 'node:assert/strict';
import { makeExport, COLUMNS } from '../src/core/export.js';
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
    { anchorText: 'Call', url: 'tel:+12125550123' },
    { anchorText: 'Web', url: 'https://example.org/report(1)' },
  ];
  assert.equal(makeExport(links, { format: 'text' }).data, links.map(x => x.url).join('\n'));
  const markdown = makeExport(links, { format: 'markdown' }).data;
  assert.match(markdown, /mailto:team@example\.org\?subject=Plan%282026%29/);
  assert.match(markdown, /tel:\+12125550123/);
  assert.match(markdown, /https:\/\/example\.org\/report%281%29/);
  assert.equal(links[0].url, 'mailto:team@example.org?subject=Plan(2026)');
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi']) {
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
