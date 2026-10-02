// The PDFs behind chosen links (0.6.0), in the Export panel's Download files: Download as one ZIP,
// and Combine into one PDF…, with a list the person puts in order and PDF files from the computer.
// Each PDF's file is fetched by this page through a tab on the PDF's own site (pdf-tab.js), one at
// a time, as a run of kind `files` (background/runs.js): the background finds or opens the tab and
// paces the steps; this page holds the files in memory until the download is made, and nowhere
// else. Nothing is uploaded. The PDF reader and its rules are loaded only when first needed.
// The contract is in docs/CONTRACTS.md ("PDF files: one ZIP, or one combined PDF").
import { pdfLinks, pdfFileName, uniqueNames } from '../../core/files.js';
import { exportFileName } from '../../core/export.js';
import { zip } from '../../core/zip.js';
import { $, node, icon, count, plural, hostOf } from './helpers.js';
import { ui, request, action, show, currentCollection } from './state.js';
import { onRender, onEscape } from './rendering.js';
import { grants } from './access.js';
import { targetRows } from './review.js';
import { currentPagePlan } from './capture.js';

const HELP = 'Link Meteor gets each PDF through a page of its own site, as when you click the link, and puts them together in this browser. Nothing is uploaded.';
const NO_PDFS = 'No PDF links in this view. PDF links end in .pdf or are labeled [PDF]. You can still combine PDF files from your computer: they are read in this browser and never uploaded.';
const BUSY = 'Another capture is running. Wait for it to finish, or stop it.';
const KEEP_OPEN = 'Keep Link Meteor open until this is done.';
const FROM_COMPUTER = 'Added from your computer';

let rules = null, loadingRules = null;  // core/pdf.js (the limits and their words), once needed
let going = null;   // the run in progress, whoever started it, as the background last described it
let job = null;     // this view's own run of files: {kind, items, total, runId, early, answers, finish}
let making = '';    // 'zip' or 'combine' while this view writes the file
let panel = null;   // Combine into one PDF…, while open: {items, left, collectionId}
let nextKey = 1;

/* Small helpers ----------------------------------------------------------------------------- */
// The limits live with the PDF rules, which load only once a PDF is at hand.
function needRules() {
  loadingRules ||= import('../../core/pdf.js').then((module) => { rules = module; renderPdfSet(); return module; });
  return loadingRules;
}
function sizeText(bytes) {
  const megabytes = bytes / 1048576;
  return megabytes >= 0.1 ? `${megabytes.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB` : `${count(bytes ? Math.max(1, Math.round(bytes / 1024)) : 0)} KB`;
}
const siteOf = (url) => { try { return new URL(url).origin; } catch { return ''; } };
const chosen = () => pdfLinks(targetRows());
const running = () => !!going && going.state !== 'done';
const working = () => !!job || !!making;
const total = (items, key) => items.reduce((sum, item) => sum + (item[key] || 0), 0);

// One entry for each chosen PDF: its file name (as Download files names it, repeats numbered), its
// link's own words, and the page it was captured from.
function itemsFor(links) {
  const names = uniqueNames(links.map(pdfFileName));
  return links.map((link, index) => ({ key: nextKey++, id: link.id, url: link.url, from: link.sourceUrl || '', name: names[index], label: link.anchorText || link.accessibleLabel || link.url, bytes: null, size: 0, pages: 0 }));
}

