// Capture: scope and tab inventory, running a capture, and the capture report.
import { $, node, icon, count, plural, capturableUrl, originOf, hostOf } from './helpers.js';
import { ui, request, action, show, fail, currentCollection } from './state.js';
import { render } from './rendering.js';
import { renderLinks } from './review.js';
import { renderSite } from './settings.js';

let inventoryTimer, inventoryRequestSequence = 0;

/* Capture scope ---------------------------------------------------------------- */
export function scopeTabs() {
  const tabs = ui.inventory?.tabs || [];
  return ui.scope === 'selected' ? tabs.filter((tab) => ui.selectedTabs.has(tab.id)) : ui.scope === 'window' ? tabs.filter((tab) => tab.windowId === ui.inventory.currentWindowId) : tabs;
}

export function renderCaptureButton() {
  const label = $('capture-label');
  if (ui.busy) { label.textContent = 'Capturing…'; $('capture').setAttribute('aria-busy', 'true'); return; }
  $('capture').removeAttribute('aria-busy');
  if (ui.scope === 'current') { label.textContent = 'Capture this page'; return; }
  if (!ui.inventory) { label.textContent = 'Capture tabs'; return; }
  const n = scopeTabs().length;
  label.textContent = ui.scope === 'selected' && !n ? 'Capture selected tabs' : `Capture ${plural(n, 'tab')}`;
}

export function preview(parts, warning = false, iconName = 'i-info') {
  const box = $('scope-preview');
  box.classList.toggle('is-warning', warning);
  const text = node('span');
  for (const part of parts) text.append(typeof part === 'string' ? document.createTextNode(part) : part);
  box.replaceChildren(icon(iconName), text);
}

export async function refreshOriginAccess(origins) {
  const unknown = origins.filter((origin) => !ui.originAccess.has(origin));
  if (!unknown.length || !chrome.permissions?.contains) return;
  await Promise.all(unknown.map(async (origin) => {
    try { ui.originAccess.set(origin, await chrome.permissions.contains({ origins: [`${origin}/*`] })); } catch { ui.originAccess.set(origin, false); }
  }));
  renderInventory();
}

export function renderInventory() {
  renderCaptureButton();
  if (!ui.inventory) {
    preview(['Tab preview unavailable. Reopen Link Meteor from an ordinary page, or choose the scope again to refresh it.'], true, 'i-alert');
    $('tab-picker').hidden = ui.scope !== 'selected';
    return;
  }
  const tabs = ui.inventory.tabs || [];
  const chosen = scopeTabs();
  const supported = chosen.filter((tab) => capturableUrl(tab.url)).length;
  const unknown = chosen.filter((tab) => !tab.url).length;
  const unsupported = chosen.length - supported - unknown;
  const target = tabs.find((tab) => tab.id === ui.inventory.targetTabId);
  if (ui.scope === 'current') {
    if (!target) preview(['Open a webpage, then open Link Meteor from it to capture that page.'], true, 'i-alert');
    else if (!target.url) preview(['The current tab was found, but its address is not visible to Link Meteor. The capture result will say whether it can be read.']);
    else if (!capturableUrl(target.url)) preview([`This is a browser page (${target.url}). Chrome does not allow capturing it; choose an ordinary webpage.`], true, 'i-ban');
    else preview([node('strong', '', target.title || target.url), ` · ${hostOf(target.url)}`], false, 'i-page');
  } else if (!chosen.length) {
    preview([ui.scope === 'selected' ? 'Choose the tabs to capture below.' : 'No ordinary tabs are open in this scope.'], ui.scope !== 'selected');
  } else {
    const windows = new Set(chosen.map((tab) => tab.windowId)).size;
    const origins = [...new Set(chosen.map((tab) => originOf(tab.url)).filter(Boolean))];
    refreshOriginAccess(origins);
    const needed = origins.filter((origin) => ui.originAccess.get(origin) === false).length;
    const parts = [node('strong', '', plural(chosen.length, 'tab')), ` in ${plural(windows, 'window')} · ${plural(supported, 'webpage')}`];
    if (unsupported) parts.push(` · ${count(unsupported)} can't be captured`);
    if (unknown) parts.push(` · ${count(unknown)} unknown`);
    parts.push('. ');
    if (chosen.length > 100) parts.push('Choose at most 100 tabs per capture.');
    else if (needed) parts.push(`Chrome will ask to allow access to ${plural(needed, 'site')}; any you decline are reported, not skipped silently.`);
    else parts.push('Each tab gets its own result.');
    preview(parts, chosen.length > 100, chosen.length > 100 ? 'i-alert' : 'i-tabs');
  }
  $('tab-picker').hidden = ui.scope !== 'selected';
  if (ui.scope === 'selected') {
    const area = $('tab-options');
    const focusedTabId = area.contains(document.activeElement) ? document.activeElement.dataset.tabId : null;
    area.replaceChildren();
    const windows = [...new Set(tabs.map((tab) => tab.windowId))];
    windows.sort((a, b) => (a === ui.inventory.currentWindowId ? -1 : b === ui.inventory.currentWindowId ? 1 : 0));
    windows.forEach((windowId, index) => {
      if (windows.length > 1) area.append(node('p', 'tab-window', windowId === ui.inventory.currentWindowId ? 'This window' : `Window ${index + 1}`));
      for (const tab of tabs.filter((item) => item.windowId === windowId)) {
        const label = node('label', 'tab-option'); const box = document.createElement('input'); box.type = 'checkbox'; box.checked = ui.selectedTabs.has(tab.id); box.dataset.tabId = String(tab.id);
        box.setAttribute('aria-label', `Include ${tab.title || tab.url || `tab ${tab.id}`}`);
        box.addEventListener('change', () => { box.checked ? ui.selectedTabs.add(tab.id) : ui.selectedTabs.delete(tab.id); renderInventory(); });
        const text = node('span');
        text.append(node('span', 'title', tab.title || `Tab ${tab.id}`));
        const meta = node('span', 'meta');
        if (tab.url && !capturableUrl(tab.url)) meta.append(node('span', 'flag', 'Can’t capture · '));
        meta.append(document.createTextNode(tab.url ? (hostOf(tab.url) || tab.url) : 'Address unavailable'));
        if (tab.id === ui.inventory.targetTabId) meta.append(document.createTextNode(' · current page'));
        text.append(meta);
        label.append(box, text); area.append(label);
      }
    });
    if (!tabs.length) area.append(node('p', 'help', 'No tabs are available. Allow tab access to choose pages.'));
    $('tab-picked').textContent = `${count(ui.selectedTabs.size ? tabs.filter((tab) => ui.selectedTabs.has(tab.id)).length : 0)} of ${plural(tabs.length, 'tab')} selected`;
    if (focusedTabId) [...area.querySelectorAll('input[data-tab-id]')].find((box) => box.dataset.tabId === focusedTabId)?.focus({ preventScroll: true });
  }
}

