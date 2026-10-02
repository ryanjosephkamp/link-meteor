// Loaded-extension checks for 0.3.0 exports and bookmark controls, with no optional grants:
// export file names and the "Saves as" line, a typed override, the name pattern settings across a
// reload, the JSON about block, CSV and TSV compared byte for byte with the packaged 0.2.2 export
// code, the formatted workbook read by tests/verify-workbook.py (openpyxl), and when bookmark
// access is requested. Runs headless in a fresh task-owned profile.
//
// 0.4.0 workbench extras: Copy as rich links (the exact HTML and text read back from the clipboard,
// and the plain-text fallback), Copy diagnostics (valid indented JSON with no addresses or names),
// and About and help's website links carrying ?theme=. Clipboard reads use permissions granted to
// the test context; headless Chrome keeps its own clipboard, so the system clipboard is untouched.
//
// 0.4.0 custom columns: added, renamed and removed (with Undo) in the collection editor, filled one
// by one in link details and for selected links, searched, and exported as CSV, TSV, a workbook
// read by openpyxl, HTML, Markdown and JSON; names shown as text everywhere; 320 px layout and
// contrast in light and dark. Downloads land in a folder under .scratch/, checked for each file.
//
// 0.5.0 citations and notes: BibTeX, RIS, CSL-JSON, the annotated bibliography and the Obsidian
// note downloaded from the Export panel, each equal to src/core/cite.js output for the same rows
// (every occurrence, grouped, and a selection) and valid for its readers; what the entries hold and
// the first entry; the research columns in a CSV; and the new parts at 320 px, in light and dark.
//
// Bookmark prompts are never shown: a page-level stand-in for chrome.permissions.request records
// each request and answers it. Where the folder picker is exercised, the page's own messages to
// the background are also stood in for (an API mock, labeled as such in the results); the real
// bookmark API is checked by tests/extended-browser.mjs in a profile that has bookmark access.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
const VERSION = JSON.parse(await readFile(new URL('../src/manifest.json', import.meta.url), 'utf8')).version;

process.env.LINK_METEOR_EVIDENCE_DIR ||= '.scratch/evidence-exports-bookmarks';
process.env.LINK_METEOR_FIXTURE_PORT ||= '52482';
// Playwright keeps accepted downloads in a temporary folder of this process: put it under .scratch/.
const downloadsTemp = resolve(import.meta.dirname, '..', '.scratch', `downloads-exports-${process.pid}`);
await mkdir(downloadsTemp, {recursive: true});
process.env.TMPDIR = process.env.TMP = process.env.TEMP = downloadsTemp;
const {launch, rpc, until, evidence, root, scratch} = await import('./helpers/browser.mjs');
const {exportFileName, fileNamePart, FORMAT_EXTENSIONS, richLinks, makeExport} = await import('../src/core/export.js');
const {queryLinks, MAX_CUSTOM_FIELDS} = await import('../src/core/model.js');
const {citeFirst, citeFacts} = await import('../src/core/cite.js');
const CITE = await import('./fixtures/cite-links.mjs');
const {readPackagedMembers} = await import('../scripts/verify-package.mjs');

const run = promisify(execFile);
const result = {started: new Date().toISOString(), browser: 'Chrome for Testing via Playwright, headless; real unpacked extension; no optional grants', checks: [],
  limits: ['No optional grants: bookmark prompts are answered by a page-level stand-in, never by Chrome.', 'Folder-picker checks use stand-in background answers (API mock); the real bookmark API is covered by tests/extended-browser.mjs with bookmark access.', 'openpyxl is a library reader, not Microsoft Excel.']};
const check = (name, detail = {}) => { result.checks.push({name, status: 'pass', ...detail}); console.log('PASS', name); };
const exportsDir = resolve(evidence, 'exports');
await mkdir(exportsDir, {recursive: true});

// The packaged 0.2.2 export code, for byte-for-byte comparisons.
await mkdir(scratch, {recursive: true});
const oldDir = await mkdtemp(join(scratch, 'export-022-'));
const packaged = readPackagedMembers(await readFile(join(root, 'artifacts', 'link-meteor-0.2.2.zip')));
await mkdir(join(oldDir, 'core'));
for (const name of ['core/export.js', 'core/xlsx.js']) await writeFile(join(oldDir, name), packaged.get(name));
const old = await import(pathToFileURL(join(oldDir, 'core', 'export.js')).href);

const seedPath = resolve(root, process.env.LINK_METEOR_SEED_JSON || 'artifacts/evidence-0.2.2/exports/browser.json');
const seedData = JSON.parse(await readFile(seedPath, 'utf8'));
const seedRows = Array.isArray(seedData) ? seedData : seedData.rows;
const COLLECTION = 'Urban heat: “sources” / 2026';
const DEFAULTS = {exportPrefix: '', exportTimestamp: true, exportTimestampFormat: 'datetime'};

