import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { readPackagedMembers, verifyPackagedSource } from '../scripts/verify-package.mjs';

const root = resolve(import.meta.dirname, '..');
const source = join(root, 'src');

// A development version has no ZIP until it is packaged for release. The verifier's own checks
// then run against the newest packaged ZIP, and the current-source check reports a skip.
async function packagedZip() {
  const { version } = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
  try { return { version, current: true, zip: await readFile(join(root, 'artifacts', `link-meteor-${version}.zip`)) }; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const packaged = (await readdir(join(root, 'artifacts')))
    .map((name) => name.match(/^link-meteor-(\d+)\.(\d+)\.(\d+)\.zip$/)).filter(Boolean)
    .sort((a, b) => (a[1] - b[1]) || (a[2] - b[2]) || (a[3] - b[3]));
  assert.ok(packaged.length, 'At least one packaged ZIP is needed to exercise the verifier');
  return { version, current: false, zip: await readFile(join(root, 'artifacts', packaged.at(-1)[0])) };
}

test('release ZIP members are the current extension source', async (t) => {
  const { version, current, zip } = await packagedZip();
  if (!current) { t.skip(`no ZIP is packaged for ${version} yet; run npm run build and npm run package before a release`); return; }
  const result = await verifyPackagedSource(zip, source);
  assert.ok(result.members > 0);
});

test('a source change outside the site copy pairs invalidates the ZIP', async () => {
  const scratch = join(root, '.scratch');
  await mkdir(scratch, { recursive: true });
  const temp = await mkdtemp(join(scratch, 'package-sync-'));
  try {
    const copiedSource = join(temp, 'src');
    const { zip } = await packagedZip();
    for (const [name, bytes] of readPackagedMembers(zip)) {
      const path = join(copiedSource, name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    }
    await verifyPackagedSource(zip, copiedSource);
    const background = join(copiedSource, 'background.js');
    await writeFile(background, Buffer.concat([await readFile(background), Buffer.from('\n// changed after packaging\n')]));
    await assert.rejects(verifyPackagedSource(zip, copiedSource), /Stale release ZIP member: background\.js/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('a corrupted ZIP member is rejected before comparing source', async () => {
  const corrupt = Buffer.from((await packagedZip()).zip);
  const dataStart = 30 + corrupt.readUInt16LE(26) + corrupt.readUInt16LE(28);
  corrupt[dataStart] ^= 1;
  await assert.rejects(verifyPackagedSource(corrupt, source), /Invalid release ZIP: CRC differs/);
});
