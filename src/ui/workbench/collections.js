// Collections: the header, the rail list, create, switch, edit and delete.
import { $, node, count, plural, tags } from './helpers.js';
import { ui, action, mutate, show, currentCollection } from './state.js';
import { render, setView, onEscape } from './rendering.js';
import { renderLinks } from './review.js';

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
  $('edit-collection').setAttribute('aria-expanded', 'false');
  if (ui.state) render();
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
}
