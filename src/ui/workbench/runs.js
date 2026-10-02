// Runs (0.6.0): captures that take more than one step. Under Capture this page, Scroll to the end
// first and Follow Next; in the list, Capture their pages… for the selected links or one link.
// A run starts only from a click, shows its counter and Stop here and on the page it is reading,
// and ends with a report and one Undo. The background does the work (background/runs.js); this
// module starts it, shows it, and reads a PDF among selected pages when the background asks.
// The contract is in docs/CONTRACTS.md ("Runs: auto-scroll, Follow Next and selected pages").
import { pageKey, MIN_FOLLOW_PAGES, MAX_FOLLOW_PAGES } from '../../core/model.js';
import { urlFileType } from '../../core/files.js';
import { $, node, icon, button, count, plural, quoted, labelFor, appendTextLink, hostOf } from './helpers.js';
import { ui, request, action, mutate, show, currentCollection } from './state.js';
import { render, onRender, onEscape } from './rendering.js';
import { grants } from './access.js';
import { captureReport, loadInventory, scheduleInventoryRefresh, syncReportAction } from './capture.js';

const MAX_RUN_PAGES = 20, NEW = '__new', MAX_NAME = 120;
// The run in progress, as the background last described it (run.progress, run.status).
let going = null;
// Clicks waiting for their run to end: runId -> resolve.
const waiting = new Map();
// The report on show, so Undo can show it again as undone.
let shown = null;
// Capture their pages…: {ids (null: the selection), collectionId, returnFocus}.
let pending = null;

/* Scroll to the end first, and Follow Next ------------------------------------------------------ */
// The two choices show for This page and the links in it. They last while this view is open; the
// number of pages is saved (followPages).
export function renderFurther(what = 'links') {
  const target = ui.inventory?.tabs?.find((tab) => tab.id === ui.inventory.targetTabId);
  let pdf = false;
  try { pdf = /\.pdf$/i.test(new URL(target?.url || '').pathname); } catch { /* no address to judge */ }
  $('capture-further').hidden = ui.scope !== 'current' || what !== 'links' || pdf;
}
function renderFollowPages() {
  const input = $('follow-pages'), saved = ui.state?.settings?.followPages;
  if (document.activeElement !== input && Number.isInteger(saved)) input.value = String(saved);
}
async function saveFollowPages() {
  const input = $('follow-pages'), value = Number(input.value);
  if (!Number.isInteger(value) || value < MIN_FOLLOW_PAGES || value > MAX_FOLLOW_PAGES) {
    input.value = String(ui.state.settings.followPages);
    throw new Error(`Follow Next reads ${MIN_FOLLOW_PAGES} to ${MAX_FOLLOW_PAGES} pages in one run.`);
  }
  if (value !== ui.state.settings.followPages) await mutate({ type: 'settings.update', patch: { followPages: value } });
}

// Capture this page with either choice on. Returns false when neither is, so the plain capture goes on.
export async function runFurther({ reasons = new Map(), offerAllSites = new Set() } = {}) {
  if (ui.scope !== 'current' || $('capture-further').hidden) return false;
  const scroll = $('further-scroll').checked, next = $('further-next').checked;
  if (!scroll && !next) return false;
  if (next) {
    if (document.activeElement === $('follow-pages')) await saveFollowPages();
    const { runId } = await request({ type: 'run.start', kind: 'next', tabId: ui.inventory?.targetTabId, collectionId: ui.state.activeCollectionId, scroll });
    if (await showStarted(runId)) await ended(runId);
    return true;
  }
  // Scrolling alone is one page: the usual capture and report, with a counter, Stop and Undo.
  const { state, report } = await request({ type: 'capture.run', tabIds: Number.isInteger(ui.inventory?.targetTabId) ? [ui.inventory.targetTabId] : [], scroll: true });
  ui.flashBatch = report.batchId; ui.flashStart = Date.now();
  ui.state = state; render(); captureReport(report, { reasons, offerAllSites });
  try { await loadInventory(); } catch { /* the preview refreshes with the next change */ }
  const scrolled = report.results[0]?.scroll;
  const text = scrolled ? `Capture finished: ${plural(report.capturedCount, 'link')} from this page. ${scrolled.text}` : 'The page couldn’t be captured. Details are in the capture report.';
  if (report.capturedCount && report.collectionId) show(text, 'notice', { actionLabel: 'Undo', onAction: () => undo(report) });
  else show(text);
  return true;
}