export async function loadInventory() {
  const sequence = ++inventoryRequestSequence;
  const inventory = await request({ type: 'tabs.list' });
  if (sequence !== inventoryRequestSequence) return inventory;
  ui.inventory = inventory;
  if (ui.inventory.targetTabId && !ui.selectedTabs.size) ui.selectedTabs.add(ui.inventory.targetTabId);
  const target = ui.inventory.tabs.find((tab) => tab.id === ui.inventory.targetTabId);
  ui.currentOrigin = originOf(target?.url || '');
  renderInventory();
  renderSite();
  return inventory;
}

export function scheduleInventoryRefresh() {
  clearTimeout(inventoryTimer);
  inventoryTimer = setTimeout(() => action(loadInventory), 120);
}

export async function chooseScope(value) {
  ui.scope = value;
  if (value !== 'current') {
    const allowed = await chrome.permissions.request({ permissions: ['tabs'] });
    if (!allowed) { show('Tab access was declined, so Link Meteor cannot list your open tabs. Capture This page, or choose another scope to be asked again.', 'error'); ui.scope = 'current'; document.querySelector('input[name="scope"][value="current"]').checked = true; renderInventory(); return; }
  }
  await loadInventory();
}

/* Capture report ----------------------------------------------------------------- */
export const REPORT_STATUS = {
  success: { icon: 'i-check', label: (result) => (result.count ? plural(result.count, 'link') : 'No links') },
  denied: { icon: 'i-ban', label: () => 'Access denied' },
  unsupported: { icon: 'i-ban', label: () => 'Unsupported page' },
  error: { icon: 'i-alert', label: () => 'Capture failed' },
};

export function syncReportAction() {
  const box = $('capture-report');
  const previous = box.querySelector('.report-actions');
  const hadFocus = previous?.contains(document.activeElement);
  previous?.remove();
  const report = ui.displayedReport;
  if (!report?.capturedCount || !currentCollection()?.links.some((link) => link.batchId === report.batchId)) return;
  const actions = node('div', 'report-actions');
  const only = node('button', 'link-btn', ui.batchFilter === report.batchId ? 'Show all links' : 'Show only these links'); only.type = 'button';
  only.addEventListener('click', () => {
    ui.batchFilter = ui.batchFilter === report.batchId ? '' : report.batchId;
    ui.page = 0; renderLinks();
  });
  actions.append(only); box.append(actions);
  if (hadFocus) only.focus({ preventScroll: true });
}

