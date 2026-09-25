import { queryLinks } from '../core/model.js';
import { COLUMNS, makeExport } from '../core/export.js';

const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 100;
const DETAIL_PAGE_SIZE = 100;
const DEFAULT_COLUMNS = ['anchorText', 'url'];
const ARRIVAL_MS = 2600;
const ui = { state: null, inventory: null, rows: [], page: 0, selectedIds: new Set(), selectedTabs: new Set(), columns: [...DEFAULT_COLUMNS], scope: 'current', busy: false, currentOrigin: '', collectionDrafts: new Map(), linkDrafts: new Map(), openDetails: new Set(), detailLimits: new Map(), holdKeyDraft: null, directionTouched: false, lastContextReportKey: '', dismissedContextReportKey: '', displayedReportKey: '', batchFilter: '', flashBatch: '', flashStart: 0, originAccess: new Map(), shortcut: null, pendingOpen: null, returnFocus: null };
const filters = ['search', 'domain', 'file-type', 'relation', 'sort', 'direction', 'dedupe'];
const FORMAT_HELP = {
  xlsx: 'Every cell is stored as text, so nothing is reinterpreted as a formula, number or date.',
  csv: 'Cells that look like formulas start with an apostrophe so spreadsheets import them as text.',
  tsv: 'Tab-separated. Cells that look like formulas start with an apostrophe.',
  markdown: 'One [anchor text](URL) per line. Columns do not apply; empty anchor text stays empty.',
  html: 'A plain HTML table using your columns. Page text is escaped.',
  json: 'Every field for every link, including all grouped occurrences. Columns do not apply.',
  text: 'One URL per line, exactly as captured. Columns do not apply.',
};
let reloadTimer, inventoryTimer, noticeTimer, inventoryRequestSequence = 0;

/* Small DOM helpers ------------------------------------------------------- */
const SVG_NS = 'http://www.w3.org/2000/svg';
function node(tag, className, value) { const item = document.createElement(tag); if (className) item.className = className; if (value !== undefined) item.textContent = value; return item; }
function icon(name, className = 'icon') { const svg = document.createElementNS(SVG_NS, 'svg'); svg.setAttribute('class', className); svg.setAttribute('aria-hidden', 'true'); const use = document.createElementNS(SVG_NS, 'use'); use.setAttribute('href', `#${name}`); svg.append(use); return svg; }
function button(label, className = 'btn', iconName = '') { const item = node('button', className); item.type = 'button'; if (iconName) item.append(icon(iconName)); item.append(document.createTextNode(label)); return item; }
function count(n) { return Number(n).toLocaleString(); }
function plural(n, word, many = `${word}s`) { return `${count(n)} ${n === 1 ? word : many}`; }
function quoted(value) { return value ? `“${value}”` : 'no anchor text'; }

function show(message, kind = 'notice', { actionLabel = '', onAction = null } = {}) {
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

function fail(error) { show(error instanceof Error ? error.message : String(error), 'error'); }

async function request(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || !response.ok) throw new Error(response?.error || `Unable to complete ${message.type}.`);
  return response.data;
}

async function action(fn) {
  try { await fn(); } catch (error) { fail(error); }
}

async function mutate(actionValue) {
  ui.state = await request({ type: 'state.mutate', action: actionValue });
  render();
}

