// Page details lookup (0.6.0): the one optional online feature. It is off unless the person turns
// it on under Online lookups, and then runs only on a click on Look up details: for the selected
// links, in a link's details, or beside the Export panel's "no authors yet" line.
// Nothing here can reach the network. The request is made by the sandboxed frame
// (ui/lookup-frame.html), created hidden when a run starts and removed when it ends; it is never
// present otherwise, and never created while the setting is off. This module hands it one
// identifier at a time (a DOI, an arXiv ID as arXiv's DOI, or a PubMed ID) and nothing else: never
// a link's address, text, notes or collection name. Only core/lookup.js's reading of an answer is
// saved, with links.append, so the model's mergeCitation decides what wins; Undo puts back what
// each address held before, with pages.restore.
import { LOOKUP_PAUSE_MS, LOOKUP_SERVICES, MAX_LOOKUP_FAILURES, lookupMissing, lookupOutcome, lookupPlan, lookupReport, lookupRequests, missingWords, readAnswer, sameCitation, unauthored } from '../../core/lookup.js';
import { identifiersOf, citationFor } from '../../core/identifiers.js';
import { CITE_FORMATS } from '../../core/export.js';
import { $, node, button, count, labelFor } from './helpers.js';
import { ui, request, action, show, currentCollection } from './state.js';
import { render, onRender, setView } from './rendering.js';
import { targetRows } from './review.js';

// How long the frame may take to load, and a service to answer, before the run gives up on it.
const FRAME_READY_MS = 10000, ANSWER_MS = 20000;
let run = null;   // the run in progress: {collectionId, total, at, ended, reason, last, wake, frame}
let starting = false; // a click is being checked against the saved setting: a second one waits its turn
let done = null;  // the last run's result, for its line and Undo: {collectionId, text, before, after, focus}
let host = 'toolbar'; // where the progress and the result show: with the list, or in the Export panel
// Identifiers asked about since the workbench opened that had nothing to add: asked last when a
// selection is over the limit, so another click reaches the rest.
const seen = new Set();
// The switch position just chosen, kept while it is being saved.
let draft = null, saving = 0;

/* The frame -------------------------------------------------------------------------------------- */
// Created hidden for one run, and removed when the run ends. `ask` posts one identifier and
// resolves with the frame's answer: {status, body} or {error}; {late} when a service doesn't
// answer in time; {stopped: true} once the frame is closed.
function openFrame() {
  return new Promise((ready, fail) => {
    const frame = document.createElement('iframe');
    frame.id = 'lookup-frame'; frame.hidden = true; frame.tabIndex = -1; frame.title = 'Page details lookup'; frame.setAttribute('aria-hidden', 'true');
    const waiting = new Map();
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true; clearTimeout(timer); removeEventListener('message', onMessage); frame.remove();
      for (const settle of waiting.values()) settle({ stopped: true });
      waiting.clear();
    };
    const ask = ({ service, identifier }) => new Promise((settle) => {
      if (closed) { settle({ stopped: true }); return; }
      const id = crypto.randomUUID();
      const late = setTimeout(() => { waiting.delete(id); settle({ late: `${LOOKUP_SERVICES[service]?.name || 'The service'} took too long to answer, so the lookup stopped here.` }); }, ANSWER_MS);
      waiting.set(id, (answer) => { clearTimeout(late); settle(answer); });
      // The frame's origin is "null", so the message can't name it. It holds the identifier and nothing else.
      frame.contentWindow.postMessage({ type: 'lookup', id, service, identifier }, '*');
    });
    const timer = setTimeout(() => { close(); fail(new Error('The lookup couldn’t start, so nothing was sent.')); }, FRAME_READY_MS);
    function onMessage(event) {
      if (event.source !== frame.contentWindow) return;
      if (event.data?.type === 'lookup.ready') { clearTimeout(timer); ready({ ask, close }); }
      if (event.data?.type === 'lookup.answer' && waiting.has(event.data.id)) {
        const settle = waiting.get(event.data.id);
        waiting.delete(event.data.id);
        const { status, body, error } = event.data;
        settle(typeof error === 'string' ? { error } : Number.isInteger(status) && typeof body === 'string' ? { status, body } : { error: 'The lookup couldn’t read the service’s answer.' });
      }
    }
    addEventListener('message', onMessage);
    frame.src = chrome.runtime.getURL('ui/lookup-frame.html');
    document.body.append(frame);
  });
}

