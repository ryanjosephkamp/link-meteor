// Link Meteor's right-click and toolbar menus (0.4.0). Chrome shows several items from one
// extension under a "Link Meteor" submenu, so titles don't repeat the name. Saving from a menu goes
// to the active collection and shows the page's notice, with Undo and Show links. Download linked
// file belongs to downloads.js. 0.5.0: saves keep each link's context and the page's citation.
// The contract is in docs/CONTRACTS.md ("Menus").
import {makeExport} from '../core/export.js';
import {serial, readState} from './store.js';
import {WORKBENCH, OPEN_INTENT_KEY, occurrences, appendLinks, rememberAdd, openWorkbench} from './card.js';
import {saveTabs, tabsSummary} from './tabs.js';
import {citationPages} from './citations.js';

export const MENU = {addLink: 'meteor-add-link', copyLink: 'meteor-copy-link', selection: 'meteor-selection', region: 'meteor-region',
  page: 'meteor-page', saveTab: 'meteor-save-tab', saveWindow: 'meteor-save-window', fullView: 'meteor-full-view'};
const SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];
const MISSING = 'The active collection no longer exists, so nothing was saved.';
const UNREAD = ' Link Meteor couldn’t read its text on this page, so it was saved with its address only.';
const plural = (count, word) => `${Number(count).toLocaleString('en-US')} ${count === 1 ? word : word + 's'}`;
const protocol = url => { try { return new URL(url).protocol; } catch { return ''; } };
const activeName = state => state?.collections?.find(c => c.id === state.activeCollectionId)?.name ?? '';
// Chrome puts the selected text in place of %s in a title, so a name's own "%s" is kept apart.
const addLinkTitle = name => `Add link to “${String(name).replace(/%s/g, '%​s')}”`;
// Chrome 116 answers menu calls through callbacks; a failed call only sets lastError.
const settled = () => void chrome.runtime.lastError;

// Every item, in the order Chrome lists each context's items. Another area's item goes after the
// item named by its `after` (Download linked file after Copy link text + URL).
function menuItems(name, extra) {
  const items = [
    {id: MENU.addLink, title: addLinkTitle(name), contexts: ['link']},
    {id: MENU.copyLink, title: 'Copy link text + URL', contexts: ['link']},
    {id: MENU.selection, title: 'Capture links in the selection', contexts: ['selection']},
    {id: MENU.region, title: 'Select a region', contexts: ['link', 'selection', 'page']},
    {id: MENU.page, title: 'Capture this page', contexts: ['page']},
    {id: MENU.saveTab, title: 'Save this tab as a link', contexts: ['page', 'action']},
    {id: MENU.saveWindow, title: 'Save all tabs in this window as links', contexts: ['action']},
    {id: MENU.fullView, title: 'Open the full view', contexts: ['action']},
  ];
  for (const {after, ...item} of extra) items.splice(items.findIndex(existing => existing.id === after) + 1 || items.length, 0, item);
  return items;
}

// On install and update: every item, titled with the active collection's name.
export async function createMenus({extra = []} = {}) {
  const name = activeName(await serial(readState));
  await new Promise(done => { const pending = chrome.contextMenus.removeAll(() => { settled(); done(); }); pending?.then?.(done, done); });
  for (const item of menuItems(name, extra)) chrome.contextMenus.create(item, settled);
}

function retitle(name) {
  try { chrome.contextMenus.update(MENU.addLink, {title: addLinkTitle(name)}, settled); } catch { /* the title follows the next change */ }
}
// onStateWritten listener: Add link to “name” follows every saved write that changes the active
// collection or renames it, including a restore and its Undo.
export function followMenuWrites(previous, next) {
  const name = activeName(next);
  if (name !== activeName(previous)) retitle(name);
}
// At startup. Chrome keeps the menus, but saved data may have changed outside the state queue.
export async function syncMenuTitle() {
  try { retitle(activeName(await serial(readState))); } catch { /* unreadable data keeps the title */ }
}

// Asks the page script in the tab's top frame. Where none answers, it loads the script first: a
// menu click grants temporary access to the tab.
async function askPage(tab, message, inject) {
  let reply;
  try { reply = await chrome.tabs.sendMessage(tab.id, message, {frameId: 0}); }
  catch { await inject(tab); reply = await chrome.tabs.sendMessage(tab.id, message, {frameId: 0}); }
  if (!reply?.ok) throw new Error(reply?.error || 'The page did not answer. Reload it, then try again.');
  return reply.data;
}

// Shows the page's notice. Where the page can't show it, the full view opens at what was saved;
// otherwise the reason is reported there.
async function tell(tab, notice, {inject}) {
  try { await askPage(tab, {type: 'content.notice', ...notice}, inject); }
  catch {
    if (notice.added) await openWorkbench({view: 'links', batchId: notice.added.batchId});
    else throw new Error(notice.copy === undefined ? notice.text : 'The page could not copy the link. Reload it, then try again.');
  }
}

