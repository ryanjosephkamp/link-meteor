// PDF files (0.6.0): the PDFs behind chosen links as one ZIP, or combined into one PDF, in the
// Export panel's Download files. On the loaded extension with no optional grants: Chrome for
// Testing, headless, a fresh temporary profile under .scratch/ (deleted afterwards), the real
// unpacked build, and Chrome's own toolbar action (tests/helpers/action.mjs) for temporary access
// to the page the links came from. The workbench in its own window stands in for the side panel.
// It checks:
// - the section: its words with and without PDF links, and that Download files is unchanged;
// - Download as one ZIP with only the toolbar's access: PDFs on the page's own site are fetched
//   through that page, one at a time, 2 seconds apart, including one the site sends as a download
//   and one that needs a password; a PDF on another site is "No access" and never asked for; a
//   sign-in page, a missing file and an address that moves to another site each say so; the ZIP's
//   entries are the fixtures byte for byte (read by the release ZIP reader and by Python's zipfile);
// - Combine into one PDF…: the list, reordering and leaving out by keyboard, files added through
//   the chooser and by a drop, the file name, what is left out with its reason, and the combined
//   PDF's pages in the list's order, read back with the shipped PDF.js; files from the computer
//   alone, with no PDF link chosen;
// - the limits (20 PDFs, 50 MB each, 200 MB together), Stop in the middle, and a run started elsewhere;
// - that the PDF reader loads only when a PDF is read (a ZIP never loads PDF.js);
// - the 320 px layout and text contrast in every theme, light and dark;
// - that nothing is saved, every download lands in the profile's own folder, and nothing but the
//   fixture server is asked. Chrome's request for sites is stubbed: no native prompt is shown.
//   npm run build && LINK_METEOR_FIXTURE_PORT=52650 node tests/pdf-files-browser.mjs
// Writes pdf-files-browser-results.json and screenshots to the evidence folder.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readdir, readFile, truncate, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {promisify} from 'node:util';
import {fixtureServer, evidence, root} from './helpers/browser.mjs';
import {launchWithAction} from './helpers/action.mjs';
import {fixture as pdfFixture, readPdf, combinePdfs} from './helpers/pdf.mjs';
import {readPackagedMembers} from '../scripts/verify-package.mjs';
import {THEME_IDS} from '../src/core/themes.js';

const result = {started: new Date().toISOString(), browser: 'Chrome for Testing, headless, fresh temporary profile, real unpacked extension, no optional grants; Chrome’s real toolbar action; permission requests are stubbed', checks: [], screenshots: []};
const pass = (name, data = {}) => { result.checks.push({name, ...data}); console.log('PASS', name, Object.keys(data).length ? JSON.stringify(data) : ''); };
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const run = promisify(execFile);
const python = process.env.LINK_METEOR_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
// As the panel writes a size.
const sizeText = (bytes) => (bytes / 1048576 >= 0.1 ? `${(bytes / 1048576).toFixed(1)} MB` : `${bytes ? Math.max(1, Math.round(bytes / 1024)) : 0} KB`);

// Every request the fixture server gets, with its time. /wait/<name>.pdf is a PDF that is sent
// only once the check lets it go.
const requests = [];
let gate = null;
const hold = () => { let open; gate = new Promise((done) => { open = done; }); return () => { open(); gate = null; }; };
const fixture = await fixtureServer({routes: async (req, res, url) => {
  requests.push({host: req.headers.host, path: url.pathname + url.search, at: Date.now()});
  if (!url.pathname.startsWith('/wait/')) return false;
  if (gate) await gate;
  const body = await pdfFixture('notes.pdf');
  res.writeHead(200, {'Content-Type': 'application/pdf', 'Content-Length': body.length, 'Cache-Control': 'no-store'}); res.end(body);
  return true;
}});
const browser = await launchWithAction({profilePrefix: 'pdf-files-profile-'});
const base = fixture.base, other = fixture.other, site = new URL(base).host, otherSite = new URL(other).host;
const asked = (path, host = site) => requests.filter((request) => request.host === host && request.path === path);

const js = (session, expression) => browser.evaluate(session, expression);
async function until(fn, message, timeout = 15000) {
  const start = Date.now(); let last;
  while (Date.now() - start < timeout) { last = await fn(); if (last) return last; await sleep(80); }
  throw new Error(`${message} (timed out; last: ${JSON.stringify(last)})`);
}
// Rasterizes any CSS color to sRGB, then computes WCAG contrast against the nearest opaque background.
const CONTRAST = `(pairs) => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d', {willReadFrequently: true});
  const rgb = (color) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const lum = (c) => c.map((n) => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((s, n, i) => s + n * [.2126, .7152, .0722][i], 0);
  const bg = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(c) && !/\\/ 0\\)$/.test(c)) return c; } return getComputedStyle(document.body).backgroundColor; };
  return pairs.map(([name, selector]) => { const el = document.querySelector(selector); if (!el || !el.getClientRects().length) return {name, missing: true}; const a = lum(rgb(getComputedStyle(el).color)), b = lum(rgb(bg(el))); return {name, ratio: Math.round(((Math.max(a, b) + .05) / (Math.min(a, b) + .05)) * 100) / 100}; });
}`;

