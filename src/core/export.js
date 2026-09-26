import { writeXlsx } from './xlsx.js';

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

export function makeExport(rows, { format, columns = ['anchorText', 'url'] } = {}) {
  if (!Array.isArray(rows)) throw new Error('rows must be an array');
  if (!FORMATS.has(format)) throw new Error(`Unsupported export format: ${format}`);
  if (!Array.isArray(columns) || columns.length === 0) throw new Error('Export columns must be a nonempty array');
  for (const key of columns) if (!LABELS.has(key)) throw new Error(`Unsupported export column: ${key}`);
  if (new Set(columns).size !== columns.length) throw new Error('Export columns must be unique');
  const headers = columns.map(key => LABELS.get(key));
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
