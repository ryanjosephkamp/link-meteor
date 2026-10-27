// Getting a PDF's file through a tab (1.0.0). An extension can't read what Chrome's PDF viewer
// shows, and Link Meteor's own pages can't request anything, so one small function runs in a tab
// Link Meteor has access to and asks for the file there: the tab's own address when the tab shows
// the PDF, or a PDF on the same site as the page in the tab. It is requested as that page, as
// when the person reloads the tab or clicks the link; nothing goes to any other address. The
// contract is in docs/CONTRACTS.md ("Reading a PDF's file", "PDF files").
import { MAX_PDF_BYTES } from '../../core/pdf.js';
import { readPdf, canceled, whenAborted } from './pdf-reader.js';

// A site that sends nothing for this long, before its answer or between two parts of it, has stopped.
export const PDF_QUIET_MS = 60000;

// Runs in the tab, so it stands alone. `url` is a PDF on the page's own site, or '' for the tab's
// own address. `id` names the request while it runs, so stopPdf can cancel it; it is given up
// when the site sends nothing for `quiet` milliseconds. Returns {ok, size, type, url, base64} or
// {ok: false, reason, status?}.
async function getPdf(url, max, id, quiet) {
  const requests = (globalThis.linkMeteorPdfRequests ||= new Map()), controller = new AbortController();
  let timer, stalled = false;
  const wait = () => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; controller.abort(); }, quiet); };
  requests.set(id, controller);
  try {
    wait();
    const response = await fetch(url || location.href, { ...(url ? {} : { cache: 'force-cache' }), signal: controller.signal });
    if (!response.ok) return { ok: false, reason: 'status', status: response.status };
    if (Number(response.headers.get('content-length')) > max) return { ok: false, reason: 'size' };
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    for (;;) {
      wait();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) { controller.abort(); return { ok: false, reason: 'size' }; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    chunks.reduce((at, chunk) => { bytes.set(chunk, at); return at + chunk.length; }, 0);
    let pdf = false;
    for (let i = 0; i + 4 < Math.min(bytes.length, 1024) && !pdf; i++) pdf = bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 && bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d;
    if (!pdf) return { ok: false, reason: 'not-pdf' };
    let binary = '';
    for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(at, at + 0x8000));
    return { ok: true, size: bytes.length, type: response.headers.get('content-type') || '', url: response.url, base64: btoa(binary) };
  } catch { return { ok: false, reason: stalled ? 'stalled' : controller.signal.aborted ? 'canceled' : 'failed' }; }
  finally {
    clearTimeout(timer); requests.delete(id);
    if (!requests.size) delete globalThis.linkMeteorPdfRequests;
  }
}
// Runs in the tab: cancels getPdf's request `id`.
function stopPdf(id) { globalThis.linkMeteorPdfRequests?.get(id)?.abort(); }

const HELP = ' Download the PDF, then choose Import links, PDF file.';
// Why a PDF's file couldn't be had from a tab, in plain words.
export const PDF_TAB_REASONS = Object.freeze({
  'not-pdf': 'The site didn’t send a PDF: it asked to sign in, or the address has expired.',
  size: `This PDF is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB, the most Link Meteor reads.`,
  status: 'The site answered with an error instead of the PDF.',
  stalled: 'The site stopped sending the PDF.',
  failed: 'Chrome couldn’t get this PDF’s file from that page.',
  access: 'Link Meteor has no access to that page.',
});

function decode(base64) {
  const binary = atob(base64), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// The PDF's bytes through a tab: {bytes, type, url}. `url` is a PDF on the same site as the tab's
// page, or omitted for the tab's own address. Options: `signal`, whose abort cancels the request
// in the tab and rejects at once (reason 'canceled'), and `quiet` (PDF_QUIET_MS). Throws an Error
// with plain words and a `reason`: 'access' (Chrome refused the tab; the caller may ask for the
// site), or a key of PDF_TAB_REASONS.
export async function pdfThroughTab(tabId, url = '', { signal = null, quiet = PDF_QUIET_MS } = {}) {
  if (signal?.aborted) throw canceled();
  const id = crypto.randomUUID();
  const asked = chrome.scripting.executeScript({ target: { tabId }, func: getPdf, args: [url, MAX_PDF_BYTES, id, quiet] });
  asked.catch(() => {}); // after Cancel, its answer is unheard
  const stop = () => { chrome.scripting.executeScript({ target: { tabId }, func: stopPdf, args: [id] }).catch(() => {}); };
  signal?.addEventListener('abort', stop, { once: true });
  let answer;
  try { [{ result: answer }] = await (signal ? Promise.race([asked, whenAborted(signal)]) : asked); }
  catch (error) {
    if (error?.reason === 'canceled') throw error;
    throw Object.assign(new Error(PDF_TAB_REASONS.access), { reason: 'access', detail: String(error?.message || error) });
  } finally { signal?.removeEventListener('abort', stop); }
  if (!answer?.ok) {
    const reason = Object.hasOwn(PDF_TAB_REASONS, answer?.reason) ? answer.reason : 'failed';
    throw Object.assign(new Error(PDF_TAB_REASONS[reason] + (url ? '' : HELP)), { reason, status: answer?.status });
  }
  return { bytes: decode(answer.base64), type: answer.type, url: answer.url };
}

// Everything Link Meteor reads from the PDF a tab shows (readPdf's result, with the bytes).
// Options are readPdf's; the PDF's own address is the tab's. Its `signal` stops the request and
// the reading alike.
export async function readPdfTab(tabId, options = {}) {
  const { bytes, url } = await pdfThroughTab(tabId, '', { signal: options.signal });
  return { ...(await readPdf(bytes, { ...options, address: options.address || url })), bytes, address: url };
}
