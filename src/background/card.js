// The capture card on a webpage: saving to a chosen collection, copying, opening, downloading and
// bookmarking the links still ticked in its preview, and opening the full view at that capture.
// Also what 0.4.0 adds around it: links already saved, Undo after adding right away, the card's two
// remembered choices, and the navigation links *Capture this page* left out.
// The contracts are in docs/CONTRACTS.md ("The capture card", and "Added in 0.4.0").
import {reduceState} from '../core/model.js';
import {exportFileName, makeExport, richLinks} from '../core/export.js';
import {serial, readState, writeState, mutate} from './store.js';
import {bookmarkLinks} from './bookmarks.js';
import {openUrls, webUrls} from './open.js';

export const WORKBENCH = chrome.runtime.getURL('ui/workbench.html');
export const OPEN_INTENT_KEY = 'linkMeteorOpenIntent';
// Session keys: the latest capture's left-out navigation links, and recent adds that Undo may remove.
export const LEFT_OUT_KEY = 'linkMeteorLeftOut';
const RECENT_ADDS_KEY = 'linkMeteorRecentAdds';
const REPORT_KEY = 'linkMeteorCaptureReport';
// At most this many left-out links are kept for Include them (a few MB of session storage).
export const LEFT_OUT_LIMIT = 5000;
const RECENT_ADDS = 20, MAX_LINKS = 20000;
const COPY_FORMATS = new Set(['tsv', 'text', 'markdown', 'rich']);
const PREFERENCES = ['contentOnly', 'skipSaved'];
const MISSING_DESTINATION = 'The chosen collection no longer exists, so nothing was saved. Choose another destination.';
const SAVE_FAILED = 'Could not save this change. Existing collections are intact. Export or remove an older collection to free extension storage, then retry.';

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

// Adds links to a collection (default: the active one) in one step of the state queue. With
// skipSaved (default: the saved setting), links whose URL the collection already holds are left out
// and counted as skipped.
export function appendLinks(links, {collectionId, skipSaved, missing = MISSING_DESTINATION} = {}) {
  return serial(async () => {
    const previous = await readState();
    const home = previous.collections.find(c => c.id === (collectionId ?? previous.activeCollectionId));
    if (!home) throw new Error(missing);
    const held = (skipSaved ?? previous.settings.skipSaved) ? new Set(home.links.map(link => link.url)) : null;
    const added = held ? links.filter(link => !held.has(link.url)) : links;
    let state = previous;
    if (added.length) {
      state = reduceState(previous, {type: 'links.append', collectionId: home.id, links: added});
      try { await writeState(previous, state); } catch { throw new Error(SAVE_FAILED); }
    }
    return {state, collectionId: home.id, name: home.name, count: added.length, skipped: links.length - added.length};
  });
}

// Remembers an add from a page, so that page's Undo can remove exactly that batch (capture.undoAdd).
// Saves from Link Meteor's menus use it too, with the tab whose notice offers Undo.
export function rememberAdd(record) {
  return serial(async () => {
    const adds = (await chrome.storage.session.get(RECENT_ADDS_KEY))[RECENT_ADDS_KEY] || [];
    await chrome.storage.session.set({[RECENT_ADDS_KEY]: [...adds, record].slice(-RECENT_ADDS)});
  }).catch(() => { /* Undo then says it is no longer possible */ });
}

// capture.commit: saves the ticked links to the chosen collection (default: the active one).
export async function commitCapture(message, sender, {remember = async () => {}} = {}) {
  const tab = pageTab(sender, 'Saving');
  const collectionId = optionalId(message.collectionId);
  if (message.skipSaved !== undefined && typeof message.skipSaved !== 'boolean') throw new Error('Say whether to skip links that are already saved.');
  const batchId = crypto.randomUUID();
  const links = occurrences(message.links, tab, batchId);
  const added = await appendLinks(links, {collectionId, skipSaved: message.skipSaved === true});
  if (added.count) await rememberAdd({tabId: tab.id, collectionId: added.collectionId, batchId, count: added.count});
  await remember(tab).catch(() => {});
  let warning = '';
  if (message.review) {
    try { await openWorkbench(added.count ? {view: 'links', batchId} : {}); }
    catch { warning = 'Your links were saved, but the review tab could not open. Open Link Meteor from the toolbar to review them.'; }
  }
  return {state: added.state, count: added.count, skipped: added.skipped, batchId: added.count ? batchId : '', collectionId: added.collectionId, warning};
}