// The progress line for a run this view just started, with focus on Stop. False when it is over already.
async function showStarted(runId) {
  const { run } = await request({ type: 'run.status' });
  if (!run || run.runId !== runId || run.state === 'done') return false;
  if (!going || going.runId !== runId) { going = run; renderRun(); }
  $('run-progress').scrollIntoView({ block: 'nearest' });
  $('run-stop').focus({ preventScroll: true });
  return true;
}
// Resolves when the run is over: told by run.progress, and asked now and then in case that was missed.
function ended(runId) {
  return new Promise((done) => {
    const timer = setInterval(() => request({ type: 'run.status' }).then(({ run }) => { if (!run || run.runId !== runId || run.state === 'done') finish(); }, () => {}), 3000);
    const finish = () => { clearInterval(timer); waiting.delete(runId); done(); };
    waiting.set(runId, finish);
  });
}

/* The progress line, and how a run ends ---------------------------------------------------------- */
function renderRun() {
  const on = !!going && going.state !== 'done';
  $('run-progress').hidden = !on;
  // While a run is going, nothing else captures. Only what the run disabled is enabled again.
  for (const id of ['arm', 'further-scroll', 'further-next', 'follow-pages']) {
    const control = $(id);
    if (on && !control.disabled) { control.disabled = true; control.dataset.run = 'held'; }
    else if (!on && control.dataset.run) { control.disabled = false; delete control.dataset.run; }
  }
  $('capture').disabled = on || ui.busy;
  if (!$('pages-panel').hidden) describe();
  if (!on) return;
  const stopping = going.state === 'stopping';
  $('run-title').textContent = stopping ? 'Stopping…' : going.title;
  $('run-text').textContent = `${going.text} so far${going.page && going.kind !== 'scroll' ? ` · now on ${quoted(going.page)}` : ''}`;
  $('run-stop').disabled = stopping;
  $('run-bar').style.width = `${Math.max(0, Math.min(100, Math.round((100 * going.step) / Math.max(1, going.of))))}%`;
}

function onProgress(message) {
  going = message;
  const hadFocus = document.activeElement === $('run-stop');
  renderRun();
  if (message.state !== 'done') return;
  going = null;
  renderRun();
  // Focus goes back to Capture once the click that started the run has let go of it.
  if (hadFocus) setTimeout(() => { if (!$('capture').disabled && (!document.activeElement || document.activeElement === document.body)) $('capture').focus({ preventScroll: true }); }, 60);
  waiting.get(message.runId)?.();
  scheduleInventoryRefresh();
  // Scrolling alone is answered to the view that asked; a run tells every open view how it ended.
  if (message.kind === 'scroll') return;
  const text = [message.summary, message.ended?.text].filter(Boolean).join(' ');
  if (message.count && !message.undone) show(text, 'notice', { actionLabel: 'Undo', onAction: () => undo(message) });
  else show(text);
}

async function stop() {
  if (!going) return;
  $('run-stop').disabled = true;
  await request({ type: 'run.stop', runId: going.runId });
}

// Undo for a run's batch: every link it added, together.
async function undo({ collectionId, batchId }) {
  const result = await request({ type: 'run.undo', collectionId, batchId });
  ui.state = result.state; render();
  show(`Undone: removed ${plural(result.count, 'link')} from “${result.name}”.`);
  if (shown?.report.batchId === batchId) { shown.report.undone = result.count; captureReport(shown.report, shown.options); }
}
function undoButton(report, label) {
  const item = button('Undo', 'link-btn');
  item.setAttribute('aria-label', label);
  item.addEventListener('click', () => action(async () => { item.disabled = true; try { await undo(report); } catch (error) { item.disabled = false; throw error; } }));
  return item;
}

