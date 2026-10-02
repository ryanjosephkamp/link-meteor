// Capture this page in every frame Link Meteor may read (0.6.0). The page script reads a document,
// its shadow roots and the frames that document can reach; a frame from another site is closed to
// the document around it, so the script also runs inside each such frame Chrome lets it into
// (chrome.scripting.executeScript with allFrames, which skips the others silently). joinFrames puts
// the answers together: each link once, with the frame it was in, and the frames nobody could read
// named by the site their `src` gives, or counted. No webNavigation permission is used: a frame's
// place in the page (the page script's framePath) pairs it with the copy that ran inside it.
// Also here: Allow these sites (capture.frames), which reads the page again once the person has
// allowed the named sites and adds only the links in the frames that weren't read before.
// The contract is in docs/CONTRACTS.md ("Frames from other sites, and closed components").
import {serial, readState} from './store.js';
import {occurrences, appendLinks, keepLeftOut, LEFT_OUT_KEY} from './card.js';
import {joinFrames, framesWarning, MAX_FRAME_SITES} from './frame-join.js';

const REPORT_KEY = 'linkMeteorCaptureReport';
// How long the frames have to answer. After that the top document is read alone, and its frames
// from other sites are reported as not read.
export const FRAMES_MS = 10000;
const n = value => Number(value).toLocaleString('en-US');

