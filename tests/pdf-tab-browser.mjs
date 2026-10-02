// Getting a PDF's file through a tab (0.6.0, src/ui/workbench/pdf-tab.js), with nothing but the
// toolbar's temporary access: Chrome for Testing, headless, a fresh temporary profile, the real
// unpacked extension, and Chrome's real toolbar action (DevTools Extensions.triggerAction).
// - A PDF shown in a tab is read from that tab, with or without ".pdf" in its address, and reads
//   exactly as the same file does in Node.
// - A page that lists PDFs hands over the ones on its own site, including one the site sends as
//   a download; a PDF on another site, or one that moves there, can't be had from that page.
// - A sign-in page where a PDF was expected, a tab without access and a PDF opened from the
//   computer are each refused in plain words.
// Capture this PDF in the workbench (src/ui/workbench/pdf.js), the same way: the workbench in its
// own window stands in for the side panel, and the PDF's tab is readable only through the toolbar
// click.
// - On a PDF's tab the capture button reads Capture this PDF, Select a region is off and says why,
//   and the click previews the PDF's links; nothing is added before Add N links. Adding saves one
//   batch with each link's page, words and context, the PDF as their source page with what it says
//   about itself, and the PDF itself as a link; a link's details show its page; Undo removes it all.
// - A PDF whose address doesn't say so, a sign-in page at a .pdf address, PDFs that need a
//   password, are damaged, have no links or no text, and a PDF opened from the computer (the words,
//   and Choose this PDF…, which opens the file chooser).
// - Select a region on a PDF: refused in the workbench, and said on the page from the shortcut.
// - A PDF among the tabs of a capture is reported as a PDF, not as an error.
// - 320 px and text contrast, light and dark.
// - Nothing is downloaded, and nothing is requested from anywhere but the fixture server.
//   npm run build && node tests/pdf-tab-browser.mjs
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixtureServer, evidence, root} from './helpers/browser.mjs';
import {launchWithAction} from './helpers/action.mjs';
import {fixture as pdfFixture, readPdf} from './helpers/pdf.mjs';
import {THEME_IDS} from '../src/core/themes.js';

const result = {started: new Date().toISOString(), browser: 'Chrome for Testing, headless, fresh temporary profile, real unpacked extension, no optional grants; Chrome’s real toolbar action', checks: []};
const pass = (name, data = {}) => { result.checks.push({name, ...data}); console.log('PASS', name, Object.keys(data).length ? JSON.stringify(data) : ''); };
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const plain = (value) => JSON.parse(JSON.stringify(value));