// capture.undoAdd: removes the occurrences one add from this page created, while the collection
// still holds exactly that batch, unedited. The workbench's own removal Undo is kept.
async function undoAdd(message, sender) {
  const tab = pageTab(sender, 'Undo');
  for (const key of ['collectionId', 'batchId']) if (typeof message[key] !== 'string' || !message[key]) throw new Error('Say which add to undo.');
  const {collectionId, batchId} = message;
  return serial(async () => {
    const adds = (await chrome.storage.session.get(RECENT_ADDS_KEY))[RECENT_ADDS_KEY] || [];
    const record = adds.find(add => add.tabId === tab.id && add.collectionId === collectionId && add.batchId === batchId);
    if (!record) throw new Error('This add can no longer be undone here. Remove the links in the full view instead.');
    const previous = await readState();
    const batch = previous.collections.find(c => c.id === collectionId)?.links.filter(link => link.batchId === batchId) || [];
    if (batch.length !== record.count || batch.some(link => link.notes || link.tags.length)) throw new Error('These links changed since they were added, so Undo is no longer possible. Remove them in the full view instead.');
    const next = {...reduceState(previous, {type: 'links.remove', collectionId, ids: batch.map(link => link.id)}), undo: previous.undo};
    try { await writeState(previous, next); } catch { throw new Error(SAVE_FAILED); }
    await chrome.storage.session.set({[RECENT_ADDS_KEY]: adds.filter(add => add !== record)}).catch(() => {});
    return {count: batch.length};
  });
}

// Capture this page with contentOnly: the latest capture's left-out navigation links, kept for the
// workbench's Include them until the next capture. A capture that left nothing out clears them.
export async function keepLeftOut({batchId, collectionId, links, total = links.length}) {
  try {
    if (!links.length) await chrome.storage.session.remove(LEFT_OUT_KEY);
    else await chrome.storage.session.set({[LEFT_OUT_KEY]: {batchId, collectionId, total, links: links.slice(0, LEFT_OUT_LIMIT), createdAt: new Date().toISOString()}});
  } catch { /* Include them then says the links are no longer kept */ }
}

// capture.includeLeftOut: adds a capture's left-out navigation links to the collection it went to.
export async function includeLeftOut(message) {
  if (typeof message.batchId !== 'string' || !message.batchId) throw new Error('Choose a capture to include its navigation links.');
  const kept = (await chrome.storage.session.get(LEFT_OUT_KEY))[LEFT_OUT_KEY];
  if (kept?.batchId !== message.batchId) throw new Error('Those navigation links are no longer kept. Capture the page again to include them.');
  const added = await appendLinks(kept.links, {collectionId: kept.collectionId, missing: 'The collection this capture went to no longer exists, so nothing was added.'});
  await chrome.storage.session.remove(LEFT_OUT_KEY).catch(() => {});
  // The kept report remembers it, so a view that shows the report later doesn't offer it again.
  try {
    const stored = (await chrome.storage.session.get(REPORT_KEY))[REPORT_KEY];
    if (stored?.report?.batchId === message.batchId) await chrome.storage.session.set({[REPORT_KEY]: {...stored, report: {...stored.report, leftOutIncluded: added.count}}});
  } catch { /* the report still shows the capture itself */ }
  return {state: added.state, count: added.count, skipped: added.skipped, total: kept.total, collectionId: added.collectionId, name: added.name};
}

function base64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Messages from the capture card. Each needs a sender tab, except collections.list and capture.saved.
export const pageMessages = {
  'collections.list': async () => {
    const state = await serial(readState);
    return {activeCollectionId: state.activeCollectionId, collections: state.collections.map(c => ({id: c.id, name: c.name, count: c.links.length}))};
  },
  // Which of these URLs the collection (default: the active one) already holds, and nothing else.
  'capture.saved': async (message) => {
    const collectionId = optionalId(message.collectionId);
    if (!Array.isArray(message.urls) || message.urls.length > MAX_LINKS || message.urls.some(url => typeof url !== 'string')) throw new Error('Check at most 20,000 addresses at a time.');
    const state = await serial(readState);
    const home = state.collections.find(c => c.id === (collectionId ?? state.activeCollectionId));
    if (!home) throw new Error('The chosen collection no longer exists. Choose another destination.');
    const held = new Set(home.links.map(link => link.url));
    return {saved: [...new Set(message.urls)].filter(url => held.has(url))};
  },
  'capture.copy': async (message, sender) => {
    const tab = pageTab(sender, 'Copying');
    const format = message.format ?? 'tsv';
    if (!COPY_FORMATS.has(format)) throw new Error('Copy as tsv, text or markdown, or as rich links.');
    const links = occurrences(message.links, tab, crypto.randomUUID());
    return format === 'rich' ? richLinks(links) : {text: makeExport(links, {format, columns: ['anchorText', 'url']}).data};
  },
  'capture.undoAdd': undoAdd,
  // The card's two remembered choices, and only those.
  'capture.preference': async (message, sender) => {
    pageTab(sender, 'Saving a preference');
    const keys = Object.keys(message).filter(key => key !== 'type');
    if (!keys.length || keys.some(key => !PREFERENCES.includes(key) || typeof message[key] !== 'boolean')) throw new Error('The card can save only contentOnly and skipSaved, each true or false.');
    const {settings} = await mutate({type: 'settings.update', patch: Object.fromEntries(keys.map(key => [key, message[key]]))});
    return {contentOnly: settings.contentOnly, skipSaved: settings.skipSaved};
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
