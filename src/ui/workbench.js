import { queryLinks } from '../core/model.js';
import { COLUMNS, makeExport } from '../core/export.js';

const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 100;
const DETAIL_PAGE_SIZE = 100;
const ui = { state: null, inventory: null, rows: [], page: 0, selectedIds: new Set(), selectedTabs: new Set(), columns: ['anchorText', 'url'], scope: 'current', busy: false, currentOrigin: '', collectionDrafts: new Map(), linkDrafts: new Map(), openDetails: new Set(), detailLimits: new Map(), holdKeyDraft: null, directionTouched: false, lastContextReportKey: '', dismissedContextReportKey: '', displayedReportKey: '' };
const filters = ['search', 'domain', 'file-type', 'relation', 'sort', 'direction', 'dedupe'];
let reloadTimer, inventoryTimer, inventoryRequestSequence = 0;

function show(message, kind = 'notice') {
  const box = $(kind);
  const other = $(kind === 'notice' ? 'error' : 'notice');
  other.hidden = true;
  box.textContent = message;
  box.hidden = !message;
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
function labelFor(link) { return link.anchorText || link.accessibleLabel || '(textless link)'; }
function tags(value) { return [...new Set(value.split(',').map((part) => part.trim()).filter(Boolean))]; }
function filename(name) { return (name || 'links').normalize('NFKD').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'links'; }
function node(tag, className, value) { const item = document.createElement(tag); if (className) item.className = className; if (value !== undefined) item.textContent = value; return item; }
function appendTextLink(parent, value, display = value) {
  const href = safeUrl(value);
  if (!href) { parent.append(node('span', 'field-value', display || '(unavailable)')); return; }
  const link = node('a', 'field-value', display);
  link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
  parent.append(link);
}

function render() {
  const collection = currentCollection();
  if (!collection) return;
  $('collection-heading').textContent = collection.name;
  $('collection-count').textContent = `${ui.state.collections.length} collection${ui.state.collections.length === 1 ? '' : 's'}`;
  $('collection-summary').textContent = `${collection.links.length} captured occurrence${collection.links.length === 1 ? '' : 's'} · Saved locally`;
  const select = $('collections');
  select.replaceChildren();
  for (const item of ui.state.collections) {
    const option = new Option(`${item.name} (${item.links.length})`, item.id);
    select.add(option);
  }
  select.value = collection.id;
  const draft = ui.collectionDrafts.get(collection.id);
  $('collection-name').value = draft?.name ?? collection.name;
  $('collection-notes').value = draft?.notes ?? collection.notes;
  $('collection-tags').value = draft?.tags ?? collection.tags.join(', ');
  $('undo').disabled = !ui.state.undo;
  renderSite();
  renderLinks();
}

function renderSite() {
  if (!ui.state) return;
  $('hold-key').value = ui.holdKeyDraft ?? ui.state.settings.holdKey;
  $('hold-enabled').checked = !!ui.currentOrigin && ui.state.settings.holdOrigins.includes(ui.currentOrigin);
  $('hold-enabled').disabled = !ui.currentOrigin;
  $('site-origin').textContent = ui.currentOrigin || 'Current site unavailable';
}

function queryOptions() {
  return { search: $('search').value, domain: $('domain').value, fileType: $('file-type').value,
    relation: $('relation').value, sort: $('sort').value, direction: $('direction').value, dedupe: $('dedupe').value };
}

function renderLinks() {
  const collection = currentCollection();
  if (!collection) return;
  const result = queryLinks(collection.links, queryOptions());
  ui.rows = result.rows;
  const pageCount = Math.max(1, Math.ceil(result.rows.length / PAGE_SIZE));
  ui.page = Math.min(ui.page, pageCount - 1);
  const start = ui.page * PAGE_SIZE;
  const pageRows = result.rows.slice(start, start + PAGE_SIZE);
  const ids = new Set(collection.links.map((link) => link.id));
  ui.selectedIds = new Set([...ui.selectedIds].filter((id) => ids.has(id)));
  $('result-count').textContent = `${result.rows.length} row${result.rows.length === 1 ? '' : 's'} · ${result.matchedCount} matching of ${result.occurrenceCount} occurrences`;
  const pageIds = pageRows.flatMap((row) => row.occurrenceIds);
  const selectedOnPage = pageIds.filter((id) => ui.selectedIds.has(id)).length;
  $('selection-count').textContent = `${ui.selectedIds.size} occurrence${ui.selectedIds.size === 1 ? '' : 's'} selected overall · ${selectedOnPage} on this page`;
  $('export-scope').textContent = `${ui.selectedIds.size ? 'Selected visible occurrences' : 'Visible filtered rows'} are used. ${$('dedupe').value === 'none' ? 'Each row is one occurrence.' : 'Grouped rows use a representative link in table, text, and Markdown exports; JSON retains every occurrence and source.'}`;
  $('remove').disabled = !ui.selectedIds.size;
  $('select-all').checked = !!pageIds.length && pageIds.every((id) => ui.selectedIds.has(id));
  $('select-all').indeterminate = pageIds.some((id) => ui.selectedIds.has(id)) && !$('select-all').checked;
  $('select-all').disabled = !pageIds.length;
  $('page-range').textContent = result.rows.length ? `${start + 1}–${start + pageRows.length} of ${result.rows.length} rows · Page ${ui.page + 1} of ${pageCount}` : '0 rows';
  $('page-prev').disabled = ui.page === 0;
  $('page-next').disabled = ui.page >= pageCount - 1;
  $('review-pages').hidden = result.rows.length === 0;
  const empty = $('empty-state');
  empty.hidden = !!result.rows.length;
  if (!result.rows.length) {
    empty.querySelector('h3').textContent = collection.links.length ? 'No matching links' : 'No links yet';
    empty.querySelector('p').textContent = collection.links.length ? 'Adjust your filters to see more of this collection.' : 'Capture this page or select a region to begin a collection.';
  }
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

function renderRow(row) {
  const wrapper = node('article', 'link-row');
  const main = node('div', 'row-main');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox'; checkbox.className = 'row-select';
  checkbox.setAttribute('aria-label', `Select ${row.occurrenceIds.length} occurrence${row.occurrenceIds.length === 1 ? '' : 's'} for ${labelFor(row)}`);
  checkbox.checked = row.occurrenceIds.every((id) => ui.selectedIds.has(id));
  checkbox.indeterminate = row.occurrenceIds.some((id) => ui.selectedIds.has(id)) && !checkbox.checked;
  checkbox.addEventListener('change', () => {
    for (const id of row.occurrenceIds) checkbox.checked ? ui.selectedIds.add(id) : ui.selectedIds.delete(id);
    renderLinks();
  });
  const content = node('div', 'row-content');
  const kicker = node('div', 'row-kicker');
  kicker.append(node('span', '', row.occurrenceIds.length === 1 ? 'LINK OCCURRENCE' : `${row.occurrenceIds.length} OCCURRENCES`));
  kicker.append(node('span', '', (() => { try { return new URL(row.url).hostname; } catch { return 'Unknown domain'; } })()));
  content.append(kicker);
  const fields = node('div', 'row-fields');
  const anchor = node('div'); anchor.append(node('span', 'field-label', 'Anchor text'));
  anchor.append(node('span', `field-value${row.anchorText ? '' : ' empty-label'}`, row.anchorText || '(empty anchor text)'));
  const url = node('div'); url.append(node('span', 'field-label', 'URL')); appendTextLink(url, row.url);
  fields.append(anchor, url); content.append(fields);
  const source = node('div', 'row-source');
  source.append(document.createTextNode('Source · '));
  appendTextLink(source, row.sourceUrl, row.sourceTitle || row.sourceUrl || '(unknown page)');
  content.append(source);
  const mode = $('dedupe').value;
  const detailKey = JSON.stringify(mode === 'none' ? [mode, row.id] : [mode, row.url, mode === 'url-anchor' ? row.anchorText : '']);
  const details = document.createElement('details'); details.className = 'row-details';
  details.open = ui.openDetails.has(detailKey);
  const summary = node('summary', '', row.occurrences.length === 1 ? 'View source details' : `View all ${row.occurrences.length} source occurrences`);
  details.append(summary);
  const occurrences = node('ul', 'occurrence-list');
  occurrences.id = `occurrences-${row.id}`;
  const detailRange = node('p', 'detail-range'); detailRange.setAttribute('role', 'status'); detailRange.setAttribute('aria-live', 'polite');
  const more = node('button', 'button secondary detail-more'); more.type = 'button'; more.setAttribute('aria-controls', occurrences.id);
  let rendered = 0;
  function appendOccurrences(until) {
    const end = Math.min(until, row.occurrences.length);
    if (end > rendered) occurrences.append(...row.occurrences.slice(rendered, end).map(renderOccurrence));
    rendered = end;
    ui.detailLimits.set(detailKey, rendered);
    detailRange.textContent = `Showing ${rendered} of ${row.occurrences.length} source occurrence${row.occurrences.length === 1 ? '' : 's'}`;
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
      occurrences.replaceChildren(); rendered = 0;
    }
  });
  details.append(occurrences, detailRange, more); content.append(details);
  if (details.open) appendOccurrences(Math.max(DETAIL_PAGE_SIZE, ui.detailLimits.get(detailKey) || 0));
  main.append(checkbox, content); wrapper.append(main);
  return wrapper;
}