export function captureReport(report, { source = 'workbench', key = '', createdAt = '' } = {}) {
  const box = $('capture-report'); box.replaceChildren(); box.hidden = false;
  ui.displayedReportKey = key;
  ui.displayedReport = report;
  const results = report.results || [];
  const succeeded = results.filter((result) => result.status === 'success').length;
  const head = node('div', 'report-head');
  const title = node('h3', '', `${source === 'context' ? 'Previous capture · ' : ''}${plural(report.capturedCount, 'link')} captured`);
  const sub = results.length === 1 ? `from ${results[0].title || results[0].url || `tab ${results[0].tabId}`}` : `${count(succeeded)} of ${plural(results.length, 'page')} captured`;
  const time = createdAt ? new Date(createdAt) : null;
  title.append(node('span', 'sub', time && !Number.isNaN(time.valueOf()) ? `${sub} · ${time.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : sub));
  const dismiss = node('button', 'btn quiet icon-btn small'); dismiss.type = 'button'; dismiss.setAttribute('aria-label', 'Dismiss capture report'); dismiss.title = 'Dismiss'; dismiss.append(icon('i-x'));
  dismiss.addEventListener('click', () => action(async () => {
    box.hidden = true;
    if (key) {
      ui.dismissedContextReportKey = key;
      await chrome.storage.session.set({ linkMeteorCaptureReportDismissed: key });
    }
  }));
  head.append(title, dismiss); box.append(head);
  const list = node('ul', 'report-list');
  const quiet = results.length === 1 && results[0].status === 'success' && results[0].count && !results[0].warning;
  for (const result of quiet ? [] : results) {
    const kind = REPORT_STATUS[result.status] || REPORT_STATUS.error;
    const empty = result.status === 'success' && !result.count;
    const item = node('li', `report-item ${empty ? 'empty' : result.status}`);
    item.append(icon(empty ? 'i-minus' : kind.icon), node('span', 'page', result.title || result.url || `Tab ${result.tabId}`), node('span', 'status', kind.label(result)));
    if (empty && !result.warning) item.append(node('span', 'detail', 'The page loaded, but it has no links Link Meteor can read.'));
    if (result.status === 'denied') item.append(node('span', 'detail', 'Link Meteor does not have access to this site. Capture it again to be asked, or allow site access in Chrome’s extension settings.'));
    if (result.warning) item.append(node('span', `detail${result.status === 'success' ? ' warn' : ''}`, result.warning));
    if (result.error) item.append(node('span', 'detail', result.status === 'denied' ? `Chrome: ${result.error}` : result.error));
    list.append(item);
  }
  if (!results.length) list.append(node('li', 'report-item error', 'No tab results were returned.'));
  if (list.childNodes.length) box.append(list);
  syncReportAction();
}

export function showContextReport(value) {
  if (!value?.report || !Array.isArray(value.report.results)) return;
  const key = JSON.stringify([value.createdAt, value.report.batchId, value.report.capturedCount]);
  if (key === ui.lastContextReportKey || key === ui.dismissedContextReportKey) return;
  ui.lastContextReportKey = key;
  captureReport(value.report, { source: 'context', key, createdAt: value.createdAt });
}

export async function runCapture() {
  if (ui.busy) return;
  ui.busy = true; $('capture').disabled = true; renderCaptureButton();
  try {
    let tabIds = [];
    if (ui.scope !== 'current') {
      if (!ui.inventory) throw new Error('Tab preview is unavailable. Choose the scope again to refresh it.');
      const scope = ui.scope;
      const tabs = ui.inventory.tabs;
      const picked = scope === 'selected' ? tabs.filter((tab) => ui.selectedTabs.has(tab.id)) : scope === 'window' ? tabs.filter((tab) => tab.windowId === ui.inventory.currentWindowId) : tabs;
      if (!picked.length) throw new Error('Select at least one tab before capturing.');
      if (picked.length > 100) throw new Error(`${picked.length} tabs are in scope. Select at most 100 tabs for each capture.`);
      tabIds = picked.map((tab) => tab.id);
      const originalOrigins = new Map(picked.map((tab) => [tab.id, originOf(tab.url)]));
      const origins = [...new Set(picked.map((tab) => originOf(tab.url)).filter(Boolean))];
      if (origins.length) {
        try {
          const granted = await chrome.permissions.request({ origins: origins.map((origin) => `${origin}/*`) });
          if (!granted) show('Some site access was declined. The capture report will identify denied pages.', 'notice');
        } catch (error) { show(`Site access request failed: ${error.message}. The capture report will identify denied pages.`, 'notice'); }
        ui.originAccess.clear();
      }
      const freshInventory = await loadInventory();
      const survivors = new Map(freshInventory.tabs.map((tab) => [tab.id, tab]));
      if (tabIds.some((id) => survivors.has(id) && originOf(survivors.get(id).url) !== originalOrigins.get(id))) {
        throw new Error('A selected tab changed origin during the permission request. Review the scope and capture again.');
      }
    }
    const { state, report } = await request({ type: 'capture.run', tabIds });
    ui.flashBatch = report.batchId; ui.flashStart = Date.now();
    ui.state = state; render(); captureReport(report);
    clearTimeout(inventoryTimer);
    let previewError;
    try { await loadInventory(); } catch (error) { previewError = error; }
    if (previewError) show(`Capture finished, but the current-site preview could not refresh: ${previewError.message}`, 'error');
    else show(`Capture finished: ${plural(report.capturedCount, 'link')} from ${plural(report.results.filter((result) => result.status === 'success').length, 'page')}. Details are in the capture report.`);
  } finally { ui.busy = false; $('capture').disabled = false; renderCaptureButton(); }
}

export function bindCapture() {
  for (const radio of document.querySelectorAll('input[name="scope"]')) radio.addEventListener('change', () => action(() => chooseScope(radio.value)));
  $('tabs-all').addEventListener('click', () => { for (const tab of ui.inventory?.tabs || []) ui.selectedTabs.add(tab.id); renderInventory(); });
  $('tabs-none').addEventListener('click', () => { ui.selectedTabs.clear(); renderInventory(); });
  $('capture').addEventListener('click', () => action(runCapture));
  $('arm').addEventListener('click', () => action(async () => { const result = await request({ type: 'capture.arm' }); const tab = ui.inventory?.tabs.find((item) => item.id === result.tabId); show(`Region selection is ready${tab?.title ? ` on “${tab.title}”` : ''}. Drag across links on the page; press Esc to cancel.`); }));
}

export async function startInventory() {
  try { await loadInventory(); } catch (error) { ui.inventory = null; renderInventory(); show(`Current site preview unavailable: ${error.message}`, 'error'); }
}

export function onCaptureStorageChange(changes, area) {
  if (area === 'session' && changes.linkMeteorTarget?.newValue) scheduleInventoryRefresh();
  if (area === 'session' && changes.linkMeteorCaptureReport?.newValue) showContextReport(changes.linkMeteorCaptureReport.newValue);
  if (area === 'session' && changes.linkMeteorCaptureReportDismissed?.newValue) {
    ui.dismissedContextReportKey = changes.linkMeteorCaptureReportDismissed.newValue;
    if (ui.displayedReportKey === ui.dismissedContextReportKey) $('capture-report').hidden = true;
  }
}

// A capture started from the context menu or shortcut, or an activation error, is kept in
// session storage until a view shows it.
export async function restoreSessionReport() {
  try {
    const stored = await chrome.storage.session.get(['linkMeteorActivationError', 'linkMeteorCaptureReport', 'linkMeteorCaptureReportDismissed']);
    ui.dismissedContextReportKey = stored.linkMeteorCaptureReportDismissed || '';
    if (ui.displayedReportKey === ui.dismissedContextReportKey && ui.displayedReportKey) $('capture-report').hidden = true;
    showContextReport(stored.linkMeteorCaptureReport);
    if (stored.linkMeteorActivationError) {
      show(`Link Meteor could not start the shortcut or context-menu action: ${stored.linkMeteorActivationError}`, 'error');
      try { await chrome.storage.session.remove('linkMeteorActivationError'); } catch { /* display remains actionable */ }
    }
  } catch (error) { fail(error); }
}

export function watchTabs() {
  chrome.tabs.onActivated.addListener(scheduleInventoryRefresh);
  chrome.tabs.onUpdated.addListener(scheduleInventoryRefresh);
  chrome.tabs.onRemoved.addListener(scheduleInventoryRefresh);
  chrome.windows.onFocusChanged.addListener(scheduleInventoryRefresh);
  chrome.permissions?.onAdded?.addListener(() => { ui.originAccess.clear(); renderInventory(); });
  chrome.permissions?.onRemoved?.addListener(() => { ui.originAccess.clear(); renderInventory(); });
  window.addEventListener('focus', scheduleInventoryRefresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleInventoryRefresh(); });
}
