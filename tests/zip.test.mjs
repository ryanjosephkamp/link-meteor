// The ZIP writer (src/core/zip.js): stored entries with UTF-8 names, read back by the release
// ZIP reader (scripts/verify-package.mjs), which checks every header, size and checksum.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { crc32, zip, MAX_ZIP_ENTRIES } from '../src/core/zip.js';
import { readPackagedMembers } from '../scripts/verify-package.mjs';
import { writeXlsx } from '../src/core/xlsx.js';

const bytes = (text) => new TextEncoder().encode(text);

test('crc32 matches the standard check value, for any length', () => {
  assert.equal(crc32(bytes('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
  assert.equal(crc32(bytes('The quick brown fox jumps over the lazy dog')), 0x414fa339);
});

test('text and bytes go in as stored entries and come back byte for byte', () => {
  const pdf = new Uint8Array(70000).map((_, i) => (i * 31 + 7) % 256);
  const archive = zip([['notes/read me.txt', 'Grüße, 你好'], ['papers/ünïcode ✓.pdf', pdf], ['empty.bin', new Uint8Array(0)]]);
  const members = readPackagedMembers(Buffer.from(archive));
  assert.deepEqual([...members.keys()], ['notes/read me.txt', 'papers/ünïcode ✓.pdf', 'empty.bin']);
  assert.equal(Buffer.from(members.get('notes/read me.txt')).toString('utf8'), 'Grüße, 你好');
  assert.deepEqual(new Uint8Array(members.get('papers/ünïcode ✓.pdf')), pdf);
  assert.equal(members.get('empty.bin').length, 0);
  assert.equal(archive.length, [...members].reduce((n, [name, data]) => n + 76 + 2 * bytes(name).length + data.length, 22), 'nothing but headers and the files');
});

test('the same input gives the same bytes, and the input is not changed', () => {
  const data = bytes('same');
  assert.deepEqual(zip([['a.txt', data], ['b.txt', 'b']]), zip([['a.txt', data], ['b.txt', 'b']]));
  assert.deepEqual(data, bytes('same'));
});

test('unsafe or repeated names and other content are refused', () => {
  for (const name of ['', '/abs.pdf', 'folder/', '../up.pdf', 'a/../b.pdf', 'back\\slash.pdf', 'new\nline.pdf']) assert.throws(() => zip([[name, 'x']]), /Unsafe name/, JSON.stringify(name));
  assert.throws(() => zip([['a.pdf', 'x'], ['a.pdf', 'y']]), /twice/);
  assert.throws(() => zip([['a.pdf', 42]]), /text or bytes/);
  assert.throws(() => zip(Array.from({ length: MAX_ZIP_ENTRIES + 1 }, (_, i) => [`${i}`, ''])), /at most 65,535 files/);
});

test('the workbook writer still writes the same workbook through it', () => {
  const book = writeXlsx(['Anchor text', 'URL'], [['A', 'https://a.example/'], ['B', 'mailto:b@example.org']]);
  const members = readPackagedMembers(Buffer.from(book));
  assert.ok(members.has('[Content_Types].xml') && members.has('xl/workbook.xml') && members.has('xl/worksheets/sheet1.xml'));
  assert.equal(createHash('sha256').update(book).digest('hex'), '9137191bf830462c6184ea0150e87ecc1b2e68b88b568737844af4ec29b13f81');
});
