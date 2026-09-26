// Review and selection: filters, the link list, occurrence details, selection, removal and Undo.
import { queryLinks } from '../../core/model.js';
import { $, node, icon, button, count, plural, quoted, labelFor, tags, DOCUMENT_TYPES, fileType, appendTextLink, renderUrl, hostOf, formatTime, shortcutKeys, kbdGroup } from './helpers.js';
import { ui, action, mutate, show, currentCollection } from './state.js';
import { renderExportTarget } from './export.js';
import { syncReportAction } from './capture.js';

const PAGE_SIZE = 100;
const DETAIL_PAGE_SIZE = 100;
const ARRIVAL_MS = 2600;
const filters = ['search', 'domain', 'file-type', 'relation', 'sort', 'direction', 'dedupe'];

export function queryOptions() {
  return { search: $('search').value, domain: $('domain').value, fileType: $('file-type').value,
    relation: $('relation').value, sort: $('sort').value, direction: $('direction').value, dedupe: $('dedupe').value };
}

export function renderLinks() {
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
  const viewIds = result.rows.reduce((n, row) => n + row.occurrenceIds.length, 0);
  const selectedInView = result.rows.reduce((n, row) => n + row.occurrenceIds.filter((id) => ui.selectedIds.has(id)).length, 0);
  $('select-everything').hidden = !(pageCount > 1 && selectedOnPage === pageIds.length && pageIds.length && selectedInView < viewIds);
  $('select-everything').textContent = `Select all ${count(viewIds)}`;
  $('remove').disabled = !selectedInView;
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
  syncReportAction();
  const list = $('link-list');
  const focused = document.activeElement;
  const focusId = focused?.dataset?.linkId;
  const focusField = focused?.dataset?.linkField;
  const focusRowId = focused?.dataset?.rowId;
  const focusRowControl = focused?.matches?.('.row-select') ? 'checkbox' : focused?.matches?.('.row-details summary') ? 'summary' : '';
  const selectionStart = focusId ? focused.selectionStart : null;
  const selectionEnd = focusId ? focused.selectionEnd : null;
  list.replaceChildren(...pageRows.map(renderRow));
  if (focusId) {
    const replacement = [...list.querySelectorAll('input[data-link-id]')].find((input) => input.dataset.linkId === focusId && input.dataset.linkField === focusField);
    if (replacement) {
      replacement.focus({ preventScroll: true });
      if (selectionStart !== null && selectionEnd !== null) replacement.setSelectionRange(selectionStart, selectionEnd);
    }
  } else if (focusRowId && focusRowControl) {
    const selector = focusRowControl === 'checkbox' ? '.row-select' : '.row-details summary';
    [...list.querySelectorAll(selector)].find((control) => control.dataset.rowId === focusRowId)?.focus({ preventScroll: true });
  }
}

export function renderEmpty(collection, result) {
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

export function resetView() {
  $('search').value = ''; $('domain').value = ''; $('file-type').value = ''; $('relation').value = 'all';
  $('sort').value = 'page'; $('direction').value = 'asc'; $('dedupe').value = 'none';
  ui.batchFilter = ''; ui.directionTouched = false; ui.page = 0;
  renderLinks();
}

export function renderViewChips() {
  const chips = [];
  const add = (label, clear) => chips.push([label, clear]);
  if (ui.batchFilter) add('Selected capture', () => { ui.batchFilter = ''; });
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

export function renderSuggestions(collection) {
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

export function renderRow(row) {
  const mode = $('dedupe').value;
  const wrapper = node('article', 'link-row'); wrapper.setAttribute('role', 'listitem');
  const elapsed = Date.now() - ui.flashStart;
  if (ui.flashBatch && elapsed < ARRIVAL_MS && row.occurrences.some((link) => link.batchId === ui.flashBatch)) {
    wrapper.classList.add('is-new'); wrapper.style.animationDelay = `-${elapsed}ms`;
  }
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox'; checkbox.className = 'row-select';
  checkbox.dataset.rowId = row.id;
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
  summary.dataset.rowId = row.id;
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

export function fact(list, term, value, { exact = false, empty = 'None' } = {}) {
  const dt = node('dt', '', term);
  const dd = node('dd', exact ? 'exact' : '');
  if (value instanceof Node) dd.append(value);
  else if (value) dd.textContent = value;
  else dd.append(node('span', 'none', empty));
  list.append(dt, dd);
  return dd;
}

export function renderOccurrence(link, grouped) {
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

// The rows an export, copy, bookmark or open action uses: the selection if there is one,
// otherwise the whole filtered view.
export function targetRows() {
  if (!ui.selectedIds.size) return ui.rows;
  return ui.rows.flatMap((row) => {
    const occurrences = row.occurrences.filter((link) => ui.selectedIds.has(link.id));
    if (!occurrences.length) return [];
    return [{ ...occurrences[0], occurrences, occurrenceIds: occurrences.map((link) => link.id) }];
  });
}

export function requiredRows() {
  const rows = targetRows();
  if (!rows.length) throw new Error('No visible links to use. Adjust the filters or selection first.');
  return rows;
}

export async function undo() { await mutate({ type: 'links.undo' }); show('Removal undone. The links are back in their original positions.'); }

export function renderUndo() { $('undo').disabled = !ui.state.undo; }

export function bindReview() {
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
  $('select-everything').addEventListener('click', () => { const ids = ui.rows.flatMap((row) => row.occurrenceIds); for (const id of ids) ui.selectedIds.add(id); renderLinks(); $('select-all').focus(); show(`Selected all ${plural(ids.length, 'link')} in this view.`); });
  $('page-prev').addEventListener('click', () => { if (ui.page > 0) { ui.page--; renderLinks(); $('review').scrollIntoView({ block: 'start' }); } });
  $('page-next').addEventListener('click', () => { if ((ui.page + 1) * PAGE_SIZE < ui.rows.length) { ui.page++; renderLinks(); $('review').scrollIntoView({ block: 'start' }); } });
  $('remove').addEventListener('click', () => action(async () => { const ids = ui.rows.flatMap((row) => row.occurrenceIds.filter((id) => ui.selectedIds.has(id))); if (!ids.length) return; await mutate({ type: 'links.remove', ids }); show(`Removed ${plural(ids.length, 'link')}.`, 'notice', { actionLabel: 'Undo', onAction: undo }); }));
  $('undo').addEventListener('click', () => action(undo));
}
