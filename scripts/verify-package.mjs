// Read-only verification of the stored-entry ZIP produced by scripts/package.mjs.
// Compare actual member bytes with src/, not only the release manifest's claims.
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

function invariant(ok, message) {
  if (!ok) throw new Error(`Invalid release ZIP: ${message}`);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function readPackagedMembers(zip) {
  invariant(zip.length >= 22 && zip.readUInt32LE(zip.length - 22) === 0x06054b50, 'missing end record');
  const end = zip.length - 22;
  invariant(zip.readUInt16LE(end + 4) === 0 && zip.readUInt16LE(end + 6) === 0, 'multi-disk archive');
  invariant(zip.readUInt16LE(end + 20) === 0, 'unexpected archive comment');
  const count = zip.readUInt16LE(end + 10);
  invariant(zip.readUInt16LE(end + 8) === count, 'member count differs');
  const directorySize = zip.readUInt32LE(end + 12);
  const directoryStart = zip.readUInt32LE(end + 16);
  invariant(directoryStart + directorySize === end, 'directory bounds differ');

  const members = new Map();
  let cursor = directoryStart;
  for (let i = 0; i < count; i++) {
    invariant(cursor + 46 <= end && zip.readUInt32LE(cursor) === 0x02014b50, 'bad central entry');
    const flags = zip.readUInt16LE(cursor + 8);
    const method = zip.readUInt16LE(cursor + 10);
    const checksum = zip.readUInt32LE(cursor + 16);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const size = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    invariant(next <= end, 'central entry exceeds directory');
    const name = zip.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    invariant(name && !name.startsWith('/') && !name.split('/').includes('..') && !name.endsWith('/'), `unsafe member name ${name}`);
    invariant(!members.has(name), `duplicate member ${name}`);
    invariant(flags === 0x0800 && method === 0 && compressedSize === size, `unsupported member encoding ${name}`);
    invariant(localOffset + 30 <= directoryStart && zip.readUInt32LE(localOffset) === 0x04034b50, `bad local entry ${name}`);
    invariant(zip.readUInt16LE(localOffset + 6) === flags && zip.readUInt16LE(localOffset + 8) === method, `local metadata differs for ${name}`);
    invariant(zip.readUInt32LE(localOffset + 14) === checksum && zip.readUInt32LE(localOffset + 18) === size && zip.readUInt32LE(localOffset + 22) === size, `local size or checksum differs for ${name}`);
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    invariant(dataStart + size <= directoryStart, `local data exceeds directory for ${name}`);
    invariant(zip.toString('utf8', localOffset + 30, localOffset + 30 + localNameLength) === name, `local name differs for ${name}`);
    const data = zip.subarray(dataStart, dataStart + size);
    invariant(crc32(data) === checksum, `CRC differs for ${name}`);
    members.set(name, data);
    cursor = next;
  }
  invariant(cursor === end, 'unparsed central directory bytes');
  return members;
}

async function sourceFiles(source) {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(relative(source, path).split(sep).join('/'));
      else throw new Error(`Unexpected source entry: ${path}`);
    }
  }
  await walk(source);
  return files.sort();
}

export async function verifyPackagedSource(zip, source) {
  const members = readPackagedMembers(zip);
  const expected = await sourceFiles(source);
  const actual = [...members.keys()].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Release ZIP members differ from src/: expected ${expected.join(', ')}; found ${actual.join(', ')}`);
  }
  for (const path of expected) {
    if (!members.get(path).equals(await readFile(join(source, path)))) {
      throw new Error(`Stale release ZIP member: ${path}. Rebuild and package the current source.`);
    }
  }
  return { members: expected.length };
}
