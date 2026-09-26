// Loaded-extension checks for 0.3.0 exports and bookmark controls, with no optional grants:
// export file names and the "Saves as" line, a typed override, the name pattern settings across a
// reload, the JSON about block, CSV and TSV compared byte for byte with the packaged 0.2.2 export
// code, the formatted workbook read by tests/verify-workbook.py (openpyxl), and when bookmark
// access is requested. Runs headless in a fresh task-owned profile.
//
// Bookmark prompts are never shown: a page-level stand-in for chrome.permissions.request records
// each request and answers it. Where the folder picker is exercised, the page's own messages to
// the background are also stood in for (an API mock, labeled as such in the results); the real
// bookmark API is checked by tests/extended-browser.mjs in a profile that has bookmark access.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {promisify} from 'node:util';

process.env.LINK_METEOR_EVIDENCE_DIR ||= '.scratch/evidence-exports-bookmarks';
process.env.LINK_METEOR_FIXTURE_PORT ||= '52482';
const {launch, rpc, until, evidence, root, scratch} = await import('./helpers/browser.mjs');
const {exportFileName, fileNamePart, FORMAT_EXTENSIONS} = await import('../src/core/export.js');
const {queryLinks} = await import('../src/core/model.js');
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
const old = await import(join(oldDir, 'core', 'export.js'));

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
  assert.deepEqual({...json.about, exportedAt: 0, exportedAtLocal: 0}, {exportedAt: 0, exportedAtLocal: 0, collection: COLLECTION, count: rows.length, view: 'Every occurrence; sorted by capture order, ascending', filters: [], version: '0.3.0'});
  check('JSON download is {about, rows}; rows equal the 0.2.2 array and about names the time, collection, count, view and version', {about: json.about});

  // 4. The formatted workbook, read independently.
  const workbookExpected = {formatted: true, columns: ['anchorText', 'url'], rows: [['Anchor text', 'URL'], ...rows.map((row) => [row.anchorText, row.url])],
    urlColumns: ['URL', 'Original href', 'Source page URL', 'Frame URL'],
    about: {exportedAtUtcSeconds: null, collection: COLLECTION, count: rows.length, view: 'Every occurrence; sorted by capture order, ascending', filters: [], columns: 'Anchor text, URL', version: '0.3.0'}};
  const expectedPath = resolve(exportsDir, 'lane.xlsx.expected.json');
  await writeFile(expectedPath, JSON.stringify(workbookExpected, null, 2) + '\n');
  const reader = JSON.parse((await run('python3', [resolve(root, 'tests/verify-workbook.py'), names.xlsx.path, expectedPath])).stdout);
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
  const pairs = [['file name field', '#export-name'], ['file name help', '#export-name-help'], ['pattern summary', '#name-settings > summary'], ['pattern line', '#name-pattern'], ['date checkbox label', '.name-check span'], ['saves as line', '#download-name'], ['bookmark mode (checked)', '.bookmark-choice:has(input:checked) span'], ['bookmark mode (unchecked)', '.bookmark-choice:has(input:not(:checked)) span'], ['folder list', '#bookmark-folder'], ['folder status', '#bookmark-folder-status'], ['skip label', 'label:has(#bookmark-skip-existing) span'], ['bookmark help', '#bookmark-help']];
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
  assert.deepEqual(errors, [], 'no page errors');
  check('No page errors or console errors');
  result.result = 'PASS';
} catch (error) {
  result.result = 'FAIL'; result.error = error.stack; result.pageErrors = errors; console.error(error); process.exitCode = 1;
} finally {
  await context.close();
  await rm(oldDir, {recursive: true, force: true});
  result.finished = new Date().toISOString();
  await writeFile(resolve(evidence, 'exports-browser-results.json'), JSON.stringify(result, null, 2) + '\n');
}
