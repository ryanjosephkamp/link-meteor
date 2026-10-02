// PDFs (0.6.0): what the person sees for reading the links inside a PDF. Capture this PDF reads
// the PDF a tab shows; Import links reads a PDF file, chosen or dropped. Either way the links are
// shown in the Import links view before anything is saved: each with its page and its words, what
// the PDF says about itself, what was left out and why, and Add N links, which the notice can undo.
// The reader (pdf-reader.js, pdf-tab.js) and PDF.js are loaded the first time a PDF is read, never
// when the workbench opens. A PDF is read in this browser and never uploaded. The contract is in
// docs/CONTRACTS.md ("The PDF preview in the workbench").
import { MAX_IMPORTED, pageKey } from '../../core/model.js';
import { MAX_IMPORT_LINKS, SKIP_REASONS } from '../../core/imports.js';
import { $, node, count, plural, hostOf, capturableUrl } from './helpers.js';
import { ui, request } from './state.js';
import { view, openView, closeImport, progress, destination, renderDestination, setBusy, showImported, newCollectionName, chooseFileFrom, clip, PREVIEW_ROWS } from './imports.js';
import { preview, renderInventory, currentPagePlan } from './capture.js';

const NO_WORDS = '(no words: a picture)';
const NOTHING = ' Nothing was added.';
const are = (n) => (n === 1 ? 'is' : 'are');

/* Which tabs hold a PDF --------------------------------------------------------------------------- */
// What the current tab said it holds, when Link Meteor could ask it: {key, type}. A PDF whose
// address doesn't end in .pdf is known this way.
let told = null;
const tabKey = (tab) => `${tab.id} ${tab.url}`;
export function targetTab() { return ui.inventory?.tabs.find((tab) => tab.id === ui.inventory.targetTabId); }

// 'web' for a PDF on the web, 'local' for one opened from the computer, '' otherwise.
export function pdfKind(tab) {
  let url = null;
  try { url = new URL(tab?.url); } catch { return ''; }
  const named = /\.pdf$/i.test(url.pathname);
  if (url.protocol === 'file:') return named ? 'local' : '';
  if (!capturableUrl(tab.url)) return '';
  return named || (told?.key === tabKey(tab) && told.type === 'application/pdf') ? 'web' : '';
}

// What the tab holds, asked of the tab itself; '' where Link Meteor can't read it.
async function tabType(tabId) {
  try { const [answer] = await chrome.scripting.executeScript({ target: { tabId }, func: () => document.contentType }); return String(answer?.result || ''); }
  catch { return ''; }
}

// Asks the current tab what it holds, where Link Meteor can already read it, so the Capture section
// says Capture this PDF for a PDF whose address doesn't say so.
export async function learnPdfTab(tab) {
  if (!tab?.url || !capturableUrl(tab.url) || pdfKind(tab) || told?.key === tabKey(tab) || !chrome.scripting?.executeScript) return;
  const key = tabKey(tab), type = await tabType(tab.id);
  if (!type) return;
  told = { key, type };
  const current = targetTab();
  if (type === 'application/pdf' && current && tabKey(current) === key) renderInventory();
}

/* The Capture section on a PDF's tab ------------------------------------------------------------ */
// The capture button's words on a PDF's tab, or '' elsewhere.
export function pdfCaptureLabel(tab = targetTab()) {
  const kind = pdfKind(tab);
  return kind === 'web' ? 'Capture this PDF' : kind === 'local' ? 'Choose this PDF…' : '';
}

// The scope preview for a PDF's tab. Returns false when the tab holds no PDF.
export function previewPdfTab(tab) {
  const kind = pdfKind(tab);
  if (kind === 'local') preview(['This PDF is a file on your computer. Chrome doesn’t let Link Meteor read it from the tab. Choose the file instead.'], false, 'i-page');
  else if (kind === 'web') {
    preview([node('strong', '', tab.title || tab.url), ` · ${hostOf(tab.url)}. A PDF. Link Meteor reads the links inside it and shows them before adding any.`,
      currentPagePlan().ask ? ' Chrome will ask to allow Link Meteor on this site when you capture.' : ''], false, 'i-page');
  }
  return !!kind;
}

