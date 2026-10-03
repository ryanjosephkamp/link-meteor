// Page details lookup (0.6.0) in the real extension, with no grants: Chrome for Testing, headless,
// a fresh task-owned profile, the real unpacked build. The test answers in the services' place
// (Playwright fulfills the frame's requests with recorded answers), so nothing here ever contacts
// Crossref, DataCite or NCBI.
// With the setting off:
// - no frame exists and nothing is requested; Look up details (for a selection, in a link's
//   details, in the Export panel) moves focus to the explanation instead.
// The sandboxed frame (src/ui/lookup-frame.html), which is the only part that can reach the network:
// - Link Meteor's own page can't request anything, and nothing leaves it;
// - the frame makes exactly the request core/lookup.js names, with origin "null", no cookies and
//   no referrer, and hands back the answer;
// - it refuses anything but the three services and identifiers of the right shape;
// - its own policy blocks every other address, and it has no access to Chrome's APIs or storage.
// With the setting on, from the keyboard where it matters:
// - a run over a DOI, an arXiv ID, a PubMed ID, a link without an identifier, two links sharing a
//   DOI, a DOI only DataCite has and one nobody has: the requests in order, exactly as lookupUrl
//   names them, at least 350 ms apart, and the frame removed afterward;
// - what is saved: a page's own tags are never replaced, a title guessed from a PDF is, and Undo
//   puts every citation back exactly;
// - Look up details in a link's details and beside the Export panel's "no authors yet" line, and
//   BibTeX with the looked-up authors;
// - Stop in the middle, "too many requests", an answer that isn't JSON, three failures in a row,
//   and the setting turned off while a run is going;
// - the 320 px layout, and text contrast in every theme, light and dark, for the settings section,
//   the buttons, the progress line and the result.
//   npm run build && node tests/lookup-browser.mjs
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launch, rpc, until, evidence, root} from './helpers/browser.mjs';
import {mergeCitation} from '../src/core/model.js';
import {LOOKUP_PAUSE_MS, lookupUrl, readAnswer, unauthored} from '../src/core/lookup.js';

const profile = process.env.LINK_METEOR_TEST_PROFILE || `lookup-browser-${Date.now()}`;
const result = {started: new Date().toISOString(), profile, browser: 'Chrome for Testing via Playwright, headless, fresh profile, real unpacked extension, no optional grants; the three services are answered by the test', checks: [], screenshots: []};
const pass = (name, data = {}) => { result.checks.push({name, ...data}); console.log('PASS', name, Object.keys(data).length ? JSON.stringify(data) : ''); };
const recorded = (name) => readFile(resolve(root, 'tests/fixtures/lookup', name), 'utf8');
// Rasterizes any CSS color (including oklch) to sRGB, then computes WCAG contrast against the nearest opaque background.
const contrast = (page, pairs) => page.evaluate((pairs) => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d', {willReadFrequently: true});
  const rgb = (color) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const lum = (c) => c.map((n) => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((s, n, i) => s + n * [.2126, .7152, .0722][i], 0);
  const bg = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c) && !/\/ 0\)$/.test(c)) return c; } return getComputedStyle(document.body).backgroundColor; };
  return pairs.map(([name, selector]) => { const el = document.querySelector(selector); if (!el || !el.getClientRects().length) return {name, missing: true}; const a = lum(rgb(getComputedStyle(el).color)), b = lum(rgb(bg(el))); return {name, ratio: Math.round(((Math.max(a, b) + .05) / (Math.min(a, b) + .05)) * 100) / 100}; });
}, pairs);
const overflow = (page) => page.evaluate(async () => { await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))); return document.documentElement.scrollWidth > innerWidth; });

// The identifiers, and the services' answers. All recorded, except the dataset's, which is the
// recorded DataCite answer with another DOI and title: a DOI Crossref doesn't have and DataCite does.
const DOI = '10.1371/journal.pmed.0020124', CHAPTER = '10.1007/978-3-031-72627-9_18', ARXIV_DOI = '10.48550/arXiv.2409.11211', PMID = '16060722';
const DATASET = '10.5281/zenodo.7654321', NOBODY = '10.5555/not-a-real-doi-link-meteor';
const dataset = JSON.parse(await recorded('datacite-arxiv.json'));
Object.assign(dataset.data.attributes, {doi: DATASET, identifiers: [], titles: [{title: 'Street tree canopy measurements'}], publisher: 'Zenodo', types: {resourceTypeGeneral: 'Dataset'}});
const json = (body) => ({status: 200, contentType: 'application/json', body});
const none = async (name) => ({status: 404, contentType: name.endsWith('.json') ? 'application/json' : 'text/plain', body: await recorded(name)});
const RECORDED = new Map([
  [lookupUrl('crossref', DOI), json(await recorded('crossref-article.json'))],
  [lookupUrl('crossref', CHAPTER), json(await recorded('crossref-chapter.json'))],
  [lookupUrl('crossref', DATASET), await none('crossref-missing.txt')],
  [lookupUrl('crossref', NOBODY), await none('crossref-missing.txt')],
  [lookupUrl('datacite', ARXIV_DOI), json(await recorded('datacite-arxiv.json'))],
  [lookupUrl('datacite', DATASET), json(JSON.stringify(dataset))],
  [lookupUrl('datacite', DOI), await none('datacite-missing.json')],
  [lookupUrl('datacite', NOBODY), await none('datacite-missing.json')],
  [lookupUrl('pubmed', PMID), {...json(await recorded('pubmed-article.json')), headers: {'set-cookie': 'ncbi_sid=TEST; Domain=.nih.gov; Path=/; Max-Age=3600'}}],
]);
const answers = new Map(RECORDED);
const cited = (service, identifier) => readAnswer(service, identifier, answers.get(lookupUrl(service, identifier))).citation;

