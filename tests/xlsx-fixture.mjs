import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeExport } from '../src/core/export.js';
import { queryLinks } from '../src/core/model.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.scratch');
const link = (id, anchorText, url, sourceUrl, extras = {}) => ({
  id, anchorText, url, sourceUrl, accessibleLabel: '', originalHref: url,
  sourceTitle: '', frameUrl: '', capturedAt: '2026-09-25T00:00:00.000Z',
  batchId: 'fixture-batch', notes: '', tags: [], ...extras,
});
const links = [
  link('formula', '=1+1', 'https://example.org/report(1)', 'https://research.example/',
    { sourceTitle: 'A,"B"\n雪', notes: 'literal _x0001_ and control \u0001' }),
  link('other-source', 'Alternate label', 'https://example.org/report(1)', 'https://other.example/',
    { sourceTitle: 'Second source' }),
  link('empty', '', 'mailto:team@example.org?subject=Hello', 'https://research.example/'),
  link('unicode', '雪 😀', 'tel:+12125550123', 'https://research.example/', { notes: 'α β 🎯' }),
];
const before = JSON.stringify(links);
const rows = queryLinks(links, { dedupe: 'url' }).rows;
if (rows.length !== 3 || rows[0].occurrenceIds.join(',') !== 'formula,other-source') throw new Error('Grouped fixture provenance was lost');
const columns = ['sourceTitle', 'notes', 'anchorText', 'url'];
const exported = makeExport(rows, { format: 'xlsx', columns });
if (!(exported.data instanceof Uint8Array) || JSON.stringify(links) !== before) throw new Error('XLSX export mutated fixture input');
const expected = {
  columns,
  rows: [
    ['Source page title', 'Notes', 'Anchor text', 'URL'],
    ...rows.map(row => columns.map(key => String(row[key] ?? ''))),
  ],
  provenance: rows.map(row => ({ id: row.id, occurrenceIds: row.occurrenceIds, sourceUrls: row.occurrences.map(item => item.sourceUrl) })),
};
await mkdir(out, { recursive: true });
const xlsx = join(out, 'workbook-fixture.xlsx');
const json = join(out, 'workbook-fixture.expected.json');
await writeFile(xlsx, exported.data);
await writeFile(json, JSON.stringify(expected, null, 2) + '\n');
console.log(JSON.stringify({ xlsx, expected: json, rows: rows.length, occurrences: links.length, columns }));