// Select a region can't be used on a PDF, and says so. `links` is false while the choice is The
// tabs themselves, where the capture button keeps its own picture.
export function syncPdfCapture(tab, { links = true } = {}) {
  const kind = pdfKind(tab), arm = $('arm'), note = $('pdf-note');
  note.hidden = !kind;
  note.textContent = kind === 'local' ? 'You can also drop the file here. It is read in this browser and never uploaded, and Link Meteor needs no access for it. Regions can’t be drawn on a PDF.'
    : kind ? 'Regions can’t be drawn on a PDF.' : '';
  // Only this module's own disabling is undone here.
  if (kind) { arm.disabled = true; arm.dataset.pdf = 'true'; arm.setAttribute('aria-describedby', 'pdf-note'); }
  else if (arm.dataset.pdf) { arm.disabled = false; delete arm.dataset.pdf; arm.removeAttribute('aria-describedby'); }
  $('capture').querySelector('use')?.setAttribute('href', kind === 'local' && links && ui.scope === 'current' ? '#i-import' : '#i-download');
}

// A PDF opened from the computer: the click opens the file chooser, since the tab can't be read.
// Returns false when the tab holds no such PDF. It runs in the click, before anything is awaited.
export function chooseLocalPdf(tab = targetTab()) {
  if (pdfKind(tab) !== 'local') return false;
  chooseFileFrom($('capture'), '.pdf,application/pdf');
  return true;
}

/* Reading ---------------------------------------------------------------------------------------- */
export function isPdfFile(file) { return /\.pdf$/i.test(file.name) || file.type === 'application/pdf'; }
// The first bytes of every PDF.
export function isPdfBytes(bytes) { return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d; }

// Opens the view for a PDF being read: the page counter, and Cancel, which stops the reading.
function startReading(opener, text) {
  openView('pdf', opener);
  view.abort = new AbortController();
  progress(text);
  const run = view.run;
  return { run, signal: view.abort.signal, saveContext: ui.state?.settings?.saveContext !== false,
    onProgress: (page, pages) => { if (run === view.run) progress(`Reading page ${count(page)} of ${count(pages)}…`); } };
}

// Called whenever the import view is reset or closed: stops a reading in progress, and takes the
// PDF's parts out of the view.
export function resetPdf() {
  view.abort?.abort(); view.abort = null; view.pdf = null;
  $('pdf-facts').hidden = true; $('pdf-facts').replaceChildren();
  $('pdf-self-row').hidden = true; $('pdf-self').checked = false; $('pdf-self').disabled = false;
  $('import-options').hidden = false; $('import-map').hidden = false;
  $('import-only-skipped-label').textContent = 'Show only skipped rows';
  $('import-table-caption').textContent = 'Rows to import, with the reason for each skipped row';
}

// Why a PDF couldn't be read, in plain words.
async function problem(error, { asked = false, origin = '' } = {}) {
  if (error?.reason === 'access') {
    return asked ? `You declined Chrome’s request for access to ${origin}, so Link Meteor could not read this PDF. Capture it again to be asked again.`
      : 'Link Meteor has no access to this PDF’s tab. Click the Link Meteor toolbar icon while on the PDF, then choose Capture this PDF again.';
  }
  const { pdfProblem } = await import('./pdf-reader.js');
  return pdfProblem(error);
}

// Capture this PDF: reads the PDF the tab shows and previews its links. Returns false when the tab
// holds no PDF, so the page is captured as usual. `asked` says this click asked Chrome for the
// tab's site (the answer is in by now); a tab that turns out to hold a PDF only when asked takes
// the same path.
export async function capturePdf(tab, { asked = false, origin = '' } = {}) {
  if (!tab?.id || !capturableUrl(tab.url)) return false;
  if (pdfKind(tab) !== 'web' && await tabType(tab.id) !== 'application/pdf') return false;
  const reading = startReading($('capture'), 'Getting the PDF from its tab…');
  try {
    const { readPdfTab } = await import('./pdf-tab.js');
    // The tab's address now, without its fragment: the links' source page.
    let address = pageKey(tab.url), title = tab.title || '';
    try { const now = await chrome.tabs.get(tab.id); address = pageKey(now.url || '') || address; title = now.title || title; } catch { /* the address in the preview is kept */ }
    const result = await readPdfTab(tab.id, { address, saveContext: reading.saveContext, onProgress: reading.onProgress, signal: reading.signal });
    if (reading.run !== view.run) return true;
    showPdf(result, { kind: 'tab', address, title, host: hostOf(address) });
  } catch (error) {
    if (reading.run !== view.run) return true;
    const words = await problem(error, { asked, origin });
    closeImport();
    throw new Error(words + NOTHING);
  }
  return true;
}

