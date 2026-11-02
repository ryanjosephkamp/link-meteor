// Move to… and Copy to… (0.5.0 RC2): the selected links, or one link from its details, to another
// collection or a new one. The panel says beforehand what will happen; the background does it in
// one write (links.transfer), and the notice's Undo puts both collections back (links.transferUndo).
import { $, button, plural, quoted, labelFor } from './helpers.js';
import { ui, request, action, show, currentCollection } from './state.js';
import { render, onEscape } from './rendering.js';

const NEW = '__new', MAX_NAME = 120;
let pending = null; // {mode, ids (null: the selection), collectionId, returnFocus}

function selectedInView() { return ui.rows.flatMap((row) => row.occurrenceIds.filter((id) => ui.selectedIds.has(id))); }
function chosenIds() { return pending?.ids || selectedInView(); }
function joined(items) { return items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`; }
function cleanName() { return $('move-new').value.replace(/\s+/g, ' ').trim(); }

// Every other collection, then New collection…; rebuilt only when those change, keeping the choice.
function fillDestinations(collection, reset = false) {
  const others = ui.state.collections.filter((item) => item.id !== collection.id);
  const select = $('move-to'), chosen = select.value, key = JSON.stringify(others.map((item) => [item.id, item.name, item.links.length]));
  if (select.dataset.key !== key) {
    select.replaceChildren(...others.map((item) => new Option(`${item.name} (${plural(item.links.length, 'link')})`, item.id)), new Option('New collection…', NEW));
    select.dataset.key = key;
    if ([...select.options].some((option) => option.value === chosen)) select.value = chosen;
  }
  if (reset) select.value = others[0]?.id || NEW;
}

// What the move or copy would do, from the saved state: the links that go, the ones already there,
// and the columns it would add. The background decides again when it's done.
function plan(collection) {
  const ids = new Set(chosenIds()), links = collection.links.filter((link) => ids.has(link.id));
  const isNew = $('move-to').value === NEW, name = cleanName();
  const destination = isNew ? null : ui.state.collections.find((item) => item.id === $('move-to').value);
  const held = new Set(destination?.links.map((link) => link.url) || []);
  const going = links.filter((link) => !held.has(link.url));
  const withValues = (collection.fields || []).filter((field) => going.some((link) => link.fields?.[field.id]));
  const there = new Set((destination?.fields || []).map((field) => field.name.toLowerCase()));
  const where = isNew ? (name ? `“${name}”` : 'a new collection') : `“${destination?.name}”`;
  let problem = '';
  if (isNew && !name) problem = 'Name the new collection.';
  else if (isNew && name.length > MAX_NAME) problem = `A collection name can be at most ${MAX_NAME} characters.`;
  else if (!isNew && !destination) problem = 'Choose where the links go.';
  else if (!going.length) problem = links.length === 1 ? `That link is already in ${where}.` : `All ${plural(links.length, 'link')} are already in ${where}.`;
  return { links, going, staying: links.length - going.length, columns: withValues.length, added: withValues.filter((field) => !there.has(field.name.toLowerCase())).map((field) => `“${field.name}”`), where, isNew, problem };
}

function describe(collection) {
  const move = pending.mode === 'move', p = plan(collection);
  $('move-title').textContent = pending.ids
    ? `${move ? 'Move' : 'Copy'} ${quoted(labelFor(p.links[0] || {}))} to another collection`
    : `${move ? 'Move' : 'Copy'} ${plural(p.links.length, 'selected link')} to another collection`;
  $('move-new-row').hidden = !p.isNew;
  $('move-help').textContent = p.problem || [
    `${move ? 'Moves' : 'Copies'} ${plural(p.going.length, 'link')} to ${p.where}, with ${p.going.length === 1 ? 'its' : 'their'} notes, tags, reading status and star${p.columns ? ', and custom columns' : ''}.`,
    p.staying ? `${plural(p.staying, 'link is', 'links are')} already there and ${move ? `${p.staying === 1 ? 'stays' : 'stay'} here` : `won’t be copied`}.` : '',
    p.added.length ? `Adds the ${p.added.length === 1 ? 'column' : 'columns'} ${joined(p.added)} there.` : '',
    'You can undo this.',
  ].filter(Boolean).join(' ');
  $('move-help').classList.toggle('is-problem', !!p.problem);
  $('move-apply').textContent = `${move ? 'Move' : 'Copy'} ${plural(p.going.length, 'link')}`;
  $('move-apply').disabled = !!p.problem;
  if (p.isNew) $('move-new').setAttribute('aria-invalid', String(!!p.problem && /name/i.test(p.problem))); else $('move-new').removeAttribute('aria-invalid');
}

// The buttons show while links in this view are selected; an open panel follows the saved state
// and closes when the links it names are gone.
export function renderMove(collection) {
  const selected = selectedInView().length > 0;
  $('move-selected').hidden = !selected; $('copy-selected').hidden = !selected;
  if (!pending || $('move-panel').hidden) return;
  const present = new Set(collection.links.map((link) => link.id)), ids = chosenIds();
  if (pending.collectionId !== collection.id || !ids.length || ids.some((id) => !present.has(id))) { closeMove(); return; }
  fillDestinations(collection);
  describe(collection);
}

export function openMove(mode, ids = null, returnFocus = document.activeElement) {
  const collection = currentCollection();
  if (!collection) return;
  pending = { mode, ids, collectionId: collection.id, returnFocus };
  $('move-new').value = '';
  $('move-panel').hidden = false;
  $('move-selected').setAttribute('aria-expanded', String(mode === 'move' && !ids));
  $('copy-selected').setAttribute('aria-expanded', String(mode === 'copy'));
  fillDestinations(collection, true);
  describe(collection);
  $('move-panel').scrollIntoView({ block: 'nearest' });
  $('move-to').focus();
}

export function closeMove() {
  pending = null;
  $('move-panel').hidden = true;
  $('move-selected').setAttribute('aria-expanded', 'false');
  $('copy-selected').setAttribute('aria-expanded', 'false');
}

function cancel() {
  const back = pending?.returnFocus;
  closeMove();
  if (back?.isConnected) back.focus(); else $('select-all').focus();
}

async function applyMove() {
  const collection = currentCollection();
  if (!pending || !collection) return;
  const p = plan(collection);
  if (p.problem) { (p.isNew ? $('move-new') : $('move-to')).focus(); throw new Error(p.problem); }
  const { mode, returnFocus } = pending, ids = chosenIds();
  const result = await request({ type: 'links.transfer', mode, fromCollectionId: collection.id, ids, ...(p.isNew ? { newCollection: cleanName() } : { toCollectionId: $('move-to').value }) });
  ui.state = result.state;
  if (mode === 'move') for (const id of ids) ui.selectedIds.delete(id);
  closeMove();
  render();
  const skipped = !result.skipped ? '' : mode === 'move'
    ? ` ${plural(result.skipped, 'link was', 'links were')} already there and stayed here.`
    : ` ${plural(result.skipped, 'link was', 'links were')} already there, so ${result.skipped === 1 ? 'it wasn’t' : 'they weren’t'} copied.`;
  const columns = result.fields ? ` Added ${plural(result.fields, 'column')} there.` : '';
  show(`${mode === 'move' ? 'Moved' : 'Copied'} ${plural(result.moved, 'link')} to “${result.name}”.${skipped}${columns}`, 'notice', { actionLabel: 'Undo', onAction: () => undoMove(result) });
  (returnFocus?.isConnected ? returnFocus : $('select-all')).focus();
}

async function undoMove({ transferId, mode, name }) {
  const result = await request({ type: 'links.transferUndo', transferId });
  ui.state = result.state;
  render();
  show(mode === 'move'
    ? `Move undone: the links are back where they were${result.collectionRemoved ? `, and “${name}” is removed` : ''}.`
    : `Copy undone: removed the copies${result.collectionRemoved ? ` and “${name}”` : ` from “${name}”`}.`);
}

// Move to… in a link's details: the same panel, for that one link.
export function detailMove(link) {
  const move = button('Move to…', 'btn small', 'i-folders');
  move.setAttribute('aria-label', `Move ${labelFor(link)} to another collection`);
  move.setAttribute('aria-controls', 'move-panel');
  move.addEventListener('click', () => openMove('move', [link.id], move));
  return move;
}

export function bindMove() {
  $('move-selected').addEventListener('click', () => openMove('move'));
  $('copy-selected').addEventListener('click', () => openMove('copy'));
  $('move-to').addEventListener('change', () => { describe(currentCollection()); if ($('move-to').value === NEW) $('move-new').focus(); });
  $('move-new').addEventListener('input', () => describe(currentCollection()));
  $('move-panel').addEventListener('submit', (event) => { event.preventDefault(); action(applyMove); });
  $('move-cancel').addEventListener('click', cancel);
  onEscape(() => {
    if ($('move-panel').hidden) return false;
    cancel();
    return true;
  });
}
