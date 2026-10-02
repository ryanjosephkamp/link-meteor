// Runs (0.6.0): captures that take more than one step.
// - Follow Next reads a page, moves the same tab to the page's own Next link and reads that, up to
//   settings.followPages pages.
// - Capture selected pages opens each chosen page in a background tab, one at a time, reads it and
//   closes it: 20 pages at most, one level deep, never further.
// - Scroll to the end first is one page (capture.run with scroll: true), read by the page script.
// Every run starts from a click, shows a counter and Stop the whole time, has a firm cap, saves
// what it finds as one batch with one Undo, keeps what it has when stopped, and ends with a report.
//
// - Download as one ZIP and Combine into one PDF get each chosen PDF's file (kind `files`): the Link
//   Meteor page that started the run fetches it through a tab on the PDF's own site. No links are saved.
//
// The engine (the queue, pacing, Stop, progress, the session record and the report) is kept apart
// from what one step does (KINDS), so another kind of run is one more entry in KINDS.
// The contract is in docs/CONTRACTS.md ("Runs: auto-scroll, Follow Next and selected pages").
import {reduceState, pageKey, MIN_FOLLOW_PAGES, MAX_FOLLOW_PAGES, MAX_CONTEXT} from '../core/model.js';
import {pdfSetProblem, MAX_PDF_BYTES, MAX_PDF_SET_BYTES} from '../core/pdf.js';
import {isFileLink} from '../core/files.js';
import {serial, readState, writeState} from './store.js';
import {WORKBENCH, appendLinks} from './card.js';

// Session key: the run in progress, or the last one that ended (for its report and its Undo). It
// holds the queue, counts, each page's outcome and the batch, never a page's links.
export const RUN_KEY = 'linkMeteorRun';
const REPORT_KEY = 'linkMeteorCaptureReport';
// Limits and pacing. A run of selected pages reads at most MAX_RUN_PAGES; Follow Next reads at most
// settings.followPages (2 to 20). A page gets LOAD_MS to load. Follow Next pauses NEXT_PAUSE_MS on
// each new page before reading it; selected pages are PAGES_PAUSE_MS apart. A PDF among selected
// pages is read by an open Link Meteor page, which gets PDF_WAIT_MS to answer.
export const MAX_RUN_PAGES = 20, LOAD_MS = 30000, NEXT_PAUSE_MS = 1500, PAGES_PAUSE_MS = 2000, PDF_WAIT_MS = 60000;
// PDF files are fetched FILES_PAUSE_MS apart; the page that fetches one gets FILE_WAIT_MS to answer.
// A tab opened at an address the site sends as a download is closed by Chrome within CLOSING_MS.
export const FILES_PAUSE_MS = 2000, FILE_WAIT_MS = 120000, CLOSING_MS = 2000;
const POLL_MS = 250, LOAD_GRACE_MS = 1000, KEEP_AWAKE_MS = 20000, SCROLL_SCREENS = 50, MAX_LINKS = 20000;
const SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];
const BUSY = 'Link Meteor is already running a capture. Stop it, or wait for it to finish.';
const STOPPED = 'Not read: you pressed Stop';
const NOT_LOADED = `Didn’t load within ${LOAD_MS / 1000} seconds`;
const INTERRUPTED = 'Chrome stopped Link Meteor’s background worker, so the run ended early.';

const n = value => Number(value).toLocaleString('en-US');
const plural = (count, word, many = word + 's') => `${n(count)} ${count === 1 ? word : many}`;
const hostOf = url => { try { return new URL(url).host; } catch { return ''; } };
const iso = () => new Date(clock.now()).toISOString();

// Time, replaceable in tests (a fake clock).
let clock = {now: () => Date.now(), sleep: ms => new Promise(done => setTimeout(done, ms))};
export function useClock(next) { clock = {...clock, ...next}; }
// Capture this page's own pipeline and target (background.js): each page of a run is captured as
// Capture this page captures it. captureTabs(tabIds, callerTabId, {batchId, collectionId, scan}).
let capture = {captureTabs: null, resolveTarget: null};
export function useCapture(tools) { capture = {...capture, ...tools}; }

/* The engine ------------------------------------------------------------------------------------ */
// The one run this worker is driving: {run, stopped, waiters, asks}. `run` is the session record.
let going = null, starting = false;
function hold(run) { going = {run, stopped: run.stopping === true, waiters: new Set(), asks: new Map()}; return going; }
async function stored() { try { return (await chrome.storage.session.get(RUN_KEY))[RUN_KEY] || null; } catch { return null; } }
async function save(run) { try { await chrome.storage.session.set({[RUN_KEY]: run}); } catch { /* the run goes on; only a restart would miss it */ } }
// Chrome may stop an idle worker after 30 seconds. While a run waits (a slow page, a PDF being
// read), a small call now and then keeps this one awake.
const keepAwake = () => { try { chrome.runtime.getPlatformInfo?.(() => void chrome.runtime.lastError); } catch { /* not there */ } };

// What Link Meteor's pages are told about a run (run.progress, run.status).
function view(run) {
  const kind = KINDS[run.kind] || {}, done = run.state !== 'running';
  const {step = 0, of = 0, links = run.links || 0, text = ''} = kind.counter ? kind.counter(run) : {};
  return {runId: run.runId, kind: run.kind, step, of, links, state: done ? 'done' : run.stopping ? 'stopping' : 'running', title: kind.title || '', text,
    page: run.page?.title || '', startedAt: run.startedAt,
    ...(done ? {ended: run.ended, summary: run.summary || '', batchId: run.batchId, collectionId: run.collectionId, name: run.name, count: run.count || 0, undone: run.undone === true, results: run.results || []} : {})};
}
function progress(run) { try { chrome.runtime.sendMessage({type: 'run.progress', ...view(run)}).catch(() => {}); } catch { /* nobody is listening */ } }