/* The report --------------------------------------------------------------------------------- */
// A run's report: what it added, then each page with what was found, what was added and how it
// ended, then why the run ended.
export function runReport(report, options = {}) {
  const { key = '', createdAt = '' } = options;
  const box = $('capture-report'); box.replaceChildren(); box.hidden = false;
  ui.displayedReportKey = key; ui.displayedReport = report;
  shown = { report, options };
  const head = node('div', 'report-head'), title = node('h3', 'run-head');
  title.append(node('strong', '', report.head || report.summary || 'Run finished'));
  const rest = String(report.summary || '').slice(String(report.head || '').length).trim();
  if (rest) title.append(` ${rest}`);
  if (report.undone !== undefined) title.append(` Undone: removed ${plural(report.undone, 'link')}.`);
  else if (report.capturedCount) title.append(' ', undoButton(report, 'Undo this run: remove the links it added'));
  const time = createdAt ? new Date(createdAt) : null;
  if (time && !Number.isNaN(time.valueOf())) title.append(node('span', 'sub', time.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })));
  const dismiss = node('button', 'btn quiet icon-btn small'); dismiss.type = 'button'; dismiss.setAttribute('aria-label', 'Dismiss capture report'); dismiss.title = 'Dismiss'; dismiss.append(icon('i-x'));
  dismiss.addEventListener('click', () => action(async () => {
    box.hidden = true;
    if (key) { ui.dismissedContextReportKey = key; await chrome.storage.session.set({ linkMeteorCaptureReportDismissed: key }); }
  }));
  head.append(title, dismiss); box.append(head);
  // The roles are spelled out because the narrow layout stacks each row's cells, and a table laid
  // out that way would otherwise stop being a table to a screen reader.
  const table = node('table', 'run-table'), headRow = node('tr'), body = node('tbody'), thead = node('thead');
  const cell = (tag, className, value, role, label) => { const item = node(tag, className, value); item.setAttribute('role', role); if (label) item.dataset.label = label; return item; };
  for (const [label, numeric] of [['Page', true], ['Title', false], ['Found', true], ['Added', true], ['How it ended', false]]) { const head = cell('th', numeric ? 'num' : '', label, 'columnheader'); head.scope = 'col'; headRow.append(head); }
  for (const row of report.results || []) {
    const read = row.status === 'captured' || row.status === 'empty';
    const line = node('tr', read ? '' : 'is-problem'), name = cell('td', 'title', undefined, 'cell');
    if (row.title || row.url) appendTextLink(name, row.url, row.title || row.url); else name.textContent = '—';
    line.append(cell('td', 'num page', count(row.page), 'cell'), name, cell('td', 'num found', read ? count(row.found) : '', 'cell', 'Found'), cell('td', 'num added', read ? count(row.added) : '', 'cell', 'Added'), cell('td', 'how', row.how || '', 'cell'));
    line.setAttribute('role', 'row'); body.append(line);
  }
  table.setAttribute('role', 'table'); thead.setAttribute('role', 'rowgroup'); body.setAttribute('role', 'rowgroup'); headRow.setAttribute('role', 'row');
  thead.append(headRow); table.append(thead, body);
  const scroller = node('div', 'table-scroll'); scroller.tabIndex = 0; scroller.setAttribute('role', 'region'); scroller.setAttribute('aria-label', 'Each page of this run');
  scroller.append(table); box.append(scroller);
  if (report.note) box.append(node('p', 'help run-note', report.note));
  syncReportAction();
}

// A one-page capture that scrolled first: how the scroll ended, and Undo for what it added.
export function reportScroll(box, report) {
  const scroll = report.results?.length === 1 ? report.results[0].scroll : null;
  if (!scroll) return;
  shown = { report, options: {} };
  const line = node('p', 'report-scroll');
  line.append(node('span', '', scroll.ended === 'end' ? `Scrolled ${plural(scroll.screens, 'screen')} to the end of the page.` : scroll.text));
  if (report.undone !== undefined) line.append(node('span', '', `Undone: removed ${plural(report.undone, 'link')}.`));
  else if (report.capturedCount && report.collectionId) line.append(undoButton(report, 'Undo this capture: remove the links it added'));
  box.append(line);
}