// Which sites a background tab would be needed on, and which of those Link Meteor can't read yet.
// PDFs on the site of the person's own tab, where Link Meteor can read it, need nothing more.
function accessPlan(urls) {
  const tab = currentPagePlan(), own = tab.origin && !tab.ask ? tab.origin : '';
  const sites = new Map();
  for (const url of urls) { const origin = siteOf(url); if (origin && origin !== own) sites.set(origin, (sites.get(origin) || 0) + 1); }
  const origins = [...sites.keys()];
  return { sites, missing: grants.allSites ? [] : origins.filter((origin) => ui.originAccess.get(origin) !== true), unknown: !grants.allSites && origins.some((origin) => !ui.originAccess.has(origin)) };
}
// Asks Chrome which of these sites Link Meteor can read, and nothing else.
async function checkAccess(origins) {
  const unknown = origins.filter((origin) => origin && !ui.originAccess.has(origin));
  if (!unknown.length || !chrome.permissions?.contains) return;
  await Promise.all(unknown.map(async (origin) => {
    try { ui.originAccess.set(origin, await chrome.permissions.contains({ origins: [`${origin}/*`] })); } catch { ui.originAccess.set(origin, false); }
  }));
  renderPdfSet();
}
// The words beside a button that may make Chrome ask for sites, said before the click.
function accessWords(urls) {
  const plan = accessPlan(urls);
  if (plan.unknown) { checkAccess([...plan.sites.keys()]); return ''; }
  if (!plan.missing.length) return '';
  const names = plan.missing.map((origin) => `${hostOf(origin)} (${plural(plan.sites.get(origin), 'PDF')})`).join(', ');
  return `Needs access to ${plural(plan.missing.length, 'site')}: ${names}. Chrome asks when you start. PDFs on sites you don’t allow are left out.`;
}

// Hands a finished file to Chrome's download, as an export is.
function save(bytes, name, type) {
  const href = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a'); link.href = href; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 120000);
}
function fileName(extension, override = '') {
  return exportFileName({ collection: currentCollection()?.name || '', extension, settings: ui.state?.settings || {}, date: new Date(), override });
}

/* The section: "The N PDFs" --------------------------------------------------------------------- */
// Called by the export target's render, and whenever a run or the panel changes.
export function renderPdfSet(rows = targetRows()) {
  const links = pdfLinks(rows), n = links.length;
  if (n) needRules();
  const problem = rules && n ? rules.pdfSetProblem(links.map(() => 0)) : '';
  const held = working() || (running() && !job);
  $('pdf-set-title').textContent = !n ? 'PDF files' : n === 1 ? 'The PDF' : `The ${count(n)} PDFs`;
  $('pdf-zip').hidden = !n;
  $('pdf-zip').disabled = !!problem || held;
  $('pdf-combine').disabled = working();
  const help = $('pdf-set-help');
  help.textContent = problem ? `${problem} This view has ${count(n)} PDF links: select fewer or filter the view, or leave some out under Combine into one PDF…`
    : !n ? NO_PDFS : `${HELP}${rules ? ` ${count(rules.MAX_PDF_SET)} PDFs at most.` : ''}${running() && !job ? ` ${BUSY}` : ''}`;
  help.classList.toggle('is-problem', !!problem);
  const access = n && !problem ? accessWords(links.map((link) => link.url)) : '';
  $('pdf-access').textContent = access; $('pdf-access').hidden = !access;
  renderCombineState();
}

// How each file ended, after a ZIP or a combined PDF.
function renderResult(head, lines = []) {
  const box = $('pdf-result');
  box.replaceChildren(node('p', 'pdf-result-text', head));
  if (lines.length) {
    const list = node('ul');
    for (const [name, how] of lines) { const line = node('li'); line.append(node('b', '', name), `: ${how}`); list.append(line); }
    box.append(list);
  }
  box.hidden = false;
}

/* Fetching the files: a run of kind `files` ----------------------------------------------------- */
function renderProgress() {
  const box = $('pdf-progress');
  const on = !!job?.runId || !!making;
  box.hidden = !on;
  if (!on) return;
  // Inside the Combine panel while it combines; under the two buttons for a ZIP.
  const home = (job?.kind || making) === 'combine' && panel ? $('combine-total') : $('pdf-access');
  if (box.previousElementSibling !== home) home.after(box);
  $('pdf-stop').hidden = !job;
  if (!job) {
    $('pdf-progress-title').textContent = making === 'zip' ? 'Writing the ZIP…' : 'Combining the PDFs…';
    $('pdf-progress-text').textContent = KEEP_OPEN;
    $('pdf-progress-bar').style.width = '100%';
    return;
  }
  const mine = going?.runId === job.runId ? going : null, stopping = mine?.state === 'stopping';
  const item = job.items[(mine?.step || 1) - 1];
  $('pdf-progress-title').textContent = stopping ? 'Stopping…' : mine?.text || `Getting ${plural(job.items.length, 'PDF')}`;
  $('pdf-progress-text').textContent = [item ? hostOf(item.url) : '', `${sizeText(job.total)} so far.`].filter(Boolean).join(' · ') + ` ${KEEP_OPEN}`;
  $('pdf-stop').disabled = stopping;
  $('pdf-progress-bar').style.width = `${Math.max(0, Math.min(100, Math.round((100 * ((mine?.step || 1) - 1)) / Math.max(1, job.items.length))))}%`;
}