/* URL and label helpers ----------------------------------------------------- */
function currentCollection() { return ui.state?.collections.find((item) => item.id === ui.state.activeCollectionId); }
function safeUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
function capturableUrl(value) {
  const safe = safeUrl(value);
  if (!safe) return '';
  const url = new URL(safe);
  return url.hostname === 'chromewebstore.google.com' || (url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore')) ? '' : safe;
}
function originOf(value) { const safe = capturableUrl(value); return safe ? new URL(safe).origin : ''; }
function hostOf(value) { try { return new URL(value).host; } catch { return ''; } }
function labelFor(link) { return link.anchorText || link.accessibleLabel || '(textless link)'; }
function tags(value) { return [...new Set(value.split(',').map((part) => part.trim()).filter(Boolean))]; }
function filename(name) { return (name || 'links').normalize('NFKD').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'links'; }
const DOCUMENT_TYPES = new Set(['pdf', 'csv', 'tsv', 'xls', 'xlsx', 'ods', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'ppt', 'pptx', 'odp', 'epub', 'json', 'xml', 'zip', 'gz', 'tar', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'tif', 'tiff', 'mp3', 'mp4', 'wav', 'mov', 'webm', 'bib', 'ris']);
// Path suffix after the last dot, when it looks like a file extension (letters first, as the file-type filter expects).
function fileType(value) {
  try { const match = new URL(value).pathname.match(/\.([a-z][a-z0-9]{0,4})$/i); return match ? match[1].toLowerCase() : ''; } catch { return ''; }
}
function appendTextLink(parent, value, display = value, className = '') {
  const href = safeUrl(value);
  if (!href) { parent.append(node('span', className, display || '(unavailable)')); return; }
  const link = node('a', className, display);
  link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
  parent.append(link);
}
// Shows the exact URL string, with the host emphasized for scanning.
function urlParts(value) {
  try {
    const url = new URL(value);
    const prefix = `${url.protocol}//`;
    if (url.host && value.startsWith(prefix + url.host)) return [prefix, url.host, value.slice(prefix.length + url.host.length)];
  } catch { /* shown verbatim */ }
  return ['', '', value];
}
function renderUrl(parent, value) {
  const [scheme, host, rest] = urlParts(value);
  const href = safeUrl(value);
  const holder = href ? node('a', 'url') : node('span', 'url');
  if (href) { holder.href = href; holder.target = '_blank'; holder.rel = 'noopener noreferrer'; }
  if (scheme) holder.append(node('span', 'scheme', scheme));
  if (host) holder.append(node('span', 'host', host));
  holder.append(document.createTextNode(rest));
  parent.append(holder);
}
function formatTime(value) {
  const time = new Date(value);
  return Number.isNaN(time.valueOf()) ? value || '(unknown)' : time.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
}
function shortcutKeys(shortcut) {
  if (!shortcut) return [];
  return shortcut.includes('+') ? shortcut.split('+') : [...shortcut];
}
function kbdGroup(keys) { return keys.map((key) => node('kbd', '', key)); }

/* Views (compact layout) ---------------------------------------------------- */
function setView(view, returnFocus = null) {
  const app = $('app');
  if (app.dataset.view === view) return;
  app.dataset.view = view;
  const target = view === 'collections' ? $('rail') : view === 'export' ? $('export-panel') : $('main');
  target.classList.remove('view-enter'); void target.offsetWidth; target.classList.add('view-enter');
  if (view !== 'links') ui.returnFocus = returnFocus;
  if (!matchMedia('(min-width: 900px)').matches) {
    window.scrollTo(0, 0);
    const focusTarget = view === 'collections' ? $('rail-done') : view === 'export' ? $('export-done') : ui.returnFocus;
    focusTarget?.focus({ preventScroll: true });
    if (view === 'links') ui.returnFocus = null;
  }
}

/* Rendering ------------------------------------------------------------------ */
function render() {
  const collection = currentCollection();
  if (!collection) return;
  $('collection-heading').textContent = collection.name;
  document.title = `${collection.name} · Link Meteor`;
  const sources = new Set(collection.links.map((link) => link.sourceUrl)).size;
  $('collection-summary').textContent = collection.links.length
    ? `${plural(collection.links.length, 'link')} from ${plural(sources, 'page')}`
    : 'No links yet';
  const editing = !$('collection-editor').hidden;
  $('collection-notes-view').textContent = collection.notes;
  $('collection-notes-view').hidden = editing || !collection.notes.trim();
  $('collection-tags-view').replaceChildren(...collection.tags.map((tag) => { const item = node('li', 'tag', tag); return item; }));
  $('collection-tags-view').hidden = editing || !collection.tags.length;
  renderCollections();
  const draft = ui.collectionDrafts.get(collection.id);
  $('collection-name').value = draft?.name ?? collection.name;
  $('collection-notes').value = draft?.notes ?? collection.notes;
  $('collection-tags').value = draft?.tags ?? collection.tags.join(', ');
  $('bookmark-name').placeholder = collection.name;
  $('undo').disabled = !ui.state.undo;
  renderSite();
  renderLinks();
}

function renderCollections() {
  const collections = ui.state.collections;
  $('collection-count').textContent = count(collections.length);
  $('collection-list').replaceChildren(...collections.map((item) => {
    const li = node('li');
    const choose = node('button', 'collection-item'); choose.type = 'button';
    choose.append(node('span', 'name', item.name), node('span', 'n', count(item.links.length)));
    choose.setAttribute('aria-label', `${item.name}, ${plural(item.links.length, 'link')}`);
    if (item.id === ui.state.activeCollectionId) choose.setAttribute('aria-current', 'true');
    choose.addEventListener('click', () => action(() => activateCollection(item.id)));
    li.append(choose);
    return li;
  }));
}

async function activateCollection(id) {
  if (id !== ui.state.activeCollectionId) {
    ui.page = 0; ui.batchFilter = '';
    await mutate({ type: 'collection.activate', id });
    ui.selectedIds.clear(); ui.openDetails.clear(); ui.detailLimits.clear();
    closeEditor(); renderLinks();
  }
  setView('links');
}

function renderSite() {
  if (!ui.state) return;
  $('hold-key').value = ui.holdKeyDraft ?? ui.state.settings.holdKey;
  $('hold-enabled').checked = !!ui.currentOrigin && ui.state.settings.holdOrigins.includes(ui.currentOrigin);
  $('hold-enabled').disabled = !ui.currentOrigin;
  $('site-origin').textContent = ui.currentOrigin || 'Current site unavailable';
  $('site-origin').title = ui.currentOrigin ? '' : 'Open Link Meteor from an ordinary webpage to configure it.';
}

function renderShortcut() {
  if (ui.shortcut === null) { $('shortcut-keys').replaceChildren(); $('arm-keys').replaceChildren(); return; }
  const keys = shortcutKeys(ui.shortcut);
  $('shortcut-keys').replaceChildren(...(keys.length ? kbdGroup(keys) : [node('span', 'help', 'Not set')]));
  $('arm-keys').replaceChildren(...kbdGroup(keys));
  $('arm').title = keys.length ? `Shortcut on any webpage: ${keys.join(' ')}` : 'No keyboard shortcut is set';
  $('shortcut-settings').firstChild.textContent = keys.length ? 'Change' : 'Set a shortcut';
}

function queryOptions() {
  return { search: $('search').value, domain: $('domain').value, fileType: $('file-type').value,
    relation: $('relation').value, sort: $('sort').value, direction: $('direction').value, dedupe: $('dedupe').value };
}

function renderLinks() {
  const collection = currentCollection();
  if (!collection) return;
  const options = queryOptions();
  const batchLinks = ui.batchFilter ? collection.links.filter((link) => link.batchId === ui.batchFilter) : null;
  if (batchLinks && !batchLinks.length) ui.batchFilter = '';
  const result = queryLinks(ui.batchFilter ? batchLinks : collection.links, options);
  ui.rows = result.rows;
  const pageCount = Math.max(1, Math.ceil(result.rows.length / PAGE_SIZE));
  ui.page = Math.min(ui.page, pageCount - 1);
  const start = ui.page * PAGE_SIZE;
  const pageRows = result.rows.slice(start, start + PAGE_SIZE);
  const ids = new Set(collection.links.map((link) => link.id));
  ui.selectedIds = new Set([...ui.selectedIds].filter((id) => ids.has(id)));
  const grouped = options.dedupe !== 'none';
  const total = collection.links.length;
  const filtered = result.matchedCount < total;
  $('result-count').textContent = !total ? '' : grouped
    ? `${plural(result.rows.length, options.dedupe === 'url' ? 'unique URL' : 'unique pair')} · ${filtered ? `${count(result.matchedCount)} of ${plural(total, 'link')}` : plural(total, 'link')}`
    : filtered ? `${count(result.matchedCount)} of ${plural(total, 'link')}` : plural(total, 'link');
  const pageIds = pageRows.flatMap((row) => row.occurrenceIds);
  const selectedOnPage = pageIds.filter((id) => ui.selectedIds.has(id)).length;
  $('selection-count').textContent = ui.selectedIds.size ? `${count(ui.selectedIds.size)} selected · ${count(selectedOnPage)} on this page` : '';
  $('selection-count').classList.toggle('has-selection', !!ui.selectedIds.size);
  $('clear-selection').hidden = !ui.selectedIds.size;
  $('remove').disabled = !ui.selectedIds.size;
  $('select-all').checked = !!pageIds.length && pageIds.every((id) => ui.selectedIds.has(id));
  $('select-all').indeterminate = pageIds.some((id) => ui.selectedIds.has(id)) && !$('select-all').checked;
  $('select-all').disabled = !pageIds.length;
  $('page-range').textContent = result.rows.length ? `${count(start + 1)}–${count(start + pageRows.length)} of ${plural(result.rows.length, 'row')} · Page ${ui.page + 1} of ${pageCount}` : '0 rows';
  $('page-prev').disabled = ui.page === 0;
  $('page-next').disabled = ui.page >= pageCount - 1;
  $('review-pages').hidden = pageCount <= 1;
  renderEmpty(collection, result);
  $('review').classList.toggle('is-blank', !total);
  $('app').classList.toggle('is-blank', !total);
  renderViewChips();
  renderSuggestions(collection);
  renderExportTarget();
  const list = $('link-list');
  const focused = document.activeElement;
  const focusId = focused?.dataset?.linkId;
  const focusField = focused?.dataset?.linkField;
  const selectionStart = focusId ? focused.selectionStart : null;
  const selectionEnd = focusId ? focused.selectionEnd : null;
  list.replaceChildren(...pageRows.map(renderRow));
  if (focusId) {
    const replacement = [...list.querySelectorAll('input[data-link-id]')].find((input) => input.dataset.linkId === focusId && input.dataset.linkField === focusField);
    if (replacement) {
      replacement.focus({ preventScroll: true });
      if (selectionStart !== null && selectionEnd !== null) replacement.setSelectionRange(selectionStart, selectionEnd);
    }
  }
}

function renderEmpty(collection, result) {
  const empty = $('empty-state');
  empty.hidden = !!result.rows.length;
  if (result.rows.length) return;
  const heading = node('h3');
  if (!collection.links.length) {
    heading.textContent = 'Start this collection';
    const intro = node('p', '', 'Links you capture are saved here, in this browser only. Each keeps its visible anchor text, its exact URL and the page it came from.');
    const steps = node('ol', 'empty-steps');
    const first = node('li'); const firstText = node('span');
    const keys = shortcutKeys(ui.shortcut);
    if (keys.length) firstText.append('On a webpage, press ', ...kbdGroup(keys), ' or choose Select a region.');
    else firstText.append('On a webpage, choose Select a region. You can also set a keyboard shortcut.');
    first.append(firstText);
    steps.append(first, node('li', '', 'Drag across the links you want. Scroll while dragging to reach more.'), node('li', '', 'Copy them as two columns, or add them here to review and export.'));
    empty.replaceChildren(heading, intro, steps);
  } else {
    heading.textContent = 'No links match this view';
    const reset = button('Clear search and filters', 'btn small');
    reset.addEventListener('click', () => { resetView(); $('search').focus(); });
    empty.replaceChildren(heading, node('p', '', `This collection has ${plural(collection.links.length, 'link')}. Nothing matches the current search or filters.`), reset);
  }
}

function resetView() {
  $('search').value = ''; $('domain').value = ''; $('file-type').value = ''; $('relation').value = 'all';
  $('sort').value = 'page'; $('direction').value = 'asc'; $('dedupe').value = 'none';
  ui.batchFilter = ''; ui.directionTouched = false; ui.page = 0;
  renderLinks();
}

function renderViewChips() {
  const chips = [];
  const add = (label, clear) => chips.push([label, clear]);
  if (ui.batchFilter) add('Only the latest capture', () => { ui.batchFilter = ''; });
  if ($('domain').value) add(`Domain contains “${$('domain').value}”`, () => { $('domain').value = ''; });
  if ($('file-type').value) add(`File type: ${$('file-type').value.replace(/^\./, '')}`, () => { $('file-type').value = ''; });
  if ($('relation').value !== 'all') add($('relation').value === 'internal' ? 'Internal links' : 'External links', () => { $('relation').value = 'all'; });
  if ($('dedupe').value !== 'none') add($('dedupe').value === 'url' ? 'Grouped by URL' : 'Grouped by URL + anchor text', () => { $('dedupe').value = 'none'; });
  if ($('sort').value !== 'page' || $('direction').value !== 'asc') add(`Sorted by ${$('sort').selectedOptions[0].textContent.toLowerCase()}, ${$('direction').value === 'asc' ? 'ascending' : 'descending'}`, () => { $('sort').value = 'page'; $('direction').value = 'asc'; ui.directionTouched = false; });
  const list = $('active-filters');
  list.hidden = !chips.length;
  $('filter-count').hidden = !chips.length;
  $('filter-count').textContent = String(chips.length);
  list.replaceChildren(...chips.map(([label, clear]) => {
    const chip = node('li', 'chip');
    chip.append(node('span', '', label));
    const remove = node('button'); remove.type = 'button'; remove.setAttribute('aria-label', `Remove: ${label}`); remove.append(icon('i-x'));
    remove.addEventListener('click', () => { clear(); ui.page = 0; renderLinks(); $('search').focus({ preventScroll: true }); });
    chip.append(remove);
    return chip;
  }));
  if (chips.length > 1) {
    const reset = node('li');
    const all = button('Reset view', 'chip chip-reset');
    all.addEventListener('click', () => { resetView(); $('search').focus({ preventScroll: true }); });
    reset.append(all); list.append(reset);
  }
}

function renderSuggestions(collection) {
  const hosts = new Map(), types = new Map();
  for (const link of collection.links) {
    let host = '';
    try { host = new URL(link.url).hostname; } catch { /* no suggestion */ }
    if (host) hosts.set(host, (hosts.get(host) || 0) + 1);
    const type = fileType(link.url);
    if (type) types.set(type, (types.get(type) || 0) + 1);
  }
  const options = (map) => [...map].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([value, n]) => { const option = new Option(`${plural(n, 'link')}`, value); return option; });
  $('domain-options').replaceChildren(...options(hosts));
  $('type-options').replaceChildren(...options(types));
}