/* Capture their pages… ------------------------------------------------------------------------ */
function selectedInView() { return ui.rows.flatMap((row) => row.occurrenceIds.filter((id) => ui.selectedIds.has(id))); }
function cleanName() { return $('pages-new').value.replace(/\s+/g, ' ').trim(); }
function originOf(url) { try { return new URL(url).origin; } catch { return ''; } }
function hasAccess(origin) { return grants.allSites || ui.originAccess.get(origin) === true; }

// The pages the chosen links point to: web addresses, each once. Email and phone links, and files
// that aren't pages, are left out and counted. A PDF is read as a PDF.
function plan(collection) {
  const ids = new Set(pending?.ids || selectedInView()), links = collection.links.filter((link) => ids.has(link.id));
  const urls = [], seen = new Set(), sites = new Map();
  let other = 0, files = 0;
  for (const link of links) {
    const url = pageKey(link.url), type = url && urlFileType(url);
    if (!url) other++;
    else if (type && type !== 'pdf') files++;
    else if (!seen.has(url)) { seen.add(url); urls.push(url); sites.set(originOf(url), (sites.get(originOf(url)) || 0) + 1); }
  }
  const missing = [...sites.keys()].filter((origin) => !hasAccess(origin));
  const unknown = !grants.allSites && [...sites.keys()].some((origin) => !ui.originAccess.has(origin));
  const isNew = $('pages-destination').value === NEW, name = cleanName();
  let problem = '';
  if (!urls.length) problem = links.length === 1 ? 'That link isn’t a web page, so there is nothing to capture.' : 'None of the selected links are web pages, so there is nothing to capture.';
  else if (urls.length > MAX_RUN_PAGES) problem = `Choose up to ${MAX_RUN_PAGES} pages at a time.`;
  else if (isNew && !name) problem = 'Name the new collection.';
  else if (isNew && name.length > MAX_NAME) problem = `A collection name can be at most ${MAX_NAME} characters.`;
  return { links, urls, sites, missing, unknown, other, files, isNew, name, problem };
}

// Asks Chrome which of these sites Link Meteor can read, and nothing else.
async function checkAccess(origins) {
  const unknown = origins.filter((origin) => origin && !ui.originAccess.has(origin));
  if (!unknown.length || !chrome.permissions?.contains) return;
  await Promise.all(unknown.map(async (origin) => {
    try { ui.originAccess.set(origin, await chrome.permissions.contains({ origins: [`${origin}/*`] })); } catch { ui.originAccess.set(origin, false); }
  }));
  if (pending && !$('pages-panel').hidden) describe();
}

function fillDestinations(collection, reset = false) {
  const select = $('pages-destination'), chosen = select.value;
  const key = JSON.stringify(ui.state.collections.map((item) => [item.id, item.name, item.links.length]));
  if (select.dataset.key !== key) {
    select.replaceChildren(...ui.state.collections.map((item) => new Option(`${item.name} (${plural(item.links.length, 'link')})`, item.id)), new Option('New collection…', NEW));
    select.dataset.key = key;
    if ([...select.options].some((option) => option.value === chosen)) select.value = chosen;
  }
  if (reset || !select.value) select.value = collection.id;
}

