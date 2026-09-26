import {makeExport} from './core/export.js';
import {serial, readState, mutate} from './background/store.js';
import {ordinaryUrl, validWebUrls} from './background/urls.js';
import {workbenchMessages as bookmarkMessages} from './background/bookmarks.js';
import {workbenchMessages as backupMessages} from './background/backup.js';

const LAST_TARGET_KEY = 'linkMeteorTarget';
const WORKBENCH = chrome.runtime.getURL('ui/workbench.html');
let holdQueue = Promise.resolve();

// Workbench-only messages answered by area modules. A type may be claimed by one module only.
const AREA_MESSAGES = new Map();
for (const table of [bookmarkMessages, backupMessages]) {
  for (const [type, handler] of Object.entries(table)) {
    if (AREA_MESSAGES.has(type)) throw new Error(`Duplicate Link Meteor message handler: ${type}`);
    AREA_MESSAGES.set(type, handler);
  }
}

function serialHold(operation) {
  const next = holdQueue.then(operation, operation);
  holdQueue = next.catch(() => {});
  return next;
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

function occurrences(candidates, tab, batchId) {
  if (!Array.isArray(candidates) || candidates.length > 20000) throw new Error('A capture can contain at most 20,000 links. Select a smaller region.');
  const capturedAt = new Date().toISOString();
  return candidates.map(candidate => {
    const url = new URL(String(candidate.url));
    if (!['http:','https:','mailto:','tel:'].includes(url.protocol)) throw new Error('Capture contained an unsupported link scheme.');
    const text = key => typeof candidate[key] === 'string' ? candidate[key] : '';
    return {id:crypto.randomUUID(),anchorText:text('anchorText'),accessibleLabel:text('accessibleLabel'),url:url.href,
      originalHref:text('originalHref'),sourceUrl:tab.url || text('sourceUrl'),sourceTitle:tab.title || text('sourceTitle'),
      frameUrl:text('frameUrl'),capturedAt,batchId,notes:'',tags:[]};
  });
}

async function captureTabs(tabIds,callerTabId) {
  const stateBefore = await serial(readState);
  const collectionId = stateBefore.activeCollectionId;
  const ids = Array.isArray(tabIds) && tabIds.length ? [...new Set(tabIds)] : [(await resolveTarget(undefined,callerTabId)).id];
  if (ids.length > 100 || ids.some(id => !Number.isInteger(id))) throw new Error('Choose at most 100 tabs per capture. You can append another batch.');
  const batchId = crypto.randomUUID(), results = [];
  let state = stateBefore, capturedCount = 0;
  for (const tabId of ids) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
      if (tab.incognito || (tab.url && !ordinaryUrl(tab.url))) {
        results.push({tabId,title:tab.title || 'Restricted page',url:tab.url || '',status:'unsupported',count:0,
          warning:'Browser-internal pages, the Chrome Web Store, and incognito pages cannot be captured.',error:''});
        continue;
      }
      await inject(tab);
      const [{result}] = await chrome.scripting.executeScript({target:{tabId},func:() => globalThis.__linkMeteor.scan()});
      const after = await chrome.tabs.get(tabId);
      if (tab.url && after.url !== tab.url) throw new Error('The tab navigated during capture; retry on the new page.');
      const links = occurrences(result.links, tab, batchId);
      if (links.length) state = await mutate({type:'links.append',collectionId,links});
      capturedCount += links.length;
      results.push({tabId,title:tab.title || '',url:tab.url || '',status:'success',count:links.length,
        warning:(result.warnings || []).join(' '),error:''});
      await rememberTarget(tab).catch(() => {});
    } catch (error) {
      const message = String(error.message || error);
      results.push({tabId,title:tab?.title || 'Unavailable page',url:tab?.url || '',status:/permission|access.*contents|host permission/i.test(message)?'denied':'error',count:0,warning:'',error:message});
    }
  }
  const report = {batchId,results,capturedCount};
  await chrome.storage.session.set({linkMeteorCaptureReport:{report,createdAt:new Date().toISOString()}}).catch(() => {});
  return {state,report};
}

async function commitCapture(message, sender) {
  if (!sender.tab?.id) throw new Error('A capture must originate from a webpage.');
  const links = occurrences(message.links, sender.tab, crypto.randomUUID());
  const state = links.length ? await mutate({type:'links.append',links}) : await serial(readState);
  await rememberTarget(sender.tab).catch(() => {});
  let warning='';
  if (message.review) {
    try { await chrome.tabs.create({url:WORKBENCH}); }
    catch { warning='Your links were saved, but the review tab could not open. Open Link Meteor from the toolbar to review them.'; }
  }
  return {state,count:links.length,warning};
}

async function openLinks(urls) {
  validWebUrls(urls);
  if (urls.length > 20) throw new Error('Open at most 20 links at a time. Select a smaller batch.');
  let opened = 0, failed = 0;
  for (const url of urls) {
    try { await chrome.tabs.create({url,active:false}); opened++; } catch { failed++; }
  }
  return {opened,failed};
}