// A PDF's page count. One that can't be opened is set aside with the reason.
async function readPages(item) {
  try {
    const { withPdf } = await import('./pdf-reader.js');
    item.pages = await withPdf(item.bytes, (doc) => doc.numPages);
  } catch (error) {
    item.problem = error?.name === 'PasswordException' ? 'Needs a password, so it can’t be combined' : 'Damaged, so it couldn’t be read';
    item.bytes = null; item.size = 0; item.pages = 0;
  }
}

// The background asks for the files one at a time; each answer is remembered by its step.
function answer(mine, message) { mine.answers.set(message.step, answerFile(mine, message).catch(() => {})); }
// The background found a tab for one file (run.file): this page fetches it there and keeps it.
async function answerFile(mine, { runId, step, tabId, url }) {
  const item = mine.items[step];
  let reply, bytes = null;
  try {
    if (!item || !Number.isInteger(tabId)) throw new Error('Not one of this run’s files.');
    const [{ pdfThroughTab }] = await Promise.all([import('./pdf-tab.js'), needRules()]);
    ({ bytes } = await pdfThroughTab(tabId, typeof url === 'string' ? url : ''));
    reply = mine.total + bytes.length > rules.MAX_PDF_SET_BYTES ? { reason: 'set-size' } : { ok: true, size: bytes.length };
  } catch (error) { reply = { reason: typeof error?.reason === 'string' ? error.reason : 'failed' }; }
  // Only a file the run took is kept: Stop, or a step that gave up waiting, leaves it out.
  let taken = false;
  try { ({ taken } = await request({ type: 'run.fileDone', runId, step, ...reply })); } catch { /* the run is over */ }
  if (!reply.ok || !taken || job !== mine) return;
  item.bytes = bytes; item.size = bytes.length; mine.total += bytes.length;
  if (mine.kind === 'combine') await readPages(item);
  renderProgress(); renderCombine();
}

// Fetches the files these items still lack, as one run. Chrome's request for the sites comes
// first, before anything is awaited, so the click still counts as the person's. Returns how the
// run ended: {reason, text, declined}.
async function fetchFiles(kind, items) {
  if (working()) throw new Error('Link Meteor is still getting PDFs. Wait for it to finish, or stop it.');
  const early = rules?.pdfSetProblem(items.map((item) => item.size || 0));
  if (early) throw new Error(early);
  const wanted = items.filter((item) => item.url && !item.bytes);
  for (const item of wanted) { delete item.problem; delete item.unread; }
  const { missing } = accessPlan(wanted.map((item) => item.url));
  const asked = missing.length && chrome.permissions?.request ? chrome.permissions.request({ origins: missing.map((origin) => `${origin}/*`) }).then((ok) => ok === true, () => false) : null;
  const mine = job = { kind, items: wanted, total: total(items, 'size'), runId: '', early: [], answers: new Map(), finish: null };
  $('pdf-result').hidden = true;
  renderPdfSet(); renderCombine();
  try {
    const allowed = asked ? await asked : true;
    // Whatever Chrome answered, what it now grants is asked of Chrome itself the next time it matters.
    for (const origin of missing) ui.originAccess.delete(origin);
    await needRules();
    const problem = rules.pdfSetProblem(items.map((item) => item.size || 0));
    if (problem) throw new Error(problem);
    const finished = new Promise((done) => { mine.finish = done; });
    const { runId } = await request({ type: 'run.start', kind: 'files', tabId: ui.inventory?.targetTabId, files: wanted.map((item) => ({ url: item.url, from: item.from, name: item.name })) });
    mine.runId = runId;
    for (const message of mine.early.splice(0)) if (message.runId === runId) answer(mine, message);
    renderProgress();
    $('pdf-progress').scrollIntoView({ block: 'nearest' });
    $('pdf-stop').focus({ preventScroll: true });
    // The end is told by run.progress, and asked for now and then in case that was missed.
    const ask = () => request({ type: 'run.status' }).then(({ run }) => { if (!run || run.runId !== runId) mine.finish(null); else if (run.state === 'done') mine.finish(run); }, () => {});
    const timer = setInterval(ask, 3000);
    ask();
    let last;
    try { last = await finished; } finally { clearInterval(timer); }
    if (!last) throw new Error('The run ended without saying how. Nothing was downloaded.');
    // A fetched file may still be having its pages counted. A file the run gave up on is not waited for.
    await Promise.all((last.results || []).filter((row) => row.status === 'got').map((row) => mine.answers.get(row.page - 1)));
    // Each file's line in the run's report: only a file the run counts as fetched is kept.
    for (const row of last.results || []) {
      const item = wanted[row.page - 1];
      if (!item) continue;
      if (row.status === 'got' && item.bytes) continue;
      if (row.status === 'got' && item.problem) continue;
      item.bytes = null; item.size = 0; item.pages = 0;
      if (row.status === 'not-read') item.unread = row.how; else item.problem = row.status === 'got' ? 'Not kept: Link Meteor’s page lost it' : row.how;
    }
    return { reason: last.ended?.reason || 'finished', text: last.ended?.text || '', declined: !!asked && !allowed };
  } finally {
    job = null;
    renderProgress(); renderPdfSet(); renderCombine();
  }
}

