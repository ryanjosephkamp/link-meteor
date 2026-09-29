// Save tabs as links (0.4.0): one link per tab, made only from what the browser already shows for
// it, its title and address. Nothing is fetched. 0.5.0: where Link Meteor already has access to a
// tab's site (all sites, or that site), a tiny function reads the page's own citation tags; it never
// asks for access to do so. The contract is in docs/CONTRACTS.md ("Save tabs as links").
import {appendLinks} from './card.js';
import {readCitationTags, citationPages} from './citations.js';

const REPORT_KEY = 'linkMeteorCaptureReport';
const SCOPES = ['current', 'selected', 'window', 'all'];
// One save holds at most as many tabs as a capture holds links.
const MAX_TABS = 20000;
const collapse = value => String(value || '').replace(/\s+/gu, ' ').trim();
const webPage = url => { try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; } };
const n = value => Number(value).toLocaleString('en-US');
// Citation tags are read from this many tabs at a time, each given this long to answer.
const READERS = 8, READ_MS = 3000;

// The tab IDs of the focused normal window, or of every normal window.
async function windowTabs(focusedOnly) {
  const windows = (await chrome.windows.getAll({populate: true, windowTypes: ['normal']})).filter(w => !w.incognito);
  const chosen = focusedOnly ? [windows.find(w => w.focused) || windows[0]].filter(Boolean) : windows;
  return chosen.flatMap(w => (w.tabs || []).map(tab => tab.id));
}

// Whether Link Meteor already has access to pages of this address's site: all sites, or that site.
function siteAccess(url, known) {
  const origin = new URL(url).origin;
  if (!known.has(origin)) known.set(origin, Promise.resolve().then(() => chrome.permissions.contains({origins: [`${origin}/*`]})).catch(() => false));
  return known.get(origin);
}
function within(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, fail) => { timer = setTimeout(() => fail(new Error('No answer')), ms); })]).finally(() => clearTimeout(timer));
}

// Reads the tabs' own citation tags where Link Meteor already has access to their sites, never
// asking for more. A tab that doesn't answer (discarded, busy or closed) is simply not read.
// Returns {pages, counts: {tabs, read, found, needAccess}}.
async function readCitations(tabs) {
  const pages = {}, known = new Map(), queue = [...tabs], readAt = new Date().toISOString();
  const counts = {tabs: tabs.length, read: 0, found: 0, needAccess: 0};
  async function reader() {
    for (let tab = queue.shift(); tab; tab = queue.shift()) {
      if (!(await siteAccess(tab.url, known))) { counts.needAccess++; continue; }
      if (tab.discarded) continue;
      try {
        const [answer] = await within(chrome.scripting.executeScript({target: {tabId: tab.id}, func: readCitationTags, injectImmediately: true}), READ_MS);
        counts.read++;
        const entry = citationPages(answer?.result, tab.url, readAt);
        if (Object.keys(entry).length) { Object.assign(pages, entry); counts.found++; }
      } catch { /* not read */ }
    }
  }
  await Promise.all(Array.from({length: Math.min(READERS, tabs.length)}, reader));
  return {pages, counts};
}

// Saves the tabs with these IDs as links, in one batch, to a collection (default: the active one).
// Tabs that aren't HTTP(S) pages, and a repeated address within the save, are skipped and counted;
// with skipSaved, so are addresses the collection already holds. The report is kept like a
// capture's, so the workbench shows it, with how many tabs' citation tags were read (citations).
// Returns {state, report, collectionId, name}.
export async function saveTabs(tabIds, {collectionId} = {}) {
  const batchId = crypto.randomUUID(), capturedAt = new Date().toISOString();
  const results = [], links = [], linkIds = new Map(), addresses = new Set(), readable = [];
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
      links.push(link); linkIds.set(result, link.id); readable.push(tab);
    }
  }
  // Each tab's citation is kept under its own address, so each saved link has its own citation.
  const {pages, counts} = await readCitations(readable);
  const added = await appendLinks(links, {collectionId, pages});
  const home = added.state.collections.find(c => c.id === added.collectionId);
  const kept = new Set((home?.links || []).filter(link => link.batchId === batchId).map(link => link.id));
  for (const [result, id] of linkIds) {
    if (kept.has(id)) result.count = 1;
    else Object.assign(result, {skipped: 1, warning: 'Already saved in this collection.'});
  }
  const report = {kind: 'tabs', batchId, results, capturedCount: added.count, saved: added.count, skipped: results.reduce((sum, result) => sum + result.skipped, 0),
    repeated, unsupported: results.filter(result => result.status === 'unsupported').length, citations: counts};
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

// How many tabs' citation tags were read (0.5.0), as reports and notices say it: "Read citation
// details from 12 of 45 tabs; the others need site access." Empty when no tab was a web page.
export function citationsPart(report) {
  const {tabs = 0, read = 0, needAccess = 0} = report.citations || {};
  if (!tabs) return '';
  if (read === tabs) return tabs === 1 ? 'Read the tab’s citation details.' : `Read citation details from all ${n(tabs)} tabs.`;
  const others = tabs - read, silent = others - needAccess;
  const why = (many) => !silent ? (many ? 'need site access' : 'needs site access') : !needAccess ? 'didn’t answer' : 'need site access or didn’t answer';
  if (!read) return `Read no citation details; ${tabs === 1 ? 'the tab' : 'the tabs'} ${why(tabs > 1)}.`;
  return `Read citation details from ${n(read)} of ${n(tabs)} tabs; ${others === 1 ? 'the other' : 'the others'} ${why(others > 1)}.`;
}

// The notice after saving tabs from a menu: "Saved 12 tabs as links in “Thesis sources”; 2 skipped:
// not web pages. Read citation details from 12 of 14 tabs; the others need site access." One tab
// gets its own wording, which mentions its citation details only when it had some.
export function tabsSummary(report, {name = '', single = false} = {}) {
  const where = name ? ` in “${name}”` : '';
  if (single) {
    const [result] = report.results || [];
    if (report.saved) return `Saved this tab as a link${where}.${report.citations?.found ? ' Read its citation details.' : ''}`;
    if (result?.status === 'unsupported') return 'This tab isn’t a web page, so it can’t be saved as a link.';
    if (result?.status === 'denied') return 'Chrome hides this tab’s address from Link Meteor, so it wasn’t saved.';
    if (result?.skipped) return `This tab is already saved${where}, so nothing was added.`;
    return 'This tab was closed before it could be saved.';
  }
  const saved = report.saved || 0;
  const head = !saved ? 'No tabs were saved' : saved === 1 ? `Saved 1 tab as a link${where}` : `Saved ${n(saved)} tabs as links${where}`;
  return [`${[head, ...skippedParts(report)].join('; ')}.`, citationsPart(report)].filter(Boolean).join(' ');
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
