// Loaded-extension checks for backup and restore and for selecting and removing all, in fresh
// task-owned headless profiles with no optional grants. Seeds data through state.mutate or
// through backup files built in Node, downloads a real backup and reads it back with the model's
// reader, restores it into other fresh profiles through the file chooser, and records one
// synthetic 20,000-link timing. A diagnostic copy of the build without unlimitedStorage shows
// what the permission is for and that a failed restore write changes nothing.
//
//   npm run build
//   LINK_METEOR_EVIDENCE_DIR=.scratch/evidence-backup-restore LINK_METEOR_FIXTURE_PORT=52483 node tests/backup-browser.mjs
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, rm, cp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launch, fixtureServer, rpc, until, evidence, scratch, root} from './helpers/browser.mjs';
import {createState, reduceState, createBackup, readBackup, BACKUP_LIMITS} from '../src/core/model.js';

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const result = {started: new Date().toISOString(), browser: 'Chrome for Testing through Playwright, headless, unpacked extension', profiles: [], checks: [], timings: {}, screenshots: [],
  limits: ['Headless Chrome for Testing on one Mac with synthetic data and no optional grants; not native Allow/Deny, everyday Chrome or other systems.',
    'Timings are one synthetic measurement on this machine, not a performance claim.',
    'Hold-drag access after a restore depends on Chrome grants and the background upkeep; here no site is granted, so the preview lists every hold-drag site.']};
const check = (name, detail = {}) => { result.checks.push({name, status: 'pass', ...detail}); console.log('PASS', name, Object.keys(detail).length ? JSON.stringify(detail) : ''); };
const files = resolve(evidence, 'backup-files');
await mkdir(files, {recursive: true});
const fixture = await fixtureServer();
const contexts = [];
const errors = [];

async function open(profile, {extension} = {}) {
  const name = `backup-${profile}-${stamp}`;
  if (extension) process.env.LINK_METEOR_EXTENSION_PATH = extension;
  try {
    const run = await launch(name, {headless: true});
    contexts.push(run.context);
    result.profiles.push({profile: `.scratch/${name}`, extension: extension ? extension.slice(root.length + 1) : 'dist'});
    for (const page of run.context.pages()) await page.close();
    const ui = await run.context.newPage();
    ui.on('pageerror', (error) => errors.push(`${profile}: ${error.message}`));
    ui.on('console', (message) => { if (message.type() === 'error') errors.push(`${profile} console: ${message.text()}`); });
    await ui.goto(`chrome-extension://${run.id}/ui/workbench.html`);
    await ui.locator('#collection-heading').waitFor();
    await ui.waitForTimeout(200);
    return {ui, context: run.context, id: run.id};
  } finally { if (extension) delete process.env.LINK_METEOR_EXTENSION_PATH; }
}
const state = (ui) => rpc(ui, {type: 'state.get'});
const active = async (ui) => { const s = await state(ui); return s.collections.find((c) => c.id === s.activeCollectionId); };
const stored = (ui) => ui.evaluate(() => chrome.storage.local.get(['linkMeteorState', 'linkMeteorRestoreUndo']));
const text = (ui, selector) => ui.locator(selector).innerText();
const noticeIncludes = (ui, phrase, timeout = 10000) => until(async () => (await ui.locator('#notice').isVisible()) && (await text(ui, '#notice')).includes(phrase), `Notice: ${phrase}`, timeout);
const errorIncludes = (ui, phrase, timeout = 10000) => until(async () => (await ui.locator('#error').isVisible()) && (await text(ui, '#error')).includes(phrase), `Error: ${phrase}`, timeout);
async function choose(ui, path) {
  const [chooser] = await Promise.all([ui.waitForEvent('filechooser'), ui.locator('label[for=backup-file]').click()]);
  await chooser.setFiles(path);
}
async function preview(ui, path, timeout = 15000) {
  await choose(ui, path);
  await until(() => ui.locator('#restore-preview').isVisible(), 'Restore preview', timeout);
  return text(ui, '#restore-preview');
}
// False, or the elements that stick out past the viewport, for the failure message.
const overflow = (ui) => ui.evaluate(() => document.documentElement.scrollWidth > innerWidth
  && [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5 && e.getClientRects().length)
    .slice(0, 8).map((e) => `${e.tagName.toLowerCase()}#${e.id}.${String(e.className?.baseVal ?? e.className)} ${Math.round(e.getBoundingClientRect().right)}px`));
// Sets the viewport and waits until the page has laid out at that width.
async function resize(ui, width, height) {
  await ui.setViewportSize({width, height});
  await ui.waitForFunction((width) => innerWidth === width, width);
  await ui.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}
