// Downloading the files behind links (0.4.0): the Export panel's Download files section, Download
// in each link's details, and files the capture card or the right-click menu left waiting because
// Chrome's download access was missing. Access is requested in the click that starts downloading,
// before anything is awaited, and its reason sits next to each control.
import { fileLinks, downloadFolder, folderLabel, DOWNLOAD_LIMIT, DOWNLOAD_CONFIRM_ABOVE, DOWNLOAD_PARALLEL } from '../../core/files.js';
import { $, node, button, count, plural, labelFor } from './helpers.js';
import { request, action, show, currentCollection } from './state.js';
import { onRender, onEscape, setView } from './rendering.js';
import { targetRows, requiredRows } from './review.js';
import { bindPdfFiles, renderPdfSet } from './pdf-files.js';

const PENDING_KEY = 'linkMeteorPendingDownloads';
// Files left by the card or the menu wait this long for a full view to show them.
const PENDING_MS = 10 * 60 * 1000;
const ACCESS_REASON = 'The first time, Chrome asks to let Link Meteor “Manage your downloads”. Link Meteor saves only the files you choose. It never reads, opens, changes or removes your other downloads.';
const DECLINED = 'Chrome didn’t allow downloads, so nothing was downloaded. Choose Download again to be asked again.';

let granted = false;   // Chrome's download access, as Chrome last reported it
let pending = null;    // the confirmation above 10: {files, key}
let running = null;    // the panel's download in progress: {requestId, total, stopping}
let waiting = null;    // files from the card or the menu: {links, collectionName, source}

