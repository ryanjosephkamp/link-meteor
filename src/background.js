import {serial, readState, mutate, onStateWritten} from './background/store.js';
import {ordinaryUrl} from './background/urls.js';
import {workbenchMessages as bookmarkMessages} from './background/bookmarks.js';
import {workbenchMessages as backupMessages} from './background/backup.js';
import {workbenchMessages as diagnosticsMessages} from './background/diagnostics.js';
import {workbenchMessages as holdMessages, grantedSettings, followHoldWrites, requestSync} from './background/hold.js';
import {openUrls, cancelOpen} from './background/open.js';
import {WORKBENCH, occurrences, commitCapture, openWorkbench, pageMessages, appendLinks, keepLeftOut, includeLeftOut, LEFT_OUT_LIMIT} from './background/card.js';
import {syncIcon, followThemeWrites} from './background/theme.js';
import {createMenus, menuClicked, followMenuWrites, syncMenuTitle, MENU} from './background/menus.js';
import {tabsMessage} from './background/tabs.js';
import {workbenchMessages as downloadMessages, pageMessages as downloadPageMessages, cancelDownloads, downloadMenuItem, downloadFromMenu, DOWNLOAD_MENU_ID} from './background/downloads.js';

const LAST_TARGET_KEY = 'linkMeteorTarget';

// Workbench-only messages answered by area modules. A type may be claimed by one module only.
const AREA_MESSAGES = new Map();
for (const table of [bookmarkMessages, backupMessages, holdMessages, diagnosticsMessages, downloadMessages]) {
  for (const [type, handler] of Object.entries(table)) {
    if (AREA_MESSAGES.has(type)) throw new Error(`Duplicate Link Meteor message handler: ${type}`);
    AREA_MESSAGES.set(type, handler);
  }
}

async function rememberTarget(tab) {
  if (tab?.id && ordinaryUrl(tab.url)) {
    await chrome.storage.session.set({[LAST_TARGET_KEY]:{tabId:tab.id,windowId:tab.windowId}});
  }
}

async function resolveTarget(tabId, callerTabId) {
  if (Number.isInteger(tabId)) return chrome.tabs.get(tabId);
  const active = (await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0];
  // An uninspectable active tab is returned too: injection will explain its permission failure.
  if (active && active.id !== callerTabId && !(active.url || active.pendingUrl)?.startsWith(chrome.runtime.getURL(''))) return active;
  const saved = (await chrome.storage.session.get(LAST_TARGET_KEY))[LAST_TARGET_KEY];
  if (saved) {
    try { return await chrome.tabs.get(saved.tabId); } catch { /* tab was closed */ }
  }
  throw new Error('Open a webpage and invoke Link Meteor from its toolbar icon or keyboard shortcut first.');
}

async function inventory(callerTabId) {
  const windows = await chrome.windows.getAll({populate:true,windowTypes:['normal']});
  const tabs = windows.filter(w => !w.incognito).flatMap(w => (w.tabs || []).filter(t => !t.incognito).map(t => ({
    id:t.id,windowId:w.id,title:t.title || 'Page (access required)',url:t.url || '',active:t.active
  })));
  let target;
  try { target = await resolveTarget(undefined,callerTabId); } catch { /* empty window */ }
  const current = windows.find(w => w.focused) || windows.find(w => w.id === target?.windowId) || windows[0];
  return {tabs,currentWindowId:current?.id,targetTabId:target?.id};
}

async function inject(tab) {
  if (tab.incognito) throw new Error('Incognito collection is not enabled in this release.');
  if (tab.url && !ordinaryUrl(tab.url)) throw new Error('Chrome does not allow link capture on this page. Choose an ordinary HTTP or HTTPS webpage.');
  await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content/capture.js']});
}