const shot = async (ui, name, options = {}) => { await ui.screenshot({path: resolve(evidence, name), animations: 'disabled', ...options}); result.screenshots.push(name); };
const contrast = (page, pairs) => page.evaluate((pairs) => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d', {willReadFrequently: true});
  const rgb = (color) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const lum = (c) => c.map((n) => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((s, n, i) => s + n * [.2126, .7152, .0722][i], 0);
  const bg = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c) && !/\/ 0\)$/.test(c)) return c; } return getComputedStyle(document.body).backgroundColor; };
  return pairs.map(([name, selector]) => { const el = document.querySelector(selector); if (!el) return {name, missing: true}; const a = lum(rgb(getComputedStyle(el).color)), b = lum(rgb(bg(el))); return {name, ratio: Math.round(((Math.max(a, b) + .05) / (Math.min(a, b) + .05)) * 100) / 100}; });
}, pairs);
const unlabeled = (ui) => ui.evaluate(() => [...document.querySelectorAll('input,select,textarea,button')].filter((e) => e.getClientRects().length && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby') && !e.labels?.length && !(e.tagName === 'BUTTON' && e.textContent.trim())).map((e) => e.id || e.outerHTML.slice(0, 80)));

// Synthetic links with realistic field lengths (about 600 bytes of JSON each).
const link = (id, overrides = {}) => ({id, anchorText: `Paper ${id}`, accessibleLabel: '', url: `${fixture.base}/papers/${id}.pdf`, originalHref: `/papers/${id}.pdf`,
  sourceUrl: `${fixture.base}/index.html`, sourceTitle: 'Meteor Research Lab — deterministic fixture', frameUrl: `${fixture.base}/index.html`,
  capturedAt: '2026-09-26T12:00:00.000Z', batchId: 'batch-seed', notes: '', tags: [], ...overrides});
const bigLink = (i) => ({id: `big-${String(i).padStart(5, '0')}`, anchorText: `Paper ${i}: a synthetic research source with a realistic title`, accessibleLabel: '',
  url: `https://host-${i % 40}-x.example/papers/2026/volume-${i % 12}/article-${i}.pdf?ref=link-meteor-synthetic`, originalHref: `/papers/2026/volume-${i % 12}/article-${i}.pdf?ref=link-meteor-synthetic`,
  sourceUrl: `${fixture.base}/reading-list/section-${i % 200}?page=${i % 7}&sort=relevance`, sourceTitle: `Synthetic reading list, section ${i % 200}, sorted by relevance`,
  frameUrl: `${fixture.base}/reading-list/section-${i % 200}?page=${i % 7}&sort=relevance`, capturedAt: new Date(Date.UTC(2026, 8, 20, 0, 0, i)).toISOString(),
  batchId: `batch-${String(Math.floor(i / 500)).padStart(3, '0')}-synthetic-large-collection`, notes: i % 10 === 0 ? 'Checked against the source' : '', tags: i % 25 === 0 ? ['core'] : []});

try {
  /* Profile A: seed, back up, read the file back in Node ---------------------------------- */
  const A = await open('a');
  const requests = [];
  A.context.on('request', (request) => requests.push(request.url()));
  const first = (await state(A.ui)).activeCollectionId;
  await rpc(A.ui, {type: 'state.mutate', action: {type: 'links.append', links: [
    link('a1', {anchorText: '=HYPERLINK("https://evil.example")', notes: 'check', tags: ['t']}),
    link('a2', {anchorText: '', accessibleLabel: 'Open illustrated appendix'}),
    link('a3', {anchorText: '<b>bold</b> [x](y)', url: 'mailto:team@example.org?subject=Plan'}),
    link('a4', {anchorText: 'Call', url: 'tel:+12125550123'}),
  ]}});
  await rpc(A.ui, {type: 'state.mutate', action: {type: 'collection.update', id: first, patch: {notes: 'Chapter 2 sources', tags: ['thesis']}}});
  await rpc(A.ui, {type: 'state.mutate', action: {type: 'collection.create', name: 'Admin'}});
  await rpc(A.ui, {type: 'state.mutate', action: {type: 'links.append', links: [link('b1', {url: 'https://admin.example/tickets/1'}), link('b2', {url: 'https://admin.example/tickets/2'})]}});
  await rpc(A.ui, {type: 'state.mutate', action: {type: 'collection.activate', id: first}});
  await rpc(A.ui, {type: 'state.mutate', action: {type: 'settings.update', patch: {holdKey: 'q', holdExceptions: ['https://maps.example'], welcomeSeen: true, exportPrefix: 'link-meteor-research', exportTimestamp: false, exportTimestampFormat: 'date'}}});
  await A.ui.waitForTimeout(300);
  const savedA = await state(A.ui);
  requests.length = 0;
  const [download] = await Promise.all([A.ui.waitForEvent('download'), A.ui.locator('#backup-download').click()]);
  const fileName = download.suggestedFilename();
  assert.match(fileName, /^link-meteor-backup_\d{4}-\d{2}-\d{2}_\d{4}\.json$/, 'the backup name ignores the export name settings');
  const backupPath = resolve(files, fileName);
  await download.saveAs(backupPath);
  await noticeIncludes(A.ui, `Downloaded ${fileName}`);
  const backupText = await readFile(backupPath, 'utf8');
  const backup = readBackup(backupText);
  assert.equal(backup.extensionVersion, '0.3.0');
  assert.deepEqual(backup.state.collections, savedA.collections);
  assert.deepEqual(backup.state.settings, savedA.settings);
  assert.equal(backup.state.activeCollectionId, savedA.activeCollectionId);
  assert.equal(backup.state.collections.reduce((n, c) => n + c.links.length, 0), 6);
  assert.deepEqual(backup.state.settings.holdExceptions, ['https://maps.example']);
  assert.equal(backup.state.settings.exportPrefix, 'link-meteor-research');
  const outbound = requests.filter((url) => !/^(chrome-extension|blob|data):/.test(url));
  assert.deepEqual(outbound, [], 'backing up sends nothing anywhere');
  check('Download a backup: every collection, link, note, tag and setting, read back by readBackup in Node', {fileName, bytes: backupText.length, requestsDuringBackup: requests.length, outbound: 0});

  // Files for the preview, refusal and large-restore checks, built with the model in Node.
  let withSites = reduceState(createState(), {type: 'links.append', links: [link('s1')]});
  withSites = reduceState(withSites, {type: 'settings.update', patch: {holdOrigins: ['https://a.example', 'https://b.example'], holdScope: 'all', holdTrigger: 'modifier'}});
  const sitesPath = resolve(files, 'backup-hold-sites.json');
  await writeFile(sitesPath, JSON.stringify(createBackup(withSites, {extensionVersion: '0.3.0'})));
  const invalid = {
    'not-json.json': ['{"format":', 'This file is not a Link Meteor backup: it is not valid JSON.'],
    'not-a-backup.json': ['[]', 'This file is not a Link Meteor backup.'],
    'newer-format.json': [JSON.stringify({...backup, formatVersion: 2}), 'This backup was made by a newer version of Link Meteor (backup format 2). Update Link Meteor, then restore it.'],
    'bad-url.json': [JSON.stringify({...backup, state: {...backup.state, collections: [{...backup.state.collections[0], links: [{...backup.state.collections[0].links[0], url: 'javascript:alert(1)'}]}, ...backup.state.collections.slice(1)]}}), "This backup can't be restored: link.url must be an HTTP(S), mailto, or tel URL."],
    'oversized.json': [' '.repeat(BACKUP_LIMITS.bytes + 1), 'This backup is larger than 50 MB, the most Link Meteor can restore at once.'],
  };
  for (const [name, [content]] of Object.entries(invalid)) await writeFile(resolve(files, name), content);
  let big = createState();
  big = reduceState(big, {type: 'collection.update', id: big.activeCollectionId, patch: {name: 'Large synthetic collection', notes: '20,000 synthetic links for the restore measurement.', tags: ['synthetic']}});
  big = {...big, collections: [{...big.collections[0], links: Array.from({length: 20000}, (_, i) => bigLink(i))}]};
  const bigBackup = createBackup(big, {createdAt: '2026-09-26T12:00:00.000Z', extensionVersion: '0.3.0'});
  const bigPath = resolve(files, 'backup-20000.json');
  const bigText = JSON.stringify(bigBackup);
  await writeFile(bigPath, bigText);
  result.largeBackup = {links: 20000, fileBytes: Buffer.byteLength(bigText), stateJsonBytes: Buffer.byteLength(JSON.stringify(bigBackup.state))};

  /* Profile B: preview, cancel, merge, Undo after reload, merge twice, refusals, replace ---- */
  const B = await open('b');
  const S0 = await state(B.ui);
  assert.equal(await B.ui.locator('#restore-status').isVisible(), false);
  let shown = await preview(B.ui, backupPath);
  assert.deepEqual(await state(B.ui), S0, 'choosing a file changes nothing');
  for (const phrase of [fileName, 'Made ', 'with Link Meteor 0.3.0', '2 collections · 6 links',
    'Merge', 'Adds 6 links', '1 new collection, 1 joined with a collection here', 'Never on these sites: adds maps.example',
    'Replace', 'Removes 1 empty collection here', 'Restores 2 collections and 6 links from the backup',
    'Hold key: Z → Q', 'Export name prefix: none → link-meteor-research', 'Date in export names: on → off', 'Export date format: date and time → date only', 'Welcome card: not answered → answered']) {
    assert.ok(shown.includes(phrase), `preview shows “${phrase}”:\n${shown}`);
  }
  assert.equal(await B.ui.evaluate(() => document.activeElement?.id), 'restore-title', 'the preview takes focus');
  await B.ui.locator('#restore-cancel').click();
  await until(async () => !(await B.ui.locator('#restore-preview').isVisible()), 'Cancel closes the preview');
  await noticeIncludes(B.ui, 'Restore canceled. Nothing was changed.');
  await preview(B.ui, backupPath);
  await B.ui.keyboard.press('Escape');
  await until(async () => !(await B.ui.locator('#restore-preview').isVisible()), 'Escape closes the preview');
  assert.deepEqual(await state(B.ui), S0);
  check('Restore preview: date, version, counts, what merge adds and skips, what replace removes, settings changes; Cancel and Escape change nothing', {previewLines: shown.split('\n').length});

  shown = await preview(B.ui, sitesPath);
  assert.ok(shown.includes("Hold-drag needs Chrome's access again on a.example, b.example. Until you allow it, hold-drag stays off there."), shown);
  assert.ok(shown.includes("Hold-drag on all sites needs Chrome's access again. Until you allow it, hold-drag runs only on chosen sites."), shown);
  assert.ok(shown.includes('Hold trigger: a letter → Command or Ctrl'), shown);
  assert.ok(shown.includes('Where hold-drag runs: chosen sites → all sites'), shown);
  await B.ui.locator('#restore-cancel').click();
  assert.deepEqual(await state(B.ui), S0);
  check('Preview names the hold-drag sites and all-sites access that Chrome does not grant (checked with chrome.permissions.contains)', {sites: ['a.example', 'b.example']});

  for (const [name, [, message]] of Object.entries(invalid)) {
    await choose(B.ui, resolve(files, name));
    await errorIncludes(B.ui, `${message} Nothing was changed.`);
    assert.equal(await B.ui.locator('#restore-preview').isVisible(), false);
    assert.equal(await B.ui.locator('#backup-file').evaluate((input) => input.value), '');
    await B.ui.locator('#error button').click();
  }
  assert.deepEqual(await state(B.ui), S0);
  check('Invalid files show the reader\'s plain message and change nothing', {files: Object.keys(invalid)});

  await preview(B.ui, backupPath);
  await B.ui.locator('#restore-merge').click();
  await noticeIncludes(B.ui, 'Merged the backup: added 6 links and 1 new collection.');
  const S1 = await state(B.ui);
  assert.deepEqual(S1.collections.map((c) => c.name), ['My research', 'Admin'], 'no second My research');
  assert.equal(S1.collections[0].id, S0.collections[0].id);
  assert.deepEqual(S1.collections[0].links, backup.state.collections[0].links);
  assert.deepEqual(S1.collections[1], backup.state.collections[1]);
  assert.equal(S1.collections[0].notes, 'Chapter 2 sources');
  assert.equal(S1.settings.holdKey, 'z', 'merge keeps single-value settings');
  assert.deepEqual(S1.settings.holdExceptions, ['https://maps.example']);
  await until(async () => (await B.ui.locator('.link-row').count()) === 4, 'The view reloads with the merged links');
  assert.equal(await B.ui.locator('#restore-status').isVisible(), true);
  assert.equal(await B.ui.evaluate(() => document.activeElement?.id), 'restore-undo');
  assert.match(await text(B.ui, '#restore-status-text'), /^Merged a backup, adding 6 links, .+\.$/);
  check('Merge saves planRestore\'s merge through backup.restore, reloads the view and says what changed; no duplicate My research');

  await B.ui.reload(); await B.ui.locator('#collection-heading').waitFor();
  await until(() => B.ui.locator('#restore-status').isVisible(), 'Undo offered again after reopening (backup.status)');
  await B.ui.locator('#restore-undo').click();
  await noticeIncludes(B.ui, 'Restore undone.');
  assert.deepEqual(await state(B.ui), S0, 'Undo puts the previous state back exactly');
  assert.equal(await B.ui.locator('#restore-status').isVisible(), false);
  assert.deepEqual(await rpc(B.ui, {type: 'backup.status'}), {undo: null});
  assert.equal('linkMeteorRestoreUndo' in await stored(B.ui), false, 'Undo frees the snapshot');
  check('Undo after the page is closed and reopened puts the previous state back and clears the snapshot');

  await preview(B.ui, backupPath); await B.ui.locator('#restore-merge').click();
  await noticeIncludes(B.ui, 'Merged the backup: added 6 links');
  const once = await state(B.ui);
  shown = await preview(B.ui, backupPath);
  assert.ok(shown.includes('Adds no links: every one is already here') && shown.includes('Skips 6 links already here'), shown);
  await B.ui.locator('#restore-merge').click();
  await noticeIncludes(B.ui, 'Merged the backup: added nothing new; skipped 6 links already here.');
  assert.deepEqual(await state(B.ui), once, 'restoring the same file twice by merge adds nothing the second time');
  check('Merging the same file twice adds nothing the second time');

  await rpc(B.ui, {type: 'state.mutate', action: {type: 'collection.create', name: 'Made after the restore'}});
  await B.ui.waitForTimeout(200);
  const changed = await state(B.ui); const snapshotBefore = (await stored(B.ui)).linkMeteorRestoreUndo;
  await B.ui.locator('#restore-undo').click();
  await errorIncludes(B.ui, 'Link Meteor changed after this restore, so undoing it now would lose those changes.');
  assert.deepEqual(await state(B.ui), changed);
  assert.deepEqual((await stored(B.ui)).linkMeteorRestoreUndo, snapshotBefore, 'a refused Undo keeps the snapshot');
  assert.equal(await B.ui.locator('#restore-status').isVisible(), true);
  await B.ui.locator('#error button').click();
  await B.ui.locator('#restore-discard').click();
  await noticeIncludes(B.ui, 'Discarded Undo for the last restore.');
  assert.equal(await B.ui.locator('#restore-status').isVisible(), false);
  assert.equal('linkMeteorRestoreUndo' in await stored(B.ui), false, 'discarding frees the snapshot');
  assert.deepEqual(await state(B.ui), changed, 'discarding keeps the restored data');
  check('Undo refuses and says why once anything has changed; Discard Undo frees the snapshot');

  await preview(B.ui, backupPath);
  await B.ui.locator('#restore-replace').click();
  await noticeIncludes(B.ui, 'Replaced everything with the backup: 2 collections and 6 links. Removed 3 collections and 6 links that were here.');
  const replaced = await state(B.ui);
  assert.deepEqual(replaced.collections, backup.state.collections);
  assert.deepEqual(replaced.settings, backup.state.settings);
  assert.equal(replaced.activeCollectionId, backup.state.activeCollectionId);
  assert.equal(replaced.undo, null);
  await B.ui.locator('#restore-undo').click();
  await noticeIncludes(B.ui, 'Restore undone.');
  assert.deepEqual(await state(B.ui), changed);
  check('Replace saves the backup exactly through backup.restore, and Undo brings back what it replaced');

  // Single page: the page checkbox says Select all, and there is no separate Select all N.
  await rpc(B.ui, {type: 'state.mutate', action: {type: 'collection.activate', id: changed.collections[0].id}});
  await until(async () => (await B.ui.locator('.link-row').count()) === 4, 'A collection with one page of links');
  assert.equal(await text(B.ui, '#select-all-label'), 'Select all');
  assert.equal(await B.ui.locator('#select-everything').isVisible(), false);
  check('On a single page the page checkbox reads “Select all”');

  // Layout of the backup panel and preview at 1440 px and 320 px, and focus on the file control.
  await preview(B.ui, sitesPath);
  await resize(B.ui, 1440, 1000);
  assert.equal(await overflow(B.ui), false);
  await shot(B.ui, 'backup-preview-desktop.png');
  await B.ui.locator('#backup-download').focus(); await B.ui.keyboard.press('Tab');
  const fileFocus = await B.ui.evaluate(() => ({id: document.activeElement?.id, outline: getComputedStyle(document.querySelector('label[for=backup-file]')).outlineStyle}));
  assert.deepEqual(fileFocus, {id: 'backup-file', outline: 'solid'}, 'the file control is reachable by keyboard with a visible focus ring');
  assert.deepEqual(await unlabeled(B.ui), []);
  const pairs = [['backup help', '#backup-help'], ['preview source', '.restore-source span:nth-child(2)'], ['mode note', '.restore-mode-note'], ['mode line', '.restore-mode li'],
    ['access warning', '.restore-access'], ['restore choose', 'label[for=backup-file]'], ['replace button', '#restore-replace'], ['select all label', '#select-all-label']];
  const light = await contrast(B.ui, pairs);
  await resize(B.ui, 320, 900);
  await B.ui.locator('#collection-switch').click();
  assert.equal(await overflow(B.ui), false);
  await B.ui.locator('#restore-preview').scrollIntoViewIfNeeded();
  await shot(B.ui, 'backup-preview-320.png');
  await B.ui.emulateMedia({colorScheme: 'dark', reducedMotion: 'reduce'}); await B.ui.waitForTimeout(200);
  const dark = (await contrast(B.ui, pairs)).map((entry) => ({...entry, name: `dark ${entry.name}`}));
  await shot(B.ui, 'backup-preview-320-dark.png');
  await B.ui.emulateMedia({colorScheme: 'light', reducedMotion: 'reduce'});
  await B.ui.locator('#restore-cancel').click();
  await B.ui.locator('#rail-done').click();
  await resize(B.ui, 1440, 1000);
  for (const entry of [...light, ...dark]) { assert.ok(!entry.missing, `${entry.name} missing`); assert.ok(entry.ratio >= 4.5, `${entry.name} contrast ${entry.ratio}`); }
  check('Backup panel and preview: no overflow at 1440 and 320 px, labeled controls, keyboard focus, text contrast at least 4.5:1 in light and dark', {contrast: [...light, ...dark]});

  /* Profile C: a 20,000-link restore, then selecting and removing all ---------------------- */
  const C = await open('c');
  let started = Date.now();
  shown = await preview(C.ui, bigPath, 60000);
  result.timings.previewMs = Date.now() - started;
  assert.ok(shown.includes('1 collection · 20,000 links') && shown.includes('Adds 20,000 links'), shown);
  started = Date.now();
  await C.ui.locator('#restore-replace').click();
  await noticeIncludes(C.ui, 'Replaced everything with the backup: 1 collection and 20,000 links.', 120000);
  result.timings.replaceMs = Date.now() - started;
  await until(async () => (await C.ui.locator('.link-row').count()) === 100, '100 rows per page', 20000);
  assert.match(await text(C.ui, '#page-range'), /^1–100 of 20,000 rows · Page 1 of 200$/);
  const bytesInUse = await C.ui.evaluate(() => chrome.storage.local.getBytesInUse(null));
  assert.ok(bytesInUse > 10 * 1024 * 1024, `storage holds more than Chrome's 10 MB default (${bytesInUse})`);
  const bigState = await active(C.ui);
  assert.deepEqual(bigState.links, bigBackup.state.collections[0].links);
  result.timings.bytesInUseAfterRestore = bytesInUse;
  check('A 20,000-link restore succeeds with unlimitedStorage and the list still renders 100 rows per page', {previewMs: result.timings.previewMs, replaceMs: result.timings.replaceMs, bytesInUse});

  // Contrast of the new review and status controls, light and dark, with the editor open.
  await C.ui.locator('#edit-collection').click();
  const reviewPairs = [['restore status', '#restore-status-text'], ['restore status help', '#restore-status-help'], ['undo restore', '#restore-undo'], ['discard undo', '#restore-discard'],
    ['select all N', '#select-everything'], ['remove all in view', '#remove-view'], ['empty this collection', '#empty-collection'], ['page checkbox label', '#select-all-label']];
  const reviewLight = await contrast(C.ui, reviewPairs);
  await shot(C.ui, 'review-controls-desktop.png');
  await C.ui.emulateMedia({colorScheme: 'dark', reducedMotion: 'reduce'}); await C.ui.waitForTimeout(200);
  const reviewDark = (await contrast(C.ui, reviewPairs)).map((entry) => ({...entry, name: `dark ${entry.name}`}));
  await shot(C.ui, 'review-controls-dark.png');
  await C.ui.emulateMedia({colorScheme: 'light', reducedMotion: 'reduce'});
  await resize(C.ui, 320, 900);
  assert.equal(await overflow(C.ui), false);
  await shot(C.ui, 'review-controls-320.png');
  await resize(C.ui, 1440, 1000);
  await C.ui.locator('#cancel-edit').click();
  for (const entry of [...reviewLight, ...reviewDark]) { assert.ok(!entry.missing, `${entry.name} missing`); assert.ok(entry.ratio >= 4.5, `${entry.name} contrast ${entry.ratio}`); }
  assert.deepEqual(await unlabeled(C.ui), []);
  check('Review, editor and restore-status controls: text contrast at least 4.5:1 in light and dark, labeled, no overflow at 320 px', {contrast: [...reviewLight, ...reviewDark]});

  // More than one page: Select all N is always there; the page checkbox covers the page.
  assert.equal(await text(C.ui, '#select-all-label'), 'Select page');
  assert.equal(await C.ui.locator('#select-everything').isVisible(), true);
  assert.equal(await text(C.ui, '#select-everything'), 'Select all 20,000');
  // The same steps as tests/extended-browser.mjs lines 23–24, which must keep passing unedited.
  await C.ui.locator('#select-all').check(); await C.ui.locator('#page-next').click();
  assert.match(await text(C.ui, '#page-range'), /101–200/);
  assert.match(await text(C.ui, '#selection-count'), /^100 selected · 0 on this page$/);
  assert.equal(await C.ui.locator('.row-select:checked').count(), 0);
  await C.ui.locator('#page-prev').click(); await C.ui.locator('#select-all').uncheck();
  assert.equal(await C.ui.locator('#select-everything').isVisible(), true, 'Select all N stays visible without a selection');
  await C.ui.locator('#select-everything').click();
  assert.match(await text(C.ui, '#selection-count'), /^20,000 selected · 100 on this page$/);
  assert.equal(await C.ui.locator('#select-everything').isDisabled(), true);
  await C.ui.locator('#clear-selection').click();
  await C.ui.locator('#search').fill('Paper 1999:');
  await until(async () => (await C.ui.locator('.link-row').count()) === 1, 'Single-page search');
  assert.equal(await text(C.ui, '#select-all-label'), 'Select all');
  assert.equal(await C.ui.locator('#select-everything').isVisible(), false);
  await C.ui.locator('#search').fill('');
  await until(async () => (await C.ui.locator('.link-row').count()) === 100, 'Search cleared');
  check('“Select all N” is always visible with more than one page; the extended suite\'s page-selection steps still pass');

  const order = bigState.links.map((item) => item.id);
  await C.ui.locator('#filters-toggle').click();
  await C.ui.locator('#domain').fill('host-7-x');
  await until(async () => /of 500 rows/.test(await text(C.ui, '#page-range')), 'Filtered view of 500 links on 5 pages');
  await C.ui.locator('#remove-view').click();
  assert.equal(await C.ui.locator('#remove-view-confirm').isVisible(), true);
  assert.equal(await text(C.ui, '#remove-view-confirm-text'), 'Remove all 500 links in this view? The other 19,500 links in “Large synthetic collection” stay. You can undo this.');
  assert.equal(await C.ui.evaluate(() => document.activeElement?.id), 'remove-view-confirm-no');
  await resize(C.ui, 320, 900);
  assert.equal(await overflow(C.ui), false);
  await C.ui.locator('.list-toolbar').scrollIntoViewIfNeeded();
  await shot(C.ui, 'remove-view-confirm-320.png');
  await resize(C.ui, 1440, 1000);
  await C.ui.keyboard.press('Escape');
  assert.equal(await C.ui.locator('#remove-view-confirm').isVisible(), false, 'Escape closes the confirmation');
  assert.equal(await C.ui.evaluate(() => document.activeElement?.id), 'remove-view');
  assert.equal((await active(C.ui)).links.length, 20000);
  await C.ui.locator('#remove-view').click();
  await shot(C.ui, 'remove-view-confirm-desktop.png');
  await C.ui.locator('#remove-view-confirm-yes').click();
  await noticeIncludes(C.ui, 'Removed 500 links from this view.');
  const afterView = await active(C.ui);
  assert.equal(afterView.links.length, 19500);
  assert.ok(afterView.links.every((item) => !item.url.startsWith('https://host-7-x.example/')));
  assert.equal(await C.ui.evaluate(() => document.activeElement?.id), 'undo', 'focus moves to Undo');
  await C.ui.locator('#undo').click();
  await noticeIncludes(C.ui, 'Removal undone.');
  assert.deepEqual((await active(C.ui)).links.map((item) => item.id), order, 'Undo restores every occurrence in place');
  check('“Remove all in this view” confirms with the count, removes every occurrence in the filtered view, and Undo restores them in place; Escape closes it');

  await C.ui.locator('#domain').fill('');
  await C.ui.locator('#filters-toggle').click();
  await C.ui.locator('#edit-collection').click();
  assert.equal(await C.ui.locator('#empty-collection').isEnabled(), true);
  await C.ui.locator('#empty-collection').click();
  assert.equal(await text(C.ui, '#empty-confirm-text'), 'Remove all 20,000 links from “Large synthetic collection”? The collection keeps its name, notes and tags. You can undo this.');
  await C.ui.keyboard.press('Escape');
  assert.equal(await C.ui.locator('#empty-confirm').isVisible(), false, 'Escape closes the confirmation');
  assert.equal(await C.ui.evaluate(() => document.activeElement?.id), 'empty-collection');
  await C.ui.locator('#empty-collection').click();
  await resize(C.ui, 320, 900);
  assert.equal(await overflow(C.ui), false);
  await shot(C.ui, 'empty-confirm-320.png');
  await resize(C.ui, 1440, 1000);
  started = Date.now();
  await C.ui.locator('#empty-confirm-yes').click();
  await noticeIncludes(C.ui, 'Emptied “Large synthetic collection”: removed 20,000 links.', 30000);
  result.timings.emptyMs = Date.now() - started;
  const emptied = await active(C.ui);
  assert.equal(emptied.links.length, 0);
  assert.equal(emptied.name, 'Large synthetic collection'); assert.equal(emptied.notes, bigState.notes); assert.deepEqual(emptied.tags, bigState.tags);
  await until(async () => (await C.ui.evaluate(() => document.activeElement?.id)) === 'empty-undo', 'Focus on the empty view\'s Undo');
  assert.equal(await text(C.ui, '#empty-state h3'), 'This collection is empty');
  await shot(C.ui, 'empty-collection-undo.png');
  started = Date.now();
  await C.ui.locator('#empty-undo').click();
  await noticeIncludes(C.ui, 'Removal undone.', 30000);
  result.timings.emptyUndoMs = Date.now() - started;
  assert.deepEqual((await active(C.ui)).links.map((item) => item.id), order, 'Undo restores every link in order');
  check('“Empty this collection” confirms, removes every link, keeps the collection, and Undo restores them; Escape closes it', {emptyMs: result.timings.emptyMs, undoMs: result.timings.emptyUndoMs});

  await C.ui.locator('#cancel-edit').click();
  // The restore's Undo now refuses, because links changed since the restore.
  await C.ui.locator('#restore-undo').click();
  await errorIncludes(C.ui, 'Link Meteor changed after this restore');
  await C.ui.locator('#error button').click();
  await C.ui.locator('#restore-discard').click();
  await noticeIncludes(C.ui, 'Discarded Undo');
  check('After the large restore, later removals block its Undo, which says why');

  /* Profile D (diagnostic): the same build without unlimitedStorage ------------------------ */
  const variant = resolve(scratch, `dist-no-unlimited-storage-${stamp}`);
  await rm(variant, {recursive: true, force: true});
  await cp(resolve(root, 'dist'), variant, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(variant, 'manifest.json'), 'utf8'));
  manifest.permissions = manifest.permissions.filter((name) => name !== 'unlimitedStorage');
  await writeFile(resolve(variant, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const D = await open('d-no-unlimited', {extension: variant});
  await preview(D.ui, backupPath); await D.ui.locator('#restore-merge').click();
  await noticeIncludes(D.ui, 'Merged the backup');
  const beforeFailure = await stored(D.ui);
  assert.ok(beforeFailure.linkMeteorRestoreUndo, 'an earlier restore snapshot exists');
  await preview(D.ui, bigPath, 60000);
  await D.ui.locator('#restore-replace').click();
  await errorIncludes(D.ui, 'Could not save the restore. Nothing was changed: your collections, settings and any earlier restore Undo are as they were.', 60000);
  assert.deepEqual(await stored(D.ui), beforeFailure, 'the state and the earlier snapshot are unchanged');
  assert.equal(await D.ui.locator('#restore-status').isVisible(), true);
  check('Diagnostic: without unlimitedStorage the 20,000-link restore exceeds Chrome\'s 10 MB storage and fails; the state and the earlier snapshot stay unchanged', {variant: variant.slice(root.length + 1)});

  assert.deepEqual(errors, [], 'no page errors');
  check('No page errors or console errors in any profile');
  result.result = 'PASS';
} catch (error) {
  result.result = 'FAIL'; result.error = error.stack; result.pageErrors = errors; console.error(error); process.exitCode = 1;
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  await fixture.close();
  await rm(resolve(files, 'oversized.json'), {force: true});
  result.finished = new Date().toISOString();
  await writeFile(resolve(evidence, 'backup-browser-results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({result: result.result, checks: result.checks.length, timings: result.timings}));
}
