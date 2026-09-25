import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { readPackagedMembers, verifyPackagedSource } from '../scripts/verify-package.mjs';

const root = resolve(import.meta.dirname, '..');
const source = join(root, 'src');

async function currentZip() {
  const { version } = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
  return readFile(join(root, 'artifacts', `link-meteor-${version}.zip`));
}

test('release ZIP members are the current extension source', async () => {
  const result = await verifyPackagedSource(await currentZip(), source);
  assert.ok(result.members > 0);
});

test('a source change outside the site copy pairs invalidates the ZIP', async () => {
  const scratch = join(root, '.scratch');
  await mkdir(scratch, { recursive: true });
  const temp = await mkdtemp(join(scratch, 'package-sync-'));
  try {
    const copiedSource = join(temp, 'src');
    const zip = await currentZip();
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
  const corrupt = Buffer.from(await currentZip());
  const dataStart = 30 + corrupt.readUInt16LE(26) + corrupt.readUInt16LE(28);
  corrupt[dataStart] ^= 1;
  await assert.rejects(verifyPackagedSource(corrupt, source), /Invalid release ZIP: CRC differs/);
});