function onProgress(message) {
  const was = running();
  going = message.state === 'done' ? null : message;
  if (job?.runId && message.runId === job.runId) {
    if (message.state === 'done') job.finish?.(message); else renderProgress();
  } else if (was !== running()) renderPdfSet();
}

async function stop() {
  if (!job?.runId) return;
  $('pdf-stop').disabled = true;
  await request({ type: 'run.stop', runId: job.runId });
}

/* Download as one ZIP --------------------------------------------------------------------------- */
// Nothing in it but the PDFs, each byte for byte what its site sent.
async function downloadZip() {
  const links = chosen();
  if (!links.length) throw new Error('No PDF links in this view. Filter to PDFs, or select the links whose PDFs you want.');
  const items = itemsFor(links), back = $('pdf-zip');
  let head, made = false;
  try {
    const ended = await fetchFiles('zip', items);
    const got = items.filter((item) => item.bytes);
    if (ended.reason !== 'finished') head = `${ended.text || 'The run ended early.'} No ZIP was made.`;
    else if (!got.length) head = `${ended.declined ? 'Chrome’s request for access was declined. ' : ''}No PDF could be fetched, so no ZIP was made.`;
    else {
      making = 'zip'; renderProgress();
      await new Promise((done) => setTimeout(done, 30));
      const name = fileName('zip');
      save(zip(got.map((item) => [item.name, item.bytes])), name, 'application/zip');
      made = true;
      head = `Downloaded ${name} with ${got.length === items.length ? plural(got.length, 'PDF') : `${count(got.length)} of ${plural(items.length, 'PDF')}`}, ${sizeText(total(got, 'size'))}.${ended.declined ? ' Chrome’s request for access was declined, so PDFs on the sites it named were left out.' : ''}`;
    }
    renderResult(head, items.map((item) => [item.name, item.bytes ? `${made ? 'In the ZIP' : 'Fetched, then dropped'} · ${sizeText(item.size)}` : item.problem || item.unread || 'Not fetched']));
    show(head);
  } finally {
    // The files are dropped once the download is made.
    for (const item of items) item.bytes = null;
    making = '';
    renderProgress(); renderPdfSet();
    back.focus();
  }
}

/* Combine into one PDF… ------------------------------------------------------------------------- */
function leaveOut(item, why) { panel.left.push({ name: item.name, why }); panel.items = panel.items.filter((other) => other !== item); }
// What can't go into the combined PDF is taken off the list and named with its reason.
function setAside() { for (const item of [...panel.items]) if (item.problem) leaveOut(item, item.problem); }

