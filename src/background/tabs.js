// Save tabs as links (0.4.0): one link per tab, made only from what the browser already shows for
// it, its title and address. Nothing is fetched and no page script runs. The contract is in
// docs/CONTRACTS.md ("Save tabs as links").
import {appendLinks} from './card.js';

const REPORT_KEY = 'linkMeteorCaptureReport';
const SCOPES = ['current', 'selected', 'window', 'all'];
// One save holds at most as many tabs as a capture holds links.
const MAX_TABS = 20000;
const collapse = value => String(value || '').replace(/\s+/gu, ' ').trim();
const webPage = url => { try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; } };
const n = value => Number(value).toLocaleString('en-US');

// The tab IDs of the focused normal window, or of every normal window.
async function windowTabs(focusedOnly) {
  const windows = (await chrome.windows.getAll({populate: true, windowTypes: ['normal']})).filter(w => !w.incognito);
  const chosen = focusedOnly ? [windows.find(w => w.focused) || windows[0]].filter(Boolean) : windows;
  return chosen.flatMap(w => (w.tabs || []).map(tab => tab.id));
}

// Saves the tabs with these IDs as links, in one batch, to a collection (default: the active one).
// Tabs that aren't HTTP(S) pages, and a repeated address within the save, are skipped and counted;
// with skipSaved, so are addresses the collection already holds. The report is kept like a
// capture's, so the workbench shows it. Returns {state, report, collectionId, name}.
export async function saveTabs(tabIds, {collectionId} = {}) {
  const batchId = crypto.randomUUID(), capturedAt = new Date().toISOString();
  const results = [], links = [], linkIds = new Map(), addresses = new Set();
  let repeated = 0;
  for (const tabId of tabIds) {
    let tab;
    try { tab = await chrome.tabs.get(tabId); }
    catch { results.push({tabId, title: 'Closed tab', url: '', status: 'error', count: 0, skipped: 0, warning: '', error: 'The tab was closed before it could be saved.'}); continue; }
    const result = {tabId, title: tab.title || '', url: tab.url || '', status: 'success', count: 0, skipped: 0, warning: '', error: ''};
    results.push(result);
    if (tab.incognito || (tab.url && !webPage(tab.url))) Object.assign(result, {status: 'unsupported', warning: 'Not a web page. Only HTTP and HTTPS pages can be saved as links.'});
    else if (!tab.url) Object.assign(result, {status: 'denied', error: 'Chrome hides this tab’s address from Link Meteor.'});
    else if (addresses.has(tab.url)) { Object.assign(result, {skipped: 1, warning: 'The same address as another tab in this save.'}); repeated++; }
    else {
      addresses.add(tab.url);
      const link = {id: crypto.randomUUID(), anchorText: collapse(tab.title), accessibleLabel: '', url: tab.url, originalHref: tab.url,
        sourceUrl: tab.url, sourceTitle: tab.title || '', frameUrl: '', capturedAt, batchId, notes: '', tags: []};
      links.push(link); linkIds.set(result, link.id);
    }
  }
  const added = await appendLinks(links, {collectionId});
  const home = added.state.collections.find(c => c.id === added.collectionId);
  const kept = new Set((home?.links || []).filter(link => link.batchId === batchId).map(link => link.id));
  for (const [result, id] of linkIds) {
    if (kept.has(id)) result.count = 1;
    else Object.assign(result, {skipped: 1, warning: 'Already saved in this collection.'});
  }
  const report = {kind: 'tabs', batchId, results, capturedCount: added.count, saved: added.count, skipped: results.reduce((sum, result) => sum + result.skipped, 0),
    repeated, unsupported: results.filter(result => result.status === 'unsupported').length};
  await chrome.storage.session.set({[REPORT_KEY]: {report, createdAt: new Date().toISOString()}}).catch(() => {});
  return {state: added.state, report, collectionId: added.collectionId, name: added.name};
}

// Why tabs were skipped, as reports and notices say it: "2 skipped: not web pages".
export function skippedParts(report) {
  const results = report.results || [], repeated = report.repeated || 0, already = (report.skipped || 0) - repeated;
  const hidden = results.filter(result => result.status === 'denied').length, closed = results.filter(result => result.status === 'error').length;
  return [
    report.unsupported && `${n(report.unsupported)} skipped: ${report.unsupported === 1 ? 'not a web page' : 'not web pages'}`,
    already && `${n(already)} skipped: already saved`,
    repeated && `${n(repeated)} skipped: ${repeated === 1 ? 'a repeated address' : 'repeated addresses'}`,
    hidden && `${n(hidden)} skipped: ${hidden === 1 ? 'address' : 'addresses'} hidden by Chrome`,
    closed && `${n(closed)} skipped: closed before saving`,
  ].filter(Boolean);
}

// The notice after saving tabs from a menu: "Saved 12 tabs as links in “Thesis sources”; 2 skipped:
// not web pages." One tab gets its own wording.
export function tabsSummary(report, {name = '', single = false} = {}) {
  const where = name ? ` in “${name}”` : '';
  if (single) {
    const [result] = report.results || [];
    if (report.saved) return `Saved this tab as a link${where}.`;
    if (result?.status === 'unsupported') return 'This tab isn’t a web page, so it can’t be saved as a link.';
    if (result?.status === 'denied') return 'Chrome hides this tab’s address from Link Meteor, so it wasn’t saved.';
    if (result?.skipped) return `This tab is already saved${where}, so nothing was added.`;
    return 'This tab was closed before it could be saved.';
  }
  const saved = report.saved || 0;
  return `${[saved === 1 ? `Saved 1 tab as a link${where}` : `Saved ${n(saved)} tabs as links${where}`, ...skippedParts(report)].join('; ')}.`;
}

// capture.tabs {scope, tabIds?, collectionId?} from the workbench, which lists the tabs of Pick
// tabs, This window and All windows itself. `target` finds This page's tab, as capture.run does.
export async function tabsMessage(message, {target}) {
  const scope = message.scope ?? 'current';
  if (!SCOPES.includes(scope)) throw new Error("Save tabs from 'current', 'selected', 'window' or 'all'.");
  if (message.collectionId !== undefined && (typeof message.collectionId !== 'string' || !message.collectionId)) throw new Error('Choose a collection for the saved tabs.');
  const given = message.tabIds ?? [];
  if (!Array.isArray(given) || given.length > MAX_TABS || given.some(id => !Number.isInteger(id))) throw new Error(`Choose at most ${n(MAX_TABS)} tabs to save at a time.`);
  let ids = [...new Set(given)];
  if (!ids.length) {
    if (scope === 'selected') throw new Error('Select at least one tab to save.');
    ids = scope === 'current' ? [(await target()).id] : await windowTabs(scope === 'window');
  }
  const {state, report} = await saveTabs(ids, {collectionId: message.collectionId});
  return {state, report};
}
