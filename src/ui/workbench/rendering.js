// Page frame: the render pass, compact views and page-level keys.
import { $ } from './helpers.js';
import { ui, action, request, currentCollection } from './state.js';
import { renderCollectionHeader } from './collections.js';
import { renderBookmarkDefaults } from './bookmarks.js';
import { renderUndo, renderLinks } from './review.js';
import { renderSite } from './settings.js';

const renderHooks = [];
// Area modules can add to every render pass. Hooks run after the built-in sections, in order.
export function onRender(hook) { renderHooks.push(hook); }

export function render() {
  const collection = currentCollection();
  if (!collection) return;
  renderCollectionHeader(collection);
  renderBookmarkDefaults(collection);
  renderUndo();
  renderSite();
  renderLinks();
  for (const hook of renderHooks) hook(collection);
}

/* Views (compact layout) ---------------------------------------------------- */
export function setView(view, returnFocus = null) {
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

const escapeHandlers = [];
// Escape closes one open confirmation: the first handler that returns true, in registration
// order. Otherwise it leaves the collections or export view.
export function onEscape(handler) { escapeHandlers.push(handler); }

export function bindViews() {
  $('open-full').addEventListener('click', () => action(async () => { await request({ type: 'ui.open' }); }));
  $('collection-switch').addEventListener('click', (event) => setView('collections', event.currentTarget));
  $('rail-done').addEventListener('click', () => setView('links'));
  $('dock-export').addEventListener('click', (event) => setView('export', event.currentTarget));
  $('export-done').addEventListener('click', () => setView('links'));
  document.addEventListener('keydown', (event) => {
    const typing = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
    if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); if ($('app').dataset.view !== 'links') setView('links'); $('search').focus(); $('search').select(); }
    if (event.key === 'Escape' && !escapeHandlers.some((handler) => handler())) {
      if ($('app').dataset.view !== 'links' && !typing) setView('links');
    }
  });
}

// The full view in its own tab has no need for the Open full view button.
export function hideOpenFullInTab() {
  chrome.tabs?.getCurrent?.().then((tab) => { if (tab) $('open-full').hidden = true; }).catch(() => {});
}