/* A run ------------------------------------------------------------------------------------------ */
// Requests are at least LOOKUP_PAUSE_MS apart, counted from the last answer. Stop ends the wait.
async function pace() {
  for (;;) {
    const wait = run.last === undefined ? 0 : LOOKUP_PAUSE_MS - (performance.now() - run.last);
    if (wait <= 0 || run.ended) return;
    await new Promise((go) => { const timer = setTimeout(go, wait); run.wake = () => { clearTimeout(timer); go(); }; });
  }
}

// Ends the run with what it has: 'stopped' (the person), 'limit' (a service said to slow down, or
// didn't answer in time: `reason` says which), 'failures' (several in a row couldn't be looked up)
// or 'off' (the setting was turned off). The frame goes at once, and any request in it with it.
function end(how, reason = '') {
  if (!run || run.ended) return;
  run.ended = how; run.reason = reason;
  run.wake?.();
  run.frame?.close();
}

function place() {
  $(host === 'export' ? 'lookup-export-host' : 'lookup-toolbar-host').append($('lookup-status'));
}

function renderStatus() {
  const collection = currentCollection();
  // The Export panel's citation block hides with another format: a run started there shows with the list instead.
  if (host === 'export' && $('cite-block').hidden && (run || done)) { host = 'toolbar'; place(); }
  $('lookup-progress').hidden = !run;
  if (run) {
    $('lookup-count').textContent = `Looking up ${count(Math.max(run.at, 1))} of ${count(run.total)}`;
    $('lookup-bar').max = run.total; $('lookup-bar').value = Math.max(run.at - 1, 0);
  }
  const shown = !!done && !run && done.collectionId === collection?.id;
  $('lookup-done').hidden = !shown;
  if (shown && $('lookup-done-text').textContent !== done.text) $('lookup-done-text').textContent = done.text;
  $('lookup-undo').hidden = !(shown && done.before);
  $('lookup-status').hidden = !run && !shown;
  $('lookup-box').hidden = $('lookup-line').hidden && (host !== 'export' || $('lookup-status').hidden);
  for (const id of ['lookup-selected', 'lookup-authors']) $(id).disabled = !!run;
}

// A click with the setting off shows what the lookup would send, instead of sending anything.
function explain(returnFocus) {
  if (!matchMedia('(min-width: 900px)').matches) setView('collections', returnFocus);
  $('online-panel').scrollIntoView({ block: 'start' });
  $('lookup-details').focus({ preventScroll: true });
  show('Page details lookup is off, so nothing was sent. Online lookups says what it sends and where. Turn it on there, then click Look up details again.');
}