// A pause that Stop ends at once.
function pause(job, ms) {
  return new Promise(done => {
    const wake = () => { job.waiters.delete(wake); done(); };
    job.waiters.add(wake);
    clock.sleep(ms).then(wake);
  });
}
// Asks Link Meteor's own pages to do part of a step the background can't (reading a PDF), and
// waits for the answer: a message of a type in ANSWERS with the same runId and step. Null when no
// page is open, none answers in time, or Stop is pressed.
function ask(job, message, ms) {
  const key = `${message.runId}:${message.step}`;
  if (job.stopped) return Promise.resolve(null);
  return new Promise(done => {
    // A step may ask again (a file through another tab): an earlier question's timer must not end the later one.
    const finish = answer => { if (job.asks.get(key) === finish) job.asks.delete(key); job.waiters.delete(stopped); done(answer); };
    const stopped = () => finish(null);
    job.asks.set(key, finish); job.waiters.add(stopped);
    clock.sleep(ms).then(stopped);
    try { chrome.runtime.sendMessage(message).then(() => {}, stopped); } catch { stopped(); }
  });
}
function answer(message) {
  const finish = going?.asks.get(`${message.runId}:${message.step}`);
  if (!finish) return {taken: false};
  finish(message);
  return {taken: true};
}

// Waits for a tab to finish loading: 'complete', 'timeout', 'closed' or 'stopped'. `started` says
// the navigation is known to have begun; otherwise a tab that still says 'complete' gets a moment
// to start loading first.
async function loaded(job, tabId, started = false) {
  const began = clock.now();
  for (;;) {
    if (job.stopped) return 'stopped';
    let tab;
    try { tab = await chrome.tabs.get(tabId); } catch { return 'closed'; }
    if (tab.status === 'loading') started = true;
    else if (tab.status === 'complete' && (started || clock.now() - began >= LOAD_GRACE_MS)) return 'complete';
    if (clock.now() - began >= LOAD_MS) return 'timeout';
    await pause(job, POLL_MS);
  }
}
// Whether Link Meteor has access to pages of this address's site: all sites, or that site.
async function hasAccess(url) {
  try { return await chrome.permissions.contains({origins: [`${new URL(url).origin}/*`]}); } catch { return false; }
}
// What kind of document a tab shows ('application/pdf', 'text/html', …), or {error} where Chrome
// won't run a script (no access, or an error page).
async function documentType(tabId) {
  try { const [probe] = await chrome.scripting.executeScript({target: {tabId}, func: function documentType() { return document.contentType; }}); return {type: String(probe?.result || '')}; }
  catch (error) { return {error: String(error?.message || error)}; }
}
// The run's notice on the page it is reading, with Stop. A page without the page script hears nothing.
async function tellPage(tabId, message) {
  try { await chrome.tabs.sendMessage(tabId, {type: 'content.run', ...message}, {frameId: 0}); } catch { /* no page script there */ }
}
async function showOnPage(run, text, tabId = run.tabId) {
  try { await chrome.scripting.executeScript({target: {tabId}, files: ['content/capture.js']}); } catch { return; }
  await tellPage(tabId, {runId: run.runId, text});
}

// One page captured as Capture this page captures it, into the run's batch and collection.
async function capturePage(job, tabId, scan = {}) {
  const {report} = await capture.captureTabs([tabId], undefined, {batchId: job.run.batchId, collectionId: job.run.collectionId, scan});
  return report.results[0];
}
// A page's row in the report, from its capture result: what was found, what was added, how it ended.
function rowOf(result, item) {
  const added = result.count || 0, skipped = result.skipped || 0, leftOut = result.leftOut || 0, found = added + skipped + leftOut;
  const row = {url: result.url || item.url, title: result.title || '', found, added, skipped, leftOut};
  if (result.status === 'success') {
    const how = !found ? 'No links on this page' : !added ? 'Captured: nothing new' : 'Captured';
    const scrolled = !result.scroll ? '' : result.scroll.ended === 'end' ? ` · scrolled ${plural(result.scroll.screens, 'screen')} to the end` : ` · ${result.scroll.text}`;
    // Frames from other sites that couldn't be read, where the capture counts them (frames.unread).
    const unreadFrames = Number.isInteger(result.frames?.unread) && result.frames.unread > 0 ? result.frames.unread : 0;
    const frames = unreadFrames ? ` · ${plural(unreadFrames, 'frame')} from other sites ${unreadFrames === 1 ? 'wasn’t' : 'weren’t'} read` : '';
    return {...row, status: found ? 'captured' : 'empty', how: how + scrolled + frames, ...(result.warning ? {warning: result.warning} : {})};
  }
  if (result.status === 'denied') return {...row, status: 'no-access', how: 'No access'};
  if (result.status === 'pdf') return {...row, status: 'pdf-unread', how: 'A PDF: capture it by itself to read its links'};
  if (/No tab with id/i.test(result.error || '')) return {...row, title: '', status: 'closed', how: 'The tab was closed'};
  if (/error page/i.test(result.error || '')) return {...row, status: 'not-loaded', how: 'Didn’t load: Chrome showed an error page'};
  return {...row, status: 'error', how: result.warning || result.error || 'Couldn’t be read'};
}
const unread = (item, how, status = 'not-read') => ({url: item.url || '', title: '', found: 0, added: 0, skipped: 0, leftOut: 0, status, how});

// Drives a run to its end: one step at a time, paced, until the queue is done, a step ends the
// run, or Stop is pressed. Every change is saved, so a restarted worker knows where it was.
async function drive(job) {
  const {run} = job, kind = KINDS[run.kind];
  const beat = setInterval(keepAwake, KEEP_AWAKE_MS);
  try {
    while (!run.ended) {
      if (job.stopped) { run.ended = {reason: 'stopped'}; break; }
      if (run.at >= run.queue.length) { run.ended = {reason: 'finished'}; break; }
      if (run.at > 0 && kind.pause && !run.quick) { await pause(job, kind.pause); if (job.stopped) continue; }
      const item = run.queue[run.at];
      run.doing = {index: run.at}; run.live = null; run.page = null;
      await save(run); progress(run);
      let outcome;
      try { outcome = await kind.step(job, item); }
      catch (error) { outcome = {row: unread(item, `Couldn’t be read: ${error?.message || error}`, 'error'), ...(kind.endsOnFailure ? {end: {reason: 'failed'}} : {})}; }
      run.results.push({page: run.at + 1, ...outcome.row});
      run.links += outcome.row.added || 0;
      run.at++; run.doing = null; run.live = null; run.quick = outcome.quick === true;
      if (outcome.next) run.queue.push(outcome.next);
      if (outcome.end) run.ended = outcome.end;
      await save(run);
    }
  } finally { clearInterval(beat); }
  await finish(job);
}
// A run that can't be ended in the usual way is still ended, so the next one can start.
async function abandon(job, error) {
  const {run} = job, text = `The run ended early: ${error?.message || error}`;
  Object.assign(run, {state: 'done', stopping: false, doing: null, live: null, ended: {reason: 'failed', text}, summary: text, count: run.count || 0, finishedAt: iso()});
  await save(run);
  if (going === job) going = null;
  progress(run);
}
const start = job => { drive(job).catch(error => abandon(job, error)).catch(() => { if (going === job) going = null; }); };

