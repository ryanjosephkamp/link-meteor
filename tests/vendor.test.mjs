// PDF.js as shipped inside Link Meteor (src/vendor/pdfjs): the committed files are exactly the
// ones its README records, checked here without the network. scripts/vendor-pdfjs.mjs, run by a
// maintainer, is the only thing that changes them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FIXED_FILES } from '../scripts/release-files.mjs';

const root = resolve(import.meta.dirname, '..'), vendor = resolve(root, 'src/vendor/pdfjs');
const readme = await readFile(resolve(vendor, 'README.md'), 'utf8');
const recorded = [...readme.matchAll(/^- `([^`]+)`: (\d+) bytes, SHA-256 `([0-9a-f]{64})`$/gm)].map(([, name, size, sha256]) => ({ name, size: Number(size), sha256 }));

test('the vendored PDF.js files are the recorded ones, byte for byte', async () => {
  assert.deepEqual(recorded.map((file) => file.name), ['pdf.min.mjs', 'pdf.worker.min.mjs', 'LICENSE']);
  for (const file of recorded) {
    const bytes = await readFile(resolve(vendor, file.name));
    assert.equal(bytes.length, file.size, `${file.name} size`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `${file.name} changed: only scripts/vendor-pdfjs.mjs may change it`);
  }
  assert.deepEqual((await readdir(vendor)).sort(), ['LICENSE', 'README.md', 'pdf.min.mjs', 'pdf.worker.min.mjs'], 'nothing else is vendored');
});

test('the record names the version, its source and its license, and the files carry their notice', async () => {
  const version = readme.match(/^- Version: (\d+\.\d+\.\d+)$/m)?.[1];
  assert.ok(version, 'a version');
  assert.match(readme, new RegExp(`^- Source: https://registry\\.npmjs\\.org/pdfjs-dist/-/pdfjs-dist-${version.replaceAll('.', '\\.')}\\.tgz$`, 'm'));
  assert.match(readme, /^- Package integrity: `sha512-[A-Za-z0-9+/]+=*`$/m);
  assert.match(await readFile(resolve(vendor, 'LICENSE'), 'utf8'), /Apache License\s+Version 2\.0/);
  for (const name of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
    const head = (await readFile(resolve(vendor, name), 'utf8')).slice(0, 1200);
    assert.match(head, /Licensed under the Apache License, Version 2\.0/, `${name} keeps its license notice`);
    assert.ok(new RegExp(`pdfjsVersion = '${version.replaceAll('.', '\\.')}'|"${version.replaceAll('.', '\\.')}"`).test(await readFile(resolve(vendor, name), 'utf8')), `${name} is version ${version}`);
  }
});

test('the release ships them, and no web page can load them', async () => {
  for (const name of ['pdf.min.mjs', 'pdf.worker.min.mjs', 'LICENSE', 'README.md']) assert.ok(FIXED_FILES.includes(`vendor/pdfjs/${name}`), `${name} is in the release list`);
  const manifest = JSON.parse(await readFile(resolve(root, 'src/manifest.json'), 'utf8'));
  assert.equal(manifest.web_accessible_resources, undefined, 'nothing is web-accessible');
  assert.match(manifest.content_security_policy.extension_pages, /script-src 'self'/);
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/, 'Link Meteor’s own pages still can’t reach the network');
});