// The seed: eight links from one page. The PDF link's citation was read from the PDF itself, with
// a title guessed from its largest text; the chapter's page gave its own tags, without authors.
const SOURCE = 'https://scholar.example.com/scholar?q=reading';
const at = (i) => new Date(Date.UTC(2026, 8, 20 + i, 10)).toISOString();
const L = (id, anchorText, url) => ({id, anchorText, accessibleLabel: '', url, originalHref: url, sourceUrl: SOURCE, sourceTitle: 'Reading list', frameUrl: '', capturedAt: at(Number(id.slice(1))), batchId: 'seed', notes: '', tags: []});
const P1 = `https://doi.org/${DOI}`, P2 = 'https://arxiv.org/pdf/2409.11211', P3 = `https://pubmed.ncbi.nlm.nih.gov/${PMID}/`, P4 = 'https://example.org/notes';
const P5 = `https://journals.plos.org/plosmedicine/article?id=${DOI}`, P6 = `https://doi.org/${DATASET}`, P7 = `https://doi.org/${NOBODY}`, P8 = `https://link.springer.com/chapter/${CHAPTER}`;
const LINKS = [L('p1', 'Why most findings are false', P1), L('p2', '[PDF] SplatFields', P2), L('p3', 'Ioannidis 2005 on PubMed', P3), L('p4', 'Lab notes', P4),
  L('p5', 'The same paper at PLOS', P5), L('p6', 'A dataset', P6), L('p7', 'Nobody has this', P7), L('p8', 'SplatFields chapter', P8)];
const FROM_PDF = {title: 'A Guess From The Largest Text', arxiv: '2409.11211', arxivVersion: 'v1', arxivCategory: 'cs.CV', date: '17 Sep 2024', pdfUrl: P2, source: 'pdf', readAt: '2026-09-29T09:00:00.000Z'};
const FROM_TAGS = {title: 'Title From The Page', date: '2024', readAt: '2026-09-30T09:00:00.000Z'};
const SEEDED = {[P2]: FROM_PDF, [P8]: FROM_TAGS};
const FILLED = 'titles for 1 paper, authors for 1, dates for 1, journals for 1';

