// Custom columns (0.4.0): the collection editor's list of columns, a text field per column in each
// link's details, Fill for selected links, and the name and length rules they share. Columns
// belong to one collection; their values are plain text on each link.
import { MAX_CUSTOM_FIELDS, MAX_FIELD_NAME, MAX_FIELD_VALUE } from '../../core/model.js';
import { $, node, button, count, plural, labelFor } from './helpers.js';
import { ui, action, request, mutate, show, currentCollection } from './state.js';
import { render, onEscape } from './rendering.js';

// Export column keys for custom columns, as core/export.js reads them.
export const FIELD_KEY = 'field:';
export const NAME_HELP = `Up to ${MAX_FIELD_NAME} characters.`;
export const FULL_MESSAGE = `This collection has ${MAX_CUSTOM_FIELDS} custom columns, the most it can have. Remove one to add another.`;

export function fieldsOf(collection = currentCollection()) { return collection?.fields || []; }
export function invalid(input, value) { if (value) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
export function cleanName(value) { return String(value).trim().replace(/\s+/gu, ' '); }

// Why a name can't be used, in words, or '' when it can. `except` is the column being renamed.
export function nameProblem(value, fields, except = '') {
  const name = cleanName(value);
  if (!name) return 'Type a name for the column.';
  if (name.length > MAX_FIELD_NAME) return `A column name can have up to ${MAX_FIELD_NAME} characters. This one has ${count(name.length)}.`;
  const same = fields.find((field) => field.id !== except && field.name.toLowerCase() === name.toLowerCase());
  return same ? `This collection already has a column named “${same.name}”. Choose another name.` : '';
}
export function nameHelp(value, fallback) {
  return cleanName(value).length >= MAX_FIELD_NAME ? `That's ${MAX_FIELD_NAME} characters, the most a column name can have.` : fallback;
}
export function valueProblem(name, value) {
  if (value.length <= MAX_FIELD_VALUE) return '';
  return `“${name}” can hold up to ${count(MAX_FIELD_VALUE)} characters. This text has ${count(value.length)}; shorten it by ${count(value.length - MAX_FIELD_VALUE)} to save it.`;
}

// Adds a column to the active collection and returns it; a name that can't be used throws its reason.
export async function addField(value) {
  const collection = currentCollection();
  const fields = fieldsOf(collection);
  if (fields.length >= MAX_CUSTOM_FIELDS) throw new Error(FULL_MESSAGE);
  const problem = nameProblem(value, fields);
  if (problem) throw new Error(problem);
  await mutate({ type: 'fields.add', collectionId: collection.id, name: cleanName(value) });
  const known = new Set(fields.map((field) => field.id));
  return fieldsOf(ui.state.collections.find((item) => item.id === collection.id)).find((field) => !known.has(field.id));
}

/* Link details and rows -------------------------------------------------------------- */
// One text field per custom column for a link's details form: `elements` go in the form after
// Tags. `drafted` holds unsaved values kept across renders. patch() returns what link.update
// saves, or throws when a value is too long.
export function fieldInputs(link, drafted = {}) {
  const note = node('p', 'help field-limit'); note.id = `field-limit-${link.id}`; note.hidden = true;
  const inputs = fieldsOf().map((field) => {
    const label = node('label', 'field-input', field.name);
    const input = document.createElement('input');
    input.value = drafted[field.id] ?? link.fields?.[field.id] ?? '';
    input.dataset.linkId = link.id; input.dataset.linkField = FIELD_KEY + field.id; input.autocomplete = 'off';
    input.setAttribute('aria-label', `${field.name} for ${labelFor(link)}`); input.setAttribute('aria-describedby', note.id);
    label.append(input);
    return { field, input, label };
  });
  const check = () => {
    const over = inputs.find(({ field, input }) => valueProblem(field.name, input.value));
    for (const { input } of inputs) invalid(input, input === over?.input);
    note.textContent = over ? valueProblem(over.field.name, over.input.value) : '';
    note.hidden = !over;
    return over;
  };
  for (const { input } of inputs) input.addEventListener('input', check);
  check();
  const values = () => Object.fromEntries(inputs.map(({ field, input }) => [field.id, input.value]));
  return {
    elements: inputs.length ? [...inputs.map((item) => item.label), note] : [],
    values,
    onInput(listener) { for (const { input } of inputs) input.addEventListener('input', listener); },
    patch() {
      const over = check();
      if (over) { over.input.focus(); throw new Error(valueProblem(over.field.name, over.input.value)); }
      return inputs.length ? { fields: values() } : {};
    },
  };
}

// A link's filled columns, shown under its row like its note.
export function hasFieldValues(row) { return fieldsOf().some((field) => row.fields?.[field.id]); }
export function appendFieldValues(parent, row) {
  for (const field of fieldsOf()) {
    const text = row.fields?.[field.id];
    if (!text) continue;
    const item = node('span', 'field-value'); item.title = `${field.name}: ${text}`;
    item.append(node('span', 'field-value-name', `${field.name}:`), ` ${text}`);
    parent.append(item);
  }
}

/* Fill for selected links -------------------------------------------------------------- */
// The selected links in the current view, as Remove uses them.
function selectedInView() { return ui.rows.flatMap((row) => row.occurrenceIds.filter((id) => ui.selectedIds.has(id))); }
function fillField(collection = currentCollection()) { return fieldsOf(collection).find((field) => field.id === $('fill-field').value); }

export function renderFill(collection) {
  const fields = fieldsOf(collection), ids = selectedInView();
  $('fill-fields').hidden = !fields.length || !ids.length;
  if ($('fill-fields').hidden) { closeFill(); return; }
  if ($('fill-panel').hidden) return;
  const select = $('fill-field'), chosen = select.value, key = JSON.stringify(fields);
  if (select.dataset.key !== key) {
    select.replaceChildren(...fields.map((field) => new Option(field.name, field.id)));
    select.dataset.key = key;
    if (fields.some((field) => field.id === chosen)) select.value = chosen;
  }
  describeFill(collection, ids);
}

function describeFill(collection = currentCollection(), ids = selectedInView()) {
  const field = fillField(collection);
  if (!field) return;
  const value = $('fill-value').value;
  const byId = new Map(collection.links.map((link) => [link.id, link]));
  const had = ids.filter((id) => byId.get(id)?.fields?.[field.id]).length;
  const replaced = ids.filter((id) => { const old = byId.get(id)?.fields?.[field.id]; return old && old !== value; }).length;
  const problem = valueProblem(field.name, value);
  $('fill-title').textContent = `Fill a column for ${plural(ids.length, 'selected link')}`;
  $('fill-help').textContent = problem || (value
    ? `Sets “${field.name}” to this text on ${plural(ids.length, 'link')}${replaced ? `, replacing ${plural(replaced, 'different value')}` : ''}. You can undo this.`
    : `Clears “${field.name}” on ${plural(ids.length, 'link')}${had ? `, removing ${plural(had, 'value')}` : ''}. You can undo this.`);
  $('fill-help').classList.toggle('is-problem', !!problem);
  invalid($('fill-value'), !!problem);
  $('fill-apply').textContent = value ? `Fill ${plural(ids.length, 'link')}` : `Clear the column for ${plural(ids.length, 'link')}`;
}

function openFill() {
  $('fill-panel').hidden = false;
  $('fill-fields').setAttribute('aria-expanded', 'true');
  renderFill(currentCollection());
  $('fill-field').focus();
}
export function closeFill() {
  $('fill-panel').hidden = true;
  $('fill-fields').setAttribute('aria-expanded', 'false');
}

async function applyFill() {
  const collection = currentCollection(), ids = selectedInView(), field = fillField(collection), value = $('fill-value').value;
  if (!field || !ids.length) return;
  const problem = valueProblem(field.name, value);
  if (problem) { $('fill-value').focus(); throw new Error(problem); }
  // Undo puts each link's earlier value back: one fill per distinct earlier value.
  const byId = new Map(collection.links.map((link) => [link.id, link]));
  const earlier = new Map();
  for (const id of ids) { const old = byId.get(id)?.fields?.[field.id] || ''; earlier.set(old, [...(earlier.get(old) || []), id]); }
  await mutate({ type: 'fields.fill', collectionId: collection.id, fieldId: field.id, ids, value });
  const undo = { collectionId: collection.id, fieldId: field.id, name: field.name, earlier: [...earlier] };
  $('fill-value').value = '';
  closeFill(); $('fill-fields').focus();
  show(`${value ? 'Filled' : 'Cleared'} “${field.name}” for ${plural(ids.length, 'link')}.`, 'notice', { actionLabel: 'Undo', onAction: () => undoFill(undo) });
}

async function undoFill({ collectionId, fieldId, name, earlier }) {
  for (const [value, ids] of earlier) ui.state = await request({ type: 'state.mutate', action: { type: 'fields.fill', collectionId, fieldId, ids, value } });
  render();
  show(`Put back the earlier values of “${name}”.`);
}

/* The collection editor's columns ------------------------------------------------------- */
let editing = null;        // {collectionId, fieldId, draft, problem}: a column being renamed
let pendingRemove = null;  // {collectionId, fieldId}: a removal awaiting confirmation
let removed = null;        // {collectionId, field, index, values, shown}: the last removal, for Undo
let listKey = '';

export function resetFieldEditor() {
  editing = null; closeRemove();
  if (removed) removed.shown = false;
  $('field-add-help').classList.remove('is-problem'); $('field-new').removeAttribute('aria-invalid');
  $('field-add-help').textContent = nameHelp($('field-new').value, NAME_HELP);
  listKey = '';
}

function filledCounts(collection) {
  const counts = new Map();
  for (const link of collection.links) for (const id of Object.keys(link.fields || {})) counts.set(id, (counts.get(id) || 0) + 1);
  return counts;
}

export function renderFieldEditor(collection) {
  const fields = fieldsOf(collection), counts = filledCounts(collection);
  if (editing && (editing.collectionId !== collection.id || !fields.some((field) => field.id === editing.fieldId))) editing = null;
  if (pendingRemove && (pendingRemove.collectionId !== collection.id || !fields.some((field) => field.id === pendingRemove.fieldId))) closeRemove();
  const full = fields.length >= MAX_CUSTOM_FIELDS;
  $('fields-count').textContent = `${count(fields.length)} of ${MAX_CUSTOM_FIELDS}`;
  $('field-new').disabled = full; $('field-add-button').disabled = full;
  if (full) { $('field-add-help').textContent = FULL_MESSAGE; $('field-add-help').classList.remove('is-problem'); }
  else if ($('field-add-help').textContent === FULL_MESSAGE) $('field-add-help').textContent = nameHelp($('field-new').value, NAME_HELP);
  $('fields-status').hidden = !removed?.shown || removed.collectionId !== collection.id;
  const key = JSON.stringify([collection.id, fields, [...counts], editing && [editing.fieldId, editing.problem]]);
  if (key === listKey) return;
  listKey = key;
  // Rebuilding the list keeps keyboard focus on the same control.
  const focused = document.activeElement?.closest?.('#fields-list [data-field-action]');
  const focus = focused && { id: focused.dataset.fieldId, action: focused.dataset.fieldAction, start: focused.selectionStart, end: focused.selectionEnd };
  $('fields-list').replaceChildren(...fields.map((field) => fieldItem(collection, field, counts.get(field.id) || 0)));
  if (focus) {
    const target = [...$('fields-list').querySelectorAll('[data-field-action]')].find((item) => item.dataset.fieldId === focus.id && item.dataset.fieldAction === focus.action);
    target?.focus({ preventScroll: true });
    if (target?.tagName === 'INPUT' && focus.start !== null) target.setSelectionRange(focus.start, focus.end);
  }
}

function control(item, fieldId, fieldAction) { item.dataset.fieldId = fieldId; item.dataset.fieldAction = fieldAction; return item; }

function fieldItem(collection, field, filled) {
  const item = node('li', 'field-item');
  if (editing?.fieldId === field.id) {
    const form = node('form', 'field-rename');
    const input = control(document.createElement('input'), field.id, 'name');
    input.value = editing.draft; input.maxLength = MAX_FIELD_NAME; input.autocomplete = 'off';
    input.setAttribute('aria-label', `New name for ${field.name}`);
    const help = node('p', `help field-rename-help${editing.problem ? ' is-problem' : ''}`, editing.problem || nameHelp(editing.draft, ''));
    help.id = 'field-rename-help'; help.setAttribute('aria-live', 'polite'); help.hidden = !help.textContent;
    input.setAttribute('aria-describedby', help.id);
    if (editing.problem) input.setAttribute('aria-invalid', 'true');
    input.addEventListener('input', () => {
      editing.draft = input.value; editing.problem = '';
      input.removeAttribute('aria-invalid'); help.classList.remove('is-problem');
      help.textContent = nameHelp(input.value, ''); help.hidden = !help.textContent;
    });
    const save = control(button('Save', 'btn primary small'), field.id, 'save'); save.type = 'submit';
    save.setAttribute('aria-label', `Save the new name for ${field.name}`);
    const cancel = control(button('Cancel', 'btn quiet small'), field.id, 'cancel');
    cancel.addEventListener('click', () => stopRename(field.id));
    form.addEventListener('submit', (event) => { event.preventDefault(); action(() => saveRename(collection.id, field.id)); });
    form.append(input, save, cancel, help);
    item.append(form);
    return item;
  }
  const rename = control(button('Rename', 'btn quiet small'), field.id, 'rename');
  rename.setAttribute('aria-label', `Rename ${field.name}`);
  rename.addEventListener('click', () => startRename(collection.id, field));
  const remove = control(button('Remove', 'btn quiet small danger'), field.id, 'remove');
  remove.setAttribute('aria-label', `Remove ${field.name}`);
  remove.addEventListener('click', () => openRemove(collection.id, field.id));
  item.append(node('span', 'field-name', field.name), node('span', 'field-filled', filled ? plural(filled, 'value') : 'No values yet'), rename, remove);
  item.title = field.name;
  return item;
}

function startRename(collectionId, field) {
  closeRemove();
  editing = { collectionId, fieldId: field.id, draft: field.name, problem: '' };
  renderFieldEditor(currentCollection());
  const input = $('fields-list').querySelector('input[data-field-action="name"]');
  input?.focus(); input?.select();
}

function stopRename(fieldId) {
  editing = null;
  renderFieldEditor(currentCollection());
  $('fields-list').querySelector(`[data-field-action="rename"][data-field-id="${CSS.escape(fieldId)}"]`)?.focus();
}

async function saveRename(collectionId, fieldId) {
  const collection = currentCollection();
  const fields = fieldsOf(collection), field = fields.find((item) => item.id === fieldId);
  if (!field || collection.id !== collectionId || !editing) { stopRename(fieldId); return; }
  const problem = nameProblem(editing.draft, fields, fieldId);
  if (problem) {
    editing.problem = problem;
    renderFieldEditor(collection);
    $('fields-list').querySelector('input[data-field-action="name"]')?.focus();
    return;
  }
  const name = cleanName(editing.draft);
  if (name !== field.name) await mutate({ type: 'fields.rename', collectionId, fieldId, name });
  stopRename(fieldId);
  if (name !== field.name) show(`Renamed the column “${field.name}” to “${name}”.`);
}

function openRemove(collectionId, fieldId) {
  const collection = currentCollection(), field = fieldsOf(collection).find((item) => item.id === fieldId);
  if (!field) return;
  editing = null;
  pendingRemove = { collectionId, fieldId };
  const filled = collection.links.filter((link) => link.fields?.[fieldId]).length;
  $('field-remove-confirm-text').textContent = `Remove the column “${field.name}”${filled ? ` and its values in ${plural(filled, 'link')}` : ''}? You can undo this.`;
  $('field-remove-confirm').hidden = false;
  renderFieldEditor(collection);
  $('field-remove-confirm-no').focus();
}

function closeRemove() {
  pendingRemove = null;
  $('field-remove-confirm').hidden = true;
}

function focusRemove(fieldId) {
  $('fields-list').querySelector(`[data-field-action="remove"][data-field-id="${CSS.escape(fieldId)}"]`)?.focus();
}

async function confirmRemove() {
  const pending = pendingRemove;
  if (!pending) return;
  closeRemove();
  const collection = currentCollection();
  const fields = fieldsOf(collection), index = fields.findIndex((field) => field.id === pending.fieldId);
  if (collection.id !== pending.collectionId || index < 0) return;
  const field = fields[index];
  const values = Object.fromEntries(collection.links.filter((link) => link.fields?.[field.id]).map((link) => [link.id, link.fields[field.id]]));
  await mutate({ type: 'fields.remove', collectionId: collection.id, fieldId: field.id });
  const entry = removed = { collectionId: collection.id, field, index, values, shown: true };
  const n = Object.keys(values).length;
  const message = `Removed the column “${field.name}”${n ? ` and its values in ${plural(n, 'link')}` : ''}.`;
  $('fields-status-text').textContent = message;
  $('fields-status').hidden = false;
  $('field-undo').focus();
  show(message, 'notice', { actionLabel: 'Undo', onAction: () => undoRemove(entry) });
}

async function undoRemove(undo = removed) {
  if (!undo) return;
  const collection = ui.state.collections.find((item) => item.id === undo.collectionId);
  if (!collection) throw new Error('That collection no longer exists, so the column can\'t be put back.');
  const fields = fieldsOf(collection);
  if (fields.length >= MAX_CUSTOM_FIELDS) throw new Error(`“${collection.name}” already has ${MAX_CUSTOM_FIELDS} custom columns, the most it can have. Remove one, then undo again.`);
  const clash = fields.find((field) => field.id !== undo.field.id && field.name.toLowerCase() === undo.field.name.toLowerCase());
  if (clash) throw new Error(`“${collection.name}” now has another column named “${clash.name}”, so “${undo.field.name}” can't be put back. Rename that column, then undo again.`);
  await mutate({ type: 'fields.restore', collectionId: undo.collectionId, field: undo.field, index: undo.index, values: undo.values });
  if (removed === undo) { removed = null; $('fields-status').hidden = true; }
  const n = Object.keys(undo.values).length;
  show(`Put back the column “${undo.field.name}”${n ? ` and its values in ${plural(n, 'link')}` : ''}.`);
  $('fields-list').querySelector(`[data-field-action="rename"][data-field-id="${CSS.escape(undo.field.id)}"]`)?.focus();
}

async function submitNew() {
  const input = $('field-new'), help = $('field-add-help');
  try {
    const field = await addField(input.value);
    input.value = '';
    help.classList.remove('is-problem'); input.removeAttribute('aria-invalid');
    help.textContent = NAME_HELP;
    show(`Added the column “${field.name}”. Fill it in each link's details, or select links and use Fill for selected links.`);
    if (!input.disabled) input.focus();
  } catch (error) {
    help.textContent = error.message; help.classList.add('is-problem');
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }
}

export function bindFieldEditor() {
  $('field-add').addEventListener('submit', (event) => { event.preventDefault(); action(submitNew); });
  $('field-new').addEventListener('input', () => {
    $('field-new').removeAttribute('aria-invalid'); $('field-add-help').classList.remove('is-problem');
    $('field-add-help').textContent = nameHelp($('field-new').value, NAME_HELP);
  });
  $('field-remove-confirm-yes').addEventListener('click', () => action(confirmRemove));
  $('field-remove-confirm-no').addEventListener('click', () => { const id = pendingRemove?.fieldId; closeRemove(); if (id) focusRemove(id); });
  $('field-undo').addEventListener('click', () => action(undoRemove));
  onEscape(() => {
    if (!$('field-remove-confirm').hidden) { const id = pendingRemove?.fieldId; closeRemove(); if (id) focusRemove(id); return true; }
    if (editing) { stopRename(editing.fieldId); return true; }
    return false;
  });
}

// Fill for selected links, in the list toolbar.
export function bindFill() {
  $('fill-fields').addEventListener('click', () => { $('fill-panel').hidden ? openFill() : closeFill(); });
  $('fill-field').addEventListener('change', () => describeFill());
  $('fill-value').addEventListener('input', () => describeFill());
  $('fill-panel').addEventListener('submit', (event) => { event.preventDefault(); action(applyFill); });
  $('fill-cancel').addEventListener('click', () => { closeFill(); $('fill-fields').focus(); });
  onEscape(() => {
    if ($('fill-panel').hidden) return false;
    closeFill(); $('fill-fields').focus();
    return true;
  });
}