const pick = (link) => ({ url: link.url, anchorText: link.anchorText || '', accessibleLabel: link.accessibleLabel || '' });
const where = (name) => `${folderLabel(downloadFolder(name || ''))} in your downloads folder`;
function requestId() { return crypto.randomUUID?.() || `download-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
async function checkAccess() {
  try { granted = await chrome.permissions.contains({ permissions: ['downloads'] }); } catch { granted = false; }
  renderDownloadTarget(targetRows());
}

// Called by the export target's render: the button's count, its help and the access reason.
export function renderDownloadTarget(rows) {
  const files = fileLinks(rows);
  const others = new Set(rows.map((row) => row.url)).size - files.length;
  const tooMany = files.length > DOWNLOAD_LIMIT;
  $('downloads-label').textContent = files.length ? `Download ${plural(files.length, 'file')}${files.length > DOWNLOAD_CONFIRM_ABOVE && !tooMany ? '…' : ''}` : 'Download files';
  $('downloads-start').disabled = !files.length || tooMany || !!running;
  const help = tooMany
    ? [`${count(files.length)} file links are in this view. Link Meteor downloads at most ${DOWNLOAD_LIMIT} at a time, so select fewer or filter the view.`]
    : files.length ? [`Saves the file behind each file link to ${where(currentCollection()?.name)}, named after its anchor text, ${DOWNLOAD_PARALLEL} at a time.`]
    : ['No file links in this view. File links end in a file type, such as .pdf, .docx or .png, or are labeled [PDF].'];
  if (others > 0) help.push(`${files.length ? `The other ${plural(others, 'link')} ${others === 1 ? 'isn’t a file link' : 'aren’t file links'}.` : ''} You can download any link from its details.`.trim());
  $('downloads-help').textContent = help.join(' ');
  $('downloads-access').hidden = granted;
  $('downloads-access').textContent = ACCESS_REASON;
  if (pending && pending.key !== files.map((file) => file.url).join('\n')) closeConfirm();
  // 0.6.0: the PDFs among them as one ZIP, or combined into one PDF (pdf-files.js).
  renderPdfSet(rows);
}

function openConfirm(files) {
  pending = { files, key: files.map((file) => file.url).join('\n') };
  $('downloads-confirm-text').textContent = `Download ${plural(files.length, 'file')} to ${where(currentCollection()?.name)}? Chrome saves them ${DOWNLOAD_PARALLEL} at a time, and you can cancel.`;
  $('downloads-confirm-yes').textContent = `Download ${plural(files.length, 'file')}`;
  $('downloads-confirm').hidden = false;
  $('downloads-start').hidden = true;
  $('downloads-confirm-yes').focus();
}
function closeConfirm() {
  pending = null;
  $('downloads-confirm').hidden = true;
  $('downloads-start').hidden = false;
}

// The Download files button: the file links in the export target, confirmed above 10.
function startFromPanel() {
  if (running) throw new Error('Files are still downloading. Wait for them, or cancel, before starting more.');
  const files = fileLinks(requiredRows());
  if (!files.length) throw new Error('No file links in this view. Filter to PDFs or another file type, or download a link from its details.');
  if (files.length > DOWNLOAD_LIMIT) throw new Error(`${count(files.length)} file links are in this view. Link Meteor downloads at most ${DOWNLOAD_LIMIT} at a time, so nothing was downloaded. Select fewer links or filter the view.`);
  if (files.length > DOWNLOAD_CONFIRM_ABOVE) { openConfirm(files); return; }
  return run(files);
}

function renderRunning(update = null) {
  $('downloads-progress').hidden = !running;
  if (!running) return;
  const done = update?.done ?? 0;
  $('downloads-progress-text').textContent = running.stopping ? 'Canceling the downloads that haven’t finished…' : `Downloading ${plural(running.total, 'file')}: ${count(done)} done…`;
  $('downloads-progress-bar').max = running.total;
  $('downloads-progress-bar').value = done;
}

function renderResult(text, result = null) {
  const box = $('downloads-result');
  box.replaceChildren(node('p', 'downloads-result-text', text));
  const problems = (result?.results || []).filter((item) => ['web-page', 'failed', 'held'].includes(item.status));
  if (problems.length) {
    const list = node('ul');
    for (const item of problems.slice(0, 20)) {
      const why = item.status === 'web-page' ? `gave a web page instead of a file${item.file ? `, saved as “${item.file}”` : ''}` : item.status === 'held' ? 'Chrome is holding it for you to review in its downloads list' : `failed: ${item.reason}`;
      list.append(node('li', '', `${item.anchorText ? `“${item.anchorText}”` : item.url}: ${why}`));
    }
    if (problems.length > 20) list.append(node('li', '', `and ${plural(problems.length - 20, 'more link')}`));
    box.append(list);
  }
  box.hidden = false;
}

// Starts downloading from a click. Chrome's permission request comes first, before any await, so
// the click still counts as the person's gesture; with access already granted it returns at once.
async function run(files, { collectionName = currentCollection()?.name || '' } = {}) {
  const allowed = chrome.permissions.request({ permissions: ['downloads'] }).catch(() => false);
  closeConfirm();
  running = { requestId: requestId(), total: files.length };
  $('downloads-start').disabled = true;
  $('downloads-result').hidden = true;
  renderRunning();
  $('downloads-cancel').disabled = false;
  $('downloads-cancel').focus();
  try {
    if (!await allowed) { renderResult(DECLINED); show(DECLINED); return; }
    await checkAccess();
    const result = await request({ type: 'downloads.start', links: files.map(pick), collectionName, requestId: running.requestId, confirmed: files.length > DOWNLOAD_CONFIRM_ABOVE });
    renderResult(result.summary, result);
    show(result.summary);
  } finally {
    running = null;
    renderRunning();
    renderDownloadTarget(targetRows());
    $('downloads-start').focus();
  }
}

async function stopDownloading() {
  if (!running || running.stopping) return;
  running.stopping = true;
  $('downloads-cancel').disabled = true;
  renderRunning();
  await request({ type: 'downloads.cancel', requestId: running.requestId });
}

// Download in a link's details: the file behind any link, into the collection's folder.
export function linkDownload(link) {
  const box = node('div', 'occurrence-download');
  const go = button('Download', 'btn small', 'i-download');
  go.setAttribute('aria-label', `Download the file behind ${labelFor(link)}`);
  const note = node('p', 'help', `Saves the file to ${where(currentCollection()?.name)}, named after the anchor text.${granted ? '' : ' Chrome asks for download access the first time.'}`);
  note.setAttribute('aria-live', 'polite');
  go.addEventListener('click', () => action(async () => {
    const allowed = chrome.permissions.request({ permissions: ['downloads'] }).catch(() => false);
    go.disabled = true;
    note.textContent = 'Downloading…';
    try {
      if (!await allowed) { note.textContent = DECLINED; return; }
      await checkAccess();
      const result = await request({ type: 'downloads.start', links: [pick(link)], collectionName: currentCollection()?.name || '', requestId: requestId() });
      note.textContent = result.summary;
      show(result.summary);
    } catch (error) { note.textContent = error.message; throw error; }
    finally { go.disabled = false; }
  }));
  box.append(go, note);
  return box;
}

// Files the card or the menu couldn't download without access: shown once, by the first full view
// that opens, with the button that asks Chrome for access in its click.
async function loadWaiting() {
  let stored;
  try {
    stored = (await chrome.storage.session.get(PENDING_KEY))[PENDING_KEY];
    if (!stored) return;
    await chrome.storage.session.remove(PENDING_KEY);
  } catch { return; }
  if (!Array.isArray(stored.links) || !stored.links.length || stored.links.length > DOWNLOAD_LIMIT || !(Date.now() - Date.parse(stored.createdAt) <= PENDING_MS)) return;
  waiting = stored;
  const n = stored.links.length, first = stored.links[0];
  $('downloads-pending-text').textContent = stored.source === 'menu'
    ? `From the right-click menu: ${first.anchorText ? `“${first.anchorText}”` : first.url}. Download it to ${where(stored.collectionName)}?`
    : `From the capture card: ${plural(n, 'file link')} you ticked. Download ${n === 1 ? 'it' : 'them'} to ${where(stored.collectionName)}?`;
  $('downloads-pending-start').textContent = `Download ${plural(n, 'file')}`;
  $('downloads-pending').hidden = false;
  if (!matchMedia('(min-width: 900px)').matches) setView('export');
  $('downloads-section').scrollIntoView({ block: 'nearest' });
  $('downloads-pending-start').focus({ preventScroll: true });
}
function closeWaiting() { waiting = null; $('downloads-pending').hidden = true; }

export function bindDownloads() {
  $('downloads-start').addEventListener('click', () => action(startFromPanel));
  $('downloads-confirm-yes').addEventListener('click', () => action(async () => { if (pending) await run(pending.files); }));
  $('downloads-confirm-no').addEventListener('click', () => { closeConfirm(); $('downloads-start').focus(); });
  $('downloads-cancel').addEventListener('click', () => action(stopDownloading));
  $('downloads-pending-start').addEventListener('click', () => action(async () => {
    if (!waiting) return;
    if (running) throw new Error('Files are still downloading. Wait for them, or cancel, before starting more.');
    const { links, collectionName } = waiting;
    // The waiting files are an explicit choice already, so they need no second confirmation.
    const started = run(links, { collectionName });
    closeWaiting();
    await started;
  }));
  $('downloads-pending-dismiss').addEventListener('click', () => { closeWaiting(); $('downloads-start').focus(); });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'downloads.progress' && running && message.requestId === running.requestId) renderRunning(message);
  });
  chrome.permissions?.onAdded?.addListener(() => action(checkAccess));
  chrome.permissions?.onRemoved?.addListener(() => action(checkAccess));
  onEscape(() => {
    if ($('downloads-confirm').hidden) return false;
    closeConfirm(); $('downloads-start').focus();
    return true;
  });
  // After the first render, so the view and focus it sets are not replaced by start-up.
  let first = true;
  onRender(() => { if (first) { first = false; action(loadWaiting); } });
  action(checkAccess);
  bindPdfFiles();
}
