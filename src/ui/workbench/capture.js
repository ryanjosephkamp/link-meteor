// Capture: scope and tab inventory, running a capture, and the capture report. Also what to capture
// (0.4.0): the links in the pages, or the tabs themselves as links (capture.tabs).
import { $, node, icon, button, count, plural, safeUrl, capturableUrl, originOf, hostOf } from './helpers.js';
import { ui, request, action, mutate, show, fail, currentCollection } from './state.js';
import { render, setView } from './rendering.js';
import { renderLinks } from './review.js';
import { renderSite } from './settings.js';
import { ALL_SITES, grants, pageAccessPlan } from './access.js';
import { bindRuns, renderFurther, runFurther, runReport, reportScroll } from './runs.js';

let inventoryTimer, inventoryRequestSequence = 0;
// Whether the current page's tab can be read right now (a toolbar click, a site grant or all-sites
// access): {tabId, url, ok}. Checked when the tab preview refreshes, so a click can decide at once
// whether Chrome must be asked for the site.
let pageAccess = null;
const OPEN_INTENT_KEY = 'linkMeteorOpenIntent';
const SCOPES = ['current', 'selected', 'window', 'all'];
// What to capture: 'links' (the links in the pages) or 'tabs' (the tabs themselves). Like the scope,
// the choice lasts while this view is open.
let captureWhat = 'links';

/* Capture scope ---------------------------------------------------------------- */
export function scopeTabs() {
  const tabs = ui.inventory?.tabs || [];
  return ui.scope === 'selected' ? tabs.filter((tab) => ui.selectedTabs.has(tab.id)) : ui.scope === 'window' ? tabs.filter((tab) => tab.windowId === ui.inventory.currentWindowId) : tabs;
}