// The panel says beforehand what will happen, which sites it needs and where the links go.
function describe() {
  const collection = currentCollection();
  if (!pending || !collection) return;
  const p = plan(collection), pages = p.urls.length, running = !!going && going.state !== 'done';
  $('pages-title').textContent = pending.ids
    ? `Capture the links on the page ${quoted(labelFor(p.links[0] || {}))} points to`
    : `Capture the links on ${plural(pages, 'selected page')}`;
  $('pages-only').textContent = `Only ${pages === 1 ? 'this page is' : `these ${count(pages)} pages are`} read. The links found are saved, never followed.`;
  const siteNames = (origins) => origins.map((origin) => `${hostOf(origin)} (${plural(p.sites.get(origin), 'page')})`).join(', ');
  const access = $('pages-access'), allow = $('pages-allow');
  access.replaceChildren();
  if (!pages) access.textContent = 'No pages to read.';
  else if (p.unknown) access.textContent = 'Checking which sites Link Meteor can read…';
  else if (p.missing.length) access.append(node('strong', '', `Needs access to ${plural(p.missing.length, 'site')}: `), siteNames(p.missing));
  else access.append(node('strong', '', 'Link Meteor has access'), grants.allSites ? ` to ${pages === 1 ? 'this page' : 'these pages'}: you allowed all sites.` : ` to ${p.sites.size === 1 ? 'the site' : `the ${count(p.sites.size)} sites`} ${pages === 1 ? 'this page is' : 'these pages are'} on.`);
  allow.hidden = !pages || p.unknown || !p.missing.length;
  allow.textContent = p.missing.length === 1 ? 'Allow this site' : `Allow these ${count(p.missing.length)} sites`;
  $('pages-new-row').hidden = !p.isNew;
  const left = [p.files && `${plural(p.files, 'link points', 'links point')} to a file, not a page`, p.other && `${plural(p.other, 'link is', 'links are')} an email or phone link`].filter(Boolean);
  $('pages-help').textContent = p.problem || [
    left.length ? `Left out: ${left.join('; ')}.` : '',
    'Pages load as they would if you opened them yourself, signed in as you are.',
    grants.allSites ? '' : 'An address that moves to another site is read only if Link Meteor has access to that site too.',
    running ? 'Another capture is running; wait for it to finish.' : '',
  ].filter(Boolean).join(' ');
  $('pages-help').classList.toggle('is-problem', !!p.problem);
  $('pages-apply').textContent = `Capture ${plural(pages, 'page')}`;
  $('pages-apply').disabled = !!p.problem || p.unknown || p.missing.length > 0 || running;
  if (p.isNew) $('pages-new').setAttribute('aria-invalid', String(/name/i.test(p.problem))); else $('pages-new').removeAttribute('aria-invalid');
  checkAccess([...p.sites.keys()]);
}

// The button shows while links in this view are selected; an open panel follows the saved state
// and closes when the links it names are gone.
export function renderPages(collection) {
  $('pages-selected').hidden = !selectedInView().length;
  if (!pending || $('pages-panel').hidden) return;
  const present = new Set(collection.links.map((link) => link.id)), ids = pending.ids || selectedInView();
  if (pending.collectionId !== collection.id || !ids.length || ids.some((id) => !present.has(id))) { closePages(); return; }
  fillDestinations(collection);
  describe();
}

function openPages(ids = null, returnFocus = document.activeElement) {
  const collection = currentCollection();
  if (!collection) return;
  pending = { ids, collectionId: collection.id, returnFocus };
  $('pages-new').value = '';
  $('pages-panel').hidden = false;
  $('pages-selected').setAttribute('aria-expanded', String(!ids));
  fillDestinations(collection, true);
  describe();
  $('pages-panel').scrollIntoView({ block: 'nearest' });
  $('pages-destination').focus();
}
function closePages() {
  pending = null;
  $('pages-panel').hidden = true;
  $('pages-selected').setAttribute('aria-expanded', 'false');
}
function cancelPages() {
  const back = pending?.returnFocus;
  closePages();
  if (back?.isConnected) back.focus(); else $('select-all').focus();
}

// One request to Chrome, in the click, naming exactly the sites these pages are on.
async function allowSites() {
  const collection = currentCollection();
  if (!pending || !collection) return;
  const { missing } = plan(collection);
  if (!missing.length) return;
  let granted = false, problem = '';
  try { granted = await chrome.permissions.request({ origins: missing.map((origin) => `${origin}/*`) }); }
  catch (error) { problem = error.message || String(error); }
  if (!granted) {
    describe();
    throw new Error(problem ? `Chrome could not ask for access to ${missing.length === 1 ? 'this site' : 'these sites'} (${problem}). Nothing changed.`
      : `Chrome’s request for access to ${missing.length === 1 ? 'this site' : 'these sites'} was declined, so nothing changed. Capturing their pages needs that access.`);
  }
  for (const origin of missing) ui.originAccess.set(origin, true);
  describe();
  ($('pages-apply').disabled ? $('pages-destination') : $('pages-apply')).focus();
}

