// Getting a PDF's file through a tab (0.6.0, src/ui/workbench/pdf-tab.js), with nothing but the
// toolbar's temporary access: Chrome for Testing, headless, a fresh temporary profile, the real
// unpacked extension, and Chrome's real toolbar action (DevTools Extensions.triggerAction).
// - A PDF shown in a tab is read from that tab, with or without ".pdf" in its address, and reads
//   exactly as the same file does in Node.
// - A page that lists PDFs hands over the ones on its own site, including one the site sends as
//   a download; a PDF on another site, or one that moves there, can't be had from that page.
// - A sign-in page where a PDF was expected, a tab without access and a PDF opened from the
//   computer are each refused in plain words.
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
  const open = async (url) => {
    const before = new Set(await browser.evaluate(ui, `chrome.tabs.query({}).then((tabs) => tabs.map((tab) => tab.id))`));
    await browser.newTab(url); await sleep(1800);
    const ids = await browser.evaluate(ui, `chrome.tabs.query({}).then((tabs) => tabs.map((tab) => tab.id))`);
    const fresh = ids.filter((id) => !before.has(id));
    assert.equal(fresh.length, 1, `one new tab for ${url}`);
    return fresh[0];
  };
  const click = async (prefix) => { assert.equal(await browser.clickAction(prefix), 'clicked'); await sleep(800); };

  // 1. A PDF shown in a tab: no access before the toolbar click, then read as Node reads the file.
  const paper = await pdfFixture('paper.pdf');
  const shown = `${fixture.base}/pdf/paper.pdf`;
  const pdfTab = await open(shown);
  assert.deepEqual(await read(pdfTab), {refused: 'Link Meteor has no access to that page.', reason: 'access'});
  await click(shown);
  const fromTab = await read(pdfTab);
  const {bytes: _bytes, ...expected} = {...(await readPdf(paper, {address: shown})), address: shown, size: paper.length, sha256: sha256(paper)};
  assert.deepEqual(fromTab, plain(expected), 'the PDF in the tab reads exactly as the file does');
  assert.equal(fromTab.citation.pdfUrl, shown);
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

  // 6. Nothing was downloaded, and only the fixture server was asked.
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
