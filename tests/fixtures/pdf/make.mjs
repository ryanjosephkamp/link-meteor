// Writes the PDF fixtures, with no packages: node tests/fixtures/pdf/make.mjs
// A PDF is built from lines of text in Courier, whose characters are all 0.6 of the font size
// wide, so every link's rectangle is exact. The output is deterministic; the files are committed,
// and tests/pdf.test.mjs checks that this script still writes the same bytes.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const CHAR = 0.6, LEFT = 72, TOP = 720, PAGE = [612, 792];
const esc = (text) => text.replace(/[\\()]/g, '\\$&');
const hex = (bytes) => `<${Buffer.from(bytes).toString('hex')}>`;

// Proportional faces, for lines typeset as TeX does: each character's width (thousandths of the
// font size, printable ASCII) is written into the PDF, so the reader places the text exactly by
// them, and a link's rectangle is computed from the same widths.
const widths = (text) => text.split(' ').map(Number);
export const FACES = {
  Times: { font: 'Times-Roman', widths: widths('250 333 408 500 500 833 778 180 333 333 500 564 250 333 250 278 500 500 500 500 500 500 500 500 500 500 278 278 564 564 564 444 921 722 667 667 722 611 556 722 722 333 389 722 611 889 722 722 556 722 667 556 611 722 722 944 722 722 611 333 278 333 469 500 333 444 500 444 500 444 333 500 500 278 278 500 278 778 500 500 500 500 333 389 278 500 500 722 500 500 444 480 200 480 541') },
  Helvetica: { font: 'Helvetica', widths: widths('278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584') },
  // Computer Modern's proportions, as most papers from TeX have them.
  Modern: { font: 'Times-Roman', widths: widths('333 278 500 833 500 833 778 278 389 389 500 778 278 333 278 500 500 500 500 500 500 500 500 500 500 500 278 278 778 778 778 472 778 750 708 722 764 681 653 785 750 361 514 778 625 917 750 778 681 778 736 556 722 750 750 1028 750 750 611 278 500 278 500 500 278 500 556 444 556 444 306 500 556 278 306 528 278 833 556 500 556 528 392 394 389 556 528 722 528 528 444 500 1000 500 500') },
};

/* makePdf({pages, info, xmp, encrypt}) returns a Buffer.
   pages: [[line]], top to bottom. A line is one of:
   - {size?, x?, parts: [part]}: one run of text. A part is a string or {text, url | goto | script | file,
     pad?: [left, right] in characters, perChar?: true (one text item per character), at?: x (start a
     new run at that x, as a second column does)};
   - {face, size?, x?, width?, margin?, parts: [string | {text, url}]}: one line in a FACES face, set as
     TeX sets it, with the spaces as gaps rather than characters, and stretched to `width` points
     when given. A link's rectangle covers its words, `margin` points wider on every side;
   - {rotate: text, x, y, size?, turn?: 90 | 270}: text turned a quarter turn, as arXiv's stamp is;
   - {icon: url, x, y, w, h}: a link over no text, as a small picture is;
   - {area: url, boxes: [[x1, y1, x2, y2], …]}: one link over several rectangles, given as its QuadPoints;
   - {skip: points}: extra space before the next line. */