let context;
try {
  await mkdir(evidence, {recursive: true});
  const run = await launch(profile, {headless: true});
  context = run.context;
  // Every request that would leave the browser is caught here. None reaches the network.
  const outside = [];
  let hold = null;
  await context.route(/^https?:\/\//, async (route) => {
    const at = Date.now(), request = route.request(), url = request.url();
    outside.push({url, at, method: request.method(), body: request.postData(), headers: await request.allHeaders()});
    await hold?.(url);
    const answer = answers.get(url) || {status: 599, body: 'not a recorded answer'};
    // A request the page gave up on (Stop removes the frame) can no longer be answered.
    await route.fulfill({status: answer.status, contentType: answer.contentType, body: answer.body, headers: {'access-control-allow-origin': '*', ...answer.headers}}).catch(() => {});
  });
  // Holds the request to one address until it is opened, so a run can be met in the middle.
  const gate = (address) => {
    let open, reached;
    const opened = new Promise((done) => { open = done; }), arrived = new Promise((done) => { reached = done; });
    hold = (url) => { if (url === address) { reached(); return opened; } };
    return {arrived, open: () => { hold = null; open(); }};
  };
  const ui = await context.newPage();
  const errors = []; ui.on('pageerror', (error) => errors.push(error.message));
  const framesSeen = []; ui.on('framenavigated', (frame) => { if (frame !== ui.mainFrame()) framesSeen.push(frame.url()); });
  await ui.setViewportSize({width: 1440, height: 1000});
  await ui.goto(`chrome-extension://${run.id}/ui/workbench.html`); await ui.locator('#collection-heading').waitFor();
  result.chrome = await ui.evaluate(() => navigator.userAgent.match(/Chrome\/[\d.]+/)[0]);
  const frameUrl = `chrome-extension://${run.id}/ui/lookup-frame.html`;

  const state = () => rpc(ui, {type: 'state.get'});
  const home = (await state()).activeCollectionId;
  const pagesNow = async () => (await state()).collections.find((item) => item.id === home).pages || {};
  const mutate = (action) => rpc(ui, {type: 'state.mutate', action});
  // Puts every citation back to the seed, between scenarios.
  const reset = async () => { const now = await pagesNow(); await mutate({type: 'pages.restore', collectionId: home, pages: {...Object.fromEntries(Object.keys(now).map((key) => [key, null])), ...SEEDED}}); await ui.waitForTimeout(200); };
  const row = (i) => ui.locator('.link-row').nth(i);
  const select = async (...rows) => { if (await ui.locator('#clear-selection').isVisible()) await ui.locator('#clear-selection').click(); for (const i of rows) await row(i).locator('.row-select').check(); };
  const notice = () => ui.locator('#notice .msg').innerText();
  const focused = () => ui.evaluate(() => document.activeElement?.id || '');
  const iframes = () => ui.evaluate(() => document.querySelectorAll('iframe').length);
  const finished = async () => { await until(() => ui.locator('#lookup-done').isVisible(), 'the lookup’s result', 30000); return ui.locator('#lookup-done-text').innerText(); };
  const frameGone = async () => { await until(async () => (await iframes()) === 0 && ui.frames().length === 1, 'the lookup frame is removed'); };
  // An earlier result is dismissed first, so the next one seen is this run's.
  const startFromKeyboard = async () => { if (await ui.locator('#lookup-dismiss').isVisible()) await ui.locator('#lookup-dismiss').click(); await ui.locator('#lookup-selected').focus(); await ui.keyboard.press('Enter'); };
  const urls = (from) => outside.slice(from).map((request) => request.url);
  const shot = async (name, options = {}) => { await ui.evaluate(() => { for (const id of ['notice', 'error']) document.getElementById(id).hidden = true; }); await ui.screenshot({path: resolve(evidence, name), animations: 'disabled', ...options}); result.screenshots.push(name); };
  const toTop = (selector) => ui.locator(selector).evaluate((item) => scrollTo(0, item.getBoundingClientRect().top + scrollY - 80));

  await mutate({type: 'settings.update', patch: {welcomeSeen: true}});
  await mutate({type: 'links.append', collectionId: home, links: LINKS, pages: SEEDED});
  await until(async () => (await ui.locator('.link-row').count()) === 8, 'the seeded rows', 8000);
  const seeded = await pagesNow();
  assert.deepEqual(seeded, SEEDED);

  /* Off: nothing is requested, no frame exists, and each Look up details click shows the explanation. */
  assert.equal((await state()).settings.lookupDetails, false, 'off by default');
  assert.equal(await ui.locator('#lookup-details').isChecked(), false);
  assert.equal(await ui.locator('#lookup-selected').isVisible(), false, 'no button without a selection');
  await select(3);
  assert.equal(await ui.locator('#lookup-selected').isVisible(), false, 'nor for a link without a DOI, an arXiv ID or a PubMed ID');
  await select(0, 1, 2, 3, 4, 5, 6, 7);
  await until(() => ui.locator('#lookup-selected').isVisible(), 'Look up details shows for the selection');
  const isOff = async (how) => {
    await until(async () => (await focused()) === 'lookup-details', `${how}: focus moves to the explanation’s switch`);
    assert.equal(await notice(), 'Page details lookup is off, so nothing was sent. Online lookups says what it sends and where. Turn it on there, then click Look up details again.');
    assert.equal(await ui.locator('#lookup-details').isChecked(), false, `${how}: the switch stays off`);
    assert.equal(await ui.locator('#lookup-status').isVisible(), false, `${how}: no run`);
    await ui.waitForTimeout(500);
    assert.deepEqual([outside.length, await iframes(), ui.frames().length, framesSeen.length], [0, 0, 1, 0], `${how}: nothing requested, and no frame`);
  };
  await ui.locator('#lookup-selected').click();
  await isOff('the selection');
  assert.equal(await ui.locator('#lookup-details').getAttribute('aria-describedby'), 'lookup-help lookup-sends', 'the switch is described by what the lookup sends');
  assert.deepEqual(await ui.locator('#lookup-sends li').allInnerTexts(), ['Crossref (api.crossref.org) for DOIs', 'DataCite (api.datacite.org) for DOIs Crossref doesn’t have, including arXiv’s', 'NCBI (eutils.ncbi.nlm.nih.gov) for PubMed IDs']);
  await row(0).locator('.row-details summary').click();
  const inDetails = row(0).locator('.occ-lookup');
  await inDetails.waitFor();
  assert.match(await inDetails.locator('.lookup-line').innerText(), /^No title, authors, date or journal saved for this paper yet\.\s*Look up details$/);
  assert.equal(await inDetails.locator('button').getAttribute('aria-label'), 'Look up details for Why most findings are false');
  await inDetails.locator('button').click();
  await isOff('a link’s details');
  await ui.locator('#clear-selection').click();
  await ui.locator('#format').selectOption('bibtex');
  assert.equal(await ui.locator('#lookup-line-text').innerText(), 'Page details lookup can fill in the 6 with no authors yet, from their DOI or arXiv ID.');
  await ui.locator('#lookup-authors').click();
  await isOff('the Export panel');
  assert.deepEqual(await pagesNow(), seeded, 'nothing was saved');
  pass('lookup-off-nothing-is-requested', {requests: outside.length, frames: framesSeen.length});

  /* The sandboxed frame. */
  // 1. Link Meteor's own page can't reach the network at all.
  const own = await ui.evaluate((url) => fetch(url).then((response) => `answered ${response.status}`, (error) => `blocked: ${error.name}`), lookupUrl('crossref', DOI));
  assert.equal(own, 'blocked: TypeError');
  assert.equal(outside.length, 0, 'nothing left the page');
  assert.equal(ui.frames().length, 1, 'no lookup frame exists until a lookup runs');
  pass('lookup-own-pages-cannot-connect', {own});

  // The frame, created the way the workbench does: hidden, sandboxed by the manifest, removed afterward.
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
  for (const [service, identifier, title] of [['crossref', DOI, 'Why Most Published Research Findings Are False'], ['datacite', ARXIV_DOI, 'SplatFields: Neural Gaussian Splats for Sparse 3D and 4D Reconstruction'], ['pubmed', PMID, 'Why most published research findings are false']]) {
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
  await ask('pubmed', PMID);
  assert.equal(outside.at(-1).headers.cookie, undefined, 'a cookie a service sets is not kept');
  assert.deepEqual(readAnswer('crossref', NOBODY, await ask('crossref', NOBODY)), {missing: true});
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

  // 5. Removed afterward.
  await ui.evaluate(() => { window.__frame.remove(); });
  await until(() => ui.frames().length === 1, 'the lookup frame is gone once removed');
  framesSeen.length = 0;

  /* On, from the keyboard: the switch has focus since the last click. */
  await ui.locator('#lookup-details').focus(); await ui.keyboard.press('Space');
  await until(async () => (await state()).settings.lookupDetails === true, 'the setting is saved');
  assert.equal(await ui.locator('#lookup-details').isChecked(), true);
  assert.equal(await notice(), 'Page details lookup is on. Nothing is sent until you click Look up details.');
  await ui.waitForTimeout(500);
  assert.deepEqual([outside.length, await iframes(), framesSeen.length], [before, 0, 0], 'turning it on sends nothing and creates no frame');
  pass('lookup-turning-it-on-sends-nothing');

  /* A run for the whole selection. */
  await ui.locator('#format').selectOption('xlsx');
  await select(0, 1, 2, 3, 4, 5, 6, 7);
  let from = outside.length;
  await startFromKeyboard();
  await until(async () => (await focused()) === 'lookup-stop', 'focus moves to Stop');
  assert.match(await ui.locator('#lookup-count').innerText(), /^Looking up [1-6] of 6$/, 'six identifiers for eight links');
  assert.equal(await ui.locator('#lookup-count').getAttribute('role'), 'status');
  assert.equal(await ui.locator('.lookup-text span').innerText(), 'Sending only each DOI, arXiv ID or PubMed ID to Crossref, DataCite and NCBI.');
  assert.equal(await ui.locator('#lookup-selected').isDisabled(), true, 'one run at a time');
  await until(async () => (await iframes()) === 1, 'the frame exists while the run goes');
  assert.deepEqual(await ui.locator('iframe').evaluate((item) => [item.hidden, item.src, item.getAttribute('aria-hidden')]), [true, frameUrl, 'true']);
  const whole = await finished();
  await frameGone();
  const made = outside.slice(from);
  assert.deepEqual(made.map((request) => request.url), [lookupUrl('crossref', DOI), lookupUrl('datacite', ARXIV_DOI), lookupUrl('pubmed', PMID), lookupUrl('crossref', DATASET), lookupUrl('datacite', DATASET),
    lookupUrl('crossref', NOBODY), lookupUrl('datacite', NOBODY), lookupUrl('crossref', CHAPTER)], 'the requests, in order: a shared DOI is asked once, and the link without an identifier never');
  for (const [i, request] of made.entries()) {
    assert.deepEqual([request.method, request.body, request.headers.origin, request.headers.cookie, request.headers.referer], ['GET', null, 'null', undefined, undefined], request.url);
    assert.ok(!JSON.stringify(request.headers).includes(run.id), 'Link Meteor’s ID is nowhere in the request');
    // The address is exactly lookupUrl's (above); nothing else of the person's is in the headers either.
    for (const text of ['scholar.example.com', 'Reading list', 'plos.org', 'example.org', 'Why most findings', 'My research']) assert.ok(!JSON.stringify(request.headers).includes(text), `${text} isn’t sent`);
    if (i) assert.ok(request.at - made[i - 1].at >= LOOKUP_PAUSE_MS, `request ${i + 1} came ${request.at - made[i - 1].at} ms after the one before`);
  }
  assert.deepEqual(framesSeen, [frameUrl], 'one frame, at its own address with nothing added');
  assert.equal(whole, 'Filled in titles for 3 papers, authors for 5, dates for 3, journals for 3. Replaced details read from a PDF for 1. 1 wasn’t found. Not looked up: 1 link with no DOI, arXiv ID or PubMed ID.');
  pass('lookup-run-requests-in-order', {requests: made.length, gaps: made.slice(1).map((request, i) => request.at - made[i].at)});

  // What was saved: only core/lookup.js's reading of each answer, where each link's citation lives.
  const saved = await pagesNow();
  const readAt = saved[P1].readAt;
  assert.match(readAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.ok(Date.now() - new Date(readAt).valueOf() < 60000, 'read now');
  const article = {...cited('crossref', DOI), readAt};
  assert.deepEqual(Object.keys(saved).sort(), [P1, P2, P3, P5, P6, P8].sort(), 'no citation for the link without an identifier, or the one nobody has');
  assert.deepEqual([saved[P1], saved[P5]], [article, article], 'two links sharing a DOI each get the citation, under their own addresses');
  assert.deepEqual(saved[P3], {...cited('pubmed', PMID), readAt});
  assert.deepEqual(saved[P6], {...cited('datacite', DATASET), readAt}, 'the DOI Crossref doesn’t have came from DataCite');
  assert.deepEqual(saved[P2], mergeCitation(FROM_PDF, {...cited('datacite', ARXIV_DOI), readAt}));
  assert.deepEqual([saved[P2].title, saved[P2].source, saved[P2].arxivCategory, saved[P2].authors.length], ['SplatFields: Neural Gaussian Splats for Sparse 3D and 4D Reconstruction', 'datacite', 'cs.CV', 7], 'the title guessed from the PDF is replaced; what only the PDF knew stays');
  assert.deepEqual(saved[P8], mergeCitation(FROM_TAGS, {...cited('crossref', CHAPTER), readAt}));
  assert.deepEqual([saved[P8].title, saved[P8].date, saved[P8].readAt, saved[P8].source, saved[P8].authors.length, saved[P8].journal], ['Title From The Page', '2024', FROM_TAGS.readAt, undefined, 7, 'Computer Vision – ECCV 2024'], 'the page’s own tags are never replaced; the lookup fills what they left out');
  pass('lookup-saves-only-what-was-missing', {citations: Object.keys(saved).length});

  // Undo, from the keyboard: every citation back exactly.
  assert.equal(await focused(), 'lookup-undo', 'focus is on Undo once the run ends');
  await ui.keyboard.press('Enter');
  await until(async () => (await ui.locator('#lookup-done-text').innerText()) === 'Lookup undone: the details are as they were before.', 'the Undo result');
  assert.deepEqual(await pagesNow(), seeded, 'every citation is exactly as before');
  assert.equal(await ui.locator('#lookup-undo').isVisible(), false);
  assert.equal(await focused(), 'lookup-dismiss');
  await ui.keyboard.press('Enter');
  await until(async () => !(await ui.locator('#lookup-status').isVisible()), 'Dismiss hides the result');
  assert.equal(await focused(), 'lookup-selected', 'focus returns to where the run started');
  assert.equal(outside.length, from + 8, 'Undo requests nothing');
  pass('lookup-undo-puts-every-citation-back');

  /* In a link's details: one paper, and where its citation came from. */
  await ui.locator('#clear-selection').click();
  from = outside.length;
  await row(0).locator('.occ-lookup button').focus(); await ui.keyboard.press('Enter');
  assert.equal(await finished(), 'Filled in the title, authors, date and journal.');
  await frameGone();
  assert.deepEqual(urls(from), [lookupUrl('crossref', DOI)]);
  assert.deepEqual(Object.keys(await pagesNow()).sort(), [P1, P2, P8].sort(), 'only that link’s citation');
  const details = row(0).locator('.occurrence');
  assert.equal(await details.locator('.occ-lookup').count(), 0, 'nothing is missing any more');
  assert.equal(await details.locator('.cited-title').innerText(), 'Why Most Published Research Findings Are False');
  const note = await details.locator('.cited-note').innerText();
  assert.match(note, /^From Crossref, looked up on .*\d{4}.*\. Citation exports use it\. Saved in this browser\.$/);
  await row(0).locator('.row-details summary').click();
  await ui.locator('#lookup-dismiss').click();
  pass('lookup-in-a-links-details', {note});

  /* Beside the Export panel's "no authors yet" line, for exactly the papers it counts. */
  await ui.locator('#format').selectOption('bibtex');
  const counted = unauthored(LINKS, await pagesNow());
  assert.deepEqual(counted.map((link) => link.id), ['p2', 'p6', 'p7', 'p8'], 'the PLOS address now borrows the looked-up citation, by its DOI');
  assert.match((await ui.locator('#cite-facts li').allInnerTexts()).join('\n'), /^4 with a DOI or arXiv ID but no authors yet\./m);
  assert.equal(await ui.locator('#lookup-line-text').innerText(), 'Page details lookup can fill in the 4 with no authors yet, from their DOI or arXiv ID.');
  from = outside.length;
  await ui.locator('#lookup-authors').focus(); await ui.keyboard.press('Enter');
  await until(async () => (await focused()) === 'lookup-stop', 'focus moves to Stop in the Export panel');
  assert.equal(await ui.locator('#lookup-export-host #lookup-progress').isVisible(), true, 'the progress shows where the run started');
  assert.equal(await finished(), 'Filled in titles for 1 paper, authors for 3, dates for 1, journals for 1. Replaced details read from a PDF for 1. 1 wasn’t found.');
  await frameGone();
  assert.deepEqual(urls(from), [lookupUrl('datacite', ARXIV_DOI), lookupUrl('crossref', DATASET), lookupUrl('datacite', DATASET), lookupUrl('crossref', NOBODY), lookupUrl('datacite', NOBODY), lookupUrl('crossref', CHAPTER)]);
  assert.equal(await ui.locator('#lookup-line-text').innerText(), 'Page details lookup can fill in the 1 with no authors yet, from its DOI or arXiv ID.');
  // BibTeX for a looked-up paper has its authors.
  await select(0);
  await until(async () => /^\s*author\s+= \{Ioannidis, John P\. A\.\},$/m.test(await ui.locator('#cite-first').innerText()), 'BibTeX has the looked-up author');
  const bibtex = await ui.locator('#cite-first').innerText();
  assert.match(bibtex, /^@article\{ioannidis2005,\n\s*title\s+= \{Why Most Published Research Findings Are False\},/);
  assert.match(bibtex, /^\s*journal\s+= \{PLoS Medicine\},$/m);
  assert.match(await ui.locator('#format-help').innerText(), /Built from the details saved with each link; while exporting, nothing is looked up online\.$/);
  await ui.locator('#clear-selection').click();
  pass('lookup-in-the-export-panel-and-bibtex', {entry: bibtex.split('\n')[0]});

  /* Stop in the middle, from the keyboard: what was found is kept, and the frame goes at once. */
  await ui.locator('#lookup-dismiss').click();
  await ui.locator('#format').selectOption('xlsx');
  await reset();
  await select(0, 2, 6);
  let held = gate(lookupUrl('pubmed', PMID));
  from = outside.length;
  await startFromKeyboard();
  await held.arrived;
  await until(async () => (await ui.locator('#lookup-count').innerText()) === 'Looking up 2 of 3', 'the counter');
  assert.deepEqual(await ui.locator('#lookup-bar').evaluate((bar) => [bar.value, bar.max]), [1, 3]);
  assert.equal(await focused(), 'lookup-stop');
  assert.equal(await ui.locator('#lookup-stop').getAttribute('aria-label'), 'Stop the lookup');
  await ui.keyboard.press('Enter');
  assert.equal(await finished(), `Filled in ${FILLED}. You stopped the lookup. 2 papers weren’t asked about.`);
  await frameGone();
  held.open();
  await ui.waitForTimeout(LOOKUP_PAUSE_MS * 3);
  assert.deepEqual(urls(from), [lookupUrl('crossref', DOI), lookupUrl('pubmed', PMID)], 'nothing more is requested after Stop');
  assert.deepEqual(Object.keys(await pagesNow()).sort(), [P1, P2, P8].sort(), 'what was found before Stop is saved');
  pass('lookup-stop-in-the-middle');

  /* "Too many requests" ends the run with what it has. */
  await reset();
  answers.set(lookupUrl('pubmed', PMID), {status: 429, contentType: 'text/plain', body: 'slow down'});
  await select(0, 2, 6);
  from = outside.length;
  await startFromKeyboard();
  assert.equal(await finished(), `Filled in ${FILLED}. NCBI asked Link Meteor to slow down, so the lookup stopped here. 2 papers weren’t asked about.`);
  await frameGone();
  assert.deepEqual(urls(from), [lookupUrl('crossref', DOI), lookupUrl('pubmed', PMID)]);
  assert.deepEqual(Object.keys(await pagesNow()).sort(), [P1, P2, P8].sort());
  answers.set(lookupUrl('pubmed', PMID), RECORDED.get(lookupUrl('pubmed', PMID)));
  pass('lookup-too-many-requests-ends-the-run');

  /* An answer that isn't JSON: said in plain words, and nothing is saved from it. */
  await reset();
  answers.set(lookupUrl('crossref', DOI), {status: 200, contentType: 'text/html', body: '<html><script>alert(1)</script>not json'});
  await select(0);
  from = outside.length;
  await startFromKeyboard();
  assert.equal(await finished(), 'This paper couldn’t be looked up: Crossref sent an answer Link Meteor couldn’t read.');
  assert.deepEqual(urls(from), [lookupUrl('crossref', DOI), lookupUrl('datacite', DOI)]);
  assert.deepEqual(await pagesNow(), seeded, 'nothing is saved from an answer that can’t be read');
  assert.equal(await ui.locator('#lookup-undo').isVisible(), false, 'nothing to undo');
  assert.equal(await focused(), 'lookup-dismiss');
  pass('lookup-an-answer-that-is-not-json');

  /* Three papers in a row that can't be looked up end the run. */
  for (const doi of [DOI, DATASET, NOBODY, CHAPTER]) for (const service of ['crossref', 'datacite']) answers.set(lookupUrl(service, doi), {status: 503, contentType: 'text/plain', body: 'unavailable'});
  await select(0, 5, 6, 7);
  from = outside.length;
  await startFromKeyboard();
  assert.equal(await finished(), '3 papers couldn’t be looked up: Crossref answered 503. The lookup stopped after 3 papers in a row couldn’t be looked up. 1 paper wasn’t asked about.');
  assert.equal(urls(from).length, 6);
  assert.deepEqual(await pagesNow(), seeded);
  for (const [url, answer] of RECORDED) answers.set(url, answer);
  pass('lookup-three-failures-in-a-row-end-the-run');

  /* Turned off while a run is going (here, as another Link Meteor page would): it stops, and the frame goes. */
  await select(0, 2);
  held = gate(lookupUrl('pubmed', PMID));
  from = outside.length;
  await startFromKeyboard();
  await held.arrived;
  await mutate({type: 'settings.update', patch: {lookupDetails: false}});
  assert.equal(await finished(), `Filled in ${FILLED}. Page details lookup was turned off, so the lookup stopped. 1 paper wasn’t asked about.`);
  await frameGone();
  held.open();
  assert.equal(await ui.locator('#lookup-details').isChecked(), false);
  await ui.locator('#lookup-dismiss').click();
  from = outside.length; framesSeen.length = 0;
  await ui.locator('#lookup-selected').click();
  await until(async () => (await focused()) === 'lookup-details', 'off again: the click shows the explanation');
  await ui.waitForTimeout(500);
  assert.deepEqual([outside.length - from, await iframes(), framesSeen.length], [0, 0, 0], 'and nothing is requested');
  pass('lookup-turned-off-during-a-run');

  /* 320 px: the click with the setting off opens the settings; the section, the progress and the result fit. */
  await reset();
  await ui.setViewportSize({width: 320, height: 900});
  await select(0, 2);
  await ui.locator('#lookup-selected').click();
  await until(async () => (await ui.locator('#app').getAttribute('data-view')) === 'collections' && (await focused()) === 'lookup-details', 'at 320 px the click opens Online lookups');
  assert.equal(await overflow(ui), false, 'Online lookups at 320');
  await toTop('#online-panel'); await shot('lookup-settings-320.png');
  await ui.keyboard.press('Space');
  await until(async () => (await state()).settings.lookupDetails === true, 'on again, from the keyboard');
  await ui.locator('#rail-done').click();
  const inBoth = async (name) => { for (const scheme of ['light', 'dark']) { await ui.emulateMedia({colorScheme: scheme, reducedMotion: 'reduce'}); await ui.waitForTimeout(250); await shot(`${name}-${scheme}.png`); } await ui.emulateMedia({colorScheme: 'light', reducedMotion: 'reduce'}); };
  held = gate(lookupUrl('pubmed', PMID));
  await startFromKeyboard();
  await held.arrived;
  assert.equal(await overflow(ui), false, 'the progress at 320');
  await toTop('#lookup-status'); await inBoth('lookup-progress-320');
  held.open();
  await finished();
  assert.equal(await overflow(ui), false, 'the result at 320');
  await toTop('#lookup-status'); await inBoth('lookup-done-320');
  // The list can be drawn once more just after a run saves (the saved state arrives from the
  // background), which closes details opened in that moment: open them until the note shows.
  await until(async () => {
    if (!(await row(0).locator('.row-details').evaluate((details) => details.open))) await row(0).locator('.row-details summary').click();
    return row(0).locator('.cited-note').isVisible();
  }, 'a looked-up citation shows in a link’s details at 320', 20000);
  assert.equal(await overflow(ui), false, 'a looked-up citation in a link’s details at 320');
  await row(0).locator('.row-details summary').click();
  await select(6);
  await row(6).locator('.row-details summary').click();
  await row(6).locator('.occ-lookup').waitFor();
  assert.equal(await overflow(ui), false, 'Look up details in a link’s details at 320');
  await ui.setViewportSize({width: 390, height: 844});
  await ui.locator('.occ-lookup').evaluate((item) => scrollTo(0, item.getBoundingClientRect().top + scrollY - 420)); await shot('lookup-details-side-panel.png');
  await ui.locator('#dock-export').click();
  await ui.locator('#format').selectOption('bibtex');
  await ui.locator('#lookup-line').waitFor();
  await ui.setViewportSize({width: 320, height: 900});
  assert.equal(await overflow(ui), false, 'Look up details in the Export panel at 320');
  await toTop('#cite-block'); await shot('lookup-export-320.png');
  await ui.locator('#export-done').click();
  pass('lookup-fits-at-320');

  /* Contrast in every theme, light and dark, for everything the lookup adds: the settings section, the buttons, the
     progress line while a run is held, the result with Undo, and a looked-up citation's note. */
  await ui.setViewportSize({width: 1440, height: 1000});
  await reset();
  await row(0).locator('.row-details summary').click();
  await select(0, 2, 6);
  const applied = (theme, scheme) => ui.evaluate(([theme, scheme]) => document.documentElement.dataset.theme === theme && document.documentElement.dataset.scheme === scheme && document.querySelector('input[name="theme"]:checked')?.value === theme, [theme, scheme]);
  const settled = () => until(() => ui.evaluate(() => !document.getAnimations().some((animation) => animation.playState === 'running' || animation.playState === 'pending')), 'colors settled');
  const progressPairs = [['counter', '#lookup-count'], ['what is sent', '.lookup-text span'], ['Stop', '#lookup-stop']];
  const restPairs = [['result', '#lookup-done-text'], ['Undo', '#lookup-undo'], ['Dismiss', '#lookup-dismiss'], ['section title', '#online-title'], ['introduction', '#online-panel > .help'], ['switch label', 'label[for="lookup-details"]'],
    ['what it does', '#lookup-help'], ['box title', '.sends-title'], ['what is sent', '.sends-what'], ['service', '.sends li'], ['service name', '.sends b'], ['address', '.sends code'], ['never sent', '.sends-not'],
    ['Look up details for the selection', '#lookup-selected'], ['missing details label', '.occ-lookup .occ-label'], ['missing details', '.occ-lookup .lookup-line'], ['Look up details in details', '.occ-lookup .btn'],
    ['looked-up note', '.link-row .cited-note'], ['Export panel line', '#lookup-line-text'], ['Look up details in the Export panel', '#lookup-authors']];
  const measured = [];
  const measure = async (theme, pairs) => {
    for (const scheme of ['light', 'dark']) {
      await mutate({type: 'settings.update', patch: {theme, appearance: scheme}});
      await until(() => applied(theme, scheme), `${theme} ${scheme} applied`); await settled();
      measured.push(...(await contrast(ui, pairs)).map((entry) => ({...entry, name: `${theme} ${scheme} ${entry.name}`})));
    }
  };
  const themes = await ui.locator('input[name="theme"]').evaluateAll((inputs) => inputs.map((input) => input.value));
  assert.ok(themes.length >= 7, 'every theme');
  for (const theme of themes) {
    held = gate(lookupUrl('pubmed', PMID));
    await startFromKeyboard();
    await held.arrived;
    await measure(theme, progressPairs);
    if (theme === 'nebula') { await toTop('#review'); await shot('lookup-progress-nebula-dark.png'); }
    await ui.locator('#lookup-stop').click();
    await finished();
    held.open();
    await ui.locator('.link-row .cited-note').first().waitFor();
    await measure(theme, restPairs);
    if (theme === 'meteor') { await toTop('#online-panel'); await shot('lookup-full-view-meteor-dark.png'); }
    await ui.locator('#lookup-undo').click();
    await until(async () => (await ui.locator('#lookup-done-text').innerText()) === 'Lookup undone: the details are as they were before.', `${theme}: Undo`);
    await ui.locator('#lookup-dismiss').click();
  }
  await mutate({type: 'settings.update', patch: {theme: 'meteor', appearance: 'system'}});
  for (const entry of measured) { assert.ok(!entry.missing, `${entry.name} missing`); assert.ok(entry.ratio >= 4.5, `${entry.name} contrast ${entry.ratio}`); }
  result.contrast = measured;
  assert.deepEqual(await pagesNow(), seeded, 'every Undo put the citations back');
  pass('lookup-contrast-in-every-theme-light-and-dark', {themes: themes.length, measured: measured.length, lowest: Math.min(...measured.map((entry) => entry.ratio))});

  // The page had no errors, and only the three services were ever asked.
  assert.deepEqual(errors, []);
  assert.deepEqual([...new Set(outside.map((request) => new URL(request.url).host))].sort(), ['api.crossref.org', 'api.datacite.org', 'eutils.ncbi.nlm.nih.gov'], 'only the three services were ever asked');
  assert.ok(outside.every((request) => request.method === 'GET' && request.headers.origin === 'null' && request.headers.cookie === undefined && request.headers.referer === undefined), 'every request: GET, origin null, no cookie, no referrer');
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
