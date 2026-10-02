// Page details lookup (0.6.0) in the real extension, with no grants: Chrome for Testing, headless,
// a fresh task-owned profile, the real unpacked build. The test answers in the services' place
// (Playwright fulfills the frame's requests with recorded answers), so nothing here ever contacts
// Crossref, DataCite or NCBI.
// The sandboxed frame (src/ui/lookup-frame.html), which is the only part that can reach the network:
// - Link Meteor's own page can't request anything, and nothing leaves it;
// - the frame makes exactly the request core/lookup.js names, with origin "null", no cookies and
//   no referrer, and hands back the answer;
// - it refuses anything but the three services and identifiers of the right shape;
// - its own policy blocks every other address, and it has no access to Chrome's APIs or storage.
//   npm run build && node tests/lookup-browser.mjs
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launch, until, evidence, root} from './helpers/browser.mjs';
import {lookupUrl, readAnswer} from '../src/core/lookup.js';

const profile = process.env.LINK_METEOR_TEST_PROFILE || `lookup-browser-${Date.now()}`;
const result = {started: new Date().toISOString(), profile, browser: 'Chrome for Testing via Playwright, headless, fresh profile, real unpacked extension, no optional grants; the three services are answered by the test', checks: [], screenshots: []};
const pass = (name, data = {}) => { result.checks.push({name, ...data}); console.log('PASS', name, Object.keys(data).length ? JSON.stringify(data) : ''); };
const recorded = (name) => readFile(resolve(root, 'tests/fixtures/lookup', name), 'utf8');
const ANSWERS = {
  [lookupUrl('crossref', '10.1371/journal.pmed.0020124')]: {status: 200, contentType: 'application/json', body: await recorded('crossref-article.json')},
  [lookupUrl('crossref', '10.5555/not-a-real-doi-link-meteor')]: {status: 404, contentType: 'text/plain', body: await recorded('crossref-missing.txt')},
  [lookupUrl('datacite', '10.48550/arXiv.2409.11211')]: {status: 200, contentType: 'application/json', body: await recorded('datacite-arxiv.json')},
  [lookupUrl('pubmed', '16060722')]: {status: 200, contentType: 'application/json', body: await recorded('pubmed-article.json'), headers: {'set-cookie': 'ncbi_sid=TEST; Domain=.nih.gov; Path=/; Max-Age=3600'}},
};