async function arm(tabId, callerTabId) {
  const tab = await resolveTarget(tabId,callerTabId);
  await inject(tab);
  await chrome.scripting.executeScript({target:{tabId:tab.id},func:() => globalThis.__linkMeteor.arm()});
  await rememberTarget(tab);
  // Make the target visible if selection was started from the full workbench.
  await chrome.tabs.update(tab.id,{active:true});
  await chrome.windows.update(tab.windowId,{focused:true});
  return {tabId:tab.id};
}

// With contentOnly, links the page marks as page chrome (navigation, headers, footers, sidebars)
// are left out, counted per page and kept for the workbench's Include them. With skipSaved, links
// the collection already holds are skipped and counted.
async function captureTabs(tabIds,callerTabId) {
  const stateBefore = await serial(readState);
  const collectionId = stateBefore.activeCollectionId, contentOnly = stateBefore.settings.contentOnly === true;
  const ids = Array.isArray(tabIds) && tabIds.length ? [...new Set(tabIds)] : [(await resolveTarget(undefined,callerTabId)).id];
  if (ids.length > 100 || ids.some(id => !Number.isInteger(id))) throw new Error('Choose at most 100 tabs per capture. You can append another batch.');
  const batchId = crypto.randomUUID(), results = [], leftOutLinks = [];
  let state = stateBefore, capturedCount = 0, leftOutTotal = 0;
  for (const tabId of ids) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
      if (tab.incognito || (tab.url && !ordinaryUrl(tab.url))) {
        results.push({tabId,title:tab.title || 'Restricted page',url:tab.url || '',status:'unsupported',count:0,leftOut:0,skipped:0,
          warning:'Browser-internal pages, the Chrome Web Store, and incognito pages cannot be captured.',error:''});
        continue;
      }
      await inject(tab);
      const [{result}] = await chrome.scripting.executeScript({target:{tabId},func:() => globalThis.__linkMeteor.scan()});
      const after = await chrome.tabs.get(tabId);
      if (tab.url && after.url !== tab.url) throw new Error('The tab navigated during capture; retry on the new page.');
      const found = occurrences(result.links, tab, batchId);
      const pageChrome = found.map((_, i) => contentOnly && result.links[i]?.pageChrome === true);
      const links = found.filter((_, i) => !pageChrome[i]), leftOut = found.filter((_, i) => pageChrome[i]);
      let count = 0, skipped = 0;
      if (links.length) ({state, count, skipped} = await appendLinks(links,{collectionId,missing:'The active collection was deleted during the capture, so nothing was saved from this page.'}));
      leftOutLinks.push(...leftOut.slice(0,Math.max(0,LEFT_OUT_LIMIT - leftOutLinks.length)));
      leftOutTotal += leftOut.length;
      capturedCount += count;
      results.push({tabId,title:tab.title || '',url:tab.url || '',status:'success',count,leftOut:leftOut.length,skipped,
        warning:(result.warnings || []).join(' '),error:''});
      await rememberTarget(tab).catch(() => {});
    } catch (error) {
      const message = String(error.message || error);
      results.push({tabId,title:tab?.title || 'Unavailable page',url:tab?.url || '',status:/permission|access.*contents|host permission/i.test(message)?'denied':'error',count:0,leftOut:0,skipped:0,warning:'',error:message});
    }
  }
  const report = {batchId,results,capturedCount};
  await keepLeftOut({batchId,collectionId,links:leftOutLinks,total:leftOutTotal});
  await chrome.storage.session.set({linkMeteorCaptureReport:{report,createdAt:new Date().toISOString()}}).catch(() => {});
  return {state,report};
}