const requests = [];
const fixture = await fixtureServer({routes: (req) => { requests.push(`${req.headers.host}${req.url}`); return false; }});
const browser = await launchWithAction({profilePrefix: 'pdf-tab-profile-'});
try {
  await mkdir(evidence, {recursive: true});
  // The workbench in its own window stands in for the open side panel.
  const {targetId: uiTarget} = await browser.newWindow(browser.extensionUrl());
  const ui = await browser.attach(uiTarget);
  await sleep(1500);
  // In the workbench: find a tab by its address, then run a pdf-tab.js function on it.
  const inWorkbench = (fn, args) => browser.evaluate(ui, `(async () => {
    const tab = await import(chrome.runtime.getURL('ui/workbench/pdf-tab.js'));
    const sha = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    try { return await (${fn})(tab, sha, ...${JSON.stringify(args)}); } catch (error) { return {refused: error.message, reason: error.reason || ''}; }
  })()`);
  const read = (tabId) => inWorkbench(`async (tab, sha, tabId) => { const {bytes, ...rest} = await tab.readPdfTab(tabId); return {...rest, size: bytes.length, sha256: await sha(bytes)}; }`, [tabId]);
  const through = (tabId, url) => inWorkbench(`async (tab, sha, tabId, url) => { const got = await tab.pdfThroughTab(tabId, url); return {size: got.bytes.length, sha256: await sha(got.bytes), url: got.url, type: got.type}; }`, [tabId, url]);
  // Opens a tab and returns its id as Chrome's extension APIs know it. Before the toolbar click the
  // extension can't see the tab's address, so the id comes from the newest tab.
  const targets = [];
  const open = async (url) => {
    const before = new Set(await browser.evaluate(ui, `chrome.tabs.query({}).then((tabs) => tabs.map((tab) => tab.id))`));
    targets.push((await browser.newTab(url)).targetId); await sleep(1800);
    const ids = await browser.evaluate(ui, `chrome.tabs.query({}).then((tabs) => tabs.map((tab) => tab.id))`);
    const fresh = ids.filter((id) => !before.has(id));
    assert.equal(fresh.length, 1, `one new tab for ${url}`);
    return fresh[0];
  };
  const click = async (prefix) => { assert.equal(await browser.clickAction(prefix), 'clicked'); await sleep(800); };

  // 1. A PDF shown in a tab: no access before the toolbar click, then read as Node reads the file.
  const paper = await pdfFixture('paper.pdf');
  const paperUrl = `${fixture.base}/pdf/paper.pdf`;
  const pdfTab = await open(paperUrl);
  assert.deepEqual(await read(pdfTab), {refused: 'Link Meteor has no access to that page.', reason: 'access'});
  await click(paperUrl);
  const fromTab = await read(pdfTab);
  const {bytes: _bytes, ...expected} = {...(await readPdf(paper, {address: paperUrl})), address: paperUrl, size: paper.length, sha256: sha256(paper)};
  assert.deepEqual(fromTab, plain(expected), 'the PDF in the tab reads exactly as the file does');
  assert.equal(fromTab.citation.pdfUrl, paperUrl);
  pass('pdf-tab-read-with-toolbar-access-only', {links: fromTab.links.length, pages: fromTab.pageCount, bytes: fromTab.size});

  // 2. A PDF whose address doesn't say so.
  const plainUrl = `${fixture.base}/pdf-plain/paper`;
  const plainTab = await open(plainUrl); await click(plainUrl);
  const fromPlain = await read(plainTab);
  assert.deepEqual([fromPlain.sha256, fromPlain.links.length, fromPlain.address], [sha256(paper), 15, plainUrl]);
  pass('pdf-tab-read-without-pdf-in-the-address');

  // 3. A sign-in page where a PDF was expected, and the tab's own address after it moved.
  const signinUrl = `${fixture.base}/pdf-signin/paper.pdf`;
  const signinTab = await open(signinUrl); await click(signinUrl);
  assert.deepEqual(await read(signinTab), {refused: 'The site didn’t send a PDF: it asked to sign in, or the address has expired. Download the PDF, then choose Import links, PDF file.', reason: 'not-pdf'});
  pass('pdf-tab-sign-in-page-refused');

  // 4. A page that lists PDFs hands over the ones on its own site.
  const listUrl = `${fixture.base}/site/pdf-list.html`;
  const listTab = await open(listUrl); await click(listUrl);
  const journal = await pdfFixture('journal.pdf'), notes = await pdfFixture('notes.pdf');
  assert.deepEqual(await through(listTab, `${fixture.base}/pdf/journal.pdf`), {size: journal.length, sha256: sha256(journal), url: `${fixture.base}/pdf/journal.pdf`, type: 'application/pdf'});
  const download = await through(listTab, `${fixture.base}/pdf-download/notes.pdf`);
  assert.deepEqual([download.size, download.sha256], [notes.length, sha256(notes)], 'a PDF the site sends as a download is handed over the same way');
  assert.deepEqual(await through(listTab, `${fixture.base}/pdf-moved/journal.pdf`), {refused: 'Chrome couldn’t get this PDF’s file from that page.', reason: 'failed'}, 'a PDF that moves to another site');
  assert.deepEqual(await through(listTab, `${fixture.other}/pdf/journal.pdf`), {refused: 'Chrome couldn’t get this PDF’s file from that page.', reason: 'failed'}, 'a PDF on another site');
  assert.deepEqual(await through(listTab, `${fixture.base}/pdf-signin/paper.pdf`), {refused: 'The site didn’t send a PDF: it asked to sign in, or the address has expired.', reason: 'not-pdf'});
  assert.deepEqual(await through(listTab, `${fixture.base}/pdf/missing.pdf`), {refused: 'The site answered with an error instead of the PDF.', reason: 'status'});
  pass('pdf-through-a-page-of-its-own-site', {download: download.size});

  // 5. A PDF opened from the computer can't be read from its tab, and says so.
  const local = pathToFileURL(resolve(root, 'tests/fixtures/pdf/paper.pdf')).href;
  const localTab = await open(local); await click(local);
  const fromLocal = await read(localTab);
  assert.ok(['failed', 'access'].includes(fromLocal.reason), JSON.stringify(fromLocal));
  pass('pdf-tab-local-file-not-readable', {reason: fromLocal.reason});

  /* Capture this PDF, in the workbench ------------------------------------------------------------ */
  const js = (expression) => browser.evaluate(ui, expression);
  const until = async (fn, message, timeout = 15000) => {
    const start = Date.now(); let last;
    while (Date.now() - start < timeout) { last = await fn(); if (last) return last; await sleep(60); }
    throw new Error(`${message} (timed out; last: ${JSON.stringify(last)}; error shown: ${await js(`document.getElementById('error').hidden ? '' : document.getElementById('error').textContent`)})`);
  };
  const text = (id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`);
  const shown = (id) => js(`(() => { const e = document.getElementById(${JSON.stringify(id)}); return !!e && !e.hidden && e.getClientRects().length > 0; })()`);
  const press = (id) => js(`document.getElementById(${JSON.stringify(id)}).click(); true`);
  // A click as a person's, for what needs one: the file chooser.
  const pressAsPerson = (id) => browser.send('Runtime.evaluate', {expression: `document.getElementById(${JSON.stringify(id)}).click(); true`, userGesture: true, returnByValue: true}, ui);
  const rpc = (message) => js(`chrome.runtime.sendMessage(${JSON.stringify(message)}).then((r) => { if (!r?.ok) throw new Error(r?.error || 'no response'); return r.data; })`);
  const rpcError = (message) => js(`chrome.runtime.sendMessage(${JSON.stringify(message)}).then((r) => r.ok ? '' : r.error)`);
  const state = () => rpc({type: 'state.get'});
  const active = async () => { const all = await state(); return all.collections.find((item) => item.id === all.activeCollectionId); };
  const notice = (phrase) => until(async () => (await shown('notice')) && (await js(`document.querySelector('#notice .msg')?.textContent || ''`)).includes(phrase), `notice: ${phrase}`);
  const failure = async (phrase) => {
    await until(async () => (await shown('error')) && (await js(`document.querySelector('#error .msg')?.textContent || ''`)) === phrase, `error: ${phrase}`);
    await js(`[...document.querySelectorAll('#error button')].find((button) => button.textContent === 'Dismiss').click(); true`);
  };
  const facts = () => js(`[...document.querySelectorAll('#pdf-facts dt')].map((dt) => [dt.textContent, ...[...dt.nextElementSibling.children].map((part) => part.textContent)])`);
  const tableRows = () => js(`[...document.querySelectorAll('#import-table tbody tr')].map((row) => [...row.cells].map((cell) => cell.textContent))`);
  const summary = async () => [await text('import-summary-main'), await text('import-summary-skips')];
  const preview = () => until(() => shown('import-plan'), 'the PDF’s links previewed');
  // The tab the workbench will capture: opened, made readable by the toolbar click, and shown in
  // the Capture section. Earlier PDF tabs are closed first, so the section can't still show one.
  let current = null;
  const show = async (url, label = 'Capture this PDF') => {
    if (current) { await browser.send('Target.closeTarget', {targetId: current.targetId}); await until(async () => (await text('capture-label')) === 'Capture this page', 'the earlier PDF’s tab is gone'); }
    const before = new Set(await js(`chrome.tabs.query({}).then((tabs) => tabs.map((tab) => tab.id))`));
    const {targetId} = await browser.newTab(url); await sleep(1500);
    const [tabId] = (await js(`chrome.tabs.query({}).then((tabs) => tabs.map((tab) => tab.id))`)).filter((id) => !before.has(id));
    await browser.send('Target.activateTarget', {targetId});
    await click(url);
    // A side panel opened by that click reads the tab list as it loads. This window was already
    // open, so it looks again, as it does whenever it gets the focus.
    await js(`window.dispatchEvent(new Event('focus')); true`);
    current = {targetId, tabId, url};
    await until(async () => (await text('capture-label')) === label, `${label} for ${url}`);
    return current;
  };
  // The tabs of the checks above are closed, so the Capture section starts from no PDF.
  for (const targetId of targets.splice(0)) await browser.send('Target.closeTarget', {targetId}).catch(() => {});
  await until(async () => (await text('capture-label')) === 'Capture this page', 'the workbench is ready');
  if (await shown('welcome-close')) await press('welcome-close');

  // 6. A PDF's tab: the words, Select a region off, and the click previews its links.
  const before = await state();
  await show(paperUrl);
  assert.match(await text('scope-preview'), /^paper_final_v3\.indd · 127\.0\.0\.1:\d+\. A PDF\. Link Meteor reads the links inside it and shows them before adding any\.$/);
  assert.deepEqual(await js(`[document.getElementById('arm').disabled, document.getElementById('arm').getAttribute('aria-describedby'), document.getElementById('pdf-note').textContent, document.getElementById('pdf-note').hidden]`),
    [true, 'pdf-note', 'Regions can’t be drawn on a PDF.', false]);
  assert.equal(await rpcError({type: 'capture.arm', tabId: current.tabId}), 'Regions can’t be drawn on a PDF. Open Link Meteor’s side panel and choose Capture this PDF.');
  await press('capture');
  await preview();
  assert.deepEqual([await text('import-title'), await text('import-source')], ['Links in this PDF', `“A Small Paper About Links” · 3 pages · from this tab (${new URL(fixture.base).host})`]);
  assert.deepEqual(await facts(), [['arXiv', 'arXiv:2409.11211v1 · cs.CV · 17 Sep 2024', 'from the stamp on page 1'], ['DOI', '10.5555/fixture.2026.001', 'from page 1'],
    ['Title', 'A Small Paper About Links', 'from the first page’s largest text'], ['Authors', 'None read', 'PDFs rarely name them reliably. Look up details can fill them in.']]);
  const rows = await tableRows();
  assert.deepEqual(await js(`[...document.querySelectorAll('#import-table thead th')].map((cell) => cell.textContent)`), ['Page', 'Anchor text', 'Address', 'Left out because']);
  assert.deepEqual(rows.map((row) => row.slice(0, 3)), fromTab.links.map((link) => [`p. ${link.pdfPage}`, link.anchorText || '(no words: a picture)', link.url]));
  assert.equal(await js(`document.querySelector('#import-table td.empty-text').textContent`), '(no words: a picture)');
  assert.equal(await text('import-table-note'), 'All 15 links.');
  assert.deepEqual(await summary(), ['Adds 15 links from 3 of 3 pages, and the PDF itself as a link.',
    'Left out: 1 link to a place inside the PDF, 2 that aren’t web, email or phone addresses. 1 link is on a picture and has no words; its anchor text stays empty. You can undo this.']);
  assert.deepEqual(await js(`[document.getElementById('import-commit').textContent.trim(), document.getElementById('pdf-self').checked, document.getElementById('pdf-self-label').textContent, document.getElementById('import-destination').selectedOptions[0].textContent, document.getElementById('import-map').hidden, document.getElementById('import-options').hidden]`),
    ['Add 15 links', true, 'Also save this PDF as a link, with what it says about itself', 'My research', true, true]);
  await press('import-only-skipped');
  assert.deepEqual(await tableRows(), [['', '1 link to a place inside the PDF', 'No address'], ['p. 1', '(not read)', '', 'Not a web, email or phone address'], ['p. 1', '(not read)', '', 'Not a web, email or phone address']]);
  assert.equal(await text('import-table-note'), 'What was left out: 3 links.');
  await press('import-only-skipped');
  assert.deepEqual(await state(), before, 'nothing is added before Add');
  pass('capture-this-pdf-previews-its-links', {links: rows.length, summary: await summary()});

  // 7. Add: one batch, each link with its page, its words and the PDF as its source; what the PDF
  // says about itself under the PDF's address; and the PDF itself as a link. Then a link's details.
  await press('import-commit');
  await notice('Added 15 links and the PDF itself to “My research”.');
  let home = await active();
  const title = 'A Small Paper About Links';
  assert.deepEqual(home.links.map((link) => [link.anchorText, link.url, link.pdfPage, link.sourceUrl, link.sourceTitle, link.imported]),
    [[title, paperUrl, undefined, paperUrl, title, undefined], ...fromTab.links.map((link) => [link.anchorText, link.url, link.pdfPage, paperUrl, title, undefined])]);
  assert.deepEqual(home.links.slice(1).map((link) => [link.originalHref, link.context]), fromTab.links.map((link) => [link.originalHref, link.context]), 'the address as written and the words around each link');
  assert.equal(home.links[1].anchorText, '', 'a link on a picture keeps empty anchor text');
  assert.equal(new Set(home.links.map((link) => link.batchId)).size, 1, 'one batch');
  const {readAt, ...cited} = home.pages[paperUrl];
  assert.deepEqual(cited, {arxiv: '2409.11211', arxivVersion: 'v1', arxivCategory: 'cs.CV', date: '17 Sep 2024', doi: '10.5555/fixture.2026.001', title, pdfUrl: paperUrl, source: 'pdf'});
  assert.ok(Date.now() - Date.parse(readAt) < 120000);
  assert.equal(await shown('import'), false);
  await until(async () => (await js(`document.querySelectorAll('.link-row').length`)) === 16, 'the links are listed');
  // Details of the fourth row (example.org/code... on page 1) and of the PDF itself.
  const details = (index) => js(`(() => { const row = document.querySelectorAll('.link-row')[${index}]; const box = row.querySelector('details'); box.open = true; box.dispatchEvent(new Event('toggle'));
    const cited = row.querySelector('[aria-label="Cited from"]');
    return {page: row.querySelector('.pdf-page')?.textContent || '', source: [...row.querySelectorAll('.facts dt')].find((dt) => dt.textContent === 'Source page').nextElementSibling.innerText,
      citedTitle: cited?.querySelector('.cited-title').textContent, citedLine: cited?.querySelector('.cited-line').textContent, citedNote: cited?.querySelector('.cited-note').textContent, citation: !!row.querySelector('[aria-label="Citation"]')}; })()`);
  const linkDetails = await details(2);
  assert.equal(linkDetails.page, 'Page 1 of the PDF');
  assert.equal(linkDetails.source, `${title}\n${paperUrl}\nPage 1 of the PDF`);
  assert.deepEqual([linkDetails.citedTitle, linkDetails.citedLine, linkDetails.citedNote], [title, '17 Sep 2024 · DOI 10.5555/fixture.2026.001 · arXiv 2409.11211', 'Read from the PDF itself. Saved in this browser.']);
  const selfDetails = await details(0);
  assert.deepEqual([selfDetails.page, selfDetails.citedNote, selfDetails.citation], ['', 'Read from the PDF itself. Saved in this browser.', false], 'the PDF itself is on no page, and its citation is its own');
  pass('capture-this-pdf-adds-one-batch', {links: home.links.length, citation: cited});

  // 8. Undo removes the batch. (What the PDF said about itself stays until no link uses it and the
  // saved data is next tidied, as for every import and capture.)
  await js(`[...document.querySelectorAll('#notice button')].find((button) => button.textContent === 'Undo').click(); true`);
  await notice('Undone: removed 16 links.');
  const undone = await state();
  assert.deepEqual([undone.collections.map((item) => item.links), undone.activeCollectionId], [before.collections.map((item) => item.links), before.activeCollectionId], 'Undo removes every link it added');
  pass('capture-this-pdf-undo');

  // 9. A PDF whose address doesn't say so is known once the tab can be asked. Saved without the
  // PDF itself; read again, every link is already saved there.
  await show(plainUrl);
  assert.match(await text('scope-preview'), /A PDF\. Link Meteor reads the links inside it/);
  await press('capture'); await preview();
  assert.equal(await text('import-source'), `“A Small Paper About Links” · 3 pages · from this tab (${new URL(fixture.base).host})`);
  await press('pdf-self');
  assert.deepEqual([(await summary())[0], (await text('import-commit')).trim()], ['Adds 15 links from 3 of 3 pages.', 'Add 15 links']);
  await press('import-commit');
  await notice('Added 15 links to “My research”.');
  home = await active();
  assert.deepEqual([home.links.length, new Set(home.links.map((link) => link.sourceUrl)).size, home.links[0].sourceUrl, home.pages[plainUrl].pdfUrl], [15, 1, plainUrl, plainUrl]);
  await press('capture'); await preview();
  assert.deepEqual(await summary(), ['Adds the PDF itself as a link.', 'Every link in this PDF is already saved there. Untick “Skip links already saved there” to add them again. Left out: 1 link to a place inside the PDF, 2 that aren’t web, email or phone addresses, 15 already saved there. You can undo this.']);
  assert.equal((await text('import-commit')).trim(), 'Add this PDF as a link');
  assert.equal(await js(`document.querySelectorAll('#import-table tbody tr.skip').length`), 15, 'each saved link says so');
  await press('pdf-self');
  assert.deepEqual([(await summary())[0], await js(`document.getElementById('import-commit').disabled`)], ['Nothing to add.', true]);
  await press('import-skip-saved');
  assert.equal((await summary())[0], 'Adds 15 links from 3 of 3 pages.');
  await press('import-cancel');
  await notice('Canceled. Nothing was added.');
  assert.equal((await active()).links.length, 15);
  pass('capture-this-pdf-without-pdf-in-the-address', {links: 15});

  // 10. Nothing to add, each in plain words.
  const HELP = ' Download the PDF, then choose Import links, PDF file.';
  for (const [path, words] of [
    ['/pdf-signin/paper.pdf', `The site didn’t send a PDF: it asked to sign in, or the address has expired.${HELP} Nothing was added.`],
    ['/pdf/password.pdf', 'This PDF needs a password. Link Meteor doesn’t ask for passwords. Nothing was added.'],
    ['/pdf/damaged.pdf', 'This PDF is damaged, or it isn’t a PDF, so it couldn’t be read. Nothing was added.'],
  ]) {
    await show(fixture.base + path);
    await press('capture');
    await failure(words);
    assert.equal(await shown('import'), false, `${path}: the view closes`);
  }
  // A PDF with no links, and one with no text at all (a scan): the preview says so, and the PDF
  // itself can still be saved as a link.
  const NO_LINKS = 'This PDF has no links Link Meteor can read. Scanned pages are pictures, and addresses printed without a link aren’t picked up. You can undo this.';
  await show(`${fixture.base}/pdf/no-links.pdf`);
  await press('capture'); await preview();
  assert.deepEqual([await summary(), (await text('import-commit')).trim(), await tableRows()], [['Adds the PDF itself as a link.', NO_LINKS], 'Add this PDF as a link', []]);
  assert.deepEqual(await facts(), [['Title', 'Words Without Links', 'from the first page’s largest text'], ['Authors', 'None read', 'PDFs rarely name them reliably.']]);
  await press('pdf-self');
  assert.deepEqual([await summary(), await js(`document.getElementById('import-commit').disabled`)], [['Nothing to add.', NO_LINKS.replace(' You can undo this.', '')], true]);
  await press('import-cancel');
  await show(`${fixture.base}/pdf/empty.pdf`);
  await press('capture'); await preview();
  assert.deepEqual([await shown('pdf-facts'), (await summary())[0]], [false, 'Adds the PDF itself as a link.'], 'a PDF that says nothing about itself');
  await press('import-commit');
  await notice('Added the PDF itself as a link to “My research”.');
  home = await active();
  assert.deepEqual([home.links.at(-1).url, home.links.at(-1).sourceUrl, home.links.at(-1).pdfPage, home.pages[`${fixture.base}/pdf/empty.pdf`]], [`${fixture.base}/pdf/empty.pdf`, `${fixture.base}/pdf/empty.pdf`, undefined, undefined]);
  pass('capture-this-pdf-nothing-to-add-in-plain-words');

  // 11. A PDF opened from the computer: the words, and Choose this PDF…, which opens the file
  // chooser (for PDFs only) and reads the chosen file.
  await show(local, 'Choose this PDF…');
  assert.equal(await text('scope-preview'), 'This PDF is a file on your computer. Chrome doesn’t let Link Meteor read it from the tab. Choose the file instead.');
  assert.deepEqual(await js(`[document.getElementById('arm').disabled, document.getElementById('pdf-note').textContent, document.querySelector('#capture use').getAttribute('href')]`),
    [true, 'You can also drop the file here. It is read in this browser and never uploaded, and Link Meteor needs no access for it. Regions can’t be drawn on a PDF.', '#i-import']);
  assert.equal(await rpcError({type: 'capture.arm', tabId: current.tabId}), 'Regions can’t be drawn on a PDF. Open Link Meteor’s side panel and choose the PDF’s file there.');
  await browser.send('Page.enable', {}, ui);
  await browser.send('Page.setInterceptFileChooserDialog', {enabled: true}, ui);
  const chooser = new Promise((done) => { const off = browser.onEvent((message) => { if (message.method === 'Page.fileChooserOpened') { off(); done(message.params); } }); });
  await pressAsPerson('capture');
  const opened = await Promise.race([chooser, sleep(8000).then(() => null)]);
  assert.ok(opened, 'Choose this PDF… opens the file chooser');
  assert.equal(await js(`document.getElementById('import-file').accept`), '.pdf,application/pdf', 'for PDFs only, this once');
  await browser.send('DOM.setFileInputFiles', {files: [resolve(root, 'tests/fixtures/pdf/paper.pdf')], backendNodeId: opened.backendNodeId}, ui);
  await preview();
  assert.equal(await text('import-source'), 'paper.pdf · 3 pages · from a file');
  assert.match(await js(`document.getElementById('import-file').accept`), /^\.csv,/, 'the chooser takes every kind of file again');
  // The collection holds these 15 links already (from the tab without ".pdf" above).
  assert.deepEqual([(await summary())[0], await text('pdf-self-label')], ['Adds the paper’s arXiv page as a link.', 'Also save this paper as a link (its arXiv page), with what the PDF says about itself']);
  await press('import-skip-saved');
  assert.equal((await summary())[0], 'Adds 15 links from 3 of 3 pages, marked Imported, and the paper’s arXiv page as a link.');
  await press('import-cancel');
  await until(async () => (await js(`document.activeElement.id`)) === 'capture', 'focus goes back to Choose this PDF…');
  await browser.send('Page.setInterceptFileChooserDialog', {enabled: false}, ui);
  // Chrome for Testing gives a command-line extension access to file addresses, and even so the
  // tab's file can't be read (check 5), which is why Link Meteor never asks for that setting.
  pass('local-pdf-tab-says-so-and-chooses-the-file', {fileAddressAccess: await js(`chrome.extension.isAllowedFileSchemeAccess()`)});

  // 12. Select a region from the shortcut on a PDF: the page itself says where its links are read.
  await show(paperUrl);
  const worker = await browser.attach(browser.workerTargetId());
  await browser.evaluate(worker, `chrome.commands.onCommand.dispatch('select-region', {id: ${current.tabId}}); true`);
  const pdfPage = await browser.attach(current.targetId);
  const said = await until(() => browser.evaluate(pdfPage, `document.getElementById('link-meteor-overlay')?.shadowRoot?.querySelector('.notice-text')?.textContent || ''`).catch(() => ''), 'the notice on the PDF’s page');
  assert.equal(said, 'Regions can’t be drawn on a PDF. Open Link Meteor’s side panel and choose Capture this PDF.');
  assert.equal(await js(`chrome.storage.session.get('linkMeteorActivationError').then((v) => v.linkMeteorActivationError || '')`), '', 'no full view is needed to say it');
  pass('select-a-region-on-a-pdf-says-so-on-the-page');

  // 13. A PDF among the tabs of a capture is reported as a PDF, not as an error.
  const listed = await open(listUrl); await click(listUrl);
  const run = await rpc({type: 'capture.run', tabIds: [listed, current.tabId]});
  assert.deepEqual(run.report.results.map((item) => [item.status, item.count, item.warning, item.error]), [['success', 8, '', ''], ['pdf', 0, 'A PDF: capture it by itself with Capture this PDF.', '']]);
  await until(() => js(`!!document.querySelector('#capture-report .report-item.pdf')`), 'the report lists the PDF');
  assert.deepEqual(await js(`[...document.querySelectorAll('#capture-report .report-item.pdf > span')].map((part) => part.textContent)`), ['paper_final_v3.indd', 'PDF', 'A PDF: capture it by itself with Capture this PDF.']);
  pass('pdf-among-captured-tabs-is-not-an-error');

  // 14. 320 px and text contrast for the Capture section on a PDF's tab, light and dark.
  await show(paperUrl);
  await browser.send('Emulation.setDeviceMetricsOverride', {width: 320, height: 900, deviceScaleFactor: 1, mobile: false}, ui);
  await until(() => js(`innerWidth === 320`), '320 px');
  const overflow = () => js(`document.documentElement.scrollWidth > innerWidth && [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5 && e.getClientRects().length).slice(0, 8).map((e) => e.tagName.toLowerCase() + '#' + e.id + '.' + String(e.className?.baseVal ?? e.className))`);
  const contrast = (pairs) => js(`(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d', {willReadFrequently: true});
    const rgb = (color) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
    const lum = (c) => c.map((n) => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
    const bg = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(c) && !/\\/ 0\\)$/.test(c)) return c; } return getComputedStyle(document.body).backgroundColor; };
    return ${JSON.stringify([['preview', '#scope-preview span'], ['preview title', '#scope-preview strong'], ['capture label', '#capture-label'], ['region note', '#pdf-note'], ['report page', '#capture-report .report-item.pdf .page'], ['report status', '#capture-report .report-item.pdf .status'], ['report detail', '#capture-report .report-item.pdf .detail']])}
      .map(([name, selector]) => { const el = document.querySelector(selector); if (!el || !el.getClientRects().length) return {name, missing: true}; const a = lum(rgb(getComputedStyle(el).color)), b = lum(rgb(bg(el))); return {name, ratio: Math.round(((Math.max(a, b) + .05) / (Math.min(a, b) + .05)) * 100) / 100}; }); })()`);
  const themes = [];
  await js(`document.documentElement.style.setProperty('--ease', 'linear'); for (const sheet of document.styleSheets) { try { sheet.insertRule('* { transition: none !important; animation: none !important; }', sheet.cssRules.length); } catch { /* not ours */ } } true`);
  for (const theme of THEME_IDS) for (const scheme of ['light', 'dark']) {
    await rpc({type: 'state.mutate', action: {type: 'settings.update', patch: {theme, appearance: scheme}}});
    await until(() => js(`document.documentElement.dataset.theme === ${JSON.stringify(theme)} && document.documentElement.dataset.scheme === ${JSON.stringify(scheme)}`), `${theme} ${scheme} applied`);
    await until(async () => (await text('capture-label')) === 'Capture this PDF', 'still on the PDF’s tab');
    const measured = await contrast();
    for (const entry of measured) { assert.ok(!entry.missing, `${theme} ${scheme}: ${entry.name} missing`); assert.ok(entry.ratio >= 4.5, `${theme} ${scheme}: ${entry.name} contrast ${entry.ratio}`); }
    assert.equal(await overflow(), false, `${theme} ${scheme}: no overflow at 320 px`);
    themes.push({theme, scheme, lowest: measured.reduce((low, entry) => (entry.ratio < low.ratio ? entry : low))});
  }
  const {data: capturePng} = await browser.send('Page.captureScreenshot', {format: 'png'}, ui);
  await writeFile(resolve(evidence, 'pdf-tab-320-dark.png'), Buffer.from(capturePng, 'base64'));
  await rpc({type: 'state.mutate', action: {type: 'settings.update', patch: {theme: 'meteor', appearance: 'system'}}});
  pass('pdf-tab-320-and-contrast', {themes});

  // 15. Nothing was downloaded, and only the fixture server was asked.
  const saved = await readdir(resolve(browser.profile, 'home/Downloads')).catch(() => []);
  assert.deepEqual(saved, [], 'no file landed in Downloads');
  assert.ok(requests.length > 0 && requests.every((request) => /^(127\.0\.0\.1|localhost):\d+\//.test(request)), 'only the fixture server was asked');
  pass('pdf-tab-nothing-downloaded', {requests: requests.length});
  result.status = 'PASS';
} catch (error) {
  result.status = 'FAIL'; result.error = String(error?.stack || error); console.error(error); process.exitCode = 1;
} finally {
  await browser.close(); await fixture.close();
  result.finished = new Date().toISOString();
  await writeFile(resolve(evidence, 'pdf-tab-browser-results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(result.status, `${result.checks.length} checks`);
}