// Import links, PDF file: a PDF chosen or dropped, read in this page. `bytes` are given when the
// file was already read.
export async function readPdfFile(file, opener, bytes = null) {
  const reading = startReading(opener, `Reading ${file.name}…`);
  try {
    const { MAX_PDF_BYTES } = await import('../../core/pdf.js');
    if (file.size > MAX_PDF_BYTES) throw new Error(`${file.name} is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB, the most Link Meteor reads.`);
    const data = bytes || new Uint8Array(await file.arrayBuffer());
    const { readPdf } = await import('./pdf-reader.js');
    if (reading.run !== view.run) return;
    const result = await readPdf(data, { saveContext: reading.saveContext, onProgress: reading.onProgress, signal: reading.signal });
    if (reading.run !== view.run) return;
    showPdf(result, { kind: 'file', name: file.name });
  } catch (error) {
    if (reading.run !== view.run) return;
    const words = await problem(error);
    closeImport();
    throw new Error(words + NOTHING);
  }
}

/* The preview ------------------------------------------------------------------------------------ */
// The PDF itself as a link: its own address when it was read from a tab; for a file, its arXiv
// page or its DOI's address when the PDF names one, otherwise null (the choice isn't offered).
function selfLink(result, source) {
  const { citation } = result;
  if (source.kind === 'tab') return { url: source.address, title: citation?.title || source.title || source.address, what: 'this PDF', short: 'the PDF itself' };
  if (citation?.arxiv) return { url: `https://arxiv.org/abs/${citation.arxiv}`, title: citation.title || source.name, what: 'this paper', where: ' (its arXiv page)', short: 'the paper’s arXiv page' };
  if (citation?.doi) return { url: `https://doi.org/${citation.doi}`, title: citation.title || source.name, what: 'this paper', where: ' (its DOI address)', short: 'the paper’s DOI address' };
  return null;
}

// What the PDF says about itself, each part with where it was read.
function renderFacts(result) {
  const { citation, notes } = result, rows = [];
  if (citation?.arxiv) rows.push(['arXiv', [`arXiv:${citation.arxiv}${citation.arxivVersion || ''}`, citation.arxivCategory, citation.date].filter(Boolean).join(' · '), notes.arxiv]);
  if (citation?.doi) rows.push(['DOI', citation.doi, notes.doi]);
  if (citation?.title) rows.push(['Title', citation.title, notes.title]);
  if (citation) {
    const named = citation.authors?.length;
    rows.push(['Authors', named ? citation.authors.join('; ') : 'None read', named ? notes.authors : `${notes.authors}${citation.arxiv || citation.doi ? ' Look up details can fill them in.' : ''}`]);
    const published = [citation.journal, !citation.arxiv && citation.date].filter(Boolean);
    if (published.length) rows.push([citation.journal ? 'Journal' : 'Date', published.join(' · '), 'from the PDF’s own details']);
  }
  const list = $('pdf-facts');
  list.replaceChildren();
  for (const [term, value, how] of rows) {
    const dd = node('dd');
    dd.append(node('span', 'pdf-fact', value), node('span', 'pdf-how', how));
    list.append(node('dt', '', term), dd);
  }
  list.hidden = !rows.length;
}

function showPdf(result, source) {
  const self = selfLink(result, source);
  const name = source.kind === 'tab' ? result.citation?.title || source.title || source.host : source.name;
  view.pdf = { result, source, self, selfTouched: false, plan: null };
  view.source = { kind: 'pdf', collection: source.kind === 'file' ? name.replace(/\.pdf$/i, '') || name : name };
  view.destination = ui.state?.activeCollectionId || 'new';
  progress('');
  $('import-source').replaceChildren(node('span', 'file', source.kind === 'tab' ? `“${clip(name, 200)}”` : name),
    ` · ${plural(result.pageCount, 'page')} · ${source.kind === 'tab' ? `from this tab (${source.host})` : 'from a file'}`);
  renderFacts(result);
  $('import-options').hidden = true; $('import-map').hidden = true; $('import-map-help').hidden = true;
  $('import-only-skipped-label').textContent = 'Show what was left out';
  $('import-table-caption').textContent = 'Links in the PDF, with the reason for each one left out';
  $('pdf-self-row').hidden = !self;
  if (self) $('pdf-self-label').textContent = `Also save ${self.what} as a link${self.where || ''}, with what ${source.kind === 'tab' ? 'it' : 'the PDF'} says about itself`;
  renderDestination();
  planPdf({ destinationChanged: true });
  $('import-plan').hidden = false; $('import-commit').hidden = false;
}