// The end of a run: every page not read gets its row, the batch is counted as saved, and the
// report is kept where every Link Meteor page shows it.
async function finish(job) {
  const {run} = job, kind = KINDS[run.kind];
  const reason = run.ended?.reason || 'finished';
  for (let index = run.at; index < run.queue.length; index++) run.results.push({page: index + 1, ...unread(run.queue[index], reason === 'stopped' ? STOPPED : reason === 'interrupted' ? 'Not read: the run was interrupted' : 'Not read')});
  run.at = run.queue.length;
  run.count = 0;
  if (kind.saves !== false) {
    try {
      const state = await serial(readState);
      run.count = state.collections.find(c => c.id === run.collectionId)?.links.filter(link => link.batchId === run.batchId).length || 0;
    } catch { run.count = run.links; }
  }
  const sum = key => run.results.reduce((total, row) => total + (row[key] || 0), 0);
  const read = run.results.filter(row => row.status === 'captured' || row.status === 'empty').length;
  Object.assign(run, {state: 'done', stopping: false, doing: null, live: null, finishedAt: iso()});
  const words = kind.words({run, read, reason});
  run.ended = {...run.ended, reason, text: words.ended};
  run.summary = [words.head, sum('skipped') ? `${n(sum('skipped'))} ${sum('skipped') === 1 ? 'was' : 'were'} already saved and skipped.` : '',
    sum('leftOut') ? `${plural(sum('leftOut'), 'navigation link was', 'navigation links were')} left out.` : ''].filter(Boolean).join(' ');
  const note = [words.ended, words.where || '', run.count && kind.saves !== false ? `The links from ${read === 1 ? 'that page' : `all ${n(read)} pages`} are one batch, so Undo removes them together.` : ''].filter(Boolean).join(' ');
  const report = {kind: 'run', run: run.kind, runId: run.runId, batchId: run.batchId, collectionId: run.collectionId, name: run.name, results: run.results, head: words.head,
    capturedCount: run.count, found: sum('found'), skipped: sum('skipped'), leftOut: sum('leftOut'), read, ended: run.ended, summary: run.summary, note};
  await save(run);
  // A kind that shows its own report (report: false) reads it from run.status and the last run.progress.
  if (kind.report !== false) try { await chrome.storage.session.set({[REPORT_KEY]: {report, createdAt: run.finishedAt}}); } catch { /* run.status still has the summary */ }
  if (going === job) going = null;
  progress(run);
  if (run.tabId !== undefined && kind.onPage) await tellPage(run.tabId, {runId: run.runId, done: true, text: [words.head, words.ended].filter(Boolean).join(' ')});
}

// Only one run at a time. Claims the right to start one; the caller sets `starting` back to false.
// A run the last worker left unfinished is picked up first (see adopt).
async function claim() {
  if (going || starting) throw new Error(BUSY);
  starting = true;
  try {
    const left = await stored();
    if (left?.state === 'running') { await adopt(left); if (going) throw new Error(BUSY); }
  } catch (error) { starting = false; throw error; }
}

// run.start {kind, tabId?, urls?, collectionId, scroll}: starts a run and answers {runId} at once.
// The run goes on by itself; run.progress says how far it is, and run.stop ends it.
export async function startRun(message, sender = {}) {
  const kind = Object.hasOwn(KINDS, message.kind) && KINDS[message.kind].step ? KINDS[message.kind] : null;
  if (!kind) throw new Error(`A run is one of: ${Object.keys(KINDS).filter(name => KINDS[name].step).join(', ')}.`);
  const saves = kind.saves !== false;
  if (saves && (typeof message.collectionId !== 'string' || !message.collectionId)) throw new Error('Choose a collection for the links.');
  if (message.scroll !== undefined && typeof message.scroll !== 'boolean') throw new Error('Say whether to scroll each page to the end first.');
  await claim();
  let job;
  try {
    const state = await serial(readState);
    const home = state.collections.find(c => c.id === message.collectionId);
    if (saves && !home) throw new Error('The chosen collection no longer exists, so nothing was started. Choose another destination.');
    const run = {runId: crypto.randomUUID(), kind: message.kind, state: 'running', stopping: false, collectionId: home?.id || '', name: home?.name || '', batchId: crypto.randomUUID(),
      scroll: message.scroll === true && kind.scrolls === true, queue: [], at: 0, seen: [], results: [], links: 0, doing: null, live: null, page: null, ended: null, startedAt: iso()};
    Object.assign(run, await kind.begin(message, sender, state));
    job = hold(run);
    await save(run);
  } finally { starting = false; }
  start(job);
  return {runId: job.run.runId};
}

// run.stop {runId}, from the workbench or from the page the run is reading: the step in hand ends
// with what it has, and the run ends.
export async function stopRun(message, sender = {}) {
  if (!going) await woke;
  const job = going;
  if (!job || (message.runId && message.runId !== job.run.runId)) return {stopped: false};
  const {run} = job, fromPage = !sender.url?.startsWith(WORKBENCH);
  if (fromPage && (sender.tab?.id === undefined || ![run.tabId, run.doing?.tabId].includes(sender.tab.id))) throw new Error('Only the page a run is reading can stop it.');
  job.stopped = true; run.stopping = true;
  for (const wake of [...job.waiters]) wake();
  // Stop pressed in the workbench reaches the page too, where a scroll may be going.
  const tabId = run.tabId ?? run.doing?.tabId;
  if (!fromPage && tabId !== undefined) tellPage(tabId, {runId: run.runId, halt: true});
  await save(run); progress(run);
  return {stopped: true};
}

