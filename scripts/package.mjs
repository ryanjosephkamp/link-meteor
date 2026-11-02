import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseFiles } from './release-files.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'src');
const dist = join(root, 'dist');
const artifacts = join(root, 'artifacts');
const scratch = join(root, '.scratch');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sourceGitHead = git('rev-parse', 'HEAD');
const sourceFilesGitDirty = Boolean(git('status', '--porcelain=v1', '--untracked-files=all', '--', 'src'));
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const extensionManifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
if (extensionManifest.manifest_version !== 3 || extensionManifest.version !== packageJson.version) {
  throw new Error('dist/manifest.json must be a version-matched Manifest V3 build');
}

async function filesBelow(directory) {
  const files = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(relative(directory, path).split(sep).join('/'));
      else throw new Error(`Refusing non-file entry in release tree: ${path}`);
    }
  }
  await walk(directory);
  return files.sort();
}

const expected = releaseFiles(await filesBelow(source), extensionManifest);

for (const [label, directory] of [['source', source], ['dist', dist]]) {
  const actual = await filesBelow(directory);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} files differ from the release allowlist. Expected ${expected.join(', ')}; found ${actual.join(', ')}`);
  }
}

const entries = [];
for (const path of expected) {
  const data = await readFile(join(dist, path));
  if (!data.equals(await readFile(join(source, path)))) throw new Error(`Stale dist file: ${path}. Run npm run build first.`);
  entries.push({ path, data, sha256: sha256(data) });
}

// Fixed ZIP metadata, sorted names, and stored entries make identical dist bytes yield identical archives.
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function archive(items) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { path, data } of items) {
    const name = Buffer.from(path, 'utf8');
    const checksum = crc32(data);
    if (data.length > 0xffffffff || offset > 0xffffffff) throw new Error('Release ZIP exceeds the supported size');
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); // version and UTF-8 names
    local.writeUInt16LE(33, 12); // DOS 1980-01-01, 00:00
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(33, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centrals.reduce((size, part) => size + part.length, 0);
  if (items.length > 0xffff || offset + centralSize > 0xffffffff) throw new Error('Release ZIP exceeds the supported directory size');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(items.length, 8); end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

const zip = archive(entries);
const basename = `link-meteor-${extensionManifest.version}`;
await mkdir(artifacts, { recursive: true });
await mkdir(scratch, { recursive: true });
const temp = await mkdtemp(join(scratch, 'package-'));
try {
  const zipPath = join(artifacts, `${basename}.zip`);
  await writeFile(join(temp, 'release.zip'), zip);
  await rename(join(temp, 'release.zip'), zipPath);

  const statusLines = git('status', '--porcelain=v1', '--untracked-files=all').split('\n').filter(Boolean);
  const details = {
    formatVersion: 1,
    extensionVersion: extensionManifest.version,
    sourceGitHead,
    sourceFilesGitDirty,
    gitWorkingTreeDirtyAtPackaging: statusLines.length > 0,
    archive: { path: `artifacts/${basename}.zip`, bytes: zip.length, sha256: sha256(zip) },
    buildFiles: entries.map(({ path, data, sha256: digest }) => ({ path, bytes: data.length, sha256: digest })),
  };
  const manifestPath = join(artifacts, `${basename}.sha256.json`);
  await writeFile(join(temp, 'manifest.json'), JSON.stringify(details, null, 2) + '\n');
  await rename(join(temp, 'manifest.json'), manifestPath);
  console.log(JSON.stringify({ zip: zipPath, manifest: manifestPath, files: entries.length, bytes: zip.length, sha256: details.archive.sha256, sourceGitHead: details.sourceGitHead, dirty: details.gitWorkingTreeDirtyAtPackaging }));
} finally {
  await rm(temp, { recursive: true, force: true });
}
