// PDFs (0.6.0) in the real extension, with no grants: Chrome for Testing, headless, a fresh
// task-owned profile, the real unpacked build.
// The reader (src/ui/workbench/pdf-reader.js), inside Link Meteor's own page with its page rules:
// - PDF.js is not loaded until a PDF is read, then runs in a real module worker;
// - every fixture reads exactly as it does in Node with the same files (tests/pdf.test.mjs);
// - PDFs that can't be read are refused in plain words;
// - PDFs combine into one, in order, and the result reads back;
// - nothing breaks the page's content security policy.
// Import links, PDF file (src/ui/workbench/pdf.js), which needs no access of any kind:
// - a PDF through the real file chooser: its links previewed with their pages and words, what it
//   says about itself, what was left out; nothing added before Add N links; one batch marked
//   Imported with each link's page, the paper itself as a link with the PDF's citation, a link's
//   details, the PDF page export column, and Undo;
// - a PDF dropped on the Import links panel or on the list, and a drop anywhere else doing nothing;
// - PDFs with nothing to add, each in plain words: a password, damaged, not a PDF, too large, too
//   many pages, no links, no text; a PDF over the 20 MB that other files may have;
// - Cancel while a long PDF is read;
// - the keyboard alone, 320 px, labels, and text contrast in every theme, light and dark.
// On an older Chrome (LINK_METEOR_CHROME_PATH), the same checks prove the shims.
//   npm run build && node tests/pdf-browser.mjs
import assert from 'node:assert/strict';
import {mkdir, writeFile, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launch, rpc, until, evidence, root} from './helpers/browser.mjs';
import {fixture, readPdf, combinePdfs} from './helpers/pdf.mjs';
import {makePdf} from './fixtures/pdf/make.mjs';
import {THEME_IDS} from '../src/core/themes.js';
import {MAX_PDF_BYTES, MAX_PDF_PAGES} from '../src/core/pdf.js';

const profile = process.env.LINK_METEOR_TEST_PROFILE || `pdf-browser-${Date.now()}`;
const result = {started: new Date().toISOString(), profile, browser: 'Chrome for Testing via Playwright, headless, fresh profile, real unpacked extension, no optional grants', checks: [], screenshots: []};
const pass = (name, data = {}) => { result.checks.push({name, ...data}); console.log('PASS', name, Object.keys(data).length ? JSON.stringify(data) : ''); };
const plain = (value) => JSON.parse(JSON.stringify(value));
const base64 = async (name) => (await fixture(name)).toString('base64');
// PDFs this suite makes for itself; the large ones are not kept with the evidence.
const files = resolve(evidence, 'pdf-files');

