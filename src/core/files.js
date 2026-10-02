// Links that point straight at a file, and how a downloaded file is named (0.4.0). Pure: no Chrome
// or DOM access. The capture card keeps its own copy of fileLink, because the page script can't
// import modules; tests/files.test.mjs checks that the copy decides exactly as this module does.
import { fileNamePart } from './export.js';

// File types by kind, as lowercase extensions. Web pages and programs are not file types here.
export const FILE_KINDS = Object.freeze({
  documents: ['pdf', 'ps', 'eps'],
  office: ['doc', 'docx', 'docm', 'dot', 'dotx', 'xls', 'xlsx', 'xlsm', 'xlt', 'xltx', 'ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'pot', 'potx', 'rtf'],
  openDocument: ['odt', 'ods', 'odp', 'odg', 'odf', 'ott', 'ots', 'otp'],
  textAndData: ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'bib', 'ris', 'enw', 'nbib', 'tex', 'ipynb'],
  ebooks: ['epub', 'mobi', 'azw', 'azw3', 'djvu', 'fb2'],
  archives: ['zip', 'gz', 'tgz', 'tar', 'bz2', 'xz', '7z', 'rar', 'zst'],
  images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'tif', 'tiff', 'bmp', 'avif', 'heic', 'heif', 'ico'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'opus'],
  video: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'ogv'],
});
export const FILE_TYPES = new Set(Object.values(FILE_KINDS).flat());

// Limits for one download action: at most 100 files, a confirmation above 10, 3 at a time.
export const DOWNLOAD_LIMIT = 100;
export const DOWNLOAD_CONFIRM_ABOVE = 10;
export const DOWNLOAD_PARALLEL = 3;

// Known PDF addresses without a .pdf path: arXiv, OpenReview, the ACM Digital Library and PubMed Central.
const KNOWN_PDFS = [
  { host: /(^|\.)arxiv\.org$/, path: /^\/pdf\/./ },
  { host: /(^|\.)openreview\.net$/, path: /^\/pdf$/, query: /(^|&)id=./ },
  { host: /^dl\.acm\.org$/, path: /^\/doi\/pdf\/./ },
  { host: /(^|\.)ncbi\.nlm\.nih\.gov$/, path: /^\/pmc\/articles\/PMC\d+\/pdf(\/|$)/i },
  { host: /^pmc\.ncbi\.nlm\.nih\.gov$/, path: /^\/articles\/PMC\d+\/pdf(\/|$)/i },
];
// Search results label PDF links in their anchor text, as Google Scholar's "[PDF] arxiv.org".
const PDF_LABEL = /^\s*\[PDF\]/i;
// Such labels come off the front of a file name.
const LABEL_PREFIX = /^\s*\[(PDF|HTML|DOC|DOCX|PS|BOOK|CITATION)\]\s*/i;
// Windows device names can't be file names, with or without an extension.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function webUrl(value) {
  try { const url = new URL(String(value ?? '')); return ['http:', 'https:'].includes(url.protocol) ? url : null; } catch { return null; }
}

// The extension of a web address's last path segment, lowercased, when it names a known file type.
export function urlFileType(value) {
  const url = webUrl(value);
  if (!url) return '';
  const name = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
  const ext = name.match(/\.([a-z0-9]{1,8})$/i)?.[1].toLowerCase() || '';
  return FILE_TYPES.has(ext) ? ext : '';
}

export function knownPdf(value) {
  const url = webUrl(value);
  return !!url && KNOWN_PDFS.some(({ host, path, query }) => host.test(url.hostname) && path.test(url.pathname) && (!query || query.test(url.search.slice(1))));
}

// A file link: a web link whose path ends in a file type, whose anchor text starts with [PDF], or
// that is a known PDF address.
export function isFileLink(link) {
  const url = link?.url;
  return !!webUrl(url) && (!!urlFileType(url) || PDF_LABEL.test(String(link.anchorText ?? '')) || knownPdf(url));
}

