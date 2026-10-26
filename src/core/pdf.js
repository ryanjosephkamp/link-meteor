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
   [{number, width, height, annotations: [{rect, quads?, url, unsafeUrl, internal}], items: [{str, x, y, w, h, rotated, turn, mono}]}]
   Only link annotations are kept. rect is [x1, y1, x2, y2] with y growing upward, as PDFs count;
   quads are the rectangles of each line a link covers, when the PDF gives them. An item's `turn`
   is how far its text is turned (0, 90, 180 or 270 degrees, counterclockwise; `rotated` when it
   isn't upright), and `mono` marks a typewriter face, whose characters are all one width. */
const CANCELED = 'Reading the PDF was canceled.';
const bounds = (points, at) => [Math.min(points[at], points[at + 2], points[at + 4], points[at + 6]), Math.min(points[at + 1], points[at + 3], points[at + 5], points[at + 7]),
  Math.max(points[at], points[at + 2], points[at + 4], points[at + 6]), Math.max(points[at + 1], points[at + 3], points[at + 5], points[at + 7])];
export async function pdfPages(doc, { onProgress, signal } = {}) {
  if (doc.numPages > MAX_PDF_PAGES) throw new Error(`This PDF has ${doc.numPages.toLocaleString('en-US')} pages. Link Meteor reads PDFs of up to ${MAX_PDF_PAGES.toLocaleString('en-US')} pages.`);
  const pages = [];
  for (let number = 1; number <= doc.numPages; number++) {
    if (signal?.aborted) throw new Error(CANCELED);
    const page = await doc.getPage(number);
    const view = page.view || [0, 0, 0, 0];
    const annotations = (await page.getAnnotations()).filter((item) => item.subtype === 'Link' && Array.isArray(item.rect)).map((item) => {
      const points = item.quadPoints?.length >= 8 && item.quadPoints.length % 8 === 0 ? item.quadPoints : null;
      return { rect: [Math.min(item.rect[0], item.rect[2]), Math.min(item.rect[1], item.rect[3]), Math.max(item.rect[0], item.rect[2]), Math.max(item.rect[1], item.rect[3])],
        ...(points ? { quads: Array.from({ length: points.length / 8 }, (_, i) => bounds(points, i * 8)) } : {}),
        url: typeof item.url === 'string' ? item.url : '', unsafeUrl: typeof item.unsafeUrl === 'string' ? item.unsafeUrl : '', internal: !item.url && !item.unsafeUrl && !!item.dest };
    });
    // The reader marks gaps with items that hold only spaces; the gaps themselves say the same.
    const { items: content, styles = {} } = await page.getTextContent();
    const items = content.filter((item) => typeof item.str === 'string' && item.str.trim() && Array.isArray(item.transform)).map((item) => {
      const [a, b, c, d, x, y] = item.transform, turn = (((Math.round(Math.atan2(b, a) / (Math.PI / 2)) * 90) % 360) + 360) % 360;
      return { str: item.str, x, y, w: item.width || 0, h: item.height || Math.hypot(c, d) || 0, rotated: turn !== 0, turn, mono: styles[item.fontName]?.fontFamily === 'monospace' };
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
const lineTexts = (pieces) => lines(pieces).map((line) => joinLine(line.pieces)).filter(Boolean);
const joined = (pieces) => lineTexts(pieces).join(' ');
const overlapsLine = (item, y1, y2) => { const h = item.h || 1; return Math.min(item.y + h, y2) - Math.max(item.y, y1) >= h * 0.5; };

// Text turned a quarter or half turn is read in its own frame: its coordinates turned back so it
// runs left to right, with the links' rectangles turned the same way. Upright text first.
const TURNS = [0, 90, 270, 180];
const TURN = { 0: (x, y) => [x, y], 90: (x, y) => [y, -x], 180: (x, y) => [-x, -y], 270: (x, y) => [-y, x] };
function turnBox([x1, y1, x2, y2], turn) {
  const [u1, v1] = TURN[turn](x1, y1), [u2, v2] = TURN[turn](x2, y2);
  return [Math.min(u1, u2), Math.min(v1, v2), Math.max(u1, u2), Math.max(v1, v2)];
}
// A page's text that runs one way, in that way's frame, kept for the page's other links.
const frames = new WeakMap();
function inFrame(items, turn) {
  if (!frames.has(items)) frames.set(items, new Map());
  const kept = frames.get(items);
  if (!kept.has(turn)) {
    kept.set(turn, items.filter((item) => (item.turn ?? (item.rotated ? 90 : 0)) === turn).map((item) => {
      if (!turn) return item;
      const [x, y] = TURN[turn](item.x, item.y);
      return { ...item, x, y };
    }));
  }
  return kept.get(turn);
}
const upright = (items) => inFrame(items, 0);

// How wide each printable ASCII character usually is, in hundredths of the font size: a blend of
// the common text faces (Times, Helvetica, Computer Modern). The reader gives the width of a run
// of text, often a whole line, not of each character, so the run's width is shared out by these.
const WIDTHS = '29 30 42 55 52 85 74 26 35 35 46 62 27 33 27 33 52 52 52 52 52 52 52 52 52 52 28 28 60 60 60 49 92 71 68 70 73 65 61 76 73 32 47 72 60 88 73 76 64 76 71 60 65 73 71 97 71 71 61 30 35 30 48 52 31 50 54 46 54 48 31 52 54 26 27 51 26 81 54 52 54 53 35 43 32 54 51 72 51 51 46 44 25 44 54'.split(' ').map(Number);
const OTHER_WIDTHS = { '–': 50, '—': 100, '‘': 27, '’': 27, '“': 44, '”': 44, '•': 35, '…': 100, '−': 56, '×': 56 };
const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u;
function charWidth(char) {
  const code = char.charCodeAt(0), base = char.normalize('NFD').charCodeAt(0);
  if (code >= 0xdc00 && code <= 0xdfff) return 0; // the second half of a character
  return base >= 32 && base <= 126 ? WIDTHS[base - 32] : OTHER_WIDTHS[char] || (WIDE.test(char) ? 100 : 55);
}
// Where each character of a run sits: [x1, x2] for each UTF-16 unit, the run's width shared out
// by how wide its characters usually are, or evenly in a typewriter face.
const placed = new WeakMap();
function spans(item) {
  if (placed.has(item)) return placed.get(item);
  const weights = item.str.split('').map((char) => (item.mono ? (/[\udc00-\udfff]/u.test(char) ? 0 : 1) : charWidth(char)));
  const scale = item.w / (weights.reduce((sum, weight) => sum + weight, 0) || 1);
  let x = item.x;
  const at = weights.map((weight) => [x, (x += weight * scale)]);
  placed.set(item, at);
  return at;
}

// The words under a link's rectangles, in text that runs one way: whole words, never a piece of
// one. A word is the link's when most of it is inside a rectangle, or when a small rectangle is
// mostly over it (a link on part of a word). Punctuation at a word's edges is the link's only
// where it is well inside, since typesetters draw a link's rectangle a little wider than its
// words: "here." gives "here". `whole` keeps it, for an address that wraps after its dot. Text
// less than half inside a rectangle vertically is another line's.
const isEdge = (char) => !/[\p{L}\p{N}\ud800-\udfff]/u.test(char);
function wordsUnder(items, boxes) {
  const cut = [], whole = [];
  for (const item of items) {
    if (!item.w) continue;
    const near = boxes.filter(([, y1, , y2]) => overlapsLine(item, y1, y2));
    if (!near.length) continue;
    const at = spans(item), middle = (i) => (at[i][0] + at[i][1]) / 2;
    for (const word of item.str.matchAll(/\S+/gu)) {
      let start = word.index, end = start + word[0].length - 1;
      const x1 = at[start][0], x2 = at[end][1];
      const box = near.find(([bx1, , bx2]) => { const inside = Math.min(x2, bx2) - Math.max(x1, bx1); return inside > 0 && (inside * 2 >= x2 - x1 || inside * 2 >= bx2 - bx1); });
      if (!box) continue;
      whole.push({ str: word[0], x: x1, y: item.y, w: x2 - x1, h: item.h });
      const within = 0.1 * (item.h || 1);
      while (start < end && isEdge(item.str[start]) && middle(start) < box[0] + within) start++;
      while (end > start && isEdge(item.str[end]) && middle(end) > box[2] - within) end--;
      cut.push({ str: item.str.slice(start, end + 1), x: at[start][0], y: item.y, w: at[end][1] - at[start][0], h: item.h });
    }
  }
  return { cut, whole };
}
// A link's words, in the way its text runs: {lines, whole, text, turn, rects, boxes}. `lines` and
// `whole` are its words line by line, without and with the punctuation at their edges; `rects` are
// its rectangles on the page (one per line when the PDF gives them), and `boxes` the same turned
// into that frame, top line first.
function linkWords(items, annotation) {
  const rects = annotation.quads?.length ? annotation.quads : [annotation.rect];
  let found = null;
  for (const turn of TURNS) {
    const group = inFrame(items, turn);
    if (turn && !group.length) continue;
    const boxes = rects.map((rect) => turnBox(rect, turn)).sort((a, b) => b[3] - a[3] || a[0] - b[0]);
    const { cut, whole } = wordsUnder(group, boxes);
    if (!found || cut.length) found = { lines: lineTexts(cut), whole: lineTexts(whole), turn, rects, boxes };
    if (cut.length) break;
  }
  return { ...found, text: found.lines.join(' ') };
}
// Whether a word sits on a box's line just after it (or just before it), nearer than a column's
// gutter: then the box doesn't end (or start) its line.
function wordBeside(items, [x1, y1, x2, y2], after) {
  for (const item of items) {
    if (!item.w || !overlapsLine(item, y1, y2)) continue;
    const at = spans(item), gutter = 1.5 * (item.h || 1);
    for (const word of item.str.matchAll(/\S+/gu)) {
      if (!/[\p{L}\p{N}]/u.test(word[0])) continue;
      const wx1 = at[word.index][0], wx2 = at[word.index + word[0].length - 1][1], middle = (wx1 + wx2) / 2;
      if (after ? middle > x2 && wx1 < x2 + gutter : middle < x1 && wx2 > x1 - gutter) return true;
    }
  }
  return false;
}

// The ways an address is printed: whole, without its scheme, without "www.", with or without a last slash.
function addressForms(url) {
  const forms = new Set();
  for (const form of [url, (() => { try { return decodeURI(url); } catch { return url; } })()]) for (const value of [form, form.replace(/\/$/u, '')]) {
    forms.add(value); forms.add(value.replace(/^[a-z][a-z0-9+.-]*:(\/\/)?/iu, '')); forms.add(value.replace(/^[a-z][a-z0-9+.-]*:(\/\/)?(www\.)?/iu, ''));
  }
  return [...forms].map((form) => form.toLowerCase());
}
// Words without their spaces, for comparing with an address: lowercase, and a typeset apostrophe
// (Zipf’s_law) is the plain one an address has.
const squash = (text) => text.replace(/\s+/gu, '');
const comparable = (text) => squash(text).toLowerCase().replace(/[\u2018\u2019]/gu, "'");
const OPENING = /^[(\[{<“‘"']/u, CLOSING = /[.,;:!?)\]}>”’"']$/u;
// When a link's words, line by line, are its address printed in pieces, the address as printed in
// one piece: {text, whole, lead, trail}, else null. `whole` says the words are the entire address,
// not only its end (a DOI without doi.org); `lead` and `trail` count the punctuation around it
// that isn't the address's, as in "(https://x.org).". Spaces are taken out where a line breaks
// and beside an address's punctuation ("thinkpython. com/ code"), never between two words.
function printedAddress(texts, url) {
  if (!/^https?:/iu.test(url) || texts.some((line) => /[\p{L}\p{N}]\s+[\p{L}\p{N}]/u.test(line))) return null;
  const forms = addressForms(url), squashed = squash(texts.join(''));
  for (let lead = 0; lead < 3 && lead < squashed.length; lead++) {
    if (lead && !OPENING.test(squashed.slice(lead - 1))) break;
    for (let trail = 0; trail < 4 && squashed.length - lead - trail >= 6; trail++) {
      const text = squashed.slice(lead, squashed.length - trail), lower = comparable(text);
      if (trail && !CLOSING.test(squashed.slice(0, squashed.length - trail + 1))) break;
      if (forms.some((value) => value === lower || value === lower.replace(/\/$/u, ''))) return { text, whole: true, lead, trail };
      if (/[./]/u.test(lower) && forms.some((value) => value.endsWith(lower))) return { text, whole: false, lead, trail };
    }
  }
  return null;
}

// The items of a line around [x1, x2]: those it covers, and their neighbors left and right until
// a gap wider than a column's gutter.
function runAround(pieces, x1, x2) {
  const row = [...pieces].sort((a, b) => a.x - b.x);
  let from = row.findIndex((item) => item.x + item.w > x1 && item.x < x2);
  if (from < 0) return [];
  let to = from;
  while (to + 1 < row.length && row[to + 1].x < x2) to++;
  const gutter = (item) => 1.5 * (item.h || 1);
  while (from > 0 && row[from].x - (row[from - 1].x + row[from - 1].w) < gutter(row[from])) from--;
  while (to + 1 < row.length && row[to + 1].x - (row[to].x + row[to].w) < gutter(row[to])) to++;
  return row.slice(from, to + 1);
}
// In a reference list, every line of the reference a link's line is in, in the link's column:
// from the line that starts it to the one before the next. A reference starts with a label ([12],
// 12.) or is set out to the left of the lines under it, and a list is known by two such references
// in a row; anywhere else this is null, and the link's own lines are its context.
const MAX_REFERENCE_LINES = 16;
function reference(group, run) {
  const x1 = Math.min(...run.map((item) => item.x)), x2 = Math.max(...run.map((item) => item.x + item.w));
  const column = lines(group).map((line) => runAround(line.pieces, x1, x2)).filter((items) => items.length)
    .map((items) => ({ items, y: items[0].y, left: items[0].x, text: joinLine(items) }));
  const k = column.findIndex((line) => line.items.includes(run[0]));
  if (k < 0) return null;
  const h = Math.max(...run.map((item) => item.h || 1));
  const gap = (j) => j === 0 || column[j - 1].y - column[j].y > 1.5 * h;
  const label = (j) => /^(\[[^\]\s]{1,8}\]|\(?\d{1,4}[.)])\s/u.test(column[j].text);
  const outdented = (j, other) => column[j].left < column[other].left - 0.5 * h;
  const hangs = (j) => j + 1 < column.length && !gap(j + 1) && outdented(j, j + 1);
  const starts = (j) => label(j) || gap(j) || outdented(j, j - 1) || hangs(j);
  const kind = (j) => (label(j) ? 'label' : hangs(j) ? 'hang' : '');
  const first = (j) => { for (let s = j; s >= 0 && j - s < MAX_REFERENCE_LINES; s--) if (starts(s)) return s; return -1; };
  const s = first(k);
  if (s < 0 || !kind(s)) return null;
  let e = k;
  while (e + 1 < column.length && !starts(e + 1)) if (++e - s >= MAX_REFERENCE_LINES) return null;
  // Another reference of the same kind right after this one, or right before it.
  const close = (j) => column[j - 1].y - column[j].y < 3 * h;
  const after = e + 1 < column.length && close(e + 1) && kind(e + 1) === kind(s);
  const earlier = s > 0 && close(s) ? first(s - 1) : -1, before = earlier >= 0 && kind(earlier) === kind(s);
  return after || before ? column.slice(s, e + 1).flatMap((line) => line.items) : null;
}

// The words on the line or lines a link sits on, in its own column: its neighbors left and right
// until a gap wider than a column gutter; in a reference list, the whole reference. Cut around the
// link's words to MAX_CONTEXT characters. `rects` are on the page; `turn` is the way the link's
// text runs.
export function pdfContext(items, rects, anchorText = '', turn = 0) {
  const group = inFrame(items, turn).filter((item) => item.w), kept = [];
  for (const rect of rects) {
    const [x1, y1, x2, y2] = turnBox(rect, turn);
    for (const line of lines(group.filter((item) => overlapsLine(item, y1, y2)))) {
      const run = runAround(line.pieces, x1, x2);
      if (!run.length) continue;
      for (const item of reference(group, run) || run) if (!kept.includes(item)) kept.push(item);
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
// lower line close by, left of where the first piece ended, with the first piece ending its line
// and the second starting its own. A word after the first or before the second (a table's next
// column, a "Mirror:" label) makes the second another occurrence of the address.
function wrapsOnto(items, first, second) {
  const [ax1, ay1, ax2, ay2] = first, [bx1, , , by2] = second, line = Math.max(ay2 - ay1, 1);
  return by2 <= ay1 + 0.3 * line && ay1 - by2 < 2.5 * line && bx1 < ax2 && bx1 <= ax1 + 0.5 * line
    && !wordBeside(items, first, true) && !wordBeside(items, second, false);
}
// The second piece of a link cut off at the foot of a column: higher up and to the right, starting
// its line, with the first piece ending its own.
function continuesInColumn(items, first, second) {
  const [, ay1, ax2, ay2] = first, [bx1, by1] = second;
  return by1 > ay2 && bx1 >= ax2 - 0.5 * Math.max(ay2 - ay1, 1) && !wordBeside(items, first, true) && !wordBeside(items, second, false);
}

// A link's words end with a word, not with the sentence's punctuation: "here." is "here". A dot
// the rectangle covers stays after an abbreviation ("et al.", "e.g."). Where a character sits in
// a line is known only roughly, so a dot alone can't be told in or out by where it is.
function ending(text) {
  const trimmed = text.replace(/[,;:]+$/u, ''), last = /(\S*?)([.!?]+)$/u.exec(trimmed);
  return !last || /^(\p{L}{1,3}|(\p{L}\.)+\p{L})$/u.test(last[1]) ? trimmed : trimmed.slice(0, -last[2].length);
}

// pdfLinks(pages, {saveContext}) returns {links, internal, skipped, capped}:
// - links: [{url, originalHref, anchorText, pdfPage, context?}], in reading order as the PDF lists them;
// - internal: how many links go to places inside the PDF (they have no address);
// - skipped: [{page, reason: 'not-link'}] for links that aren't web, email or phone addresses;
// - capped: how many links past MAX_IMPORT_LINKS were left out.
export function pdfLinks(pages, { saveContext = true } = {}) {
  const found = [], skipped = [];
  let internal = 0, previous = null; // previous: the link made by the annotation just before this one
  const part = (page, words, margin = false) => ({ page, rects: words.rects, boxes: words.boxes, turn: words.turn, text: words.text, ...(margin ? { margin } : {}) });
  for (const page of pages) {
    for (const [index, annotation] of page.annotations.entries()) {
      if (annotation.internal) { internal++; previous = null; continue; }
      const address = importAddress(annotation.url || annotation.unsafeUrl);
      if (!address.url) { skipped.push({ page: page.number, reason: 'not-link' }); previous = null; continue; }
      const words = linkWords(page.items, annotation);
      if (previous && previous.url === address.url && previous.parts.length < 8) {
        const last = previous.parts.at(-1), items = inFrame(page.items, words.turn), wrapped = () => wrapsOnto(items, last.boxes.at(-1), words.boxes[0]);
        const printed = () => !!printedAddress([...previous.whole, ...words.whole], address.url);
        // The same words again, or a piece after the whole address, is the address again (a table's rows).
        const again = (!!words.text && words.text === last.text) || !!printedAddress(previous.whole, address.url)?.whole;
        // On one page, a piece on the next line, or a printed address that goes on in the next
        // column; across a page break, only a printed address in two pieces.
        if (!again && words.turn === last.turn && (last.page === page ? wrapped() || (continuesInColumn(items, last.boxes.at(-1), words.boxes[0]) && printed())
          : page.number === last.page.number + 1 && printed())) {
          previous.lines.push(...words.lines); previous.whole.push(...words.whole); previous.parts.push(part(page, words));
          continue;
        }
        // A printed address cut off at the end of a page: some PDFs carry its link on as a strip
        // across the next page's running head, before the piece that finishes it. The words under
        // that strip are the page's heading, not the link's, so the strip only holds the place.
        // It is known by what follows it: a piece on the next line that completes the address.
        const next = page.annotations[index + 1];
        if (page.number === last.page.number + 1 && next && !next.internal && importAddress(next.url || next.unsafeUrl).url === address.url) {
          const rest = linkWords(page.items, next);
          if (rest.turn === words.turn && wrapsOnto(items, words.boxes.at(-1), rest.boxes[0]) && printedAddress([...previous.whole, ...rest.whole], address.url)) {
            previous.parts.push(part(page, words, true));
            continue;
          }
        }
      }
      previous = { url: address.url, originalHref: annotation.unsafeUrl || annotation.url, lines: [...words.lines], whole: [...words.whole], turn: words.turn, parts: [part(page, words)] };
      found.push(previous);
    }
  }
  const capped = Math.max(0, found.length - MAX_IMPORT_LINKS);
  const links = found.slice(0, MAX_IMPORT_LINKS).map((entry) => {
    const printed = printedAddress(entry.whole, entry.url), words = entry.whole.join(' ');
    const anchorText = printed ? printed.text : ending(entry.lines.join(' '));
    const link = { url: entry.url, originalHref: entry.originalHref, anchorText, pdfPage: entry.parts[0].page.number };
    if (saveContext) {
      const parts = entry.parts.filter((item) => !item.margin), byPage = [...new Set(parts.map((item) => item.page))];
      const context = byPage.map((page) => pdfContext(page.items, parts.filter((item) => item.page === page).flatMap((item) => item.rects), words, entry.turn)).filter(Boolean).join(' ');
      // A printed address reads in one piece in its context too.
      const shown = printed ? words.slice(printed.lead, words.length - printed.trail) : '';
      const whole = shown && shown !== anchorText && context.includes(shown) ? context.replace(shown, anchorText) : context;
      if (whole) link.context = whole.length <= MAX_CONTEXT ? whole : cut(whole, anchorText);
    }
    return link;
  });
  return { links, internal, skipped, capped };
}

/* What the PDF says about itself ------------------------------------------------------------------ */
const STAMP = /arXiv:\s*(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?\s*\[([\w.-]+)\]\s*(\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4})/u;
const DOIS = /10\.\d{4,9}\/[-._;()/:a-z0-9]+/giu;
// DOIs of data and code repositories (Zenodo, figshare, Dryad, OSF projects, Mendeley Data,
// Dataverse, Code Ocean, PANGAEA): on a first page they name the paper's code or data, not the paper.
const REPOSITORY_DOI = /^10\.(5281|6084|5061|17605|17632|7910|24433|1594)\//u;
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
    // arXiv's own DOI names the same paper as the stamp, not a second one, and a repository's
    // DOI names its code or data.
    const others = [...onPage].filter((doi) => !(citation.arxiv && doi === `10.48550/arxiv.${citation.arxiv.toLowerCase()}`) && !REPOSITORY_DOI.test(doi));
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