function renderOccurrence(link) {
  const item = node('li', 'occurrence');
  const title = node('p'); title.append(node('strong', '', 'Anchor: '), document.createTextNode(link.anchorText || '(empty)'));
  if (link.accessibleLabel) title.append(document.createTextNode(` · Accessible label: ${link.accessibleLabel}`));
  item.append(title);
  const source = node('p'); source.append(document.createTextNode('Page: ')); appendTextLink(source, link.sourceUrl, link.sourceTitle || link.sourceUrl || '(unknown)'); item.append(source);
  if (link.frameUrl && link.frameUrl !== link.sourceUrl) {
    const frame = node('p'); frame.append(document.createTextNode('Frame: ')); appendTextLink(frame, link.frameUrl); item.append(frame);
  }
  item.append(node('p', 'meta', `Original href: ${link.originalHref || '(empty)'} · Captured: ${link.capturedAt || '(unknown)'} · Batch: ${link.batchId || '(unknown)'}`));
  const form = document.createElement('form');
  const draft = ui.linkDrafts.get(link.id);
  const noteLabel = node('label', '', 'Note'); const noteInput = document.createElement('input'); noteInput.value = draft?.notes ?? link.notes; noteInput.dataset.linkId = link.id; noteInput.dataset.linkField = 'notes'; noteInput.setAttribute('aria-label', `Note for ${labelFor(link)}`); noteLabel.append(noteInput);
  const tagLabel = node('label', '', 'Tags'); const tagInput = document.createElement('input'); tagInput.value = draft?.tags ?? link.tags.join(', '); tagInput.dataset.linkId = link.id; tagInput.dataset.linkField = 'tags'; tagInput.setAttribute('aria-label', `Tags for ${labelFor(link)}`); tagLabel.append(tagInput);
  const keepDraft = () => ui.linkDrafts.set(link.id, { notes: noteInput.value, tags: tagInput.value });
  noteInput.addEventListener('input', keepDraft); tagInput.addEventListener('input', keepDraft);
  const save = node('button', 'button secondary', 'Save'); save.type = 'submit';
  form.append(noteLabel, tagLabel, save);
  form.addEventListener('submit', (event) => { event.preventDefault(); action(async () => { await mutate({ type: 'link.update', id: link.id, patch: { notes: noteInput.value, tags: tags(tagInput.value) } }); ui.linkDrafts.delete(link.id); show('Link details saved.'); }); });
  item.append(form);
  return item;
}