function renderRow(row) {
  const mode = $('dedupe').value;
  const wrapper = node('article', 'link-row'); wrapper.setAttribute('role', 'listitem');
  const elapsed = Date.now() - ui.flashStart;
  if (ui.flashBatch && elapsed < ARRIVAL_MS && row.occurrences.some((link) => link.batchId === ui.flashBatch)) {
    wrapper.classList.add('is-new'); wrapper.style.animationDelay = `-${elapsed}ms`;
  }
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox'; checkbox.className = 'row-select';
  checkbox.setAttribute('aria-label', row.occurrenceIds.length === 1 ? `Select ${labelFor(row)}` : `Select ${plural(row.occurrenceIds.length, 'occurrence')} of ${labelFor(row)}`);
  checkbox.checked = row.occurrenceIds.every((id) => ui.selectedIds.has(id));
  checkbox.indeterminate = row.occurrenceIds.some((id) => ui.selectedIds.has(id)) && !checkbox.checked;
  checkbox.addEventListener('change', () => {
    for (const id of row.occurrenceIds) checkbox.checked ? ui.selectedIds.add(id) : ui.selectedIds.delete(id);
    renderLinks();
  });

  const cells = node('div', 'row-cells');
  const anchorCell = node('div', 'cell cell-anchor');
  anchorCell.append(node('span', row.anchorText ? 'anchor' : 'anchor is-empty', row.anchorText || 'No anchor text'));
  const badges = node('span', 'badges');
  if (row.occurrences.length > 1) badges.append(node('span', 'badge count', `×${count(row.occurrences.length)}`));
  const scheme = (() => { try { return new URL(row.url).protocol.replace(':', ''); } catch { return ''; } })();
  if (scheme === 'mailto' || scheme === 'tel') badges.append(node('span', 'badge', scheme === 'mailto' ? 'EMAIL' : 'PHONE'));
  const type = fileType(row.url);
  if (DOCUMENT_TYPES.has(type)) badges.append(node('span', 'badge', type.toUpperCase()));
  if (badges.childNodes.length) anchorCell.append(badges);
  if (!row.anchorText && row.accessibleLabel) anchorCell.append(node('span', 'aria', `Accessible label: ${row.accessibleLabel}`));
  if (mode === 'url') {
    const others = [...new Set(row.occurrences.map((link) => link.anchorText))].filter((label) => label !== row.anchorText);
    if (others.length) anchorCell.append(node('span', 'also', `Also labeled ${others.slice(0, 2).map(quoted).join(', ')}${others.length > 2 ? ` and ${count(others.length - 2)} more` : ''}`));
  }
  const urlCell = node('div', 'cell cell-url'); renderUrl(urlCell, row.url); urlCell.firstChild.title = row.url;
  const sourceCell = node('div', 'cell cell-source');
  sourceCell.append(node('span', 'from', 'from'));
  appendTextLink(sourceCell, row.sourceUrl, row.sourceTitle || row.sourceUrl || '(unknown page)', 'src-title');
  sourceCell.lastChild.title = row.sourceTitle ? `${row.sourceTitle}\n${row.sourceUrl}` : row.sourceUrl;
  const sourceHost = hostOf(row.sourceUrl);
  if (sourceHost) sourceCell.append(node('span', 'src-host', sourceHost));
  const sourceCount = new Set(row.occurrences.map((link) => link.sourceUrl)).size;
  if (sourceCount > 1) sourceCell.append(node('span', 'also', `and ${plural(sourceCount - 1, 'other page')}`));
  cells.append(anchorCell, urlCell, sourceCell);
  wrapper.append(checkbox, cells);

  if (row.occurrences.length === 1 && (row.notes || row.tags.length)) {
    const notes = node('div', 'row-notes');
    for (const tag of row.tags) notes.append(node('span', 'tag', tag));
    if (row.notes) notes.append(node('span', 'note', row.notes));
    wrapper.append(notes);
  }

  const detailKey = JSON.stringify(mode === 'none' ? [mode, row.id] : [mode, row.url, mode === 'url-anchor' ? row.anchorText : '']);
  const details = document.createElement('details'); details.className = 'row-details';
  details.open = ui.openDetails.has(detailKey);
  const summary = node('summary');
  summary.append(icon('i-chevron-right'), node('span', 'summary-text', row.occurrences.length === 1 ? `Source details and notes for ${labelFor(row)}` : `${plural(row.occurrences.length, 'source occurrence')} for ${labelFor(row)}`));
  summary.title = row.occurrences.length === 1 ? 'Source details and notes' : `${plural(row.occurrences.length, 'source occurrence')}`;
  details.append(summary);
  const body = node('div', 'details-body');
  const occurrences = node('ul', 'occurrence-list');
  occurrences.id = `occurrences-${row.id}`;
  const detailRange = node('p', 'detail-range'); detailRange.setAttribute('role', 'status'); detailRange.setAttribute('aria-live', 'polite');
  const more = node('button', 'btn small detail-more'); more.type = 'button'; more.hidden = true; more.setAttribute('aria-controls', occurrences.id);
  detailRange.hidden = true;
  let rendered = 0;
  function appendOccurrences(until) {
    const end = Math.min(until, row.occurrences.length);
    if (end > rendered) occurrences.append(...row.occurrences.slice(rendered, end).map((link) => renderOccurrence(link, row.occurrences.length > 1)));
    rendered = end;
    ui.detailLimits.set(detailKey, rendered);
    detailRange.textContent = `Showing ${count(rendered)} of ${plural(row.occurrences.length, 'source occurrence')}`;
    detailRange.hidden = row.occurrences.length === 1;
    more.hidden = rendered >= row.occurrences.length;
    const nextCount = Math.min(DETAIL_PAGE_SIZE, row.occurrences.length - rendered);
    more.textContent = `Show next ${nextCount} occurrence${nextCount === 1 ? '' : 's'}`;
  }
  more.addEventListener('click', () => {
    appendOccurrences(rendered + DETAIL_PAGE_SIZE);
    if (more.hidden) summary.focus({ preventScroll: true });
  });
  details.addEventListener('toggle', () => {
    if (!details.isConnected) return;
    if (details.open) {
      ui.openDetails.add(detailKey);
      appendOccurrences(Math.max(DETAIL_PAGE_SIZE, ui.detailLimits.get(detailKey) || 0));
    } else {
      ui.openDetails.delete(detailKey);
      occurrences.replaceChildren(); rendered = 0; more.hidden = true; detailRange.hidden = true;
    }
  });
  body.append(occurrences, detailRange, more); details.append(body);
  if (details.open) appendOccurrences(Math.max(DETAIL_PAGE_SIZE, ui.detailLimits.get(detailKey) || 0));
  wrapper.append(details);
  return wrapper;
}