// run.scroll {runId, screen, of, links} from the page that is scrolling: its counter, passed on.
function scrolled(message, sender = {}) {
  const run = going?.run;
  if (!run || run.runId !== message.runId || sender.tab?.id !== run.tabId) return {};
  const number = (value, most) => Number.isInteger(value) && value >= 0 ? Math.min(value, most) : 0;
  run.live = {screen: number(message.screen, SCROLL_SCREENS), of: number(message.of, SCROLL_SCREENS) || SCROLL_SCREENS, links: number(message.links, MAX_LINKS)};
  progress(run);
  return {};
}

// run.status {}: the run in progress, or the last one that ended, for a workbench opened meanwhile.
export async function runStatus() {
  const run = going?.run || await stored();
  return {run: run ? view(run) : null};
}

// A link is as the run saved it: no note, tag, reading status, star or custom value since.
const touched = link => !!(link.notes || link.tags?.length || link.status || link.starred || (link.fields && Object.keys(link.fields).length));
// run.undo {collectionId, batchId}: removes the last run's batch while it is exactly as the run
// left it. The workbench's own removal Undo is kept.
export function undoRun(message) {
  for (const key of ['collectionId', 'batchId']) if (typeof message[key] !== 'string' || !message[key]) throw new Error('Say which run to undo.');
  return serial(async () => {
    const run = await stored();
    if (!run || run.state !== 'done' || run.undone || run.batchId !== message.batchId || run.collectionId !== message.collectionId) throw new Error('This run can no longer be undone. Remove its links in the list instead.');
    const previous = await readState();
    const home = previous.collections.find(c => c.id === run.collectionId);
    if (!home) throw new Error('The collection this run saved to no longer exists, so there is nothing to undo.');
    const batch = home.links.filter(link => link.batchId === run.batchId);
    if (batch.length !== run.count || batch.some(touched)) throw new Error('These links changed since the run, so Undo is no longer possible. Remove them in the list instead.');
    let state = previous;
    if (batch.length) {
      state = {...reduceState(previous, {type: 'links.remove', collectionId: home.id, ids: batch.map(link => link.id)}), undo: previous.undo};
      try { await writeState(previous, state); } catch { throw new Error('Could not undo the run. Nothing was changed.'); }
    }
    await save({...run, undone: true});
    // The kept report remembers it, so a view that shows the report later doesn't offer Undo again.
    try {
      const kept = (await chrome.storage.session.get(REPORT_KEY))[REPORT_KEY];
      if (kept?.report?.batchId === run.batchId) await chrome.storage.session.set({[REPORT_KEY]: {...kept, report: {...kept.report, undone: batch.length}}});
    } catch { /* the notice still says it */ }
    return {state, count: batch.length, name: home.name};
  });
}

// When the worker starts: a run the last worker left unfinished. The step it was on is reported as
// interrupted, and a background tab it had opened is closed. A kind that can go on (selected pages:
// its queue is known) continues with the rest; any other ends there, with what it saved.
export async function resumeRun() {
  if (going || starting) return;
  starting = true;
  try { const run = await stored(); if (run?.state === 'running') await adopt(run); }
  finally { starting = false; }
}
async function adopt(run) {
  const kind = KINDS[run.kind] || {};
  const job = hold(run);
  if (run.doing) {
    if (run.doing.tabId !== undefined) await chrome.tabs.remove(run.doing.tabId).catch(() => {});
    if (run.queue?.[run.at]) { run.results.push({page: run.at + 1, ...unread(run.queue[run.at], 'Interrupted: Chrome stopped Link Meteor’s background worker', 'interrupted')}); run.at++; }
    run.doing = null; run.live = null;
  }
  if (!kind.step) {
    // Scroll to the end first: the capture's own answer was lost with the worker.
    Object.assign(run, {state: 'done', stopping: false, ended: {reason: 'interrupted', text: INTERRUPTED}, summary: INTERRUPTED, count: 0, finishedAt: iso()});
    await save(run); going = null; progress(run);
    return;
  }
  if (!kind.resumes || job.stopped) {
    run.ended = {reason: job.stopped ? 'stopped' : 'interrupted'};
    try { await finish(job); } catch (error) { await abandon(job, error); }
    return;
  }
  await save(run);
  start(job);
}

/* Scroll to the end first (capture.run with scroll: true) ---------------------------------------- */
// One page, read by the page script's scroll loop through Capture this page's own pipeline. It is
// registered like a run so that the workbench shows its counter and Stop, only one runs at a time,
// and its batch has an Undo.
export async function scrollCapture(message, sender = {}) {
  const ids = Array.isArray(message.tabIds) ? [...new Set(message.tabIds)] : [];
  if (ids.length > 1) throw new Error('Scroll to the end first works on one page at a time. Choose This page.');
  await claim();
  let job;
  try {
    const tab = await capture.resolveTarget(ids[0], sender.tab?.id);
    const state = await serial(readState);
    const home = state.collections.find(c => c.id === state.activeCollectionId);
    job = hold({runId: crypto.randomUUID(), kind: 'scroll', state: 'running', stopping: false, collectionId: home?.id || '', name: home?.name || '', batchId: '', tabId: tab.id,
      queue: [], at: 0, results: [], links: 0, doing: {index: 0}, live: {screen: 1, of: SCROLL_SCREENS, links: 0}, page: {title: tab.title || '', url: tab.url || ''}, ended: null, startedAt: iso()});
    await save(job.run);
  } finally { starting = false; }
  const {run} = job, beat = setInterval(keepAwake, KEEP_AWAKE_MS);
  progress(run);
  try {
    const result = await capture.captureTabs([run.tabId], sender.tab?.id, {scan: {scroll: {runId: run.runId}}});
    const scroll = result.report.results[0]?.scroll;
    Object.assign(run, {batchId: result.report.batchId, count: result.report.capturedCount, ended: {reason: scroll?.ended || 'finished', text: scroll?.text || ''}});
    // The report says which collection the batch went to, so any view that shows it can offer Undo.
    result.report.collectionId = run.collectionId;
    try {
      const kept = (await chrome.storage.session.get(REPORT_KEY))[REPORT_KEY];
      if (kept?.report?.batchId === run.batchId) await chrome.storage.session.set({[REPORT_KEY]: {...kept, report: {...kept.report, collectionId: run.collectionId}}});
    } catch { /* the workbench that asked still has it */ }
    return result;
  } finally {
    clearInterval(beat);
    Object.assign(run, {state: 'done', stopping: false, doing: null, live: null, finishedAt: iso()});
    await save(run);
    if (going === job) going = null;
    progress(run);
  }
}