async function syncHoldScripts() {
  let state = await serial(readState);
  const origins = [];
  for (const origin of state.settings.holdOrigins) {
    if (await chrome.permissions.contains({origins:[origin+'/*']})) origins.push(origin);
  }
  if (origins.length !== state.settings.holdOrigins.length) {
    state = await mutate({type:'settings.update',patch:{holdOrigins:origins}});
  }
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const ids = registered.filter(script => script.id.startsWith('meteor-hold-')).map(script => script.id);
  if (ids.length) await chrome.scripting.unregisterContentScripts({ids});
  if (origins.length) await chrome.scripting.registerContentScripts([{id:'meteor-hold-sites',matches:origins.map(origin => origin+'/*'),js:['content/capture.js'],runAt:'document_idle',persistAcrossSessions:true}]);
  for (const tab of await chrome.tabs.query({})) {
    let origin = '';
    try { origin = new URL(tab.url).origin; } catch { /* no visible URL */ }
    chrome.tabs.sendMessage(tab.id,{type:'content.configure',holdKey:state.settings.holdKey,enabled:origins.includes(origin)}).catch(() => {});
  }
  return state;
}

async function configureHold({origin,enabled,key}) {
  const url = new URL(origin);
  if (!ordinaryUrl(url.href) || url.origin !== origin) throw new Error('Choose an ordinary website origin for the hold-key shortcut.');
  if (enabled && !(await chrome.permissions.contains({origins:[origin+'/*']}))) throw new Error('Allow access to this site before enabling the hold-key shortcut.');
  const state = await serial(readState);
  const origins = new Set(state.settings.holdOrigins);
  if (enabled) origins.add(origin); else origins.delete(origin);
  const next = await mutate({type:'settings.update',patch:{holdKey:key,holdOrigins:[...origins]}});
  await syncHoldScripts();
  const tabs = await chrome.tabs.query({url:origin+'/*'});
  for (const tab of tabs) {
    try {
      if (enabled) await inject(tab);
      await chrome.tabs.sendMessage(tab.id,{type:'content.configure',holdKey:next.settings.holdKey,enabled});
    } catch { /* reloaded pages receive their persisted script */ }
  }
  return next;
}

async function handle(message, sender) {
  const ui = sender.url?.startsWith(WORKBENCH);
  if (message.type === 'state.get') return serial(readState);
  if (message.type === 'settings.get') {
    const settings = (await serial(readState)).settings;
    const holdOrigins = [];
    for (const origin of settings.holdOrigins) {
      if (await chrome.permissions.contains({origins:[origin+'/*']})) holdOrigins.push(origin);
    }
    return {...settings,holdOrigins};
  }
  if (message.type === 'collection.active') {
    const state = await serial(readState);
    const active = state.collections.find(c => c.id === state.activeCollectionId);
    return {name:active?.name || '',count:active?.links.length || 0};
  }
  if (message.type === 'capture.commit') return commitCapture(message,sender);
  if (message.type === 'capture.copy') {
    if (!sender.tab?.id) throw new Error('Copy must originate from a webpage.');
    return {text:makeExport(occurrences(message.links,sender.tab,crypto.randomUUID()),{format:'tsv',columns:['anchorText','url']}).data};
  }
  if (message.type === 'ui.open' && (ui || sender.tab?.id)) { await chrome.tabs.create({url:WORKBENCH}); return {}; }
  if (!ui) throw new Error('This action must be requested from the Link Meteor workbench.');
  if (AREA_MESSAGES.has(message.type)) return AREA_MESSAGES.get(message.type)(message,sender);
  switch (message.type) {
    case 'state.mutate': return mutate(message.action);
    case 'tabs.list': return inventory(sender.tab?.id);
    case 'capture.run': return captureTabs(message.tabIds,sender.tab?.id);
    case 'capture.arm': return arm(message.tabId,sender.tab?.id);
    case 'links.open': return openLinks(message.urls);
    case 'hold.configure': return serialHold(() => configureHold(message));
    default: throw new Error('Unknown Link Meteor action. Reload the extension and try again.');
  }
}

chrome.runtime.onMessage.addListener((message,sender,reply) => {
  if (!message || typeof message.type !== 'string' || message.type === 'state.changed' || message.type === 'content.configure') return false;
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
chrome.contextMenus.onClicked.addListener((info,tab) => {
  if (info.menuItemId === 'meteor-region') arm(tab?.id).catch(error => reportActivationError(error));
  if (info.menuItemId === 'meteor-page') captureTabs([tab.id]).then(() => chrome.tabs.create({url:WORKBENCH})).catch(error => reportActivationError(error));
});
async function reportActivationError(error) {
  await chrome.storage.session.set({linkMeteorActivationError:String(error.message || error)});
  await chrome.tabs.create({url:WORKBENCH});
}
chrome.runtime.onInstalled.addListener(async () => {
  await serial(readState);
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({id:'meteor-region',title:'Link Meteor: select a region',contexts:['page','link','selection']});
  chrome.contextMenus.create({id:'meteor-page',title:'Link Meteor: collect this page',contexts:['page','link','selection']});
  await serialHold(syncHoldScripts);
});
chrome.runtime.onStartup.addListener(() => serialHold(syncHoldScripts).catch(() => {}));
chrome.permissions.onRemoved.addListener(() => serialHold(syncHoldScripts).catch(() => {}));