function fact(list, term, value, { exact = false, empty = 'None' } = {}) {
  const dt = node('dt', '', term);
  const dd = node('dd', exact ? 'exact' : '');
  if (value instanceof Node) dd.append(value);
  else if (value) dd.textContent = value;
  else dd.append(node('span', 'none', empty));
  list.append(dt, dd);
  return dd;
}

function renderOccurrence(link, grouped) {
  const item = node('li', 'occurrence');
  const facts = node('dl', 'facts');
  fact(facts, 'Anchor text', link.anchorText, { empty: 'Empty (the link has no visible text)' });
  if (link.accessibleLabel) fact(facts, 'Accessible label', link.accessibleLabel);
  const urlValue = fact(facts, 'URL', '', { exact: true });
  urlValue.replaceChildren();
  appendTextLink(urlValue, link.url, link.url);
  const copyUrl = node('button', 'link-btn inline-copy', 'Copy'); copyUrl.type = 'button'; copyUrl.setAttribute('aria-label', `Copy URL of ${labelFor(link)}`);
  copyUrl.addEventListener('click', () => action(async () => { await navigator.clipboard.writeText(link.url); show('Copied the URL.'); }));
  urlValue.append(copyUrl);
  fact(facts, 'Original href', link.originalHref, { exact: true, empty: 'Empty' });
  const page = node('span');
  appendTextLink(page, link.sourceUrl, link.sourceTitle || link.sourceUrl || '(unknown page)');
  if (link.sourceTitle && link.sourceUrl) { page.append(document.createElement('br')); page.append(node('span', 'exact', link.sourceUrl)); }
  fact(facts, 'Source page', page);
  if (link.frameUrl && link.frameUrl !== link.sourceUrl) {
    const frame = node('span'); appendTextLink(frame, link.frameUrl); fact(facts, 'Inside frame', frame);
  }
  const time = fact(facts, 'Captured', formatTime(link.capturedAt));
  time.title = link.capturedAt;
  fact(facts, 'Capture batch', link.batchId, { exact: true, empty: 'Unknown' });
  fact(facts, 'Occurrence ID', link.id, { exact: true });
  item.append(facts);

  const form = document.createElement('form'); form.className = 'occurrence-form';
  const draft = ui.linkDrafts.get(link.id);
  const noteLabel = node('label', '', 'Note'); const noteInput = document.createElement('input'); noteInput.value = draft?.notes ?? link.notes; noteInput.dataset.linkId = link.id; noteInput.dataset.linkField = 'notes'; noteInput.setAttribute('aria-label', `Note for ${labelFor(link)}`); noteInput.autocomplete = 'off'; noteLabel.append(noteInput);
  const tagLabel = node('label', '', 'Tags'); const tagInput = document.createElement('input'); tagInput.value = draft?.tags ?? link.tags.join(', '); tagInput.dataset.linkId = link.id; tagInput.dataset.linkField = 'tags'; tagInput.setAttribute('aria-label', `Tags for ${labelFor(link)}`); tagInput.placeholder = 'comma, separated'; tagInput.autocomplete = 'off'; tagLabel.append(tagInput);
  const keepDraft = () => ui.linkDrafts.set(link.id, { notes: noteInput.value, tags: tagInput.value });
  noteInput.addEventListener('input', keepDraft); tagInput.addEventListener('input', keepDraft);
  const save = node('button', 'btn', 'Save'); save.type = 'submit';
  form.append(noteLabel, tagLabel, save);
  form.addEventListener('submit', (event) => { event.preventDefault(); action(async () => { await mutate({ type: 'link.update', id: link.id, patch: { notes: noteInput.value, tags: tags(tagInput.value) } }); ui.linkDrafts.delete(link.id); show(grouped ? 'Saved the note and tags for this occurrence.' : 'Saved the note and tags.'); }); });
  item.append(form);
  return item;
}