// Looks up these links (or rows). `where` is 'toolbar' or 'export'; `back` takes focus when the
// result is dismissed.
async function start(links, where, back) {
  const collection = currentCollection();
  if (!collection || !links.length) return;
  if (run) { show('A lookup is already running. Wait for it to finish, or press Stop.'); return; }
  if (starting) return;
  // The saved setting, read again now: nothing is created or sent while it is off.
  starting = true;
  let saved;
  try { saved = await request({ type: 'state.get' }); } finally { starting = false; }
  if (!saved.settings.lookupDetails) {
    if (ui.state.settings.lookupDetails) { ui.state = saved; render(); }
    explain(back);
    return;
  }
  const plan = lookupPlan(links, saved.collections.find((item) => item.id === collection.id)?.pages || {}, { seen });
  host = where; done = null; place();
  const results = [];
  let failures = 0, report;
  run = { collectionId: collection.id, total: plan.asks.length, at: 0, ended: '', reason: '' };
  try {
    if (plan.asks.length) {
      renderStatus();
      $('lookup-stop').focus({ preventScroll: true });
      $('lookup-status').scrollIntoView({ block: 'nearest' });
      run.frame = await openFrame();
      if (run.ended) run.frame.close();
      for (const ask of plan.asks) {
        if (run.ended) break;
        run.at++; renderStatus();
        const result = { ask };
        let answered = 0;
        for (const item of ask.requests) {
          await pace();
          if (run.ended) break;
          const answer = await run.frame.ask(item);
          if (answer.stopped) break;
          // One request at a time: a service that hasn't answered ends the run, so nothing overlaps.
          if (answer.late) { end('limit', answer.late); break; }
          run.last = performance.now();
          const read = answer.error ? { error: answer.error } : readAnswer(item.service, item.identifier, answer);
          if (read.stop) { end('limit', read.error); break; }
          answered++;
          if (read.citation) { result.citation = read.citation; break; }
          if (read.error) result.error ||= read.error;
        }
        // An identifier the run ended in the middle of was not asked about in full: it is left over.
        if (!result.citation && answered < ask.requests.length) break;
        results.push(result);
        failures = !result.citation && result.error ? failures + 1 : 0;
        if (failures >= MAX_LOOKUP_FAILURES) end('failures');
      }
    }
    run.frame?.close();
    // Saved in one step, against the citations as they are now.
    const fresh = await request({ type: 'state.get' });
    const home = fresh.collections.find((item) => item.id === run.collectionId);
    if (!home) throw new Error('The collection was removed while the lookup ran, so nothing was saved.');
    const outcome = lookupOutcome(results, home.pages || {}, new Date().toISOString());
    const changed = Object.keys(outcome.pages);
    let after = null;
    ui.state = fresh;
    if (changed.length) {
      ui.state = await request({ type: 'state.mutate', action: { type: 'links.append', collectionId: home.id, links: [], pages: outcome.pages } });
      const pages = ui.state.collections.find((item) => item.id === home.id)?.pages || {};
      after = Object.fromEntries(changed.map((key) => [key, pages[key] ?? null]));
    }
    for (const { ask, citation } of results) {
      if (citation && ask.targets.some((key) => key in outcome.pages)) seen.delete(ask.key); else seen.add(ask.key);
    }
    report = { collectionId: home.id, before: after ? outcome.before : null, after, focus: back,
      text: lookupReport({ ...outcome, asked: results.length, left: plan.asks.length - results.length, ended: run.ended, reason: run.reason, without: plan.without, complete: plan.complete, over: plan.over }) };
  } finally {
    run.frame?.close();
    run = null;
    done = report || null;
    render(); renderStatus();
  }
  // Focus follows the result: Undo when there is one, otherwise Dismiss.
  if (!document.activeElement || document.activeElement === document.body || $('lookup-status').contains(document.activeElement)) {
    ($('lookup-undo').hidden ? $('lookup-dismiss') : $('lookup-undo')).focus({ preventScroll: true });
  }
  $('lookup-status').scrollIntoView({ block: 'nearest' });
}

// Undo: every address the run changed holds what it held before. One that changed again since
// (the page was captured again, say) is left as it is.
async function undo() {
  const record = done;
  if (!record?.before) return;
  const fresh = await request({ type: 'state.get' });
  const home = fresh.collections.find((item) => item.id === record.collectionId);
  const pages = home?.pages || {}, restore = {};
  for (const [key, was] of Object.entries(record.before)) if (sameCitation(pages[key], record.after[key])) restore[key] = was;
  const back = Object.keys(restore).length, kept = Object.keys(record.before).length - back;
  ui.state = home && back ? await request({ type: 'state.mutate', action: { type: 'pages.restore', collectionId: home.id, pages: restore } }) : fresh;
  const left = kept ? ` ${count(kept)} ${kept === 1 ? 'citation' : 'citations'} changed since and ${kept === 1 ? 'was' : 'were'} left as ${kept === 1 ? 'it is' : 'they are'}.` : '';
  done = { collectionId: record.collectionId, before: null, after: null, focus: record.focus,
    text: back ? `Lookup undone: the details are as they were before.${left}` : 'Nothing to undo: these details changed after the lookup.' };
  render(); renderStatus();
  $('lookup-dismiss').focus({ preventScroll: true });
}

function dismiss() {
  const back = done?.focus;
  done = null;
  renderStatus();
  const fallback = host === 'export' ? ($('lookup-line').hidden ? $('format') : $('lookup-authors')) : ($('lookup-selected').hidden ? $('select-all') : $('lookup-selected'));
  (back?.isConnected && !back.disabled && back.getClientRects().length ? back : fallback).focus({ preventScroll: true });
}

/* Where it starts -------------------------------------------------------------------------------- */
function selectedInView() { return ui.rows.flatMap((row) => row.occurrenceIds.filter((id) => ui.selectedIds.has(id))); }
const lookable = (link, pages) => lookupRequests(identifiersOf(link, pages)).length > 0;

