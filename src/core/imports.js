// Imports (0.5.0): reading CSV, TSV, link lists, Excel workbooks and Link Meteor's own JSON exports
// as rows of text, guessing how their columns map to a link's parts, and planning what an import
// adds and what it skips, with the reason for each skipped row. Pure: no Chrome and no DOM. The
// workbench supplies inflating and XML parsing for workbooks, and reads HTML itself. Nothing here
// visits an address. The contract is in docs/CONTRACTS.md ("Imports").
import { MAX_CUSTOM_FIELDS, MAX_FIELD_NAME, MAX_FIELD_VALUE, MAX_IMPORTED } from './model.js';

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
export const MAX_IMPORT_LINKS = 20000;
// A workbook part larger than this once unpacked is refused instead of read.
export const MAX_XLSX_PART = 150 * 1024 * 1024;
// Why a row is skipped, as the preview table says it. `repeat` names the row it repeats.
export const SKIP_REASONS = Object.freeze({
  'no-address': 'No address', 'not-link': 'Not a web, email or phone address', repeat: 'Repeats row',
  saved: 'Already saved there', limit: `Over the ${MAX_IMPORT_LINKS.toLocaleString('en-US')}-link limit`,
});
const PROGRESS_EVERY = 10000;

/* Text ----------------------------------------------------------------------------------------- */
// A file's bytes as text: UTF-16 with a byte-order mark, else UTF-8 (a UTF-8 mark is dropped), else
// Windows-1252, which older spreadsheets still save.
export function decodeText(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view[0] === 0xff && view[1] === 0xfe) return new TextDecoder('utf-16le').decode(view.subarray(2));
  if (view[0] === 0xfe && view[1] === 0xff) return new TextDecoder('utf-16be').decode(view.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(view); } catch { /* not UTF-8 */ }
  // Some decoders read windows-1252 as Latin-1; its 0x80 to 0x9F are punctuation, not controls.
  return new TextDecoder('windows-1252').decode(view).replace(/[\x80-\x9f]/g, (char) => WINDOWS_1252[char.charCodeAt(0) - 0x80] || char);
}
const WINDOWS_1252 = '€\x81‚ƒ„…†‡ˆ‰Š‹Œ\x8dŽ\x8f\x90‘’“”•–—˜™š›œ\x9džŸ';

