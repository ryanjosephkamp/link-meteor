// Downloading the files behind links (0.4.0): downloads.start from the workbench, capture.download
// from the capture card, downloads.cancel, and the Download linked file menu item.
// - Chrome's own download system saves each file, as if the person had clicked the link, into
//   Link Meteor/<collection> in the downloads folder. The file is named after its anchor text
//   through onDeterminingFilename, once Chrome reports the file's type.
// - At most 100 files per action, confirmed above 10, and at most 3 downloading at a time across
//   every action, with downloads.progress after each file, and Cancel.
// - Each download is followed to its end (onChanged, and a look every second that also keeps the
//   service worker awake). A web page instead of a file, Chrome's reason for an interruption and a
//   download Chrome holds for review are all reported as they are.
// Link Meteor looks only at the downloads it started, by their ids. It never searches, opens,
// changes or removes other downloads, and names only its own: every other download keeps the name
// Chrome gives it. The contract is in docs/CONTRACTS.md ("Downloads").
import {serial, readState} from './store.js';
import {openWorkbench} from './card.js';
import {isFileLink, fileLinks, isWebPage, downloadPath, downloadFolder, folderLabel, menuPatterns, DOWNLOAD_LIMIT, DOWNLOAD_CONFIRM_ABOVE, DOWNLOAD_PARALLEL} from '../core/files.js';

export const DOWNLOAD_MENU_ID = 'meteor-download';
// Session key: links the card or the menu could not download without access. The next full view
// that opens shows them once, with the button that asks Chrome for access.
export const PENDING_KEY = 'linkMeteorPendingDownloads';
export const NEEDS_ACCESS = 'Download access is needed. Open the full view and choose Download there; Chrome asks for access once.';
const POLL_MS = 1000;
const MAX_LINKS = 20000;
// Danger ratings that let a download finish on its own. Any other rating waits for the person.
const CLEAR = new Set(['safe', 'accepted', 'allowlistedByPolicy', 'deepScannedSafe', 'asyncScanning', 'asyncLocalPasswordScanning']);
// Chrome's interruption reasons, in plain words; the code follows in parentheses.
const REASONS = {
  FILE_FAILED: 'the file could not be saved', FILE_ACCESS_DENIED: 'the downloads folder can’t be written to', FILE_NO_SPACE: 'the disk is full',
  FILE_NAME_TOO_LONG: 'the file name is too long', FILE_TOO_LARGE: 'the file is too large', FILE_VIRUS_INFECTED: 'a virus scan flagged it',
  FILE_TRANSIENT_ERROR: 'a temporary error', FILE_BLOCKED: 'Chrome or your computer blocked it', FILE_SECURITY_CHECK_FAILED: 'a security check failed',
  FILE_TOO_SHORT: 'the file arrived incomplete', FILE_HASH_MISMATCH: 'the file changed while downloading', FILE_SAME_AS_SOURCE: 'the file is already there',
  NETWORK_FAILED: 'the network failed', NETWORK_TIMEOUT: 'the site took too long', NETWORK_DISCONNECTED: 'the connection dropped',
  NETWORK_SERVER_DOWN: 'the site is down', NETWORK_INVALID_REQUEST: 'Chrome refused the request',
  SERVER_FAILED: 'the site had an error', SERVER_NO_RANGE: 'the site could not resume the file', SERVER_BAD_CONTENT: 'the site says the file isn’t there',
  SERVER_UNAUTHORIZED: 'the site needs you to sign in', SERVER_CERT_PROBLEM: 'the site’s certificate isn’t valid', SERVER_FORBIDDEN: 'the site refused access',
  SERVER_UNREACHABLE: 'the site could not be reached', SERVER_CONTENT_LENGTH_MISMATCH: 'the file arrived incomplete',
  SERVER_CROSS_ORIGIN_REDIRECT: 'the site sent it somewhere else', USER_SHUTDOWN: 'Chrome closed', CRASH: 'Chrome stopped unexpectedly',
};
export const reason = (code) => code === 'GONE' ? 'it was removed from Chrome’s downloads list' : `${REASONS[code] || 'Chrome stopped it'} (${code || 'unknown'})`;

// Requests still downloading, by requestId; downloads being followed, by download id; and
// downloads whose download() call has not answered yet (Chrome may ask for their names first).
const jobs = new Map(), followed = new Map(), starting = new Set();
let listening = false, busy = 0;
const waiting = [];

