// PDFs (0.6.0) in the real extension, with no grants: Chrome for Testing, headless, a fresh
// task-owned profile, the real unpacked build.
// The reader (src/ui/workbench/pdf-reader.js), inside Link Meteor's own page with its page rules:
// - PDF.js is not loaded until a PDF is read, then runs in a real module worker;
// - every fixture reads exactly as it does in Node with the same files (tests/pdf.test.mjs);
// - PDFs that can't be read are refused in plain words;
// - PDFs combine into one, in order, and the result reads back;
// - nothing breaks the page's content security policy.
// On an older Chrome (LINK_METEOR_CHROME_PATH), the same checks prove the shims.
//   npm run build && node tests/pdf-browser.mjs
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launch, evidence} from './helpers/browser.mjs';
import {fixture, readPdf, combinePdfs} from './helpers/pdf.mjs';

const profile = process.env.LINK_METEOR_TEST_PROFILE || `pdf-browser-${Date.now()}`;
const result = {started: new Date().toISOString(), profile, browser: 'Chrome for Testing via Playwright, headless, fresh profile, real unpacked extension, no optional grants', checks: [], screenshots: []};
const pass = (name, data = {}) => { result.checks.push({name, ...data}); console.log('PASS', name, Object.keys(data).length ? JSON.stringify(data) : ''); };
const plain = (value) => JSON.parse(JSON.stringify(value));
const base64 = async (name) => (await fixture(name)).toString('base64');

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

  // 1. Lazy: the workbench opened without the reader.
  assert.ok(requested.some((url) => url.endsWith('/ui/workbench.js')), 'the page’s own files are seen');
  assert.deepEqual(loaded(), [], 'PDF.js is not loaded until a PDF is read');
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
  assert.deepEqual(loaded().filter((path) => !path.includes('worker')), ['core/pdf.js', 'ui/workbench/pdf-reader.js', 'ui/workbench/pdf-shims.js', 'ui/workbench/pdfjs.js', 'vendor/pdfjs/pdf.min.mjs'], 'the reader, its shims and PDF.js, from inside the extension');
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

  // 6. Nothing broke the page's rules, and nothing was requested from anywhere.
  assert.deepEqual(await ui.evaluate(() => window.__csp), [], 'no content security policy violation');
  assert.deepEqual(errors, [], 'no page errors');
  assert.deepEqual(requested.filter((url) => !url.startsWith(`chrome-extension://${run.id}/`)), [], 'everything loaded from inside the extension');
  pass('pdf-reader-keeps-the-page-rules');
  result.status = 'PASS';
} catch (error) {
  result.status = 'FAIL'; result.error = String(error?.stack || error); console.error(error); process.exitCode = 1;
} finally {
  await context?.close();
  result.finished = new Date().toISOString();
  await writeFile(resolve(evidence, 'pdf-browser-results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(result.status, `${result.checks.length} checks`);
}