export function makePdf({ pages, info = {}, xmp = '', encrypt = false }) {
  const objects = [];
  const add = (body) => objects.push(body);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
  // The faces the lines use, only those, so a PDF without them is as it always was.
  const faces = new Map();
  for (const name of new Set(pages.flat().map((line) => line.face).filter(Boolean))) {
    faces.set(name, add(`<< /Type /Font /Subtype /Type1 /BaseFont /${FACES[name].font} /Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 126 /Widths [${FACES[name].widths.join(' ')}] >>`));
  }
  const fontNames = `/F1 ${font} 0 R${[...faces].map(([name, id]) => ` /${name} ${id} 0 R`).join('')}`;
  const pagesId = add(null);
  const kids = [], firstPage = objects.length + 1;
  const pageIds = pages.map((_, i) => 0); // filled below, for links inside the document
  // Each page takes its annotations, then its content, then itself: count them first so a link
  // can name a later page.
  const plans = pages.map((lines) => {
    let stream = '', y = TOP; const annotations = [];
    for (const line of lines) {
      if (line.skip) { y -= line.skip; continue; }
      if (line.rotate) {
        const size = line.size || 9, down = line.turn === 270, length = line.rotate.length * CHAR * size;
        stream += `BT /F1 ${size} Tf ${down ? '0 -1 1 0' : '0 1 -1 0'} ${line.x} ${line.y} Tm (${esc(line.rotate)}) Tj ET\n`;
        // A link over the turned text: its rectangle on the page, the glyphs' tops toward the turn.
        if (line.url) annotations.push({ rect: down ? [line.x - 0.25 * size, line.y - length, line.x + 0.85 * size, line.y] : [line.x - 0.85 * size, line.y, line.x + 0.25 * size, line.y + length], url: line.url });
        continue;
      }
      if (line.icon) { annotations.push({ rect: [line.x, line.y, line.x + line.w, line.y + line.h], url: line.icon }); continue; }
      if (line.area) { const [x1, y1, x2, y2] = [0, 1, 2, 3].map((i) => (i < 2 ? Math.min : Math.max)(...line.boxes.map((box) => box[i]))); annotations.push({ rect: [x1, y1, x2, y2], url: line.area, quads: line.boxes }); continue; }
      if (line.face) {
        const face = FACES[line.face], size = line.size || 10, left = line.x ?? LEFT, margin = line.margin ?? 1;
        const text = line.parts.map((part) => (typeof part === 'string' ? part : part.text)).join(''), words = text.split(' ');
        const glyph = (char) => (face.widths[char.charCodeAt(0) - 32] ?? 500) * size / 1000;
        const inked = [...text].filter((char) => char !== ' ').reduce((sum, char) => sum + glyph(char), 0);
        const gap = line.width && words.length > 1 ? (line.width - inked) / (words.length - 1) : glyph(' ');
        // Each character's left edge, and where the line ends.
        const at = [];
        let x = left;
        for (const char of text) { at.push(x); x += char === ' ' ? gap : glyph(char); }
        at.push(x);
        stream += `BT /${line.face} ${size} Tf 1 0 0 1 ${left.toFixed(2)} ${y} Tm [${words.map((word) => `(${esc(word)})`).join(` ${(-gap * 1000 / size).toFixed(1)} `)}] TJ ET\n`;
        let index = 0;
        for (const part of line.parts) {
          const item = typeof part === 'string' ? { text: part } : part;
          const from = index + item.text.length - item.text.trimStart().length, to = index + item.text.trimEnd().length;
          if (item.url) annotations.push({ rect: [at[from] - margin, y - 0.22 * size - margin, at[to] + margin, y + 0.78 * size + margin], url: item.url });
          index += item.text.length;
        }
        y -= Math.round(size * (line.leading || 1.6));
        continue;
      }
      const size = line.size || 11, width = CHAR * size;
      let x = line.x ?? LEFT, run = '', runX = x;
      const flush = () => { if (run) stream += `BT /F1 ${size} Tf 1 0 0 1 ${runX.toFixed(2)} ${y} Tm (${esc(run)}) Tj ET\n`; run = ''; };
      for (const part of line.parts) {
        const item = typeof part === 'string' ? { text: part } : part;
        if (item.at !== undefined) { flush(); x = item.at; runX = x; }
        if (!run) runX = x;
        if (item.perChar) { flush(); [...item.text].forEach((char, i) => { stream += `BT /F1 ${size} Tf 1 0 0 1 ${(x + i * width).toFixed(2)} ${y} Tm (${esc(char)}) Tj ET\n`; }); }
        else run += item.text;
        if (item.url || item.goto || item.script || item.file) {
          const [left, right] = item.pad || [0, 0];
          annotations.push({ rect: [x - left * width, y - 0.25 * size, x + (item.text.length + right) * width, y + 0.85 * size], ...item });
        }
        x += item.text.length * width;
        if (item.perChar) runX = x;
      }
      flush();
      y -= Math.round(size * 1.6);
    }
    return { stream, annotations };
  });
  let next = objects.length + 1;
  plans.forEach((plan, i) => { pageIds[i] = next + plan.annotations.length + 1; next += plan.annotations.length + 2; });
  for (const [i, plan] of plans.entries()) {
    const ids = plan.annotations.map((item) => {
      const rect = `[${item.rect.map((n) => Number(n.toFixed(2))).join(' ')}]`;
      const action = item.url ? `/A << /S /URI /URI (${esc(item.url)}) >>` : item.goto ? `/Dest [${pageIds[item.goto - 1]} 0 R /Fit]`
        : item.script ? `/A << /S /JavaScript /JS (${esc(item.script)}) >>` : `/A << /S /GoToR /F (${esc(item.file)}) /D [0 /Fit] >>`;
      const quads = item.quads ? ` /QuadPoints [${item.quads.flatMap(([x1, y1, x2, y2]) => [x1, y2, x2, y2, x1, y1, x2, y1]).join(' ')}]` : '';
      return add(`<< /Type /Annot /Subtype /Link /Rect ${rect}${quads} /Border [0 0 0] ${action} >>`);
    });
    const content = add(`<< /Length ${plan.stream.length} >>\nstream\n${plan.stream}endstream`);
    const id = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE[0]} ${PAGE[1]}] /Resources << /Font << ${fontNames} >> >> /Contents ${content} 0 R /Annots [${ids.map((n) => `${n} 0 R`).join(' ')}] >>`);
    if (id !== pageIds[i]) throw new Error('page numbering is off');
    kids.push(id);
  }
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const metadata = xmp ? add(`<< /Type /Metadata /Subtype /XML /Length ${xmp.length} >>\nstream\n${xmp}\nendstream`) : 0;
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R${metadata ? ` /Metadata ${metadata} 0 R` : ''} >>`);
  const infoId = add(`<< ${Object.entries(info).map(([key, value]) => `/${key} (${esc(value)})`).join(' ')} >>`);
  // A PDF that asks for a password: an encryption dictionary whose user-password check fails for
  // the empty password. The reader refuses it before it reads anything else.
  const encryptId = encrypt ? add(`<< /Filter /Standard /V 1 /R 2 /O ${hex(Buffer.alloc(32, 0x4f))} /U ${hex(Buffer.alloc(32, 0x55))} /P -4 >>`) : 0;
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => { const at = out.length; out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const start = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((at) => `${String(at).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${infoId} 0 R${encryptId ? ` /Encrypt ${encryptId} 0 R /ID [${hex(Buffer.alloc(16, 0x49))} ${hex(Buffer.alloc(16, 0x49))}]` : ''} >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const xmpPacket = (fields) => `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:prism="http://prismstandard.org/namespaces/basic/2.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">${fields}</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

export const FIXTURES = {
  // A paper as arXiv serves it: no usable details of its own, a stamp in the margin, and every kind of link.
  'paper.pdf': () => makePdf({
    info: { Title: 'paper_final_v3.indd', Author: 'design08' },
    pages: [[
      { size: 20, parts: ['A Small Paper About Links'] },
      { parts: ['Ada Example and Ben Sample'] },
      { rotate: 'arXiv:2409.11211v1 [cs.CV] 17 Sep 2024', x: 40, y: 220 },
      { icon: 'https://orcid.org/0000-0002-1825-0097', x: 400, y: 690, w: 9, h: 9 },
      { skip: 10 },
      { parts: ['Our code is at ', { text: 'example.org/code', url: 'https://example.org/code' }, ' and the data is ', { text: 'here', url: 'https://data.example.org/set?id=7' }, '.'] },
      { parts: ['See Section 2 ', { text: 'below', goto: 2 }, ' for the details of the method.'] },
      { parts: ['The project page has more to read: ', { text: 'https://github.com/', url: 'https://github.com/example/project' }] },
      { parts: [{ text: 'example/project', url: 'https://github.com/example/project' }, ' and it ends here.'] },
      { parts: ['Typeset letter by letter: ', { text: 'https://mono.example.net/a', url: 'https://mono.example.net/a', perChar: true }] },
      { parts: ['[12] J. Doe. A study of things. arXiv preprint ', { text: 'arXiv:1610.10099', url: 'http://arxiv.org/abs/1610.10099', pad: [1.6, 0] }, ', 2016.'] },
      { parts: ['Published as ', { text: 'https://doi.org/10.5555/fixture.2026.001', url: 'https://doi.org/10.5555/fixture.2026.001' }] },
      { parts: ['A script: ', { text: 'run me', script: 'app.alert(1)' }, ' and another file: ', { text: 'appendix', file: 'appendix.pdf' }] },
    ], [
      { size: 14, parts: ['2 Method'] },
      { parts: ['Second page. ', { text: 'Write to us', url: 'mailto:team@example.org' }, ' or call ', { text: '+1 555 0100', url: 'tel:+15550100' }, '.'] },
      { parts: ['The code again: ', { text: 'example.org/code', url: 'https://example.org/code' }] },
      { parts: ['Left column words with ', { text: 'a link', url: 'https://left.example.org/' }, { at: 400, text: 'Right column words' }] },
      { skip: 420 },
      { parts: ['A long address at the foot of the page: ', { text: 'https://long.example.org/a/very/', url: 'https://long.example.org/a/very/long/path' }] },
    ], [
      { parts: [{ text: 'long/path', url: 'https://long.example.org/a/very/long/path' }, ' continues from the page before.'] },
      { parts: ['[1] First Author. Some title of a reference. ', { text: 'https://example.com/ref1', url: 'https://example.com/ref1' }] },
      { parts: ['[2] Another Author. The same site twice: ', { text: 'one', url: 'https://example.com/same' }, ' ', { text: 'two', url: 'https://example.com/same' }] },
    ]],
  }),
  // A journal article whose own details are right: a title and authors that are printed on the
  // page, and a DOI, a journal and a date in its metadata. Its first page names other DOIs too.
  'journal.pdf': () => makePdf({
    info: { Title: 'A Study of Things That Link', Author: 'Ada Example; Ben Sample' },
    xmp: xmpPacket('<prism:doi>10.5555/journal.2026.042</prism:doi><prism:publicationName>Journal of Fixture Studies</prism:publicationName><prism:publicationDate>2026-03-14</prism:publicationDate><dc:title><rdf:Alt><rdf:li xml:lang="x-default">A Study of Things That Link</rdf:li></rdf:Alt></dc:title>'),
    pages: [[
      { size: 9, parts: ['Journal of Fixture Studies 12 (2026) 101-102'] },
      { size: 18, parts: ['A Study of Things That Link'] },
      { parts: ['Ada Example, Ben Sample'] },
      { skip: 10 },
      { parts: ['Earlier work (doi:10.5555/earlier.2019.007) and a reply (doi:10.5555/reply.2020.011).'] },
      { parts: ['Data: ', { text: 'the archive', url: 'https://archive.example.org/study' }] },
    ], [
      { parts: ['Supplement: ', { text: 'tables', url: 'https://archive.example.org/study/tables.csv' }] },
    ]],
  }),
  // Plain notes: every line the same size, so no line is a title, and one link.
  'notes.pdf': () => makePdf({ pages: [[{ parts: ['Field notes, first page, written in one size of type.'] }, { parts: ['See ', { text: 'the map', url: 'https://maps.example.org/site-4' }, ' for the place.'] }], [{ parts: ['Field notes, second page.'] }]] }),
  'no-links.pdf': () => makePdf({ pages: [[{ size: 16, parts: ['Words Without Links'] }, { parts: ['This page has text and an address printed without a link: https://example.org/plain'] }]] }),
  // A scanned page has no text at all.
  'empty.pdf': () => makePdf({ pages: [[]] }),
  'password.pdf': () => makePdf({ encrypt: true, pages: [[{ parts: ['Locked.'] }]] }),
  'damaged.pdf': () => Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 9 0 R >>\nendobj\nxref\n0 1\n', 'latin1'),
  'not-a-pdf.pdf': () => Buffer.from('<!doctype html><title>Sign in</title><p>Please sign in to read this article.</p>', 'latin1'),
};

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('make.mjs')) {
  for (const [name, build] of Object.entries(FIXTURES)) { const bytes = build(); await writeFile(resolve(import.meta.dirname, name), bytes); console.log(`${name}: ${bytes.length} bytes`); }
}