function columnLabel(key) { return COLUMNS.find((item) => item.key === key)?.label || key; }

function renderColumns() {
  const area = $('columns'); area.replaceChildren();
  for (const [index, column] of ui.columns.entries()) {
    const item = node('li', 'column-item');
    const label = columnLabel(column);
    const move = (offset, name) => {
      const control = node('button'); control.type = 'button'; control.append(icon(offset < 0 ? 'i-arrow-up' : 'i-arrow-down'));
      control.setAttribute('aria-label', `Move ${label} ${name}`); control.title = `Move ${name}`;
      control.disabled = offset < 0 ? index === 0 : index === ui.columns.length - 1;
      control.addEventListener('click', () => {
        [ui.columns[index + offset], ui.columns[index]] = [ui.columns[index], ui.columns[index + offset]];
        renderColumns();
        area.querySelectorAll('.column-item')[index + offset]?.querySelector(`button[aria-label="Move ${CSS.escape(label)} ${name}"]`)?.focus();
      });
      return control;
    };
    const remove = node('button'); remove.type = 'button'; remove.append(icon('i-x'));
    remove.setAttribute('aria-label', `Remove ${label} column`); remove.title = 'Remove column';
    remove.disabled = ui.columns.length === 1;
    remove.addEventListener('click', () => { ui.columns.splice(index, 1); renderColumns(); $('add-column').focus(); });
    item.append(node('span', 'name', label), move(-1, 'up'), move(1, 'down'), remove);
    area.append(item);
  }
  const add = $('add-column'); add.replaceChildren(new Option('Add a column…', ''));
  for (const column of COLUMNS.filter((item) => !ui.columns.includes(item.key))) add.add(new Option(column.label, column.key));
  add.disabled = ui.columns.length === COLUMNS.length;
  $('reset-columns').hidden = ui.columns.join() === DEFAULT_COLUMNS.join();
  $('copy-table-note').textContent = ui.columns.map(columnLabel).join(' · ');
  $('dock-copy-label').textContent = ui.columns.join() === DEFAULT_COLUMNS.join() ? 'Copy text + URL' : 'Copy table';
  renderExportTarget();
}

function targetRows() {
  if (!ui.selectedIds.size) return ui.rows;
  return ui.rows.flatMap((row) => {
    const occurrences = row.occurrences.filter((link) => ui.selectedIds.has(link.id));
    if (!occurrences.length) return [];
    return [{ ...occurrences[0], occurrences, occurrenceIds: occurrences.map((link) => link.id) }];
  });
}

function requiredRows() {
  const rows = targetRows();
  if (!rows.length) throw new Error('No visible links to use. Adjust the filters or selection first.');
  return rows;
}

function renderExportTarget() {
  const collection = currentCollection();
  if (!collection) return;
  const rows = targetRows();
  const grouped = $('dedupe').value !== 'none';
  const unit = grouped ? 'row' : 'link';
  const selected = ui.selectedIds.size > 0;
  const filtered = ui.rows.reduce((n, row) => n + row.occurrenceIds.length, 0) < collection.links.length;
  let headline, short;
  if (!rows.length) {
    headline = collection.links.length ? (selected ? 'No selected links in this view' : 'Nothing in this view') : 'No links yet';
    short = headline;
  } else if (selected) {
    headline = `${plural(rows.length, `selected ${unit}`)}`;
    short = `${count(rows.length)} selected`;
  } else {
    headline = `All ${plural(rows.length, unit)} in this view`;
    short = `All ${plural(rows.length, unit)}`;
  }
  $('export-target').textContent = headline;
  $('dock-target').textContent = short;
  $('export-target').parentElement.classList.toggle('is-empty', !rows.length);
  const notes = [];
  if (selected) notes.push('Only selected links that match the current filters are used.');
  else if (filtered) notes.push(`Filtered from ${plural(collection.links.length, 'link')}. Every matching link is used, across all pages.`);
  else if (rows.length) notes.push('Every link in the collection, across all pages.');
  if (grouped && rows.length) notes.push('Grouped rows use their first link for tables, text and Markdown. JSON keeps every occurrence and source.');
  $('export-scope').textContent = notes.join(' ');
  const format = $('format').value;
  const extension = { xlsx: 'xlsx', csv: 'csv', tsv: 'tsv', markdown: 'md', html: 'html', json: 'json', text: 'txt' }[format];
  $('download-label').textContent = `Download ${{ xlsx: 'Excel file', csv: 'CSV file', tsv: 'TSV file', markdown: 'Markdown file', html: 'HTML file', json: 'JSON file', text: 'URL list' }[format]}`;
  $('download-name').textContent = `Saves as ${filename(collection.name)}.${extension}`;
  $('format-help').textContent = FORMAT_HELP[format] || '';
  $('columns-help').textContent = ['markdown', 'json', 'text'].includes(format)
    ? 'Columns apply to the Table copy and to CSV, TSV, Excel and HTML files. This format ignores them.'
    : 'Columns apply to the Table copy and to CSV, TSV, Excel and HTML files.';
  const webRows = rows.filter((row) => safeUrl(row.url)).length;
  const webUrls = new Set(rows.map((row) => safeUrl(row.url)).filter(Boolean)).size;
  $('bookmark-label').textContent = webRows ? `Bookmark ${plural(webRows, 'web link')}` : 'Create bookmark folder';
  $('open-label').textContent = webUrls ? `Open ${plural(webUrls, 'web link')}…` : 'Open links…';
  for (const id of ['copy-table', 'copy-urls', 'copy-markdown', 'download', 'bookmark', 'open-links', 'dock-copy']) $(id).disabled = !rows.length;
  if (ui.pendingOpen && [...new Set(rows.map((row) => safeUrl(row.url)).filter(Boolean))].join('\n') !== ui.pendingOpen.join('\n')) cancelOpen();
}