// The right-clicked link's captured fields, and the page's citation tags. Chrome gives a menu click
// only the link's address, so the page names the link under the last right-click, or the first link
// with that address. When neither is found (inside another site's frame, say), only the address is
// kept: text is never invented.
async function clickedLink(info, tab, inject) {
  const {link, page} = await askPage(tab, {type: 'content.contextLink', url: info.linkUrl}, inject);
  if (link) return {link, page, read: true};
  return {link: {anchorText: '', accessibleLabel: '', url: info.linkUrl, originalHref: '', frameUrl: info.frameUrl || tab.url || ''}, page, read: false};
}

// Saves page links to the active collection, with the page's citation (page), remembers the add
// for the notice's Undo, and says so there.
async function addLinks(tab, candidates, deps, note = '', page = null) {
  if (!candidates.length) return tell(tab, {text: 'No links in the selection, so nothing was added.'}, deps);
  const batchId = crypto.randomUUID(), links = occurrences(candidates, tab, batchId);
  const added = await appendLinks(links, {missing: MISSING, pages: citationPages(page, tab.url || links[0]?.sourceUrl)});
  const where = `“${added.name}”`, skipped = added.skipped;
  if (!added.count) return tell(tab, {text: `Nothing was added: ${plural(skipped, 'link')} ${skipped === 1 ? 'was' : 'were'} already in ${where}.`}, deps);
  await rememberAdd({tabId: tab.id, collectionId: added.collectionId, batchId, count: added.count});
  const text = skipped ? `Added ${plural(added.count, 'link')} to ${where}; ${skipped.toLocaleString('en-US')} ${skipped === 1 ? 'was' : 'were'} already saved.` : `Added ${plural(added.count, 'link')} to ${where}.`;
  return tell(tab, {text: text + note, added: {collectionId: added.collectionId, batchId, name: added.name}}, deps);
}

// Save this tab, or every tab in its window, as links, with the notice in that tab.
async function saveFromMenu(tab, tabIds, deps, single = false) {
  const {report, collectionId, name} = await saveTabs(tabIds);
  if (report.saved) await rememberAdd({tabId: tab.id, collectionId, batchId: report.batchId, count: report.saved});
  return tell(tab, {text: tabsSummary(report, {name, single}), ...(report.saved ? {added: {collectionId, batchId: report.batchId, name}} : {})}, deps);
}

const handlers = {
  [MENU.addLink]: async (info, tab, deps) => {
    const {link, page, read} = await clickedLink(info, tab, deps.inject);
    if (!SCHEMES.includes(protocol(link.url))) return tell(tab, {text: 'Link Meteor saves only web, email and phone links, so this link wasn’t added.'}, deps);
    return addLinks(tab, [link], deps, read ? '' : UNREAD, page);
  },
  // Two tab-separated columns with a header, like the card's Copy text + URL.
  [MENU.copyLink]: async (info, tab, deps) => {
    const {link, read} = await clickedLink(info, tab, deps.inject);
    if (!SCHEMES.includes(protocol(link.url))) return tell(tab, {text: 'Link Meteor copies only web, email and phone links, so nothing was copied.'}, deps);
    const copy = makeExport([link], {format: 'tsv', columns: ['anchorText', 'url']}).data;
    return tell(tab, {copy, text: read ? 'Copied anchor text and URL as two spreadsheet columns.' : 'Copied the URL. Link Meteor couldn’t read this link’s text on this page, so its text column is empty.'}, deps);
  },
  [MENU.selection]: async (info, tab, deps) => { const {links, page} = await askPage(tab, {type: 'content.selectionLinks'}, deps.inject); return addLinks(tab, links, deps, '', page); },
  [MENU.region]: (info, tab, {arm}) => arm(tab.id),
  [MENU.page]: async (info, tab, {captureTabs}) => { await captureTabs([tab.id]); await openWorkbench(); },
  [MENU.saveTab]: (info, tab, deps) => saveFromMenu(tab, [tab.id], deps, true),
  // Saving a window's tabs needs Chrome's tab list. Without it, the full view opens with that choice
  // ready and says why, because only a Link Meteor page can show Chrome's prompt.
  [MENU.saveWindow]: async (info, tab, deps) => {
    let allowed = false;
    try { allowed = await chrome.permissions.contains({permissions: ['tabs']}); } catch { /* treated as not granted */ }
    if (allowed) return saveFromMenu(tab, (await chrome.tabs.query({windowId: tab.windowId})).map(item => item.id), deps);
    await chrome.storage.session.set({[OPEN_INTENT_KEY]: {view: 'links', batchId: '', what: 'tabs', scope: 'window', createdAt: new Date().toISOString()}}).catch(() => {});
    await chrome.tabs.create({url: WORKBENCH, windowId: tab.windowId});
  },
  [MENU.fullView]: () => openWorkbench(),
};

// contextMenus.onClicked: runs this module's items and leaves other areas' items to them. `deps`
// holds the entry's arm, captureTabs, inject and reportError.
export async function menuClicked(info, tab, deps) {
  if (!Object.hasOwn(handlers, info?.menuItemId)) return;
  const handler = handlers[info.menuItemId];
  try {
    if (!tab?.id && info.menuItemId !== MENU.fullView) throw new Error('Open a webpage, then use Link Meteor’s menu there.');
    await handler(info, tab, deps);
  } catch (error) { await Promise.resolve(deps.reportError(error)).catch(() => {}); }
}
