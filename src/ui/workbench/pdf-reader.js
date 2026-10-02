// The PDF reader in Link Meteor's own pages (0.6.0). PDF.js is loaded the first time a PDF is
// read, and runs in one module worker from the bundled file: never in the background worker and
// never in a web page. Link Meteor reads annotations, text and details, and combines PDFs; it
// never draws a page. What is read is decided in core/pdf.js. The contract is in
// docs/CONTRACTS.md ("The bundled PDF reader").
import { combinePdfs as combine, isPdf, pdfProblem, readPdfDocument, MAX_PDF_BYTES } from '../../core/pdf.js';

const OPTIONS = { isEvalSupported: false, disableFontFace: true, useSystemFonts: false, useWorkerFetch: false, enableXfa: false, verbosity: 0 };
let loading;
// The library and its one worker, started on first use and kept while this page is open.
function pdfjs() {
  loading ||= import('./pdfjs.js').then((library) => {
    library.GlobalWorkerOptions.workerSrc = new URL('./pdfjs-worker.js', import.meta.url).href;
    return { library, worker: new library.PDFWorker({ name: 'link-meteor-pdf' }) };
  });
  return loading;
}

// Runs fn on an open PDF and closes it. PDF.js takes the bytes it is given, so it gets a copy.
export async function withPdf(bytes, fn) {
  const { library, worker } = await pdfjs();
  const task = library.getDocument({ data: bytes.slice(), worker, ...OPTIONS });
  try { return await fn(await task.promise); } finally { await task.destroy().catch(() => {}); }
}

// Everything Link Meteor reads from one PDF's bytes (core/pdf.js, readPdfDocument). Options:
// address (the PDF's own address, when read from a tab), saveContext, onProgress(page, pages), signal.
export async function readPdf(bytes, options = {}) {
  if (bytes.length > MAX_PDF_BYTES) throw new Error(`This PDF is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB, the most Link Meteor reads.`);
  if (!isPdf(bytes)) throw new Error('This file isn’t a PDF.');
  return withPdf(bytes, (doc) => readPdfDocument(doc, options));
}

// One PDF from several, in order: {bytes, pages, counts} (core/pdf.js, combinePdfs).
export const combinePdfs = (list) => combine(list, withPdf);

export { pdfProblem };
