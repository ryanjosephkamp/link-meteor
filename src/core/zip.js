// A ZIP writer for stored (uncompressed) entries, pure. The workbook writer has used it since
// 0.3.0; 0.6.0 moved it here for Download as one ZIP, where each PDF stays byte for byte what its
// site sent. Names are UTF-8, the date is fixed (1980-01-01), and identical input gives identical
// bytes.
const encoder = new TextEncoder();
const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let bit = 0; bit < 8; bit++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); table[n] = c >>> 0; }
  return table;
})();
// The classic ZIP format holds at most 65,535 entries and 4 GB; this writer has no large-file format.
export const MAX_ZIP_ENTRIES = 65535, MAX_ZIP_BYTES = 0xffffffff;

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// files: [[name, content]], content a string (written as UTF-8) or a Uint8Array. Returns the
// archive as one Uint8Array. Refuses repeated or unsafe names, so a caller names repeats first.
export function zip(files) {
  if (files.length > MAX_ZIP_ENTRIES) throw new Error(`A ZIP file can hold at most ${MAX_ZIP_ENTRIES.toLocaleString('en-US')} files`);
  const seen = new Set();
  const entries = files.map(([filename, content]) => {
    if (typeof filename !== 'string' || !filename || filename.startsWith('/') || filename.endsWith('/') || filename.split('/').includes('..') || /[\u0000-\u001f\\]/u.test(filename)) throw new Error(`Unsafe name for a ZIP entry: ${filename}`);
    if (seen.has(filename)) throw new Error(`The ZIP would hold ${filename} twice`);
    seen.add(filename);
    const name = encoder.encode(filename), data = typeof content === 'string' ? encoder.encode(content) : content;
    if (!(data instanceof Uint8Array)) throw new Error(`The ZIP entry ${filename} must be text or bytes`);
    return { name, data, crc: crc32(data) };
  });
  const localSize = entries.reduce((n, entry) => n + 30 + entry.name.length + entry.data.length, 0);
  const centralSize = entries.reduce((n, entry) => n + 46 + entry.name.length, 0);
  if (localSize + centralSize + 22 > MAX_ZIP_BYTES) throw new Error('These files are too large for one ZIP file');
  const output = new Uint8Array(localSize + centralSize + 22), view = new DataView(output.buffer);
  const u16 = (offset, value) => view.setUint16(offset, value, true), u32 = (offset, value) => view.setUint32(offset, value, true);
  let at = 0;
  for (const entry of entries) {
    entry.offset = at;
    u32(at, 0x04034b50); u16(at + 4, 20); u16(at + 6, 0x0800);
    u16(at + 8, 0); u16(at + 10, 0); u16(at + 12, 33); // stored, 1980-01-01
    u32(at + 14, entry.crc); u32(at + 18, entry.data.length); u32(at + 22, entry.data.length);
    u16(at + 26, entry.name.length); u16(at + 28, 0);
    output.set(entry.name, at + 30); output.set(entry.data, at + 30 + entry.name.length);
    at += 30 + entry.name.length + entry.data.length;
  }
  for (const entry of entries) {
    u32(at, 0x02014b50); u16(at + 4, 20); u16(at + 6, 20); u16(at + 8, 0x0800);
    u16(at + 10, 0); u16(at + 12, 0); u16(at + 14, 33);
    u32(at + 16, entry.crc); u32(at + 20, entry.data.length); u32(at + 24, entry.data.length);
    u16(at + 28, entry.name.length); u32(at + 42, entry.offset);
    output.set(entry.name, at + 46);
    at += 46 + entry.name.length;
  }
  u32(at, 0x06054b50); u16(at + 8, entries.length); u16(at + 10, entries.length);
  u32(at + 12, centralSize); u32(at + 16, localSize);
  return output;
}