function within(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The page’s frames took too long to answer.')), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

// Runs in each frame. A frame whose copy of the page script did nothing (the document around it
// reads it) answers null.
function scan(options) { return globalThis.__linkMeteor?.scan?.(options) ?? null; }

// Reads a tab whose top document already holds the page script: every frame Link Meteor may read,
// joined. Returns {links, warnings, page, fresh, frames?}, where frames is {read, unread, sites,
// left}: how many frames were read by their own copy of the script and how many weren't, the sites
// Allow these sites can ask for, and the unread frames themselves ({site, at}), kept so a later
// reading can tell which frames are new (`left`, see joinFrames).
// Chrome runs a script "when the frame is ready" by default, and a frame that never finishes
// loading (or a lazy one not yet loaded) would hold the whole capture, so the frames are read as
// they are now (injectImmediately) and given FRAMES_MS (`ms`). The top document was loaded by the caller.
// With `top` (a scan answer the caller already has for the top document, such as one gathered over
// several steps), that answer stands for the top document and only the frames' answers are new.
export async function scanTab(tabId, options, {left, top, ms = FRAMES_MS} = {}) {
  let results = null;
  try {
    results = await within((async () => {
      await chrome.scripting.executeScript({target: {tabId, allFrames: true}, files: ['content/capture.js'], injectImmediately: true});
      return chrome.scripting.executeScript({target: {tabId, allFrames: true}, func: scan, args: [options], injectImmediately: true});
    })(), ms);
  } catch { /* the top document alone, below */ }
  if (Array.isArray(top?.links)) results = [{frameId: 0, result: top}, ...(Array.isArray(results) ? results.filter(entry => entry?.frameId !== 0 && entry?.frameId !== undefined) : [])];
  let joined = joinFrames(results, {left});
  if (!joined) joined = joinFrames(await chrome.scripting.executeScript({target: {tabId}, func: scan, args: [options]}), {left});
  if (!joined) throw new Error('The page didn’t answer. Reload it and capture again.');
  const warnings = joined.said ? [...joined.said] : [];
  if (!joined.said && joined.malformed) warnings.push(`${n(joined.malformed)} malformed link destination${joined.malformed === 1 ? ' was' : 's were'} excluded.`);
  if (joined.capped && !warnings.some(text => text.startsWith('Capture reached'))) warnings.push('Capture reached 20,000 loaded links. Results are partial; select smaller regions for the remainder.');
  // A named site Link Meteor already has access to can't be fixed by asking: its frame is only counted.
  const sites = [];
  let named = 0, own = 0;
  for (const site of [...new Set(joined.unread.map(frame => frame.site).filter(Boolean))].sort()) {
    let allowed = false;
    try { allowed = await chrome.permissions.contains({origins: [`${site}/*`]}); } catch { /* treated as not allowed */ }
    if (allowed || sites.length === MAX_FRAME_SITES) continue;
    const count = joined.unread.filter(frame => frame.site === site).length;
    sites.push(site); named += count;
    if (site === joined.site) own = count;
  }
  const frames = joined.read || joined.unread.length ? {read: joined.read, unread: joined.unread.length, sites, left: joined.unread} : null;
  if (joined.unread.length) warnings.push(framesWarning({unread: joined.unread.length, sites, named, own, page: joined.site}));
  return {links: joined.links, warnings, page: joined.page, fresh: joined.fresh, ...(frames ? {frames} : {})};
}

// capture.frames {tabId, batchId}: Allow these sites, after Chrome granted them. Reads that page
// again and adds only the links in the frames the capture left unread (the kept report's
// frames.left) that are read now, and in the frames inside them, to the capture's own batch and
// collection. The kept report is updated, so a view opened later shows the same.
// Returns {state, report, added: {count, skipped, leftOut, frames}}.
async function captureFrames(message) {
  if (!Number.isInteger(message.tabId) || typeof message.batchId !== 'string' || !message.batchId) throw new Error('Choose a capture to add its frames to.');
  const stored = (await chrome.storage.session.get(REPORT_KEY))[REPORT_KEY];
  const kept = stored?.report?.batchId === message.batchId ? (stored.report.results || []).find(result => result.tabId === message.tabId && result.status === 'success') : null;
  if (!kept) throw new Error('That capture’s report is no longer kept. Capture the page again to include its frames.');
  if (!kept.frames?.left?.length) throw new Error('That capture left no frames unread, so there is nothing to add.');
  let tab;
  try { tab = await chrome.tabs.get(message.tabId); } catch { throw new Error('That tab is closed. Open the page and capture it again to include its frames.'); }
  if (tab.url && kept.url && tab.url !== kept.url) throw new Error('That tab has moved to another page since the capture. Capture the page again to include its frames.');
  const before = await serial(readState);
  // Include them, chosen for this capture, covers its frames' navigation links too.
  const contentOnly = before.settings.contentOnly === true && stored.report.leftOutIncluded === undefined;
  let scanned;
  try { scanned = await scanTab(tab.id, {context: before.settings.saveContext !== false}, {left: kept.frames.left}); }
  catch (error) { throw new Error(`Link Meteor can no longer read that page, so its frames weren’t added (${String(error.message || error)}). Capture the page again.`); }
  const found = occurrences(scanned.links, tab, message.batchId);
  const pageChrome = found.map((_, i) => contentOnly && scanned.links[i]?.pageChrome === true);
  const links = found.filter((_, i) => !pageChrome[i]), leftOut = found.filter((_, i) => pageChrome[i]);
  let state = before, count = 0, skipped = 0;
  if (links.length) ({state, count, skipped} = await appendLinks(links, {...(stored.report.collectionId ? {collectionId: stored.report.collectionId} : {}), missing: 'The collection this capture went to no longer exists, so nothing was added.'}));
  if (leftOut.length) {
    const earlier = (await chrome.storage.session.get(LEFT_OUT_KEY).catch(() => ({})))[LEFT_OUT_KEY];
    const base = earlier?.batchId === message.batchId ? earlier : {links: [], total: 0};
    await keepLeftOut({batchId: message.batchId, collectionId: stored.report.collectionId || before.activeCollectionId, links: [...base.links, ...leftOut], total: base.total + leftOut.length});
  }
  const {frames: _before, ...rest} = kept;
  const result = {...rest, count: kept.count + count, leftOut: (kept.leftOut || 0) + leftOut.length, skipped: (kept.skipped || 0) + skipped,
    warning: scanned.warnings.join(' '), ...(scanned.frames ? {frames: scanned.frames} : {})};
  const report = {...stored.report, capturedCount: stored.report.capturedCount + count, results: stored.report.results.map(item => item === kept ? result : item)};
  await chrome.storage.session.set({[REPORT_KEY]: {...stored, report}}).catch(() => {});
  return {state, report, added: {count, skipped, leftOut: leftOut.length, frames: scanned.fresh}};
}

export const workbenchMessages = {'capture.frames': captureFrames};