export function renderCaptureButton() {
  const label = $('capture-label'), tabs = captureWhat === 'tabs';
  if (ui.busy) { label.textContent = tabs ? 'Saving…' : 'Capturing…'; $('capture').setAttribute('aria-busy', 'true'); return; }
  $('capture').removeAttribute('aria-busy');
  if (ui.scope === 'current') { label.textContent = tabs ? 'Save this tab as a link' : 'Capture this page'; return; }
  if (!ui.inventory) { label.textContent = tabs ? 'Save tabs as links' : 'Capture tabs'; return; }
  if (tabs) {
    // Tabs known not to be web pages are left out of the count; the preview says how many.
    const n = scopeTabs().filter((tab) => !tab.url || safeUrl(tab.url)).length;
    label.textContent = ui.scope === 'selected' && !n ? 'Save selected tabs as links' : n === 1 ? 'Save 1 tab as a link' : `Save ${plural(n, 'tab')} as links`;
    return;
  }
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
  renderFurther(captureWhat);
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
  if (captureWhat === 'tabs') previewTabs(chosen, target);
  else if (ui.scope === 'current') {
    if (!target) preview(['Open a webpage, then open Link Meteor from it to capture that page.'], true, 'i-alert');
    else if (!target.url) preview(['The current tab was found, but Chrome hides its address and contents from Link Meteor. Click the Link Meteor toolbar icon while on that page, or allow all sites under Site access.']);
    else if (!capturableUrl(target.url)) preview([`This is a browser page (${target.url}). Chrome does not allow capturing it; choose an ordinary webpage.`], true, 'i-ban');
    else {
      const plan = currentPagePlan();
      preview([node('strong', '', target.title || target.url), ` · ${hostOf(target.url)}`, plan.ask ? '. Chrome will ask to allow Link Meteor on this site when you capture.' : ''], false, 'i-page');
    }
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
        if (captureWhat === 'tabs' ? tab.url && !safeUrl(tab.url) : tab.url && !capturableUrl(tab.url)) meta.append(node('span', 'flag', captureWhat === 'tabs' ? 'Can’t save · ' : 'Can’t capture · '));
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

// The tabs themselves: what each tab becomes, and which tabs can't be saved. Saving needs no site
// access, only the tabs' titles and addresses.
function previewTabs(chosen, target) {
  if (ui.scope === 'current') {
    if (!target) preview(['Open a webpage, then open Link Meteor from it to save that tab.'], true, 'i-alert');
    else if (!target.url) preview(['The current tab was found, but Chrome hides its address from Link Meteor. Click the Link Meteor toolbar icon while on that page, then save it.'], true, 'i-alert');
    else if (!safeUrl(target.url)) preview([`This is a browser page (${target.url}). Only web pages can be saved as links.`], true, 'i-ban');
    else preview([node('strong', '', target.title || target.url), ` · ${hostOf(target.url)}. Saves the tab’s title and address as one link.`], false, 'i-page');
    return;
  }
  if (!chosen.length) { preview([ui.scope === 'selected' ? 'Choose the tabs to save below.' : 'No tabs are open in this scope.'], ui.scope !== 'selected'); return; }
  const web = chosen.filter((tab) => safeUrl(tab.url)).length, unknown = chosen.filter((tab) => !tab.url).length, other = chosen.length - web - unknown;
  const parts = [node('strong', '', plural(chosen.length, 'tab')), ` in ${plural(new Set(chosen.map((tab) => tab.windowId)).size, 'window')} · ${plural(web, 'webpage')}`];
  if (other) parts.push(` · ${count(other)} can’t be saved (not web pages)`);
  if (unknown) parts.push(` · ${count(unknown)} unknown`);
  parts.push('. Each tab becomes one link: its title and address, as the tab shows them.');
  preview(parts, false, 'i-tabs');
}

function chooseWhat(value) {
  captureWhat = value === 'tabs' ? 'tabs' : 'links';
  const radio = document.querySelector(`input[name="capture-what"][value="${captureWhat}"]`);
  if (radio) radio.checked = true;
  $('capture').closest('.capture').dataset.what = captureWhat;
  renderInventory();
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
  probePageAccess(target);
  return inventory;
}

// Checks whether the current page can be read now, without reading anything from it. Only needed
// with the tabs permission (see pageAccessPlan). A readable page stays readable until it navigates
// or a grant is removed, which clears the check.
async function probePageAccess(target) {
  if (!target?.url || !capturableUrl(target.url) || !chrome.scripting?.executeScript || (grants.known && !grants.tabs)) return;
  if (pageAccess?.ok && pageAccess.tabId === target.id && pageAccess.url === target.url) return;
  const check = { tabId: target.id, url: target.url };
  let ok = false;
  try { await chrome.scripting.executeScript({ target: { tabId: target.id }, func: () => true }); ok = true; } catch { /* not readable */ }
  pageAccess = { ...check, ok };
  const current = ui.inventory?.tabs.find((tab) => tab.id === ui.inventory.targetTabId);
  if (ui.scope === 'current' && current?.id === check.tabId) renderInventory();
}

// Capture this page: whether the click must first ask Chrome for the tab's site.
export function currentPagePlan() {
  const target = ui.inventory?.tabs.find((tab) => tab.id === ui.inventory.targetTabId);
  const origin = originOf(target?.url || '');
  return { ...pageAccessPlan({ target, origin, probe: pageAccess, allSites: grants.allSites, originGranted: ui.originAccess.get(origin) === true, tabsGranted: !grants.known || grants.tabs }), origin, tabId: target?.id };
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
  const previous = box.querySelector('.report-actions:not(.report-left-out)');
  const hadFocus = previous?.contains(document.activeElement);
  previous?.remove();
  const report = ui.displayedReport;
  if (!(report?.capturedCount || report?.leftOutIncluded) || !currentCollection()?.links.some((link) => link.batchId === report.batchId)) return;
  const actions = node('div', 'report-actions');
  const only = node('button', 'link-btn', ui.batchFilter === report.batchId ? 'Show all links' : 'Show only these links'); only.type = 'button';
  only.addEventListener('click', () => {
    ui.batchFilter = ui.batchFilter === report.batchId ? '' : report.batchId;
    ui.page = 0; renderLinks();
  });
  actions.append(only); box.append(actions);
  if (hadFocus) only.focus({ preventScroll: true });
}

// Where Chrome hides a page from Link Meteor, there is no single site to ask for. The denied result
// then offers the welcome card's request instead: all sites, asked in this click, then the capture
// runs again. Declining changes nothing.
async function allowAllSites() {
  let granted = false, problem = '';
  try { granted = await chrome.permissions.request({ origins: ALL_SITES }); }
  catch (error) { problem = error.message || String(error); }
  if (!granted) {
    show(problem ? `Chrome could not ask for access to all sites (${problem}). Click the Link Meteor toolbar icon while on the page to capture it once.` : 'Chrome’s request for access to all sites was declined, so nothing changed. Click the Link Meteor toolbar icon while on the page to capture it once.', 'error');
    return;
  }
  grants.allSites = true;
  ui.state = await request({ type: 'hold.scope', scope: 'all' });
  if (!ui.state.settings.welcomeSeen) await mutate({ type: 'settings.update', patch: { welcomeSeen: true } });
  render();
  show('Link Meteor now works on all sites. Capturing this page again.');
  await runCapture();
}

// Content links only (0.4.0): how many navigation links the capture left out, with Include them,
// which adds them to the collection the capture went to (capture.includeLeftOut). Also how many links
// Skip saved left out.
function reportLeftOut(box, report) {
  const results = report.results || [];
  const total = (key) => results.reduce((sum, result) => sum + (Number(result[key]) || 0), 0);
  const leftOut = total('leftOut'), skipped = total('skipped');
  if (!leftOut && !skipped) return;
  const line = node('p', 'report-actions report-left-out');
  const text = node('span', '');
  const say = (parts) => { text.textContent = parts.filter(Boolean).join(' '); };
  const skippedText = skipped ? `Skipped ${plural(skipped, 'link')} already saved.` : '';
  line.append(text);
  if (!leftOut) say([skippedText]);
  else if (report.leftOutIncluded !== undefined) say([`Included ${plural(report.leftOutIncluded, 'navigation link')}.`, skippedText]);
  else {
    say([`Left out ${plural(leftOut, 'navigation link')}.`, skippedText]);
    const include = button('Include them', 'link-btn');
    include.addEventListener('click', () => action(async () => {
      include.disabled = true;
      try {
        const result = await request({ type: 'capture.includeLeftOut', batchId: report.batchId });
        report.leftOutIncluded = result.count;
        ui.flashBatch = report.batchId; ui.flashStart = Date.now();
        ui.state = result.state; render();
        include.remove();
        say([`Included ${plural(result.count, 'navigation link')}.`, skippedText]);
        const parts = [`Added ${plural(result.count, 'navigation link')} to “${result.name}”.`];
        if (result.skipped) parts.push(`${plural(result.skipped, 'link')} already saved ${result.skipped === 1 ? 'was' : 'were'} skipped.`);
        if (result.total > result.count + result.skipped) parts.push(`Link Meteor keeps at most ${count(result.count + result.skipped)} left-out links per capture; capture again with navigation links included for the rest.`);
        show(parts.join(' '));
        syncReportAction();
        // The Include button is gone; focus moves to the report's own action.
        box.querySelector('.report-actions:not(.report-left-out) button')?.focus({ preventScroll: true });
      } catch (error) { include.disabled = false; throw error; }
    }));
    line.append(' ', include);
  }
  box.append(line);
}

export function captureReport(report, { source = 'workbench', key = '', createdAt = '', reasons = new Map(), offerAllSites = new Set() } = {}) {
  if (report.kind === 'run') { runReport(report, { key, createdAt }); return; }
  const box = $('capture-report'); box.replaceChildren(); box.hidden = false;
  ui.displayedReportKey = key;
  ui.displayedReport = report;
  const results = report.results || [];
  const tabs = report.kind === 'tabs';
  const succeeded = results.filter((result) => result.status === 'success').length;
  const head = node('div', 'report-head');
  const title = node('h3', '', `${source === 'context' ? 'Previous capture · ' : ''}${tabs ? tabsHeadline(report) : `${plural(report.capturedCount, 'link')} captured`}`);
  const from = results.length === 1 ? `from ${results[0].title || results[0].url || `tab ${results[0].tabId}`}` : '';
  const sub = tabs ? tabsSkipped(report).join('; ') || from || `from ${plural(results.length, 'tab')}` : from || `${count(succeeded)} of ${plural(results.length, 'page')} captured`;
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
  if (tabs) {
    const cited = tabsCitations(report);
    if (cited) box.append(node('p', 'help report-citations', cited));
    reportTabs(box, results); syncReportAction(); return;
  }
  const list = node('ul', 'report-list');
  const quiet = results.length === 1 && results[0].status === 'success' && results[0].count && !results[0].warning;
  for (const result of quiet ? [] : results) {
    const kind = REPORT_STATUS[result.status] || REPORT_STATUS.error;
    const empty = result.status === 'success' && !result.count;
    const item = node('li', `report-item ${empty ? 'empty' : result.status}`);
    item.append(icon(empty ? 'i-minus' : kind.icon), node('span', 'page', result.title || result.url || `Tab ${result.tabId}`), node('span', 'status', kind.label(result)));
    if (empty && !result.warning) item.append(node('span', 'detail', 'The page loaded, but it has no links Link Meteor can read.'));
    if (result.status === 'denied') item.append(node('span', 'detail', reasons.get(result.tabId) || 'Link Meteor does not have access to this site. Capture it again to be asked, or click the Link Meteor toolbar icon while on the page. If Chrome’s site access for Link Meteor (in the Extensions menu, the puzzle-piece icon) is set to “On click” or blocks this site, change it there.'));
    // Per page only when there are several; the report's own line gives the totals.
    if (result.leftOut && results.length > 1) item.append(node('span', 'detail', `Left out ${plural(result.leftOut, 'navigation link')}.`));
    if (result.skipped && results.length > 1) item.append(node('span', 'detail', `Skipped ${plural(result.skipped, 'link')} already saved.`));
    if (result.warning) item.append(node('span', `detail${result.status === 'success' ? ' warn' : ''}`, result.warning));
    if (result.error) item.append(node('span', 'detail', result.status === 'denied' ? `Chrome: ${result.error}` : result.error));
    if (result.status === 'denied' && offerAllSites.has(result.tabId)) {
      const allow = button('Allow on all sites', 'btn small report-allow');
      allow.addEventListener('click', () => action(allowAllSites));
      item.append(allow);
    }
    list.append(item);
  }
  if (!results.length) list.append(node('li', 'report-item error', 'No tab results were returned.'));
  if (list.childNodes.length) box.append(list);
  reportScroll(box, report);
  reportLeftOut(box, report);
  syncReportAction();
}

/* Saving the tabs themselves (0.4.0) ---------------------------------------------------- */
function tabsHeadline(report) {
  const saved = report.saved ?? report.capturedCount ?? 0;
  return !saved ? 'No tabs were saved' : saved === 1 ? 'Saved 1 tab as a link' : `Saved ${plural(saved, 'tab')} as links`;
}
// Why tabs were skipped: "2 skipped: not web pages". The background's notices say it the same way.
function tabsSkipped(report) {
  const results = report.results || [], repeated = report.repeated || 0, already = (report.skipped || 0) - repeated;
  const hidden = results.filter((result) => result.status === 'denied').length, closed = results.filter((result) => result.status === 'error').length;
  return [
    report.unsupported && `${count(report.unsupported)} skipped: ${report.unsupported === 1 ? 'not a web page' : 'not web pages'}`,
    already && `${count(already)} skipped: already saved`,
    repeated && `${count(repeated)} skipped: ${repeated === 1 ? 'a repeated address' : 'repeated addresses'}`,
    hidden && `${count(hidden)} skipped: ${hidden === 1 ? 'address' : 'addresses'} hidden by Chrome`,
    closed && `${count(closed)} skipped: closed before saving`,
  ].filter(Boolean);
}
// How many tabs' citation tags were read (0.5.0): "Read citation details from 12 of 45 tabs; the
// others need site access." The background's notices say it the same way.
function tabsCitations(report) {
  const { tabs = 0, read = 0, needAccess = 0 } = report.citations || {};
  if (!tabs) return '';
  if (read === tabs) return tabs === 1 ? 'Read the tab’s citation details.' : `Read citation details from all ${count(tabs)} tabs.`;
  const others = tabs - read, silent = others - needAccess;
  const why = (many) => (!silent ? (many ? 'need site access' : 'needs site access') : !needAccess ? 'didn’t answer' : 'need site access or didn’t answer');
  if (!read) return `Read no citation details; ${tabs === 1 ? 'the tab' : 'the tabs'} ${why(tabs > 1)}.`;
  return `Read citation details from ${count(read)} of ${count(tabs)} tabs; ${others === 1 ? 'the other' : 'the others'} ${why(others > 1)}.`;
}
// "Saved 45 tabs as links; 2 skipped: not web pages. Read citation details from 12 of 43 tabs; the others need site access."
export function tabsSummary(report) { return [`${[tabsHeadline(report), ...tabsSkipped(report)].join('; ')}.`, tabsCitations(report)].filter(Boolean).join(' '); }

// The report lists only the tabs that weren't saved, each with its reason.
const TAB_STATUS = { unsupported: ['i-ban', 'Not a web page'], denied: ['i-ban', 'Address hidden'], error: ['i-alert', 'Not saved'], success: ['i-minus', 'Skipped'] };
function reportTabs(box, results) {
  const list = node('ul', 'report-list');
  for (const result of results.filter((item) => !item.count)) {
    const [iconName, label] = TAB_STATUS[result.status] || TAB_STATUS.error;
    const item = node('li', `report-item ${result.status === 'success' ? 'empty' : result.status}`);
    item.append(icon(iconName), node('span', 'page', result.title || result.url || `Tab ${result.tabId}`), node('span', 'status', label));
    const detail = result.warning || result.error;
    if (detail) item.append(node('span', 'detail', detail));
    list.append(item);
  }
  if (list.childNodes.length) box.append(list);
}

// The tabs themselves: one link per tab, from its title and address (capture.tabs). Pick tabs and the
// window scopes need Chrome's tab list; without it, this click asks first, as choosing the scope does.
export async function saveTabsAsLinks() {
  if (ui.busy) return;
  const asking = ui.scope !== 'current' && !grants.tabs ? chrome.permissions.request({ permissions: ['tabs'] }) : null;
  ui.busy = true; $('capture').disabled = true; renderCaptureButton();
  try {
    if (asking) {
      let allowed = false;
      try { allowed = await asking; } catch { /* treated as declined */ }
      if (!allowed) throw new Error('Tab access was declined, so Link Meteor can’t see your open tabs’ titles and addresses, and nothing was saved. Save again to be asked again, or choose This page.');
      await loadInventory();
    }
    let tabIds = [];
    if (ui.scope !== 'current') {
      if (!ui.inventory) throw new Error('Tab preview is unavailable. Choose the scope again to refresh it.');
      tabIds = scopeTabs().map((tab) => tab.id);
      if (!tabIds.length) throw new Error('Select at least one tab before saving.');
    }
    const { state, report } = await request({ type: 'capture.tabs', scope: ui.scope, tabIds });
    ui.flashBatch = report.batchId; ui.flashStart = Date.now();
    ui.state = state; render(); captureReport(report);
    show(tabsSummary(report));
  } finally { ui.busy = false; $('capture').disabled = false; renderCaptureButton(); }
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
  // This page on a site Link Meteor cannot read yet: ask Chrome for that site in this same click,
  // before anything is awaited, then capture either way so a decline is reported as denied.
  const plan = ui.scope === 'current' ? currentPagePlan() : { ask: false };
  const asking = plan.ask ? chrome.permissions.request({ origins: [`${plan.origin}/*`] }) : null;
  ui.busy = true; $('capture').disabled = true; renderCaptureButton();
  try {
    let tabIds = [];
    const reasons = new Map(), offerAllSites = new Set();
    if (asking) {
      let granted = false, problem = null;
      try { granted = await asking; } catch (error) { problem = error; }
      ui.originAccess.set(plan.origin, granted);
      if (!granted) reasons.set(plan.tabId, problem ? `Chrome could not ask for access to ${plan.origin}: ${problem.message}` : `You declined Chrome’s request for access to ${plan.origin}, so Link Meteor could not read this page. Capture it again to be asked again.`);
    } else if (ui.scope === 'current' && plan.reason === 'hidden') {
      reasons.set(ui.inventory?.targetTabId, 'Chrome hides this tab’s address and contents from Link Meteor, so it cannot ask for this one site. Allow Link Meteor on all sites to capture it now, or click the Link Meteor toolbar icon while on the page, then capture again.');
      offerAllSites.add(ui.inventory?.targetTabId);
    }
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
    // Scroll to the end first, and Follow Next (runs.js).
    if (await runFurther({ reasons, offerAllSites })) return;
    const { state, report } = await request({ type: 'capture.run', tabIds });
    ui.flashBatch = report.batchId; ui.flashStart = Date.now();
    ui.state = state; render(); captureReport(report, { reasons, offerAllSites });
    clearTimeout(inventoryTimer);
    let previewError;
    try { await loadInventory(); } catch (error) { previewError = error; }
    if (previewError) show(`Capture finished, but the current-site preview could not refresh: ${previewError.message}`, 'error');
    else show(`Capture finished: ${plural(report.capturedCount, 'link')} from ${plural(report.results.filter((result) => result.status === 'success').length, 'page')}. Details are in the capture report.`);
  } finally { ui.busy = false; $('capture').disabled = false; renderCaptureButton(); }
}

export function bindCapture() {
  for (const radio of document.querySelectorAll('input[name="scope"]')) radio.addEventListener('change', () => action(() => chooseScope(radio.value)));
  for (const radio of document.querySelectorAll('input[name="capture-what"]')) radio.addEventListener('change', () => { if (radio.checked) chooseWhat(radio.value); });
  $('tabs-all').addEventListener('click', () => { for (const tab of ui.inventory?.tabs || []) ui.selectedTabs.add(tab.id); renderInventory(); });
  $('tabs-none').addEventListener('click', () => { ui.selectedTabs.clear(); renderInventory(); });
  $('capture').addEventListener('click', () => action(captureWhat === 'tabs' ? saveTabsAsLinks : runCapture));
  bindRuns();
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
  await applyOpenIntent();
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

// ui.open with a view or batch (from the capture card): applied once by the view that opens, then
// removed. It shows only that capture, in its collection, and the export view at compact widths.
// From the toolbar menu's Save all tabs in this window without tab access, it holds {what: 'tabs',
// scope}: that choice is made ready, with the reason and the button to save.
async function applyOpenIntent() {
  let intent;
  try {
    intent = (await chrome.storage.session.get(OPEN_INTENT_KEY))[OPEN_INTENT_KEY];
    if (!intent) return;
    await chrome.storage.session.remove(OPEN_INTENT_KEY);
  } catch { return; }
  if (Date.now() - Date.parse(intent.createdAt) > 120000) return;
  try {
    if (intent.batchId) {
      const home = ui.state?.collections.find((collection) => collection.links.some((link) => link.batchId === intent.batchId));
      if (home && home.id !== ui.state.activeCollectionId) await mutate({ type: 'collection.activate', id: home.id });
      if (home) { ui.batchFilter = intent.batchId; ui.page = 0; renderLinks(); }
    }
    if (intent.view === 'export' && !matchMedia('(min-width: 900px)').matches) setView('export');
    if (intent.what === 'tabs') await readyTabs(SCOPES.includes(intent.scope) ? intent.scope : 'window');
  } catch (error) { fail(error); }
}

async function readyTabs(scope) {
  ui.scope = scope;
  const radio = document.querySelector(`input[name="scope"][value="${scope}"]`);
  if (radio) radio.checked = true;
  chooseWhat('tabs');
  await loadInventory();
  show('Saving all the tabs in a window needs Chrome to show Link Meteor your open tabs’ titles and addresses. Chrome asks once, when you save.', 'notice', { actionLabel: $('capture-label').textContent, onAction: saveTabsAsLinks });
  $('capture').focus();
}

export function watchTabs() {
  chrome.tabs.onActivated.addListener(scheduleInventoryRefresh);
  chrome.tabs.onUpdated.addListener(scheduleInventoryRefresh);
  chrome.tabs.onRemoved.addListener(scheduleInventoryRefresh);
  chrome.windows.onFocusChanged.addListener(scheduleInventoryRefresh);
  chrome.permissions?.onAdded?.addListener(() => { ui.originAccess.clear(); pageAccess = null; renderInventory(); scheduleInventoryRefresh(); });
  chrome.permissions?.onRemoved?.addListener(() => { ui.originAccess.clear(); pageAccess = null; renderInventory(); scheduleInventoryRefresh(); });
  window.addEventListener('focus', scheduleInventoryRefresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleInventoryRefresh(); });
}
