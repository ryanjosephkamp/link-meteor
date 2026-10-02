// PDFs (0.6.0): what Link Meteor reads from a PDF, from plain data. Pure: no Chrome, no DOM, and
// no import of the PDF reader. The workbench opens a PDF with the bundled PDF.js and hands this
// module its pages (pdfPages takes any object shaped like a PDF.js document), so everything here
// is tested in Node with and without real PDFs. The contract is in docs/CONTRACTS.md
// ("What is read from a PDF").
import { MAX_AUTHORS, MAX_CONTEXT, MAX_PDF_PAGES } from './model.js';
import { MAX_IMPORT_LINKS, importAddress } from './imports.js';
import { doiIn } from './identifiers.js';

export { MAX_PDF_PAGES };
// One PDF, and the PDFs of one ZIP or one combined PDF.
export const MAX_PDF_BYTES = 50 * 1024 * 1024, MAX_PDF_SET = 20, MAX_PDF_SET_BYTES = 200 * 1024 * 1024;

// A PDF starts with %PDF- within its first 1,024 bytes.
export function isPdf(bytes) {
  const head = bytes.subarray(0, 1024);
  for (let i = 0; i + 4 < head.length; i++) if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46 && head[i + 4] === 0x2d) return true;
  return false;
}

// Why a PDF couldn't be read, in plain words: the reader's refusals by name, Link Meteor's own as written.
export function pdfProblem(error) {
  if (error?.name === 'PasswordException') return 'This PDF needs a password. Link Meteor doesn’t ask for passwords.';
  if (['InvalidPDFException', 'FormatError', 'UnknownErrorException', 'ResponseException'].includes(error?.name)) return 'This PDF is damaged, or it isn’t a PDF, so it couldn’t be read.';
  return String(error?.message || error || 'This PDF couldn’t be read.');
}

// Why a set of PDFs can't be zipped or combined, in plain words, or ''. sizes: each file's bytes.
export function pdfSetProblem(sizes) {
  if (sizes.length > MAX_PDF_SET) return `Choose up to ${MAX_PDF_SET} PDFs at a time.`;
  if (sizes.some((size) => size > MAX_PDF_BYTES)) return `A PDF can be at most ${MAX_PDF_BYTES / 1024 / 1024} MB.`;
  if (sizes.reduce((sum, size) => sum + size, 0) > MAX_PDF_SET_BYTES) return `These PDFs are more than ${MAX_PDF_SET_BYTES / 1024 / 1024} MB together. Choose fewer.`;
  return '';
}

/* Reading pages ---------------------------------------------------------------------------------
   pdfPages(doc) walks a PDF.js document and returns plain data:
   [{number, width, height, annotations: [{rect, url, unsafeUrl, internal}], items: [{str, x, y, w, h, rotated}]}]
   Only link annotations are kept. rect is [x1, y1, x2, y2] with y growing upward, as PDFs count. */
export async function pdfPages(doc, { onProgress, signal } = {}) {
  if (doc.numPages > MAX_PDF_PAGES) throw new Error(`This PDF has ${doc.numPages.toLocaleString('en-US')} pages. Link Meteor reads PDFs of up to ${MAX_PDF_PAGES.toLocaleString('en-US')} pages.`);
  const pages = [];
  for (let number = 1; number <= doc.numPages; number++) {
    if (signal?.aborted) throw new Error('Reading the PDF was canceled.');
    const page = await doc.getPage(number);
    const view = page.view || [0, 0, 0, 0];
    const annotations = (await page.getAnnotations()).filter((item) => item.subtype === 'Link' && Array.isArray(item.rect)).map((item) => ({
      rect: [Math.min(item.rect[0], item.rect[2]), Math.min(item.rect[1], item.rect[3]), Math.max(item.rect[0], item.rect[2]), Math.max(item.rect[1], item.rect[3])],
      url: typeof item.url === 'string' ? item.url : '', unsafeUrl: typeof item.unsafeUrl === 'string' ? item.unsafeUrl : '', internal: !item.url && !item.unsafeUrl && !!item.dest,
    }));
    // The reader marks gaps with items that hold only spaces; the gaps themselves say the same.
    const items = (await page.getTextContent()).items.filter((item) => typeof item.str === 'string' && item.str.trim() && Array.isArray(item.transform)).map((item) => {
      const [a, b, c, d, x, y] = item.transform;
      return { str: item.str, x, y, w: item.width || 0, h: item.height || Math.hypot(c, d) || 0, rotated: Math.abs(b) > Math.abs(a) };
    });
    pages.push({ number, width: view[2] - view[0], height: view[3] - view[1], annotations, items });
    page.cleanup?.();
    onProgress?.(number, doc.numPages);
  }
  return pages;
}

