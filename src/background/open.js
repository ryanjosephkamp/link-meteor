// Opening many links (links.open, capture.open, links.cancel): 1 to 500 web links per request,
// confirmed above 20, opened in the background in batches of at most 10 with a pause between
// batches, as tabs, in a new window or in one tab group.
import {validWebUrls} from './urls.js';

export const OPEN_LIMIT = 500;
export const CONFIRM_ABOVE = 20;
export const BATCH_SIZE = 10;
export const BATCH_PAUSE_MS = 200;
const MODES = new Set(['tabs', 'window', 'group']);
// Requests still opening, by requestId. A request lives only while its message is answered.
const running = new Map();
const sleep = ms => new Promise(done => setTimeout(done, ms));

function randomId() {
  return globalThis.crypto?.randomUUID?.() || `open-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// Throws a readable error unless the request may start. Nothing is opened before this passes.
export function checkOpen({urls, confirmed, mode = 'tabs', groupTitle, requestId}) {
  if (!Array.isArray(urls) || !urls.length) throw new Error('Choose at least one web link to open.');
  validWebUrls(urls);
  if (urls.length > OPEN_LIMIT) throw new Error(`Link Meteor opens at most ${OPEN_LIMIT} links at a time, and ${urls.length.toLocaleString('en-US')} were chosen. Select fewer links. Nothing was opened.`);
  if (urls.length > CONFIRM_ABOVE && confirmed !== true) throw new Error(`Opening more than ${CONFIRM_ABOVE} links needs a confirmation first. Nothing was opened.`);
  if (!MODES.has(mode)) throw new Error("Open links as 'tabs', in a new 'window' or as a tab 'group'.");
  if (groupTitle !== undefined && typeof groupTitle !== 'string') throw new Error('The tab group name must be text.');
  if (requestId !== undefined && (typeof requestId !== 'string' || !requestId || requestId.length > 100)) throw new Error('The opening request ID must be short text.');
}

// Opens the URLs. `notify` receives each links.progress notification; `ownerTabId` marks a request
// started from a page, which only that page may cancel; `windowId` is where tabs open by default.
export async function openUrls({urls, confirmed, mode = 'tabs', groupTitle, requestId}, {notify = () => {}, ownerTabId, windowId: homeWindowId} = {}) {
  checkOpen({urls, confirmed, mode, groupTitle, requestId});
  const id = requestId || randomId();
  if (running.has(id)) throw new Error('That opening request is already running.');
  const job = {cancelled: false, ownerTabId};
  running.set(id, job);
  const total = urls.length;
  let opened = 0, failed = 0, windowId, groupId, groupTitled = false, titleTried = false;
  try {
    for (let start = 0; start < total; start += BATCH_SIZE) {
      if (start) await sleep(BATCH_PAUSE_MS);
      if (job.cancelled) break;
      const created = [];
      for (const url of urls.slice(start, start + BATCH_SIZE)) {
        try {
          if (mode === 'window' && windowId === undefined) {
            const win = await chrome.windows.create({url, focused: true});
            windowId = win.id;
            if (win.tabs?.[0]?.id !== undefined) created.push(win.tabs[0].id);
          } else {
            const where = mode === 'window' ? {windowId} : homeWindowId !== undefined ? {windowId: homeWindowId} : {};
            const tab = await chrome.tabs.create({url, active: false, ...where});
            if (tab?.id !== undefined) created.push(tab.id);
          }
          opened++;
        } catch (error) {
          // A new window that cannot be created would send every link elsewhere: stop instead.
          if (mode === 'window' && windowId === undefined) throw new Error(`Chrome could not open a new window: ${error.message || error}. Nothing was opened.`);
          failed++;
        }
      }
      if (mode === 'group' && created.length) {
        try {
          groupId = await chrome.tabs.group(groupId === undefined ? {tabIds: created} : {tabIds: created, groupId});
          if (!titleTried) {
            titleTried = true;
            const title = String(groupTitle || '').trim();
            if (title && chrome.tabGroups?.update && await chrome.permissions.contains({permissions: ['tabGroups']})) {
              try { await chrome.tabGroups.update(groupId, {title}); groupTitled = true; } catch { /* the group stays unnamed */ }
            }
          }
        } catch { /* the tabs stay open, ungrouped */ }
      }
      try { notify({type: 'links.progress', requestId: id, opened, failed, total}); } catch { /* nobody is listening */ }
    }
  } finally {
    running.delete(id);
  }
  return {opened, failed, cancelled: job.cancelled && opened + failed < total,
    ...(windowId !== undefined ? {windowId} : {}), ...(mode === 'group' ? {groupId, groupTitled} : {})};
}

// links.cancel: stops before the next batch; tabs already opened stay open. A page may cancel only
// the requests it started.
export function cancelOpen({requestId}, {senderTabId} = {}) {
  const job = running.get(requestId);
  if (!job || (senderTabId !== undefined && job.ownerTabId !== senderTabId)) return {cancelled: false};
  job.cancelled = true;
  return {cancelled: true};
}

// Unique HTTP(S) destinations, in order, from captured or saved links.
export function webUrls(links) {
  const urls = new Set();
  for (const link of links) {
    try {
      const url = new URL(link.url);
      if (['http:', 'https:'].includes(url.protocol)) urls.add(url.href);
    } catch { /* not a web link */ }
  }
  return [...urls];
}