// The file links among these links, one per address, in order.
export function fileLinks(links) {
  const seen = new Set();
  return links.filter((link) => {
    if (!isFileLink(link)) return false;
    const url = webUrl(link.url).href;
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

// A PDF link (0.6.0): a file link whose address ends in .pdf or is a known PDF address, or one
// labeled [PDF] whose address names no other file type.
export function isPdfLink(link) {
  if (!isFileLink(link)) return false;
  const type = urlFileType(link.url);
  return type === 'pdf' || (!type && (knownPdf(link.url) || PDF_LABEL.test(String(link.anchorText ?? ''))));
}
// The PDF links among these links, one per address, in order.
export function pdfLinks(links) { return fileLinks(links).filter(isPdfLink); }
// A PDF's file name, as Download files names it: after its anchor text, ending .pdf.
export function pdfFileName(link) { return downloadName(link, { mime: 'application/pdf' }); }
// File names for one folder or one ZIP: a repeat gets " (2)", " (3)" before its extension. Names
// that differ only in case count as repeats, as they do on most computers.
export function uniqueNames(names) {
  const seen = new Set();
  return names.map((value) => {
    const name = String(value), dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
    let unique = name;
    for (let n = 2; seen.has(unique.toLowerCase()); n++) unique = `${stem} (${n})${ext}`;
    seen.add(unique.toLowerCase());
    return unique;
  });
}

// The extension for each type Chrome may report. Anything else falls back to Chrome's own name.
const MIME_EXTENSIONS = {
  'application/pdf': 'pdf', 'application/postscript': 'ps', 'application/rtf': 'rtf', 'text/rtf': 'rtf',
  'application/msword': 'doc', 'application/vnd.ms-excel': 'xls', 'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.text': 'odt', 'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp', 'application/epub+zip': 'epub',
  'text/plain': 'txt', 'text/markdown': 'md', 'text/csv': 'csv', 'text/tab-separated-values': 'tsv',
  'application/json': 'json', 'application/xml': 'xml', 'text/xml': 'xml', 'application/x-bibtex': 'bib',
  'application/zip': 'zip', 'application/gzip': 'gz', 'application/x-gzip': 'gz', 'application/x-tar': 'tar',
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
  'image/tiff': 'tif', 'image/bmp': 'bmp', 'image/avif': 'avif',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/flac': 'flac', 'audio/mp4': 'm4a',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/ogg': 'ogv',
  'text/html': 'html', 'application/xhtml+xml': 'html',
};
const mimeBase = (mime) => String(mime ?? '').split(';')[0].trim().toLowerCase();

// A web page rather than a file: what a sign-in or paywall page sends instead of the PDF.
export function isWebPage(mime) { return ['text/html', 'application/xhtml+xml'].includes(mimeBase(mime)); }

// The downloaded file's extension: "html" for a web page (so a sign-in page is never saved as a
// fake PDF), otherwise the address's file type, then the type Chrome reports, then the extension
// of the name Chrome suggests, then "pdf" for a known PDF address.
export function downloadExtension(url, { mime = '', suggested = '' } = {}) {
  if (isWebPage(mime)) return 'html';
  const fromName = String(suggested ?? '').match(/\.([a-z0-9]{1,8})$/i)?.[1].toLowerCase() || '';
  return urlFileType(url) || MIME_EXTENSIONS[mimeBase(mime)] || fromName || (knownPdf(url) ? 'pdf' : '');
}

function safePart(text, max) {
  const part = fileNamePart(text, max);
  const dot = part.indexOf('.');
  return WINDOWS_RESERVED.test(dot < 0 ? part : part.slice(0, dot)) ? (dot < 0 ? `${part}_` : `${part.slice(0, dot)}_${part.slice(dot)}`) : part;
}

// The folder inside the downloads folder: Link Meteor/<collection name>.
export function downloadFolder(collectionName) { return `Link Meteor/${safePart(collectionName, 80) || 'links'}`; }

// A file named after its anchor text (without a leading [PDF] label), else its accessible label,
// else the address's own file name, with the extension from downloadExtension.
export function downloadName(link, info = {}) {
  const ext = downloadExtension(link.url, info);
  const label = String(link.anchorText ?? '').replace(LABEL_PREFIX, '').trim() || String(link.accessibleLabel ?? '');
  let stem = fileNamePart(label, 100);
  if (ext && stem.toLowerCase().endsWith(`.${ext}`)) stem = stem.slice(0, -ext.length - 1).replace(/[.-]+$/, '');
  if (!stem) {
    const url = webUrl(link.url);
    const last = url ? decodeURIComponentSafe(url.pathname.slice(url.pathname.lastIndexOf('/') + 1)) : '';
    const own = last.match(/\.([a-z0-9]{1,8})$/i)?.[1].toLowerCase();
    stem = fileNamePart(own && (FILE_TYPES.has(own) || own === ext) ? last.slice(0, -own.length - 1) : last, 100);
  }
  stem = safePart(stem || 'file', 100);
  return ext ? `${stem}.${ext}` : stem;
}
function decodeURIComponentSafe(value) { try { return decodeURIComponent(value); } catch { return value; } }

// The path Chrome saves to, relative to the downloads folder.
export function downloadPath(link, collectionName, info = {}) { return `${downloadFolder(collectionName)}/${downloadName(link, info)}`; }

// How a folder reads in messages: "Link Meteor › Thesis-sources".
export function folderLabel(folder) { return String(folder).split('/').join(' › '); }

// The Download linked file menu item's targetUrlPatterns: every file type (lowercase and
// uppercase, with or without a query) and the known PDF addresses. [PDF] labels can't be matched
// by address, so the menu leaves them out.
export function menuPatterns() {
  const patterns = [];
  for (const type of FILE_TYPES) for (const ext of new Set([type, type.toUpperCase()])) patterns.push(`*://*/*.${ext}`, `*://*/*.${ext}?*`);
  patterns.push('*://*.arxiv.org/pdf/*', '*://*.openreview.net/pdf?*', '*://dl.acm.org/doi/pdf/*', '*://*.ncbi.nlm.nih.gov/pmc/articles/*/pdf*', '*://pmc.ncbi.nlm.nih.gov/articles/*/pdf*');
  return patterns;
}