/* What one step does ---------------------------------------------------------------------------- */
// The page's own Next link, asked of the page script: {url}, {button: true} or null.
async function findNext(tabId) {
  try { const [found] = await chrome.scripting.executeScript({target: {tabId}, func: () => globalThis.__linkMeteor?.next?.() ?? null}); return found?.result || null; }
  catch { return null; }
}

// A PDF's links as stored occurrences: the PDF is their source page, and each keeps its page number.
function pdfOccurrences(raw, tab, batchId) {
  if (!Array.isArray(raw) || raw.length > MAX_LINKS) throw new Error('a PDF’s links must be a list of at most 20,000');
  const capturedAt = new Date().toISOString(), text = (item, key) => typeof item?.[key] === 'string' ? item[key] : '';
  const title = String(raw[0]?.sourceTitle || tab.title || '').replace(/\s+/gu, ' ').trim().slice(0, 300);
  return raw.map(item => {
    const url = new URL(text(item, 'url'));
    if (!SCHEMES.includes(url.protocol)) throw new Error('a PDF’s link has an address Link Meteor doesn’t save');
    const context = text(item, 'context').replace(/\s+/gu, ' ').trim().slice(0, MAX_CONTEXT);
    return {id: crypto.randomUUID(), anchorText: text(item, 'anchorText'), accessibleLabel: '', url: url.href, originalHref: text(item, 'originalHref'), sourceUrl: tab.url, sourceTitle: title,
      frameUrl: '', capturedAt, batchId, notes: '', tags: [], ...(Number.isInteger(item.pdfPage) ? {pdfPage: item.pdfPage} : {}), ...(context ? {context} : {})};
  });
}
// A selected page that is a PDF: an open Link Meteor page reads it (run.pdf, answered by
// run.pdfLinks), and its links join the run's batch.
async function readPdf(job, item, tab) {
  const {run} = job, row = {...unread(item, ''), url: tab.url || item.url, title: tab.title || ''};
  const reply = await ask(job, {type: 'run.pdf', runId: run.runId, step: run.at, tabId: tab.id, url: tab.url, title: tab.title || ''}, PDF_WAIT_MS);
  if (!reply) return {...row, status: job.stopped ? 'not-read' : 'pdf-unread', how: job.stopped ? STOPPED : 'A PDF: keep Link Meteor open during the run to read PDFs.'};
  if (typeof reply.error === 'string' && reply.error) return {...row, status: 'error', how: `A PDF: ${reply.error}`};
  let links;
  try { links = pdfOccurrences(reply.links, tab, run.batchId); } catch (error) { return {...row, status: 'error', how: `A PDF that couldn’t be saved: ${error.message}`}; }
  const pages = reply.pages && typeof reply.pages === 'object' && !Array.isArray(reply.pages) ? reply.pages : undefined;
  const added = links.length ? await appendLinks(links, {collectionId: run.collectionId, pages, missing: 'The collection was deleted during the run, so nothing was saved from this page.'}) : {count: 0, skipped: 0};
  const size = Number.isInteger(reply.pageCount) && reply.pageCount > 0 ? `, ${plural(reply.pageCount, 'page')}` : '';
  return {...row, found: links.length, added: added.count, skipped: added.skipped, status: links.length ? 'captured' : 'empty',
    how: links.length ? `Captured: a PDF${size}${added.count ? '' : ', nothing new'}` : `A PDF${size} with no links Link Meteor can read`};
}

