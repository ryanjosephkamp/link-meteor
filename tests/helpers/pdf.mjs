// Opens PDFs in plain Node with the PDF.js files Link Meteor ships (src/vendor/pdfjs), so unit
// tests read real PDF bytes with no packages. The browser loads the same files through
// src/ui/workbench/pdf-reader.js.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { combinePdfs as combine, readPdfDocument } from '../../src/core/pdf.js';

const vendor = resolve(import.meta.dirname, '../../src/vendor/pdfjs');
let library;
async function pdfjs() {
  if (!library) {
    // In Node, PDF.js notes once that it can't draw (no canvas). Link Meteor never draws.
    const { warn, log } = console; console.warn = console.log = () => {};
    try { library = await import(new URL(`file://${resolve(vendor, 'pdf.min.mjs')}`).href); } finally { console.warn = warn; console.log = log; }
    library.GlobalWorkerOptions.workerSrc = new URL(`file://${resolve(vendor, 'pdf.worker.min.mjs')}`).href;
  }
  return library;
}
const OPTIONS = { isEvalSupported: false, disableFontFace: true, useSystemFonts: false, useWorkerFetch: false, enableXfa: false, verbosity: 0 };

export const fixture = (name) => readFile(resolve(import.meta.dirname, '../fixtures/pdf', name));

// Runs fn(document) on an open PDF, then closes it. Rejects as PDF.js does (PasswordException, …).
export async function withPdf(bytes, fn) {
  const task = (await pdfjs()).getDocument({ data: new Uint8Array(bytes), ...OPTIONS });
  try { return await fn(await task.promise); } finally { await task.destroy(); }
}
export const readPdf = (bytes, options) => withPdf(bytes, (doc) => readPdfDocument(doc, options));
// One PDF from several, in order, as the workbench combines them: {bytes, pages, counts}.
export const combinePdfs = (list) => combine(list.map((bytes) => new Uint8Array(bytes)), withPdf);
