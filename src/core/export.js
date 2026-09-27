import { writeXlsx, hyperlinkTarget, MAX_HYPERLINKS } from './xlsx.js';

export const COLUMNS = [
  { key: 'anchorText', label: 'Anchor text' }, { key: 'url', label: 'URL' },
  { key: 'accessibleLabel', label: 'Accessible label' }, { key: 'originalHref', label: 'Original href' },
  { key: 'sourceUrl', label: 'Source page URL' }, { key: 'sourceTitle', label: 'Source page title' },
  { key: 'frameUrl', label: 'Frame URL' }, { key: 'capturedAt', label: 'Captured at' },
  { key: 'batchId', label: 'Capture batch ID' }, { key: 'id', label: 'Occurrence ID' },
  { key: 'notes', label: 'Notes' }, { key: 'tags', label: 'Tags' },
];

const LABELS = new Map(COLUMNS.map(column => [column.key, column.label]));
const FORMATS = new Set(['csv', 'tsv', 'text', 'markdown', 'html', 'json', 'xlsx']);
// The file extension each format downloads as.
export const FORMAT_EXTENSIONS = Object.freeze({ csv: 'csv', tsv: 'tsv', text: 'txt', markdown: 'md', html: 'html', json: 'json', xlsx: 'xlsx' });
// Columns whose web and mail addresses are clickable in a formatted workbook.
const URL_COLUMNS = new Set(['url', 'originalHref', 'sourceUrl', 'frameUrl']);

function cell(row, key) {
  const value = row[key];
  return key === 'tags' ? (Array.isArray(value) ? value.join(', ') : '') : String(value ?? '');
}

function safeSpreadsheet(value) {
  // The leading apostrophe is data in CSV/TSV and prevents formula interpretation on import.
  return /^[\s\uFEFF]*[=+@-]/u.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
}

