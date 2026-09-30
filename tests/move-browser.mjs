// Move to… and Copy to… (0.5.0 RC2) in the workbench, with no grants: Chrome for Testing, headless,
// a fresh task-owned profile, the real unpacked build. It seeds two collections and checks, from
// the keyboard where it matters:
// - the buttons show only while links are selected, and the panel says beforehand what happens
//   (links that go, links already there that stay, columns it adds);
// - a move: everything travels, columns are matched by name or created, the page citations the
//   links use go too, and the notice's Undo puts both collections back exactly;
// - a copy to a new collection that isn't opened, whose name is required, and its Undo;
// - Move to… in a link's details, which Escape closes with focus back on it;
// - a link's details show the citation it borrows from a saved page, and why;
// - the 320 px layout, and text contrast in light and dark.
// Nothing is looked up online and nothing downloads.
//   npm run build && node tests/move-browser.mjs
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launch, rpc, until, evidence} from './helpers/browser.mjs';

const profile = process.env.LINK_METEOR_TEST_PROFILE || `move-browser-${Date.now()}`;
const result = {started: new Date().toISOString(), profile, browser: 'Chrome for Testing via Playwright, headless, fresh profile, real unpacked extension, no optional grants', checks: [], screenshots: []};
const pass = (name, data = {}) => { result.checks.push({name, ...data}); console.log('PASS', name, Object.keys(data).length ? JSON.stringify(data) : ''); };
// Rasterizes any CSS color (including oklch) to sRGB, then computes WCAG contrast against the nearest opaque background.
const contrast = (page, pairs) => page.evaluate((pairs) => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d', {willReadFrequently: true});
  const rgb = (color) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const lum = (c) => c.map((n) => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((s, n, i) => s + n * [.2126, .7152, .0722][i], 0);
  const bg = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c) && !/\/ 0\)$/.test(c)) return c; } return getComputedStyle(document.body).backgroundColor; };
  return pairs.map(([name, selector]) => { const el = document.querySelector(selector); if (!el || !el.getClientRects().length) return {name, missing: true}; const a = lum(rgb(getComputedStyle(el).color)), b = lum(rgb(bg(el))); return {name, ratio: Math.round(((Math.max(a, b) + .05) / (Math.min(a, b) + .05)) * 100) / 100}; });
}, pairs);
const overflow = (page) => page.evaluate(async () => { await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))); return document.documentElement.scrollWidth > innerWidth; });

// The seed. Reading: six links, two custom columns, and the citation of arXiv's abstract page (a
// saved tab), which the PDF link borrows. Thesis: a column named "pi" and one link that Reading has too.
const SCHOLAR = 'https://scholar.example.com/scholar?q=splat', ABSTRACT = 'https://arxiv.org/abs/2409.11211';
const at = (i) => new Date(Date.UTC(2026, 8, 20 + i, 10)).toISOString();
const L = (id, anchorText, url, extra = {}) => ({id, anchorText, accessibleLabel: '', url, originalHref: url, sourceUrl: SCHOLAR, sourceTitle: 'Search results', frameUrl: '', capturedAt: at(Number(id.slice(1))), batchId: 'seed', notes: '', tags: [], ...extra});
const ABSTRACT_CITATION = {title: 'SplatFields: Neural Gaussian Splats for Sparse 3D and 4D Reconstruction', authors: ['Mihajlovic, Marko', 'Prokudin, Sergey'], date: '2024/09/17',
  pdfUrl: 'https://arxiv.org/pdf/2409.11211', arxiv: '2409.11211', readAt: '2026-09-30T09:00:00.000Z'};