function randomId() {
  return globalThis.crypto?.randomUUID?.() || `download-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// The optional downloads permission. A page can't show Chrome's prompt, so only the workbench asks.
export async function hasAccess() {
  try { return await chrome.permissions.contains({permissions: ['downloads']}) && !!chrome.downloads; } catch { return false; }
}

// Web links to download, one per address, with the fields that name each file. Throws a readable
// error unless the request may start; nothing is downloaded before this passes.
export function checkDownloads({links, confirmed, requestId, collectionName}) {
  if (!Array.isArray(links) || !links.length || links.length > MAX_LINKS) throw new Error('Choose at least one link to download.');
  const seen = new Set(), picked = [];
  for (const link of links) {
    let url = null;
    try { url = new URL(String(link?.url)); } catch { /* refused below */ }
    if (!url || !['http:', 'https:'].includes(url.protocol)) throw new Error('Only web links (HTTP or HTTPS) can be downloaded. Nothing was downloaded.');
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const text = (key) => typeof link[key] === 'string' ? link[key] : '';
    picked.push({url: url.href, anchorText: text('anchorText'), accessibleLabel: text('accessibleLabel')});
  }
  if (picked.length > DOWNLOAD_LIMIT) throw new Error(`Link Meteor downloads at most ${DOWNLOAD_LIMIT} files at a time, and ${picked.length.toLocaleString('en-US')} were chosen. Select fewer links. Nothing was downloaded.`);
  if (picked.length > DOWNLOAD_CONFIRM_ABOVE && confirmed !== true) throw new Error(`Downloading more than ${DOWNLOAD_CONFIRM_ABOVE} files needs a confirmation first. Nothing was downloaded.`);
  if (requestId !== undefined && (typeof requestId !== 'string' || !requestId || requestId.length > 100)) throw new Error('The download request ID must be short text.');
  if (collectionName !== undefined && typeof collectionName !== 'string') throw new Error('The collection name must be text.');
  return picked;
}

/* At most DOWNLOAD_PARALLEL downloads at a time, first come first served. */
function takeSlot() {
  if (busy < DOWNLOAD_PARALLEL) { busy++; return Promise.resolve(); }
  return new Promise((done) => waiting.push(done));
}
function freeSlot() { const next = waiting.shift(); if (next) next(); else busy--; }

/* Following Link Meteor's own downloads. The listeners exist only while something downloads. */
function listen() {
  if (listening) return;
  chrome.downloads.onDeterminingFilename.addListener(nameFile);
  chrome.downloads.onChanged.addListener(changed);
  listening = true;
}
function stopListening() {
  if (!listening || jobs.size || followed.size || starting.size) return;
  chrome.downloads.onDeterminingFilename.removeListener(nameFile);
  chrome.downloads.onChanged.removeListener(changed);
  listening = false;
}
function claim(entry, id) { entry.id = id; followed.set(id, entry); }

// Names only Link Meteor's own downloads, once Chrome knows the file's type. Every other download
// is left exactly as Chrome names it.
function nameFile(item, suggest) {
  let entry = followed.get(item.id);
  if (!entry && item.byExtensionId === chrome.runtime.id) {
    // Chrome may ask before download() answers with the id: match the address, when only one fits.
    const matches = [...starting].filter((candidate) => candidate.id === undefined && candidate.link.url === item.url);
    if (matches.length === 1) claim(entry = matches[0], item.id);
  }
  if (!entry) { suggest(); return; }
  if (item.mime) entry.mime = item.mime;
  try { suggest({filename: downloadPath(entry.link, entry.collectionName, {mime: item.mime, suggested: item.filename}), conflictAction: 'uniquify'}); }
  catch { /* Chrome keeps its own name */ }
}

const FIELDS = ['state', 'error', 'mime', 'filename', 'danger'];
function changed(delta) {
  const entry = followed.get(delta.id);
  if (!entry) return;
  for (const key of FIELDS) if (delta[key]) entry[key] = delta[key].current;
  settle(entry);
}
// A download ends when it completes, is interrupted, or waits for the person to review it in
// Chrome's downloads list (a file Chrome considers dangerous). Link Meteor leaves that choice to them.
function settle(entry) {
  if (entry.settled) return;
  const held = entry.state === 'in_progress' && !!entry.danger && !CLEAR.has(entry.danger);
  if (!held && entry.state !== 'complete' && entry.state !== 'interrupted') return;
  entry.settled = true;
  clearTimeout(entry.timer);
  entry.finish(held ? 'held' : entry.state);
}
function follow(entry) {
  return new Promise((finish) => {
    entry.finish = finish;
    const look = async () => {
      if (entry.settled) return;
      try {
        const [item] = await chrome.downloads.search({id: entry.id});
        if (!item) Object.assign(entry, {state: 'interrupted', error: 'GONE'});
        else for (const key of FIELDS) if (item[key] !== undefined) entry[key] = item[key];
      } catch { /* onChanged or the next look */ }
      settle(entry);
      if (!entry.settled) entry.timer = setTimeout(look, POLL_MS);
    };
    look();
  });
}

function outcome(entry, end) {
  const result = {url: entry.link.url, anchorText: entry.link.anchorText, file: String(entry.filename || '').split(/[\\/]/).pop(), mime: entry.mime || ''};
  // A file link that brought back a web page: usually a sign-in or paywall page instead of the file.
  if (end === 'complete') return {...result, status: entry.expectFile && isWebPage(entry.mime) ? 'web-page' : 'saved'};
  if (end === 'held') return {...result, status: 'held', reason: 'Chrome is holding it for you to review in its downloads list'};
  // An interrupted download leaves no file behind, so it has no file name.
  if (entry.error === 'USER_CANCELED') return {...result, file: '', status: 'cancelled'};
  return {...result, file: '', status: 'failed', error: entry.error || 'unknown', reason: reason(entry.error)};
}

async function downloadOne(job, entry, send) {
  await takeSlot();
  try {
    if (job.cancelled) { entry.result = {url: entry.link.url, anchorText: entry.link.anchorText, file: '', mime: '', status: 'cancelled'}; return; }
    starting.add(entry);
    let id;
    try {
      // The name here is only a fallback: onDeterminingFilename names the file once its type is known.
      id = await chrome.downloads.download({url: entry.link.url, filename: downloadPath(entry.link, entry.collectionName), conflictAction: 'uniquify', saveAs: false});
    } catch (error) {
      entry.result = {url: entry.link.url, anchorText: entry.link.anchorText, file: '', mime: '', status: 'failed', error: 'START', reason: `Chrome could not start it: ${error.message || error}`};
      return;
    } finally { starting.delete(entry); }
    if (entry.id === undefined) claim(entry, id);
    if (job.cancelled) chrome.downloads.cancel(id).catch(() => {});
    entry.result = outcome(entry, await follow(entry));
  } finally {
    if (entry.id !== undefined) followed.delete(entry.id);
    freeSlot();
    job.done++;
    send();
  }
}

function counts(job) {
  const results = job.entries.map((entry) => entry.result).filter(Boolean);
  const count = (status) => results.filter((result) => result.status === status).length;
  return {total: job.entries.length, done: job.done, saved: count('saved'), webPages: count('web-page'), failed: count('failed'), cancelled: count('cancelled'), held: count('held')};
}

// One sentence for the card, the menu's notice and the workbench's status.
export function summaryText(result) {
  const n = (k, word, many = `${word}s`) => `${k.toLocaleString('en-US')} ${k === 1 ? word : many}`;
  const where = `${folderLabel(result.folder)} in your downloads folder`;
  const parts = [];
  const only = result.results.length === 1 ? result.results[0] : null;
  if (only?.status === 'saved') parts.push(`Saved “${only.file || 'the file'}” to ${where}${isWebPage(only.mime) ? ', a web page' : ''}.`);
  else if (result.saved) parts.push(`Saved ${n(result.saved, 'file')} to ${where}.`);
  if (only?.status === 'web-page') parts.push(`The link gave a web page instead of a file, often a sign-in page. It was saved as “${only.file}”.`);
  else if (result.webPages) parts.push(`${n(result.webPages, 'link')} gave a web page instead of a file, often a sign-in page.`);
  if (result.held) parts.push(`Chrome is holding ${n(result.held, 'file')} for you to review in its downloads list.`);
  if (only?.status === 'failed') parts.push(`The download failed: ${only.reason}.`);
  else if (result.failed) parts.push(`${n(result.failed, 'download')} failed.`);
  if (result.cancelled) parts.push(`Canceled ${n(result.cancelled, 'download')} that hadn’t finished.`);
  return parts.join(' ') || 'Nothing was downloaded.';
}

// Downloads the links into Link Meteor/<collectionName>. `notify` gets each downloads.progress;
// `ownerTabId` marks a request from a page, which only that page may cancel.
export async function startDownloads(message, {notify = () => {}, ownerTabId} = {}) {
  const links = checkDownloads(message);
  if (!await hasAccess()) throw new Error(NEEDS_ACCESS);
  const requestId = message.requestId || randomId();
  if (jobs.has(requestId)) throw new Error('That download request is already running.');
  const collectionName = message.collectionName || '';
  const job = {requestId, ownerTabId, cancelled: false, done: 0, entries: links.map((link) => ({link, collectionName, expectFile: isFileLink(link)}))};
  jobs.set(requestId, job);
  const send = () => { try { Promise.resolve(notify({type: 'downloads.progress', requestId, ...counts(job)})).catch(() => {}); } catch { /* nobody is listening */ } };
  try {
    listen();
    send();
    await Promise.all(job.entries.map((entry) => downloadOne(job, entry, send)));
  } finally {
    jobs.delete(requestId);
    stopListening();
  }
  const result = {requestId, folder: downloadFolder(collectionName), ...counts(job), results: job.entries.map((entry) => entry.result)};
  return {...result, summary: summaryText(result)};
}

// downloads.cancel: nothing more starts, and downloads still in progress are canceled. Files
// already saved stay. A page may cancel only the requests it started.
export function cancelDownloads({requestId}, {senderTabId} = {}) {
  const job = jobs.get(requestId);
  if (!job || (senderTabId !== undefined && job.ownerTabId !== senderTabId)) return {cancelled: false};
  job.cancelled = true;
  for (const entry of job.entries) if (entry.id !== undefined && !entry.settled) chrome.downloads.cancel(entry.id).catch(() => {});
  return {cancelled: true};
}

async function keepPending(links, collectionName, source) {
  await chrome.storage.session.set({[PENDING_KEY]: {links, collectionName, source, createdAt: new Date().toISOString()}}).catch(() => {});
}

function collectionName(state, collectionId) {
  return (state.collections.find((c) => c.id === collectionId) || state.collections.find((c) => c.id === state.activeCollectionId))?.name || '';
}

export const workbenchMessages = {
  'downloads.start': (message) => startDownloads(message, {notify: (update) => chrome.runtime.sendMessage(update)}),
};

export const pageMessages = {
  // The card's Download N files: the file links among the ticked ones, into the card's destination
  // collection's folder. Without access, they wait for the full view, which can ask Chrome.
  'capture.download': async (message, sender) => {
    const tab = sender.tab;
    if (!tab?.id) throw new Error('Downloading files must start from the capture card on a webpage.');
    if (!Array.isArray(message.links) || message.links.length > MAX_LINKS) throw new Error('Choose at least one link to download.');
    const files = fileLinks(message.links.filter((link) => link && typeof link === 'object'));
    if (!files.length) throw new Error('None of the ticked links are file links, so there is nothing to download.');
    const collectionId = typeof message.collectionId === 'string' && message.collectionId ? message.collectionId : undefined;
    const name = collectionName(await serial(readState), collectionId);
    if (!await hasAccess()) {
      await keepPending(checkDownloads({links: files, confirmed: true}), name, 'card');
      throw new Error(NEEDS_ACCESS);
    }
    return startDownloads({links: files, collectionName: name, requestId: message.requestId, confirmed: message.confirmed},
      {ownerTabId: tab.id, notify: (update) => chrome.tabs.sendMessage(tab.id, update)});
  },
};

/* The Download linked file menu item (links whose address is a file type or a known PDF address). */
// The Download linked file item, placed among the menus by background/menus.js (createMenus extra).
export function downloadMenuItem() {
  return {id: DOWNLOAD_MENU_ID, title: 'Download linked file', contexts: ['link'], targetUrlPatterns: menuPatterns()};
}

// The right-clicked link's own fields, when the page script can tell (content.contextLink, loaded
// with the temporary access the menu click grants); otherwise its address alone, which then names the file.
async function menuLink(info, tab) {
  const url = info.linkUrl;
  if (Number.isInteger(tab?.id)) {
    try {
      await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['content/capture.js']});
      const reply = await chrome.tabs.sendMessage(tab.id, {type: 'content.contextLink', url});
      const found = reply?.ok === true ? reply.data : reply;
      if (found?.url === url) return {url, anchorText: typeof found.anchorText === 'string' ? found.anchorText : '', accessibleLabel: typeof found.accessibleLabel === 'string' ? found.accessibleLabel : ''};
    } catch { /* no page script there */ }
  }
  return {url, anchorText: '', accessibleLabel: ''};
}

// Downloads the right-clicked file link into the active collection's folder, and tells the page
// what arrived. Without access, the full view opens with the link waiting at its downloads section.
export async function downloadFromMenu(info, tab) {
  const link = await menuLink(info, tab);
  const name = collectionName(await serial(readState));
  if (!await hasAccess()) {
    await keepPending(checkDownloads({links: [link]}), name, 'menu');
    await openWorkbench({});
    return null;
  }
  const result = await startDownloads({links: [link], collectionName: name}, {ownerTabId: tab?.id});
  if (Number.isInteger(tab?.id)) {
    const {results, folder, summary, ...totals} = result;
    await chrome.tabs.sendMessage(tab.id, {type: 'downloads.progress', ...totals, final: true, text: summary}).catch(() => {});
  }
  return result;
}