function delimited(rows, headers, columns, separator) {
  const quote = value => {
    const safe = safeSpreadsheet(String(value));
    return safe.includes(separator) || /["\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [headers, ...rows.map(row => columns.map(key => cell(row, key)))]
    .map(values => values.map(quote).join(separator)).join('\r\n') + '\r\n';
}

function htmlEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function markdownLabel(value) {
  return String(value).replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]()#+.!|<>~=\-]/g, '\\$&');
}

function safeLinkUrl(value) {
  if (typeof value !== 'string' || !value || /\s|[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`Unsupported link URL: ${value}`);
  let url;
  try { url = new URL(value); } catch { throw new Error(`Unsupported link URL: ${value}`); }
  if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ||
      (url.protocol === 'tel:' && !url.pathname)) throw new Error(`Unsupported link URL: ${value}`);
  return value;
}

function markdownUrl(value) {
  // Encode Markdown delimiters only in Markdown; plain-text URLs remain byte-for-byte faithful.
  return safeLinkUrl(value).replace(/[<>()[\]\\]/g, char => `%${char.codePointAt(0).toString(16).toUpperCase()}`);
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// One file-name part: accents folded to plain letters, any other run of characters outside
// letters, digits, dot, underscore and hyphen becomes one hyphen, with no leading or trailing
// dot or hyphen (hidden files and Windows trailing dots).
export function fileNamePart(value, max = 80) {
  return String(value ?? '').normalize('NFKD').replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[.-]+/, '').slice(0, max).replace(/[.-]+$/, '');
}

function pad(n) { return String(n).padStart(2, '0'); }

// Default export name: <prefix_><collection>_<YYYY-MM-DD>_<HHmm>.<extension>, in local time and
// without colons. A nonempty override (the Export panel's File name field) replaces the pattern.
export function exportFileName({ collection = '', extension, settings = {}, date = new Date(), override = '' } = {}) {
  if (typeof extension !== 'string' || !/^[a-z0-9]{1,5}$/.test(extension)) throw new Error(`Unsupported file extension: ${extension}`);
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) throw new Error('Export time must be a valid date');
  const { exportPrefix = '', exportTimestamp = true, exportTimestampFormat = 'datetime' } = settings;
  const typed = String(override ?? '').trim().replace(new RegExp(`\\.${extension}$`, 'i'), '');
  let stem = fileNamePart(typed, 150);
  if (!stem) {
    const parts = [fileNamePart(exportPrefix, 40), fileNamePart(collection) || 'links'];
    if (exportTimestamp) {
      parts.push(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`);
      if (exportTimestampFormat !== 'date') parts.push(`${pad(date.getHours())}${pad(date.getMinutes())}`);
    }
    stem = parts.filter(Boolean).join('_');
  }
  if (WINDOWS_RESERVED.test(stem)) stem += '_';
  return `${stem}.${extension}`;
}

function offset(date) {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes < 0 ? '-' : '+';
  return `${sign}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;
}

function localDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// Checks an about block and fills the optional fields: count defaults to the row count,
// columns to the export columns, view and version to '' and filters to none.
function aboutBlock(about, rows, columns) {
  if (!about || typeof about !== 'object' || Array.isArray(about)) throw new Error('Export about must be an object');
  const { exportedAt, collection, count = rows.length, view = '', filters = [], version = '' } = about;
  if (!(exportedAt instanceof Date) || Number.isNaN(exportedAt.valueOf())) throw new Error('Export about.exportedAt must be a valid date');
  if (typeof collection !== 'string') throw new Error('Export about.collection must be a string');
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Export about.count must be a whole number');
  if (typeof view !== 'string') throw new Error('Export about.view must be a string');
  if (!Array.isArray(filters) || filters.some(item => typeof item !== 'string')) throw new Error('Export about.filters must be a list of strings');
  if (typeof version !== 'string') throw new Error('Export about.version must be a string');
  const aboutColumns = about.columns ?? columns;
  if (!Array.isArray(aboutColumns) || aboutColumns.some(key => !LABELS.has(key))) throw new Error('Export about.columns must list export columns');
  return { exportedAt, collection, count, view, filters: [...filters], columns: [...aboutColumns], version };
}

// JSON metadata block. Columns are left out: JSON keeps every field of every row.
function aboutJson(about) {
  return {
    exportedAt: about.exportedAt.toISOString(),
    exportedAtLocal: `${localDateTime(about.exportedAt)}.${String(about.exportedAt.getMilliseconds()).padStart(3, '0')}${offset(about.exportedAt)}`,
    collection: about.collection, count: about.count, view: about.view, filters: about.filters, version: about.version,
  };
}

// The About sheet: [label, value] rows, all text.
function aboutRows(about, note) {
  const date = about.exportedAt;
  const rows = [
    ['Exported (local time)', `${localDateTime(date).replace('T', ' ')} (UTC${offset(date)})`],
    ['Exported (UTC)', `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`],
    ['Collection', about.collection],
    ['Links', String(about.count)],
    ['View', about.view],
    ...(about.filters.length ? about.filters.map(filter => ['Filter', filter]) : [['Filters', 'None']]),
    ['Columns', about.columns.map(key => LABELS.get(key)).join(', ')],
    ['Cells', 'Every cell is text. Nothing is a formula, number or date.'],
    ['Link Meteor version', about.version],
  ];
  if (note) rows.splice(rows.length - 1, 0, ['Clickable links', note]);
  return rows;
}

function formattedXlsx(rows, columns, headers, about) {
  const values = rows.map(row => columns.map(key => cell(row, key)));
  const linkColumns = columns.flatMap((key, index) => URL_COLUMNS.has(key) ? [index] : []);
  let linkable = 0;
  for (const row of values) for (const index of linkColumns) if (hyperlinkTarget(row[index])) linkable++;
  const note = linkable > MAX_HYPERLINKS ? `The first ${MAX_HYPERLINKS.toLocaleString('en-US')} web and mail addresses are clickable; Excel allows no more on one sheet. The rest are exact text.` : '';
  return writeXlsx(headers, values, { linkColumns, about: aboutRows(about, note) });
}

// Without about, every format is exactly what 0.2.2 produced. With about ({exportedAt: Date,
// collection, count, view, filters, columns, version}), XLSX is formatted and gains an About
// sheet, and JSON becomes {about, rows}; the other formats are unchanged.
export function makeExport(rows, { format, columns = ['anchorText', 'url'], about } = {}) {
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  if (!FORMATS.has(format)) throw new Error(`Unsupported export format: ${format}`);
  if (!Array.isArray(columns) || columns.length === 0) throw new Error('Export columns must be a nonempty array');
  for (const key of columns) if (!LABELS.has(key)) throw new Error(`Unsupported export column: ${key}`);
  if (new Set(columns).size !== columns.length) throw new Error('Export columns must be unique');
  const headers = columns.map(key => LABELS.get(key));
  if (about !== undefined) {
    const block = aboutBlock(about, rows, columns);
    if (format === 'json') return { data: JSON.stringify({ about: aboutJson(block), rows }, null, 2), mime: 'application/json;charset=utf-8', extension: 'json' };
    if (format === 'xlsx') return { data: formattedXlsx(rows, columns, headers, block), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' };
  }
  switch (format) {
    case 'csv': return { data: delimited(rows, headers, columns, ','), mime: 'text/csv;charset=utf-8', extension: 'csv' };
    case 'tsv': return { data: delimited(rows, headers, columns, '\t'), mime: 'text/tab-separated-values;charset=utf-8', extension: 'tsv' };
    case 'text': return { data: rows.map(row => safeLinkUrl(row.url)).join('\n'), mime: 'text/plain;charset=utf-8', extension: 'txt' };
    case 'markdown': return { data: rows.map(row => `[${markdownLabel(row.anchorText ?? '')}](${markdownUrl(row.url)})`).join('\n'), mime: 'text/markdown;charset=utf-8', extension: 'md' };
    case 'html': {
      const head = headers.map(header => `<th scope="col">${htmlEscape(header)}</th>`).join('');
      const body = rows.map(row => `<tr>${columns.map(key => `<td>${htmlEscape(cell(row, key))}</td>`).join('')}</tr>`).join('');
      return { data: `<!doctype html><html lang="en"><meta charset="utf-8"><title>Link Meteor export</title><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></html>`, mime: 'text/html;charset=utf-8', extension: 'html' };
    }
    case 'json': return { data: JSON.stringify(rows, null, 2), mime: 'application/json;charset=utf-8', extension: 'json' };
    case 'xlsx': return { data: writeXlsx(headers, rows.map(row => columns.map(key => cell(row, key)))), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' };
  }
}
