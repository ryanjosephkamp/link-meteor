// Opening the export target's web links: up to 20 at once, an inline confirmation from 21 to 500
// (stronger wording above 100), nothing above 500. Tabs open in batches with progress and Cancel,
// as tabs, in a new window or as a tab group named after the collection.
import { $, count, plural, safeUrl } from './helpers.js';
import { request, action, show, currentCollection } from './state.js';
import { onEscape } from './rendering.js';
import { targetRows, requiredRows } from './review.js';
import { openTier, openQuestion, openOutcome, OPEN_LIMIT } from './access.js';

let pending = null;   // the confirmation's {urls, skipped}
let running = null;   // the opening in progress: {requestId, total}

function webTargets(rows) {
  return { urls: [...new Set(rows.map((row) => safeUrl(row.url)).filter(Boolean))], skipped: rows.filter((row) => !safeUrl(row.url)).length };
}

export function renderOpenTarget(rows) {
  const { urls } = webTargets(rows);
  const tier = openTier(urls.length);
  $('open-label').textContent = urls.length ? `Open ${plural(urls.length, 'web link')}${tier === 'direct' ? '' : '…'}` : 'Open links…';
  for (const id of ['open-links', 'open-window', 'open-group']) $(id).disabled = !rows.length || !!running;
  if (pending && urls.join('\n') !== pending.urls.join('\n')) cancelOpen();
}

// Starts from a click. Up to 20 links open at once; more ask first. Stays synchronous until the
// tab-group permission request, so the click still counts as the person's gesture.
export function openLinks(mode = 'tabs') {
  if (running) throw new Error('Links are still opening. Wait for them, or cancel, before opening more.');
  const { urls, skipped } = webTargets(requiredRows());
  if (!urls.length) throw new Error(`No HTTP(S) links are available to open. ${plural(skipped, 'non-web row')} ${skipped === 1 ? 'was' : 'were'} skipped.`);
  const tier = openTier(urls.length);
  if (tier === 'refuse') throw new Error(`${count(urls.length)} web links are in the target. Link Meteor opens at most ${OPEN_LIMIT} at a time, so nothing was opened. Select fewer links or filter the view.`);
  if (tier === 'direct') return runOpen({ urls, skipped, mode });
  pending = { urls, skipped };
  $('open-confirm-text').textContent = openQuestion(urls.length, skipped);
  $('open-confirm').classList.toggle('open-confirm-strong', tier === 'strong');
  $('open-confirm-yes').textContent = `Open ${plural(urls.length, 'tab')}`;
  $('open-confirm').hidden = false;
  $('open-links').hidden = true;
  $({ tabs: 'open-confirm-yes', window: 'open-confirm-window', group: 'open-confirm-group' }[mode]).focus();
}

export function cancelOpen() {
  pending = null;
  $('open-confirm').hidden = true;
  $('open-links').hidden = false;
}

function requestId() {
  return crypto.randomUUID?.() || `open-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function renderProgress(update = null) {
  $('open-progress').hidden = !running;
  if (!running) return;
  const opened = update ? update.opened + update.failed : 0;
  $('open-progress-text').textContent = running.stopping ? 'Stopping after this batch…' : `Opening ${count(opened)} of ${plural(running.total, 'link')}…`;
  $('open-progress-bar').max = running.total;
  $('open-progress-bar').value = opened;
}

async function runOpen({ urls, skipped, mode }) {
  // Naming a group needs Chrome's tab-group access, asked for when a group is chosen. This
  // request must come before anything is awaited.
  const naming = mode === 'group' ? chrome.permissions.request({ permissions: ['tabGroups'] }).catch(() => false) : null;
  cancelOpen();
  const groupTitle = currentCollection()?.name || '';
  running = { requestId: requestId(), total: urls.length };
  for (const id of ['open-links', 'open-window', 'open-group']) $(id).disabled = true;
  renderProgress();
  $('open-cancel-progress').disabled = false;
  $('open-cancel-progress').focus();
  try {
    if (naming) await naming;
    const result = await request({ type: 'links.open', urls, confirmed: urls.length > 20, mode, ...(mode === 'group' ? { groupTitle } : {}), requestId: running.requestId });
    show(openOutcome(result, { total: urls.length, mode, skipped, groupTitle }));
  } finally {
    running = null;
    renderProgress();
    for (const id of ['open-links', 'open-window', 'open-group']) $(id).disabled = !targetRows().length;
    $('open-links').focus();
  }
}

async function confirmOpen(mode) {
  if (!pending) return;
  return runOpen({ ...pending, mode });
}

async function stopOpening() {
  if (!running || running.stopping) return;
  running.stopping = true;
  $('open-cancel-progress').disabled = true;
  renderProgress();
  await request({ type: 'links.cancel', requestId: running.requestId });
}

export function bindOpen() {
  $('open-links').addEventListener('click', () => action(() => openLinks('tabs')));
  $('open-window').addEventListener('click', () => action(() => openLinks('window')));
  $('open-group').addEventListener('click', () => action(() => openLinks('group')));
  $('open-confirm-yes').addEventListener('click', () => action(() => confirmOpen('tabs')));
  $('open-confirm-window').addEventListener('click', () => action(() => confirmOpen('window')));
  $('open-confirm-group').addEventListener('click', () => action(() => confirmOpen('group')));
  $('open-confirm-no').addEventListener('click', () => { cancelOpen(); $('open-links').focus(); });
  $('open-cancel-progress').addEventListener('click', () => action(stopOpening));
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'links.progress' && running && message.requestId === running.requestId) renderProgress(message);
  });
  onEscape(() => {
    if ($('open-confirm').hidden) return false;
    cancelOpen(); $('open-links').focus();
    return true;
  });
}