// What Add would save now, for the destination and choices on screen. Nothing is changed.
export function planPdf({ destinationChanged = false } = {}) {
  const { pdf } = view;
  if (!pdf) return;
  const { result, self } = pdf, home = destination();
  const held = new Set((home?.links || []).map((link) => link.url));
  const skipSaved = !!home && $('import-skip-saved').checked;
  const saved = skipSaved ? result.links.filter((link) => held.has(link.url)) : [];
  const adding = skipSaved ? result.links.filter((link) => !held.has(link.url)) : result.links;
  let withSelf = false;
  if (self) {
    const box = $('pdf-self'), has = held.has(self.url);
    // On unless the collection already holds that address; the person's own choice is kept.
    if (!pdf.selfTouched || destinationChanged) { box.checked = !has; pdf.selfTouched = false; }
    box.disabled = has && skipSaved;
    if (box.disabled) box.checked = false;
    withSelf = box.checked;
  }
  pdf.plan = { adding, saved, self: withSelf ? self : null, total: adding.length + (withSelf ? 1 : 0) };
  view.planned = { state: ui.state };
  renderPdfPlan();
}

export function renderPdfPlan() {
  const { pdf } = view;
  if (!pdf?.plan) return;
  const { result, source, plan } = pdf, saved = new Set(plan.saved);
  const head = node('tr');
  for (const label of ['Page', 'Anchor text', 'Address']) { const th = node('th', '', label); th.scope = 'col'; head.append(th); }
  const why = node('th'); why.scope = 'col'; why.append(node('span', 'sr-only', 'Left out because')); head.append(why);
  $('import-table').tHead.replaceChildren(head);
  const row = (link, reason = '') => {
    const tr = node('tr', reason ? 'skip' : '');
    tr.append(node('td', 'num', `p. ${count(link.pdfPage)}`), link.anchorText ? node('td', '', clip(link.anchorText)) : node('td', 'empty-text', NO_WORDS), node('td', 'url', clip(link.url)), node('td', 'why', reason));
    return tr;
  };
  // A count that has no rows of its own: links to places inside the PDF, or links past the limit.
  const counted = (text, reason) => {
    const tr = node('tr', 'skip counted'), cell = node('td', '', text);
    cell.colSpan = 2;
    tr.append(node('td', 'num', ''), cell, node('td', 'why', reason));
    return tr;
  };
  const leftOut = result.internal + result.capped + result.skipped.length + plan.saved.length;
  const onlyLeftOut = $('import-only-skipped').checked;
  let rows, total;
  if (onlyLeftOut) {
    rows = [
      ...(result.internal ? [counted(`${plural(result.internal, 'link')} to ${result.internal === 1 ? 'a place' : 'places'} inside the PDF`, 'No address')] : []),
      ...(result.capped ? [counted(`${plural(result.capped, 'more link')}`, SKIP_REASONS.limit)] : []),
      ...result.skipped.map((item) => { const tr = node('tr', 'skip'); tr.append(node('td', 'num', `p. ${count(item.page)}`), node('td', 'empty-text', '(not read)'), node('td', 'url', ''), node('td', 'why', SKIP_REASONS['not-link'])); return tr; }),
      ...plan.saved.map((link) => row(link, SKIP_REASONS.saved)),
    ];
    total = rows.length;
  } else {
    rows = result.links.map((link) => row(link, saved.has(link) ? SKIP_REASONS.saved : ''));
    total = rows.length;
  }
  const shown = rows.slice(0, PREVIEW_ROWS);
  $('import-table').tBodies[0].replaceChildren(...shown);
  $('import-table-note').textContent = onlyLeftOut
    ? (!leftOut ? 'Nothing is left out.' : shown.length < total ? `Showing the first ${count(shown.length)} rows of what was left out.` : `What was left out: ${plural(leftOut, 'link')}.`)
    : !total ? '' : shown.length < total ? `Showing the first ${count(shown.length)} of ${plural(total, 'link')}.` : total === 1 ? 'The only link.' : `All ${plural(total, 'link')}.`;
  $('import-only-skipped').parentElement.hidden = !leftOut && !onlyLeftOut;

  const n = plan.adding.length, pagesWith = new Set(plan.adding.map((link) => link.pdfPage)).size;
  const noWords = plan.adding.filter((link) => !link.anchorText).length;
  const also = plan.self ? `, and ${plan.self.short} as a link` : '';
  $('import-summary').classList.toggle('is-empty', !plan.total);
  $('import-summary-main').textContent = n ? `Adds ${plural(n, 'link')} from ${count(pagesWith)} of ${plural(result.pageCount, 'page')}${source.kind === 'file' ? ', marked Imported' : ''}${also}.`
    : plan.self ? `Adds ${plan.self.short} as a link.` : 'Nothing to add.';
  const left = [
    result.internal && `${plural(result.internal, 'link')} to ${result.internal === 1 ? 'a place' : 'places'} inside the PDF`,
    result.skipped.length && `${count(result.skipped.length)} that ${result.skipped.length === 1 ? 'isn’t a web, email or phone address' : 'aren’t web, email or phone addresses'}`,
    plan.saved.length && `${count(plan.saved.length)} already saved there`,
    result.capped && `${count(result.capped)} over the ${count(MAX_IMPORT_LINKS)}-link limit`,
  ].filter(Boolean);
  $('import-summary-skips').textContent = [
    !result.links.length ? 'This PDF has no links Link Meteor can read. Scanned pages are pictures, and addresses printed without a link aren’t picked up.' : '',
    result.links.length && !n ? `Every link in this PDF is already saved there. Untick “Skip links already saved there” to add ${result.links.length === 1 ? 'it' : 'them'} again.` : '',
    left.length ? `Left out: ${left.join(', ')}.` : '',
    noWords ? `${plural(noWords, 'link')} ${are(noWords)} on ${noWords === 1 ? 'a picture and has' : 'pictures and have'} no words; ${noWords === 1 ? 'its' : 'their'} anchor text stays empty.` : '',
    plan.total ? 'You can undo this.' : '',
  ].filter(Boolean).join(' ');
  $('import-commit-label').textContent = n ? `Add ${plural(n, 'link')}` : plan.self ? `Add ${plan.self.what} as a link` : 'Add links';
  $('import-commit').disabled = !plan.total || view.busy;
}