let context;
try {
  await mkdir(evidence, {recursive: true});
  const run = await launch(profile, {headless: true});
  context = run.context;
  // Every request that would leave the browser is caught here. None reaches the network.
  const outside = [];
  await context.route(/^https?:\/\//, async (route) => {
    const request = route.request(), answer = ANSWERS[request.url()];
    outside.push({url: request.url(), method: request.method(), headers: await request.allHeaders()});
    if (!answer) return route.fulfill({status: 599, body: 'not a recorded answer'});
    return route.fulfill({status: answer.status, contentType: answer.contentType, body: answer.body, headers: {'access-control-allow-origin': '*', ...answer.headers}});
  });
  const ui = await context.newPage();
  const errors = []; ui.on('pageerror', (error) => errors.push(error.message));
  await ui.goto(`chrome-extension://${run.id}/ui/workbench.html`); await ui.locator('#collection-heading').waitFor();
  result.chrome = await ui.evaluate(() => navigator.userAgent.match(/Chrome\/[\d.]+/)[0]);

  // 1. Link Meteor's own page can't reach the network at all.
  const own = await ui.evaluate((url) => fetch(url).then((response) => `answered ${response.status}`, (error) => `blocked: ${error.name}`), lookupUrl('crossref', '10.1371/journal.pmed.0020124'));
  assert.equal(own, 'blocked: TypeError');
  assert.equal(outside.length, 0, 'nothing left the page');
  assert.equal(ui.frames().length, 1, 'no lookup frame exists until a lookup runs');
  pass('lookup-own-pages-cannot-connect', {own});

  // The frame, created the way the workbench will: hidden, sandboxed by the manifest, removed afterward.
  await ui.evaluate(() => new Promise((ready) => {
    window.__answers = new Map();
    addEventListener('message', (event) => {
      if (event.source !== window.__frame?.contentWindow) return;
      if (event.data?.type === 'lookup.ready') ready();
      if (event.data?.type === 'lookup.answer') window.__answers.get(event.data.id)?.(event.data);
    });
    const frame = document.createElement('iframe'); frame.hidden = true; frame.src = chrome.runtime.getURL('ui/lookup-frame.html');
    window.__frame = frame; document.body.append(frame);
  }));
  const ask = (service, identifier) => ui.evaluate(([service, identifier]) => new Promise((done) => {
    const id = crypto.randomUUID(); window.__answers.set(id, done);
    window.__frame.contentWindow.postMessage({type: 'lookup', id, service, identifier}, '*');
    setTimeout(() => done({timeout: true}), 8000);
  }), [service, identifier]);

  // 2. One identifier, one request, exactly as core/lookup.js names it, carrying nothing else.
  const seen = {};
  for (const [service, identifier, title] of [['crossref', '10.1371/journal.pmed.0020124', 'Why Most Published Research Findings Are False'], ['datacite', '10.48550/arXiv.2409.11211', 'SplatFields: Neural Gaussian Splats for Sparse 3D and 4D Reconstruction'], ['pubmed', '16060722', 'Why most published research findings are false']]) {
    const before = outside.length;
    const answer = await ask(service, identifier);
    assert.equal(readAnswer(service, identifier, answer).citation?.title, title, `${service} answered`);
    assert.equal(outside.length, before + 1, 'one request');
    const request = outside.at(-1);
    assert.equal(request.url, lookupUrl(service, identifier));
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.origin, 'null', 'the origin doesn’t carry Link Meteor’s ID');
    assert.equal(request.headers.cookie, undefined, 'no cookies');
    assert.equal(request.headers.referer, undefined, 'no referrer');
    assert.ok(!JSON.stringify(request.headers).includes(run.id), 'Link Meteor’s ID is nowhere in the request');
    seen[service] = Object.keys(request.headers).sort().join(' ');
  }
  // NCBI's cookie was not kept: the next request to it still carries none.
  await ask('pubmed', '16060722');
  assert.equal(outside.at(-1).headers.cookie, undefined, 'a cookie a service sets is not kept');
  assert.deepEqual(readAnswer('crossref', '10.5555/not-a-real-doi-link-meteor', await ask('crossref', '10.5555/not-a-real-doi-link-meteor')), {missing: true});
  pass('lookup-frame-sends-only-the-identifier', {headers: seen});

  // 3. Anything else is refused by the frame, before any request.
  const before = outside.length;
  for (const [service, identifier] of [['wayback', '10.1/x'], ['crossref', 'https://evil.example/collect?links=all'], ['pubmed', '1&db=protein'], ['crossref', ''], ['constructor', '1'], ['datacite', 42]]) {
    assert.equal((await ask(service, identifier)).error, 'Link Meteor looks up only a DOI, an arXiv ID or a PubMed ID.', `${service} ${identifier}`);
  }
  assert.equal(outside.length, before, 'no request was made for any of them');
  pass('lookup-frame-refuses-everything-else');

  // 4. The frame's own policy: no other address, no Chrome APIs, no storage, a "null" origin.
  const frame = ui.frames().find((item) => item.url().endsWith('/ui/lookup-frame.html'));
  const inside = await frame.evaluate(async () => ({
    origin: self.origin, chromeStorage: typeof globalThis.chrome?.storage, chromeRuntimeSend: typeof globalThis.chrome?.runtime?.sendMessage,
    other: await fetch('https://example.org/').then((response) => `answered ${response.status}`, (error) => `blocked: ${error.name}`),
    http: await fetch('http://api.crossref.org/works/10.1/x').then((response) => `answered ${response.status}`, (error) => `blocked: ${error.name}`),
    storage: (() => { try { return typeof localStorage.length; } catch (error) { return `blocked: ${error.name}`; } })(),
    parent: (() => { try { return typeof parent.document; } catch (error) { return `blocked: ${error.name}`; } })(),
  }));
  assert.deepEqual(inside, {origin: 'null', chromeStorage: 'undefined', chromeRuntimeSend: 'undefined', other: 'blocked: TypeError', http: 'blocked: TypeError', storage: 'blocked: SecurityError', parent: 'blocked: SecurityError'});
  assert.equal(outside.length, before, 'the blocked requests never left');
  pass('lookup-frame-is-sealed', inside);

  // 5. Removed afterward, and the page had no errors.
  await ui.evaluate(() => { window.__frame.remove(); });
  await until(() => ui.frames().length === 1, 'the lookup frame is gone once removed');
  assert.deepEqual(errors, []);
  assert.deepEqual([...new Set(outside.map((request) => new URL(request.url).host))].sort(), ['api.crossref.org', 'api.datacite.org', 'eutils.ncbi.nlm.nih.gov'], 'only the three services were ever asked');
  pass('lookup-only-three-addresses', {requests: outside.length});
  result.status = 'PASS';
} catch (error) {
  result.status = 'FAIL'; result.error = String(error?.stack || error); console.error(error); process.exitCode = 1;
} finally {
  await context?.close();
  result.finished = new Date().toISOString();
  await writeFile(resolve(evidence, 'lookup-browser-results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(result.status, `${result.checks.length} checks`);
}