/* Capture scope ---------------------------------------------------------------- */
function scopeTabs() {
  const tabs = ui.inventory?.tabs || [];
  return ui.scope === 'selected' ? tabs.filter((tab) => ui.selectedTabs.has(tab.id)) : ui.scope === 'window' ? tabs.filter((tab) => tab.windowId === ui.inventory.currentWindowId) : tabs;
}

function renderCaptureButton() {
  const label = $('capture-label');
  if (ui.busy) { label.textContent = 'Capturing…'; $('capture').setAttribute('aria-busy', 'true'); return; }
  $('capture').removeAttribute('aria-busy');
  if (ui.scope === 'current') { label.textContent = 'Capture this page'; return; }
  if (!ui.inventory) { label.textContent = 'Capture tabs'; return; }
  const n = scopeTabs().length;
  label.textContent = ui.scope === 'selected' && !n ? 'Capture selected tabs' : `Capture ${plural(n, 'tab')}`;
}

function preview(parts, warning = false, iconName = 'i-info') {
  const box = $('scope-preview');
  box.classList.toggle('is-warning', warning);
  const text = node('span');
  for (const part of parts) text.append(typeof part === 'string' ? document.createTextNode(part) : part);
  box.replaceChildren(icon(iconName), text);
}

async function refreshOriginAccess(origins) {
  const unknown = origins.filter((origin) => !ui.originAccess.has(origin));
  if (!unknown.length || !chrome.permissions?.contains) return;
  await Promise.all(unknown.map(async (origin) => {
    try { ui.originAccess.set(origin, await chrome.permissions.contains({ origins: [`${origin}/*`] })); } catch { ui.originAccess.set(origin, false); }
  }));
  renderInventory();
}