/* Adding ----------------------------------------------------------------------------------------- */
// Where a file's link came from: "paper.pdf, page 3", within the length a link keeps.
function importedFrom(name, page) {
  const tail = page ? `, page ${page}` : '';
  return `${name.length + tail.length > MAX_IMPORTED ? `${name.slice(0, MAX_IMPORTED - tail.length - 1)}…` : name}${tail}`;
}

export async function commitPdf() {
  const { pdf } = view;
  if (view.busy || !pdf?.plan?.total) return;
  const { result, source, plan } = pdf, home = destination(), name = home ? home.name : newCollectionName();
  const tab = source.kind === 'tab';
  // A tab's PDF is its links' source page; a file's links say which file and page they came from.
  const sourceTitle = result.citation?.title || source.title || '';
  const from = (page) => (tab ? { sourceUrl: source.address, sourceTitle } : { imported: importedFrom(source.name, page) });
  const links = plan.adding.map(({ anchorText, url, originalHref, pdfPage, context }) => ({ anchorText, url, originalHref, pdfPage, ...(context ? { context } : {}), ...from(pdfPage) }));
  if (plan.self) links.unshift({ anchorText: plan.self.title, url: plan.self.url, originalHref: plan.self.url, ...from(0) });
  // What the PDF says about itself is kept with the PDF's own address: the tab's, or for a file
  // the address the PDF itself is saved under.
  const key = tab ? source.address : plan.self?.url;
  const pages = result.citation && key ? { [key]: { ...result.citation, readAt: new Date().toISOString() } } : null;
  setBusy(true);
  let saved;
  try {
    saved = await request({ type: 'import.commit', links, skipSaved: !!home && $('import-skip-saved').checked, ...(pages ? { pages } : {}),
      ...(home ? { collectionId: home.id } : { newCollection: name }) });
  } finally { setBusy(false); }
  const fromPdf = saved.count - (plan.self ? 1 : 0);
  const what = !plan.self ? plural(saved.count, 'link') : fromPdf > 0 ? `${plural(fromPdf, 'link')} and ${plan.self.short}` : `${plan.self.short} as a link`;
  const already = saved.skipped ? ` ${plural(saved.skipped, 'more link')} ${saved.skipped === 1 ? 'was' : 'were'} already saved there.` : '';
  showImported(saved, name, `Added ${what} to “${name}”.${already}`, 'Undone');
}

export function bindPdf() {
  $('pdf-self').addEventListener('change', () => { if (view.pdf) { view.pdf.selfTouched = true; planPdf(); } });
}