// Look up details in the list toolbar: shown while the selection in this view holds a link with a
// DOI, an arXiv ID or a PubMed ID.
export function renderLookupSelection(collection) {
  const ids = new Set(selectedInView()), pages = collection.pages || {};
  $('lookup-selected').hidden = !ids.size || !collection.links.some((link) => ids.has(link.id) && lookable(link, pages));
  renderStatus();
}

// Beside the Export panel's "no authors yet" line, for exactly the papers that line counts.
export function renderLookupLine(rows, format) {
  const collection = currentCollection();
  const n = collection && rows.length && CITE_FORMATS.includes(format) && format !== 'obsidian' ? unauthored(rows, collection.pages || {}).length : 0;
  $('lookup-line').hidden = !n;
  if (n) $('lookup-line-text').textContent = n === 1 ? 'Page details lookup can fill in the 1 with no authors yet, from its DOI or arXiv ID.' : `Page details lookup can fill in the ${count(n)} with no authors yet, from their DOI or arXiv ID.`;
  renderStatus();
}

// In a link's details, where its citation lacks something a lookup gives; otherwise null.
export function detailLookup(link) {
  const pages = currentCollection()?.pages || {};
  const requests = lookupRequests(identifiersOf(link, pages));
  const missing = requests.length ? lookupMissing(citationFor(link, pages)?.citation, requests) : [];
  if (!missing.length) return null;
  const block = node('div', 'occ-block occ-lookup'); block.setAttribute('role', 'group'); block.setAttribute('aria-label', 'Missing details');
  const line = node('p', 'lookup-line', `No ${missingWords(missing)} saved for this paper yet.`);
  const look = button('Look up details', 'btn small', 'i-search');
  look.setAttribute('aria-label', `Look up details for ${labelFor(link)}`);
  // Kept across renders, so focus stays on it (see renderLinks).
  look.dataset.linkId = link.id; look.dataset.linkField = 'lookup';
  look.addEventListener('click', () => action(() => start([link], 'toolbar', look)));
  line.append(look);
  block.append(node('span', 'occ-label', 'Missing details'), line);
  return block;
}

// The note under a citation a lookup gave: which service, and the day it was looked up. Empty for
// any other citation. `exported` adds that citation exports use it.
export function lookupNote(page, exported = false) {
  const service = LOOKUP_SERVICES[page?.source]?.name;
  if (!service) return '';
  const time = new Date(page.readAt || '');
  const when = Number.isNaN(time.valueOf()) ? '' : `, looked up on ${time.toLocaleDateString(undefined, { dateStyle: 'medium' })}`;
  return `From ${service}${when}. ${exported ? 'Citation exports use it. ' : ''}Saved in this browser.`;
}

/* Turning it on ---------------------------------------------------------------------------------- */
function renderSwitch() {
  if (!ui.state) return;
  $('lookup-details').checked = draft ?? !!ui.state.settings.lookupDetails;
  // Turned off here or in another Link Meteor page: a run in progress stops, and its frame goes.
  if (run && !ui.state.settings.lookupDetails && draft !== true) end('off');
}

async function setLookup(on) {
  const mine = ++saving;
  draft = on;
  if (!on) end('off');
  try {
    ui.state = await request({ type: 'state.mutate', action: { type: 'settings.update', patch: { lookupDetails: on } } });
    show(on ? 'Page details lookup is on. Nothing is sent until you click Look up details.' : 'Page details lookup is off. Link Meteor requests nothing from any service.');
  } finally {
    if (mine === saving) draft = null;
    render();
  }
}

export function bindLookup() {
  $('lookup-details').addEventListener('change', (event) => action(() => setLookup(event.target.checked)));
  $('lookup-selected').addEventListener('click', (event) => action(() => {
    const collection = currentCollection(), ids = new Set(selectedInView());
    return start(collection.links.filter((link) => ids.has(link.id)), 'toolbar', event.currentTarget);
  }));
  $('lookup-authors').addEventListener('click', (event) => action(() => start(unauthored(targetRows(), currentCollection().pages || {}), 'export', event.currentTarget)));
  $('lookup-stop').addEventListener('click', () => end('stopped'));
  $('lookup-undo').addEventListener('click', () => action(undo));
  $('lookup-dismiss').addEventListener('click', dismiss);
  onRender(renderSwitch);
}