async function handle(message, sender) {
  const ui = sender.url?.startsWith(WORKBENCH);
  if (message.type === 'state.get') return serial(readState);
  if (message.type === 'settings.get') return grantedSettings();
  if (message.type === 'collection.active') {
    const state = await serial(readState);
    const active = state.collections.find(c => c.id === state.activeCollectionId);
    return {name:active?.name || '',count:active?.links.length || 0};
  }
  // Capture-card messages need a sender tab (the page script's); collections.list takes any sender.
  if (message.type === 'capture.commit') return commitCapture(message,sender,{remember:rememberTarget});
  if (Object.hasOwn(pageMessages,message.type)) return pageMessages[message.type](message,sender);
  if (Object.hasOwn(downloadPageMessages,message.type)) return downloadPageMessages[message.type](message,sender);
  if (message.type === 'ui.open' && (ui || sender.tab?.id)) return openWorkbench(message);
  // A page may cancel only the opening it started from its own capture card.
  if (message.type === 'links.cancel' && !ui && sender.tab?.id) return cancelOpen(message,{senderTabId:sender.tab.id});
  if (message.type === 'downloads.cancel' && (ui || sender.tab?.id)) return cancelDownloads(message,ui ? {} : {senderTabId:sender.tab.id});
  if (!ui) throw new Error('This action must be requested from the Link Meteor workbench.');
  if (AREA_MESSAGES.has(message.type)) return AREA_MESSAGES.get(message.type)(message,sender);
  switch (message.type) {
    case 'state.mutate': return mutate(message.action);
    case 'tabs.list': return inventory(sender.tab?.id);
    case 'capture.run': return captureTabs(message.tabIds,sender.tab?.id);
    case 'capture.tabs': return tabsMessage(message,{target:() => resolveTarget(undefined,sender.tab?.id)});
    case 'capture.includeLeftOut': return includeLeftOut(message);
    case 'capture.arm': return arm(message.tabId,sender.tab?.id);
    case 'links.open': return openUrls(message,{notify:update => chrome.runtime.sendMessage(update).catch(() => {})});
    case 'links.cancel': return cancelOpen(message);
    default: throw new Error('Unknown Link Meteor action. Reload the extension and try again.');
  }
}

chrome.runtime.onMessage.addListener((message,sender,reply) => {
  if (!message || typeof message.type !== 'string' || ['state.changed','content.configure','links.progress','downloads.progress'].includes(message.type)) return false;
  handle(message,sender).then(data => reply({ok:true,data}),error => reply({ok:false,error:String(error.message || error)}));
  return true;
});

chrome.action.onClicked.addListener(tab => {
  rememberTarget(tab).catch(() => {});
  chrome.sidePanel.open({windowId:tab.windowId}).catch(() => chrome.tabs.create({url:WORKBENCH}));
});
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'select-region') arm(tab?.id).catch(error => reportActivationError(error));
});
// The right-click and toolbar menus (background/menus.js); Download linked file is background/downloads.js's.
chrome.contextMenus.onClicked.addListener((info,tab) => info.menuItemId === DOWNLOAD_MENU_ID
  ? downloadFromMenu(info,tab).catch(error => reportActivationError(error))
  : menuClicked(info,tab,{arm,captureTabs,inject,reportError:reportActivationError}));
async function reportActivationError(error) {
  await chrome.storage.session.set({linkMeteorActivationError:String(error.message || error)});
  await chrome.tabs.create({url:WORKBENCH});
}
chrome.runtime.onInstalled.addListener(async () => {
  // Nothing is requested and no tab opens at install; the welcome card asks in the workbench.
  await serial(readState);
  await createMenus({extra: [{after: MENU.copyLink, ...downloadMenuItem()}]});
  await requestSync({inject: 'all'});
});
// Keeping access honest: hold-drag follows Chrome's grants and every saved change to its settings.
chrome.runtime.onStartup.addListener(() => requestSync({inject: 'all'}));
chrome.permissions.onAdded.addListener(() => requestSync());
chrome.permissions.onRemoved.addListener(() => requestSync());
onStateWritten(followHoldWrites);
// The toolbar icon follows the theme: at startup, on install and update, and when the theme changes.
chrome.runtime.onStartup.addListener(() => syncIcon());
chrome.runtime.onInstalled.addListener(() => syncIcon());
onStateWritten(followThemeWrites);
// Add link to “name” follows the active collection's name.
chrome.runtime.onStartup.addListener(() => syncMenuTitle());
onStateWritten(followMenuWrites);