/* Text ------------------------------------------------------------------------------------------ */
// Letters and digits only, lowercased: for comparing printed text.
const letters = (text) => String(text || '').normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();
// Pieces of text on one line, left to right, joined with a space only where there is a gap, so an
// address typeset letter by letter reads as one word.
function joinLine(pieces) {
  let out = '', end = 0;
  for (const piece of [...pieces].sort((a, b) => a.x - b.x)) {
    if (out && !/\s$/u.test(out) && !/^\s/u.test(piece.str) && piece.x - end > 0.15 * (piece.h || 1)) out += ' ';
    out += piece.str; end = piece.x + piece.w;
  }
  return out.replace(/\s+/gu, ' ').trim();
}
// Pieces grouped into lines, top to bottom: the same line when their baselines are within half a line.
function lines(pieces) {
  const out = [];
  for (const piece of [...pieces].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = out.find((item) => Math.abs(item.y - piece.y) < 0.5 * Math.max(item.h, piece.h, 1));
    if (line) line.pieces.push(piece); else out.push({ y: piece.y, h: piece.h, pieces: [piece] });
  }
  return out;
}
const joined = (pieces) => lines(pieces).map((line) => joinLine(line.pieces)).filter(Boolean).join(' ');
const upright = (items) => items.filter((item) => !item.rotated);
const overlapsLine = (item, y1, y2) => { const h = item.h || 1; return Math.min(item.y + h, y2) - Math.max(item.y, y1) >= h * 0.5; };

// The words under a rectangle: the characters whose centers fall inside it, for items at least
// half inside it vertically. Rotated text is not link text. A word with fewer than half of its
// characters inside belongs to a neighbor, and is left out whole.
function wordsUnder(items, [x1, y1, x2, y2]) {
  const pieces = [];
  for (const item of upright(items)) {
    if (!item.w || !overlapsLine(item, y1, y2)) continue;
    const width = item.w / item.str.length;
    for (const word of item.str.matchAll(/\S+/gu)) {
      const inside = [];
      for (let at = word.index; at < word.index + word[0].length; at++) { const center = item.x + (at + 0.5) * width; if (center >= x1 && center <= x2) inside.push(at); }
      if (!inside.length || inside.length * 2 < word[0].length) continue;
      const str = item.str.slice(inside[0], inside.at(-1) + 1);
      pieces.push({ str, x: item.x + inside[0] * width, y: item.y, w: str.length * width, h: item.h });
    }
  }
  return pieces;
}

// When the words, without their spaces, are the address or its end, they are a printed address:
// the address as printed, in one piece. Otherwise null.
function printedAddress(text, url) {
  const squashed = text.replace(/\s+/gu, '');
  if (squashed.length < 6 || !/^https?:/iu.test(url)) return null;
  const forms = new Set();
  for (const form of [url, (() => { try { return decodeURI(url); } catch { return url; } })()]) for (const value of [form, form.replace(/\/$/u, '')]) {
    forms.add(value); forms.add(value.replace(/^[a-z][a-z0-9+.-]*:(\/\/)?/iu, '')); forms.add(value.replace(/^[a-z][a-z0-9+.-]*:(\/\/)?(www\.)?/iu, ''));
  }
  const lower = squashed.toLowerCase();
  return [...forms].some((form) => { const value = form.toLowerCase(); return value === lower || value.endsWith(lower) || value === lower.replace(/\/$/u, ''); }) ? squashed : null;
}

