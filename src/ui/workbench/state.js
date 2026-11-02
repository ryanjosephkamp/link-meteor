// Shared workbench state, messaging with the background, notices and state reloads.
import { $, node, icon, button } from './helpers.js';
import { render } from './rendering.js';

export const DEFAULT_COLUMNS = ['anchorText', 'url'];
export const ui = { state: null, inventory: null, rows: [], page: 0, selectedIds: new Set(), selectedTabs: new Set(), columns: [...DEFAULT_COLUMNS], scope: 'current', busy: false, currentOrigin: '', collectionDrafts: new Map(), linkDrafts: new Map(), openDetails: new Set(), detailLimits: new Map(), holdKeyDraft: null, directionTouched: false, lastContextReportKey: '', dismissedContextReportKey: '', displayedReportKey: '', displayedReport: null, batchFilter: '', flashBatch: '', flashStart: 0, originAccess: new Map(), shortcut: null, pendingOpen: null, returnFocus: null };
let reloadTimer, noticeTimer;

export function show(message, kind = 'notice', { actionLabel = '', onAction = null } = {}) {
  const box = $(kind);
  const other = $(kind === 'notice' ? 'error' : 'notice');
  other.hidden = true;
  clearTimeout(noticeTimer);
  box.replaceChildren();
  box.hidden = !message;
  if (!message) return;
  box.append(icon(kind === 'error' ? 'i-alert' : 'i-check'), node('span', 'msg', message));
  if (actionLabel && onAction) {
    const act = button(actionLabel, 'btn small');
    act.addEventListener('click', () => { box.hidden = true; action(onAction); });
    box.append(act);
  }
  if (kind === 'error') {
    const dismiss = button('Dismiss', 'btn small');
    dismiss.addEventListener('click', () => { box.hidden = true; });
    box.append(dismiss);
  } else {
    noticeTimer = setTimeout(() => { box.hidden = true; }, actionLabel ? 12000 : 7000);
  }
}

export function fail(error) { show(error instanceof Error ? error.message : String(error), 'error'); }

export async function request(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || !response.ok) throw new Error(response?.error || `Unable to complete ${message.type}.`);
  return response.data;
}

export async function action(fn) {
  try { await fn(); } catch (error) { fail(error); }
}

export async function mutate(actionValue) {
  ui.state = await request({ type: 'state.mutate', action: actionValue });
  render();
}

export function currentCollection() { return ui.state?.collections.find((item) => item.id === ui.state.activeCollectionId); }

export async function reloadState() {
  const before = currentCollection();
  const known = before ? new Set(before.links.map((link) => link.id)) : null;
  ui.state = await request({ type: 'state.get' });
  const after = currentCollection();
  if (known && after && after.id === before.id) {
    const arrived = after.links.find((link) => !known.has(link.id));
    if (arrived) { ui.flashBatch = arrived.batchId; ui.flashStart = Date.now(); }
  }
  render();
}

// Saved state changes arrive both as storage changes and as state.changed messages.
function scheduleReload() { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => action(reloadState), 80); }
export function onStateStorageChange(changes, area) {
  if (area === 'local' && changes.linkMeteorState) scheduleReload();
}
export function watchStateMessages() {
  chrome.runtime.onMessage.addListener((message) => { if (message?.type === 'state.changed') scheduleReload(); });
}