try {
  await mkdir(evidence, {recursive: true});
  // Every download goes to a folder inside this profile, and the check hears when it is complete.
  const downloads = resolve(browser.profile, 'downloads'), home = resolve(browser.profile, 'home/Downloads');
  await mkdir(downloads, {recursive: true});
  await browser.send('Browser.setDownloadBehavior', {behavior: 'allow', downloadPath: downloads, eventsEnabled: true});
  const saved = [];
  browser.onEvent((message) => {
    if (message.method === 'Browser.downloadWillBegin') saved.push({guid: message.params.guid, name: message.params.suggestedFilename, url: message.params.url, state: 'inProgress'});
    if (message.method === 'Browser.downloadProgress') { const item = saved.find((entry) => entry.guid === message.params.guid); if (item) item.state = message.params.state; }
  });
  const download = async (count) => {
    await until(() => saved.length === count && saved.at(-1).state === 'completed', `download ${count} complete`, 30000);
    return {name: saved.at(-1).name, bytes: await readFile(resolve(downloads, saved.at(-1).name))};
  };

  const {targetId: uiTarget} = await browser.newWindow(browser.extensionUrl());
  const ui = await browser.attach(uiTarget);
  // Every file the workbench asks for, by its path inside the extension, from a fresh load.
  const loaded = new Set();
  browser.onEvent((message) => { if (message.method === 'Network.requestWillBeSent' && message.sessionId === ui) { const url = message.params.request.url; if (url.startsWith(browser.extensionUrl(''))) loaded.add(url.slice(browser.extensionUrl('').length)); } });
  await browser.send('Network.enable', {}, ui);
  await browser.send('Page.enable', {}, ui);
  await browser.send('Page.reload', {ignoreCache: true}, ui);
  await until(() => js(ui, `!!document.getElementById('collection-heading')?.textContent && !!window.chrome?.runtime`).catch(() => false), 'workbench loaded');
  await browser.send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false}, ui);
  await sleep(600);
  const pdfFiles = () => [...loaded].filter((path) => /pdf/.test(path)).sort();
  const $ = (id) => `document.getElementById(${JSON.stringify(id)})`;
  const rpc = (message) => js(ui, `chrome.runtime.sendMessage(${JSON.stringify(message)}).then((r) => { if (!r?.ok) throw new Error(r?.error || 'no response'); return r.data; })`);
  const rpcError = (message) => js(ui, `chrome.runtime.sendMessage(${JSON.stringify(message)}).then((r) => r.ok ? '' : r.error)`);
  const state = () => rpc({type: 'state.get'});
  const text = (id) => js(ui, `${$(id)}.innerText`);
  const visible = (id) => js(ui, `!${$(id)}.closest('[hidden]') && ${$(id)}.getClientRects().length > 0`);
  const disabled = (id) => js(ui, `${$(id)}.disabled`);
  const click = (id) => js(ui, `${$(id)}.click()`);
  // A click as a person's, for what needs one: Chrome's request for sites, and the file chooser.
  const press = (id) => browser.send('Runtime.evaluate', {expression: `${$(id)}.click(); true`, userGesture: true, returnByValue: true}, ui);
  const notice = () => js(ui, `document.querySelector('#notice:not([hidden]) .msg')?.innerText || ''`);
  const error = () => js(ui, `document.querySelector('#error:not([hidden]) .msg')?.innerText || ''`);
  const quiet = () => js(ui, `(() => { for (const id of ['notice', 'error']) document.getElementById(id).hidden = true; return true; })()`);
  const focused = () => js(ui, `document.activeElement?.id || document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName`);
  const key = async (name, modifiers = 0) => {
    const code = {Enter: 13, Tab: 9, Escape: 27, ' ': 32}[name];
    await browser.send('Input.dispatchKeyEvent', {type: 'keyDown', key: name, code: name === ' ' ? 'Space' : name, windowsVirtualKeyCode: code, modifiers, ...(name === 'Enter' ? {text: '\r'} : name === ' ' ? {text: ' '} : {})}, ui);
    await browser.send('Input.dispatchKeyEvent', {type: 'keyUp', key: name, code: name === ' ' ? 'Space' : name, windowsVirtualKeyCode: code, modifiers}, ui);
  };
  const shot = async (name) => { const {data} = await browser.send('Page.captureScreenshot', {format: 'png'}, ui); await writeFile(resolve(evidence, name), Buffer.from(data, 'base64')); result.screenshots.push(name); };
  const running = () => rpc({type: 'run.status'}).then(({run: last}) => (last && last.state !== 'done' ? last : null));
  const lastRun = () => rpc({type: 'run.status'}).then(({run: last}) => last);
  const tabCount = () => js(ui, `chrome.tabs.query({}).then((tabs) => tabs.length)`);
  // The section, the list and the result, as the person reads them.
  const section = () => js(ui, `({title: ${$('pdf-set-title')}.innerText, zip: !${$('pdf-zip')}.hidden, zipOff: ${$('pdf-zip')}.disabled, combineOff: ${$('pdf-combine')}.disabled, expanded: ${$('pdf-combine')}.getAttribute('aria-expanded'),
    help: ${$('pdf-set-help')}.innerText, problem: ${$('pdf-set-help')}.classList.contains('is-problem'), access: ${$('pdf-access')}.hidden ? '' : ${$('pdf-access')}.innerText})`);
  const list = () => js(ui, `[...document.querySelectorAll('#combine-list > li')].map((row) => [row.querySelector('.name b').innerText, row.querySelector('.name small').innerText])`);
  const names = async () => (await list()).map((row) => row[0]);
  const leftOut = () => js(ui, `${$('combine-skip')}.hidden ? [] : [...document.querySelectorAll('#combine-skip li')].map((line) => line.innerText)`);
  const outcome = () => js(ui, `${$('pdf-result')}.hidden ? null : {head: document.querySelector('#pdf-result p').innerText, lines: [...document.querySelectorAll('#pdf-result li')].map((line) => line.innerText)}`);
  const control = (label) => `document.querySelector('#combine-list button[aria-label=${JSON.stringify(label)}]')`;
  // Stands in for Chrome's prompt: records each request and answers as the check says.
  const stubPrompt = () => js(ui, `(() => { window.__requests = []; window.__answer = false; chrome.permissions.request = async (request) => { window.__requests.push({request, activeGesture: navigator.userActivation.isActive}); return window.__answer; };
    window.__csp = []; document.addEventListener('securitypolicyviolation', (event) => window.__csp.push(event.violatedDirective + ' ' + event.blockedURI)); return true; })()`);
  const prompts = () => js(ui, `window.__requests.splice(0)`);
  // Files for the chooser, and the chooser itself.
  const fixturePath = (name) => resolve(root, 'tests/fixtures/pdf', name);
  await browser.send('Page.setInterceptFileChooserDialog', {enabled: true}, ui);
  const choose = async (files) => {
    const opened = new Promise((done) => { const off = browser.onEvent((message) => { if (message.method === 'Page.fileChooserOpened') { off(); done(message.params); } }); });
    await press('combine-add');
    const chooser = await Promise.race([opened, sleep(8000).then(() => null)]);
    assert.ok(chooser, 'Add PDF files… opens the file chooser');
    await browser.send('DOM.setFileInputFiles', {files, backendNodeId: chooser.backendNodeId}, ui);
    return chooser;
  };

  await rpc({type: 'state.mutate', action: {type: 'settings.update', patch: {welcomeSeen: true}}});
  await stubPrompt();
  const paper = await pdfFixture('paper.pdf'), journal = await pdfFixture('journal.pdf'), notes = await pdfFixture('notes.pdf'), locked = await pdfFixture('password.pdf');
  const pages = {paper: (await readPdf(paper)).pageCount, journal: (await readPdf(journal)).pageCount, notes: (await readPdf(notes)).pageCount};

  /* 1. With no PDF links: one button, and nothing of the PDF reader loaded. */
  const NO_PDFS = 'No PDF links in this view. PDF links end in .pdf or are labeled [PDF]. You can still combine PDF files from your computer: they are read in this browser and never uploaded.';
  assert.deepEqual(await section(), {title: 'PDF files', zip: false, zipOff: false, combineOff: false, expanded: 'false', help: NO_PDFS, problem: false, access: ''});
  assert.deepEqual(await js(ui, `[${$('pdf-set')}.getAttribute('role'), ${$('pdf-set')}.getAttribute('aria-labelledby'), ${$('pdf-combine')}.innerText.trim(), ${$('pdf-combine')}.getAttribute('aria-controls'), ${$('pdf-set')}.closest('section').id]`),
    ['group', 'pdf-set-title', 'Combine into one PDF…', 'combine-panel', 'downloads-section']);
  assert.ok(loaded.has('ui/workbench.js'), 'the page’s own files are seen');
  assert.deepEqual(pdfFiles(), ['ui/workbench/pdf-files.js', 'ui/workbench/pdf.js'], 'only the two modules the person sees: no PDF rules, no reader, no PDF.js');
  pass('With no PDF links the section offers only Combine into one PDF…, and nothing of the PDF reader is loaded');

  /* 2. The links of a page, captured with the toolbar's access and nothing more. */
  const listUrl = `${base}/site/pdf-files.html`;
  const {targetId: pageTarget} = await browser.newTab(listUrl);
  await sleep(1200);
  await browser.send('Target.activateTarget', {targetId: pageTarget});
  assert.equal(await browser.clickAction(listUrl), 'clicked');
  await js(ui, `window.dispatchEvent(new Event('focus')); true`);
  await until(async () => /Reading list/.test(await text('scope-preview')), 'the workbench sees the tab');
  assert.equal(await js(ui, `chrome.permissions.contains({origins: ['${base}/*']})`), false, 'no site access: only the toolbar click');
  await click('capture');
  await until(async () => (await state()).collections[0].links.length === 11, 'the page’s 11 links');
  await until(async () => (await section()).title === 'The 9 PDFs' && (await section()).access, 'the section follows the links');
  const HELP = 'Link Meteor gets each PDF through a page of its own site, as when you click the link, and puts them together in this browser. Nothing is uploaded. 20 PDFs at most.';
  const NEEDS = `Needs access to 1 site: ${otherSite} (1 PDF). Chrome asks when you start. PDFs on sites you don’t allow are left out.`;
  assert.deepEqual(await section(), {title: 'The 9 PDFs', zip: true, zipOff: false, combineOff: false, expanded: 'false', help: HELP, problem: false, access: NEEDS});
  assert.equal((await js(ui, `${$('pdf-zip')}.innerText`)).trim(), 'Download as one ZIP');
  // Download files itself is as it was: every file, one by one.
  assert.equal(await text('downloads-label'), 'Download 10 files');
  assert.match(await text('downloads-help'), /^Saves the file behind each file link to Link Meteor › My-research in your downloads folder, named after its anchor text, 3 at a time\. The other 1 link isn’t a file link\./);
  assert.deepEqual(pdfFiles(), ['core/pdf.js', 'ui/workbench/pdf-files.js', 'ui/workbench/pdf.js'], 'the limits are loaded once there is a PDF link; the reader is not');
  const before = await state(), report = await js(ui, `chrome.storage.session.get('linkMeteorCaptureReport').then((kept) => JSON.stringify(kept))`);
  pass('With PDF links: “The 9 PDFs”, both buttons, the help line, the sites a start would ask for; Download files unchanged', {help: HELP, access: NEEDS});

  /* 3. Download as one ZIP, with only the toolbar's access. Chrome's request is declined. */
  const tabsBefore = await tabCount(), zipStarted = Date.now();
  await press('pdf-zip');
  await until(() => visible('pdf-progress'), 'the counter');
  assert.deepEqual(await prompts(), [{request: {origins: [`${other}/*`]}, activeGesture: true}], 'one request, in the click, naming exactly the site that needs a background tab');
  assert.equal(await focused(), 'pdf-stop', 'focus moves to Stop');
  await until(async () => /^Getting PDF \d of 9$/.test(await text('pdf-progress-title')), 'the counter’s words');
  assert.match(await text('pdf-progress-text'), new RegExp(`^${site.replace('.', '\\.')} · \\d+ KB so far\\. Keep Link Meteor open until this is done\\.$`));
  assert.deepEqual(await js(ui, `[${$('pdf-progress')}.getAttribute('role'), ${$('pdf-progress')}.parentElement.id, ${$('pdf-zip')}.disabled, ${$('pdf-combine')}.disabled, ${$('capture')}.disabled, ${$('run-title')}.innerText]`), ['status', 'pdf-set', true, true, true, 'Getting PDFs']);
  await until(async () => /^Getting PDF \d of 9 · now on “[^”]+\.pdf”$/.test(await text('run-text')), 'the Capture section shows the run too');
  const zipped = await download(1);
  await until(async () => (await outcome()) && !(await running()), 'the ZIP’s report');
  assert.match(zipped.name, /^My-research_\d{4}-\d{2}-\d{2}_\d{4}\.zip$/, 'named like an export');
  const expectedLines = [
    `A-small-paper-about-links.pdf: In the ZIP · ${sizeText(paper.length)}`,
    `A-study-of-things-that-link.pdf: In the ZIP · ${sizeText(journal.length)}`,
    `Field-notes.pdf: In the ZIP · ${sizeText(notes.length)}`,
    `Field-notes (2).pdf: In the ZIP · ${sizeText(notes.length)}`,
    'The-study-moved.pdf: Not fetched: the address may move to another site, which Link Meteor has no access to',
    'A-paper-behind-a-sign-in-page.pdf: Not a PDF: the site asked to sign in, or the address has expired.',
    `A-PDF-that-needs-a-password.pdf: In the ZIP · ${sizeText(locked.length)}`,
    'The-study-on-another-site.pdf: No access',
    'A-PDF-that-is-gone.pdf: The site answered with an error instead of the PDF.'];
  const zipHead = `Downloaded ${zipped.name} with 5 of 9 PDFs, ${sizeText(paper.length + journal.length + 2 * notes.length + locked.length)}. Chrome’s request for access was declined, so PDFs on the sites it named were left out.`;
  assert.deepEqual(await outcome(), {head: zipHead, lines: expectedLines});
  assert.equal(await notice(), zipHead);
  assert.equal(await js(ui, `${$('pdf-result')}.getAttribute('role')`), 'status');
  await until(async () => (await focused()) === 'pdf-zip', 'focus returns to the button');
  // The ZIP: nothing but the PDFs, each byte for byte what the site sent.
  const members = readPackagedMembers(zipped.bytes);
  const inZip = [['A-small-paper-about-links.pdf', paper], ['A-study-of-things-that-link.pdf', journal], ['Field-notes.pdf', notes], ['Field-notes (2).pdf', notes], ['A-PDF-that-needs-a-password.pdf', locked]];
  assert.deepEqual([...members.keys()], inZip.map(([name]) => name), 'the entries, in the list’s order, repeats numbered');
  for (const [name, bytes] of inZip) assert.ok(members.get(name).equals(bytes), `${name} is the fixture, byte for byte`);
  const zipPath = resolve(downloads, zipped.name);
  const read = JSON.parse((await run(python, ['-c', 'import zipfile,sys,hashlib,json\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps({"bad": z.testzip(), "names": z.namelist(), "sha256": [hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()], "stored": all(i.compress_type == zipfile.ZIP_STORED for i in z.infolist())}))', zipPath])).stdout);
  assert.deepEqual(read, {bad: null, names: inZip.map(([name]) => name), sha256: inZip.map(([, bytes]) => sha256(bytes)), stored: true}, 'Python’s zipfile reads the same files');
  // One file at a time, 2 seconds apart, each asked of the page's own site; the other site's file never.
  const fetched = ['/pdf/paper.pdf', '/pdf/journal.pdf', '/pdf-download/notes.pdf', '/pdf/notes.pdf', '/pdf-moved/journal.pdf', '/pdf-signin/paper.pdf', '/pdf/password.pdf', '/pdf/missing.pdf'].map((path) => asked(path).filter((request) => request.at >= zipStarted));
  assert.deepEqual(fetched.map((hits) => hits.length), [1, 1, 1, 1, 1, 1, 1, 1], 'each PDF is asked for once');
  const gaps = fetched.slice(1).map((hits, index) => hits[0].at - fetched[index][0].at);
  assert.ok(gaps.every((gap) => gap >= 1900), `2 seconds apart: ${gaps}`);
  // The page's own request followed the moved address once, as a click would; nothing else went to the other site.
  assert.deepEqual(requests.filter((request) => request.host === otherSite).map((request) => request.path), ['/pdf/journal.pdf']);
  assert.ok(Math.abs(requests.find((request) => request.host === otherSite).at - fetched[4][0].at) < 1500, 'and that one request is the redirect');
  assert.equal(await tabCount(), tabsBefore, 'no tab was opened');
  // Nothing is saved, and the capture's own report is still the one kept.
  assert.deepEqual(await state(), before);
  assert.equal(await js(ui, `chrome.storage.session.get('linkMeteorCaptureReport').then((kept) => JSON.stringify(kept))`), report);
  const ended = await lastRun();
  assert.deepEqual([ended.kind, ended.state, ended.summary, ended.count, ended.collectionId], ['files', 'done', 'Fetched 5 of 9 PDFs.', 0, '']);
  // A ZIP reads no PDF: the file is fetched and stored as it is, and PDF.js stays unloaded.
  assert.deepEqual(pdfFiles(), ['core/pdf.js', 'ui/workbench/pdf-files.js', 'ui/workbench/pdf-reader.js', 'ui/workbench/pdf-tab.js', 'ui/workbench/pdf.js']);
  await shot('pdf-files-zip-1280.png');
  pass('Download as one ZIP with only the toolbar’s access: same-site PDFs (one sent as a download, one that needs a password), 2 seconds apart; the rest say why; the ZIP holds the fixtures byte for byte', {zip: zipped.name, entries: [...members.keys()], gaps, lines: expectedLines});

  /* 4. Combine into one PDF…: the panel and its list. */
  await quiet();
  await click('pdf-combine');
  assert.equal(await visible('combine-panel'), true);
  assert.equal(await outcome(), null, 'the earlier report steps aside');
  const anchors = ['A small paper about links', 'A study of things that link', 'Field notes', 'Field notes', 'The study, moved', 'A paper behind a sign-in page', 'A PDF that needs a password', 'The study, on another site', 'A PDF that is gone'];
  const fileNames = ['A-small-paper-about-links.pdf', 'A-study-of-things-that-link.pdf', 'Field-notes.pdf', 'Field-notes (2).pdf', 'The-study-moved.pdf', 'A-paper-behind-a-sign-in-page.pdf', 'A-PDF-that-needs-a-password.pdf', 'The-study-on-another-site.pdf', 'A-PDF-that-is-gone.pdf'];
  assert.deepEqual(await list(), fileNames.map((name, index) => [name, anchors[index]]), 'each PDF’s file name and its link’s own words, in the list’s order');
  assert.deepEqual(await js(ui, `[${$('combine-panel')}.getAttribute('aria-labelledby'), ${$('combine-title')}.innerText, ${$('combine-list')}.tagName, ${$('pdf-combine')}.getAttribute('aria-expanded'), ${$('combine-apply')}.innerText.trim(), ${$('combine-apply')}.disabled, ${$('combine-cancel')}.innerText, ${$('combine-add')}.innerText.trim()]`),
    ['combine-title', 'Combine into one PDF, in this order', 'OL', 'true', 'Combine 9 PDFs', false, 'Cancel', 'Add PDF files…']);
  assert.match(await js(ui, `${$('combine-name')}.value`), /^My-research_\d{4}-\d{2}-\d{2}_\d{4}\.pdf$/, 'the file name follows the export name pattern');
  assert.equal(await js(ui, `${$('combine-name')}.labels[0].innerText.trim()`), 'File name');
  assert.equal(await text('combine-total'), '9 PDFs. Link Meteor fetches the 9 when you press Combine; their pages and sizes show then. Pages keep their links and bookmarks.');
  assert.equal(await text('combine-access'), NEEDS);
  // Each row's three buttons, labeled as Columns, in order labels its own.
  assert.deepEqual(await js(ui, `[...document.querySelectorAll('#combine-list > li')].slice(0, 2).map((row) => [...row.querySelectorAll('button')].map((button) => [button.getAttribute('aria-label'), button.title, button.disabled]))`), [
    [['Move A-small-paper-about-links.pdf up', 'Move up', true], ['Move A-small-paper-about-links.pdf down', 'Move down', false], ['Leave out A-small-paper-about-links.pdf', 'Leave out', false]],
    [['Move A-study-of-things-that-link.pdf up', 'Move up', false], ['Move A-study-of-things-that-link.pdf down', 'Move down', false], ['Leave out A-study-of-things-that-link.pdf', 'Leave out', false]]]);
  assert.equal(await js(ui, `document.querySelector('#combine-list > li:last-child button[data-move="down"]').disabled`), true);
  assert.equal(await focused(), 'Move A-small-paper-about-links.pdf down', 'focus goes to the list’s first button that can be pressed');
  pass('Combine into one PDF… opens a list of the PDFs with their file names and anchor text, labeled buttons, a file name and a summary');

  /* 5. Reordering and leaving out, by keyboard. */
  await key('Enter');
  assert.deepEqual((await names()).slice(0, 3), [fileNames[1], fileNames[0], fileNames[2]]);
  assert.equal(await focused(), 'Move A-small-paper-about-links.pdf down', 'focus stays on the same button of the moved PDF');
  await key(' ');
  assert.deepEqual((await names()).slice(0, 4), [fileNames[1], fileNames[2], fileNames[0], fileNames[3]]);
  assert.equal(await focused(), 'Move A-small-paper-about-links.pdf down');
  // Tab goes on to Leave out; Shift+Tab twice comes back to Move up.
  await key('Tab');
  assert.equal(await focused(), 'Leave out A-small-paper-about-links.pdf');
  await key('Tab', 8); await key('Tab', 8);
  assert.equal(await focused(), 'Move A-small-paper-about-links.pdf up');
  await key('Enter'); await key('Enter');
  assert.deepEqual((await names()).slice(0, 3), fileNames.slice(0, 3), 'moved up twice: back where it started');
  assert.equal(await focused(), 'Move A-small-paper-about-links.pdf down', 'at the top, Move up is off, so focus is on the next button');
  await key('Enter'); await key('Enter');
  // Leave out three, each from the keyboard; focus then goes to Add PDF files….
  for (const name of ['Field-notes (2).pdf', 'The-study-moved.pdf', 'A-PDF-that-is-gone.pdf']) {
    await js(ui, `${control(`Leave out ${name}`)}.focus()`);
    await key('Enter');
    assert.equal(await focused(), 'combine-add', `after leaving out ${name}`);
  }
  const arranged = ['A-study-of-things-that-link.pdf', 'Field-notes.pdf', 'A-small-paper-about-links.pdf', 'A-paper-behind-a-sign-in-page.pdf', 'A-PDF-that-needs-a-password.pdf', 'The-study-on-another-site.pdf'];
  assert.deepEqual(await names(), arranged);
  assert.equal((await js(ui, `${$('combine-apply')}.innerText`)).trim(), 'Combine 6 PDFs');
  assert.equal(await text('combine-total'), '6 PDFs. Link Meteor fetches the 6 when you press Combine; their pages and sizes show then. Pages keep their links and bookmarks.');
  pass('The list is reordered and PDFs are left out from the keyboard, with focus kept on the moved PDF’s button', {order: arranged});

  /* 6. PDF files from the computer, through the chooser: read here, and what can't be combined is named. */
  const chooser = await choose(['notes.pdf', 'password.pdf', 'not-a-pdf.pdf', 'damaged.pdf'].map(fixturePath));
  assert.equal(chooser.mode, 'selectMultiple');
  assert.deepEqual(await js(ui, `[${$('combine-file')}.accept, ${$('combine-file')}.multiple]`), ['.pdf,application/pdf', true]);
  await until(async () => (await names()).length === 7, 'the chosen PDF joins the list');
  assert.deepEqual((await list()).at(-1), ['notes.pdf', `Added from your computer · ${pages.notes} pages · ${sizeText(notes.length)}`]);
  const leftFiles = ['password.pdf: Needs a password, so it can’t be combined', 'not-a-pdf.pdf: Not a PDF', 'damaged.pdf: Damaged, so it couldn’t be read'];
  assert.deepEqual(await leftOut(), leftFiles);
  assert.deepEqual(await js(ui, `[${$('combine-skip')}.getAttribute('role'), document.querySelector('#combine-skip strong').innerText]`), ['status', 'Left out']);
  assert.equal(await notice(), 'Added 1 PDF file to the end of the list. 3 files were left out, and listed under Left out with the reason.');
  assert.equal(await text('combine-total'), `7 PDFs. 1 is ready (${pages.notes} pages · ${sizeText(notes.length)}). Link Meteor fetches the other 6 when you press Combine; their pages and sizes show then. Pages keep their links and bookmarks.`);
  assert.ok(loaded.has('vendor/pdfjs/pdf.min.mjs') && loaded.has('ui/workbench/pdfjs.js'), 'PDF.js is loaded now that a PDF is read');
  // A file dropped on the list joins it too, and Import links never sees the drop.
  await js(ui, `(() => { const bytes = Uint8Array.from(atob(${JSON.stringify(journal.toString('base64'))}), (c) => c.charCodeAt(0));
    const data = new DataTransfer(); data.items.add(new File([bytes], 'journal-copy.pdf', {type: 'application/pdf'}));
    const target = ${$('combine-list')};
    target.dispatchEvent(new DragEvent('dragover', {dataTransfer: data, bubbles: true, cancelable: true}));
    window.__dropMark = ${$('combine-panel')}.classList.contains('is-drop');
    target.dispatchEvent(new DragEvent('drop', {dataTransfer: data, bubbles: true, cancelable: true})); return true; })()`);
  await until(async () => (await names()).length === 8, 'the dropped PDF joins the list');
  assert.deepEqual((await list()).at(-1), ['journal-copy.pdf', `Added from your computer · ${pages.journal} pages · ${sizeText(journal.length)}`]);
  assert.deepEqual(await js(ui, `[window.__dropMark, ${$('combine-panel')}.classList.contains('is-drop'), ${$('import')}.hidden]`), [true, false, true], 'the panel shows where the drop goes, and the Import links view stays closed');
  // It moves up one place by keyboard, ahead of the file chosen before it.
  await js(ui, `${control('Move journal-copy.pdf up')}.focus()`);
  await key('Enter');
  assert.deepEqual(await names(), [...arranged, 'journal-copy.pdf', 'notes.pdf']);
  pass('PDF files from the computer join the list through the chooser and by a drop, with their pages and sizes; a file that can’t be combined is left out by name', {leftOut: leftFiles});

  /* 7. Combine: the missing files are fetched; what can't go in is left out by name, before anything is made. */
  await quiet();
  await js(ui, `(() => { const input = ${$('combine-name')}; input.value = 'Reading list: combined'; input.dispatchEvent(new Event('input', {bubbles: true})); window.__answer = true; return true; })()`);
  const combineStarted = Date.now(), runBefore = (await lastRun()).runId;
  await press('combine-apply');
  await until(() => visible('pdf-progress'), 'the counter, in the panel');
  // Chrome's request is "allowed" by the stand-in, which grants nothing: the background checks for itself.
  assert.deepEqual(await prompts(), [{request: {origins: [`${other}/*`]}, activeGesture: true}]);
  assert.deepEqual(await js(ui, `[${$('pdf-progress')}.parentElement.id, document.activeElement.id, ${$('combine-apply')}.disabled, ${$('combine-add')}.disabled, ${$('combine-name')}.disabled, [...document.querySelectorAll('#combine-list button')].every((button) => button.disabled)]`),
    ['combine-panel', 'pdf-stop', true, true, true, true], 'the counter and Stop sit in the panel, and the list is held while files are fetched');
  assert.equal(await disabled('combine-cancel'), true, 'Stop is the way out while files are fetched');
  await until(async () => !(await running()) && (await error()), 'the files fetched', 40000);
  const leftLinks = ['A-paper-behind-a-sign-in-page.pdf: Not a PDF: the site asked to sign in, or the address has expired.', 'A-PDF-that-needs-a-password.pdf: Needs a password, so it can’t be combined', 'The-study-on-another-site.pdf: No access'];
  assert.deepEqual(await leftOut(), [...leftFiles, ...leftLinks]);
  assert.equal(await error(), '3 PDFs were left out, and listed under Left out with the reason. Press Combine 5 PDFs to make the PDF without them.');
  assert.deepEqual(await list(), [
    ['A-study-of-things-that-link.pdf', `A study of things that link · ${pages.journal} pages · ${sizeText(journal.length)}`],
    ['Field-notes.pdf', `Field notes · ${pages.notes} pages · ${sizeText(notes.length)}`],
    ['A-small-paper-about-links.pdf', `A small paper about links · ${pages.paper} pages · ${sizeText(paper.length)}`],
    ['journal-copy.pdf', `Added from your computer · ${pages.journal} pages · ${sizeText(journal.length)}`],
    ['notes.pdf', `Added from your computer · ${pages.notes} pages · ${sizeText(notes.length)}`]], 'each PDF’s page count and size, once read');
  const order = [journal, notes, paper, journal, notes], allPages = 2 * pages.journal + 2 * pages.notes + pages.paper;
  assert.equal(await text('combine-total'), `5 PDFs · ${allPages} pages · ${sizeText(order.reduce((sum, bytes) => sum + bytes.length, 0))}. Pages keep their links and bookmarks.`);
  assert.deepEqual([(await js(ui, `${$('combine-apply')}.innerText`)).trim(), await disabled('combine-apply'), await focused(), saved.length], ['Combine 5 PDFs', false, 'combine-apply', 1], 'nothing is made until the person has seen what is left out');
  assert.equal(await js(ui, `${$('combine-access')}.hidden`), true, 'nothing more to ask for');
  // Chrome answers from its cache what it fetched for the ZIP minutes ago, as it would for a click;
  // the sign-in page, which may not be kept, is asked for again.
  assert.deepEqual(['/pdf/journal.pdf', '/pdf-download/notes.pdf', '/pdf/paper.pdf', '/pdf-signin/paper.pdf', '/pdf/password.pdf'].map((path) => asked(path).filter((request) => request.at >= combineStarted).length), [0, 0, 0, 1, 0]);
  assert.equal(requests.filter((request) => request.host === otherSite && request.at >= combineStarted).length, 0, 'the other site is not asked');
  assert.notEqual((await lastRun()).runId, runBefore);
  await shot('pdf-files-combine-1280.png');
  pass('Combine fetches the PDFs still missing; a sign-in page, a PDF that needs a password and a site without access are left out by name, and nothing is made yet', {leftOut: leftLinks});

  /* 8. Combine again: nothing more is fetched, and one PDF comes out, in the list's order. */
  await quiet();
  const fetchedRun = (await lastRun()).runId, askedBefore = requests.length;
  await press('combine-apply');
  const combined = await download(2);
  assert.equal(combined.name, 'Reading-list-combined.pdf', 'the typed name, made safe, ending .pdf');
  const madeHere = await readPdf(combined.bytes), madeInNode = await readPdf((await combinePdfs(order)).bytes);
  assert.equal(madeHere.pageCount, allPages);
  assert.deepEqual(madeHere.links.map((link) => [link.url, link.pdfPage, link.anchorText]), madeInNode.links.map((link) => [link.url, link.pdfPage, link.anchorText]), 'every link, on its page, as the same combination made in Node');
  // The order, by the pages each part's links land on: journal, notes, paper, journal, notes.
  const paperLinks = (await readPdf(paper)).links, startOfPaper = pages.journal + pages.notes;
  assert.deepEqual(madeHere.links.filter((link) => link.pdfPage > startOfPaper && link.pdfPage <= startOfPaper + pages.paper).map((link) => [link.url, link.pdfPage - startOfPaper]), paperLinks.map((link) => [link.url, link.pdfPage]));
  await until(async () => !!(await outcome()), 'the combined PDF’s report');
  const done = await outcome();
  assert.equal(done.head, `Downloaded Reading-list-combined.pdf: 5 PDFs, ${allPages} pages, ${sizeText(combined.bytes.length)}.`);
  assert.deepEqual(done.lines, [
    `A-study-of-things-that-link.pdf: ${pages.journal} pages, from page 1`, `Field-notes.pdf: ${pages.notes} pages, from page ${1 + pages.journal}`, `A-small-paper-about-links.pdf: ${pages.paper} pages, from page ${1 + startOfPaper}`,
    `journal-copy.pdf: ${pages.journal} pages, from page ${1 + startOfPaper + pages.paper}`, `notes.pdf: ${pages.notes} pages, from page ${1 + startOfPaper + pages.paper + pages.journal}`,
    ...[...leftFiles, ...leftLinks].map((line) => line.replace(': ', ': Left out: '))]);
  assert.equal(await notice(), done.head);
  assert.deepEqual([await visible('combine-panel'), await js(ui, `${$('pdf-combine')}.getAttribute('aria-expanded')`), await focused()], [false, 'false', 'pdf-combine'], 'the panel closes, and focus returns to its button');
  assert.deepEqual([(await lastRun()).runId, requests.length], [fetchedRun, askedBefore], 'no run and no request: the files were already here');
  assert.deepEqual(await state(), before, 'nothing is saved');
  pass('Combine N PDFs writes one PDF in the list’s order, under the typed name; its pages and links read back as the same combination made in Node', {name: combined.name, pages: madeHere.pageCount, links: madeHere.links.length, bytes: combined.bytes.length});

  /* 9. With no PDF link chosen, the panel still combines files from the computer. */
  await quiet();
  await js(ui, `(() => { const row = [...document.querySelectorAll('.link-row')].find((item) => /This page/.test(item.innerText)); row.querySelector('input[type=checkbox]').click(); return true; })()`);
  await until(async () => (await section()).title === 'PDF files', 'a selection without PDFs');
  assert.deepEqual(await section(), {title: 'PDF files', zip: false, zipOff: false, combineOff: false, expanded: 'false', help: NO_PDFS, problem: false, access: ''});
  await click('pdf-combine');
  assert.deepEqual([await names(), await visible('combine-empty'), await text('combine-empty'), await text('combine-total'), (await js(ui, `${$('combine-apply')}.innerText`)).trim(), await disabled('combine-apply'), await focused()],
    [[], true, 'No PDFs yet. Add PDF files from your computer, or drop them here.', 'No PDFs to combine yet.', 'Combine PDFs', true, 'combine-add']);
  await choose([fixturePath('paper.pdf'), fixturePath('journal.pdf')]);
  await until(async () => (await names()).length === 2, 'two files from the computer');
  assert.deepEqual([await visible('combine-empty'), await text('combine-total'), (await js(ui, `${$('combine-apply')}.innerText`)).trim(), await js(ui, `${$('combine-access')}.hidden`)],
    [false, `2 PDFs · ${pages.paper + pages.journal} pages · ${sizeText(paper.length + journal.length)}. Pages keep their links and bookmarks.`, 'Combine 2 PDFs', true]);
  const localRun = (await lastRun()).runId, localAsked = requests.length;
  await press('combine-apply');
  const local = await download(3);
  assert.match(local.name, /^My-research_\d{4}-\d{2}-\d{2}_\d{4}\.pdf$/);
  const localRead = await readPdf(local.bytes);
  assert.deepEqual([localRead.pageCount, localRead.links.length], [pages.paper + pages.journal, (await readPdf((await combinePdfs([paper, journal])).bytes)).links.length]);
  assert.deepEqual([(await lastRun()).runId, requests.length, (await prompts()).length], [localRun, localAsked, 0], 'no run, no request to any site, no access asked for');
  await until(async () => (await focused()) === 'pdf-combine', 'the panel closed');
  await js(ui, `(() => { const row = [...document.querySelectorAll('.link-row')].find((item) => /This page/.test(item.innerText)); row.querySelector('input[type=checkbox]').click(); return true; })()`);
  await until(async () => (await section()).title === 'The 9 PDFs', 'the selection cleared');
  pass('With no PDF link chosen, the panel combines PDF files from the computer: no run, no request, no access', {name: local.name, pages: localRead.pageCount});

  /* 10. The limits, said before anything starts. */
  await quiet();
  const twentyOne = Array.from({length: 21}, (_, index) => ({anchorText: `Paper ${index + 1}`, url: `${base}/pdf/paper.pdf?copy=${index + 1}`, imported: 'the limits check'}));
  await rpc({type: 'import.commit', newCollection: 'Too many', links: twentyOne});
  await until(async () => (await section()).title === 'The 21 PDFs' && (await section()).problem, '21 PDFs in the view');
  const many = await section();
  assert.deepEqual([many.zipOff, many.combineOff, many.help], [true, false, 'Choose up to 20 PDFs at a time. This view has 21 PDF links: select fewer or filter the view, or leave some out under Combine into one PDF…']);
  assert.equal(await rpcError({type: 'run.start', kind: 'files', files: twentyOne.map((link) => ({url: link.url}))}), 'Choose up to 20 PDFs at a time.', 'the background refuses it too');
  await click('pdf-combine');
  assert.deepEqual([(await names()).length, await text('combine-help'), await js(ui, `${$('combine-help')}.classList.contains('is-problem')`), await disabled('combine-apply')], [21, 'Choose up to 20 PDFs at a time. Leave out 1.', true, true]);
  await js(ui, `${control('Leave out Paper-21.pdf')}.click()`);
  assert.deepEqual([(await names()).length, await js(ui, `${$('combine-help')}.hidden`), await disabled('combine-apply'), (await js(ui, `${$('combine-apply')}.innerText`)).trim()], [20, true, false, 'Combine 20 PDFs']);
  // A file from the computer counts toward the 20.
  await choose([fixturePath('notes.pdf')]);
  await until(async () => (await error()) === 'Choose up to 20 PDFs at a time. Nothing was added.', 'the refusal of a 21st PDF');
  assert.equal((await names()).length, 20);
  await quiet();
  // 50 MB each and 200 MB together, by the files' sizes, before a byte is read.
  for (const name of ['Paper-20.pdf', 'Paper-19.pdf', 'Paper-18.pdf', 'Paper-17.pdf', 'Paper-16.pdf', 'Paper-15.pdf']) await js(ui, `${control(`Leave out ${name}`)}.click()`);
  const files = resolve(browser.profile, 'files'); await mkdir(files, {recursive: true});
  const sparse = async (name, megabytes) => { const path = resolve(files, name); await writeFile(path, ''); await truncate(path, megabytes * 1024 * 1024); return path; };
  await choose([await sparse('too-big.pdf', 51)]);
  await until(async () => (await error()) === 'Nothing was added. 1 file was left out, and listed under Left out with the reason.', 'the refusal of a 51 MB file');
  assert.deepEqual([await leftOut(), (await names()).length], [['too-big.pdf: A PDF can be at most 50 MB.'], 14]);
  await quiet();
  await choose(Array(5).fill(await sparse('part.pdf', 45)));
  await until(async () => (await error()) === 'These PDFs are more than 200 MB together. Choose fewer. Nothing was added.', 'the refusal of 225 MB');
  assert.equal((await names()).length, 14);
  await quiet();
  await shot('pdf-files-limits-1280.png');
  // Escape closes the panel and returns focus; Cancel does the same.
  await js(ui, `${$('combine-name')}.focus()`);
  await key('Escape');
  assert.deepEqual([await visible('combine-panel'), await focused()], [false, 'pdf-combine']);
  await click('pdf-combine'); await click('combine-cancel');
  assert.deepEqual([await visible('combine-panel'), await focused(), await js(ui, `${$('pdf-combine')}.getAttribute('aria-expanded')`)], [false, 'pdf-combine', 'false']);
  pass('The limits are said before anything starts: more than 20 PDFs, a PDF over 50 MB, and more than 200 MB together; Escape and Cancel close the panel');

  /* 11. At 320 px: Stop in the middle, by keyboard; and the layout and contrast of every part. */
  await rpc({type: 'import.commit', newCollection: 'Three to stop', links: [
    {anchorText: 'A study of things that link', url: `${base}/pdf/journal.pdf`, imported: 'the Stop check'},
    {anchorText: 'A slow paper', url: `${base}/wait/slow.pdf`, imported: 'the Stop check'},
    {anchorText: 'A small paper about links', url: `${base}/pdf/paper.pdf`, imported: 'the Stop check'}]});
  await until(async () => (await section()).title === 'The 3 PDFs', 'three PDFs');
  await browser.send('Emulation.setDeviceMetricsOverride', {width: 320, height: 900, deviceScaleFactor: 1, mobile: false}, ui);
  await until(() => js(ui, `innerWidth === 320`), '320 px');
  await click('dock-export');
  await until(() => visible('pdf-zip'), 'the Export view at 320 px');
  // Without transitions, so colors are measured as they settle.
  await js(ui, `(() => { for (const sheet of document.styleSheets) { try { sheet.insertRule('* { transition: none !important; animation: none !important; }', sheet.cssRules.length); } catch { /* not ours */ } } return true; })()`);
  const overflow = () => js(ui, `(() => { const wide = [...document.querySelectorAll('#pdf-set, #pdf-set *')].filter((item) => item.getClientRects().length && item.getBoundingClientRect().right > innerWidth + 0.5).map((item) => item.tagName.toLowerCase() + '#' + item.id);
    return document.documentElement.scrollWidth > innerWidth || wide.length ? wide.concat('page: ' + document.documentElement.scrollWidth) : false; })()`);
  const measured = [];
  // Every theme, light and dark: each named part is there, readable (4.5:1 at least) and inside 320 px.
  const everyTheme = async (stateName, pairs, picture) => {
    let lowest = {ratio: Infinity};
    for (const theme of THEME_IDS) for (const scheme of ['light', 'dark']) {
      await rpc({type: 'state.mutate', action: {type: 'settings.update', patch: {theme, appearance: scheme}}});
      await until(() => js(ui, `document.documentElement.dataset.theme === ${JSON.stringify(theme)} && document.documentElement.dataset.scheme === ${JSON.stringify(scheme)}`), `${theme} ${scheme} applied`);
      await sleep(120);
      for (const entry of await js(ui, `(${CONTRAST})(${JSON.stringify(pairs)})`)) {
        assert.ok(!entry.missing, `${stateName}, ${theme} ${scheme}: ${entry.name} is not shown`);
        assert.ok(entry.ratio >= 4.5, `${stateName}, ${theme} ${scheme}: ${entry.name} contrast ${entry.ratio}`);
        if (entry.ratio < lowest.ratio) lowest = {...entry, theme, scheme};
      }
      assert.equal(await overflow(), false, `${stateName}, ${theme} ${scheme}: nothing overflows at 320 px`);
      if (picture && theme === 'meteor') { await js(ui, `${$('pdf-set')}.scrollIntoView({block: 'start'})`); await shot(`${picture}-${scheme}.png`); }
    }
    measured.push({state: stateName, parts: pairs.length, lowest});
  };
  const releaseSlow = hold();
  const stopStarted = Date.now(), tabsNow = await tabCount();
  await press('pdf-zip');
  await until(async () => (await visible('pdf-progress')) && (await text('pdf-progress-title')) === 'Getting PDF 2 of 3', 'the second file, which the site is slow to send', 20000);
  assert.deepEqual(await prompts(), [], 'every PDF is on the page’s own site: nothing to ask for');
  assert.match(await text('pdf-progress-text'), new RegExp(`· ${sizeText(journal.length)} so far\\.`), 'the first file is here');
  await everyTheme('a run in progress', [['title', '#pdf-set-title'], ['help', '#pdf-set-help'], ['counter', '#pdf-progress-title'], ['counter detail', '#pdf-progress-text'], ['Stop', '#pdf-stop']], 'pdf-files-run-320');
  assert.equal(await focused(), 'pdf-stop', 'Stop holds the focus');
  await key('Enter');
  await until(async () => !(await running()) && !!(await outcome()), 'the run stopped');
  assert.deepEqual(await outcome(), {head: 'You pressed Stop. No ZIP was made.', lines: [`A-study-of-things-that-link.pdf: Fetched, then dropped · ${sizeText(journal.length)}`, 'A-slow-paper.pdf: Not read: you pressed Stop', 'A-small-paper-about-links.pdf: Not read: you pressed Stop']});
  releaseSlow();
  await sleep(1500);
  const stopped = await lastRun();
  assert.deepEqual([stopped.state, stopped.ended.reason, stopped.ended.text, stopped.results.map((row) => row.status)], ['done', 'stopped', 'You pressed Stop.', ['got', 'not-read', 'not-read']]);
  assert.deepEqual([saved.length, asked('/pdf/paper.pdf').filter((request) => request.at >= stopStarted).length, await tabCount(), await visible('pdf-progress')], [3, 0, tabsNow, false], 'nothing was downloaded, the third file was never asked for, and the late answer changed nothing');
  await until(async () => (await focused()) === 'pdf-zip', 'focus returns to the button');
  await everyTheme('a report', [['report', '#pdf-result p'], ['file name', '#pdf-result li b'], ['how it ended', '#pdf-result li'], ['Download as one ZIP', '#pdf-zip span'], ['Combine into one PDF…', '#pdf-combine span']], 'pdf-files-report-320');
  pass('Stop, from the keyboard, in the middle of a run: the file in hand and the rest are not read, no ZIP is made, and a file that arrives later is not taken');

  // The panel: its list (a link's PDF and a file from the computer), what was left out, the name, the summary.
  await quiet();
  await js(ui, `(() => { window.__answer = false; return true; })()`);
  await rpc({type: 'state.mutate', action: {type: 'collection.activate', id: before.activeCollectionId}});
  await until(async () => (await section()).title === 'The 9 PDFs', 'the first collection again');
  await click('pdf-combine');
  await choose(['notes.pdf', 'password.pdf'].map(fixturePath));
  await until(async () => (await names()).length === 10 && (await leftOut()).length === 1, 'a file added and one left out');
  await quiet();
  await everyTheme('the panel', [['panel title', '#combine-title'], ['file name', '#combine-list li:first-child .name b'], ['anchor text', '#combine-list li:first-child .name small'], ['added file', '#combine-list li:last-child .name small'],
    ['Add PDF files…', '#combine-add span'], ['drop hint', '.combine-panel .pdf-set-actions .help'], ['Left out', '#combine-skip strong'], ['left-out file', '#combine-skip li b'], ['left-out reason', '#combine-skip li'],
    ['File name', 'label[for="combine-name"]'], ['name field', '#combine-name'], ['summary', '#combine-total'], ['summary count', '#combine-total strong'], ['sites needed', '#combine-access'], ['Combine', '#combine-apply-label'], ['Cancel', '#combine-cancel'], ['sites needed, ZIP', '#pdf-access']], 'pdf-files-panel-320');
  // Icon buttons keep a target of at least 24 px, and the focus ring shows.
  assert.deepEqual(await js(ui, `(() => { const button = ${control('Move A-study-of-things-that-link.pdf up')}; button.focus(); const box = button.getBoundingClientRect(), ring = getComputedStyle(button);
    return [box.width >= 24 && box.height >= 24, button.matches(':focus-visible') ? ring.outlineStyle !== 'none' && parseFloat(ring.outlineWidth) >= 2 : true]; })()`), [true, true]);
  await click('combine-cancel');
  // The limits' words, and the empty panel.
  await rpc({type: 'state.mutate', action: {type: 'collection.activate', id: (await state()).collections.find((item) => item.name === 'Too many').id}});
  await until(async () => (await section()).problem, 'the collection of 21');
  await click('pdf-combine');
  await everyTheme('over the limit', [['the limit', '#pdf-set-help'], ['the limit, in the panel', '#combine-help']]);
  await click('combine-cancel');
  await rpc({type: 'import.commit', newCollection: 'No PDFs', links: [{anchorText: 'A page', url: `${base}/site/pdf-files.html`, imported: 'the empty check'}]});
  await until(async () => (await section()).title === 'PDF files', 'a collection without PDFs');
  await click('pdf-combine');
  await everyTheme('nothing to combine yet', [['no PDF links', '#pdf-set-help'], ['empty list', '#combine-empty span'], ['summary', '#combine-total']], 'pdf-files-empty-320');
  await click('combine-cancel');
  await rpc({type: 'state.mutate', action: {type: 'settings.update', patch: {theme: 'meteor', appearance: 'system'}}});
  pass('At 320 px nothing overflows, and every part’s text has a contrast of at least 4.5:1 in every theme, light and dark', {themes: THEME_IDS.length, measured});

  /* 12. A run started elsewhere holds the buttons until it is over. */
  await browser.send('Emulation.setDeviceMetricsOverride', {width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false}, ui);
  await rpc({type: 'state.mutate', action: {type: 'collection.activate', id: before.activeCollectionId}});
  await until(async () => (await section()).title === 'The 9 PDFs' && !(await section()).zipOff, 'the first collection, idle');
  const target = await js(ui, `chrome.runtime.sendMessage({type: 'tabs.list'}).then((reply) => reply.data.targetTabId)`);
  // This run's files are asked of no page that holds them (it was not started by a button), so it waits.
  const elsewhere = await rpc({type: 'run.start', kind: 'files', tabId: target, files: [{url: `${base}/pdf/journal.pdf`, name: 'Elsewhere.pdf'}]});
  await until(async () => (await section()).zipOff, 'the buttons held');
  assert.equal((await section()).help, `${HELP} Another capture is running. Wait for it to finish, or stop it.`);
  await click('pdf-combine');
  assert.deepEqual([await disabled('combine-apply'), await text('combine-help')], [true, 'Another capture is running. Wait for it to finish, or stop it.']);
  assert.equal(asked('/pdf/journal.pdf').filter((request) => request.at >= Date.now() - 3000).length, 0, 'a page that didn’t start the run fetches nothing for it');
  await rpc({type: 'run.stop', runId: elsewhere.runId});
  await until(async () => !(await section()).zipOff && !(await disabled('combine-apply')), 'the buttons free again');
  await click('combine-cancel');
  pass('While another run is going, both actions wait for it, and say so');

  /* 13. Where everything landed, and who was asked. */
  assert.deepEqual((await readdir(downloads)).sort(), [zipped.name, combined.name, local.name].sort(), 'the three files made, in the profile’s own folder');
  assert.deepEqual(await readdir(home).catch(() => []), [], 'nothing in the Downloads folder');
  assert.ok(saved.every((item) => item.url.startsWith(`blob:${browser.extensionUrl('').slice(0, -1)}`)), 'each download is a file Link Meteor made in its own page');
  assert.ok(requests.length > 0 && requests.every((request) => [site, otherSite].includes(request.host)), 'only the fixture server was asked');
  assert.deepEqual(await js(ui, `window.__csp`), [], 'the page’s own rules were never broken');
  assert.equal(await js(ui, `chrome.permissions.getAll().then((all) => all.origins.length)`), 0, 'no site access was gained');
  pass('Every file made landed in the profile’s own folder; nothing reached any other site; no access was gained', {downloads: saved.map((item) => item.name), requests: requests.length});
  result.status = 'PASS';
} catch (error) {
  result.status = 'FAIL'; result.error = String(error?.stack || error); console.error(error); process.exitCode = 1;
} finally {
  gate = null;
  await browser.close(); await fixture.close();
  result.finished = new Date().toISOString();
  await writeFile(resolve(evidence, 'pdf-files-browser-results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(result.status, `${result.checks.length} checks`);
}