// The list is drawn again only when it changes (a move, a file added or fetched), so a render for
// any other reason never takes the focus from one of its buttons.
function renderCombine() {
  if (!panel) return;
  const { items } = panel, list = $('combine-list'), locked = working();
  list.replaceChildren(...items.map((item, index) => {
    const row = node('li', 'column-item combine-item'), name = node('span', 'name');
    name.append(node('b', '', item.name), node('small', '', [item.label, item.pages ? plural(item.pages, 'page') : '', item.size ? sizeText(item.size) : ''].filter(Boolean).join(' · ')));
    const move = (offset, word) => {
      const control = node('button'); control.type = 'button'; control.append(icon(offset < 0 ? 'i-arrow-up' : 'i-arrow-down'));
      control.setAttribute('aria-label', `Move ${item.name} ${word}`); control.title = `Move ${word}`; control.dataset.move = word;
      control.disabled = locked || (offset < 0 ? index === 0 : index === items.length - 1);
      control.addEventListener('click', () => {
        [items[index + offset], items[index]] = [items[index], items[index + offset]];
        renderCombine();
        // Focus stays on the moved PDF: the same button, or at an end of the list the one beside it.
        [...(list.children[index + offset]?.querySelectorAll('button') || [])].sort((a, b) => (b.dataset.move === word) - (a.dataset.move === word)).find((button) => !button.disabled)?.focus();
      });
      return control;
    };
    const out = node('button'); out.type = 'button'; out.append(icon('i-x'));
    out.setAttribute('aria-label', `Leave out ${item.name}`); out.title = 'Leave out';
    out.disabled = locked;
    out.addEventListener('click', () => { panel.items = items.filter((other) => other !== item); renderCombine(); $('combine-add').focus(); });
    row.append(name, move(-1, 'up'), move(1, 'down'), out);
    return row;
  }));
  renderCombineState();
}
// Everything in the panel but the list: what was left out, the summary, the limits and the button.
function renderCombineState() {
  if (!panel) return;
  const { items } = panel, locked = working();
  $('combine-empty').hidden = items.length > 0;
  $('combine-add').disabled = locked;
  const skip = $('combine-skip');
  skip.hidden = !panel.left.length;
  if (panel.left.length) {
    const lines = node('ul');
    for (const { name, why } of panel.left) { const line = node('li'); line.append(node('b', '', name), `: ${why}`); lines.append(line); }
    skip.replaceChildren(node('strong', '', 'Left out'), lines);
  }
  const ready = items.filter((item) => item.bytes), rest = items.length - ready.length;
  const facts = `${plural(total(ready, 'pages'), 'page')} · ${sizeText(total(ready, 'size'))}`;
  const sum = $('combine-total');
  sum.replaceChildren();
  if (!items.length) sum.append('No PDFs to combine yet.');
  else if (!rest) sum.append(node('strong', '', `${plural(items.length, 'PDF')} · ${facts}.`), ' Pages keep their links and bookmarks.');
  else sum.append(node('strong', '', `${plural(items.length, 'PDF')}.`), ready.length ? ` ${count(ready.length)} ${ready.length === 1 ? 'is' : 'are'} ready (${facts}).` : '',
    ` Link Meteor fetches the ${rest === 1 ? (ready.length ? 'other one' : 'PDF') : `${ready.length ? 'other ' : ''}${count(rest)}`} when you press Combine; ${rest === 1 ? 'its pages and size' : 'their pages and sizes'} show then. Pages keep their links and bookmarks.`);
  const problem = rules && items.length ? rules.pdfSetProblem(items.map((item) => item.size || 0)) : '';
  const over = problem && rules && items.length > rules.MAX_PDF_SET ? ` Leave out ${count(items.length - rules.MAX_PDF_SET)}.` : '';
  const help = $('combine-help');
  help.textContent = problem ? problem + over : running() && !job ? BUSY : '';
  help.hidden = !help.textContent; help.classList.toggle('is-problem', !!problem);
  const access = problem ? '' : accessWords(items.filter((item) => item.url && !item.bytes).map((item) => item.url));
  $('combine-access').textContent = access; $('combine-access').hidden = !access;
  $('combine-apply-label').textContent = items.length ? `Combine ${plural(items.length, 'PDF')}` : 'Combine PDFs';
  $('combine-apply').disabled = !items.length || !!problem || locked || (running() && !job);
  $('combine-name').disabled = locked;
  $('combine-cancel').disabled = locked;
}