function renderColumns() {
  const area = $('columns'); area.replaceChildren();
  for (const [index, column] of ui.columns.entries()) {
    const item = node('div', 'column-item');
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = true;
    check.setAttribute('aria-label', `Include ${column}`);
    check.addEventListener('change', () => { if (!check.checked) { ui.columns.splice(index, 1); renderColumns(); } });
    const label = node('span', '', COLUMNS.find((item) => item.key === column)?.label || column);
    const up = node('button', '', '↑'); up.type = 'button'; up.disabled = index === 0; up.setAttribute('aria-label', `Move ${label.textContent} up`);
    up.addEventListener('click', () => { [ui.columns[index - 1], ui.columns[index]] = [ui.columns[index], ui.columns[index - 1]]; renderColumns(); });
    const down = node('button', '', '↓'); down.type = 'button'; down.disabled = index === ui.columns.length - 1; down.setAttribute('aria-label', `Move ${label.textContent} down`);
    down.addEventListener('click', () => { [ui.columns[index + 1], ui.columns[index]] = [ui.columns[index], ui.columns[index + 1]]; renderColumns(); });
    item.append(check, label, up, down); area.append(item);
  }
  const add = document.createElement('select'); add.setAttribute('aria-label', 'Add export column');
  add.add(new Option('Add a column…', ''));
  for (const column of COLUMNS.filter((item) => !ui.columns.includes(item.key))) add.add(new Option(column.label, column.key));
  add.addEventListener('change', () => { if (add.value) { ui.columns.push(add.value); renderColumns(); } });
  area.append(add);
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

function renderInventory() {
  if (!ui.inventory) {
    $('scope-preview').textContent = 'Tab preview unavailable. Reopen Link Meteor from an ordinary page or refresh the scope.';
    $('tab-picker').hidden = ui.scope !== 'selected';
    return;
  }
  const tabs = ui.inventory?.tabs || [];
  const chosen = ui.scope === 'selected' ? tabs.filter((tab) => ui.selectedTabs.has(tab.id)) : ui.scope === 'window' ? tabs.filter((tab) => tab.windowId === ui.inventory.currentWindowId) : tabs;
  const supported = chosen.filter((tab) => capturableUrl(tab.url)).length;
  const unknown = chosen.filter((tab) => !tab.url).length;
  const unsupported = chosen.length - supported - unknown;
  const target = tabs.find((tab) => tab.id === ui.inventory.targetTabId);
  if (ui.scope === 'current') {
    $('scope-preview').textContent = !target ? 'Current page could not be identified. Open a webpage and invoke Link Meteor there.' :
      !target.url ? 'Current tab identified, but its URL is unavailable. Capture will report whether it can be accessed.' :
      !capturableUrl(target.url) ? `Current tab is a browser or unsupported page (${target.url}). Capture will report this explicitly.` :
      `Current page: ${target.title || target.url}. Capture will report its link count and any coverage warnings.`;
  } else {
    $('scope-preview').textContent = `${chosen.length} tab${chosen.length === 1 ? '' : 's'} in scope · ${supported} HTTP(S) · ${unsupported} unsupported · ${unknown} access unknown. Each tab receives its own result.`;
  }
  $('tab-picker').hidden = ui.scope !== 'selected';
  if (ui.scope === 'selected') {
    const area = $('tab-options'); area.replaceChildren();
    for (const tab of tabs) {
      const label = document.createElement('label'); const box = document.createElement('input'); box.type = 'checkbox'; box.checked = ui.selectedTabs.has(tab.id);
      box.setAttribute('aria-label', `Include ${tab.title || tab.url || `tab ${tab.id}`}`);
      box.addEventListener('change', () => { box.checked ? ui.selectedTabs.add(tab.id) : ui.selectedTabs.delete(tab.id); renderInventory(); });
      const text = node('span', '', tab.title || `Tab ${tab.id}`);
      text.append(node('small', '', tab.url || 'URL unavailable'));
      label.append(box, text); area.append(label);
    }
    if (!tabs.length) area.append(node('p', 'help', 'No tabs available. Allow tab access to choose pages.'));
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
    if (!allowed) { show('Tab access was declined. Select Current page or grant tab access to preview other scopes.', 'error'); ui.scope = 'current'; document.querySelector('input[name="scope"][value="current"]').checked = true; renderInventory(); return; }
  }
  await loadInventory();
}

function captureReport(report, { source = 'workbench', key = '', createdAt = '' } = {}) {
  const box = $('capture-report'); box.replaceChildren(); box.hidden = false;
  ui.displayedReportKey = key;
  const heading = node('div', 'report-heading');
  heading.append(node('h3', '', `${source === 'context' ? 'Context-menu capture · ' : ''}${report.capturedCount} link occurrence${report.capturedCount === 1 ? '' : 's'} captured`));
  const dismiss = node('button', 'quiet', 'Dismiss'); dismiss.type = 'button'; dismiss.setAttribute('aria-label', 'Dismiss capture report');
  dismiss.addEventListener('click', () => action(async () => {
    box.hidden = true;
    if (key) {
      ui.dismissedContextReportKey = key;
      await chrome.storage.session.set({ linkMeteorCaptureReportDismissed: key });
    }
  }));
  heading.append(dismiss); box.append(heading);
  if (createdAt) {
    const time = new Date(createdAt);
    if (!Number.isNaN(time.valueOf())) box.append(node('p', 'report-time', `Captured ${time.toLocaleString()}`));
  }
  const list = node('ul');
  for (const result of report.results) {
    const detail = [result.status, result.status === 'success' ? `${result.count} links` : '', result.warning, result.error].filter(Boolean).join(' · ');
    list.append(node('li', '', `${result.title || result.url || `Tab ${result.tabId}`} — ${detail}`));
  }
  if (!report.results.length) list.append(node('li', '', 'No tab results were returned.'));
  box.append(list);
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
  ui.busy = true; $('capture').disabled = true;
  try {
    let tabIds = [];
    if (ui.scope !== 'current') {
      if (!ui.inventory) throw new Error('Tab preview is unavailable. Choose the scope again to refresh it.');
      const tabs = ui.inventory.tabs;
      const picked = ui.scope === 'selected' ? tabs.filter((tab) => ui.selectedTabs.has(tab.id)) : ui.scope === 'window' ? tabs.filter((tab) => tab.windowId === ui.inventory.currentWindowId) : tabs;
      if (!picked.length) throw new Error('Select at least one tab before capturing.');
      const origins = [...new Set(picked.map((tab) => originOf(tab.url)).filter(Boolean))];
      if (origins.length) {
        try {
          const granted = await chrome.permissions.request({ origins: origins.map((origin) => `${origin}/*`) });
          if (!granted) show('Some site access was declined. The capture report will identify denied pages.', 'notice');
        } catch (error) { show(`Site access request failed: ${error.message}. The capture report will identify denied pages.`, 'notice'); }
      }
      const freshInventory = await loadInventory();
      const freshTabs = freshInventory.tabs;
      const fresh = ui.scope === 'selected' ? freshTabs.filter((tab) => ui.selectedTabs.has(tab.id)) : ui.scope === 'window' ? freshTabs.filter((tab) => tab.windowId === freshInventory.currentWindowId) : freshTabs;
      if (fresh.some((tab) => originOf(tab.url) && !origins.includes(originOf(tab.url)))) throw new Error('Tab origins changed after the permission request. Review the scope and capture again.');
      if (fresh.length > 100) throw new Error(`${fresh.length} tabs are in scope. Select at most 100 tabs for each capture.`);
      tabIds = fresh.map((tab) => tab.id);
    }
    const { state, report } = await request({ type: 'capture.run', tabIds });
    ui.state = state; render(); captureReport(report);
    clearTimeout(inventoryTimer);
    let previewError;
    try { await loadInventory(); } catch (error) { previewError = error; }
    if (previewError) show(`Capture finished, but the current-site preview could not refresh: ${previewError.message}`, 'error');
    else show(`Capture finished: ${report.capturedCount} occurrence${report.capturedCount === 1 ? '' : 's'}. Review the per-tab report below.`);
  } finally { ui.busy = false; $('capture').disabled = false; }
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
  const result = makeExport(requiredRows(), { format, columns });
  await navigator.clipboard.writeText(result.data);
  show(`Copied ${targetRows().length} row${targetRows().length === 1 ? '' : 's'} as ${format === 'text' ? 'URLs' : format.toUpperCase()}.`);
}

async function bookmark() {
  const rows = requiredRows();
  const links = rows.filter((row) => safeUrl(row.url)).map((row) => ({ anchorText: row.anchorText, url: row.url }));
  const skipped = rows.length - links.length;
  if (!links.length) throw new Error(`No HTTP(S) links are available to bookmark. ${skipped} non-web row${skipped === 1 ? ' was' : 's were'} skipped.`);
  const allowed = await chrome.permissions.request({ permissions: ['bookmarks'] });
  if (!allowed) throw new Error('Bookmark access was declined.');
  const name = $('bookmark-name').value.trim() || currentCollection().name;
  const result = await request({ type: 'links.bookmark', name, links });
  show(`Created bookmark folder “${name}”: ${result.count} saved, ${result.failed} failed, ${skipped} non-web row${skipped === 1 ? '' : 's'} skipped.`);
}

async function openLinks() {
  const rows = requiredRows();
  const urls = [...new Set(rows.map((row) => safeUrl(row.url)).filter(Boolean))];
  const skipped = rows.filter((row) => !safeUrl(row.url)).length;
  if (!urls.length) throw new Error(`No HTTP(S) links are available to open. ${skipped} non-web row${skipped === 1 ? ' was' : 's were'} skipped.`);
  if (urls.length > 20) throw new Error(`${urls.length} unique HTTP(S) links are in the target and ${skipped} non-web rows would be skipped. Select at most 20 web links to open in one batch.`);
  if (!window.confirm(`Open ${urls.length} HTTP(S) link${urls.length === 1 ? '' : 's'} in new tabs? ${skipped} non-web row${skipped === 1 ? '' : 's'} will be skipped.`)) return;
  const result = await request({ type: 'links.open', urls });
  show(`Opened ${result.opened} link${result.opened === 1 ? '' : 's'}; ${result.failed} failed; ${skipped} non-web row${skipped === 1 ? '' : 's'} skipped.`);
}

async function configureHold(enabled) {
  const origin = ui.currentOrigin;
  if (!origin) throw new Error('Open an HTTP(S) page to configure hold-key selection.');
  const key = $('hold-key').value.trim().toLowerCase();
  if (!/^[a-z]$/.test(key)) throw new Error('Choose one letter for the hold key.');
  if (enabled) {
    const allowed = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!allowed) throw new Error(`Site access for ${origin} was declined.`);
  }
  ui.state = await request({ type: 'hold.configure', origin, enabled, key });
  ui.holdKeyDraft = null;
  render(); show(`Hold-key selection ${enabled ? 'enabled' : 'disabled'} for ${origin}.`);
}