let context;
try {
  await mkdir(evidence, {recursive: true});
  const run = await launch(profile, {headless: true});
  context = run.context;
  const ui = await context.newPage();
  const errors = []; ui.on('pageerror', (error) => errors.push(error.message));
  await ui.setViewportSize({width: 1440, height: 1000});
  await ui.goto(`chrome-extension://${run.id}/ui/workbench.html`); await ui.locator('#collection-heading').waitFor();
  const state = () => rpc(ui, {type: 'state.get'});
  const byName = async (name) => (await state()).collections.find((item) => item.name === name);
  const notice = () => ui.locator('#notice .msg').innerText();
  const row = (i) => ui.locator('.link-row').nth(i);
  const visibleAnchors = () => ui.locator('.link-row .anchor').allInnerTexts();
  const focusedId = () => ui.evaluate(() => document.activeElement?.id || document.activeElement?.textContent?.trim() || '');
  const shot = async (name, options = {}) => { await ui.evaluate(() => { for (const id of ['notice', 'error']) document.getElementById(id).hidden = true; }); await ui.screenshot({path: resolve(evidence, name), animations: 'disabled', ...options}); result.screenshots.push(name); };
  const withoutTimes = (collection) => { const {updatedAt: _u, ...rest} = collection; return rest; };

  await rpc(ui, {type: 'state.mutate', action: {type: 'settings.update', patch: {welcomeSeen: true}}});
  let s = await rpc(ui, {type: 'state.mutate', action: {type: 'collection.create', name: 'Thesis'}});
  const thesis = s.activeCollectionId;
  await rpc(ui, {type: 'state.mutate', action: {type: 'fields.add', collectionId: thesis, name: 'pi'}});
  await rpc(ui, {type: 'state.mutate', action: {type: 'links.append', collectionId: thesis, links: [L('t1', 'Shared dataset', 'https://data.example.com/shared')]}});
  s = await rpc(ui, {type: 'state.mutate', action: {type: 'collection.create', name: 'Reading'}});
  const reading = s.activeCollectionId;
  await rpc(ui, {type: 'state.mutate', action: {type: 'fields.add', collectionId: reading, name: 'Deadline'}});
  s = await rpc(ui, {type: 'state.mutate', action: {type: 'fields.add', collectionId: reading, name: 'PI'}});
  const [deadline, pi] = s.collections.find((item) => item.id === reading).fields.map((field) => field.id);
  await rpc(ui, {type: 'state.mutate', action: {type: 'links.append', collectionId: reading, links: [
    L('r1', 'Canopy study', 'https://doi.org/10.5555/uhi.2024.0142', {notes: 'Read first', tags: ['heat'], status: 'reading', starred: true, context: 'The canopy study found cooler blocks under trees.', fields: {[deadline]: 'Dec 1', [pi]: 'Okafor'}}),
    L('r2', '[PDF] SplatFields', 'https://arxiv.org/pdf/2409.11211', {fields: {[pi]: 'Mihajlovic'}}),
    L('r3', 'Shared dataset', 'https://data.example.com/shared'),
    L('r4', 'Cool roofs', 'https://doi.org/10.5555/uhi.2022.0310'),
    L('r5', 'SplatFields abstract', ABSTRACT, {sourceUrl: ABSTRACT, sourceTitle: 'arXiv abstract'}),
  ], pages: {[ABSTRACT]: ABSTRACT_CITATION}}});
  await until(async () => (await ui.locator('.link-row').count()) === 5, 'the seeded rows', 8000);

  /* The borrowed citation, in the PDF link's details. */
  await row(1).locator('.row-details summary').click();
  const pdfDetails = row(1).locator('.occurrence');
  await pdfDetails.waitFor();
  assert.deepEqual(await pdfDetails.locator('.occ-label').allInnerTexts(), ['Identifiers', 'Citation']);
  assert.equal(await pdfDetails.locator('.cited-title').innerText(), ABSTRACT_CITATION.title);
  assert.match(await pdfDetails.locator('.cited-note').innerText(), /From the citation tags of “SplatFields: .*”, which names this link as its PDF\. Citation exports use it\./);
  await row(1).locator('.row-details summary').click();
  pass('A link to a PDF shows the citation it borrows from the saved page that names it as its PDF, and says so');

  /* The buttons show only with a selection. */
  assert.deepEqual([await ui.locator('#move-selected').isVisible(), await ui.locator('#copy-selected').isVisible()], [false, false]);
  for (const i of [0, 1, 2]) await row(i).locator('.row-select').check();
  await until(() => ui.locator('#move-selected').isVisible(), 'Move to… shows');
  assert.equal(await ui.locator('#copy-selected').isVisible(), true);

  /* A move, from the keyboard, with a preview of what happens. */
  const before = await state();
  await ui.locator('#move-selected').focus(); await ui.keyboard.press('Enter');
  await until(() => ui.locator('#move-panel').isVisible(), 'the panel opens');
  assert.equal(await focusedId(), 'move-to', 'focus goes to the destination');
  assert.equal(await ui.locator('#move-selected').getAttribute('aria-expanded'), 'true');
  assert.equal(await ui.locator('#move-title').innerText(), 'Move 3 selected links to another collection');
  assert.deepEqual(await ui.locator('#move-to option').allInnerTexts(), ['My research (0 links)', 'Thesis (1 link)', 'New collection…']);
  await ui.locator('#move-to').selectOption(thesis);
  assert.equal(await ui.locator('#move-help').innerText(), 'Moves 2 links to “Thesis”, with their notes, tags, reading status and star, and custom columns. 1 link is already there and stays here. Adds the column “Deadline” there. You can undo this.');
  assert.equal(await ui.locator('#move-apply').innerText(), 'Move 2 links');
  await ui.locator('#move-apply').focus(); await ui.keyboard.press('Enter');
  await until(async () => /^Moved 2 links to “Thesis”/.test(await notice()), 'the move notice');
  assert.equal(await notice(), 'Moved 2 links to “Thesis”. 1 link was already there and stayed here. Added 1 column there.');
  assert.equal(await ui.locator('#move-panel').isVisible(), false);
  assert.deepEqual(await visibleAnchors(), ['Shared dataset', 'Cool roofs', 'SplatFields abstract']);
  const home = await byName('Thesis');
  assert.deepEqual(home.links.map((link) => link.id), ['t1', 'r1', 'r2'], 'ids kept, at the end, in order');
  assert.deepEqual(home.fields.map((field) => field.name), ['pi', 'Deadline']);
  const movedCanopy = home.links[1], original = before.collections.find((item) => item.id === reading).links[0];
  assert.deepEqual(movedCanopy.fields, {[home.fields[1].id]: 'Dec 1', [home.fields[0].id]: 'Okafor'});
  assert.deepEqual([movedCanopy.notes, movedCanopy.tags, movedCanopy.status, movedCanopy.starred, movedCanopy.context, movedCanopy.capturedAt], [original.notes, original.tags, original.status, original.starred, original.context, original.capturedAt]);
  assert.deepEqual(Object.keys(home.pages || {}), [ABSTRACT], 'the citation the PDF link borrows goes with it');
  assert.equal((await state()).activeCollectionId, reading, 'Reading stays open');
  await ui.locator('#notice button', {hasText: 'Undo'}).click();
  await until(async () => /^Move undone/.test(await notice()), 'the Undo notice');
  assert.equal(await notice(), 'Move undone: the links are back where they were.');
  const after = await state();
  assert.deepEqual(after.collections.map(withoutTimes), before.collections.map(withoutTimes), 'both collections are exactly as before');
  assert.deepEqual(await visibleAnchors(), ['Canopy study', '[PDF] SplatFields', 'Shared dataset', 'Cool roofs', 'SplatFields abstract']);
  pass('Move to…: the panel says what happens; everything travels, a repeat stays, a column is matched and one created, the borrowed citation goes too; Undo puts both collections back exactly', {moved: 2, skipped: 1});

  /* A copy to a new collection: the name is required, and the new collection isn't opened. */
  assert.equal(await ui.locator('#copy-selected').isVisible(), false, 'a move clears the selection');
  for (const i of [0, 1, 2]) await row(i).locator('.row-select').check();
  await until(() => ui.locator('#copy-selected').isVisible(), 'Copy to… shows');
  await ui.locator('#copy-selected').click();
  await ui.locator('#move-to').selectOption('__new');
  await until(async () => (await focusedId()) === 'move-new', 'the name field takes focus');
  assert.equal(await ui.locator('#move-help').innerText(), 'Name the new collection.');
  assert.equal(await ui.locator('#move-apply').isDisabled(), true);
  assert.equal(await ui.locator('#move-new').getAttribute('aria-invalid'), 'true');
  await ui.keyboard.type('  Chapter   two ');
  assert.equal(await ui.locator('#move-help').innerText(), 'Copies 3 links to “Chapter two”, with their notes, tags, reading status and star, and custom columns. Adds the columns “Deadline” and “PI” there. You can undo this.');
  await ui.keyboard.press('Enter');
  await until(async () => /^Copied 3 links/.test(await notice()), 'the copy notice');
  assert.equal(await notice(), 'Copied 3 links to “Chapter two”. Added 2 columns there.');
  const chapter = await byName('Chapter two');
  assert.equal(chapter.links.length, 3);
  assert.ok(chapter.links.every((link) => !['r1', 'r2', 'r3'].includes(link.id)), 'copies get new ids');
  assert.equal((await state()).activeCollectionId, reading);
  assert.deepEqual((await byName('Reading')).links.map((link) => link.id), ['r1', 'r2', 'r3', 'r4', 'r5'], 'a copy leaves the source as it was');
  await ui.locator('#notice button', {hasText: 'Undo'}).click();
  await until(async () => /^Copy undone/.test(await notice()), 'the copy Undo notice');
  assert.equal(await notice(), 'Copy undone: removed the copies and “Chapter two”.');
  assert.equal(await byName('Chapter two'), undefined);
  pass('Copy to… a new collection: a name is required; copies get new ids and columns, the source and the open collection stay; Undo removes the new collection');

  /* Move to… in a link's details, and Escape. */
  await ui.locator('#clear-selection').click();
  await row(3).locator('.row-details summary').click();
  const detailButton = row(3).locator('.occurrence-move button');
  await detailButton.waitFor();
  assert.equal(await detailButton.getAttribute('aria-label'), 'Move Cool roofs to another collection');
  await detailButton.click();
  await until(() => ui.locator('#move-panel').isVisible(), 'the panel for one link');
  assert.equal(await ui.locator('#move-title').innerText(), 'Move “Cool roofs” to another collection');
  await ui.keyboard.press('Escape');
  await until(async () => !(await ui.locator('#move-panel').isVisible()), 'Escape closes it');
  assert.equal(await ui.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Move Cool roofs to another collection', 'focus returns to the details button');
  await detailButton.click();
  await ui.locator('#move-to').selectOption(thesis);
  await ui.locator('#move-apply').click();
  await until(async () => /^Moved 1 link to “Thesis”\.$/.test(await notice()), 'the one-link move');
  assert.deepEqual(await visibleAnchors(), ['Canopy study', '[PDF] SplatFields', 'Shared dataset', 'SplatFields abstract']);
  assert.equal((await byName('Thesis')).links.at(-1).id, 'r4');
  pass('Move to… in a link’s details moves that link; Escape closes the panel and returns focus');

  /* 320 px, and contrast in light and dark with the panel open. */
  await ui.setViewportSize({width: 320, height: 900});
  for (const i of [0, 1]) await row(i).locator('.row-select').check();
  await ui.locator('#move-selected').click();
  await ui.locator('#move-to').selectOption('__new');
  assert.equal(await overflow(ui), false, 'the selection buttons and the panel at 320');
  await ui.locator('#move-panel').evaluate((item) => scrollTo(0, item.getBoundingClientRect().top + scrollY - 80)); await shot('move-panel-320.png');
  await ui.setViewportSize({width: 390, height: 900});
  await ui.locator('#move-to').selectOption(thesis);
  await ui.locator('#move-panel').evaluate((item) => scrollTo(0, item.getBoundingClientRect().top + scrollY - 80)); await shot('move-panel-side-panel.png');
  pass('At 320 px nothing overflows with the panel open');
  await ui.setViewportSize({width: 1440, height: 1000});
  const pairs = [['Move to…', '#move-selected'], ['Copy to…', '#copy-selected'], ['panel title', '#move-title'], ['destination label', '#move-panel label'], ['help', '#move-help'], ['Move', '#move-apply'], ['Cancel', '#move-cancel']];
  const measured = [];
  for (const scheme of ['light', 'dark']) {
    await ui.emulateMedia({colorScheme: scheme, reducedMotion: 'reduce'}); await ui.waitForTimeout(250);
    measured.push(...(await contrast(ui, pairs)).map((entry) => ({...entry, name: `${scheme} ${entry.name}`})));
    await ui.locator('#move-panel').evaluate((item) => scrollTo(0, item.getBoundingClientRect().top + scrollY - 80)); await shot(`move-panel-${scheme}.png`);
  }
  for (const entry of measured) { assert.ok(!entry.missing, `${entry.name} missing`); assert.ok(entry.ratio >= 4.5, `${entry.name} contrast ${entry.ratio}`); }
  pass('Text contrast is at least 4.5:1 in light and dark for the buttons and the panel', {measured: measured.length, lowest: Math.min(...measured.map((entry) => entry.ratio))});
  result.contrast = measured;
  assert.deepEqual(errors, [], 'no page errors');
  result.result = 'PASS';
} catch (error) {
  result.result = 'FAIL'; result.error = error.stack; console.error(error); process.exitCode = 1;
} finally {
  await context?.close();
  result.finished = new Date().toISOString();
  await writeFile(resolve(evidence, 'move-browser-results.json'), JSON.stringify(result, null, 2) + '\n');
}