function openCombine() {
  const collection = currentCollection();
  if (!collection) return;
  panel = { items: itemsFor(chosen()), left: [], collectionId: collection.id };
  if (panel.items.length) needRules();
  $('combine-name').value = fileName('pdf');
  $('combine-panel').hidden = false;
  $('pdf-combine').setAttribute('aria-expanded', 'true');
  $('pdf-result').hidden = true;
  renderCombine();
  $('combine-panel').scrollIntoView({ block: 'nearest' });
  ($('combine-list').querySelector('button:not(:disabled)') || $('combine-add')).focus({ preventScroll: true });
}
// Closing drops every file the panel held.
function closeCombine() {
  panel = null;
  $('combine-panel').hidden = true;
  $('pdf-combine').setAttribute('aria-expanded', 'false');
  $('combine-list').replaceChildren();
}
function cancelCombine() {
  if (working()) return;
  closeCombine();
  $('pdf-combine').focus();
}

// PDF files from the computer, chosen or dropped: read in this page, and counted toward the limits.
async function addFiles(files) {
  if (!panel || !files.length || working()) return;
  await needRules();
  const sizes = [...panel.items.map((item) => item.size || 0), ...files.map((file) => file.size)];
  if (sizes.length > rules.MAX_PDF_SET) throw new Error(`${rules.pdfSetProblem(sizes)} Nothing was added.`);
  const fit = files.filter((file) => file.size <= rules.MAX_PDF_BYTES), before = panel.left.length;
  for (const file of files) if (!fit.includes(file)) panel.left.push({ name: file.name, why: rules.pdfSetProblem([file.size]) });
  const together = rules.pdfSetProblem([...panel.items.map((item) => item.size || 0), ...fit.map((file) => file.size)]);
  if (together) { renderCombine(); throw new Error(`${together} Nothing was added.`); }
  let added = 0;
  for (const file of fit) {
    const item = { key: nextKey++, url: '', from: '', name: file.name, label: FROM_COMPUTER, bytes: new Uint8Array(await file.arrayBuffer()), size: file.size, pages: 0 };
    if (!panel) return;
    if (!rules.isPdf(item.bytes)) { panel.left.push({ name: file.name, why: 'Not a PDF' }); continue; }
    await readPages(item);
    if (!panel) return;
    if (item.problem) panel.left.push({ name: file.name, why: item.problem }); else { panel.items.push(item); added++; }
  }
  renderCombine();
  const skipped = panel.left.length - before;
  show(`${added ? `Added ${plural(added, 'PDF file')} to the end of the list.` : 'Nothing was added.'}${skipped ? ` ${plural(skipped, 'file was', 'files were')} left out, and listed under Left out with the reason.` : ''}`, added ? 'notice' : 'error');
}

// Combine N PDFs: fetches the files still missing, then writes one PDF in the list's order. When a
// PDF had to be left out, it stops there, so the person sees what is missing before anything is made.
async function applyCombine() {
  if (!panel) return;
  const mine = panel;
  if (!mine.items.length) throw new Error('Add at least one PDF to combine.');
  if (mine.items.some((item) => !item.bytes)) {
    const before = mine.left.length;
    const ended = await fetchFiles('combine', mine.items);
    if (panel !== mine) return;
    setAside();
    renderCombine();
    const ready = mine.items.filter((item) => item.bytes).length, out = mine.left.length - before;
    if (ended.reason !== 'finished' || out || ready < mine.items.length) {
      const why = ended.reason === 'stopped' ? 'Stopped: you pressed Stop.' : ended.reason !== 'finished' ? ended.text || 'The run ended early.' : '';
      const left = out ? `${plural(out, 'PDF was', 'PDFs were')} left out${ended.declined ? ', after Chrome’s request for access was declined' : ''}, and listed under Left out with the reason.` : '';
      const next = !mine.items.length ? 'Nothing is left to combine.' : ready < mine.items.length ? `${count(ready)} of ${plural(mine.items.length, 'PDF')} ${ready === 1 ? 'is' : 'are'} ready and kept while this panel is open. Press Combine to fetch the rest.` : `Press Combine ${plural(ready, 'PDF')} to make the PDF without ${out === 1 ? 'it' : 'them'}.`;
      show([why, left, next].filter(Boolean).join(' '), 'error');
      ($('combine-apply').disabled ? $('combine-add') : $('combine-apply')).focus();
      return;
    }
  }
  const items = mine.items;
  making = 'combine'; renderProgress(); renderPdfSet(); renderCombine();
  try {
    await Promise.all([needRules(), new Promise((done) => setTimeout(done, 30))]);
    const { combinePdfs, pdfProblem } = await import('./pdf-reader.js');
    let made;
    try { made = await combinePdfs(items.map((item) => item.bytes)); }
    catch (error) {
      const part = items[error?.part];
      if (!part) throw error;
      leaveOut(part, pdfProblem(error));
      throw new Error(`${part.name} couldn’t be combined, so it was left out. Press Combine again to make the PDF without it.`);
    }
    const name = fileName('pdf', $('combine-name').value);
    save(made.bytes, name, 'application/pdf');
    const head = `Downloaded ${name}: ${plural(items.length, 'PDF')}, ${plural(made.pages, 'page')}, ${sizeText(made.bytes.length)}.`;
    renderResult(head, [...items.map((item, index) => [item.name, `${plural(made.counts[index], 'page')}, from page ${count(made.counts.slice(0, index).reduce((sum, pages) => sum + pages, 1))}`]), ...mine.left.map(({ name: left, why }) => [left, `Left out: ${why}`])]);
    making = ''; closeCombine();
    renderProgress(); renderPdfSet();
    show(head);
    $('pdf-combine').focus();
  } finally {
    making = '';
    renderProgress(); renderPdfSet(); renderCombine();
  }
}