// The words on the line or lines a link sits on, in its own column: its neighbors left and right
// until a gap wider than a column gutter. Cut around the link's words to MAX_CONTEXT characters.
export function pdfContext(items, rects, anchorText = '') {
  const kept = [];
  for (const rect of rects) {
    const [x1, y1, x2, y2] = rect;
    for (const line of lines(upright(items).filter((item) => item.w && overlapsLine(item, y1, y2)))) {
      const row = [...line.pieces].sort((a, b) => a.x - b.x);
      let from = row.findIndex((item) => item.x + item.w > x1 && item.x < x2);
      if (from < 0) continue;
      let to = from;
      while (to + 1 < row.length && row[to + 1].x < x2) to++;
      const gutter = (item) => 1.5 * (item.h || 1);
      while (from > 0 && row[from].x - (row[from - 1].x + row[from - 1].w) < gutter(row[from])) from--;
      while (to + 1 < row.length && row[to + 1].x - (row[to].x + row[to].w) < gutter(row[to])) to++;
      for (const item of row.slice(from, to + 1)) if (!kept.includes(item)) kept.push(item);
    }
  }
  const text = joined(kept);
  // Like a web page's context: empty when the line holds little besides the link's own words.
  if (letters(text).length - letters(anchorText).length < 8) return '';
  return cut(text, anchorText);
}
function cut(text, anchorText) {
  if (text.length <= MAX_CONTEXT) return text;
  const at = anchorText ? Math.max(0, text.indexOf(anchorText)) : 0;
  let start = Math.max(0, Math.min(at - Math.floor((MAX_CONTEXT - anchorText.length) / 2), text.length - MAX_CONTEXT));
  let end = Math.min(text.length, start + MAX_CONTEXT);
  if (start > 0) { const space = text.indexOf(' ', start); start = space >= 0 && space < at ? space + 1 : start; }
  if (end < text.length) { const space = text.lastIndexOf(' ', end - 1); end = space > start ? space : end - 1; }
  const out = `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
  return out.length <= MAX_CONTEXT ? out : out.slice(0, MAX_CONTEXT - 1) + '…';
}

/* Links ----------------------------------------------------------------------------------------- */
// The second piece of a link that wrapped onto the next line: the same address, starting on a
// lower line close by, left of where the first piece ended.
function wrapsOnto(first, second) {
  const [ax1, ay1, ax2, ay2] = first, [bx1, , , by2] = second, line = Math.max(ay2 - ay1, 1);
  return by2 <= ay1 + 0.3 * line && ay1 - by2 < 2.5 * line && bx1 < ax2 && bx1 <= ax1 + 0.5 * line;
}

// pdfLinks(pages, {saveContext}) returns {links, internal, skipped, capped}:
// - links: [{url, originalHref, anchorText, pdfPage, context?}], in reading order as the PDF lists them;
// - internal: how many links go to places inside the PDF (they have no address);
// - skipped: [{page, reason: 'not-link'}] for links that aren't web, email or phone addresses;
// - capped: how many links past MAX_IMPORT_LINKS were left out.
export function pdfLinks(pages, { saveContext = true } = {}) {
  const found = [], skipped = [];
  let internal = 0, previous = null; // previous: the link made by the annotation just before this one
  for (const page of pages) {
    for (const annotation of page.annotations) {
      if (annotation.internal) { internal++; previous = null; continue; }
      const address = importAddress(annotation.url || annotation.unsafeUrl);
      if (!address.url) { skipped.push({ page: page.number, reason: 'not-link' }); previous = null; continue; }
      const text = joined(wordsUnder(page.items, annotation.rect));
      if (previous && previous.url === address.url && previous.parts.length < 8) {
        const last = previous.parts.at(-1), together = [previous.text, text].filter(Boolean).join(' ');
        // On one page, a piece on the next line; across a page break, only a printed address in two pieces.
        if (last.page === page ? wrapsOnto(last.rect, annotation.rect) : page.number === last.page.number + 1 && !!printedAddress(together, address.url)) {
          previous.text = together; previous.parts.push({ page, rect: annotation.rect });
          continue;
        }
      }
      previous = { url: address.url, originalHref: annotation.unsafeUrl || annotation.url, text, parts: [{ page, rect: annotation.rect }] };
      found.push(previous);
    }
  }
  const capped = Math.max(0, found.length - MAX_IMPORT_LINKS);
  const links = found.slice(0, MAX_IMPORT_LINKS).map((entry) => {
    const anchorText = printedAddress(entry.text, entry.url) || entry.text;
    const link = { url: entry.url, originalHref: entry.originalHref, anchorText, pdfPage: entry.parts[0].page.number };
    if (saveContext) {
      const byPage = [...new Set(entry.parts.map((part) => part.page))];
      const context = byPage.map((page) => pdfContext(page.items, entry.parts.filter((part) => part.page === page).map((part) => part.rect), entry.text)).filter(Boolean).join(' ');
      // A printed address reads in one piece in its context too.
      const whole = anchorText !== entry.text && context.includes(entry.text) ? context.replace(entry.text, anchorText) : context;
      if (whole) link.context = whole.length <= MAX_CONTEXT ? whole : cut(whole, anchorText);
    }
    return link;
  });
  return { links, internal, skipped, capped };
}

/* What the PDF says about itself ------------------------------------------------------------------ */
const STAMP = /arXiv:\s*(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?\s*\[([\w.-]+)\]\s*(\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4})/u;
const DOIS = /10\.\d{4,9}\/[-._;()/:a-z0-9]+/giu;
const FILE_NAME = /\.(indd|docx?|tex|dvi|pdf|qxd|ps|rtf|pages|fm|wpd|odt)$|^(untitled|microsoft word\b|document\d*$)/iu;
const text = (value) => (Array.isArray(value) ? value.join('; ') : typeof value === 'string' ? value : '').replace(/\s+/gu, ' ').trim();

// The first page's text: its upright lines top to bottom, then its rotated text (arXiv's stamp).
function pageText(page) {
  const rotated = page.items.filter((item) => item.rotated).sort((a, b) => a.x - b.x || a.y - b.y).map((item) => item.str).join('');
  return { upright: joined(upright(page.items).filter((item) => item.w)), rotated };
}
// The largest text in the upper part of the first page, when it reads like a title: clearly larger
// than the page's body text (the size most of its characters have), and at most four lines.
function largestText(page) {
  const all = upright(page.items).filter((item) => item.w && item.h);
  const sizes = new Map();
  for (const item of all) { const size = Math.round(item.h * 2) / 2; sizes.set(size, (sizes.get(size) || 0) + item.str.length); }
  const body = [...sizes].sort((x, y) => y[1] - x[1])[0]?.[0] || 0;
  const candidates = all.filter((item) => item.y > page.height * 0.4 && /\p{L}{2}/u.test(item.str));
  const size = Math.max(0, ...candidates.map((item) => item.h));
  if (size < body * 1.15) return '';
  const largest = candidates.filter((item) => item.h >= size * 0.95);
  const title = joined(largest);
  return lines(largest).length <= 4 && title.length >= 4 && title.length <= 300 ? title : '';
}
// Names from the PDF's metadata, kept only when every one of them is also printed on the first page.
function printedAuthors(value, printed) {
  const raw = text(value);
  if (!raw) return [];
  const names = (/;/u.test(raw) ? raw.split(';') : raw.split(/\s+and\s+|\s*&\s*|,\s*(?=\p{Lu})/u)).map((name) => name.replace(/\s+/gu, ' ').trim()).filter(Boolean);
  if (!names.length || names.length > MAX_AUTHORS) return [];
  return names.every((name) => { const parts = name.split(/[\s,]+/u).map(letters).filter((part) => part.length > 1); return parts.length >= 2 && parts.every((part) => printed.includes(part)); }) ? names : [];
}

// pdfCitation({info, xmp, firstPage, links, address}) returns what the PDF says about itself as a
// page citation with source 'pdf', or null when it says nothing usable. `firstPage` is page 1 from
// pdfPages; `links` are pdfLinks' links; `address` is the PDF's own address when it has one.
export function pdfCitation({ info = {}, xmp = {}, firstPage = null, links = [], address = '' } = {}) {
  const citation = {};
  const meta = (key) => text(xmp[key] ?? xmp[key.toLowerCase()]);
  const page = firstPage ? pageText(firstPage) : { upright: '', rotated: '' };
  const printed = letters(page.upright);
  const stamp = STAMP.exec(page.rotated) || STAMP.exec(page.upright);
  if (stamp) { citation.arxiv = stamp[1]; if (stamp[2]) citation.arxivVersion = stamp[2]; citation.arxivCategory = stamp[3]; citation.date = stamp[4].replace(/\s+/gu, ' '); }
  // A DOI: the metadata's, else the first page's when it names exactly one.
  const fromMeta = [meta('prism:doi'), meta('pdfx:doi'), meta('crossmark:doi'), meta('dc:identifier'), text(info.doi), text(info.DOI)].map(doiIn).find(Boolean);
  if (fromMeta) citation.doi = fromMeta;
  else {
    const onPage = new Set([...(page.upright.match(DOIS) || []), ...links.filter((link) => link.pdfPage === 1).map((link) => link.url)].map(doiIn).filter(Boolean).map((doi) => doi.toLowerCase()));
    // arXiv's own DOI names the same paper as the stamp, not a second one.
    const others = [...onPage].filter((doi) => !(citation.arxiv && doi === `10.48550/arxiv.${citation.arxiv.toLowerCase()}`));
    if (others.length === 1) citation.doi = doiIn([...(page.upright.match(DOIS) || []), ...links.map((link) => link.url)].find((value) => doiIn(value).toLowerCase() === others[0]));
  }
  // A title: the metadata's when it is printed on the first page and isn't a file name; else the largest text.
  const named = [text(info.Title), meta('dc:title')].find((title) => title.length >= 4 && title.length <= 300 && !FILE_NAME.test(title) && letters(title).length >= 4 && printed.includes(letters(title)));
  const title = named || (firstPage ? largestText(firstPage) : '');
  if (title) citation.title = title;
  const authors = [info.Author, xmp['dc:creator']].map((value) => printedAuthors(value, printed)).find((names) => names.length);
  if (authors) citation.authors = authors;
  const journal = meta('prism:publicationname'); if (journal && journal.length <= 300) citation.journal = journal;
  const published = meta('prism:publicationdate') || meta('prism:coverdate'); if (!citation.date && published && published.length <= 40) citation.date = published;
  if (!citation.title && !citation.arxiv && !citation.doi) return null;
  try { const parsed = new URL(address); if (['http:', 'https:'].includes(parsed.protocol)) { parsed.hash = ''; citation.pdfUrl = parsed.href; } } catch { /* a file has no address */ }
  return { ...citation, source: 'pdf' };
}
// Where each part of a PDF's citation was read, for the preview: {arxiv?, doi?, title?, authors?}.
export function pdfCitationNotes(citation, { info = {}, xmp = {} } = {}) {
  if (!citation) return {};
  const notes = {};
  if (citation.arxiv) notes.arxiv = 'from the stamp on page 1';
  const metaDoi = [xmp['prism:doi'], xmp['pdfx:doi'], xmp['crossmark:doi'], xmp['dc:identifier'], info.doi, info.DOI].map((value) => doiIn(text(value))).find(Boolean);
  if (citation.doi) notes.doi = metaDoi ? 'from the PDF’s own details' : 'from page 1';
  if (citation.title) notes.title = [text(info.Title), text(xmp['dc:title'])].includes(citation.title) ? 'from the PDF’s own details' : 'from the first page’s largest text';
  notes.authors = citation.authors ? 'from the PDF’s own details, and printed on page 1' : 'PDFs rarely name them reliably.';
  return notes;
}

// Everything Link Meteor reads from one open PDF (a PDF.js document, or anything shaped like one):
// {pageCount, links, internal, skipped, capped, linkPages, citation, notes}. `address` is the PDF's
// own address when it was read from a tab.
export async function readPdfDocument(doc, { address = '', saveContext = true, onProgress, signal } = {}) {
  const pages = await pdfPages(doc, { onProgress, signal });
  const { links, internal, skipped, capped } = pdfLinks(pages, { saveContext });
  let info = {}, xmp = {};
  try {
    const meta = await doc.getMetadata();
    info = meta?.info && typeof meta.info === 'object' ? meta.info : {};
    if (meta?.metadata) for (const [key, value] of meta.metadata) xmp[String(key).toLowerCase()] = value;
  } catch { /* a PDF without readable details still has its pages */ }
  const citation = pdfCitation({ info, xmp, firstPage: pages[0] || null, links, address });
  return { pageCount: doc.numPages, links, internal, skipped, capped, linkPages: new Set(links.map((link) => link.pdfPage)).size, citation, notes: pdfCitationNotes(citation, { info, xmp }) };
}

// One PDF from several, in the order given. `withDocument(bytes, fn)` opens a PDF with PDF.js, runs
// fn on the document and closes it. Every part is opened first, so one that needs a password or is
// damaged is refused by name before anything is written; and the result is opened again, because
// the writer returns an empty file instead of failing. Returns {bytes, pages, counts}.
export async function combinePdfs(list, withDocument) {
  if (!list.length) throw new Error('Choose at least one PDF to combine.');
  const problem = pdfSetProblem(list.map((bytes) => bytes.length));
  if (problem) throw new Error(problem);
  const counts = [];
  for (const [index, bytes] of list.entries()) {
    try { counts.push(await withDocument(bytes, (doc) => doc.numPages)); }
    catch (error) { throw Object.assign(new Error(error?.message || String(error)), { name: error?.name || 'Error', part: index }); }
  }
  const pages = counts.reduce((sum, count) => sum + count, 0);
  const bytes = list.length === 1 ? list[0] : await withDocument(list[0], (doc) => doc.extractPages([{ document: null }, ...list.slice(1).map((part) => ({ document: part.slice() }))]));
  const written = bytes?.length ? await withDocument(bytes, (doc) => doc.numPages).catch(() => 0) : 0;
  if (written !== pages) throw new Error(`The combined PDF came out with ${written} of ${pages} pages, so it was not saved.`);
  return { bytes, pages, counts };
}