function renderInventory() {
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
    const area = $('tab-options'); area.replaceChildren();
    const windows = [...new Set(tabs.map((tab) => tab.windowId))];
    windows.sort((a, b) => (a === ui.inventory.currentWindowId ? -1 : b === ui.inventory.currentWindowId ? 1 : 0));
    windows.forEach((windowId, index) => {
      if (windows.length > 1) area.append(node('p', 'tab-window', windowId === ui.inventory.currentWindowId ? 'This window' : `Window ${index + 1}`));
      for (const tab of tabs.filter((item) => item.windowId === windowId)) {
        const label = node('label', 'tab-option'); const box = document.createElement('input'); box.type = 'checkbox'; box.checked = ui.selectedTabs.has(tab.id);
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
  }
}

async function loadInventory() {
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

function scheduleInventoryRefresh() {
  clearTimeout(inventoryTimer);
  inventoryTimer = setTimeout(() => action(loadInventory), 120);
}

async function chooseScope(value) {
  ui.scope = value;
  if (value !== 'current') {
    const allowed = await chrome.permissions.request({ permissions: ['tabs'] });
    if (!allowed) { show('Tab access was declined, so Link Meteor cannot list your open tabs. Capture This page, or choose another scope to be asked again.', 'error'); ui.scope = 'current'; document.querySelector('input[name="scope"][value="current"]').checked = true; renderInventory(); return; }
  }
  await loadInventory();
}

/* Capture report ----------------------------------------------------------------- */
const REPORT_STATUS = {
  success: { icon: 'i-check', label: (result) => (result.count ? plural(result.count, 'link') : 'No links') },
  denied: { icon: 'i-ban', label: () => 'Access denied' },
  unsupported: { icon: 'i-ban', label: () => 'Unsupported page' },
  error: { icon: 'i-alert', label: () => 'Capture failed' },
};

function captureReport(report, { source = 'workbench', key = '', createdAt = '' } = {}) {
  const box = $('capture-report'); box.replaceChildren(); box.hidden = false;
  ui.displayedReportKey = key;
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
  const batchPresent = report.capturedCount > 0 && currentCollection()?.links.some((link) => link.batchId === report.batchId);
  if (batchPresent) {
    const actions = node('div', 'report-actions');
    const only = node('button', 'link-btn', ui.batchFilter === report.batchId ? 'Show all links' : 'Show only these links'); only.type = 'button';
    only.addEventListener('click', () => {
      ui.batchFilter = ui.batchFilter === report.batchId ? '' : report.batchId;
      only.textContent = ui.batchFilter ? 'Show all links' : 'Show only these links';
      ui.page = 0; renderLinks();
    });
    actions.append(only); box.append(actions);
  }
}

function showContextReport(value) {
  if (!value?.report || !Array.isArray(value.report.results)) return;
  const key = JSON.stringify([value.createdAt, value.report.batchId, value.report.capturedCount]);
  if (key === ui.lastContextReportKey || key === ui.dismissedContextReportKey) return;
  ui.lastContextReportKey = key;
  captureReport(value.report, { source: 'context', key, createdAt: value.createdAt });
}

async function runCapture() {
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

async function download() {
  const result = makeExport(requiredRows(), { format: $('format').value, columns: ui.columns });
  const blob = new Blob([result.data], { type: result.mime });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = href; link.download = `${filename(currentCollection().name)}.${result.extension}`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 30000);
  show(`Downloaded ${link.download}.`);
}

async function copy(format, columns) {
  const rows = requiredRows();
  const result = makeExport(rows, { format, columns });
  await navigator.clipboard.writeText(result.data);
  const n = rows.length;
  show(format === 'text' ? `Copied ${plural(n, 'URL')}, one per line.`
    : format === 'markdown' ? `Copied ${plural(n, 'Markdown link')}.`
    : `Copied ${plural(n, 'row')} as a table (${columns.map(columnLabel).join(', ')}). Paste into any spreadsheet.`);
}

async function bookmark() {
  const rows = requiredRows();
  const links = rows.filter((row) => safeUrl(row.url)).map((row) => ({ anchorText: row.anchorText, url: row.url }));
  const skipped = rows.length - links.length;
  if (!links.length) throw new Error(`No HTTP(S) links are available to bookmark. ${skipped} non-web row${skipped === 1 ? ' was' : 's were'} skipped.`);
  const allowed = await chrome.permissions.request({ permissions: ['bookmarks'] });
  if (!allowed) throw new Error('Bookmark access was declined. Nothing was saved to your bookmarks.');
  const name = $('bookmark-name').value.trim() || currentCollection().name;
  const result = await request({ type: 'links.bookmark', name, links });
  show(`Created bookmark folder “${name}”: ${count(result.count)} saved, ${count(result.failed)} failed, ${count(skipped)} non-web row${skipped === 1 ? '' : 's'} skipped.`);
}

function openLinks() {
  const rows = requiredRows();
  const urls = [...new Set(rows.map((row) => safeUrl(row.url)).filter(Boolean))];
  const skipped = rows.filter((row) => !safeUrl(row.url)).length;
  if (!urls.length) throw new Error(`No HTTP(S) links are available to open. ${skipped} non-web row${skipped === 1 ? ' was' : 's were'} skipped.`);
  if (urls.length > 20) throw new Error(`${urls.length} unique HTTP(S) links are in the target and ${skipped} non-web rows would be skipped. Select at most 20 web links to open in one batch.`);
  ui.pendingOpen = urls;
  $('open-confirm-text').textContent = `Open ${plural(urls.length, 'web link')} in new background tabs?${skipped ? ` ${plural(skipped, 'non-web row')} will be skipped.` : ''}`;
  $('open-confirm-yes').textContent = `Open ${plural(urls.length, 'tab')}`;
  $('open-confirm').hidden = false;
  $('open-links').hidden = true;
  $('open-confirm-yes').focus();
}

function cancelOpen() {
  ui.pendingOpen = null;
  $('open-confirm').hidden = true;
  $('open-links').hidden = false;
}

async function confirmOpen() {
  const urls = ui.pendingOpen;
  if (!urls) return;
  const skipped = targetRows().filter((row) => !safeUrl(row.url)).length;
  cancelOpen(); $('open-links').focus();
  const result = await request({ type: 'links.open', urls });
  show(`Opened ${plural(result.opened, 'link')}; ${count(result.failed)} failed; ${count(skipped)} non-web row${skipped === 1 ? '' : 's'} skipped.`);
}

async function configureHold(enabled) {
  const origin = ui.currentOrigin;
  if (!origin) throw new Error('Open an HTTP(S) page to configure hold-key selection.');
  const key = $('hold-key').value.trim().toLowerCase();
  if (!/^[a-z]$/.test(key)) throw new Error('Choose one letter for the hold key.');
  if (enabled) {
    const allowed = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!allowed) throw new Error(`Site access for ${origin} was declined, so hold-key drag stays off there.`);
  }
  ui.state = await request({ type: 'hold.configure', origin, enabled, key });
  ui.holdKeyDraft = null;
  render(); show(enabled ? `Hold-key drag is on for ${origin}: hold ${key.toUpperCase()} and drag across links.` : `Hold-key drag is off for ${origin}.`);
}

/* Collection editor ------------------------------------------------------------- */
function openEditor() {
  $('collection-editor').hidden = false;
  $('edit-collection').setAttribute('aria-expanded', 'true');
  render();
  $('collection-name').focus();
}
function closeEditor() {
  $('collection-editor').hidden = true;
  $('delete-confirm').hidden = true;
  $('edit-collection').setAttribute('aria-expanded', 'false');
  if (ui.state) render();
}

function bindEvents() {
  $('open-full').addEventListener('click', () => action(async () => { await request({ type: 'ui.open' }); }));
  $('shortcut-settings').addEventListener('click', () => action(async () => { await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); }));
  $('collection-switch').addEventListener('click', (event) => setView('collections', event.currentTarget));
  $('rail-done').addEventListener('click', () => setView('links'));
  $('dock-export').addEventListener('click', (event) => setView('export', event.currentTarget));
  $('export-done').addEventListener('click', () => setView('links'));
  $('dock-copy').addEventListener('click', () => action(() => copy('tsv', ui.columns)));
  $('create-collection').addEventListener('submit', (event) => { event.preventDefault(); action(async () => { ui.page = 0; ui.batchFilter = ''; await mutate({ type: 'collection.create', name: $('new-collection').value.trim() }); $('new-collection').value = ''; ui.selectedIds.clear(); ui.openDetails.clear(); ui.detailLimits.clear(); renderLinks(); show('Collection created. New captures go here.'); }); });
  $('edit-collection').addEventListener('click', () => { $('collection-editor').hidden ? openEditor() : closeEditor(); });
  $('cancel-edit').addEventListener('click', () => { closeEditor(); $('edit-collection').focus(); });
  for (const id of ['collection-name', 'collection-notes', 'collection-tags']) $(id).addEventListener('input', () => {
    const collection = currentCollection();
    if (collection) ui.collectionDrafts.set(collection.id, { name: $('collection-name').value, notes: $('collection-notes').value, tags: $('collection-tags').value });
  });
  $('collection-details').addEventListener('submit', (event) => { event.preventDefault(); action(async () => {
    const id = currentCollection().id;
    await mutate({ type: 'collection.update', id, patch: { name: $('collection-name').value.trim(), notes: $('collection-notes').value, tags: tags($('collection-tags').value) } });
    ui.collectionDrafts.delete(id); render(); show('Collection details saved.');
  }); });
  $('delete-collection').addEventListener('click', () => {
    const collection = currentCollection();
    $('delete-confirm-text').textContent = `Delete “${collection.name}” and its ${plural(collection.links.length, 'saved link')}? This cannot be undone. Export first if you want a copy.`;
    $('delete-confirm').hidden = false; $('delete-confirm-no').focus();
  });
  $('delete-confirm-no').addEventListener('click', () => { $('delete-confirm').hidden = true; $('delete-collection').focus(); });
  $('delete-confirm-yes').addEventListener('click', () => action(async () => { const collection = currentCollection(); ui.page = 0; ui.batchFilter = ''; await mutate({ type: 'collection.delete', id: collection.id }); ui.collectionDrafts.delete(collection.id); for (const link of collection.links) ui.linkDrafts.delete(link.id); ui.selectedIds.clear(); ui.openDetails.clear(); ui.detailLimits.clear(); closeEditor(); renderLinks(); $('edit-collection').focus(); show(`Deleted “${collection.name}”.`); }));
  for (const id of filters) $(id).addEventListener(['search', 'domain', 'file-type'].includes(id) ? 'input' : 'change', () => action(async () => {
    if (id === 'direction') ui.directionTouched = true;
    if (id === 'sort' && $('sort').value === 'newest' && !ui.directionTouched) $('direction').value = 'desc';
    ui.page = 0;
    renderLinks();
  }));
  $('filters-toggle').addEventListener('click', () => {
    const open = $('filter-panel').hidden;
    $('filter-panel').hidden = !open;
    $('filters-toggle').setAttribute('aria-expanded', String(open));
    if (open) $('domain').focus();
  });
  $('select-all').addEventListener('change', (event) => { for (const id of ui.rows.slice(ui.page * PAGE_SIZE, (ui.page + 1) * PAGE_SIZE).flatMap((row) => row.occurrenceIds)) event.target.checked ? ui.selectedIds.add(id) : ui.selectedIds.delete(id); renderLinks(); });
  $('clear-selection').addEventListener('click', () => { ui.selectedIds.clear(); renderLinks(); $('select-all').focus(); });
  $('page-prev').addEventListener('click', () => { if (ui.page > 0) { ui.page--; renderLinks(); $('review').scrollIntoView({ block: 'start' }); } });
  $('page-next').addEventListener('click', () => { if ((ui.page + 1) * PAGE_SIZE < ui.rows.length) { ui.page++; renderLinks(); $('review').scrollIntoView({ block: 'start' }); } });
  $('remove').addEventListener('click', () => action(async () => { const ids = [...ui.selectedIds]; if (!ids.length) return; await mutate({ type: 'links.remove', ids }); ui.selectedIds.clear(); renderLinks(); show(`Removed ${plural(ids.length, 'link')}.`, 'notice', { actionLabel: 'Undo', onAction: undo }); }));
  $('undo').addEventListener('click', () => action(undo));
  for (const radio of document.querySelectorAll('input[name="scope"]')) radio.addEventListener('change', () => action(() => chooseScope(radio.value)));
  $('tabs-all').addEventListener('click', () => { for (const tab of ui.inventory?.tabs || []) ui.selectedTabs.add(tab.id); renderInventory(); });
  $('tabs-none').addEventListener('click', () => { ui.selectedTabs.clear(); renderInventory(); });
  $('capture').addEventListener('click', () => action(runCapture));
  $('arm').addEventListener('click', () => action(async () => { const result = await request({ type: 'capture.arm' }); const tab = ui.inventory?.tabs.find((item) => item.id === result.tabId); show(`Region selection is ready${tab?.title ? ` on “${tab.title}”` : ''}. Drag across links on the page; press Esc to cancel.`); }));
  $('format').addEventListener('change', renderExportTarget);
  $('add-column').addEventListener('change', (event) => { if (event.target.value) { ui.columns.push(event.target.value); renderColumns(); $('add-column').focus(); } });
  $('reset-columns').addEventListener('click', () => { ui.columns = [...DEFAULT_COLUMNS]; renderColumns(); $('add-column').focus(); });
  $('download').addEventListener('click', () => action(download));
  $('copy-table').addEventListener('click', () => action(() => copy('tsv', ui.columns)));
  $('copy-urls').addEventListener('click', () => action(() => copy('text', ui.columns)));
  $('copy-markdown').addEventListener('click', () => action(() => copy('markdown', ui.columns)));
  $('bookmark').addEventListener('click', () => action(bookmark));
  $('open-links').addEventListener('click', () => action(openLinks));
  $('open-confirm-yes').addEventListener('click', () => action(confirmOpen));
  $('open-confirm-no').addEventListener('click', () => { cancelOpen(); $('open-links').focus(); });
  $('hold-key').addEventListener('input', () => { ui.holdKeyDraft = $('hold-key').value; });
  $('hold-enabled').addEventListener('change', (event) => action(async () => { try { await configureHold(event.target.checked); } catch (error) { event.target.checked = !event.target.checked; throw error; } }));
  $('save-hold-key').addEventListener('click', () => action(async () => { const key = $('hold-key').value.trim().toLowerCase(); if (!/^[a-z]$/.test(key)) throw new Error('Choose one letter for the hold key.'); if (ui.currentOrigin && ui.state.settings.holdOrigins.includes(ui.currentOrigin)) { await configureHold(true); } else { await mutate({ type: 'settings.update', patch: { holdKey: key } }); show(`Hold key saved: ${key.toUpperCase()}.`); } ui.holdKeyDraft = null; renderSite(); }));
  document.addEventListener('keydown', (event) => {
    const typing = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
    if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); if ($('app').dataset.view !== 'links') setView('links'); $('search').focus(); $('search').select(); }
    if (event.key === 'Escape') {
      if (!$('open-confirm').hidden) { cancelOpen(); $('open-links').focus(); }
      else if (!$('delete-confirm').hidden) { $('delete-confirm').hidden = true; $('delete-collection').focus(); }
      else if ($('app').dataset.view !== 'links' && !typing) setView('links');
    }
  });
}