// An open panel follows the saved links: a link that is gone leaves the list, and another
// collection closes it.
function followLinks(collection) {
  if (!panel || working()) return;
  if (panel.collectionId !== collection.id) { closeCombine(); return; }
  const present = new Set(collection.links.map((link) => link.id));
  if (panel.items.some((item) => item.id && !present.has(item.id))) { panel.items = panel.items.filter((item) => !item.id || present.has(item.id)); renderCombine(); }
}

export function bindPdfFiles() {
  $('pdf-zip').addEventListener('click', () => action(downloadZip));
  $('pdf-combine').addEventListener('click', () => { if (panel) cancelCombine(); else openCombine(); });
  $('pdf-stop').addEventListener('click', () => action(stop));
  $('combine-panel').addEventListener('submit', (event) => { event.preventDefault(); action(applyCombine); });
  $('combine-cancel').addEventListener('click', cancelCombine);
  $('combine-add').addEventListener('click', () => $('combine-file').click());
  $('combine-file').addEventListener('change', (event) => { const files = [...event.target.files]; event.target.value = ''; action(() => addFiles(files)); });
  // Files dropped on the panel join the list. The events stop here, so Import links, which takes
  // drops elsewhere in Link Meteor, never sees them.
  const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
  const dropZone = $('combine-panel');
  dropZone.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = working() ? 'none' : 'copy';
    dropZone.classList.toggle('is-drop', !working());
  });
  dropZone.addEventListener('dragleave', (event) => { if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('is-drop'); });
  dropZone.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault(); event.stopPropagation();
    dropZone.classList.remove('is-drop');
    const files = [...event.dataTransfer.files];
    action(() => addFiles(files));
  });
  onEscape(() => {
    if (!panel || working()) return false;
    cancelCombine();
    return true;
  });
  onRender(followLinks);
  // The sites a start would ask for follow the person's tab: look again when they come to the section.
  for (const type of ['pointerenter', 'focusin']) $('pdf-set').addEventListener(type, () => { if (!working()) renderPdfSet(); });
  window.addEventListener('focus', () => { if (!working()) renderPdfSet(); });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'run.progress') onProgress(message);
    // Only the page that started the run fetches its files: the files stay in that page.
    else if (message?.type === 'run.file' && job) {
      if (!job.runId) job.early.push(message);
      else if (message.runId === job.runId) answer(job, message);
    }
  });
  for (const event of [chrome.permissions?.onAdded, chrome.permissions?.onRemoved]) event?.addListener(() => renderPdfSet());
  // A view opened while a run is going holds its buttons until that run is over.
  request({ type: 'run.status' }).then(({ run }) => { if (run && run.state !== 'done') { going = run; renderPdfSet(); } }, () => {});
}
