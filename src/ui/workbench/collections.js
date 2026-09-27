// Collections: the header, the rail list, create, switch, edit, empty and delete.
import { $, node, count, plural, tags } from './helpers.js';
import { ui, action, mutate, show, currentCollection } from './state.js';
import { render, setView, onEscape } from './rendering.js';
import { renderLinks, undo, focusUndo } from './review.js';
import { bindBackup } from './backup.js';

// "Empty this collection" awaiting confirmation: the collection and the links it will remove.
let pendingEmpty = null;

export function renderCollectionHeader(collection) {
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
  $('empty-collection').disabled = !collection.links.length;
  if (pendingEmpty && (pendingEmpty.collectionId !== collection.id || pendingEmpty.key !== collection.links.map((link) => link.id).join('\n'))) closeEmpty();
}

export function renderCollections() {
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

export async function activateCollection(id) {
  if (id !== ui.state.activeCollectionId) {
    ui.page = 0; ui.batchFilter = '';
    await mutate({ type: 'collection.activate', id });
    ui.selectedIds.clear(); ui.openDetails.clear(); ui.detailLimits.clear();
    closeEditor(); renderLinks();
  }
  setView('links');
}

/* Collection editor ------------------------------------------------------------- */
export function openEditor() {
  $('collection-editor').hidden = false;
  $('edit-collection').setAttribute('aria-expanded', 'true');
  render();
  $('collection-name').focus();
}
export function closeEditor() {
  $('collection-editor').hidden = true;
  $('delete-confirm').hidden = true;
  closeEmpty();
  $('edit-collection').setAttribute('aria-expanded', 'false');
  if (ui.state) render();
}

/* Empty this collection ---------------------------------------------------------- */
function openEmpty() {
  const collection = currentCollection();
  if (!collection?.links.length) return;
  const ids = collection.links.map((link) => link.id);
  pendingEmpty = { collectionId: collection.id, ids, key: ids.join('\n') };
  $('delete-confirm').hidden = true;
  $('empty-confirm-text').textContent = `Remove all ${plural(ids.length, 'link')} from “${collection.name}”? The collection keeps its name, notes and tags. You can undo this.`;
  $('empty-confirm-yes').textContent = `Remove ${plural(ids.length, 'link')}`;
  $('empty-confirm').hidden = false;
  $('empty-confirm-no').focus();
}

export function closeEmpty() {
  pendingEmpty = null;
  $('empty-confirm').hidden = true;
}

async function confirmEmpty() {
  const pending = pendingEmpty;
  if (!pending) return;
  const name = currentCollection()?.name || '';
  closeEmpty();
  await mutate({ type: 'links.remove', collectionId: pending.collectionId, ids: pending.ids });
  show(`Emptied “${name}”: removed ${plural(pending.ids.length, 'link')}.`, 'notice', { actionLabel: 'Undo', onAction: undo });
  focusUndo();
}

export function bindCollections() {
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
    closeEmpty();
    $('delete-confirm-text').textContent = `Delete “${collection.name}” and its ${plural(collection.links.length, 'saved link')}? This cannot be undone. Export first if you want a copy.`;
    $('delete-confirm').hidden = false; $('delete-confirm-no').focus();
  });
  $('delete-confirm-no').addEventListener('click', () => { $('delete-confirm').hidden = true; $('delete-collection').focus(); });
  $('delete-confirm-yes').addEventListener('click', () => action(async () => { const collection = currentCollection(); ui.page = 0; ui.batchFilter = ''; await mutate({ type: 'collection.delete', id: collection.id }); ui.collectionDrafts.delete(collection.id); for (const link of collection.links) ui.linkDrafts.delete(link.id); ui.selectedIds.clear(); ui.openDetails.clear(); ui.detailLimits.clear(); closeEditor(); renderLinks(); $('edit-collection').focus(); show(`Deleted “${collection.name}”.`); }));
  onEscape(() => {
    if ($('delete-confirm').hidden) return false;
    $('delete-confirm').hidden = true; $('delete-collection').focus();
    return true;
  });
  $('empty-collection').addEventListener('click', openEmpty);
  $('empty-confirm-yes').addEventListener('click', () => action(confirmEmpty));
  $('empty-confirm-no').addEventListener('click', () => { closeEmpty(); $('empty-collection').focus(); });
  onEscape(() => {
    if ($('empty-confirm').hidden) return false;
    closeEmpty(); $('empty-collection').focus();
    return true;
  });
  bindBackup();
}