let context;
try {
  await mkdir(evidence, {recursive: true});
  const run = await launch(profile, {headless: true});
  context = run.context;
  const ui = await context.newPage();
  const errors = []; ui.on('pageerror', (error) => errors.push(error.message));
  // Every file the page asks for, by its path inside the extension.
  const requested = []; ui.on('request', (request) => requested.push(request.url()));
  await ui.setViewportSize({width: 1440, height: 1000});
  // Without transitions, so colors are measured as they settle.
  await ui.emulateMedia({reducedMotion: 'reduce'});
  await ui.goto(`chrome-extension://${run.id}/ui/workbench.html`); await ui.locator('#collection-heading').waitFor();
  await ui.evaluate(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (event) => window.__csp.push(`${event.violatedDirective} ${event.blockedURI}`)); });
  result.chrome = await ui.evaluate(() => navigator.userAgent.match(/Chrome\/[\d.]+/)[0]);
  const native = await ui.evaluate(() => ({withResolvers: typeof Promise.withResolvers === 'function', streamIteration: !!ReadableStream.prototype[Symbol.asyncIterator]}));

  // In the page: read or combine PDFs handed over as base64, with the workbench's own reader.
  const inPage = (action, list, options = {}) => ui.evaluate(async ([action, list, options]) => {
    const reader = await import(chrome.runtime.getURL('ui/workbench/pdf-reader.js'));
    const bytes = list.map((text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0)));
    try {
      if (action === 'read') return {ok: await reader.readPdf(bytes[0], options)};
      const combined = await reader.combinePdfs(bytes);
      return {ok: {pages: combined.pages, counts: combined.counts, head: String.fromCharCode(...combined.bytes.subarray(0, 5)), size: combined.bytes.length, again: await reader.readPdf(combined.bytes)}};
    } catch (error) { return {refused: reader.pdfProblem(error), name: error?.name || ''}; }
  }, [action, list, options]);
  const loaded = () => [...new Set(requested.map((url) => url.replace(`chrome-extension://${run.id}/`, '')).filter((path) => /pdf/.test(path)))].sort();

  // 1. Lazy: the workbench opened with only its own PDF module (what the person sees), without the
  // reader, the PDF rules or PDF.js.
  assert.ok(requested.some((url) => url.endsWith('/ui/workbench.js')), 'the page’s own files are seen');
  assert.deepEqual(loaded(), ['ui/workbench/pdf.js'], 'PDF.js is not loaded until a PDF is read');
  assert.equal(ui.workers().length, 0);
  pass('pdf-reader-not-loaded-until-used', {chrome: result.chrome, native});

  // 2. Every fixture reads as it does in Node with the same files.
  const names = ['paper.pdf', 'journal.pdf', 'notes.pdf', 'no-links.pdf', 'empty.pdf'];
  const counts = {};
  for (const name of names) {
    const options = name === 'paper.pdf' ? {address: 'https://arxiv.org/pdf/2409.11211v1#page=2'} : {};
    const here = await inPage('read', [await base64(name)], options);
    assert.deepEqual(here.ok, plain(await readPdf(await fixture(name), options)), `${name} reads the same in the extension as in Node`);
    counts[name] = `${here.ok.links.length} links, ${here.ok.pageCount} pages`;
  }
  const paper = (await inPage('read', [await base64('paper.pdf')])).ok;
  assert.equal(paper.links.length, 15); assert.equal(paper.internal, 1); assert.equal(paper.citation.arxiv, '2409.11211');
  pass('pdf-reader-reads-fixtures-as-node-does', counts);

  // 3. A real module worker did the work, from the bundled file, and the shims loaded first.
  assert.deepEqual(loaded().filter((path) => !path.includes('worker')), ['core/pdf.js', 'ui/workbench/pdf-reader.js', 'ui/workbench/pdf-shims.js', 'ui/workbench/pdf.js', 'ui/workbench/pdfjs.js', 'vendor/pdfjs/pdf.min.mjs'], 'the reader, its shims and PDF.js, from inside the extension');
  const workers = ui.workers().map((worker) => worker.url().replace(`chrome-extension://${run.id}/`, ''));
  assert.deepEqual(workers, ['ui/workbench/pdfjs-worker.js'], 'one worker, kept for later PDFs');
  pass('pdf-reader-runs-in-one-module-worker', {workers});

  // 4. PDFs that can't be read are refused in plain words.
  const refusals = {};
  for (const [name, words] of [['password.pdf', 'This PDF needs a password. Link Meteor doesn’t ask for passwords.'], ['damaged.pdf', 'This PDF is damaged, or it isn’t a PDF, so it couldn’t be read.'], ['not-a-pdf.pdf', 'This file isn’t a PDF.']]) {
    const here = await inPage('read', [await base64(name)]);
    assert.equal(here.refused, words, name); refusals[name] = here.refused;
  }
  pass('pdf-reader-refuses-in-plain-words', refusals);

  // 5. Combining: every page in order, and the result reads back the same as in Node.
  const parts = ['paper.pdf', 'journal.pdf', 'notes.pdf'];
  const combined = await inPage('combine', await Promise.all(parts.map(base64)));
  assert.deepEqual([combined.ok.pages, combined.ok.counts, combined.ok.head], [7, [3, 2, 2], '%PDF-']);
  const expected = plain(await readPdf((await combinePdfs(await Promise.all(parts.map(fixture)))).bytes));
  assert.deepEqual(combined.ok.again.links, expected.links, 'the combined PDF holds every link, on its new page');
  assert.equal(combined.ok.again.pageCount, 7);
  const locked = await inPage('combine', [await base64('paper.pdf'), await base64('password.pdf')]);
  assert.equal(locked.refused, 'This PDF needs a password. Link Meteor doesn’t ask for passwords.');
  pass('pdf-reader-combines-in-order', {pages: combined.ok.pages, bytes: combined.ok.size, links: combined.ok.again.links.length});

  /* Import links, PDF file ------------------------------------------------------------------------ */
  await until(() => ui.evaluate(() => document.title.endsWith(' · Link Meteor')), 'collections loaded', 30000);
  if (await ui.locator('#welcome-close').isVisible()) await ui.locator('#welcome-close').click();
  await mkdir(files, {recursive: true});
  // File choosers are handed to this suite from here on, so a chooser opened by a key press is
  // never a real dialog that no one answers.
  ui.on('filechooser', () => {});
  const text = (selector) => ui.locator(selector).innerText();
  const state = () => rpc(ui, {type: 'state.get'});
  const active = async () => { const all = await state(); return all.collections.find((item) => item.id === all.activeCollectionId); };
  const notice = (phrase, timeout = 15000) => until(async () => (await ui.locator('#notice').isVisible()) && (await text('#notice .msg')).includes(phrase), `Notice: ${phrase}`, timeout);
  const failure = async (phrase, timeout = 30000) => {
    await until(async () => (await ui.locator('#error').isVisible()) && (await text('#error .msg')) === phrase, `Error: ${phrase}`, timeout).catch(async (error) => { error.message += `; shown: ${await ui.locator('#error').isVisible() ? await text('#error .msg') : '(none)'}`; throw error; });
    await ui.locator('#error button', {hasText: 'Dismiss'}).click();
  };
  const tableRows = () => ui.evaluate(() => [...document.querySelectorAll('#import-table tbody tr')].map((row) => [...row.cells].map((cell) => cell.textContent)));
  const facts = () => ui.evaluate(() => [...document.querySelectorAll('#pdf-facts dt')].map((dt) => [dt.textContent, ...[...dt.nextElementSibling.children].map((part) => part.textContent)]));
  const summary = async () => [await text('#import-summary-main'), await text('#import-summary-skips')];
  const pdfPath = (name) => resolve(root, 'tests/fixtures/pdf', name);
  async function choose(path) {
    const [chooser] = await Promise.all([ui.waitForEvent('filechooser'), ui.locator('label[for=import-file]').click()]);
    await chooser.setFiles(path);
  }
  async function preview(path, timeout = 30000) {
    await choose(path);
    try { await until(() => ui.locator('#import-plan').isVisible(), `preview of ${path}`, timeout); } catch (error) {
      if (await ui.locator('#error').isVisible()) error.message += `; the workbench said: ${await text('#error')}`;
      throw error;
    }
  }
  // A file dragged over and dropped on an element, as the browser reports it: real DragEvents with a
  // DataTransfer that holds the files.
  const drop = (selector, list) => ui.evaluate(([selector, list]) => {
    const data = new DataTransfer();
    for (const [name, type, base64] of list) data.items.add(new File([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], name, {type}));
    const target = document.querySelector(selector);
    const fire = (type) => { const event = new DragEvent(type, {dataTransfer: data, bubbles: true, cancelable: true}); target.dispatchEvent(event); return event.defaultPrevented; };
    fire('dragenter');
    const taken = fire('dragover');
    const marked = [...document.querySelectorAll('.is-drop')].map((element) => element.id);
    const kept = fire('drop');
    return {taken, kept, marked, left: document.querySelectorAll('.is-drop').length};
  }, [selector, list]);
  const overflow = () => ui.evaluate(() => document.documentElement.scrollWidth > innerWidth
    && [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5 && e.getClientRects().length && !e.closest('.table-scroll'))
      .slice(0, 8).map((e) => `${e.tagName.toLowerCase()}#${e.id}.${String(e.className?.baseVal ?? e.className)}`));
  const unlabeled = () => ui.evaluate(() => [...document.querySelectorAll('#import input, #import select, #import textarea, #import button, #import-panel input, #import-panel button')]
    .filter((e) => e.getClientRects().length && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby') && !e.labels?.length && !(e.tagName === 'BUTTON' && e.textContent.trim())).map((e) => e.id || e.outerHTML.slice(0, 80)));
  const shot = async (name) => {
    await ui.evaluate(() => { for (const id of ['error', 'notice']) document.getElementById(id).hidden = true; });
    await ui.screenshot({path: resolve(evidence, name), animations: 'disabled'}); result.screenshots.push(name);
  };

  // 6. A PDF through the file chooser: previewed, and nothing added before Add.
  assert.match(await ui.locator('#import-file').getAttribute('accept'), /(^|,)\.pdf,application\/pdf,/);
  assert.equal(await text('#import-panel-help'), 'From a spreadsheet, a list, a PDF, a web page or bookmarks file, pasted text or a bookmark folder. You see what will be added before anything is. Files are read in this browser and never uploaded.');
  assert.equal(await text('#import-drop-hint'), 'Or drop a file here: a PDF’s links are read with their page numbers.');
  const before = await state();
  const node = plain(await readPdf(await fixture('paper.pdf')));
  await preview(pdfPath('paper.pdf'));
  assert.deepEqual([await text('#import-title'), await text('#import-source')], ['Links in this PDF', 'paper.pdf · 3 pages · from a file']);
  assert.deepEqual(await facts(), [['arXiv', 'arXiv:2409.11211v1 · cs.CV · 17 Sep 2024', 'from the stamp on page 1'], ['DOI', '10.5555/fixture.2026.001', 'from page 1'],
    ['Title', 'A Small Paper About Links', 'from the first page’s largest text'], ['Authors', 'None read', 'PDFs rarely name them reliably. Look up details can fill them in.']]);
  assert.deepEqual(await ui.evaluate(() => [...document.querySelectorAll('#import-table thead th')].map((cell) => cell.textContent)), ['Page', 'Anchor text', 'Address', 'Left out because']);
  assert.deepEqual(await tableRows(), node.links.map((link) => [`p. ${link.pdfPage}`, link.anchorText || '(no words: a picture)', link.url, '']));
  assert.equal(await text('#import-table-note'), 'All 15 links.');
  assert.deepEqual(await summary(), ['Adds 15 links from 3 of 3 pages, marked Imported, and the paper’s arXiv page as a link.',
    'Left out: 1 link to a place inside the PDF, 2 that aren’t web, email or phone addresses. 1 link is on a picture and has no words; its anchor text stays empty. You can undo this.']);
  assert.deepEqual([await text('#import-commit'), await ui.locator('#pdf-self').isChecked(), await text('#pdf-self-label'), await ui.locator('#import-destination option:checked').innerText()],
    ['Add 15 links', true, 'Also save this paper as a link (its arXiv page), with what the PDF says about itself', 'My research']);
  assert.deepEqual([await ui.locator('#import-map').isVisible(), await ui.locator('#import-options').isVisible(), await ui.locator('section.capture').isVisible(), await ui.locator('#review').isVisible()], [false, false, false, false], 'a PDF has no columns to map');
  await ui.locator('#import-only-skipped').check();
  assert.equal(await text('label:has(#import-only-skipped)'), 'Show what was left out');
  assert.deepEqual(await tableRows(), [['', '1 link to a place inside the PDF', 'No address'], ['p. 1', '(not read)', '', 'Not a web, email or phone address'], ['p. 1', '(not read)', '', 'Not a web, email or phone address']]);
  await ui.locator('#import-only-skipped').uncheck();
  assert.deepEqual(await state(), before, 'nothing is added before Add');
  pass('pdf-file-previews-its-links', {summary: await summary()});
  await shot('pdf-file-full-meteor-light.png');

  // 7. Add: one batch, marked Imported with each link's page; the paper itself as a link, with what
  // the PDF says about itself as its citation. Then a link's details, the export column, and Undo.
  await ui.locator('#import-commit').click();
  await notice('Added 15 links and the paper’s arXiv page to “My research”.');
  let home = await active();
  const title = 'A Small Paper About Links', abs = 'https://arxiv.org/abs/2409.11211';
  assert.deepEqual(home.links.map((link) => [link.anchorText, link.url, link.originalHref, link.pdfPage, link.context, link.imported, link.sourceUrl, link.sourceTitle]),
    [[title, abs, abs, undefined, undefined, 'paper.pdf', '', ''], ...node.links.map((link) => [link.anchorText, link.url, link.originalHref, link.pdfPage, link.context, `paper.pdf, page ${link.pdfPage}`, '', ''])]);
  assert.equal(home.links[1].anchorText, '', 'a link on a picture keeps empty anchor text');
  assert.equal(new Set(home.links.map((link) => link.batchId)).size, 1, 'one batch');
  const {readAt, ...cited} = home.pages[abs];
  assert.deepEqual(cited, {arxiv: '2409.11211', arxivVersion: 'v1', arxivCategory: 'cs.CV', date: '17 Sep 2024', doi: '10.5555/fixture.2026.001', title, source: 'pdf'});
  assert.ok(Date.now() - Date.parse(readAt) < 120000);
  await until(async () => (await ui.locator('.link-row').count()) === 16, 'the links are listed');
  assert.equal(await ui.locator('.link-row .badge.imported').count(), 16, 'rows show Imported');
  const row = (index) => ui.locator('.link-row').nth(index);
  await row(2).locator('summary').click();
  assert.equal(await row(2).locator('.pdf-page').innerText(), 'Page 1 of the PDF');
  assert.equal(await row(2).locator('[aria-label="Imported from"] .imported-from').innerText(), 'paper.pdf, page 1');
  await row(0).locator('summary').click();
  assert.equal(await row(0).locator('.pdf-page').count(), 0, 'the paper itself is on no page');
  assert.deepEqual([await row(0).locator('[aria-label="Citation"] .cited-title').innerText(), await row(0).locator('[aria-label="Citation"] .cited-note').innerText()],
    [title, 'Read from the PDF itself. Citation exports use it. Saved in this browser; nothing was looked up online.']);
  assert.ok((await ui.locator('#add-column option').allInnerTexts()).includes('PDF page'), 'PDF page is a choosable export column');
  await ui.locator('#notice button', {hasText: 'Undo'}).click();
  await notice('Undone: removed 16 links.');
  assert.deepEqual((await state()).collections.map((item) => item.links), before.collections.map((item) => item.links), 'Undo removes every link it added');
  pass('pdf-file-adds-one-batch-and-undoes-it', {links: home.links.length, citation: cited});

  // 8. Dropped files: on the Import links panel, on the list, and anywhere else.
  const dropped = async (name, type = 'application/pdf') => [name, type, await base64(name)];
  let dropping = await drop('#import-panel', [await dropped('journal.pdf')]);
  assert.deepEqual(dropping, {taken: true, kept: true, marked: ['import-panel'], left: 0}, 'the panel shows it will take the file, and the browser does not open it');
  await until(() => ui.locator('#import-plan').isVisible(), 'the dropped PDF previewed');
  assert.equal(await text('#import-source'), 'journal.pdf · 2 pages · from a file');
  assert.deepEqual(await facts(), [['DOI', '10.5555/journal.2026.042', 'from the PDF’s own details'], ['Title', 'A Study of Things That Link', 'from the PDF’s own details'],
    ['Authors', 'Ada Example; Ben Sample', 'from the PDF’s own details, and printed on page 1'], ['Journal', 'Journal of Fixture Studies · 2026-03-14', 'from the PDF’s own details']]);
  assert.deepEqual([await summary(), await text('#pdf-self-label')], [['Adds 2 links from 2 of 2 pages, marked Imported, and the paper’s DOI address as a link.', 'You can undo this.'], 'Also save this paper as a link (its DOI address), with what the PDF says about itself']);
  assert.equal(await ui.locator('label:has(#import-only-skipped)').isVisible(), false, 'nothing was left out, so there is nothing to show');
  await ui.locator('#import-commit').click();
  await notice('Added 2 links and the paper’s DOI address to “My research”.');
  home = await active();
  assert.deepEqual(home.links.map((link) => [link.url, link.imported]), [['https://doi.org/10.5555/journal.2026.042', 'journal.pdf'], ['https://archive.example.org/study', 'journal.pdf, page 1'], ['https://archive.example.org/study/tables.csv', 'journal.pdf, page 2']]);
  assert.deepEqual(home.pages['https://doi.org/10.5555/journal.2026.042'].authors, ['Ada Example', 'Ben Sample']);
  // The same file again, onto the list: every link is already saved there, and so is the paper.
  dropping = await drop('#link-list', [await dropped('journal.pdf')]);
  assert.deepEqual(dropping.marked, ['main']);
  await until(() => ui.locator('#import-plan').isVisible(), 'the PDF dropped on the list previewed');
  assert.deepEqual(await summary(), ['Nothing to add.', 'Every link in this PDF is already saved there. Untick “Skip links already saved there” to add them again. Left out: 2 already saved there.']);
  assert.deepEqual([await ui.locator('#pdf-self').isChecked(), await ui.locator('#pdf-self').isDisabled(), await ui.locator('#import-commit').isDisabled()], [false, true, true]);
  await ui.locator('#import-skip-saved').uncheck();
  assert.deepEqual([(await summary())[0], await ui.locator('#pdf-self').isChecked(), await ui.locator('#pdf-self').isDisabled()], ['Adds 2 links from 2 of 2 pages, marked Imported.', false, false], 'the paper is not added twice unless the person says so');
  // Another destination: a new collection named after the file, where the paper isn't saved yet.
  await ui.locator('#import-destination').selectOption('new');
  assert.deepEqual([await ui.locator('#import-destination option:checked').innerText(), await ui.locator('#pdf-self').isChecked(), await ui.locator('#import-skip-saved').isDisabled()], ['A new collection “journal”', true, true]);
  await ui.keyboard.press('Escape');
  await notice('Canceled. Nothing was added.');
  // Anywhere else, a dropped file does nothing: no preview, no error, and the view is not replaced.
  dropping = await drop('#export-panel', [await dropped('journal.pdf')]);
  assert.deepEqual(dropping, {taken: true, kept: true, marked: [], left: 0}, 'no place is marked, and the browser does not open the file');
  await ui.waitForTimeout(400);
  assert.deepEqual([await ui.locator('#import').isVisible(), await ui.locator('#error').isVisible(), new URL(ui.url()).pathname], [false, false, '/ui/workbench.html']);
  await drop('#import-panel', [await dropped('journal.pdf'), await dropped('notes.pdf')]);
  await failure('Drop one file at a time. Nothing was imported.');
  // Other kinds of file can be dropped too, and get the usual import preview.
  await drop('#import-panel', [['two.csv', 'text/csv', Buffer.from('Title,URL\nOne,https://one.example/\nTwo,https://two.example/\n').toString('base64')]]);
  await until(() => ui.locator('#import-plan').isVisible(), 'the dropped CSV previewed');
  assert.deepEqual([await text('#import-title'), await text('#import-source'), await ui.locator('#import-map').isVisible(), await ui.locator('#pdf-facts').isVisible(), await text('label:has(#import-only-skipped) span')],
    ['Import links', 'From two.csv · 2 rows · columns: Title, URL', true, false, 'Show only skipped rows'], 'after a PDF, the view is the usual one again');
  await ui.locator('#import-cancel').click();
  await rpc(ui, {type: 'state.mutate', action: {type: 'links.remove', ids: home.links.map((link) => link.id)}});
  pass('pdf-file-dropped-on-the-panel-or-the-list', {marked: dropping.marked});

  // 9. Nothing to add, each in plain words.
  const made = async (name, bytes) => { const path = resolve(files, name); await writeFile(path, bytes); return path; };
  const mb = (bytes) => bytes / 1024 / 1024;
  for (const [path, words] of [
    [pdfPath('password.pdf'), 'This PDF needs a password. Link Meteor doesn’t ask for passwords. Nothing was added.'],
    [pdfPath('damaged.pdf'), 'This PDF is damaged, or it isn’t a PDF, so it couldn’t be read. Nothing was added.'],
    [pdfPath('not-a-pdf.pdf'), 'This file isn’t a PDF. Nothing was added.'],
    [await made('too-many-pages.pdf', makePdf({pages: Array.from({length: MAX_PDF_PAGES + 1}, () => [])})), 'This PDF has 2,001 pages. Link Meteor reads PDFs of up to 2,000 pages. Nothing was added.'],
    [await made('too-large.pdf', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(MAX_PDF_BYTES)])), `too-large.pdf is larger than ${mb(MAX_PDF_BYTES)} MB, the most Link Meteor reads. Nothing was added.`],
  ]) {
    await choose(path);
    await failure(words);
    assert.equal(await ui.locator('#import').isVisible(), false, `${path}: the view closes`);
  }
  // No links, and no text at all (a scan). A file names no address of its own, so there is nothing to add.
  for (const [name, said] of [['no-links.pdf', [['Title', 'Words Without Links', 'from the first page’s largest text'], ['Authors', 'None read', 'PDFs rarely name them reliably.']]], ['empty.pdf', []]]) {
    await preview(pdfPath(name));
    assert.deepEqual(await summary(), ['Nothing to add.', 'This PDF has no links Link Meteor can read. Scanned pages are pictures, and addresses printed without a link aren’t picked up.'], name);
    assert.deepEqual([await facts(), await ui.locator('#pdf-facts').isVisible(), await ui.locator('#pdf-self-row').isVisible(), await ui.locator('#import-commit').isDisabled(), await text('#import-commit')], [said, said.length > 0, false, true, 'Add links'], name);
    await ui.locator('#import-cancel').click();
  }
  // A PDF may be larger than the 20 MB other files may have, and a PDF whose name doesn't say so is still read as one.
  const large = await made('large.pdf', makePdf({info: {Title: 'Large', Padding: 'x'.repeat(21 * 1024 * 1024)}, pages: [[{parts: ['See ', {text: 'this', url: 'https://large.example/'}, ' for more of the same.']}]]}));
  await preview(large, 60000);
  assert.deepEqual([await text('#import-source'), await tableRows()], ['large.pdf · 1 page · from a file', [['p. 1', 'this', 'https://large.example/', '']]]);
  await ui.locator('#import-cancel').click();
  await preview(await made('paper-without-the-ending', await fixture('paper.pdf')));
  assert.deepEqual([await text('#import-source'), await text('#import-table-note')], ['paper-without-the-ending · 3 pages · from a file', 'All 15 links.']);
  await ui.locator('#import-cancel').click();
  pass('pdf-file-nothing-to-add-in-plain-words', {largeBytes: MAX_PDF_BYTES});

  // 10. Cancel while a long PDF is read: the counter shows, Cancel stops it, and nothing comes later.
  const pagesToRead = 1500;
  const long = await made('long.pdf', makePdf({pages: Array.from({length: pagesToRead}, (_, i) => [{parts: [`Page ${i + 1}: `, {text: 'a link', url: `https://long.example/page-${i + 1}`}]}])}));
  await ui.evaluate(() => {
    window.__progress = [];
    const line = document.getElementById('import-progress');
    window.__watch = new MutationObserver(() => {
      if (line.hidden || !line.textContent) return;
      window.__progress.push({text: line.textContent, role: line.getAttribute('role'), cancel: document.getElementById('import-cancel').getClientRects().length > 0});
      // The first page counter: press Cancel, as a person would while it counts.
      if (/^Reading page /.test(line.textContent) && !window.__canceled) { window.__canceled = true; document.getElementById('import-cancel').click(); }
    });
    window.__watch.observe(line, {childList: true, characterData: true, subtree: true, attributes: true});
  });
  const untouched = await state();
  await choose(long);
  await notice('Canceled. Nothing was added.');
  await ui.waitForTimeout(1500);
  const counted = await ui.evaluate(() => { window.__watch.disconnect(); return window.__progress; });
  assert.deepEqual(counted[0], {text: 'Reading long.pdf…', role: 'status', cancel: true});
  assert.match(counted.at(-1).text, /^Reading page [\d,]+ of 1,500…$/);
  assert.ok(counted.every((entry) => entry.role === 'status' && entry.cancel), 'the counter is a status, and Cancel is there the whole time');
  assert.deepEqual([await ui.locator('#import').isVisible(), await ui.locator('#error').isVisible()], [false, false], 'no preview arrives after Cancel, and no error');
  assert.deepEqual(await state(), untouched);
  // The reader is still there for the next PDF, which reads in full.
  await preview(long, 60000);
  assert.deepEqual([await text('#import-source'), await text('#import-table-note'), (await summary())[0]], ['long.pdf · 1,500 pages · from a file', 'Showing the first 100 of 1,500 links.', 'Adds 1,500 links from 1,500 of 1,500 pages, marked Imported.']);
  await ui.locator('#import-cancel').click();
  pass('pdf-file-cancel-while-reading', {counter: counted.at(-1).text});

  // 11. The keyboard alone: choose a file, move through the preview, change a choice, add, undo.
  await ui.locator('#import-file').focus();
  const [byKey] = await Promise.all([ui.waitForEvent('filechooser'), ui.keyboard.press('Enter')]);
  await byKey.setFiles(pdfPath('paper.pdf'));
  await until(() => ui.locator('#import-plan').isVisible(), 'preview by keyboard');
  assert.equal(await ui.evaluate(() => document.activeElement.id), 'import-title', 'focus moves to the preview’s heading');
  const stops = [];
  for (let i = 0; i < 12 && stops.at(-1) !== 'import-cancel'; i++) { await ui.keyboard.press('Tab'); stops.push(await ui.evaluate(() => document.activeElement.id || document.activeElement.className)); }
  assert.deepEqual(stops, ['table-scroll', 'import-only-skipped', 'import-destination', 'import-skip-saved', 'pdf-self', 'import-commit', 'import-cancel']);
  assert.ok(await ui.evaluate(() => { const outline = getComputedStyle(document.activeElement).outlineStyle; return outline !== 'none'; }), 'focus is visible');
  await ui.locator('#pdf-self').focus(); await ui.keyboard.press('Space');
  assert.deepEqual([await ui.locator('#pdf-self').isChecked(), (await summary())[0]], [false, 'Adds 15 links from 3 of 3 pages, marked Imported.']);
  await ui.keyboard.press('Tab'); await ui.keyboard.press('Enter');
  await notice('Added 15 links to “My research”.');
  assert.equal(await ui.evaluate(() => document.activeElement.id), 'import-file', 'focus goes back to Choose a file…');
  home = await active();
  assert.deepEqual([home.links.length, home.links[0].imported, home.links[0].pdfPage], [15, 'paper.pdf, page 1', 1], 'the links alone, without the paper itself');
  await ui.locator('#notice button', {hasText: 'Undo'}).focus(); await ui.keyboard.press('Enter');
  await notice('Undone: removed 15 links.');
  await ui.locator('#import-file').focus();
  const [again] = await Promise.all([ui.waitForEvent('filechooser'), ui.keyboard.press('Enter')]);
  await again.setFiles(pdfPath('paper.pdf'));
  await until(() => ui.locator('#import-plan').isVisible(), 'preview again');
  await ui.keyboard.press('Escape');
  await notice('Canceled. Nothing was added.');
  assert.equal(await ui.evaluate(() => document.activeElement.id), 'import-file');
  pass('pdf-file-by-keyboard', {stops});

  // 12. 320 px, labels, and text contrast in every theme, light and dark: the preview with what was
  // left out, the drop hint, and the line in About and help.
  await rpc(ui, {type: 'state.mutate', action: {type: 'links.append', links: [{id: 'seed-1', anchorText: 'Code', accessibleLabel: '', url: 'https://example.org/code', originalHref: '', sourceUrl: 'https://review.example/', sourceTitle: 'Review', frameUrl: '', capturedAt: '2026-10-01T12:00:00.000Z', batchId: 'seed', notes: '', tags: []}]}});
  await preview(pdfPath('paper.pdf'));
  // The preview follows what is saved: the link added just now is counted as already saved there.
  await until(async () => (await summary())[0] === 'Adds 13 links from 3 of 3 pages, marked Imported, and the paper’s arXiv page as a link.', 'the preview follows the saved links');
  await ui.setViewportSize({width: 320, height: 900});
  await ui.waitForFunction(() => innerWidth === 320);
  assert.equal(await overflow(), false, 'no horizontal overflow at 320 px (the table scrolls inside its box)');
  assert.deepEqual(await unlabeled(), [], 'every control in the preview has a label');
  assert.equal(await ui.locator('#pdf-facts').getAttribute('aria-label'), 'What the PDF says about itself');
  await ui.evaluate(() => document.getElementById('import').scrollIntoView());
  await shot('pdf-file-320-meteor-light.png');
  const pairs = [['heading', '#import-title'], ['source line', '.import .source-line'], ['file name', '.import .source-line .file'], ['fact name', '#pdf-facts dt'], ['fact', '#pdf-facts .pdf-fact'], ['where a fact was read', '#pdf-facts .pdf-how'],
    ['table heading', '#import-table th'], ['page', '#import-table tbody tr:not(.skip) td.num'], ['no words', '#import-table tr:not(.skip) td.empty-text'], ['anchor text', '#import-table tbody tr:nth-child(3) td:nth-child(2)'], ['address', '#import-table tr:not(.skip) td.url'],
    ['saved link', '#import-table tr.skip td:nth-child(2)'], ['saved reason', '#import-table tr.skip td.why'], ['table note', '#import-table-note'], ['left out label', '#import-only-skipped-label'], ['destination label', '.import-row label'],
    ['skip saved label', '.import-row .name-check span'], ['the PDF itself', '#pdf-self-label'], ['summary', '#import-summary-main'], ['summary skips', '#import-summary-skips'], ['commit', '#import-commit'], ['cancel', '#import-cancel']];
  const leftOutPairs = [['counted', '#import-table tr.counted td:nth-child(2)'], ['counted reason', '#import-table tr.counted td.why'], ['not read', '#import-table tr.skip td.empty-text'], ['not read reason', '#import-table tr.skip:not(.counted) td.why'], ['table note', '#import-table-note']];
  const railPairs = [['drop hint', '#import-drop-hint span'], ['about PDF.js', '#about-pdfjs']];
  const contrast = (list) => ui.evaluate((pairs) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d', {willReadFrequently: true});
    const rgb = (color) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
    const lum = (c) => c.map((n) => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
    const bg = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c) && !/\/ 0\)$/.test(c)) return c; } return getComputedStyle(document.body).backgroundColor; };
    return pairs.map(([name, selector]) => { const el = document.querySelector(selector); if (!el || !el.getClientRects().length) return {name, missing: true}; const a = lum(rgb(getComputedStyle(el).color)), b = lum(rgb(bg(el))); return {name, ratio: Math.round(((Math.max(a, b) + .05) / (Math.min(a, b) + .05)) * 100) / 100}; });
  }, list);
  await ui.evaluate(() => { document.getElementById('about-panel').open = true; });
  assert.equal(await ui.locator('#about-pdfjs').textContent(), 'Reads PDFs with PDF.js by Mozilla (Apache License 2.0), which is part of Link Meteor. PDFs are read in this browser and never uploaded.');
  const themes = [];
  const measure = async (list, what) => {
    const measured = await contrast(list);
    for (const entry of measured) { assert.ok(!entry.missing, `${what}: ${entry.name} missing`); assert.ok(entry.ratio >= 4.5, `${what}: ${entry.name} contrast ${entry.ratio}`); }
    assert.equal(await overflow(), false, `${what}: overflow at 320 px`);
    return measured;
  };
  for (const theme of THEME_IDS) for (const scheme of ['light', 'dark']) {
    await rpc(ui, {type: 'state.mutate', action: {type: 'settings.update', patch: {theme, appearance: scheme}}});
    await until(() => ui.evaluate(([theme, scheme]) => document.documentElement.dataset.theme === theme && document.documentElement.dataset.scheme === scheme, [theme, scheme]), `${theme} ${scheme} applied`);
    await until(() => ui.evaluate(() => !document.getAnimations().some((animation) => animation.playState === 'running' || animation.playState === 'pending')), `${theme} ${scheme} settled`);
    const measured = await measure(pairs, `${theme} ${scheme}`);
    await ui.locator('#import-only-skipped').check();
    measured.push(...await measure(leftOutPairs, `${theme} ${scheme}, what was left out`));
    await ui.locator('#import-only-skipped').uncheck();
    // The rail, where the drop hint and About and help are.
    await ui.locator('#collection-switch').click();
    measured.push(...await measure(railPairs, `${theme} ${scheme}, the rail`));
    await ui.locator('#rail-done').click();
    themes.push({theme, scheme, lowest: measured.reduce((low, entry) => (entry.ratio < low.ratio ? entry : low))});
  }
  await rpc(ui, {type: 'state.mutate', action: {type: 'settings.update', patch: {theme: 'nebula', appearance: 'dark'}}});
  await until(() => ui.evaluate(() => document.documentElement.dataset.theme === 'nebula'), 'nebula dark applied');
  await ui.setViewportSize({width: 400, height: 1300});
  await ui.evaluate(() => document.getElementById('import').scrollIntoView());
  await shot('pdf-file-panel-nebula-dark.png');
  await rpc(ui, {type: 'state.mutate', action: {type: 'settings.update', patch: {theme: 'meteor', appearance: 'system'}}});
  await ui.locator('#import-cancel').click();
  await ui.setViewportSize({width: 1440, height: 1000});
  pass('pdf-file-320-labels-and-contrast', {themes});

  // 13. Nothing broke the page's rules, and nothing was requested from anywhere: a PDF is read in
  // the browser and never uploaded.
  assert.deepEqual(await ui.evaluate(() => window.__csp), [], 'no content security policy violation');
  assert.deepEqual(errors, [], 'no page errors');
  assert.deepEqual(requested.filter((url) => !/^(chrome-extension|blob|data):/.test(url) || (url.startsWith('chrome-extension://') && !url.startsWith(`chrome-extension://${run.id}/`))), [], 'everything loaded from inside the extension');
  assert.deepEqual(ui.workers().map((worker) => worker.url().replace(`chrome-extension://${run.id}/`, '')).filter((path) => /pdf/.test(path)), ['ui/workbench/pdfjs-worker.js'], 'still one PDF worker');
  pass('pdf-reader-keeps-the-page-rules');
  result.status = 'PASS';
} catch (error) {
  result.status = 'FAIL'; result.error = String(error?.stack || error); console.error(error); process.exitCode = 1;
} finally {
  await context?.close();
  await rm(files, {recursive: true, force: true});
  result.finished = new Date().toISOString();
  await writeFile(resolve(evidence, 'pdf-browser-results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(result.status, `${result.checks.length} checks`);
}