function bindEvents() {
  $('open-full').addEventListener('click', () => action(async () => { await request({ type: 'ui.open' }); }));
  $('shortcut-settings').addEventListener('click', () => action(async () => { await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); }));
  $('collections').addEventListener('change', (event) => action(async () => { ui.page = 0; await mutate({ type: 'collection.activate', id: event.target.value }); ui.selectedIds.clear(); ui.openDetails.clear(); ui.detailLimits.clear(); renderLinks(); }));
  $('create-collection').addEventListener('submit', (event) => { event.preventDefault(); action(async () => { ui.page = 0; await mutate({ type: 'collection.create', name: $('new-collection').value.trim() }); $('new-collection').value = ''; ui.selectedIds.clear(); ui.openDetails.clear(); ui.detailLimits.clear(); renderLinks(); show('Collection created.'); }); });
  for (const id of ['collection-name', 'collection-notes', 'collection-tags']) $(id).addEventListener('input', () => {
    const collection = currentCollection();
    if (collection) ui.collectionDrafts.set(collection.id, { name: $('collection-name').value, notes: $('collection-notes').value, tags: $('collection-tags').value });
  });
  $('collection-details').addEventListener('submit', (event) => { event.preventDefault(); action(async () => {
    const id = currentCollection().id;
    await mutate({ type: 'collection.update', id, patch: { name: $('collection-name').value.trim(), notes: $('collection-notes').value, tags: tags($('collection-tags').value) } });
    ui.collectionDrafts.delete(id); render(); show('Collection details saved.');
  }); });
  $('delete-collection').addEventListener('click', () => action(async () => { const collection = currentCollection(); if (!window.confirm(`Delete “${collection.name}” and its ${collection.links.length} saved link occurrences? This cannot be undone.`)) return; ui.page = 0; await mutate({ type: 'collection.delete', id: collection.id }); ui.collectionDrafts.delete(collection.id); for (const link of collection.links) ui.linkDrafts.delete(link.id); ui.selectedIds.clear(); ui.openDetails.clear(); ui.detailLimits.clear(); renderLinks(); show('Collection deleted.'); }));
  for (const id of filters) $(id).addEventListener(['search', 'domain', 'file-type'].includes(id) ? 'input' : 'change', () => action(async () => {
    if (id === 'direction') ui.directionTouched = true;
    if (id === 'sort' && $('sort').value === 'newest' && !ui.directionTouched) $('direction').value = 'desc';
    ui.page = 0;
    renderLinks();
  }));
  $('select-all').addEventListener('change', (event) => { for (const id of ui.rows.slice(ui.page * PAGE_SIZE, (ui.page + 1) * PAGE_SIZE).flatMap((row) => row.occurrenceIds)) event.target.checked ? ui.selectedIds.add(id) : ui.selectedIds.delete(id); renderLinks(); });
  $('page-prev').addEventListener('click', () => { if (ui.page > 0) { ui.page--; renderLinks(); } });
  $('page-next').addEventListener('click', () => { if ((ui.page + 1) * PAGE_SIZE < ui.rows.length) { ui.page++; renderLinks(); } });
  $('remove').addEventListener('click', () => action(async () => { const ids = [...ui.selectedIds]; if (!ids.length) return; await mutate({ type: 'links.remove', ids }); ui.selectedIds.clear(); renderLinks(); show(`Removed ${ids.length} occurrence${ids.length === 1 ? '' : 's'}. Undo is available.`); }));
  $('undo').addEventListener('click', () => action(async () => { await mutate({ type: 'links.undo' }); show('Removal undone.'); }));
  for (const radio of document.querySelectorAll('input[name="scope"]')) radio.addEventListener('change', () => action(() => chooseScope(radio.value)));
  $('capture').addEventListener('click', () => action(runCapture));
  $('arm').addEventListener('click', () => action(async () => { const result = await request({ type: 'capture.arm' }); show(`Region selection armed on tab ${result.tabId}. Drag a rectangle on the page; press Escape to cancel.`); }));
  $('download').addEventListener('click', () => action(download));
  $('copy-table').addEventListener('click', () => action(() => copy('tsv', ui.columns)));
  $('copy-urls').addEventListener('click', () => action(() => copy('text', ui.columns)));
  $('copy-markdown').addEventListener('click', () => action(() => copy('markdown', ui.columns)));
  $('bookmark').addEventListener('click', () => action(bookmark));
  $('open-links').addEventListener('click', () => action(openLinks));
  $('hold-key').addEventListener('input', () => { ui.holdKeyDraft = $('hold-key').value; });
  $('hold-enabled').addEventListener('change', (event) => action(async () => { try { await configureHold(event.target.checked); } catch (error) { event.target.checked = !event.target.checked; throw error; } }));
  $('save-hold-key').addEventListener('click', () => action(async () => { const key = $('hold-key').value.trim().toLowerCase(); if (!/^[a-z]$/.test(key)) throw new Error('Choose one letter for the hold key.'); if (ui.currentOrigin && ui.state.settings.holdOrigins.includes(ui.currentOrigin)) { await configureHold(true); } else { await mutate({ type: 'settings.update', patch: { holdKey: key } }); show('Hold key saved.'); } ui.holdKeyDraft = null; renderSite(); }));
}

async function reloadState() { ui.state = await request({ type: 'state.get' }); render(); }
async function init() {
  bindEvents(); renderColumns();
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
  window.addEventListener('focus', scheduleInventoryRefresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleInventoryRefresh(); });
}

action(init);