async function undo() { await mutate({ type: 'links.undo' }); show('Removal undone. The links are back in their original positions.'); }

async function reloadState() {
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

async function init() {
  bindEvents(); renderColumns();
  chrome.commands?.getAll?.().then((commands) => { ui.shortcut = commands.find((command) => command.name === 'select-region')?.shortcut || ''; renderShortcut(); if (ui.state) renderLinks(); }).catch(() => {});
  chrome.tabs?.getCurrent?.().then((tab) => { if (tab) $('open-full').hidden = true; }).catch(() => {});
  await reloadState();
  try { await loadInventory(); } catch (error) { ui.inventory = null; renderInventory(); show(`Current site preview unavailable: ${error.message}`, 'error'); }
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes.linkMeteorState) { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => action(reloadState), 80); }
    if (area === 'session' && changes.linkMeteorTarget?.newValue) scheduleInventoryRefresh();
    if (area === 'session' && changes.linkMeteorCaptureReport?.newValue) showContextReport(changes.linkMeteorCaptureReport.newValue);
    if (area === 'session' && changes.linkMeteorCaptureReportDismissed?.newValue) {
      ui.dismissedContextReportKey = changes.linkMeteorCaptureReportDismissed.newValue;
      if (ui.displayedReportKey === ui.dismissedContextReportKey) $('capture-report').hidden = true;
    }
  });
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
  chrome.runtime.onMessage.addListener((message) => { if (message?.type === 'state.changed') { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => action(reloadState), 80); } });
  chrome.tabs.onActivated.addListener(scheduleInventoryRefresh);
  chrome.tabs.onUpdated.addListener(scheduleInventoryRefresh);
  chrome.tabs.onRemoved.addListener(scheduleInventoryRefresh);
  chrome.windows.onFocusChanged.addListener(scheduleInventoryRefresh);
  chrome.permissions?.onAdded?.addListener(() => { ui.originAccess.clear(); renderInventory(); });
  chrome.permissions?.onRemoved?.addListener(() => { ui.originAccess.clear(); renderInventory(); });
  window.addEventListener('focus', scheduleInventoryRefresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleInventoryRefresh(); });
}

renderShortcut();
action(init);