// A web address without its # part, or '' for anything else.
const webAddress = value => { try { const url = new URL(String(value ?? '')); url.hash = ''; return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
const originOf = url => { try { return new URL(url).origin; } catch { return ''; } };
// How a PDF's file ends when the page that fetches it says why it couldn't (ui/workbench/pdf-tab.js).
// The two limits are said in pdfSetProblem's words.
const FILE_REASONS = {
  'not-pdf': 'Not a PDF: the site asked to sign in, or the address has expired.',
  size: pdfSetProblem([MAX_PDF_BYTES + 1]),
  status: 'The site answered with an error instead of the PDF.',
  'set-size': pdfSetProblem(Array(Math.floor(MAX_PDF_SET_BYTES / MAX_PDF_BYTES) + 1).fill(MAX_PDF_BYTES)),
};
const DOWNLOADED = 'Chrome downloaded this one instead of showing it. It is in your Downloads folder, not in this file.';
const FILE_UNANSWERED = 'The Link Meteor page that started this didn’t answer, so the run ended. Keep it open until the PDFs are fetched.';

const followCap = state => { const value = state.settings.followPages; return Number.isInteger(value) && value >= MIN_FOLLOW_PAGES && value <= MAX_FOLLOW_PAGES ? value : MAX_FOLLOW_PAGES; };
const addedTo = (run) => run.count ? `added ${plural(run.count, 'link')} to “${run.name}”` : `no links were added to “${run.name}”`;

// Each kind of run:
//   title        the progress line's heading
//   begin        checks the request and returns the run's own fields (queue: [{url}], and more)
//   step         does one item of the queue: {row, next?, end?, quick?}. `row` is the item's line in
//                the report; `next` is one more item for the queue; `end` ({reason, …}) ends the run;
//                `quick` says no site was asked for anything, so the next step needn't wait
//   pause        milliseconds between steps
//   counter      {step, of, links, text} for the progress line
//   words        {head, ended, where?} for the report, once the run is over
//   scrolls      Scroll to the end first applies; resumes: a restarted worker goes on with the rest
//   endsOnFailure  a step that throws ends the run; onPage: the page it reads shows the notice
//   saves        false for a kind that saves no links: it needs no collection, and no Undo is offered
//   report       false for a kind that shows its own report, from run.status and the last run.progress
export const KINDS = {
  // Scroll to the end first, alone: one page, no steps here (scrollCapture above).
  scroll: {
    title: 'Scrolling the page',
    counter: run => { const live = run.live || {screen: 1, of: SCROLL_SCREENS, links: 0}; return {step: live.screen, of: live.of, links: live.links, text: `Scrolling: screen ${n(live.screen)} of up to ${n(live.of)} · ${plural(live.links, 'link')}`}; },
  },

  // Follow Next: the same tab, moved to each page's own Next link.
  next: {
    title: 'Following Next', scrolls: true, endsOnFailure: true, onPage: true, pause: 0,
    async begin(message, sender, state) {
      const tab = await capture.resolveTarget(Number.isInteger(message.tabId) ? message.tabId : undefined, sender.tab?.id);
      return {tabId: tab.id, cap: followCap(state), queue: [{url: pageKey(tab.url || '')}]};
    },
    counter(run) {
      const step = Math.min(run.at + 1, run.cap), links = run.links + (run.live?.links || 0);
      return {step, of: run.cap, links, text: `Page ${n(step)} of up to ${n(run.cap)}${run.live ? ` · screen ${n(run.live.screen)} of up to ${n(run.live.of)}` : ''} · ${plural(links, 'link')}`};
    },
    async step(job, item) {
      const {run} = job, index = run.at, closed = {row: unread(item, 'Not read: the tab was closed', 'closed'), end: {reason: 'tab-closed'}};
      const lead = `Following Next: page ${n(index + 1)} of up to ${n(run.cap)} · `;
      let tab;
      if (index > 0) {
        // The same tab goes to the next page, as if the person had clicked Next.
        let moved;
        try { moved = await chrome.tabs.update(run.tabId, {url: item.url}); } catch { return closed; }
        const state = await loaded(job, run.tabId, moved?.status === 'loading');
        if (state === 'stopped') return {row: unread(item, STOPPED)};
        if (state === 'closed') return closed;
        if (state === 'timeout') return {row: unread(item, NOT_LOADED, 'not-loaded'), end: {reason: 'not-loaded'}};
      }
      try { tab = await chrome.tabs.get(run.tabId); } catch { return closed; }
      run.page = {title: tab.title || '', url: tab.url || item.url}; progress(run);
      if (index > 0) {
        // Where the address led: a page already read ends the run here.
        const landed = pageKey(tab.url || '');
        if (landed && landed !== item.url && run.seen.includes(landed)) return {row: unread({url: landed}, 'Not read: already read in this run', 'loop'), end: {reason: 'loop'}};
        const type = await documentType(run.tabId);
        if (type.type === 'application/pdf') return {row: {...unread(item, 'A PDF: capture it by itself to read its links', 'pdf-unread'), title: tab.title || ''}, end: {reason: 'pdf'}};
        if (/error page/i.test(type.error || '')) return {row: unread(item, 'Didn’t load: Chrome showed an error page', 'not-loaded'), end: {reason: 'not-loaded', shown: true}};
        await showOnPage(run, `${lead}${plural(run.links, 'link')}`);
        await pause(job, NEXT_PAUSE_MS);
        if (job.stopped) return {row: unread(item, STOPPED)};
        // The person may have moved or closed the tab meanwhile.
        let now;
        try { now = await chrome.tabs.get(run.tabId); } catch { return closed; }
        if ((now.url || '') !== (tab.url || '')) return {row: unread(item, 'Not read: the tab went to another page', 'moved'), end: {reason: 'tab-moved'}};
      } else await showOnPage(run, `${lead}${plural(run.links, 'link')}`);
      const result = await capturePage(job, run.tabId, run.scroll ? {scroll: {runId: run.runId, lead, links: run.links}} : {});
      let row = rowOf(result, item);
      // Chrome hides a tab once the toolbar's access is gone: the page is an error page, or on another site.
      if (index > 0 && result.status === 'denied') row = {...row, title: '', how: 'Not read: it didn’t load, or it moved to a site without access'};
      for (const url of [item.url, pageKey(result.url || '')]) if (url && !run.seen.includes(url)) run.seen.push(url);
      if (job.stopped) return {row};
      if (row.status === 'closed') return {row, end: {reason: 'tab-closed'}};
      if (result.status !== 'success') return {row, end: {reason: result.status === 'denied' ? (index ? 'moved-site' : 'denied') : row.status === 'not-loaded' ? 'not-loaded' : row.status === 'pdf-unread' ? 'pdf' : 'failed', detail: row.how, shown: true}};
      const next = await findNext(run.tabId), url = pageKey(next?.url || '');
      if (index + 1 >= run.cap) return {row, end: {reason: 'cap', more: !!url}};
      if (next?.button) return {row, end: {reason: 'next-button'}};
      if (!url) return {row, end: {reason: 'no-next'}};
      if (run.seen.includes(url)) return {row, end: {reason: 'loop'}};
      // The toolbar's temporary access stays while the tab stays on the same site. Another site
      // needs its own access, and is not opened without it.
      let same = false;
      try { same = new URL(url).origin === new URL(result.url || tab.url).origin; } catch { /* an address Chrome hides */ }
      if (!same && !(await hasAccess(url))) return {row, end: {reason: 'no-access', host: hostOf(url)}};
      return {row, next: {url}};
    },
    words({run, read, reason}) {
      const end = run.ended || {}, last = `page ${n(read)}`;
      const ended = {
        'no-next': `Page ${n(read)} has no Next link.`,
        'next-button': `On ${last}, Next is a button without an address, which Follow Next can’t use.`,
        cap: `Stopped at ${plural(run.cap, 'page')}, the limit you set.${end.more ? ' The last page has a Next link.' : ''}`,
        'no-access': `Next goes to ${end.host || 'another site'}, which Link Meteor has no access to.`,
        loop: 'Next goes to a page already read in this run.',
        'not-loaded': end.shown ? 'The next page didn’t load.' : `The next page didn’t load within ${LOAD_MS / 1000} seconds.`,
        stopped: 'You pressed Stop.',
        'tab-closed': 'The tab was closed.',
        'tab-moved': 'The tab went to another page.',
        interrupted: INTERRUPTED,
        denied: 'Link Meteor has no access to this page. Click the Link Meteor toolbar icon on it, then try again.',
        'moved-site': 'Next led to a page Link Meteor can’t read: it didn’t load, or it is on a site Link Meteor has no access to.',
        pdf: read ? 'Next led to a PDF, which Follow Next doesn’t read.' : 'This tab shows a PDF, which Follow Next doesn’t read. Capture the PDF by itself.',
        failed: end.detail || 'A page couldn’t be read.',
      }[reason] || '';
      return {head: `Followed Next through ${plural(read, 'page')}: ${addedTo(run)}.`, ended,
        where: read && ['no-next', 'next-button', 'cap', 'no-access', 'loop'].includes(reason) ? `Your tab is on ${last}.` : ''};
    },
  },

  // Capture selected pages: each in a background tab, one at a time, closed afterward.
  pages: {
    title: 'Capturing selected pages', resumes: true, pause: PAGES_PAUSE_MS,
    async begin(message) {
      if (!Array.isArray(message.urls) || message.urls.some(url => typeof url !== 'string' || !pageKey(url))) throw new Error('Choose web pages to capture.');
      const urls = [...new Set(message.urls.map(pageKey))];
      if (!urls.length) throw new Error('Choose at least one page to capture.');
      if (urls.length > MAX_RUN_PAGES) throw new Error(`Choose up to ${MAX_RUN_PAGES} pages at a time.`);
      return {queue: urls.map(url => ({url}))};
    },
    counter: run => ({step: Math.min(run.at + 1, run.queue.length), of: run.queue.length, links: run.links, text: `Page ${n(Math.min(run.at + 1, run.queue.length))} of ${n(run.queue.length)} · ${plural(run.links, 'link')}`}),
    async step(job, item) {
      const {run} = job;
      // A page on a site Link Meteor can't read is not opened.
      if (!(await hasAccess(item.url))) return {row: unread(item, 'No access', 'no-access')};
      let tab;
      try { tab = await chrome.tabs.create({url: item.url, active: false}); } catch (error) { return {row: unread(item, `Chrome couldn’t open it: ${error?.message || error}`, 'error')}; }
      run.doing = {index: run.at, tabId: tab.id}; await save(run);
      try {
        const state = await loaded(job, tab.id, true);
        if (state === 'stopped') return {row: unread(item, STOPPED)};
        if (state === 'closed') return {row: unread(item, 'The tab closed before it was read. Chrome may have downloaded this address as a file instead of showing it.', 'closed')};
        if (state === 'timeout') return {row: unread(item, NOT_LOADED, 'not-loaded')};
        const now = await chrome.tabs.get(tab.id);
        // Where the address led: a site without access is closed unread, and reported the same way.
        if (!now.url || !(await hasAccess(now.url))) return {row: unread(item, now.url ? `No access: it moved to ${hostOf(now.url)}` : 'No access: it moved to another site', 'no-access')};
        run.page = {title: now.title || '', url: now.url}; progress(run);
        const type = await documentType(tab.id);
        if (/error page/i.test(type.error || '')) return {row: unread(item, 'Didn’t load: Chrome showed an error page', 'not-loaded')};
        // The page shows the counter and Stop too, should the person look at that tab.
        await showOnPage(run, `Capturing selected pages: page ${n(run.at + 1)} of ${n(run.queue.length)} · ${plural(run.links, 'link')}`, tab.id);
        if (type.type === 'application/pdf') return {row: await readPdf(job, item, now)};
        return {row: rowOf(await capturePage(job, tab.id), item)};
      } finally {
        await chrome.tabs.remove(tab.id).catch(() => {});
        run.doing = {index: run.at};
      }
    },
    words({run, read, reason}) {
      const total = run.queue.length;
      return {head: `Captured ${read === total ? plural(total, 'selected page') : `${n(read)} of ${plural(total, 'selected page')}`}: ${addedTo(run)}.`,
        ended: reason === 'stopped' ? 'You pressed Stop.' : reason === 'interrupted' ? INTERRUPTED : ''};
    },
  },
  // The PDFs behind chosen links, for one ZIP or one combined PDF. The Link Meteor page that started
  // the run holds the files: for each one the background finds a tab on the PDF's own site, and that
  // page fetches the file through it (run.file, answered by run.fileDone). Which tab, in order:
  //   1. the person's own tab, when it is on the PDF's site and Link Meteor can read it;
  //   2. a background tab at the page the link was captured from when that is on the PDF's site,
  //      else at the site's front page;
  //   3. when the address moves to another site, a background tab at the PDF's own address, read
  //      once Chrome shows it.
  // Background tabs are opened only on sites Link Meteor has access to, and closed afterward.
  files: {
    title: 'Getting PDFs', saves: false, report: false, resumes: true, pause: FILES_PAUSE_MS,
    begin(message) {
      const files = Array.isArray(message.files) ? message.files : [];
      if (!files.length) throw new Error('Choose at least one PDF.');
      const problem = pdfSetProblem(files.map(() => 0));
      if (problem) throw new Error(problem);
      const queue = files.map(file => {
        const url = webAddress(file?.url), from = webAddress(file?.from);
        if (!url) throw new Error('Choose PDFs at web addresses.');
        // The page the link came from is opened only when it is a page of the PDF's own site: not a file
        // (a PDF's own links name that PDF as their source), which Chrome might download instead of showing.
        return {url, name: typeof file.name === 'string' ? file.name.slice(0, 200) : '', ...(from && originOf(from) === originOf(url) && !isFileLink({url: from}) ? {from} : {})};
      });
      return {queue, ...(Number.isInteger(message.tabId) ? {own: message.tabId} : {})};
    },
    counter: run => { const step = Math.min(run.at + 1, run.queue.length); return {step, of: run.queue.length, links: 0, text: `Getting PDF ${n(step)} of ${n(run.queue.length)}`}; },
    async step(job, item) {
      const {run} = job, index = run.at, origin = originOf(item.url);
      const ended = (status, how, more = {}) => ({row: {...unread(item, how, status), title: item.name || '', ...more.row}, ...(more.end ? {end: more.end} : {}), ...(more.quick ? {quick: true} : {})});
      // The page that started the run fetches the file through this tab: '' is the tab's own address.
      // Returns the step's outcome, or null when another way is worth trying (`why` says what failed).
      let why = '';
      const through = async (tabId, url) => {
        const reply = await ask(job, {type: 'run.file', runId: run.runId, step: index, tabId, url}, FILE_WAIT_MS);
        why = typeof reply?.reason === 'string' ? reply.reason : '';
        if (!reply) return job.stopped ? ended('not-read', STOPPED) : ended('no-answer', FILE_UNANSWERED, {end: {reason: 'no-answer'}});
        if (reply.ok === true) return ended('got', 'Fetched', {row: {size: Number.isInteger(reply.size) && reply.size > 0 ? reply.size : 0}});
        if (reply.reason === 'set-size') return ended('too-large', FILE_REASONS['set-size'], {end: {reason: 'too-large'}});
        return Object.hasOwn(FILE_REASONS, reply.reason) ? ended(reply.reason === 'size' ? 'too-large' : reply.reason, FILE_REASONS[reply.reason]) : null;
      };
      // A background tab, closed again whatever happens. `use` gets the tab once it has loaded.
      const inTab = async (url, use) => {
        let tab;
        try { tab = await chrome.tabs.create({url, active: false}); } catch (error) { return ended('error', `Chrome couldn’t open a tab for it: ${error?.message || error}`); }
        run.doing = {index, tabId: tab.id}; await save(run);
        try {
          const state = await loaded(job, tab.id, true);
          if (state === 'stopped') return ended('not-read', STOPPED);
          return await use(tab.id, state);
        } finally {
          await chrome.tabs.remove(tab.id).catch(() => {});
          run.doing = {index};
        }
      };
      run.page = {title: item.name || '', url: item.url}; progress(run);
      // 1. The person's own tab. Chrome shows its address only while Link Meteor can read it.
      let moved = false;
      if (run.own !== undefined) {
        const tab = await chrome.tabs.get(run.own).catch(() => null);
        if (tab?.url && originOf(tab.url) === origin) {
          const outcome = await through(tab.id, item.url);
          if (outcome) return outcome;
          // The page couldn't get it at all: most often the address moves to another site.
          moved = why === 'failed';
        }
      }
      if (!(await hasAccess(item.url))) return moved ? ended('no-access', 'Not fetched: the address may move to another site, which Link Meteor has no access to') : ended('no-access', 'No access', {quick: true});
      // 2. A page of the PDF's own site, in a background tab.
      if (!moved) {
        const outcome = await inTab(item.from || `${origin}/`, async (tabId, state) => {
          if (state !== 'complete') return null;
          const now = await chrome.tabs.get(tabId).catch(() => null);
          return now?.url && originOf(now.url) === origin ? through(tabId, item.url) : null;
        });
        if (outcome) return outcome;
      }
      // 3. The address itself, which may move to another site. An address the site sends as a
      // download never shows: Chrome saves the file and closes the tab.
      return inTab(item.url, async (tabId, state) => {
        if (state === 'closed') return ended('downloaded', DOWNLOADED);
        if (state === 'timeout') return ended('not-loaded', NOT_LOADED);
        // A tab Chrome is about to close for a download shows no address for a moment first.
        let now = await chrome.tabs.get(tabId).catch(() => null);
        for (let waited = 0; now && !now.url && waited < CLOSING_MS; waited += POLL_MS) {
          await pause(job, POLL_MS);
          if (job.stopped) return ended('not-read', STOPPED);
          now = await chrome.tabs.get(tabId).catch(() => null);
        }
        if (!now) return ended('downloaded', DOWNLOADED);
        if (!now.url || !(await hasAccess(now.url))) return ended('no-access', now?.url ? `No access: it moved to ${hostOf(now.url)}` : 'No access: it moved to another site');
        if (/error page/i.test((await documentType(tabId)).error || '')) return ended('not-loaded', 'Didn’t load: Chrome showed an error page');
        return await through(tabId, '') || ended('failed', 'Chrome couldn’t get this PDF’s file');
      });
    },
    words({run, reason}) {
      const got = run.results.filter(row => row.status === 'got').length;
      return {head: `Fetched ${got === run.queue.length ? plural(got, 'PDF') : `${n(got)} of ${plural(run.queue.length, 'PDF')}`}.`,
        ended: reason === 'stopped' ? 'You pressed Stop.' : reason === 'interrupted' ? INTERRUPTED : reason === 'no-answer' ? FILE_UNANSWERED : reason === 'too-large' ? FILE_REASONS['set-size'] : ''};
    },
  },
};
// The message types that answer an ask(), by kind of step: reading a PDF among selected pages, and
// fetching a PDF's file.
const ANSWERS = ['run.pdfLinks', 'run.fileDone'];
// For a kind added later: the engine's tools.
export const engine = {pause, ask, loaded, hasAccess, documentType, tellPage, capturePage, rowOf, unread, save, progress, plural, hostOf};

// Messages this module answers, accepted only from the workbench.
export const workbenchMessages = {
  'run.start': (message, sender) => startRun(message, sender),
  'run.status': () => runStatus(),
  'run.undo': (message) => undoRun(message),
  ...Object.fromEntries(ANSWERS.map(type => [type, (message) => answer(message)])),
};
// Messages a page may send too: Stop on the page the run is reading (or in the workbench), and the
// scroll's counter.
export const pageMessages = {
  'run.stop': (message, sender) => stopRun(message, sender),
  'run.scroll': (message, sender) => scrolled(message, sender),
};

// A worker that starts while a run is recorded as going picks it up (see resumeRun).
const woke = resumeRun().catch(() => {});
