// Import links (0.5.0) in the loaded extension, with no grants: Chrome for Testing, headless, a
// fresh task-owned profile, the real unpacked build. Files are written here and chosen through the
// real file chooser: a CSV (quoted line breaks, a byte-order mark, every skip reason), Link Meteor's
// own Excel export, a deflated workbook with shared strings and two sheets, a browser's bookmarks
// HTML file and a Link Meteor JSON export; then pasted links (a list, spreadsheet cells, and HTML
// from a web page). It checks the mapping, a new custom column, the preview's skips, importing into
// a new collection and into an existing one with Skip links already saved there, Undo and its
// refusal once links changed, the 20,000-link limit, files Link Meteor refuses, the bookmark-folder
// path with Chrome's prompt stubbed (a simulated decline, a simulated grant the background still
// refuses, and a simulated bookmarks tree), 320 px, and contrast in every theme, light and dark.
// Nothing is uploaded: no request leaves the extension while importing.
//   npm run build && LINK_METEOR_FIXTURE_PORT=52580 node tests/imports-browser.mjs
import assert from 'node:assert/strict';
import {mkdir, writeFile, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {deflateRawSync, crc32} from 'node:zlib';
import {launch, rpc, until, evidence} from './helpers/browser.mjs';
import {makeExport} from '../src/core/export.js';
import {THEME_IDS} from '../src/core/themes.js';

const profile = process.env.LINK_METEOR_TEST_PROFILE || `imports-browser-${Date.now()}`;
const result = {started: new Date().toISOString(), profile, browser: 'Chrome for Testing via Playwright, headless, fresh profile, real unpacked extension, no optional grants; the bookmark permission prompt is stubbed',
  checks: [], screenshots: [], timings: {}, limits: ['Headless Chrome for Testing on one machine with synthetic files; the real bookmarks permission and a real bookmark folder are checked by tests/extended-browser.mjs in a granted profile.']};
const pass = (name, data = {}) => { result.checks.push({name, ...data}); console.log('PASS', name, Object.keys(data).length ? JSON.stringify(data) : ''); };
const files = resolve(evidence, 'import-files');
let context;
try {
  await mkdir(files, {recursive: true});
  const run = await launch(profile, {headless: true});
  context = run.context;
  for (const page of context.pages()) await page.close();
  const outbound = [];
  context.on('request', (request) => { if (!/^(chrome-extension|blob|data):/.test(request.url())) outbound.push(request.url()); });
  const ui = await context.newPage();
  const errors = [];
  ui.on('pageerror', (error) => errors.push(error.message));
  ui.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await ui.setViewportSize({width: 1440, height: 1000});
  // Without transitions, so colors are measured as they settle, not halfway through a theme change.
  await ui.emulateMedia({reducedMotion: 'reduce'});
  await ui.goto(`chrome-extension://${run.id}/ui/workbench.html`);
  await until(() => ui.evaluate(() => document.title.endsWith(' · Link Meteor')), 'collections loaded', 30000);
  if (await ui.locator('#welcome-close').isVisible()) await ui.locator('#welcome-close').click();

  const text = (selector) => ui.locator(selector).innerText();
  const state = () => rpc(ui, {type: 'state.get'});
  const named = async (name) => (await state()).collections.find((item) => item.name === name);
  const active = async () => { const s = await state(); return s.collections.find((item) => item.id === s.activeCollectionId); };
  const notice = (phrase, timeout = 10000) => until(async () => (await ui.locator('#notice').isVisible()) && (await text('#notice')).includes(phrase), `Notice: ${phrase}`, timeout);
  const failure = (phrase, timeout = 10000) => until(async () => (await ui.locator('#error').isVisible()) && (await text('#error')).includes(phrase), `Error: ${phrase}`, timeout);
  const tableRows = () => ui.evaluate(() => [...document.querySelectorAll('#import-table tbody tr')].map((row) => [...row.cells].map((cell) => cell.textContent)));
  const heads = () => ui.evaluate(() => [...document.querySelectorAll('#import-table thead th')].map((cell) => cell.textContent));
  const mapped = () => ui.evaluate(() => Object.fromEntries([...document.querySelectorAll('#import-map select')].map((select) => [select.closest('label').querySelector('.map-label').textContent, select.selectedOptions[0]?.textContent])));
  const summary = async () => [await text('#import-summary-main'), await text('#import-summary-skips')];
  async function choose(path) {
    const [chooser] = await Promise.all([ui.waitForEvent('filechooser'), ui.locator('label[for=import-file]').click()]);
    await chooser.setFiles(path);
  }
  async function preview(path) {
    await choose(path);
    try { await until(() => ui.locator('#import-plan').isVisible(), `preview of ${path}`, 20000); } catch (error) {
      if (await ui.locator('#error').isVisible()) error.message += `; the workbench said: ${await text('#error')}`;
      throw error;
    }
  }
  const overflow = () => ui.evaluate(() => document.documentElement.scrollWidth > innerWidth
    && [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5 && e.getClientRects().length && !e.closest('.table-scroll'))
      .slice(0, 8).map((e) => `${e.tagName.toLowerCase()}#${e.id}.${String(e.className?.baseVal ?? e.className)}`));
  const unlabeled = () => ui.evaluate(() => [...document.querySelectorAll('#import input, #import select, #import textarea, #import button, #import-panel input, #import-panel button')]
    .filter((e) => e.getClientRects().length && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby') && !e.labels?.length && !(e.tagName === 'BUTTON' && e.textContent.trim())).map((e) => e.id || e.outerHTML.slice(0, 80)));
  const shot = async (name, options = {}) => {
    await ui.evaluate(() => { for (const id of ['error', 'notice']) document.getElementById(id).hidden = true; });
    await ui.screenshot({path: resolve(evidence, name), animations: 'disabled', ...options}); result.screenshots.push(name);
  };

  /* Seed: a collection with a custom column and a link that the CSV repeats. */
  const first = (await state()).activeCollectionId;
  const thesisId = (await rpc(ui, {type: 'state.mutate', action: {type: 'collection.create', name: 'Thesis sources'}})).activeCollectionId;
  await rpc(ui, {type: 'state.mutate', action: {type: 'fields.add', collectionId: thesisId, name: 'Principal investigator'}});
  await rpc(ui, {type: 'state.mutate', action: {type: 'links.append', collectionId: thesisId, links: [{id: 'seed-1', anchorText: 'Heat and Health Lab', accessibleLabel: '', url: 'https://heat-health.example.edu/',
    originalHref: '', sourceUrl: 'https://review.example/', sourceTitle: 'Review', frameUrl: '', capturedAt: '2026-09-20T12:00:00.000Z', batchId: 'seed', notes: '', tags: []}]}});
  await rpc(ui, {type: 'state.mutate', action: {type: 'collection.activate', id: first}});
  await until(async () => (await text('#collection-heading')) === 'My research', 'My research shown');

  /* A CSV through the file chooser: header, mapping, preview and every skip reason. */
  const csvPath = resolve(files, 'labs-shortlist.csv');
  await writeFile(csvPath, '﻿Title,Link,PI,Deadline,Notes\r\nHeat and Health Lab,https://heat-health.example.edu/,Dr. Rivera,Dec 1,"Strong fit, ""urban"" focus"\r\n'
    + 'Urban Canopy Group,https://canopy.example.edu/join,Dr. Okafor,Jan 15,"Two\r\nlines"\r\nCool Streets Initiative,www.coolstreets.example.org,Dr. Lindqvist,,\r\n'
    + 'Ask Maya about this one,,,,\r\nHeat and Health Lab,https://heat-health.example.edu/,Dr. Rivera,Dec 1,\r\nLocal notes,file:///Users/someone/notes.txt,,,\r\nEmail the lab,mailto:lab@example.edu,,,\r\n');
  const before = await state();
  // Counts the workers the page starts, and any that fail (the page would then parse by itself).
  await ui.evaluate(() => { window.__workers = {started: 0, failed: 0, answers: 0}; const Original = Worker;
    window.Worker = class extends Original { constructor(...args) { super(...args); window.__workers.started++; this.addEventListener('error', () => window.__workers.failed++);
      this.addEventListener('message', (event) => { if (event.data.rows || event.data.entries) window.__workers.answers++; }); } }; });
  await preview(csvPath);
  assert.equal(await text('#import-source'), 'From labs-shortlist.csv · 7 rows · columns: Title, Link, PI, Deadline, Notes');
  assert.equal(await ui.locator('#import-header').isChecked(), true, 'the header row is detected');
  assert.deepEqual(await mapped(), {'Address (URL) (required)': 'Link', 'Anchor text': 'Title', Notes: 'Notes', Tags: '(none)', 'Reading status': '(none)', Starred: '(none)', 'PI (new column)': 'PI', 'Deadline (new column)': 'Deadline'});
  assert.deepEqual(await heads(), ['Row', 'Anchor text', 'Address', 'Notes', 'PI', 'Deadline', 'Skipped because']);
  assert.deepEqual(await tableRows(), [
    ['2', 'Heat and Health Lab', 'https://heat-health.example.edu/', 'Strong fit, "urban" focus', 'Dr. Rivera', 'Dec 1', ''],
    ['3', 'Urban Canopy Group', 'https://canopy.example.edu/join', 'Two\r\nlines', 'Dr. Okafor', 'Jan 15', ''],
    ['4', 'Cool Streets Initiative', 'www.coolstreets.example.org', '', 'Dr. Lindqvist', '', ''],
    ['5', 'Ask Maya about this one', '(empty)', '', '', '', 'No address'],
    ['6', 'Heat and Health Lab', 'https://heat-health.example.edu/', '', 'Dr. Rivera', 'Dec 1', 'Repeats row 2'],
    ['7', 'Local notes', 'file:///Users/someone/notes.txt', '', '', '', 'Not a web, email or phone address'],
    ['8', 'Email the lab', 'mailto:lab@example.edu', '', '', '', ''],
  ]);
  assert.equal(await ui.locator('#import-table tbody tr.skip').count(), 3, 'skipped rows are marked, and say why in words');
  assert.deepEqual(await summary(), ['Adds 4 links, marked Imported, and 2 new custom columns.', 'Skips 3 rows: 1 has no address, 1 isn’t a web, email or phone address, 1 repeats an earlier row. You can undo the import.']);
  assert.equal(await text('#import-commit'), 'Import 4 links');
  assert.equal(await ui.locator('#import-destination option:checked').innerText(), 'A new collection “labs-shortlist”');
  assert.equal(await ui.locator('#import-skip-saved').isDisabled(), true, 'nothing is saved in a new collection yet');
  assert.equal(await ui.locator('section.capture').isVisible(), false); assert.equal(await ui.locator('#review').isVisible(), false);
  await ui.locator('#import-only-skipped').check();
  assert.deepEqual((await tableRows()).map((row) => row[0]), ['5', '6', '7']);
  assert.equal(await text('#import-table-note'), 'All 3 skipped rows.');
  await ui.locator('#import-only-skipped').uncheck();
  assert.deepEqual(await state(), before, 'nothing is added before Import');
  assert.deepEqual(await ui.evaluate(() => window.__workers), {started: 1, failed: 0, answers: 1}, 'the CSV was parsed by the worker, off the main thread');
  pass('A CSV through the file chooser: header found, columns mapped by name, two new columns proposed, and each skipped row with its reason; nothing added yet', {summary: await summary()});
  await shot('import-full-meteor-light.png');

  /* Not mapping one new column, then importing into a new collection named after the file, and Undo. */
  await ui.locator('#import-map-new-1').selectOption({label: '(skip this column)'});
  assert.deepEqual(await summary(), ['Adds 4 links, marked Imported, and 1 new custom column.', 'Skips 3 rows: 1 has no address, 1 isn’t a web, email or phone address, 1 repeats an earlier row. You can undo the import.']);
  assert.deepEqual(await heads(), ['Row', 'Anchor text', 'Address', 'Notes', 'Deadline', 'Skipped because']);
  let started = Date.now();
  await ui.locator('#import-commit').click();
  await notice('Imported 4 links into “labs-shortlist” and added 1 custom column.');
  result.timings.importSmallMs = Date.now() - started;
  let home = await active();
  assert.equal(home.name, 'labs-shortlist');
  assert.deepEqual(home.fields.map((field) => field.name), ['Deadline']);
  assert.deepEqual(home.links.map((link) => [link.anchorText, link.url, link.originalHref, link.notes, link.imported, link.fields?.[home.fields[0].id] ?? '']), [
    ['Heat and Health Lab', 'https://heat-health.example.edu/', 'https://heat-health.example.edu/', 'Strong fit, "urban" focus', 'labs-shortlist.csv, row 2', 'Dec 1'],
    ['Urban Canopy Group', 'https://canopy.example.edu/join', 'https://canopy.example.edu/join', 'Two\r\nlines', 'labs-shortlist.csv, row 3', 'Jan 15'],
    ['Cool Streets Initiative', 'https://www.coolstreets.example.org/', 'www.coolstreets.example.org', '', 'labs-shortlist.csv, row 4', ''],
    ['Email the lab', 'mailto:lab@example.edu', 'mailto:lab@example.edu', '', 'labs-shortlist.csv, row 8', ''],
  ]);
  assert.equal(new Set(home.links.map((link) => link.batchId)).size, 1, 'one batch');
  assert.ok(home.links.every((link) => link.sourceUrl === '' && link.sourceTitle === '' && link.frameUrl === '' && Date.now() - Date.parse(link.capturedAt) < 120000));
  assert.equal(await ui.locator('#import').isVisible(), false);
  await until(async () => (await ui.locator('.link-row').count()) === 4, 'the imported links listed');
  await ui.locator('#notice button', {hasText: 'Undo'}).click();
  await notice('Import undone: removed 4 links, the collection “labs-shortlist” and 1 custom column.');
  assert.equal(await named('labs-shortlist'), undefined);
  assert.equal((await state()).activeCollectionId, first, 'back to the collection that was open');
  assert.deepEqual((await state()).collections, before.collections, 'Undo puts everything back');
  pass('Import to a new collection named after the file, with one new custom column: addresses as written kept, one batch, marked Imported; Undo removes it all', {ms: result.timings.importSmallMs});

  /* The same CSV into an existing collection: its own column mapped, Skip links already saved there, and Undo refused after a change. */
  await preview(csvPath);
  await ui.locator('#import-destination').selectOption({label: 'Thesis sources'});
  assert.equal(await ui.locator('#import-skip-saved').isChecked(), true);
  assert.equal(await ui.locator('#import-map-field-1').inputValue(), '-1', 'PI is not the same name as Principal investigator');
  await ui.locator('#import-map-field-1').selectOption({label: 'PI'});
  await ui.locator('#import-map-new-1').selectOption({label: '(skip this column)'});
  assert.deepEqual(await mapped(), {'Address (URL) (required)': 'Link', 'Anchor text': 'Title', Notes: 'Notes', Tags: '(none)', 'Reading status': '(none)', Starred: '(none)',
    'Principal investigator': 'PI', 'PI (new column)': '(skip this column)', 'Deadline (new column)': 'Deadline'});
  assert.deepEqual((await tableRows()).map((row) => [row[0], row.at(-1)]), [['2', 'Already saved there'], ['3', ''], ['4', ''], ['5', 'No address'], ['6', 'Repeats row 2'], ['7', 'Not a web, email or phone address'], ['8', '']]);
  assert.deepEqual(await summary(), ['Adds 3 links, marked Imported, and 1 new custom column.',
    'Skips 4 rows: 1 has no address, 1 isn’t a web, email or phone address, 1 repeats an earlier row, 1 is already saved there. You can undo the import.']);
  await ui.locator('#import-skip-saved').uncheck();
  assert.deepEqual(await summary(), ['Adds 4 links, marked Imported, and 1 new custom column.', 'Skips 3 rows: 1 has no address, 1 isn’t a web, email or phone address, 1 repeats an earlier row. You can undo the import.']);
  await ui.locator('#import-skip-saved').check();
  await ui.locator('#import-commit').click();
  await notice('Imported 3 links into “Thesis sources” and added 1 custom column.');
  const thesis = await active();
  assert.equal(thesis.id, thesisId, 'the destination is shown');
  const [pi, deadline] = thesis.fields.map((field) => field.id);
  assert.deepEqual(thesis.links.map((link) => [link.anchorText, link.fields?.[pi] ?? '', link.fields?.[deadline] ?? '']), [['Heat and Health Lab', '', ''], ['Urban Canopy Group', 'Dr. Okafor', 'Jan 15'],
    ['Cool Streets Initiative', 'Dr. Lindqvist', ''], ['Email the lab', '', '']]);
  await rpc(ui, {type: 'state.mutate', action: {type: 'link.update', collectionId: thesisId, id: thesis.links[1].id, patch: {notes: 'Checked'}}});
  await ui.locator('#notice button', {hasText: 'Undo'}).click();
  await failure('These links changed since the import, so Undo is no longer possible.');
  assert.equal((await named('Thesis sources')).links.length, 4, 'the refusal changed nothing');
  await ui.locator('#error button', {hasText: 'Dismiss'}).click();
  pass('Import into an existing collection: its own column mapped by choice, links already saved there skipped and counted; Undo refused once an imported link changed', {links: 3});

  /* Link Meteor's own Excel export, and a deflated workbook with shared strings and two sheets. */
  const lmBook = resolve(files, 'Thesis-sources_2026-09-29_1200.xlsx');
  const exported = makeExport([{anchorText: 'Surface temperature and tree canopy', url: 'https://doi.org/10.5555/uhi.2024.0142', notes: 'Chapter 2', tags: ['canopy', 'chapter 2']},
    {anchorText: '=HYPERLINK("x")', url: 'https://example.org/report(1)', notes: '', tags: []}], {format: 'xlsx', columns: ['anchorText', 'url', 'notes', 'tags', 'sourceUrl'],
    about: {exportedAt: new Date('2026-09-29T12:00:00Z'), collection: 'Thesis sources', version: '0.5.0'}});
  await writeFile(lmBook, exported.data);
  await preview(lmBook);
  assert.equal(await text('#import-source'), 'From Thesis-sources_2026-09-29_1200.xlsx, sheet “Links” · 2 rows · columns: Anchor text, URL, Notes, Tags, Source page URL');
  assert.deepEqual(await ui.locator('#import-sheet option').allInnerTexts(), ['Links', 'About']);
  assert.deepEqual(await mapped(), {'Address (URL) (required)': 'URL', 'Anchor text': 'Anchor text', Notes: 'Notes', Tags: 'Tags', 'Reading status': '(none)', Starred: '(none)', 'Source page URL (new column)': '(skip this column)'});
  assert.deepEqual(await summary(), ['Adds 2 links, marked Imported.', 'You can undo the import.']);
  await ui.locator('#import-commit').click();
  await notice('Imported 2 links into “Thesis-sources_2026-09-29_1200”.');
  home = await active();
  assert.deepEqual(home.links.map((link) => [link.anchorText, link.url, link.tags, link.imported]), [
    ['Surface temperature and tree canopy', 'https://doi.org/10.5555/uhi.2024.0142', ['canopy', 'chapter 2'], 'Thesis-sources_2026-09-29_1200.xlsx › Links, row 2'],
    ['=HYPERLINK("x")', 'https://example.org/report(1)', [], 'Thesis-sources_2026-09-29_1200.xlsx › Links, row 3']]);
  pass('Link Meteor’s own Excel export: both sheets listed, its columns mapped by name, text read exactly (a formula-like anchor stays text)');

  const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const zip = (entries) => {
    const parts = [], centrals = []; let offset = 0;
    for (const [name, content] of entries) {
      const nameBytes = Buffer.from(name), data = Buffer.from(content), packed = deflateRawSync(data), local = Buffer.alloc(30), central = Buffer.alloc(46);
      local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
      central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
      parts.push(local, nameBytes, packed); centrals.push(central, nameBytes); offset += 30 + nameBytes.length + packed.length;
    }
    const size = centrals.reduce((n, part) => n + part.length, 0), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...parts, ...centrals, end]);
  };
  const shared = ['Name', 'Website', 'Tags', 'Status', 'Heat and Health Lab', 'https://heat-health.example.edu/team', 'heat; health', 'Read', 'Canopy', 'Reading'];
  const s = (i) => `<c t="s"><v>${i}</v></c>`;
  const excelPath = resolve(files, 'labs-excel.xlsx');
  await writeFile(excelPath, zip([
    ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0"?><workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets><sheet name="Sources" sheetId="1" r:id="rId1"/><sheet name="Later" sheetId="2" r:id="rId2"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0"?><Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`],
    ['xl/sharedStrings.xml', `<?xml version="1.0"?><sst xmlns="${MAIN}">${shared.map((value) => `<si><t>${value}</t></si>`).join('')}</sst>`],
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet xmlns="${MAIN}"><sheetData><row r="1">${[0, 1, 2, 3].map(s).join('')}</row><row r="2">${[4, 5, 6, 7].map(s).join('')}</row>`
      + `<row r="3">${s(8)}<c t="str"><f>"https://canopy.example.edu/"</f><v>https://canopy.example.edu/</v></c><c/>${s(9)}</row></sheetData></worksheet>`],
    ['xl/worksheets/sheet2.xml', `<?xml version="1.0"?><worksheet xmlns="${MAIN}"><sheetData><row r="4"><c r="B4" t="inlineStr"><is><t>https://later.example/</t></is></c></row></sheetData></worksheet>`],
  ]));
  await preview(excelPath);
  assert.equal(await text('#import-source'), 'From labs-excel.xlsx, sheet “Sources” · 2 rows · columns: Name, Website, Tags, Status');
  assert.deepEqual(await mapped(), {'Address (URL) (required)': 'Website', 'Anchor text': 'Name', Notes: '(none)', Tags: 'Tags', 'Reading status': 'Status', Starred: '(none)'});
  assert.deepEqual(await tableRows(), [['2', 'Heat and Health Lab', 'https://heat-health.example.edu/team', 'heat; health', 'Read', ''], ['3', 'Canopy', 'https://canopy.example.edu/', '', 'Reading', '']]);
  await ui.locator('#import-sheet').selectOption({label: 'Later'});
  await until(async () => (await text('#import-source')).includes('sheet “Later”'), 'the second sheet read');
  assert.equal(await ui.locator('#import-header').isChecked(), false, 'one row is data');
  assert.deepEqual(await tableRows(), [['4', '', 'https://later.example/', '']]);
  await ui.locator('#import-sheet').selectOption({label: 'Sources'});
  await until(async () => (await text('#import-source')).includes('sheet “Sources”'), 'back to the first sheet');
  await ui.locator('#import-destination').selectOption({label: 'Thesis sources'});
  await ui.locator('#import-commit').click();
  await notice('Imported 2 links into “Thesis sources”.');
  const excelLinks = (await named('Thesis sources')).links.slice(-2);
  assert.deepEqual(excelLinks.map((link) => [link.anchorText, link.tags, link.status, link.imported]), [['Heat and Health Lab', ['heat', 'health'], 'read', 'labs-excel.xlsx › Sources, row 2'],
    ['Canopy', [], 'reading', 'labs-excel.xlsx › Sources, row 3']]);
  pass('A deflated workbook (DecompressionStream) with shared strings, a cached formula value and two sheets: tags and reading status mapped by name, the other sheet chosen and back');

  /* A browser's bookmarks HTML file: folder paths, tags and descriptions. */
  const bookmarksPath = resolve(files, 'bookmarks_9_29_26.html');
  await writeFile(bookmarksPath, `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file. -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1727600000" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://news.example/" ADD_DATE="1727600000">News &amp; notes</A>
        <DT><H3>Research</H3>
        <DL><p>
            <DT><A HREF="https://heat-health.example.edu/" TAGS="heat,labs">Heat and Health Lab</A>
            <DD>Strong fit for chapter 2
            <DT><H3>Labs</H3>
            <DL><p>
                <DT><A HREF="https://canopy.example.edu/join">Urban Canopy Group</A>
                <DT><A HREF="javascript:alert(1)">Bookmarklet</A>
            </DL><p>
        </DL><p>
    </DL><p>
    <DT><A HREF="https://loose.example/">Loose</A>
</DL><p>
`);
  await preview(bookmarksPath);
  assert.equal(await text('#import-source'), 'From bookmarks_9_29_26.html · 5 bookmarks in 3 folders');
  assert.equal(await ui.locator('#import-header-row').isVisible(), false);
  assert.deepEqual(await mapped(), {'Address (URL) (required)': 'Address', 'Anchor text': 'Anchor text', Notes: 'Notes', Tags: 'Tags', 'Reading status': '(none)', Starred: '(none)', 'Folder (new column)': '(skip this column)'});
  assert.deepEqual(await heads(), ['Link', 'Anchor text', 'Address', 'Notes', 'Tags', 'Skipped because']);
  assert.deepEqual((await tableRows()).map((row) => [row[1], row.at(-1)]), [['News & notes', ''], ['Heat and Health Lab', ''], ['Urban Canopy Group', ''], ['Bookmarklet', 'Not a web, email or phone address'], ['Loose', '']]);
  assert.deepEqual(await summary(), ['Adds 4 links, marked Imported.', 'Skips 1 link: 1 isn’t a web, email or phone address. You can undo the import.']);
  await ui.locator('#import-commit').click();
  await notice('Imported 4 links into “bookmarks_9_29_26”.');
  home = await active();
  assert.deepEqual(home.links.map((link) => [link.anchorText, link.notes, link.tags, link.imported]), [
    ['News & notes', '', [], 'bookmarks_9_29_26.html › Bookmarks bar'],
    ['Heat and Health Lab', 'Strong fit for chapter 2', ['heat', 'labs'], 'bookmarks_9_29_26.html › Bookmarks bar › Research'],
    ['Urban Canopy Group', '', [], 'bookmarks_9_29_26.html › Bookmarks bar › Research › Labs'],
    ['Loose', '', [], 'bookmarks_9_29_26.html, link 5']]);
  pass('A browser’s bookmarks HTML file: folder paths as where each came from, tags and descriptions mapped, a bookmarklet skipped');

  /* A Link Meteor JSON export, and files Link Meteor refuses. */
  const jsonPath = resolve(files, 'reading-list.json');
  await writeFile(jsonPath, makeExport([{anchorText: 'Cool roofs', url: 'https://roofs.example/', notes: 'n', tags: ['roofs'], status: 'read', starred: true, fields: {'f-x': 'Q3'}}],
    {format: 'json', about: {exportedAt: new Date(), collection: 'Reading list'}, fields: [{id: 'f-x', name: 'Quarter'}]}).data);
  await preview(jsonPath);
  assert.deepEqual(await mapped(), {'Address (URL) (required)': 'URL', 'Anchor text': 'Anchor text', Notes: 'Notes', Tags: 'Tags', 'Reading status': 'Reading status', Starred: 'Starred', 'Quarter (new column)': 'Quarter'});
  await ui.locator('#import-commit').click();
  await notice('Imported 1 link into “reading-list” and added 1 custom column.');
  home = await active();
  assert.deepEqual([home.links[0].status, home.links[0].starred, home.links[0].tags, home.links[0].fields[home.fields[0].id]], ['read', true, ['roofs'], 'Q3']);
  for (const [name, content, phrase] of [['backup.json', JSON.stringify({format: 'link-meteor-backup', formatVersion: 3}), 'This is a Link Meteor backup, not an export.'],
    ['old.xls', 'not really', 'Link Meteor can’t read .xls files. Save old.xls as .xlsx or CSV'], ['broken.xlsx', `PK\u0003\u0004${'x'.repeat(100)}`, 'This workbook is damaged'],
    ['nothing.md', 'No addresses here.', 'nothing.md has no links to import.']]) {
    await writeFile(resolve(files, name), content);
    await choose(resolve(files, name));
    await failure(phrase);
    assert.equal(await ui.locator('#import').isVisible(), false, `${name}: the view closes`);
    assert.match(await text('#error .msg'), /Nothing was imported\.$/);
    await ui.locator('#error button', {hasText: 'Dismiss'}).click();
  }
  const huge = resolve(files, 'too-large.csv');
  await writeFile(huge, Buffer.alloc(21 * 1024 * 1024, 'a,b\n'));
  await choose(huge);
  await failure('too-large.csv is larger than 20 MB, the most Link Meteor imports at once.');
  await ui.locator('#error button', {hasText: 'Dismiss'}).click();
  pass('A Link Meteor JSON export maps every column itself; a backup, an .xls, a damaged workbook, a file with no links and one over 20 MB are refused with the reason');

  /* Pasted links: a list, cells copied from a spreadsheet, and HTML copied from a web page. */
  await ui.locator('#import-paste').click();
  assert.equal(await ui.evaluate(() => document.activeElement.id), 'import-text');
  await ui.locator('#import-text').fill('- Heat and Health Lab: https://heat-health.example.edu/.\n[Canopy](https://canopy.example.edu/join)\nmailto:lab@example.edu, tel:+12125550123\nnot a link');
  await ui.locator('#import-read-text').click();
  await until(() => ui.locator('#import-plan').isVisible(), 'pasted preview');
  assert.equal(await text('#import-source'), 'From pasted text · 4 links');
  assert.deepEqual(await heads(), ['Line', 'Anchor text', 'Address', 'Skipped because']);
  assert.deepEqual(await tableRows(), [['1', 'Heat and Health Lab', 'https://heat-health.example.edu/', ''], ['2', 'Canopy', 'https://canopy.example.edu/join', ''],
    ['3', '', 'mailto:lab@example.edu', ''], ['3', '', 'tel:+12125550123', '']]);
  await ui.locator('#import-destination').selectOption({label: 'Thesis sources'});
  assert.deepEqual((await tableRows()).map((row) => row.at(-1)), ['Already saved there', 'Already saved there', 'Already saved there', '']);
  await ui.locator('#import-commit').click();
  await notice('Imported 1 link into “Thesis sources”.');
  assert.deepEqual((await named('Thesis sources')).links.at(-1).imported, 'Pasted links, line 3');
  await ui.locator('#import-paste').click();
  await ui.locator('#import-text').fill('Anchor text\tURL\tTags\nStreet trees\thttps://trees.example/\tcanopy, streets\nShade\thttps://shade.example/\t');
  await ui.locator('#import-read-text').click();
  await until(() => ui.locator('#import-plan').isVisible(), 'pasted cells');
  assert.equal(await ui.locator('#import-header').isChecked(), true);
  assert.deepEqual(await mapped(), {'Address (URL) (required)': 'URL', 'Anchor text': 'Anchor text', Notes: '(none)', Tags: 'Tags', 'Reading status': '(none)', Starred: '(none)'});
  await ui.locator('#import-header').uncheck();
  assert.deepEqual((await tableRows()).map((row) => [row[0], row.at(-1)]), [['1', 'Not a web, email or phone address'], ['2', ''], ['3', '']], 'without a header row the names are a row');
  assert.equal(await ui.locator('#import-map-url option:checked').innerText(), 'Column B: URL');
  await ui.locator('#import-header').check();
  await ui.locator('#import-text').fill('');
  const html = '<meta charset="utf-8"><ul><li><a href="https://doi.org/10.5555/cool.2025.0007">Cooling cities: a review</a></li><li><a href="https://data.example/hourly.csv">Hourly station temperatures</a></li></ul>';
  await ui.locator('#import-text').fill('Cooling cities: a review\nHourly station temperatures');
  await ui.evaluate((html) => { const data = new DataTransfer(); data.setData('text/html', html); data.setData('text/plain', 'x'); document.getElementById('import-text').dispatchEvent(new ClipboardEvent('paste', {clipboardData: data, bubbles: true})); }, html);
  await ui.waitForTimeout(50);
  await ui.locator('#import-read-text').click();
  await until(async () => (await text('#import-source')) === 'From pasted text · 2 links', 'pasted HTML');
  assert.deepEqual(await tableRows(), [['1', 'Cooling cities: a review', 'https://doi.org/10.5555/cool.2025.0007', ''], ['2', 'Hourly station temperatures', 'https://data.example/hourly.csv', '']]);
  await ui.keyboard.press('Escape');
  await notice('Import canceled. Nothing was added.');
  assert.equal(await ui.locator('#import').isVisible(), false);
  assert.equal(await ui.evaluate(() => document.activeElement.id), 'import-paste', 'focus goes back to Paste links');
  pass('Pasted links: a list with anchor text from the words around, spreadsheet cells with their header (and without), and HTML from a web page keeping its anchor text; Escape cancels');

  /* A bookmark folder, with Chrome's prompt stubbed. */
  await ui.evaluate(() => {
    window.__requests = []; window.__answer = false; window.__tree = null; window.__sent = [];
    chrome.permissions.request = async (request) => { window.__requests.push({request, activeGesture: navigator.userActivation.isActive}); return window.__answer; };
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = async (message) => {
      window.__sent.push(message);
      if (window.__tree && message.type === 'bookmarks.folders') return {ok: true, data: {folders: window.__tree.folders}};
      if (window.__tree && message.type === 'bookmarks.folderLinks') return {ok: true, data: window.__tree.links[`${message.folderId}:${message.recursive}`]};
      return send(message);
    };
  });
  await ui.locator('#import-bookmarks').click();
  await failure('Bookmark access was declined, so your bookmark folders can’t be listed.');
  assert.deepEqual(await ui.evaluate(() => window.__requests.splice(0)), [{request: {permissions: ['bookmarks']}, activeGesture: true}], 'asked in the click');
  assert.equal(await ui.locator('#import').isVisible(), false);
  await ui.locator('#error button', {hasText: 'Dismiss'}).click();
  await ui.evaluate(() => { window.__answer = true; });
  await ui.locator('#import-bookmarks').click();
  await failure('Allow bookmark access before choosing a folder.');
  assert.equal(await ui.locator('#import').isVisible(), false, 'Chrome granted nothing, so the background refuses (simulated grant)');
  await ui.locator('#error button', {hasText: 'Dismiss'}).click();
  await ui.evaluate(() => {
    const links = [{title: 'Heat and Health Lab', url: 'https://heat-health.example.edu/', path: 'Research'}, {title: 'Canopy', url: 'https://canopy.example.edu/join', path: 'Research › Labs'},
      {title: 'Bookmarklet', url: 'javascript:void(0)', path: 'Research › Labs'}];
    window.__tree = {folders: [{id: '1', title: 'Bookmarks bar', path: 'Bookmarks bar', depth: 0}, {id: '10', title: 'Research', path: 'Bookmarks bar › Research', depth: 1},
      {id: '101', title: 'Labs', path: 'Bookmarks bar › Research › Labs', depth: 2}, {id: '2', title: 'Other bookmarks', path: 'Other bookmarks', depth: 0}],
    links: {'10:true': {folder: {id: '10', title: 'Research'}, links, more: false}, '10:false': {folder: {id: '10', title: 'Research'}, links: links.slice(0, 1), more: false}}};
  });
  await ui.locator('#import-bookmarks').click();
  await until(async () => (await ui.locator('#import-folder option').count()) === 4, 'folders listed');
  assert.equal(await ui.evaluate(() => document.activeElement.id), 'import-folder-search');
  assert.equal(await ui.locator('#import-read-folder').isDisabled(), true);
  await ui.locator('#import-folder-search').fill('research');
  assert.equal(await text('#import-folder-status'), '2 of 4 folders. Choose one to import.');
  await ui.locator('#import-folder').selectOption('10');
  assert.equal(await text('#import-folder-status'), '2 of 4 folders. Imports from Bookmarks bar › Research.');
  assert.equal(await ui.locator('#import-subfolders').isChecked(), true);
  await ui.locator('#import-read-folder').click();
  await until(() => ui.locator('#import-plan').isVisible(), 'folder preview');
  assert.equal(await text('#import-source'), 'From the bookmark folder Bookmarks bar › Research and its subfolders · 3 bookmarks');
  assert.deepEqual((await tableRows()).map((row) => [row[1], row.at(-1)]), [['Heat and Health Lab', ''], ['Canopy', ''], ['Bookmarklet', 'Not a web, email or phone address']]);
  assert.equal(await ui.locator('#import-destination option:checked').innerText(), 'A new collection “Research”');
  await ui.locator('#import-subfolders').uncheck();
  await ui.locator('#import-read-folder').click();
  await until(async () => (await text('#import-source')) === 'From the bookmark folder Bookmarks bar › Research · 1 bookmark', 'without subfolders');
  await ui.locator('#import-subfolders').check();
  await ui.locator('#import-read-folder').click();
  await until(async () => (await text('#import-source')).endsWith('· 3 bookmarks'), 'with subfolders again');
  await ui.locator('#import-commit').click();
  await notice('Imported 2 links into “Research”.');
  home = await active();
  assert.deepEqual(home.links.map((link) => [link.anchorText, link.imported]), [['Heat and Health Lab', 'Bookmarks › Research'], ['Canopy', 'Bookmarks › Research › Labs']]);
  assert.deepEqual((await ui.evaluate(() => window.__sent.map((message) => message.type))).filter((type) => type.startsWith('bookmarks.') || type.startsWith('import.')),
    ['bookmarks.folders', 'bookmarks.folders', 'bookmarks.folderLinks', 'bookmarks.folderLinks', 'bookmarks.folderLinks', 'import.commit']);
  await ui.locator('#notice button', {hasText: 'Undo'}).click();
  await notice('Import undone: removed 2 links and the collection “Research”.');
  pass('A bookmark folder: asked in the click (simulated decline, then a simulated grant the background refuses), then a simulated bookmarks tree: folders searched and chosen, subfolders on and off, imported with folder paths, and undone');

  /* The 20,000-link limit, and a count while a large file is read. */
  const bigPath = resolve(files, 'large-list.csv');
  await writeFile(bigPath, `Title,URL\n${Array.from({length: 60000}, (_, i) => `Paper ${i} with a realistic title for a large import,https://papers.example.org/volume-${i % 40}/article-${i}.pdf`).join('\n')}\n`);
  await ui.evaluate(() => { window.__progress = []; new MutationObserver(() => window.__progress.push(document.getElementById('import-progress').textContent)).observe(document.getElementById('import-progress'), {childList: true, characterData: true, subtree: true}); });
  started = Date.now();
  await preview(bigPath);
  result.timings.readLargeMs = Date.now() - started;
  const counts = await ui.evaluate(() => window.__progress.filter((line) => / rows so far…$/.test(line)));
  assert.ok(counts.length >= 1, `a count shows while reading (${JSON.stringify(counts)})`);
  assert.deepEqual(await summary(), ['Adds 20,000 links, marked Imported.', 'Skips 40,000 rows: 40,000 are over the 20,000-link limit. You can undo the import.']);
  assert.equal(await text('#import-table-note'), 'Showing the first 100 of 60,000 rows.');
  started = Date.now();
  await ui.locator('#import-commit').click();
  await notice('Imported 20,000 links into “large-list”.', 60000);
  result.timings.import20000Ms = Date.now() - started;
  assert.equal((await active()).links.length, 20000);
  started = Date.now();
  await ui.locator('#notice button', {hasText: 'Undo'}).click();
  await notice('Import undone: removed 20,000 links and the collection “large-list”.', 60000);
  result.timings.undo20000Ms = Date.now() - started;
  pass('A 60,000-row CSV: counted while read, 20,000 links added and the rest skipped as over the limit, then undone', {progress: counts, ...result.timings});

  /* 320 px, labels, and contrast in every theme, light and dark. */
  await preview(csvPath);
  await ui.setViewportSize({width: 320, height: 900});
  await ui.waitForFunction(() => innerWidth === 320);
  assert.equal(await overflow(), false, 'no horizontal overflow at 320 px (the preview table scrolls inside its box)');
  await ui.locator('#collection-switch').click();
  assert.equal(await ui.locator('#import-panel').isVisible(), true);
  assert.equal(await overflow(), false, 'no horizontal overflow in the rail at 320 px, with Import links');
  assert.deepEqual(await unlabeled(), [], 'the rail’s import controls have labels');
  await ui.locator('#rail-done').click();
  assert.deepEqual(await unlabeled(), [], 'every import control has a label');
  await ui.evaluate(() => document.getElementById('import').scrollIntoView());
  await shot('import-320-meteor-light.png');
  await ui.locator('#import-only-skipped').check();
  const pairs = [['heading', '#import-title'], ['source line', '.import .source-line'], ['file name', '.import .source-line .file'], ['map label', '#import-map .map-label'], ['map note', '#import-map .map-note'],
    ['table heading', '#import-table th'], ['row number', '#import-table tr.skip td.num'], ['skipped cell', '#import-table tr.skip td:nth-child(2)'], ['skip reason', '#import-table tr.skip td.why'],
    ['table note', '#import-table-note'], ['summary', '#import-summary-main'], ['summary skips', '#import-summary-skips'], ['commit', '#import-commit'], ['cancel', '#import-cancel'], ['check label', '.import-row .name-check span']];
  const contrast = () => ui.evaluate((pairs) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d', {willReadFrequently: true});
    const rgb = (color) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
    const lum = (c) => c.map((n) => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
    const bg = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c) && !/\/ 0\)$/.test(c)) return c; } return getComputedStyle(document.body).backgroundColor; };
    return pairs.map(([name, selector]) => { const el = document.querySelector(selector); if (!el) return {name, missing: true}; const a = lum(rgb(getComputedStyle(el).color)), b = lum(rgb(bg(el))); return {name, ratio: Math.round(((Math.max(a, b) + .05) / (Math.min(a, b) + .05)) * 100) / 100}; });
  }, pairs);
  const themes = [];
  for (const theme of THEME_IDS) for (const scheme of ['light', 'dark']) {
    await rpc(ui, {type: 'state.mutate', action: {type: 'settings.update', patch: {theme, appearance: scheme}}});
    await until(() => ui.evaluate(([theme, scheme]) => document.documentElement.dataset.theme === theme && document.documentElement.dataset.scheme === scheme, [theme, scheme]), `${theme} ${scheme} applied`);
    // Even with reduced motion, colors change through a 0.01 ms transition: measure once it has ended.
    await until(() => ui.evaluate(() => !document.getAnimations().length), `${theme} ${scheme} settled`);
    const measured = await contrast();
    for (const entry of measured) { assert.ok(!entry.missing, `${theme} ${scheme} ${entry.name} missing`); assert.ok(entry.ratio >= 4.5, `${theme} ${scheme} ${entry.name} contrast ${entry.ratio}`); }
    assert.equal(await overflow(), false, `${theme} ${scheme}: overflow at 320`);
    themes.push({theme, scheme, lowest: measured.reduce((low, entry) => (entry.ratio < low.ratio ? entry : low))});
  }
  await rpc(ui, {type: 'state.mutate', action: {type: 'settings.update', patch: {theme: 'graphite', appearance: 'dark'}}});
  await until(() => ui.evaluate(() => document.documentElement.dataset.theme === 'graphite'), 'graphite dark applied');
  await ui.locator('#import-only-skipped').uncheck();
  await ui.setViewportSize({width: 400, height: 1400});
  await ui.evaluate(() => document.getElementById('import').scrollIntoView());
  await shot('import-panel-graphite-dark.png');
  await rpc(ui, {type: 'state.mutate', action: {type: 'settings.update', patch: {theme: 'meteor', appearance: 'system'}}});
  await ui.locator('#import-cancel').click();
  pass('320 px with no overflow, every control labeled, and text contrast at least 4.5:1 in every theme, light and dark', {themes});

  assert.deepEqual(outbound, [], 'nothing left the extension: files are read in the browser and never uploaded');
  assert.deepEqual(errors, [], 'no page errors');
  pass('No request left the extension while importing, and the page logged no errors');
  result.result = 'PASS';
} catch (error) { result.result = 'FAIL'; result.error = error.stack; console.error(error); process.exitCode = 1; }
finally {
  if (context) await context.close();
  // The two large generated files are rebuilt on each run and not kept with the evidence.
  for (const name of ['too-large.csv', 'large-list.csv']) await rm(resolve(files, name), {force: true});
  result.finished = new Date().toISOString();
  await mkdir(evidence, {recursive: true});
  await writeFile(resolve(evidence, 'imports-browser-results.json'), JSON.stringify(result, null, 2) + '\n');
}