// RFC 4180: fields separated by `delimiter`, a field that starts with a quote runs to its closing
// quote (a doubled quote is one quote, and line breaks inside are kept), rows end at CRLF, LF or
// CR, and a leading byte-order mark is ignored. A quote inside an unquoted field is kept as text.
export function parseDelimited(text, delimiter = ',', { onProgress } = {}) {
  if (typeof text !== 'string') throw new Error('text must be a string');
  if (typeof delimiter !== 'string' || delimiter.length !== 1 || /["\r\n]/.test(delimiter)) throw new Error('The delimiter must be one character other than a quote or a line break');
  const rows = [], n = text.length;
  let row = [], field = '', fresh = true, quoted = false, i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const endRow = () => { row.push(field); rows.push(row); row = []; field = ''; fresh = true; if (onProgress && rows.length % PROGRESS_EVERY === 0) onProgress(rows.length); };
  while (i < n) {
    const ch = text[i];
    if (quoted) {
      const next = text.indexOf('"', i);
      if (next < 0) { field += text.slice(i); i = n; break; }
      field += text.slice(i, next);
      if (text[next + 1] === '"') { field += '"'; i = next + 2; } else { quoted = false; i = next + 1; }
      continue;
    }
    if (ch === delimiter) { row.push(field); field = ''; fresh = true; i++; continue; }
    if (ch === '\n' || ch === '\r') { endRow(); i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1; continue; }
    if (ch === '"' && fresh) { quoted = true; fresh = false; i++; continue; }
    let j = i + 1;
    while (j < n) { const c = text[j]; if (c === delimiter || c === '\n' || c === '\r') break; j++; }
    field += text.slice(i, j); fresh = false; i = j;
  }
  if (field || row.length || quoted || !fresh) endRow();
  return rows;
}

// The likeliest delimiter of a table's first line: tab, comma or semicolon (comma when none).
export function sniffDelimiter(text) {
  const line = (String(text).replace(/^﻿/, '').split(/\r\n|\n|\r/).find((item) => item.trim()) || '').replace(/"(?:[^"]|"")*"/g, '');
  let best = ',', most = 0;
  for (const delimiter of ['\t', ',', ';']) { const found = line.split(delimiter).length - 1; if (found > most) { best = delimiter; most = found; } }
  return best;
}

// Text as a table or a list: {kind: 'table', rows, delimiter} or {kind: 'list', entries}. kind is
// 'table' (delimiter ',', '\t', ';' or 'sniff'), 'list', or 'text': a tab-separated table when its
// first line holds a tab (cells copied from a spreadsheet), otherwise a list.
export function readText(text, { kind = 'text', delimiter = 'sniff', onProgress } = {}) {
  const first = String(text).replace(/^\uFEFF/, '').split(/\r\n|\n|\r/, 100).find((line) => line.trim()) || '';
  if (kind === 'list' || (kind === 'text' && !first.includes('\t'))) return { kind: 'list', entries: parseList(text, { onProgress }) };
  const chosen = kind === 'text' ? '\t' : delimiter === 'sniff' ? sniffDelimiter(text) : delimiter;
  return { kind: 'table', delimiter: chosen, rows: parseDelimited(text, chosen, { onProgress }) };
}

/* Lists ---------------------------------------------------------------------------------------- */
const MARKDOWN_LINK = /\[((?:\\.|[^\\\]])*)\]\(\s*(?:<([^<>\n]*)>|((?:[^\s()<>]|\([^\s()<>]*\))+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const BARE_ADDRESS = /(?:https?:\/\/|mailto:|tel:)[^\s<>"'`]+/gi;
const CLOSERS = { ')': '(', ']': '[', '}': '{' };

// An address found in running text, without the punctuation that ends a sentence around it and
// without a closing bracket it doesn't open.
export function trimAddress(value) {
  let text = String(value);
  for (;;) {
    const last = text.at(-1);
    if (last && /[.,;:!?*'"‘’“”»›…]/u.test(last)) { text = text.slice(0, -1); continue; }
    if (CLOSERS[last] && text.split(last).length > text.split(CLOSERS[last]).length) { text = text.slice(0, -1); continue; }
    return text;
  }
}

// The words around a line's only address, without list markers and separators, as its anchor text.
function aroundText(text) {
  return text.replace(/<[^>]*>/g, ' ').replace(/^\s*(?:[-*+•‣◦]|\d+[.)]|>+)\s+/u, '').replace(/^\s*\[[ xX]\]\s+/, '')
    .replace(/\s+/gu, ' ').replace(/^[\s\-–—:|,;·•()<>[\]]+|[\s\-–—:|,;·•()<>[\]]+$/gu, '');
}

// One entry per Markdown link, `[text](address)`, and per bare http(s), mailto: or tel: address,
// in reading order: {anchorText, href, line}. A line with a single bare address and other words
// uses those words as its anchor text ("Heat and Health Lab: https://…").
export function parseList(text, { onProgress } = {}) {
  if (typeof text !== 'string') throw new Error('text must be a string');
  const found = [];
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/);
  lines.forEach((line, index) => {
    if (onProgress && index && index % PROGRESS_EVERY === 0) onProgress(index);
    if (!/https?:|mailto:|tel:|\]\(/i.test(line)) return;
    const items = [];
    const rest = line.replace(MARKDOWN_LINK, (match, label, angled, plain, at) => {
      items.push({ at, anchorText: label.replace(/\\(.)/g, '$1').replace(/\s+/gu, ' ').trim(), href: (angled ?? plain).trim(), markdown: true });
      return ' '.repeat(match.length);
    });
    for (const match of rest.matchAll(BARE_ADDRESS)) {
      const href = trimAddress(match[0]);
      if (/^(?:https?:\/\/|mailto:|tel:)$/i.test(href)) continue;
      items.push({ at: match.index, anchorText: '', href, end: match.index + match[0].length });
    }
    items.sort((a, b) => a.at - b.at);
    if (items.length === 1 && !items[0].markdown) items[0].anchorText = aroundText(`${rest.slice(0, items[0].at)} ${rest.slice(items[0].end)}`);
    for (const { anchorText, href } of items) found.push({ anchorText, href, line: index + 1 });
  });
  return found;
}

/* Excel workbooks ------------------------------------------------------------------------------ */
const utf8 = new TextDecoder('utf-8');
const NOT_XLSX = 'This file isn’t an Excel workbook (.xlsx). Save it as .xlsx or CSV, then import it.';
const DAMAGED = 'This workbook is damaged, so it can’t be read. Open it in a spreadsheet app, save a copy, then import that.';

function zipEntries(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length >= 4 && view.getUint32(0) === 0xd0cf11e0) throw new Error('This is an older .xls workbook or a password-protected one. Save it as .xlsx without a password, or as CSV, then import it.');
  if (data.length < 22 || view.getUint32(0, true) !== 0x04034b50) throw new Error(NOT_XLSX);
  let end = -1;
  for (let at = data.length - 22; at >= Math.max(0, data.length - 65557); at--) if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
  if (end < 0) throw new Error(DAMAGED);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  if (count === 0xffff || at === 0xffffffff) throw new Error('This workbook is stored in a large-file format Link Meteor can’t read. Save it as CSV, then import it.');
  const entries = new Map();
  for (let k = 0; k < count; k++) {
    if (at + 46 > data.length || view.getUint32(at, true) !== 0x02014b50) throw new Error(DAMAGED);
    const nameLength = view.getUint16(at + 28, true);
    const name = utf8.decode(data.subarray(at + 46, at + 46 + nameLength)).replace(/\\/g, '/');
    entries.set(name.toLowerCase(), { flags: view.getUint16(at + 8, true), method: view.getUint16(at + 10, true), compressed: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true), local: view.getUint32(at + 42, true) });
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return entries;
}

async function entryText(data, entry, inflateRaw) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (entry.flags & 1) throw new Error('This workbook is password-protected. Save a copy without a password, then import that.');
  if (entry.size > MAX_XLSX_PART) throw new Error('This workbook’s sheet is too large to import at once. Save it as CSV, or split it, then import it.');
  if (entry.local + 30 > data.length || view.getUint32(entry.local, true) !== 0x04034b50) throw new Error(DAMAGED);
  const start = entry.local + 30 + view.getUint16(entry.local + 26, true) + view.getUint16(entry.local + 28, true);
  const raw = data.subarray(start, start + entry.compressed);
  if (entry.method === 0) return utf8.decode(raw);
  if (entry.method !== 8) throw new Error('This workbook uses a compression method Link Meteor can’t read. Save it again as .xlsx or CSV, then import it.');
  if (typeof inflateRaw !== 'function') throw new Error('readXlsx needs inflateRaw to read compressed workbooks');
  const bytes = await inflateRaw(raw);
  return utf8.decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

const elements = (node, name) => node.getElementsByTagNameNS('*', name);
const child = (node, name) => { for (const item of node.children) if (item.localName === name) return item; return null; };
// An attribute by its local name, whatever prefix the writer gave it (r:id, ns1:id).
function attr(node, name) {
  if (node.hasAttribute?.(name)) return node.getAttribute(name);
  for (const item of node.attributes) if (item.localName === name) return item.value;
  return null;
}
// Excel writes characters XML can't hold as _xHHHH_ (and a literal "_x" as _x005F_x).
const unescapeCells = (text) => text.replace(/_x([0-9a-fA-F]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
// The text of a shared or inline string: its runs, without phonetic guides.
function richText(node) {
  let text = '';
  const walk = (parent) => { for (const item of parent.children) { if (item.localName === 't') text += item.textContent; else if (item.localName !== 'rPh' && item.localName !== 'phoneticPr') walk(item); } };
  walk(node);
  return unescapeCells(text);
}
function columnIndex(ref) {
  const letters = /^\$?([A-Za-z]{1,3})\$?\d*$/.exec(ref || '')?.[1];
  if (!letters) return -1;
  let index = 0;
  for (const char of letters.toUpperCase()) index = index * 26 + char.charCodeAt(0) - 64;
  return index - 1;
}
// A cell as text: strings as written, numbers and dates as the stored number, TRUE or FALSE, and a
// formula as its cached value, never calculated. A formula with no cached value is empty.
function cellText(cell, shared) {
  const type = cell.getAttribute('t') || 'n', value = child(cell, 'v')?.textContent ?? '';
  switch (type) {
    case 's': return shared[Number(value)] ?? '';
    case 'inlineStr': { const inline = child(cell, 'is'); return inline ? richText(inline) : unescapeCells(value); }
    case 'b': return value === '1' ? 'TRUE' : value === '0' ? 'FALSE' : value;
    case 'str': return unescapeCells(value);
    default: return value;
  }
}
function resolvePart(base, target) {
  const parts = (target.startsWith('/') ? target.slice(1) : base + target).split('/');
  const kept = [];
  for (const part of parts) { if (part === '..') kept.pop(); else if (part && part !== '.') kept.push(part); }
  return kept.join('/');
}

// The workbook's sheet names, and the chosen sheet (default: the first) as rows of text. Rows
// with no text are left out; `numbers` gives each kept row's number in the sheet. inflateRaw
// (bytes => Promise of bytes) unpacks compressed parts, and parseXml (text => an XML Document)
// reads them; the workbench passes DecompressionStream('deflate-raw') and DOMParser.
export async function readXlsx(bytes, { inflateRaw, parseXml, sheet = 0 } = {}) {
  if (typeof parseXml !== 'function') throw new Error('readXlsx needs parseXml');
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const entries = zipEntries(data);
  const xml = async (path) => {
    const entry = entries.get(path.toLowerCase());
    if (!entry) return null;
    const doc = parseXml(await entryText(data, entry, inflateRaw));
    if (!doc?.documentElement || elements(doc, 'parsererror').length) throw new Error(DAMAGED);
    return doc;
  };
  // Relationship targets by id, with their type, from a part's .rels file.
  const relations = async (path) => {
    const slash = path.lastIndexOf('/'), base = path.slice(0, slash + 1);
    const doc = await xml(`${base}_rels/${path.slice(slash + 1)}.rels`);
    const found = new Map();
    if (doc) for (const item of elements(doc, 'Relationship')) found.set(item.getAttribute('Id'), { type: item.getAttribute('Type') || '', target: resolvePart(base, item.getAttribute('Target') || '') });
    return found;
  };
  const byType = (map, type) => [...map.values()].find((item) => item.type.endsWith(`/${type}`))?.target;
  const workbookPath = byType(await relations(''), 'officeDocument') || 'xl/workbook.xml';
  const workbook = await xml(workbookPath);
  if (!workbook) throw new Error(NOT_XLSX);
  const links = await relations(workbookPath);
  const sheets = [...elements(workbook, 'sheet')].map((item, i) => ({ name: item.getAttribute('name') || `Sheet ${i + 1}`, path: links.get(attr(item, 'id'))?.target }));
  if (!sheets.length) throw new Error('This workbook has no sheets.');
  const index = Number.isInteger(sheet) && sheet >= 0 && sheet < sheets.length ? sheet : 0;
  const sharedDoc = await xml(byType(links, 'sharedStrings') || resolvePart(workbookPath.slice(0, workbookPath.lastIndexOf('/') + 1), 'sharedStrings.xml'));
  const shared = sharedDoc ? [...elements(sharedDoc, 'si')].map(richText) : [];
  const doc = sheets[index].path && await xml(sheets[index].path);
  if (!doc) throw new Error(`The sheet “${sheets[index].name}” can’t be read: it may be a chart sheet. Choose another sheet.`);
  const rows = [], numbers = [];
  let next = 1;
  for (const row of elements(doc, 'row')) {
    const r = Number(row.getAttribute('r'));
    const number = Number.isInteger(r) && r > 0 ? r : next;
    next = number + 1;
    const cells = [];
    let column = 0;
    for (const cell of row.children) {
      if (cell.localName !== 'c') continue;
      const at = columnIndex(cell.getAttribute('r'));
      column = at >= 0 ? at : column;
      if (column < 16384) cells[column] = cellText(cell, shared);
      column++;
    }
    const values = Array.from(cells, (value) => value ?? '');
    if (values.some((value) => value.trim())) { rows.push(values); numbers.push(number); }
  }
  return { sheets: sheets.map((item) => item.name), sheet: index, rows, numbers };
}

/* Link Meteor's JSON exports ------------------------------------------------------------------- */
const STATUS_LABELS = { reading: 'Reading', read: 'Read' };
// A JSON export (an array of rows, or {about, rows}) as a table with Link Meteor's own column names,
// so the columns map themselves. A backup is refused with where to restore it instead.
export function readExportJson(text) {
  let value;
  try { value = JSON.parse(String(text).replace(/^﻿/, '')); } catch { throw new Error('This file isn’t a Link Meteor export: it isn’t valid JSON.'); }
  if (value?.format === 'link-meteor-backup') throw new Error('This is a Link Meteor backup, not an export. Restore it with Restore from a backup… in Backup and restore.');
  const rows = Array.isArray(value) ? value : Array.isArray(value?.rows) ? value.rows : null;
  if (!rows || rows.some((row) => !row || typeof row !== 'object' || typeof row.url !== 'string')) throw new Error('This JSON file isn’t a Link Meteor export. Link Meteor imports the JSON files its Export panel makes.');
  const fields = (Array.isArray(value?.about?.fields) ? value.about.fields : []).filter((field) => typeof field?.id === 'string' && typeof field?.name === 'string');
  const str = (item) => (typeof item === 'string' ? item : '');
  return {
    names: ['Anchor text', 'URL', 'Notes', 'Tags', 'Reading status', 'Starred', ...fields.map((field) => field.name)],
    rows: rows.map((row) => [str(row.anchorText), row.url, str(row.notes), Array.isArray(row.tags) ? row.tags.filter((tag) => typeof tag === 'string').join(', ') : '',
      STATUS_LABELS[row.status] || '', row.starred === true ? 'Yes' : '', ...fields.map((field) => str(row.fields?.[field.id]))]),
  };
}

/* Columns and mapping -------------------------------------------------------------------------- */
// Header names, lowercased with punctuation as spaces, for each part of a link, most likely first.
const TARGET_NAMES = {
  url: ['url', 'address', 'link', 'links', 'href', 'uri', 'web address', 'website', 'web site', 'webpage', 'web page', 'link url', 'page url', 'homepage'],
  anchorText: ['anchor text', 'title', 'name', 'link text', 'text', 'label', 'anchor', 'page title', 'link title'],
  notes: ['notes', 'note', 'comments', 'comment', 'description', 'annotation', 'annotations', 'remarks', 'summary'],
  tags: ['tags', 'tag', 'keywords', 'keyword', 'labels', 'categories', 'category', 'topics'],
  status: ['reading status', 'status', 'read status', 'reading'],
  starred: ['starred', 'star', 'stars', 'favorite', 'favourite', 'favorites', 'favourites'],
};
export const TARGETS = Object.freeze(Object.keys(TARGET_NAMES));
// Link Meteor's own export columns that have no place on an imported link. They are offered as
// new columns, but not chosen.
const EXPORT_ONLY = new Set(['accessible label', 'original href', 'source page url', 'source page title', 'frame url', 'pdf page', 'captured at', 'capture batch id',
  'occurrence id', 'context', 'doi', 'arxiv id', 'pubmed id', 'isbn', 'imported from']);
const KNOWN_HEADERS = new Set([...Object.values(TARGET_NAMES).flat(), ...EXPORT_ONLY]);
const headerKey = (value) => String(value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// A cell that is plainly meant as an address (not whether it is a valid one).
export function isAddress(value) { return /^\s*<?(?:https?:\/\/|mailto:|tel:|www\.)\S/i.test(String(value ?? '')); }
const filled = (row) => row.some((cell) => String(cell ?? '').trim());

// "A", "B", … "Z", "AA": spreadsheet column letters.
export function columnLetter(index) {
  let name = '';
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name;
}

// Whether the first row with text names the columns: it holds no address and either a known column
// name, or text above a column whose later rows hold addresses.
export function detectHeader(rows) {
  const data = rows.filter(filled);
  if (data.length < 2) return false;
  const [first, ...rest] = data;
  if (first.some(isAddress)) return false;
  if (first.some((cell) => KNOWN_HEADERS.has(headerKey(cell)))) return true;
  const sample = rest.slice(0, 50);
  return first.some((cell, i) => String(cell ?? '').trim() && sample.some((row) => isAddress(row[i])));
}

// The table's column names: the first row with text when it names them (blank ones and repeats
// made distinct), otherwise the column letters.
export function columnNames(rows, header) {
  const width = rows.reduce((most, row) => Math.max(most, row.length), 0);
  const first = header ? rows.find(filled) || [] : [];
  const seen = new Map();
  return Array.from({ length: width }, (_, i) => {
    const base = String(first[i] ?? '').replace(/\s+/gu, ' ').trim() || `Column ${columnLetter(i)}`;
    const key = base.toLowerCase(), n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    return n > 1 ? `${base} (${n})` : base;
  });
}

// The data rows: every row with text, after the header row when there is one.
export function dataRows(rows, header) {
  let skip = header;
  return rows.filter((row) => { if (!filled(row)) return false; if (skip) { skip = false; return false; } return true; });
}

// How each column most likely maps: {url, anchorText, notes, tags, status, starred} (column
// indexes, -1 for none), fields [{id, column}] for the destination's own columns found by name,
// and fresh [{column, name, use}] proposing a new custom column for each column left over. A new
// column isn't chosen (use: false) when it is empty, one of Link Meteor's export-only columns, or
// listed in `skip`. `overflow` counts the columns left over that don't fit in the collection.
export function guessMapping(names, rows, { fields = [], skip = [] } = {}) {
  const sample = rows.slice(0, 200);
  const keys = names.map(headerKey);
  const addresses = names.map((_, i) => sample.filter((row) => isAddress(row[i])).length);
  const byName = (target, used) => {
    for (const name of TARGET_NAMES[target]) { const i = keys.findIndex((key, at) => key === name && !used.has(at)); if (i >= 0) return i; }
    return -1;
  };
  const mapping = { url: -1, anchorText: -1, notes: -1, tags: -1, status: -1, starred: -1 };
  const used = new Set();
  const mostAddresses = addresses.reduce((best, n, i) => (n > (addresses[best] ?? 0) ? i : best), -1);
  mapping.url = byName('url', used);
  if (mapping.url < 0 || (!addresses[mapping.url] && mostAddresses >= 0)) mapping.url = mostAddresses >= 0 ? mostAddresses : mapping.url;
  if (mapping.url < 0 && names.length) mapping.url = 0;
  used.add(mapping.url);
  for (const target of ['anchorText', 'notes', 'tags', 'status', 'starred']) { mapping[target] = byName(target, used); if (mapping[target] >= 0) used.add(mapping[target]); }
  // Without a named anchor text column, the first column of words beside the addresses.
  if (mapping.anchorText < 0) {
    mapping.anchorText = names.findIndex((_, i) => {
      if (used.has(i) || keys[i] && KNOWN_HEADERS.has(keys[i])) return false;
      const values = sample.map((row) => String(row[i] ?? '').trim()).filter(Boolean);
      return values.length && values.filter((value) => !isAddress(value)).length * 2 > values.length && /^column [a-z]+$/.test(keys[i]);
    });
    if (mapping.anchorText >= 0) used.add(mapping.anchorText);
  }
  const matched = [], taken = new Set(fields.map((field) => field.name.toLowerCase()));
  for (const field of fields) {
    const i = keys.findIndex((key, at) => !used.has(at) && key === headerKey(field.name));
    if (i >= 0) { matched.push({ id: field.id, column: i }); used.add(i); }
  }
  const room = Math.max(0, MAX_CUSTOM_FIELDS - fields.length);
  const fresh = [], skipped = new Set(skip);
  let overflow = 0;
  names.forEach((name, i) => {
    if (used.has(i)) return;
    if (fresh.length >= room) { overflow++; return; }
    let base = name.slice(0, MAX_FIELD_NAME).trim() || `Column ${columnLetter(i)}`, label = base;
    for (let n = 2; taken.has(label.toLowerCase()); n++) label = `${base.slice(0, MAX_FIELD_NAME - String(n).length - 3)} (${n})`;
    taken.add(label.toLowerCase());
    const empty = !sample.some((row) => String(row[i] ?? '').trim());
    fresh.push({ column: i, name: label, use: !empty && !EXPORT_ONLY.has(keys[i]) && !skipped.has(i) });
  });
  return { ...mapping, fields: matched, fresh, overflow };
}

// Reading status from a cell: read, reading, or '' (unread) for anything else.
export function readingStatus(value) {
  const key = headerKey(value);
  if (/^(read|done|finished|completed?)$/.test(key)) return 'read';
  if (/^(reading|in progress|started|currently reading)$/.test(key)) return 'reading';
  return '';
}
// Starred from a cell: yes, true, 1, x, a check mark or a star.
export function starredValue(value) { return /^\s*(yes|y|true|1|x|starred|star|✓|✔|★|⭐)\s*$/iu.test(String(value ?? '')); }

// A cell's address as stored: trimmed, without <angle brackets>, "www." given https://, and
// normalized by the URL parser. Returns {url} or {reason}.
export function importAddress(value) {
  let text = String(value ?? '').trim().replace(/^<([^<>]*)>$/, '$1').trim();
  if (!text) return { reason: 'no-address' };
  if (/^www\./i.test(text)) text = `https://${text}`;
  let url;
  try { url = new URL(text); } catch { return { reason: 'not-link' }; }
  const web = url.protocol === 'http:' || url.protocol === 'https:';
  if (!(web || url.protocol === 'mailto:' || url.protocol === 'tel:') || (web ? !url.hostname : !url.pathname) || /\s|[\u0000-\u001f\u007f]/u.test(url.href)) return { reason: 'not-link' };
  return { url: url.href };
}

function importedLabel(source, unit, number, path) {
  const where = path ? `${source} › ${path}` : unit ? `${source}, ${unit} ${number}` : source;
  return where.length <= MAX_IMPORTED ? where : `${where.slice(0, MAX_IMPORTED - 1)}…`;
}

/* Planning ------------------------------------------------------------------------------------- */
// What an import adds and skips, without changing anything. `rows` is the table as read (the header
// row too); `mapping` is {header, url, anchorText?, notes?, tags?, status?, starred?, path?, fields?}
// with column indexes (-1 or absent for none), where fields lists [{id, column}] for the
// destination's columns and [{key?, name, column}] for new ones. Options:
// - links: the destination's links, and skipSaved to skip addresses it already holds;
// - source (the file name, "Bookmarks"…), unit ('row', 'line' or 'link') and numbers (each row's
//   number in its file) for each link's `imported`; with mapping.path, "source › path" instead;
// - originals: the address as written for each row, when the table holds a resolved one;
// - batchId, importedAt and makeId for the links; preview: how many rows to describe.
// Returns {links, newFields: [{key, name}], skipped: [{row, reason, of?}], counts, cut, preview,
// previewSkipped}. Rows over the 20,000-link limit are one skipped entry {row, reason: 'limit', rows}.
export function planImport(rows, mapping, { links = [], skipSaved = false, source = '', unit = 'row', numbers, originals,
  batchId = 'import', importedAt = new Date().toISOString(), makeId, preview = 100 } = {}) {
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  if (!mapping || typeof mapping !== 'object') throw new Error('mapping must be an object');
  const column = (key) => (Number.isInteger(mapping[key]) && mapping[key] >= 0 ? mapping[key] : -1);
  if (column('url') < 0) throw new Error('Choose the column that holds the addresses.');
  const cell = (row, i) => (i >= 0 && i < row.length ? String(row[i] ?? '') : '');
  const fieldMap = (Array.isArray(mapping.fields) ? mapping.fields : []).filter((field) => Number.isInteger(field?.column) && field.column >= 0);
  const newFields = [];
  const fieldKeys = fieldMap.map((field) => {
    if (field.id) return field.id;
    const key = field.key || `new-${newFields.length + 1}`;
    newFields.push({ key, name: String(field.name ?? '') });
    return key;
  });
  const saved = skipSaved ? new Set(links.map((item) => item.url)) : null;
  const seen = new Map(), added = [], skipped = [], previewRows = [], previewSkipped = [];
  const counts = { rows: 0, links: 0, 'no-address': 0, 'not-link': 0, repeat: 0, saved: 0, limit: 0 };
  let header = mapping.header === true, cut = 0, limit = null;
  rows.forEach((row, index) => {
    if (!Array.isArray(row) || !filled(row)) return;
    if (header) { header = false; return; }
    counts.rows++;
    const number = numbers?.[index] ?? index + 1;
    if (limit) { limit.rows++; counts.limit++; return; }
    const raw = cell(row, column('url'));
    const values = { address: raw.trim(), anchorText: cell(row, column('anchorText')).replace(/\s+/gu, ' ').trim(), notes: cell(row, column('notes')).trim(),
      tags: cell(row, column('tags')).trim(), status: cell(row, column('status')).trim(), starred: cell(row, column('starred')).trim(), fields: {} };
    fieldMap.forEach((field, i) => { const text = cell(row, field.column).trim(); if (text) values.fields[fieldKeys[i]] = text; });
    const { url, reason: bad } = importAddress(raw);
    const key = `${url}\u0000${values.anchorText}`;
    let reason = bad, of;
    if (!reason && seen.has(key)) { reason = 'repeat'; of = seen.get(key); }
    if (!reason) seen.set(key, number);
    if (!reason && saved?.has(url)) reason = 'saved';
    if (!reason && added.length >= MAX_IMPORT_LINKS) { limit = { row: number, reason: 'limit', rows: 1 }; skipped.push(limit); counts.limit++; return; }
    if (reason) {
      counts[reason]++;
      const entry = of ? { row: number, reason, of } : { row: number, reason };
      skipped.push(entry);
      if (previewRows.length < preview) previewRows.push({ ...entry, values });
      if (previewSkipped.length < preview) previewSkipped.push({ ...entry, values });
      return;
    }
    const fields = {};
    for (const [fieldKey, text] of Object.entries(values.fields)) {
      if (text.length > MAX_FIELD_VALUE) { fields[fieldKey] = `${text.slice(0, MAX_FIELD_VALUE - 1)}…`; cut++; } else fields[fieldKey] = text;
    }
    const link = { id: makeId ? makeId() : `${batchId}-${added.length + 1}`, anchorText: values.anchorText, accessibleLabel: '', url,
      originalHref: typeof originals?.[index] === 'string' ? originals[index] : raw, sourceUrl: '', sourceTitle: '', frameUrl: '', capturedAt: importedAt, batchId,
      notes: values.notes, tags: [...new Set(values.tags.split(/[,;]/).map((tag) => tag.trim()).filter(Boolean))],
      imported: importedLabel(source, unit, number, cell(row, column('path')).trim()) };
    const status = readingStatus(values.status);
    if (status) link.status = status;
    if (starredValue(values.starred)) link.starred = true;
    if (Object.keys(fields).length) link.fields = fields;
    added.push(link);
    if (previewRows.length < preview) previewRows.push({ row: number, values });
  });
  counts.links = added.length;
  return { links: added, newFields, skipped, counts, cut, preview: previewRows, previewSkipped };
}