const {context, id} = await launch(process.env.LINK_METEOR_TEST_PROFILE || `exports-lane-${Date.now()}`, {headless: true});
const errors = [];
try {
  for (const page of context.pages()) await page.close();
  const ui = await context.newPage();
  ui.on('pageerror', (error) => errors.push(error.message));
  ui.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  // Record every permission request and answer it without Chrome's prompt (declined by default).
  await ui.addInitScript(() => {
    if (!globalThis.chrome?.permissions) return;
    window.__permissionRequests = [];
    window.__permissionAnswer = false;
    chrome.permissions.request = (request) => { window.__permissionRequests.push(JSON.parse(JSON.stringify(request))); return Promise.resolve(window.__permissionAnswer); };
  });
  const url = `chrome-extension://${id}/ui/workbench.html`;
  await ui.goto(url); await ui.locator('#collection-heading').waitFor();
  await ui.evaluate(() => chrome.storage.local.clear()); await ui.reload(); await ui.locator('#collection-heading').waitFor();
  assert.deepEqual(await ui.evaluate(() => chrome.permissions.getAll()).then((grants) => [grants.origins, grants.permissions.filter((name) => ['bookmarks', 'tabs'].includes(name))]), [[], []], 'fresh profile without optional grants');
  const requests = () => ui.evaluate(() => window.__permissionRequests);
  const state = () => rpc(ui, {type: 'state.get'});
  const active = async () => { const s = await state(); return s.collections.find((c) => c.id === s.activeCollectionId); };

  await rpc(ui, {type: 'state.mutate', action: {type: 'collection.create', name: COLLECTION}});
  await rpc(ui, {type: 'state.mutate', action: {type: 'links.append', links: seedRows.map((row) => row.occurrences[0])}});
  await until(async () => (await ui.locator('.link-row').count()) > 0, 'Seeded rows');
  const links = (await active()).links;
  assert.equal(links.length, seedRows.length);
  const rows = queryLinks(links).rows;
  check('Fresh profile, no optional grants; seeded a collection with a colon, quotes and a slash in its name', {links: links.length, seed: seedPath.slice(root.length + 1)});

  const savesAs = async () => (await ui.locator('#download-name').innerText()).replace(/^Saves as /, '');
  const pattern = (collection, extension, settings, before, after) => new Set([before, after].map((date) => exportFileName({collection, extension, settings, date})));
  async function download(save) {
    const before = new Date();
    const pending = ui.waitForEvent('download');
    await ui.locator('#download').click();
    const file = await pending;
    const after = new Date();
    const landed = await file.path();
    // Every test download stays under .scratch/ (launch() gives each profile its own downloads folder there).
    assert.ok(landed.startsWith(scratch + '/') || landed.startsWith(scratch + '\\'), `the download landed in ${landed}, outside .scratch/`);
    const name = file.suggestedFilename();
    const path = resolve(exportsDir, save || name);
    await file.saveAs(path);
    return {name, path, bytes: await readFile(path), before, after, line: await savesAs(), notice: await ui.locator('#notice').innerText()};
  }

  // 1. Default names for every format, matching the "Saves as" line and the pattern.
  const names = {};
  for (const format of ['xlsx', 'csv', 'tsv', 'markdown', 'html', 'json', 'text']) {
    await ui.locator('#format').selectOption(format);
    const shown = await savesAs();
    const got = await download(`lane.${FORMAT_EXTENSIONS[format]}`);
    const expected = pattern(COLLECTION, FORMAT_EXTENSIONS[format], DEFAULTS, got.before, got.after);
    assert.ok(expected.has(got.name), `${format}: ${got.name} not in ${[...expected]}`);
    assert.equal(got.line, got.name, 'the Saves as line names the downloaded file');
    assert.ok(shown === got.name || expected.has(shown), 'the line before the click showed the same pattern');
    assert.match(got.name, /^Urban-heat-sources-2026_\d{4}-\d\d-\d\d_\d{4}\.[a-z]+$/);
    assert.doesNotMatch(got.name, /:/);
    assert.equal(got.notice, `Downloaded ${got.name}.`);
    assert.equal(await ui.locator('#export-name').getAttribute('placeholder'), got.name);
    names[format] = got;
  }
  check('Every format downloads under the default name the Saves as line shows, with no colon', {names: Object.fromEntries(Object.entries(names).map(([format, got]) => [format, got.name]))});

  // 2. CSV and TSV are byte-for-byte the 0.2.2 output; the other plain formats too.
  for (const format of ['csv', 'tsv', 'markdown', 'html', 'text']) {
    const expected = old.makeExport(rows, {format, columns: ['anchorText', 'url']}).data;
    assert.equal(names[format].bytes.toString('utf8'), expected, `${format} equals 0.2.2`);
  }
  check('CSV, TSV, Markdown, HTML and URL list downloads equal the packaged 0.2.2 export code for the same rows', {rows: rows.length});

  // 3. JSON is {about, rows}; rows equal the 0.2.2 array.
  const json = JSON.parse(names.json.bytes.toString('utf8'));
  assert.deepEqual(Object.keys(json), ['about', 'rows']);
  assert.deepEqual(json.rows, JSON.parse(old.makeExport(rows, {format: 'json'}).data));
  const exportedAt = new Date(json.about.exportedAt);
  assert.ok(exportedAt >= new Date(names.json.before.valueOf() - 1000) && exportedAt <= names.json.after, 'export time is the download time');
  assert.equal(new Date(json.about.exportedAtLocal).valueOf(), exportedAt.valueOf(), 'local time with offset names the same instant');
  assert.deepEqual({...json.about, exportedAt: 0, exportedAtLocal: 0}, {exportedAt: 0, exportedAtLocal: 0, collection: COLLECTION, count: rows.length, view: 'Every occurrence; sorted by capture order, ascending', filters: [], version: VERSION});
  check('JSON download is {about, rows}; rows equal the 0.2.2 array and about names the time, collection, count, view and version', {about: json.about});

  // 4. The formatted workbook, read independently.
  const workbookExpected = {formatted: true, columns: ['anchorText', 'url'], rows: [['Anchor text', 'URL'], ...rows.map((row) => [row.anchorText, row.url])],
    urlColumns: ['URL', 'Original href', 'Source page URL', 'Frame URL'],
    about: {exportedAtUtcSeconds: null, collection: COLLECTION, count: rows.length, view: 'Every occurrence; sorted by capture order, ascending', filters: [], columns: 'Anchor text, URL', version: VERSION}};
  const expectedPath = resolve(exportsDir, 'lane.xlsx.expected.json');
  await writeFile(expectedPath, JSON.stringify(workbookExpected, null, 2) + '\n');
  // Windows installs Python as python; LINK_METEOR_PYTHON picks another interpreter.
  const python = process.env.LINK_METEOR_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const reader = JSON.parse((await run(python, [resolve(root, 'tests/verify-workbook.py'), names.xlsx.path, expectedPath])).stdout);
  assert.equal(reader.formatted, 'pass');
  assert.ok(reader.formatted_checks.hyperlinks >= rows.filter((row) => /^(https?|mailto):/.test(row.url)).length);
  await writeFile(resolve(evidence, 'lane-workbook-results.json'), JSON.stringify(reader, null, 2) + '\n');
  check('Downloaded workbook: bold frozen header, filters, fitted widths, exact hyperlinks, text-only cells and an About sheet (openpyxl)', {openpyxl: reader.openpyxl, hyperlinks: reader.formatted_checks.hyperlinks, widths: reader.formatted_checks.column_widths});

  // 5. A typed name for one export: the extension is not doubled, follows a format change, and clearing returns to the pattern.
  await ui.locator('#format').selectOption('csv');
  await ui.locator('#export-name').fill('My report.CSV');
  assert.equal(await savesAs(), 'My-report.csv');
  let got = await download();
  assert.equal(got.name, 'My-report.csv'); assert.equal(got.line, 'My-report.csv');
  await ui.locator('#format').selectOption('xlsx');
  assert.equal(await ui.locator('#export-name').inputValue(), 'My report.xlsx');
  got = await download();
  assert.equal(got.name, 'My-report.xlsx');
  await ui.locator('#export-name').fill('Q3: heat/cool');
  assert.equal(await savesAs(), 'Q3-heat-cool.xlsx');
  await ui.locator('#export-name').fill('');
  got = await download();
  assert.ok(pattern(COLLECTION, 'xlsx', DEFAULTS, got.before, got.after).has(got.name), 'cleared field returns to the pattern');
  check('A typed File name overrides the pattern for a download, is not doubled, follows the format, and clearing it returns to the pattern');

  // 6. Name pattern settings: safe prefix saved and shown, timestamp off, date only, persisted after reload.
  await ui.locator('#name-settings > summary').click();
  await ui.locator('#name-prefix').fill('Lab notes: 2026!');
  await ui.locator('#name-prefix').press('Enter');
  await until(async () => (await state()).settings.exportPrefix === 'Lab-notes-2026', 'Prefix saved');
  assert.equal(await ui.locator('#name-prefix').inputValue(), 'Lab-notes-2026');
  await until(async () => (await ui.locator('#notice').innerText()).includes('Saved the prefix as “Lab-notes-2026”'), 'Prefix change shown');
  assert.equal(fileNamePart('Lab notes: 2026!', 40), 'Lab-notes-2026');
  assert.match(await savesAs(), /^Lab-notes-2026_Urban-heat-sources-2026_\d{4}-\d\d-\d\d_\d{4}\.xlsx$/);
  await ui.locator('#name-timestamp').uncheck();
  await until(async () => (await state()).settings.exportTimestamp === false, 'Timestamp off saved');
  assert.equal(await savesAs(), 'Lab-notes-2026_Urban-heat-sources-2026.xlsx');
  assert.equal(await ui.locator('#name-timestamp-format').isDisabled(), true);
  await ui.locator('#name-timestamp').check();
  await ui.locator('#name-timestamp-format').selectOption('date');
  await until(async () => { const s = (await state()).settings; return s.exportTimestamp === true && s.exportTimestampFormat === 'date'; }, 'Date only saved');
  assert.match(await savesAs(), /^Lab-notes-2026_Urban-heat-sources-2026_\d{4}-\d\d-\d\d\.xlsx$/);
  assert.equal(await ui.locator('#name-pattern').innerText(), 'Pattern: Lab-notes-2026_collection_YYYY-MM-DD.xlsx');
  await ui.reload(); await ui.locator('#collection-heading').waitFor();
  await until(async () => (await ui.locator('#name-prefix').inputValue()) === 'Lab-notes-2026', 'Settings shown after reload');
  assert.equal(await ui.locator('#name-timestamp').isChecked(), true);
  assert.equal(await ui.locator('#name-timestamp-format').inputValue(), 'date');
  got = await download();
  const saved = {exportPrefix: 'Lab-notes-2026', exportTimestamp: true, exportTimestampFormat: 'date'};
  assert.ok(pattern(COLLECTION, 'xlsx', saved, got.before, got.after).has(got.name), got.name);
  check('Name pattern settings save a safe prefix (and say so), turn the date off, use date only, and persist across reopening', {name: got.name});
  await ui.locator('#name-settings > summary').click();
  await ui.locator('#name-prefix').fill('');
  await ui.locator('#name-prefix').press('Enter');
  await ui.locator('#name-timestamp-format').selectOption('datetime');
  await until(async () => { const s = (await state()).settings; return s.exportPrefix === '' && s.exportTimestampFormat === 'datetime'; }, 'Settings reset');

  // 7. Filters, grouping and selection are recorded in the about block.
  await ui.locator('#search').fill('pdf');
  await until(async () => (await ui.locator('.link-row').count()) < rows.length, 'Search applied');
  await ui.locator('#filters-toggle').click();
  await ui.locator('#dedupe').selectOption('url');
  await ui.locator('.row-select').nth(0).check();
  await ui.locator('#format').selectOption('json');
  got = await download();
  const filtered = JSON.parse(got.bytes.toString('utf8'));
  const selectedCount = filtered.rows.length;
  assert.ok(selectedCount >= 1);
  assert.deepEqual([filtered.about.view, filtered.about.filters, filtered.about.count], ['Unique URLs; sorted by capture order, ascending', ['Search: “pdf”', 'Selected links only'], selectedCount]);
  await ui.locator('#clear-selection').click();
  await ui.locator('#dedupe').selectOption('none');
  await ui.locator('#filters-toggle').click();
  await ui.locator('#search').fill('');
  check('The about block records the grouping, sort, search and selection behind an export', {about: filtered.about});

  // 8. Switching collections returns a typed name to the pattern.
  await ui.locator('#export-name').fill('Only for heat');
  await ui.locator('#export-name').blur(); // a typed name is never cleared while the field has focus
  await rpc(ui, {type: 'state.mutate', action: {type: 'collection.create', name: 'Second list'}});
  await until(async () => (await savesAs()).startsWith('Second-list_'), 'New collection name shown');
  assert.equal(await ui.locator('#export-name').inputValue(), '');
  const heat = (await state()).collections.find((c) => c.name === COLLECTION);
  await rpc(ui, {type: 'state.mutate', action: {type: 'collection.activate', id: heat.id}});
  await until(async () => (await savesAs()).startsWith('Urban-heat-sources-2026_'), 'Back to the seeded collection');
  check('A typed name is dropped when the collection changes');

  // 9. Bookmark access is requested only when choosing Existing folder or pressing Bookmark.
  assert.deepEqual(await requests(), [], 'no permission request from loading, downloads, names or settings');
  assert.equal(await ui.locator('#bookmark-mode input[value=new]').isChecked(), true);
  assert.equal(await ui.locator('#bookmark-existing').isHidden(), true);
  assert.equal(await ui.locator('#bookmark-skip-existing').isChecked(), true);
  await ui.locator('#bookmark-mode input[value=existing]').click(); // declined at once, so it springs back to New folder
  await until(async () => (await ui.locator('#error').innerText()).includes('Bookmark access was declined'), 'Declined access explained');
  assert.deepEqual(await requests(), [{permissions: ['bookmarks']}]);
  assert.equal(await ui.locator('#bookmark-mode input[value=new]').isChecked(), true, 'declining returns to New folder');
  assert.equal(await ui.locator('#bookmark-existing').isHidden(), true);
  await ui.locator('#bookmark').click();
  await until(async () => (await ui.locator('#error').innerText()).includes('Nothing was saved to your bookmarks'), 'Declined bookmark explained');
  assert.deepEqual(await requests(), [{permissions: ['bookmarks']}, {permissions: ['bookmarks']}]);
  for (const message of [{type: 'bookmarks.folders'}, {type: 'links.bookmark', folderId: '1', links: [{anchorText: 'x', url: 'https://example.org/'}]}, {type: 'links.bookmark', name: 'x', links: [{anchorText: 'x', url: 'https://example.org/'}]}]) {
    await assert.rejects(rpc(ui, message), /Allow bookmark access/, message.type);
  }
  check('Bookmark access is requested only on choosing Existing folder or pressing Bookmark; declining is explained; the background refuses without access', {requests: await requests()});

  // 10. Folder picker behavior with stand-in answers (API mock): search, choose, skip, counts.
  const folders = [
    {id: '1', title: 'Bookmarks bar', path: 'Bookmarks bar', depth: 0},
    {id: '10', title: 'Research', path: 'Bookmarks bar › Research', depth: 1},
    {id: '11', title: 'Heat', path: 'Bookmarks bar › Research › Heat', depth: 2},
    {id: '2', title: 'Other bookmarks', path: 'Other bookmarks', depth: 0},
    {id: '20', title: 'Heat', path: 'Other bookmarks › Heat', depth: 1},
    {id: '21', title: 'Heat', path: 'Other bookmarks › Heat', depth: 1},
  ];
  await ui.evaluate((folders) => {
    window.__permissionAnswer = true;
    window.__sent = [];
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    window.__originalSend = original;
    chrome.runtime.sendMessage = async (message) => {
      if (message?.type === 'bookmarks.folders') { window.__sent.push(message); return {ok: true, data: {folders}}; }
      if (message?.type === 'links.bookmark') { window.__sent.push(message); return {ok: true, data: {folderId: message.folderId || 'new', created: !message.folderId, count: 2, skipped: 1, failed: 0}}; }
      return original(message);
    };
  }, folders);
  await ui.locator('#bookmark-mode input[value=existing]').check();
  await until(async () => (await ui.locator('#bookmark-folder option').count()) === folders.length, 'Folders listed');
  assert.deepEqual(await ui.locator('#bookmark-folder option').allInnerTexts(), ['Bookmarks bar', 'Bookmarks bar › Research', 'Bookmarks bar › Research › Heat', 'Other bookmarks', 'Other bookmarks › Heat', 'Other bookmarks › Heat (2)']);
  assert.equal(await ui.locator('#bookmark-folder-status').innerText(), '6 folders. Choose one to save into.');
  await ui.locator('#bookmark').click();
  await until(async () => (await ui.locator('#error').innerText()).includes('Choose a bookmark folder'), 'Folder required');
  await ui.locator('#bookmark-folder-search').fill('research heat');
  assert.deepEqual(await ui.locator('#bookmark-folder option').allInnerTexts(), ['Bookmarks bar › Research › Heat']);
  assert.equal(await ui.locator('#bookmark-folder-status').innerText(), '1 of 6 folders. Choose one to save into.');
  await ui.locator('#bookmark-folder-search').press('Enter');
  assert.equal(await ui.locator('#bookmark-folder-status').innerText(), '1 of 6 folders. Saves to Bookmarks bar › Research › Heat.');
  await ui.locator('#bookmark-folder-search').fill('nothing like this');
  assert.equal(await ui.locator('#bookmark-folder-status').innerText(), 'No folders match “nothing like this”. Saves to Bookmarks bar › Research › Heat.');
  await ui.locator('#bookmark-folder-search').fill('other');
  await ui.locator('#bookmark-folder').selectOption('21');
  assert.match(await ui.locator('#bookmark-folder-status').innerText(), /Saves to Other bookmarks › Heat\.$/);
  await ui.locator('#bookmark').click();
  await until(async () => (await ui.locator('#notice').innerText()).startsWith('Saved to “Other bookmarks › Heat”: 2 saved, 1 skipped (already in the folder), 0 failed.'), 'Existing-folder result');
  const webLinks = rows.filter((row) => /^https?:/.test(row.url));
  let sent = await ui.evaluate(() => window.__sent.filter((message) => message.type === 'links.bookmark'));
  assert.deepEqual(sent.at(-1), {type: 'links.bookmark', folderId: '21', links: webLinks.map((row) => ({anchorText: row.anchorText, url: row.url})), skipExisting: true});
  assert.match(await ui.locator('#notice').innerText(), new RegExp(`${rows.length - webLinks.length} mail or phone links left out`));
  await ui.locator('#bookmark-skip-existing').uncheck();
  await ui.locator('#bookmark').click();
  await until(async () => (await ui.evaluate(() => window.__sent.filter((message) => message.type === 'links.bookmark').length)) === 2, 'Second save');
  sent = await ui.evaluate(() => window.__sent.filter((message) => message.type === 'links.bookmark'));
  assert.equal(sent.at(-1).skipExisting, false);
  await ui.locator('#bookmark-skip-existing').check();
  await ui.locator('#bookmark-mode input[value=new]').check();
  await ui.locator('#bookmark-name').fill('');
  await ui.locator('#bookmark').click();
  await until(async () => (await ui.locator('#notice').innerText()).startsWith(`Created bookmark folder “${COLLECTION}”: 2 saved, 1 skipped`), 'New-folder result');
  sent = await ui.evaluate(() => window.__sent.filter((message) => message.type === 'links.bookmark'));
  assert.deepEqual(Object.keys(sent.at(-1)).sort(), ['links', 'name', 'skipExisting', 'type']);
  assert.equal(sent.at(-1).name, COLLECTION);
  check('Folder picker (stand-in background answers): paths listed with repeats told apart, search by words, choose, skip on by default, and saved/skipped/failed counts', {mock: true});

  // 11. Layout, labels and contrast of the new controls at 320 px, light and dark.
  await ui.locator('#bookmark-mode input[value=existing]').check();
  await until(async () => (await ui.locator('#bookmark-folder option').count()) > 0, 'Folders listed again');
  await ui.evaluate(() => { document.getElementById('name-settings').open = true; for (const id of ['notice', 'error']) document.getElementById(id).hidden = true; });
  const uniqueWeb = new Set(rows.filter((row) => /^https?:/.test(row.url)).map((row) => row.url)).size;
  assert.equal(await ui.locator('#bookmark-label').innerText(), `Bookmark ${uniqueWeb} web links`, 'with Skip on, repeated URLs count once');
  await ui.locator('#bookmark-skip-existing').uncheck();
  assert.equal(await ui.locator('#bookmark-label').innerText(), `Bookmark ${rows.filter((row) => /^https?:/.test(row.url)).length} web links`);
  await ui.locator('#bookmark-skip-existing').check();
  const overflow = () => ui.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  const contrast = (pairs) => ui.evaluate((pairs) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d', {willReadFrequently: true});
    const rgb = (color) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
    const lum = (c) => c.map((n) => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((s, n, i) => s + n * [.2126, .7152, .0722][i], 0);
    const bg = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c) && !/\/ 0\)$/.test(c)) return c; } return getComputedStyle(document.body).backgroundColor; };
    return pairs.map(([name, selector]) => { const el = document.querySelector(selector); if (!el) return {name, missing: true}; const a = lum(rgb(getComputedStyle(el).color)), b = lum(rgb(bg(el))); return {name, ratio: Math.round(((Math.max(a, b) + .05) / (Math.min(a, b) + .05)) * 100) / 100}; });
  }, pairs);
  const pairs = [['file name field', '#export-name'], ['file name help', '#export-name-help'], ['pattern summary', '#name-settings > summary'], ['pattern line', '#name-pattern'], ['date checkbox label', '.name-check span'], ['saves as line', '#download-name'], ['bookmark mode (checked)', '.bookmark-choice:has(input:checked) span'], ['bookmark mode (unchecked)', '.bookmark-choice:has(input:not(:checked)) span'], ['folder list', '#bookmark-folder'], ['folder status', '#bookmark-folder-status'], ['skip label', 'label:has(#bookmark-skip-existing) span'], ['bookmark help', '#bookmark-help'], ['rich links note', '#copy-rich .copy-note']];
  const measured = [];
  for (const scheme of ['light', 'dark']) {
    await ui.emulateMedia({colorScheme: scheme, reducedMotion: 'reduce'});
    for (const width of [320, 390]) {
      await ui.setViewportSize({width, height: 900});
      if (await ui.locator('#dock-export').isVisible()) await ui.locator('#dock-export').click();
      await ui.evaluate(() => { for (const id of ['notice', 'error']) document.getElementById(id).hidden = true; });
      await ui.waitForTimeout(200);
      assert.equal(await overflow(), false, `overflow at ${width} ${scheme}`);
      await ui.locator('#download-title').scrollIntoViewIfNeeded();
      await ui.screenshot({path: resolve(evidence, `lane-export-${width}-${scheme}.png`), fullPage: true, animations: 'disabled'});
    }
    for (const entry of await contrast(pairs)) { assert.ok(!entry.missing, `${entry.name} missing`); assert.ok(entry.ratio >= 4.5, `${scheme} ${entry.name} contrast ${entry.ratio}`); measured.push({scheme, ...entry}); }
  }
  const unlabeled = await ui.evaluate(() => [...document.querySelectorAll('#export-panel input, #export-panel select, #export-panel button')].filter((e) => e.getClientRects().length && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby') && !e.labels?.length && !(e.tagName === 'BUTTON' && e.textContent.trim())).map((e) => e.id || e.outerHTML.slice(0, 80)));
  assert.deepEqual(unlabeled, []);
  await ui.setViewportSize({width: 1440, height: 1000});
  await ui.emulateMedia({colorScheme: 'light', reducedMotion: 'reduce'});
  await ui.locator('#export-panel').screenshot({path: resolve(evidence, 'lane-export-desktop.png'), animations: 'disabled'});
  check('No horizontal overflow at 320 and 390 px; new controls labeled; measured text contrast at least 4.5:1 in light and dark', {contrast: measured});

  await ui.evaluate(() => { chrome.runtime.sendMessage = window.__originalSend; });

  // 12. Copy as rich links: the same rows as the other copies, as exact HTML and plain text.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  // On another Chrome (LINK_METEOR_CHROME_PATH), such as 116, whose headless clipboard can't be read with
  // navigator.clipboard.read() even after plain text, the text is read directly and the HTML counts as unread
  // (types: null); clipboardIs then compares the text only. Never on the default Chrome for Testing.
  let htmlUnread = 0;
  const clipboard = async () => {
    try { return await readClipboard(); } catch (error) {
      if (!process.env.LINK_METEOR_CHROME_PATH || !/No valid data on clipboard/.test(error.message)) throw error;
      htmlUnread++;
      return {types: null, html: null, text: (await ui.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')};
    }
  };
  const clipboardIs = async (want) => { const copied = await clipboard(); if (copied.types) assert.deepEqual(copied, want); else assert.equal(copied.text, want.text); return copied; };
  const readClipboard = () => ui.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    // Windows stores clipboard text with CRLF line endings; compare the content, not the platform's newlines.
    const read = async (type) => item.types.includes(type) ? (await (await item.getType(type)).text()).replace(/\r\n/g, '\n') : null;
    return {types: [...item.types].sort(), html: await read('text/html'), text: await read('text/plain')};
  });
  const notice = async (start) => until(async () => { const text = await ui.locator('#notice').innerText(); return await ui.locator('#notice').isVisible() && text.startsWith(start) && text; }, `Notice: ${start}`);
  const clearNotice = () => ui.evaluate(() => { for (const id of ['notice', 'error']) { const box = document.getElementById(id); box.hidden = true; box.replaceChildren(); } });
  await clearNotice();
  assert.equal(await ui.locator('#copy-rich').isEnabled(), true);
  await ui.locator('#copy-rich').click();
  assert.equal(await notice('Copied'), `Copied ${rows.length} links as rich links. Paste into Google Docs, Word or Notion to keep them clickable.`);
  const expected = richLinks(rows);
  await clipboardIs({types: ['text/html', 'text/plain'], html: expected.html, text: expected.text});
  assert.ok(expected.html.startsWith('<ul><li><a href="') && expected.text.split('\n').length === rows.length);
  // A selection narrows it, exactly as for the other copies.
  await clearNotice();
  await ui.locator('.row-select').nth(0).check(); await ui.locator('.row-select').nth(1).check();
  await ui.locator('#copy-rich').click();
  assert.equal(await notice('Copied'), 'Copied 2 links as rich links. Paste into Google Docs, Word or Notion to keep them clickable.');
  await clipboardIs({types: ['text/html', 'text/plain'], ...richLinks(rows.slice(0, 2))});
  await ui.locator('#clear-selection').click();
  // Chrome refusing the HTML falls back to the plain text, and says so.
  await clearNotice();
  await ui.evaluate(() => { navigator.clipboard.write = () => Promise.reject(new DOMException('Refused for this check', 'NotAllowedError')); });
  await ui.locator('#copy-rich').click();
  assert.equal(await notice('Copied'), `Copied ${rows.length} links as plain text, each with its URL, because Chrome didn't accept rich links here. They won't paste as clickable links.`);
  await clipboardIs({types: ['text/plain'], html: null, text: expected.text});
  await ui.evaluate(() => { delete navigator.clipboard.write; });
  check('Copy as rich links puts the exact HTML and plain text on the clipboard for the rows in view or the selection, and falls back to plain text with a clear status', {links: rows.length, htmlBytes: expected.html.length});

  // 13. Copy diagnostics: indented JSON with counts and choices, and no addresses or names.
  await clearNotice();
  await ui.locator('#help-toggle').click();
  assert.equal(await ui.locator('#about-panel').evaluate((details) => details.open), true);
  await ui.locator('#copy-diagnostics').click();
  assert.equal(await notice('Copied diagnostics'), 'Copied diagnostics as indented JSON: versions, settings, permissions and counts. Paste them into your bug report.');
  const diagnosticsText = (await clipboard()).text;
  const diagnostics = JSON.parse(diagnosticsText);
  assert.equal(diagnosticsText, `${JSON.stringify(diagnostics, null, 2)}\n`, 'indented JSON');
  const everything = await state();
  const hosts = links.flatMap((item) => [item.url, item.sourceUrl, item.frameUrl]).map((value) => { try { return new URL(value).hostname; } catch { return ''; } });
  const forbidden = [...new Set([...links.flatMap((item) => [item.url, item.originalHref, item.sourceUrl, item.sourceTitle, item.frameUrl, item.notes, ...item.tags]), ...hosts, ...everything.collections.map((item) => item.name)])].filter((value) => value && value.length > 3);
  assert.deepEqual(forbidden.filter((value) => diagnosticsText.includes(value)), []);
  assert.doesNotMatch(diagnosticsText, /:\/\/|https?:|mailto:|tel:/i);
  assert.equal(diagnostics.version, VERSION);
  assert.deepEqual(diagnostics.data, {readable: true, collections: everything.collections.length, links: everything.collections.reduce((n, item) => n + item.links.length, 0), undoLinks: 0});
  assert.deepEqual(diagnostics.permissions, {tabs: false, bookmarks: false, tabGroups: false, downloads: false, allSites: false, siteOriginCount: 0});
  assert.deepEqual([diagnostics.settings.theme, diagnostics.settings.holdOrigins, diagnostics.settings.exportPrefix, diagnostics.scripts.scope], ['meteor', 0, 0, 'none']);
  assert.ok(diagnostics.storage.bytesInUse > 0 && diagnostics.browser.userAgent && diagnostics.browser.brands.length);
  await writeFile(resolve(evidence, 'lane-diagnostics.json'), diagnosticsText);
  assert.equal(await ui.locator('#copy-diagnostics').getAttribute('aria-describedby'), 'diagnostics-help');
  assert.match(await ui.locator('#diagnostics-help').innerText(), /never addresses, site names, page titles, notes, tags or collection names/);
  const aboutMeasured = [];
  for (const scheme of ['light', 'dark']) {
    await ui.emulateMedia({colorScheme: scheme, reducedMotion: 'reduce'});
    for (const entry of await contrast([['diagnostics button', '#copy-diagnostics'], ['diagnostics help', '#diagnostics-help']])) { assert.ok(!entry.missing, `${entry.name} missing`); assert.ok(entry.ratio >= 4.5, `${scheme} ${entry.name} contrast ${entry.ratio}`); aboutMeasured.push({scheme, ...entry}); }
  }
  await ui.emulateMedia({colorScheme: 'light', reducedMotion: 'reduce'});
  await ui.locator('#about-panel').screenshot({path: resolve(evidence, 'lane-about-desktop.png'), animations: 'disabled'});
  await ui.setViewportSize({width: 320, height: 900});
  if (await ui.locator('#export-done').isVisible()) await ui.locator('#export-done').click();
  await ui.locator('#about-panel').evaluate((details) => { details.open = false; });
  await ui.locator('#help-toggle').click();
  assert.deepEqual(await ui.evaluate(() => [document.getElementById('app').dataset.view, document.getElementById('about-panel').open]), ['collections', true]);
  await clearNotice();
  assert.equal(await overflow(), false, 'About and help at 320 px');
  await ui.screenshot({path: resolve(evidence, 'lane-about-320.png'), fullPage: true, animations: 'disabled'});
  await ui.keyboard.press('Escape');
  await ui.setViewportSize({width: 1440, height: 1000});
  check('Copy diagnostics puts indented JSON on the clipboard with version, counts and permissions, and no address, host, title, note, tag or collection name; its line says so; contrast at least 4.5:1', {collections: diagnostics.data.collections, links: diagnostics.data.links, contrast: aboutMeasured});

  // 14. About and help's website links carry the theme; Meteor, the default, adds nothing.
  const aboutLinks = () => ui.evaluate(() => [...document.querySelectorAll('#about-panel a')].map((a) => a.href));
  const plain = ['https://ryanjosephkamp.github.io/', 'https://ryanjosephkamp.github.io/link-meteor/guide.html', 'https://github.com/ryanjosephkamp/link-meteor/issues', 'https://ryanjosephkamp.github.io/link-meteor/', 'https://github.com/ryanjosephkamp/link-meteor', 'https://github.com/sponsors/ryanjosephkamp'];
  const themed = (id) => plain.map((href, i) => [1, 3].includes(i) ? `${href}?theme=${id}` : href);
  assert.deepEqual(await aboutLinks(), plain);
  await rpc(ui, {type: 'state.mutate', action: {type: 'settings.update', patch: {theme: 'aurora'}}});
  await until(async () => (await aboutLinks()).join() === themed('aurora').join(), 'Theme reached the About links');
  await rpc(ui, {type: 'state.mutate', action: {type: 'settings.update', patch: {theme: 'contrast'}}});
  await ui.reload(); await ui.locator('#collection-heading').waitFor();
  await until(async () => (await aboutLinks()).join() === themed('contrast').join(), 'Themed links after reopening');
  await rpc(ui, {type: 'state.mutate', action: {type: 'settings.update', patch: {theme: 'meteor'}}});
  await until(async () => (await aboutLinks()).join() === plain.join(), 'Back to Meteor');
  check('About and help links to the website add ?theme= after a theme change and after reopening; Meteor and the other links stay plain', {aurora: themed('aurora').filter((href) => href.includes('?theme=')), meteor: plain});

  // 15. Custom columns (0.4.0): added in the collection editor, with names checked and limits shown.
  await clearNotice();
  const HOSTILE = '=Rank <b>&</b> "one"'; // formula-looking, with markup and quotes: shown and exported as text
  const fieldList = async () => (await active()).fields || [];
  const addColumn = async (name) => { await ui.locator('#field-new').fill(name); await ui.locator('#field-new').press('Enter'); };
  const linkById = async (linkId) => (await active()).links.find((item) => item.id === linkId);
  const errorText = (start) => until(async () => { const text = await ui.locator('#error').innerText(); return await ui.locator('#error').isVisible() && text.startsWith(start) && text; }, `Error: ${start}`);
  await ui.locator('#edit-collection').click();
  assert.equal(await ui.locator('#fields-count').innerText(), `0 of ${MAX_CUSTOM_FIELDS}`);
  await addColumn('  Principal   investigator ');
  await until(async () => (await fieldList()).length === 1, 'First column');
  await ui.locator('#field-new').fill('Deadline'); await ui.locator('#field-add-button').click();
  await until(async () => (await fieldList()).length === 2, 'Second column');
  await addColumn(HOSTILE);
  await until(async () => (await fieldList()).length === 3, 'Third column');
  let fields = await fieldList();
  const [pi, due, rank] = fields.map((field) => field.id);
  const columnNames = ['Principal investigator', 'Deadline', HOSTILE];
  assert.deepEqual(fields.map((field) => field.name), columnNames, 'names are trimmed with spaces collapsed');
  assert.deepEqual(await ui.locator('.field-item .field-name').allInnerTexts(), columnNames);
  assert.equal(await ui.locator('#fields-count').innerText(), '3 of 20');
  assert.equal(await ui.evaluate(() => document.activeElement?.id), 'field-new', 'focus stays in the name field for the next column');
  await addColumn('DEADLINE');
  assert.equal(await ui.locator('#field-add-help').innerText(), 'This collection already has a column named “Deadline”. Choose another name.');
  assert.equal(await ui.locator('#field-new').getAttribute('aria-invalid'), 'true');
  await addColumn('   ');
  assert.equal(await ui.locator('#field-add-help').innerText(), 'Type a name for the column.');
  await ui.locator('#field-new').fill('x'.repeat(75));
  assert.equal((await ui.locator('#field-new').inputValue()).length, 60, 'a name stops at 60 characters');
  assert.equal(await ui.locator('#field-add-help').innerText(), "That's 60 characters, the most a column name can have.");
  await ui.locator('#field-new').fill('');
  assert.equal((await fieldList()).length, 3, 'refused names add nothing');
  for (let i = 4; i <= MAX_CUSTOM_FIELDS; i++) await rpc(ui, {type: 'state.mutate', action: {type: 'fields.add', name: `Extra ${i}`}});
  await until(async () => (await ui.locator('#fields-count').innerText()) === '20 of 20', 'Twenty columns');
  assert.equal(await ui.locator('#field-new').isDisabled(), true);
  assert.equal(await ui.locator('#field-add-help').innerText(), 'This collection has 20 custom columns, the most it can have. Remove one to add another.');
  assert.deepEqual(await ui.locator('#add-column option').last().evaluate((option) => [option.textContent, option.disabled]), ['New custom column… (20 is the most per collection)', true]);
  await assert.rejects(rpc(ui, {type: 'state.mutate', action: {type: 'fields.add', name: 'One more'}}), /at most 20 custom columns/);
  for (const field of (await fieldList()).slice(3)) await rpc(ui, {type: 'state.mutate', action: {type: 'fields.remove', fieldId: field.id}});
  await until(async () => (await ui.locator('#fields-count').innerText()) === '3 of 20', 'Back to three columns');
  assert.equal(await ui.locator('#field-new').isDisabled(), false);
  assert.equal(await ui.locator('#field-add-help').innerText(), 'Up to 60 characters.');
  check('Custom columns are added in the collection editor; a repeated, empty or 61-character name is refused with a plain reason, and at 20 columns adding stops and says why', {columnNames});

  // Values one by one, in each link's details next to Note, with the 2,000-character limit shown.
  const form = (index) => ui.locator('.link-row').nth(index).locator('.occurrence-form').first();
  const valueInput = (index, fieldId) => form(index).locator(`input[data-link-field="field:${fieldId}"]`);
  // A saved change renders the list again once storage reports it; open details after that settles.
  const toggleDetails = async (index) => {
    await ui.waitForTimeout(250);
    const open = await ui.locator('.link-row').nth(index).locator('.row-details').evaluate((details) => details.open);
    await ui.locator('.link-row').nth(index).locator('.row-details summary').click();
    await until(async () => (await ui.locator('.link-row').nth(index).locator('.row-details').evaluate((details) => details.open)) !== open, `Details ${index} toggled`);
  };
  // The notice's own text, without its Undo button.
  const noticeText = async (start) => { await notice(start); return ui.locator('#notice .msg').innerText(); };
  await toggleDetails(0);
  await valueInput(0, pi).waitFor();
  assert.deepEqual(await form(0).locator('.field-input').evaluateAll((labels) => labels.map((label) => label.firstChild.textContent)), columnNames);
  assert.match(await valueInput(0, pi).getAttribute('aria-label'), /^Principal investigator for /);
  const values0 = {[pi]: 'https://lab.example/people/rivera', [due]: '=HYPERLINK("https://evil.example","x")', [rank]: '+1 555 0100'};
  for (const [fieldId, text] of Object.entries(values0)) await valueInput(0, fieldId).fill(text);
  await form(0).locator('button[type=submit]').click();
  assert.equal(await notice('Saved'), 'Saved the note, tags and custom columns.');
  assert.deepEqual((await linkById(rows[0].id)).fields, values0);
  assert.deepEqual(await ui.locator('.link-row').nth(0).locator('.row-notes .field-value').allInnerTexts(), columnNames.map((name, i) => `${name}: ${Object.values(values0)[i]}`));
  await clearNotice();
  await toggleDetails(1);
  await valueInput(1, pi).fill('Dr. Okafor');
  await valueInput(1, due).fill('d'.repeat(2001));
  assert.equal(await form(1).locator('.field-limit').innerText(), '“Deadline” can hold up to 2,000 characters. This text has 2,001; shorten it by 1 to save it.');
  assert.equal(await valueInput(1, due).getAttribute('aria-invalid'), 'true');
  await form(1).locator('button[type=submit]').click();
  await errorText('“Deadline” can hold up to 2,000 characters.');
  assert.equal((await linkById(rows[1].id)).fields, undefined, 'a value over the limit saves nothing');
  await ui.locator('#error button').click();
  await valueInput(1, due).fill('d'.repeat(2000));
  assert.equal(await form(1).locator('.field-limit').isVisible(), false);
  await form(1).locator('button[type=submit]').click();
  await notice('Saved the note');
  assert.deepEqual((await linkById(rows[1].id)).fields, {[pi]: 'Dr. Okafor', [due]: 'd'.repeat(2000)});
  for (const index of [1, 0]) await toggleDetails(index);
  check('Each link\'s details show a text field per custom column, labeled with its name, saved with the note; a value over 2,000 characters is explained and not saved');

  // Fill for selected links: one value on many, the limit, Undo, and clearing.
  await clearNotice();
  assert.equal(await ui.locator('#fill-fields').isVisible(), false, 'Fill appears only with a selection');
  for (const index of [1, 2, 3]) await ui.locator('.row-select').nth(index).check();
  await ui.locator('#fill-fields').click();
  assert.equal(await ui.evaluate(() => document.activeElement?.id), 'fill-field');
  assert.deepEqual(await ui.locator('#fill-field option').allInnerTexts(), columnNames);
  await ui.locator('#fill-field').selectOption(due);
  await ui.locator('#fill-value').fill('m'.repeat(2001));
  assert.equal(await ui.locator('#fill-help').innerText(), '“Deadline” can hold up to 2,000 characters. This text has 2,001; shorten it by 1 to save it.');
  await ui.locator('#fill-apply').click();
  await errorText('“Deadline” can hold up to 2,000 characters.');
  await ui.locator('#error button').click();
  assert.equal((await linkById(rows[2].id)).fields, undefined);
  await ui.locator('#fill-value').fill('March 1');
  assert.equal(await ui.locator('#fill-title').innerText(), 'Fill a column for 3 selected links');
  assert.equal(await ui.locator('#fill-help').innerText(), 'Sets “Deadline” to this text on 3 links, replacing 1 different value. You can undo this.');
  assert.equal(await ui.locator('#fill-apply').innerText(), 'Fill 3 links');
  await ui.locator('#fill-value').press('Enter');
  assert.equal(await noticeText('Filled'), 'Filled “Deadline” for 3 links.');
  for (const index of [1, 2, 3]) assert.equal((await linkById(rows[index].id)).fields[due], 'March 1');
  assert.equal((await linkById(rows[1].id)).fields[pi], 'Dr. Okafor', 'other columns are untouched');
  assert.deepEqual([await ui.locator('#fill-panel').isVisible(), await ui.evaluate(() => document.activeElement?.id)], [false, 'fill-fields']);
  await ui.locator('#notice button', {hasText: 'Undo'}).click();
  assert.equal(await notice('Put back'), 'Put back the earlier values of “Deadline”.');
  assert.equal((await linkById(rows[1].id)).fields[due], 'd'.repeat(2000));
  assert.equal((await linkById(rows[2].id)).fields, undefined);
  await clearNotice();
  await ui.locator('#fill-fields').click(); await ui.locator('#fill-field').selectOption(due); await ui.locator('#fill-value').fill('March 1'); await ui.locator('#fill-apply').click();
  await notice('Filled “Deadline” for 3 links.');
  for (const index of [1, 2]) await ui.locator('.row-select').nth(index).uncheck();
  await ui.locator('#fill-fields').click();
  await ui.locator('#fill-field').selectOption(due);
  assert.equal(await ui.locator('#fill-help').innerText(), 'Clears “Deadline” on 1 link, removing 1 value. You can undo this.');
  assert.equal(await ui.locator('#fill-apply').innerText(), 'Clear the column for 1 link');
  await ui.locator('#fill-apply').click();
  assert.equal(await noticeText('Cleared'), 'Cleared “Deadline” for 1 link.');
  assert.equal((await linkById(rows[3].id)).fields, undefined, 'a link with no values has no fields');
  await ui.locator('#fill-fields').click();
  await ui.keyboard.press('Escape');
  assert.deepEqual([await ui.locator('#fill-panel').isVisible(), await ui.evaluate(() => document.activeElement?.id)], [false, 'fill-fields'], 'Escape closes the fill panel');
  await ui.locator('#clear-selection').click();
  assert.equal(await ui.locator('#fill-fields').isVisible(), false);
  check('Fill for selected links sets one column on the selected links (saying how many values it replaces), refuses a value over 2,000 characters, undoes to each link\'s earlier value, and clears with an empty value');

  // Search covers custom values.
  await ui.locator('#search').fill('okafor');
  await until(async () => (await ui.locator('.link-row').count()) === 1, 'Search finds a custom value');
  assert.equal(await ui.locator('.link-row .row-select').getAttribute('aria-label'), `Select ${rows[1].anchorText || rows[1].accessibleLabel || '(textless link)'}`);
  await ui.locator('#search').fill('');
  await until(async () => (await ui.locator('.link-row').count()) === Math.min(rows.length, 100), 'Search cleared');
  check('Search finds links by their custom values');

  // The export: Add a column lists the custom columns and ends with New custom column….
  await clearNotice();
  assert.equal(await ui.locator('#add-column optgroup').getAttribute('label'), 'Custom columns');
  assert.deepEqual(await ui.locator('#add-column optgroup option').allInnerTexts(), [...columnNames, 'New custom column…']);
  for (const fieldId of [pi, due, rank]) await ui.locator('#add-column').selectOption(`field:${fieldId}`);
  assert.deepEqual(await ui.locator('#add-column optgroup option').allInnerTexts(), ['New custom column…']);
  await ui.locator('#add-column').selectOption('new-custom-column');
  assert.equal(await ui.locator('#new-column').isVisible(), true);
  assert.equal(await ui.evaluate(() => document.activeElement?.id), 'new-column-name');
  assert.equal(await ui.locator('#new-column-help').innerText(), `Adds a column to “${COLLECTION}” and to this export. Fill it in each link’s details. Up to 60 characters.`);
  await ui.locator('#new-column-name').fill('deadline'); await ui.locator('#new-column-name').press('Enter');
  assert.equal(await ui.locator('#new-column-help').innerText(), 'This collection already has a column named “Deadline”. Choose another name.');
  await ui.keyboard.press('Escape');
  assert.deepEqual([await ui.locator('#new-column').isVisible(), await ui.evaluate(() => document.activeElement?.id)], [false, 'add-column'], 'Escape closes the new-column form');
  await ui.locator('#add-column').selectOption('new-custom-column');
  await ui.locator('#new-column-name').fill('Reviewer'); await ui.locator('#new-column-add').click();
  assert.equal(await notice('Added'), `Added the column “Reviewer” to “${COLLECTION}” and to this export. Fill it in each link’s details, or select links and use Fill for selected links.`);
  fields = await fieldList();
  const reviewer = fields[3].id;
  assert.equal(fields[3].name, 'Reviewer');
  const header = [...['Anchor text', 'URL'], ...columnNames, 'Reviewer'];
  const columns15 = ['anchorText', 'url', ...[pi, due, rank, reviewer].map((fieldId) => `field:${fieldId}`)];
  assert.deepEqual(await ui.locator('#columns .name').allInnerTexts(), header);
  assert.equal(await ui.locator('#copy-table-note').innerText(), header.join(' · '));
  assert.equal(await ui.evaluate(() => document.activeElement?.id), 'add-column');
  // Names are text wherever they appear.
  assert.equal(await ui.evaluate(() => document.querySelectorAll('#collection-editor b, #export-panel b, #link-list b, #fill-panel b').length), 0);
  check('Add a column lists the collection\'s custom columns and ends with New custom column…, which names a column, adds it to the collection and to the export, and refuses a repeated name', {header});

  // Every format carries the custom columns; spreadsheet formats keep formula-looking text inert.
  const fieldRows = queryLinks((await active()).links).rows;
  const expectedFile = (format) => makeExport(fieldRows, {format, columns: columns15, fields}).data;
  const files15 = {};
  for (const format of ['csv', 'tsv', 'html', 'markdown', 'json', 'xlsx']) {
    await ui.locator('#format').selectOption(format);
    if (format === 'json') assert.match(await ui.locator('#format-help').innerText(), /Custom columns are in each link’s fields, and the about block names them\.$/);
    files15[format] = await download(`columns.${FORMAT_EXTENSIONS[format]}`);
  }
  for (const format of ['csv', 'tsv', 'html', 'markdown']) assert.equal(files15[format].bytes.toString('utf8'), expectedFile(format), `${format} with custom columns`);
  const csvLines = files15.csv.bytes.toString('utf8').split('\r\n');
  assert.equal(csvLines[0], 'Anchor text,URL,Principal investigator,Deadline,"\'=Rank <b>&</b> ""one""",Reviewer');
  assert.ok(csvLines[1].endsWith(',https://lab.example/people/rivera,"\'=HYPERLINK(""https://evil.example"",""x"")",\'+1 555 0100,'), csvLines[1]);
  assert.ok(files15.tsv.bytes.toString('utf8').split('\r\n')[1].includes('\t"\'=HYPERLINK(""https://evil.example"",""x"")"\t\'+1 555 0100\t'));
  assert.ok(files15.html.bytes.toString('utf8').includes('<th scope="col">=Rank &lt;b&gt;&amp;&lt;/b&gt; &quot;one&quot;</th><th scope="col">Reviewer</th>'));
  assert.equal(files15.markdown.bytes.toString('utf8'), old.makeExport(fieldRows, {format: 'markdown'}).data, 'Markdown ignores columns, as before');
  const json15 = JSON.parse(files15.json.bytes.toString('utf8'));
  assert.deepEqual(json15.about.fields, fields.map(({id, name}) => ({id, name})));
  assert.deepEqual(json15.rows, JSON.parse(makeExport(fieldRows, {format: 'json'}).data));
  assert.deepEqual(json15.rows[0].fields, values0);
  const cells15 = (row) => [row.anchorText, row.url, ...[pi, due, rank, reviewer].map((fieldId) => row.fields?.[fieldId] ?? '')];
  const expected15 = {formatted: true, columns: columns15, rows: [header, ...fieldRows.map(cells15)], urlColumns: ['URL', 'Original href', 'Source page URL', 'Frame URL'],
    about: {exportedAtUtcSeconds: null, collection: COLLECTION, count: fieldRows.length, view: 'Every occurrence; sorted by capture order, ascending', filters: [], columns: header.join(', '), version: VERSION}};
  const expected15Path = resolve(exportsDir, 'columns.xlsx.expected.json');
  await writeFile(expected15Path, JSON.stringify(expected15, null, 2) + '\n');
  const reader15 = JSON.parse((await run(python, [resolve(root, 'tests/verify-workbook.py'), files15.xlsx.path, expected15Path])).stdout);
  assert.equal(reader15.formatted, 'pass');
  assert.deepEqual(reader15.formatted_checks.links_outside_url_columns, [], 'a web address in a custom column stays text');
  await writeFile(resolve(evidence, 'lane-columns-workbook-results.json'), JSON.stringify(reader15, null, 2) + '\n');
  await clearNotice();
  await ui.locator('#copy-table').click();
  assert.equal(await notice('Copied'), `Copied ${fieldRows.length} rows as a table (${header.join(', ')}). Paste into any spreadsheet.`);
  assert.equal((await clipboard()).text, expectedFile('tsv').replace(/\r\n/g, '\n'));
  check('CSV, TSV, HTML and Markdown downloads equal the export code for the custom columns; formula-looking values and names start with an apostrophe in CSV and TSV; HTML escapes names; JSON keeps each row\'s fields and names the columns in about.fields; the workbook (openpyxl) has the names as headers, text-only cells, no formulas and no links in custom columns; Copy table carries them too', {openpyxl: reader15.openpyxl, files: Object.fromEntries(Object.entries(files15).map(([format, got]) => [format, got.name]))});

  // Rename (from the keyboard) and remove with Undo, in the collection editor.
  await clearNotice();
  await ui.locator('button[aria-label="Rename Deadline"]').focus(); await ui.keyboard.press('Enter');
  const renameInput = ui.locator('#fields-list input[data-field-action="name"]');
  assert.deepEqual([await renameInput.inputValue(), await ui.evaluate(() => document.activeElement?.dataset.fieldAction)], ['Deadline', 'name']);
  await renameInput.fill('PRINCIPAL investigator'); await ui.keyboard.press('Enter');
  assert.equal(await ui.locator('#field-rename-help').innerText(), 'This collection already has a column named “Principal investigator”. Choose another name.');
  await renameInput.fill('Application   deadline'); await ui.keyboard.press('Enter');
  assert.equal(await notice('Renamed'), 'Renamed the column “Deadline” to “Application deadline”.');
  assert.equal((await fieldList())[1].name, 'Application deadline');
  assert.equal(await ui.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Rename Application deadline');
  assert.equal((await ui.locator('#columns .name').allInnerTexts())[3], 'Application deadline', 'the export shows the new name');
  await ui.locator('button[aria-label="Rename Reviewer"]').click();
  await renameInput.fill('Changed my mind'); await ui.keyboard.press('Escape');
  assert.deepEqual([await renameInput.count(), (await fieldList())[3].name, await ui.evaluate(() => document.activeElement?.getAttribute('aria-label'))], [0, 'Reviewer', 'Rename Reviewer'], 'Escape cancels a rename');
  await ui.locator('#format').selectOption('csv');
  assert.match((await download('columns-renamed.csv')).bytes.toString('utf8'), /^Anchor text,URL,Principal investigator,Application deadline,/);
  await clearNotice();
  const beforeRemove = await active();
  await ui.locator('button[aria-label="Remove Principal investigator"]').click();
  assert.equal(await ui.locator('#field-remove-confirm-text').innerText(), 'Remove the column “Principal investigator” and its values in 2 links? You can undo this.');
  assert.equal(await ui.evaluate(() => document.activeElement?.id), 'field-remove-confirm-no');
  await ui.keyboard.press('Escape');
  assert.deepEqual([await ui.locator('#field-remove-confirm').isVisible(), await ui.evaluate(() => document.activeElement?.getAttribute('aria-label'))], [false, 'Remove Principal investigator']);
  await ui.locator('button[aria-label="Remove Principal investigator"]').click();
  await ui.locator('#field-remove-confirm-yes').click();
  assert.equal(await noticeText('Removed'), 'Removed the column “Principal investigator” and its values in 2 links.');
  assert.deepEqual((await fieldList()).map((field) => field.name), ['Application deadline', HOSTILE, 'Reviewer']);
  assert.ok((await active()).links.every((item) => !item.fields || !(pi in item.fields)), 'its values are removed');
  assert.equal(await ui.locator('#fields-status-text').innerText(), 'Removed the column “Principal investigator” and its values in 2 links.');
  assert.equal(await ui.evaluate(() => document.activeElement?.id), 'field-undo');
  assert.ok(!(await ui.locator('#columns .name').allInnerTexts()).includes('Principal investigator'), 'the export drops the removed column');
  await ui.locator('#field-undo').click();
  assert.equal(await notice('Put back'), 'Put back the column “Principal investigator” and its values in 2 links.');
  const afterUndo = await active();
  assert.deepEqual(afterUndo.fields, beforeRemove.fields, 'the column is back in its place');
  assert.deepEqual(afterUndo.links, beforeRemove.links, 'with every value');
  assert.equal(await ui.locator('#fields-status').isVisible(), false);
  check('A column is renamed from the keyboard (a repeated name is refused; Escape cancels) and the export follows; Remove asks first, removes the values, and Undo puts the column back in place with every value');

  // Layout, labels and contrast of every new part at 320 px, in light and dark.
  // Every part at once: a removal's Undo line, a refused name, a value over the limit, the fill panel and the new-column form.
  await clearNotice();
  await ui.locator('button[aria-label="Remove Reviewer"]').click(); await ui.locator('#field-remove-confirm-yes').click();
  assert.equal(await noticeText('Removed'), 'Removed the column “Reviewer”.');
  await addColumn('application DEADLINE');
  await toggleDetails(0);
  await valueInput(0, rank).fill('r'.repeat(2001));
  for (const index of [1, 2]) await ui.locator('.row-select').nth(index).check();
  await ui.locator('#fill-fields').click();
  await ui.locator('#add-column').selectOption('new-custom-column');
  const pairs15 = [['columns heading', '#fields-title'], ['columns count', '#fields-count'], ['columns help', '#fields-help'], ['column name', '.field-item .field-name'], ['values count', '.field-item .field-filled'],
    ['rename', '.field-item button[data-field-action="rename"]'], ['remove', '.field-item button[data-field-action="remove"]'], ['name problem', '#field-add-help'], ['removal status', '#fields-status-text'], ['column undo', '#field-undo'],
    ['value label', '.occurrence-form .field-input'], ['value too long', '.field-limit'], ['row value', '.row-notes .field-value'], ['row value name', '.row-notes .field-value-name'],
    ['fill button', '#fill-fields'], ['fill title', '#fill-title'], ['fill label', '#fill-panel label'], ['fill help', '#fill-help'], ['new column label', 'label[for="new-column-name"]'], ['new column help', '#new-column-help']];
  const measured15 = [];
  for (const scheme of ['light', 'dark']) {
    await ui.emulateMedia({colorScheme: scheme, reducedMotion: 'reduce'});
    await ui.setViewportSize({width: 1440, height: 1000});
    await ui.waitForTimeout(200);
    for (const entry of await contrast(pairs15)) { assert.ok(!entry.missing, `${entry.name} missing`); assert.ok(entry.ratio >= 4.5, `${scheme} ${entry.name} contrast ${entry.ratio}`); measured15.push({scheme, ...entry}); }
    await ui.setViewportSize({width: 320, height: 900});
    await ui.evaluate(() => { for (const id of ['notice', 'error']) document.getElementById(id).hidden = true; });
    await ui.waitForTimeout(200);
    assert.equal(await overflow(), false, `links view overflow at 320 ${scheme}`);
    await ui.screenshot({path: resolve(evidence, `lane-columns-320-${scheme}.png`), fullPage: true, animations: 'disabled'});
    await ui.locator('#dock-export').click();
    await ui.waitForTimeout(200);
    assert.equal(await overflow(), false, `export view overflow at 320 ${scheme}`);
    await ui.locator('#columns-fieldset').scrollIntoViewIfNeeded();
    await ui.screenshot({path: resolve(evidence, `lane-columns-export-320-${scheme}.png`), animations: 'disabled'});
    await ui.locator('#export-done').click();
  }
  await ui.emulateMedia({colorScheme: 'light', reducedMotion: 'reduce'});
  await ui.setViewportSize({width: 1440, height: 1000});
  const unlabeled15 = await ui.evaluate(() => [...document.querySelectorAll('input, select, textarea, button')].filter((e) => e.getClientRects().length && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby') && !e.labels?.length && !(e.tagName === 'BUTTON' && e.textContent.trim())).map((e) => e.id || e.outerHTML.slice(0, 80)));
  assert.deepEqual(unlabeled15, []);
  await ui.screenshot({path: resolve(evidence, 'lane-columns-desktop.png'), fullPage: true, animations: 'disabled'});
  check('Custom column controls: no horizontal overflow at 320 px in the links and export views, every control labeled, measured text contrast at least 4.5:1 in light and dark', {contrast: measured15});

  // 16. Citations and notes (0.5.0), in a collection with page citations, custom columns and research fields.
  await ui.reload(); await ui.locator('#collection-heading').waitFor();
  await ui.setViewportSize({width: 1440, height: 1000}); await ui.emulateMedia({colorScheme: 'light', reducedMotion: 'reduce'});
  await rpc(ui, {type: 'state.mutate', action: {type: 'collection.create', name: CITE.COLLECTION}});
  for (const field of CITE.FIELDS) await rpc(ui, {type: 'state.mutate', action: {type: 'fields.add', name: field.name}});
  const addedFields = (await active()).fields;
  const citeFieldIds = Object.fromEntries(CITE.FIELDS.map((field, i) => [field.id, addedFields[i].id]));
  // One address saved twice, so grouping has something to group; custom values under this collection's column IDs.
  const {status: _status, starred: _starred, fields: _fields, ...firstLink} = CITE.LINKS[0];
  const citeLinks = [...CITE.LINKS, {...firstLink, id: 'cite-repeat', anchorText: 'The canopy paper again', notes: '', tags: [], context: ''}]
    .map(({fields: values, ...rest}) => (values ? {...rest, fields: Object.fromEntries(Object.entries(values).map(([key, value]) => [citeFieldIds[key], value]))} : rest));
  await rpc(ui, {type: 'state.mutate', action: {type: 'links.append', links: citeLinks, pages: CITE.PAGES}});
  await until(async () => (await ui.locator('.link-row').count()) === citeLinks.length, 'Citation links shown');
  const citeCollection = await active();
  const citeRows = queryLinks(citeCollection.links).rows;
  const citeOptions = {pages: citeCollection.pages, fields: citeCollection.fields};
  assert.deepEqual(citeCollection.pages, CITE.PAGES, 'page citations saved as given');
  const citeFormats = {bibtex: ['BibTeX file', 'bib', 'First entry'], ris: ['RIS file', 'ris', 'First record'], csl: ['CSL-JSON file', 'json', 'First entry'], annotated: ['annotated bibliography', 'md', 'First entry'], obsidian: ['Obsidian note', 'md', 'First list item']};
  assert.deepEqual(await ui.locator('#format optgroup').evaluate((group) => [group.label, ...[...group.children].map((option) => `${option.value}: ${option.textContent}`)]),
    ['Citations and notes', 'bibtex: BibTeX (.bib)', 'ris: RIS (.ris)', 'csl: CSL-JSON (.json)', 'annotated: Annotated bibliography (.md)', 'obsidian: Obsidian note (.md)']);
  const expectedCite = (format, rows, got) => new Set([got.before, got.after].map((date) => makeExport(rows, {format, about: {exportedAt: date, collection: CITE.COLLECTION}, ...citeOptions}).data));
  const facts = () => ui.locator('#cite-facts li').allInnerTexts();
  const citeFiles = {};
  for (const [format, [label, extension, firstLabel]] of Object.entries(citeFormats)) {
    await ui.locator('#format').selectOption(format);
    assert.deepEqual([await ui.locator('#columns-fieldset').isHidden(), await ui.locator('#cite-block').isVisible()], [true, true], `${format}: the columns step aside`);
    assert.equal(await ui.locator('#download-label').innerText(), `Download ${label}`);
    assert.equal(await ui.locator('#cite-first-label').innerText(), firstLabel);
    assert.match(await ui.locator('#format-help').innerText(), format === 'obsidian' ? /^A Markdown note for an Obsidian vault/ : /nothing is looked up online\.$|Nothing is looked up online\.$/);
    assert.equal(await ui.locator('#cite-first').textContent(), citeFirst(citeRows, {format, ...citeOptions, collection: CITE.COLLECTION}), `${format}: the first entry`);
    const got = await download(`citations-${format}.${extension}`);
    assert.match(got.name, new RegExp(`^Urban-heat-islands-thesis-sources_\\d{4}-\\d\\d-\\d\\d_\\d{4}\\.${extension}$`));
    assert.equal(got.line, got.name);
    assert.ok(expectedCite(format, citeRows, got).has(got.bytes.toString('utf8')), `${format}: the download equals src/core/cite.js output for the same rows`);
    citeFiles[format] = got;
  }
  await ui.locator('#format').selectOption('bibtex');
  const citeLines = await facts();
  assert.deepEqual([citeLines[0], citeLines[1], citeLines[2], citeLines[4]], ['14 entries, one per link', '4 with a DOI or arXiv ID', '2 with authors and a date', '11 use the anchor text as the title, or the address when there is none']);
  // 0.5.0 RC3: papers no saved page describes have no authors; the panel says how to get them.
  const unauthored = citeFacts(citeRows, citeOptions.pages).unauthored;
  assert.ok(unauthored > 0, 'the seeded collection has papers no saved page describes');
  assert.equal(citeLines[3], `${unauthored} with a DOI or arXiv ID but no authors yet. Capture from the paper’s own page (on arXiv, its abstract page) or save that page as a tab, and its authors and date fill in`);
  assert.equal(citeLines.length, 5);
  await ui.locator('#format').selectOption('obsidian');
  assert.deepEqual(await facts(), ['14 list items, one per link', '2 with a note', '2 with the words around the link on its page', '2 custom columns as name:: value fields, where filled in']);
  // Valid for their readers: balanced braces in every BibTeX entry, ER and CRLF in RIS, a CSL-JSON array.
  const bib = citeFiles.bibtex.bytes.toString('utf8');
  for (const entry of bib.trim().split(/\n\n(?=@)/)) { let depth = 0; for (const char of entry) { depth += char === '{' ? 1 : char === '}' ? -1 : 0; assert.ok(depth >= 0, entry); } assert.equal(depth, 0, entry); }
  assert.equal((bib.match(/^@(misc|article)\{/gm) || []).length, citeRows.length);
  const ris = citeFiles.ris.bytes.toString('utf8');
  assert.doesNotMatch(ris, /[^\r]\n/, 'RIS lines end with CRLF');
  assert.equal((ris.match(/^TY {2}- /gm) || []).length, citeRows.length); assert.equal((ris.match(/^ER {2}- \r$/gm) || []).length, citeRows.length);
  const csl = JSON.parse(citeFiles.csl.bytes.toString('utf8'));
  assert.ok(Array.isArray(csl) && csl.length === citeRows.length && csl.every((item) => item.id && ['article-journal', 'article', 'webpage'].includes(item.type)));
  assert.equal(new Set(csl.map((item) => item.id)).size, csl.length);
  assert.match(citeFiles.obsidian.bytes.toString('utf8'), /\n {2}Principal investigator:: Dr\. Okafor\n {2}Deadline:: =March 1\n/);
  check('Citations and notes: BibTeX, RIS, CSL-JSON, the annotated bibliography and the Obsidian note each download under the usual name with their own extension, equal src/core/cite.js output for the same rows, and are valid for their readers; the columns step aside for what the entries hold and the first entry', {files: Object.fromEntries(Object.entries(citeFiles).map(([format, got]) => [format, got.name]))});

  // Grouped rows use their first occurrence; a selection narrows the entries.
  await ui.locator('#filters-toggle').click();
  await ui.locator('#dedupe').selectOption('url');
  await ui.locator('#format').selectOption('bibtex');
  const groupedRows = queryLinks(citeCollection.links, {dedupe: 'url'}).rows;
  assert.equal(groupedRows.length, citeRows.length - 1);
  assert.equal((await facts())[0], `${groupedRows.length} entries, one per unique address`);
  got = await download('citations-grouped.bib');
  assert.ok(expectedCite('bibtex', groupedRows, got).has(got.bytes.toString('utf8')), 'grouped: one entry per address, from its first occurrence');
  await ui.locator('.row-select').nth(0).check(); await ui.locator('.row-select').nth(3).check();
  await ui.locator('#format').selectOption('ris');
  assert.equal((await facts())[0], '2 entries, one per unique selected address');
  got = await download('citations-selected.ris');
  assert.ok(expectedCite('ris', [groupedRows[0], groupedRows[3]], got).has(got.bytes.toString('utf8')), 'selected rows only');
  await ui.locator('#clear-selection').click();
  await ui.locator('#dedupe').selectOption('none');
  await ui.locator('#filters-toggle').click();
  check('Grouped rows give one entry per address from the first occurrence, and a selection narrows the entries; the facts say so', {grouped: groupedRows.length});

  // The research columns in a CSV, chosen in Add a column.
  await ui.locator('#format').selectOption('csv');
  assert.equal(await ui.locator('#columns-fieldset').isVisible(), true);
  assert.equal(await ui.locator('#cite-block').isHidden(), true);
  const researchColumns = ['context', 'status', 'starred', 'doi', 'arxiv', 'pmid', 'isbn', 'imported'];
  for (const key of researchColumns) await ui.locator('#add-column').selectOption(key);
  assert.deepEqual(await ui.locator('#columns .name').allInnerTexts(), ['Anchor text', 'URL', 'Context', 'Reading status', 'Starred', 'DOI', 'arXiv ID', 'PubMed ID', 'ISBN', 'Imported from']);
  got = await download('research-columns.csv');
  assert.equal(got.bytes.toString('utf8'), makeExport(citeRows, {format: 'csv', columns: ['anchorText', 'url', ...researchColumns], ...citeOptions}).data);
  assert.match(got.bytes.toString('utf8'), /\r\nSurface temperature and tree canopy in 40 mid-sized cities,https:\/\/doi\.org\/10\.5555\/uhi\.2024\.0142,"Across forty mid-sized cities, the canopy study found that blocks with more than 30% tree cover stayed cooler\.",Read,Yes,10\.5555\/uhi\.2024\.0142,,,,\r\n/);
  await ui.locator('#reset-columns').click();
  check('The research columns (context, reading status, starred, DOI, arXiv ID, PubMed ID, ISBN, imported from) are offered in Add a column and export as src/core/export.js writes them');

  // Layout, focus and contrast of the citation parts at 320 px, in light and dark.
  await ui.locator('#format').selectOption('bibtex');
  const citePairs = [['format list', '#format'], ['format help', '#format-help'], ['entry facts', '.cite-facts li'], ['entry fact number', '.cite-facts b'], ['first entry label', '#cite-first-label'], ['first entry', '#cite-first']];
  const citeMeasured = [];
  for (const scheme of ['light', 'dark']) {
    await ui.emulateMedia({colorScheme: scheme, reducedMotion: 'reduce'});
    await ui.setViewportSize({width: 320, height: 900});
    await ui.locator('#dock-export').click();
    await clearNotice(); await ui.waitForTimeout(200);
    assert.equal(await overflow(), false, `citation choices overflow at 320 ${scheme}`);
    const box = await ui.locator('#cite-first').boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 320, 'the first entry fits the width');
    await ui.locator('#download-title').scrollIntoViewIfNeeded();
    await ui.screenshot({path: resolve(evidence, `lane-cite-320-${scheme}.png`), animations: 'disabled'});
    for (const entry of await contrast(citePairs)) { assert.ok(!entry.missing, `${entry.name} missing`); assert.ok(entry.ratio >= 4.5, `${scheme} ${entry.name} contrast ${entry.ratio}`); citeMeasured.push({scheme, ...entry}); }
    await ui.locator('#export-done').click();
  }
  await ui.emulateMedia({colorScheme: 'light', reducedMotion: 'reduce'});
  await ui.setViewportSize({width: 1440, height: 1000});
  // The first entry scrolls, so it takes keyboard focus, with a visible ring, and is named by its label.
  // 0.6.0: Look up details comes first, since this collection has papers with no authors yet.
  await ui.locator('#format').focus(); await ui.keyboard.press('Tab');
  assert.equal(await ui.evaluate(() => document.activeElement?.id), 'lookup-authors', 'Tab reaches Look up details after the format list');
  await ui.keyboard.press('Tab');
  assert.equal(await ui.evaluate(() => document.activeElement?.id), 'cite-first', 'then the first entry');
  assert.notEqual(await ui.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'none');
  assert.equal(await ui.getByRole('region', {name: 'First entry'}).count(), 1);
  await ui.locator('#export-panel').screenshot({path: resolve(evidence, 'lane-cite-desktop.png'), animations: 'disabled'});
  check('Citation choices: no horizontal overflow at 320 px, the first entry is keyboard-focusable and named, and measured text contrast is at least 4.5:1 in light and dark', {contrast: citeMeasured});

  assert.deepEqual(errors, [], 'no page errors');
  check('No page errors or console errors');
  if (htmlUnread) result.limits.push(`This Chrome's headless clipboard can't be read with navigator.clipboard.read(): ${htmlUnread} clipboard reads checked the plain text only, not the HTML or the types.`);
  result.result = 'PASS';
} catch (error) {
  result.result = 'FAIL'; result.error = error.stack; result.pageErrors = errors; console.error(error); process.exitCode = 1;
} finally {
  await context.close();
  await rm(oldDir, {recursive: true, force: true});
  await rm(downloadsTemp, {recursive: true, force: true});
  result.finished = new Date().toISOString();
  await writeFile(resolve(evidence, 'exports-browser-results.json'), JSON.stringify(result, null, 2) + '\n');
}