async function applyPages() {
  const collection = currentCollection();
  if (!pending || !collection) return;
  const p = plan(collection);
  if (p.problem) { if (p.isNew) $('pages-new').focus(); throw new Error(p.problem); }
  if (p.unknown || p.missing.length) throw new Error('Allow access to the sites listed first.');
  let collectionId = $('pages-destination').value;
  if (p.isNew) {
    // A new collection is made first; the one that was open stays open.
    const open = ui.state.activeCollectionId;
    collectionId = (await request({ type: 'state.mutate', action: { type: 'collection.create', name: p.name } })).activeCollectionId;
    await mutate({ type: 'collection.activate', id: open });
  }
  const { runId } = await request({ type: 'run.start', kind: 'pages', urls: p.urls, collectionId });
  const back = pending.returnFocus;
  closePages();
  if (!(await showStarted(runId))) (back?.isConnected ? back : $('select-all')).focus();
}

// Capture its page… in a link's details: the same panel, for that one link. Nothing for a link
// that isn't a web address.
export function detailPages(link) {
  if (!pageKey(link.url)) return '';
  const row = node('div', 'occurrence-pages'), item = button('Capture its page…', 'btn small', 'i-tabs');
  item.setAttribute('aria-label', `Capture the links on the page ${labelFor(link)} points to`);
  item.setAttribute('aria-controls', 'pages-panel');
  item.addEventListener('click', () => openPages([link.id], item));
  row.append(item, node('span', 'help', 'Opens this link’s page in a background tab and saves the links on it.'));
  return row;
}

/* A PDF among selected pages -------------------------------------------------------------------- */
// The background can't read a PDF, so it asks Link Meteor's pages (run.pdf). This page reads the
// PDF in that tab and answers with its links, shaped as an import takes them (run.pdfLinks).
async function answerPdf({ runId, step, tabId, url, title }) {
  let reply;
  try {
    // The PDF reader's modules are loaded only now, when a PDF is read.
    const { readPdfTab } = await import('./pdf-tab.js');
    const read = await readPdfTab(tabId, { saveContext: ui.state?.settings?.saveContext !== false });
    const address = pageKey(read.address || url), sourceTitle = read.citation?.title || title || '';
    reply = {
      links: read.links.map((link) => ({ url: link.url, originalHref: link.originalHref || '', anchorText: link.anchorText || '', pdfPage: link.pdfPage, ...(link.context ? { context: link.context } : {}), sourceUrl: address, sourceTitle })),
      pages: read.citation && address ? { [address]: { ...read.citation, readAt: new Date().toISOString() } } : {},
      internal: read.internal, pageCount: read.pageCount,
    };
  } catch (error) { reply = { error: error?.message || String(error) }; }
  await request({ type: 'run.pdfLinks', runId, step, ...reply });
}

export function bindRuns() {
  $('follow-pages').addEventListener('change', () => action(saveFollowPages));
  $('run-stop').addEventListener('click', () => action(stop));
  $('pages-selected').addEventListener('click', () => openPages());
  $('pages-destination').addEventListener('change', () => { describe(); if ($('pages-destination').value === NEW) $('pages-new').focus(); });
  $('pages-new').addEventListener('input', describe);
  $('pages-allow').addEventListener('click', () => action(allowSites));
  $('pages-panel').addEventListener('submit', (event) => { event.preventDefault(); action(applyPages); });
  $('pages-cancel').addEventListener('click', cancelPages);
  onEscape(() => {
    if ($('pages-panel').hidden) return false;
    cancelPages();
    return true;
  });
  onRender(renderFollowPages);
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'run.progress') onProgress(message);
    else if (message?.type === 'run.pdf') action(() => answerPdf(message));
  });
  // Chrome's own list of allowed sites changed: an open panel checks again.
  for (const event of [chrome.permissions?.onAdded, chrome.permissions?.onRemoved]) event?.addListener(() => { ui.originAccess.clear(); if (pending && !$('pages-panel').hidden) describe(); });
  // A view opened while a run is going shows it.
  request({ type: 'run.status' }).then(({ run }) => { if (run && run.state !== 'done') { going = run; renderRun(); } }, () => {});
}
