// The capture card on a webpage: saving to a chosen collection, copying, opening, downloading and
// bookmarking the links still ticked in its preview, and opening the full view at that capture.
// The contracts are in docs/CONTRACTS.md ("The capture card").
import {exportFileName, makeExport} from '../core/export.js';
import {serial, readState, mutate} from './store.js';
import {bookmarkLinks} from './bookmarks.js';
import {openUrls, webUrls} from './open.js';

export const WORKBENCH = chrome.runtime.getURL('ui/workbench.html');
export const OPEN_INTENT_KEY = 'linkMeteorOpenIntent';
const COPY_FORMATS = new Set(['tsv', 'text', 'markdown']);
const MISSING_DESTINATION = 'The chosen collection no longer exists, so nothing was saved. Choose another destination.';

// Capture candidates become stored occurrences: validated URL schemes, strings everywhere, and the
// page's own URL and title as provenance.
export function occurrences(candidates, tab, batchId) {
  if (!Array.isArray(candidates) || candidates.length > 20000) throw new Error('A capture can contain at most 20,000 links. Select a smaller region.');
  const capturedAt = new Date().toISOString();
  return candidates.map(candidate => {
    const url = new URL(String(candidate?.url));
    if (!['http:','https:','mailto:','tel:'].includes(url.protocol)) throw new Error('Capture contained an unsupported link scheme.');
    const text = key => typeof candidate[key] === 'string' ? candidate[key] : '';
    return {id:crypto.randomUUID(),anchorText:text('anchorText'),accessibleLabel:text('accessibleLabel'),url:url.href,
      originalHref:text('originalHref'),sourceUrl:tab.url || text('sourceUrl'),sourceTitle:tab.title || text('sourceTitle'),
      frameUrl:text('frameUrl'),capturedAt,batchId,notes:'',tags:[]};
  });
}

function pageTab(sender, action) {
  if (!sender.tab?.id) throw new Error(`${action} must start from the capture card on a webpage.`);
  return sender.tab;
}

function optionalId(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('Choose a destination collection.');
  return value;
}

// The destination collection: the chosen one when it still exists, otherwise the active one.
function destination(state, collectionId) {
  return state.collections.find(c => c.id === collectionId) || state.collections.find(c => c.id === state.activeCollectionId);
}

// ui.open: the full view in a new tab. With a view or batch, the workbench applies it once.
export async function openWorkbench({view, batchId} = {}) {
  if (view !== undefined && view !== 'links' && view !== 'export') throw new Error("Open the full view at 'links' or 'export'.");
  if (batchId !== undefined && (typeof batchId !== 'string' || !batchId)) throw new Error('The capture to show is not valid.');
  if (view !== undefined || batchId !== undefined) {
    await chrome.storage.session.set({[OPEN_INTENT_KEY]: {view: view || 'links', batchId: batchId || '', createdAt: new Date().toISOString()}}).catch(() => {});
  }
  await chrome.tabs.create({url: WORKBENCH});
  return {};
}

// capture.commit: saves the ticked links to the chosen collection (default: the active one).
export async function commitCapture(message, sender, {remember = async () => {}} = {}) {
  const tab = pageTab(sender, 'Saving');
  const collectionId = optionalId(message.collectionId);
  const batchId = crypto.randomUUID();
  const links = occurrences(message.links, tab, batchId);
  let state;
  if (links.length) {
    try { state = await mutate({type: 'links.append', ...(collectionId ? {collectionId} : {}), links}); }
    catch (error) { throw /^Collection not found/.test(error.message) ? new Error(MISSING_DESTINATION) : error; }
  } else {
    state = await serial(readState);
    if (collectionId && !state.collections.some(c => c.id === collectionId)) throw new Error(MISSING_DESTINATION);
  }
  await remember(tab).catch(() => {});
  let warning = '';
  if (message.review) {
    try { await openWorkbench(links.length ? {view: 'links', batchId} : {}); }
    catch { warning = 'Your links were saved, but the review tab could not open. Open Link Meteor from the toolbar to review them.'; }
  }
  return {state, count: links.length, warning};
}

function base64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Messages from the capture card. Each needs a sender tab, except collections.list.
export const pageMessages = {
  'collections.list': async () => {
    const state = await serial(readState);
    return {activeCollectionId: state.activeCollectionId, collections: state.collections.map(c => ({id: c.id, name: c.name, count: c.links.length}))};
  },
  'capture.copy': async (message, sender) => {
    const tab = pageTab(sender, 'Copying');
    const format = message.format ?? 'tsv';
    if (!COPY_FORMATS.has(format)) throw new Error('Copy as tsv, text or markdown.');
    return {text: makeExport(occurrences(message.links, tab, crypto.randomUUID()), {format, columns: ['anchorText', 'url']}).data};
  },
  'capture.open': async (message, sender) => {
    const tab = pageTab(sender, 'Opening links');
    const urls = webUrls(occurrences(message.links, tab, ''));
    if (!urls.length) throw new Error('None of the ticked links are web links, so there is nothing to open.');
    const mode = message.mode ?? 'tabs';
    const groupTitle = mode === 'group' ? destination(await serial(readState), optionalId(message.collectionId))?.name : undefined;
    return openUrls({urls, confirmed: message.confirmed, mode, groupTitle, requestId: message.requestId},
      {ownerTabId: tab.id, windowId: tab.windowId, notify: update => chrome.tabs.sendMessage(tab.id, update).catch(() => {})});
  },
  'capture.export': async (message, sender) => {
    const tab = pageTab(sender, 'Downloading');
    const state = await serial(readState);
    const rows = occurrences(message.links, tab, crypto.randomUUID()).map(link => ({...link, occurrences: [link], occurrenceIds: [link.id]}));
    const result = makeExport(rows, {format: message.format, columns: ['anchorText', 'url']});
    const fileName = exportFileName({collection: destination(state, optionalId(message.collectionId))?.name || '', extension: result.extension, settings: state.settings, date: new Date()});
    return typeof result.data === 'string'
      ? {fileName, mime: result.mime, encoding: 'utf8', data: result.data}
      : {fileName, mime: result.mime, encoding: 'base64', data: base64(result.data)};
  },
  'capture.bookmark': async (message, sender) => {
    const tab = pageTab(sender, 'Bookmarking');
    // A webpage cannot show Chrome's permission prompt, so bookmark access must already exist.
    let allowed = false;
    try { allowed = await chrome.permissions.contains({permissions: ['bookmarks']}); } catch { /* treated as not granted */ }
    if (!allowed) throw new Error('Bookmark access is needed. Open the full view and use Save as bookmarks there; Chrome asks for access once.');
    const links = occurrences(message.links, tab, '').filter(link => /^https?:$/.test(new URL(link.url).protocol));
    if (!links.length) throw new Error('None of the ticked links are web links, so there is nothing to bookmark.');
    const name = String(message.name ?? '').trim() || destination(await serial(readState))?.name || 'Link Meteor';
    return bookmarkLinks(name, links.map(link => ({anchorText: link.anchorText, url: link.url})));
  },
};
