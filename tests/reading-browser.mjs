// Reading status, stars, link details and Insights (0.5.0) in the workbench, with no grants:
// Chrome for Testing, headless, a fresh task-owned profile, the real unpacked build. It seeds one
// collection with research links (context, identifiers, a source page's citation, an imported
// link, statuses and stars) and checks, from the keyboard where it matters:
// - the row badges, including grouped rows;
// - a link's details: Reading (radios) and Star (a toggle) with Undo, Context, Identifiers (Copy,
//   and a DOI link that opens only when clicked), Cited from and Imported from, only where a link has them;
// - Mark as read, Mark as unread, and Star or Unstar for the selection, whose Undo sends one action
//   per earlier value;
// - the Reading and Starred only view options and their chips, against queryLinks();
// - Insights: every number against insights() on the same data, drawn again only when the
//   collection changes, and choosing a site, file type, status or Starred;
// - the 320 px layout, and text contrast in light and dark.
// Nothing is looked up online and nothing downloads.
//   npm run build && LINK_METEOR_FIXTURE_PORT=52540 node tests/reading-browser.mjs
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launch, rpc, until, evidence} from './helpers/browser.mjs';
import {queryLinks} from '../src/core/model.js';
import {insights} from '../src/core/insights.js';

const profile = process.env.LINK_METEOR_TEST_PROFILE || `reading-browser-${Date.now()}`;
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

// The seed: two source pages (one with citation tags), links captured over several weeks.
const review = 'https://review.example.net/articles/cooling-cities';
const portal = 'https://data.example.com/datasets?topic=temperature';
const titles = {[review]: 'Cooling cities: a review of street-level interventions', [portal]: 'Open temperature datasets · Example Data Portal'};
const citation = {title: titles[review], authors: ['Amara Okafor', 'Jun Watanabe'], journal: 'Journal of Example Climate', date: 'March 2025', volume: '12', issue: '3', firstPage: '45', lastPage: '67', doi: '10.5555/cool.2025.0007', readAt: '2026-09-01T10:00:00.000Z'};
const canopyContext = 'Across forty mid-sized cities, the canopy study found that blocks with more than 30% tree cover stayed 2.1 °C cooler at 3 p.m. than blocks with less than 10%, even after accounting for albedo.';
const day = (offset, hour = 10) => new Date(Date.UTC(2026, 7, 3 + offset, hour)).toISOString(); // Monday, August 3, 2026
let n = 0;
const L = (anchorText, url, source, offset, extra = {}) => ({id: `r${++n}`, anchorText, accessibleLabel: '', url, originalHref: url, sourceUrl: source, sourceTitle: titles[source] || '', frameUrl: '', capturedAt: day(offset), batchId: `b${Math.floor(offset / 7)}`, notes: '', tags: [], ...extra});
const LINKS = [
  L('Surface temperature and tree canopy in 40 mid-sized cities', 'https://doi.org/10.5555/uhi.2024.0142', review, 0, {status: 'read', starred: true, context: 'Surface temperature and tree canopy in 40 mid-sized cities is the largest study so far.'}),
  L('the canopy study', 'https://doi.org/10.5555/uhi.2024.0142', review, 1, {status: 'reading', context: canopyContext}),
  L('Preprint', 'https://arxiv.org/abs/2401.12345v2', review, 2, {status: 'reading', starred: true}),
  L('PubMed record', 'https://pubmed.ncbi.nlm.nih.gov/31452104/', review, 3),
  L('Methods (PDF)', 'https://review.example.net/files/methods.pdf', review, 8, {status: 'read'}),
  L('Station data', 'https://data.example.com/station.xlsx', portal, 9),
  L('Book', 'https://openlibrary.org/isbn/9780262033848', portal, 10),
  L('Contact the editors', 'mailto:editors@review.example.net', review, 11),
  L('Heat and Health Lab', 'https://heat-health.example.edu/', '', 22, {imported: 'labs-shortlist.csv, row 2'}),
  L('Methodology notes', 'https://data.example.com/docs/methodology.pdf', portal, 23, {status: 'reading'}),
  L('Cool roofs', 'https://doi.org/10.5555/uhi.2022.0310', review, 24),
  L('PMC article', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6716356/', portal, 24),
];
const BADGES = [['Starred', 'Read', 'DOI'], ['Reading', 'DOI'], ['Starred', 'Reading', 'arXiv'], ['PubMed'], ['Read', 'PDF'], ['XLSX'], ['ISBN'], ['EMAIL'], ['Imported'], ['Reading', 'PDF'], ['DOI'], ['PMC']];

let context;
try {
  await mkdir(evidence, {recursive: true});
  const run = await launch(profile, {headless: true});
  context = run.context;
  const ui = await context.newPage();
  const errors = []; ui.on('pageerror', (error) => errors.push(error.message));
  await ui.setViewportSize({width: 1440, height: 1000});
  await ui.goto(`chrome-extension://${run.id}/ui/workbench.html`); await ui.locator('#collection-heading').waitFor();
  // Records each state.mutate action the page sends, and what Copy writes, without reading the clipboard.
  await ui.evaluate(() => {
    window.__actions = []; window.__copied = [];
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (message) => { if (message?.type === 'state.mutate') window.__actions.push(message.action); return send(message); };
    navigator.clipboard.writeText = async (text) => { window.__copied.push(text); };
  });
  const actions = () => ui.evaluate(() => window.__actions.splice(0));
  const text = (selector) => ui.locator(selector).innerText();
  const notice = () => ui.locator('#notice .msg').innerText();
  const focused = () => ui.evaluate(() => { const el = document.activeElement; return {id: el.id, tag: el.tagName, field: el.dataset.linkField || '', linkId: el.dataset.linkId || '', choice: el.dataset.choice || ''}; });
  const collection = async () => { const state = await rpc(ui, {type: 'state.get'}); return state.collections.find((item) => item.id === state.activeCollectionId); };
  const statusOf = async () => Object.fromEntries((await collection()).links.map((link) => [link.id, [link.status || '', !!link.starred]]));
  const row = (i) => ui.locator('.link-row').nth(i);
  // Opens or closes a row's details and waits until the page has handled it, so the next render keeps it. A render
  // between the click and the details' toggle event (a storage reload, say) redraws the row as it was, so it tries again.
  const toggle = async (i, open) => {
    const done = () => row(i).locator('.row-details').evaluate((item, open) => item.open === open && !!item.querySelector('.occurrence') === open, open);
    for (let attempt = 0; attempt < 3 && !(await done()); attempt++) {
      await row(i).locator('.row-details summary').click();
      try { await until(done, 'details', 1500); } catch { /* tried again */ }
    }
    assert.ok(await done(), `details ${open ? 'open' : 'closed'}`);
  };
  const shot = async (name, options = {}) => { await ui.evaluate(() => { for (const id of ['notice', 'error']) document.getElementById(id).hidden = true; }); await ui.screenshot({path: resolve(evidence, name), animations: 'disabled', ...options}); result.screenshots.push(name); };

  await rpc(ui, {type: 'state.mutate', action: {type: 'settings.update', patch: {welcomeSeen: true}}});
  await rpc(ui, {type: 'state.mutate', action: {type: 'collection.create', name: 'Reading check'}});
  await rpc(ui, {type: 'state.mutate', action: {type: 'links.append', links: LINKS, pages: {[review]: citation}}});
  await until(async () => (await ui.locator('.link-row').count()) === LINKS.length, 'the seeded rows', 8000);
  await actions();

  /* Row badges. */
  for (const [i, expected] of BADGES.entries()) {
    const got = (await row(i).locator('.badge').evaluateAll((items) => items.map((item) => item.textContent)));
    assert.deepEqual(got, expected, `row ${i + 1} badges`);
  }
  assert.deepEqual(await row(0).locator('.badge').allInnerTexts(), ['STARRED', 'READ', 'DOI'], 'badges show in capitals');
  // Grouped by URL: a star when any occurrence is starred, a status only when every occurrence has it.
  await ui.locator('#filters-toggle').click(); await ui.locator('#dedupe').selectOption('url');
  await until(async () => (await ui.locator('.link-row').count()) === LINKS.length - 1, 'grouped rows');
  assert.deepEqual(await row(0).locator('.badge').evaluateAll((items) => items.map((item) => item.textContent)), ['×2', 'Starred', 'DOI']);
  await rpc(ui, {type: 'state.mutate', action: {type: 'links.status', ids: ['r2'], status: 'read'}});
  await until(async () => (await row(0).locator('.badge').evaluateAll((items) => items.map((item) => item.textContent))).join() === '×2,Starred,Read,DOI', 'a shared status shows');
  await rpc(ui, {type: 'state.mutate', action: {type: 'links.status', ids: ['r2'], status: 'reading'}});
  await ui.locator('#dedupe').selectOption('none'); await ui.locator('#filters-toggle').click();
  await until(async () => (await ui.locator('.link-row').count()) === LINKS.length && (await row(1).locator('.badge').evaluateAll((items) => items.map((item) => item.textContent))).join() === 'Reading,DOI', 'every occurrence again, as saved');
  await actions();
  pass('Rows show a star, Reading or Read, the identifier kind and Imported; grouped rows combine them', {rows: BADGES.length});

  /* A link's details, from the keyboard. */
  const pagesBefore = context.pages().length;
  await row(1).locator('.row-details summary').focus(); await ui.keyboard.press('Enter');
  const details = row(1).locator('.occurrence');
  await details.waitFor();
  assert.deepEqual(await details.locator('.occ-label').allInnerTexts(), ['Context', 'Identifiers', 'Cited from']);
  const layout = await details.evaluate((item) => { const box = (el) => el.getBoundingClientRect(); const top = box(item.querySelector('.occ-new')), facts = box(item.querySelector('.facts')); return {first: item.firstElementChild.className, width: Math.round(top.width), factsWidth: Math.round(facts.width), above: top.bottom <= facts.top}; });
  assert.deepEqual(layout, {first: 'occ-new', width: layout.factsWidth, factsWidth: layout.factsWidth, above: true}, 'the new blocks sit above the facts, full width');
  await ui.keyboard.press('Tab');
  assert.deepEqual(await focused(), {id: '', tag: 'INPUT', field: 'status:reading', linkId: 'r2', choice: ''}, 'Tab reaches the checked status');
  assert.equal(await details.locator('.status-seg').getAttribute('role'), 'radiogroup');
  assert.equal(await details.locator('.reading').getAttribute('aria-label'), 'Reading status and star for the canopy study');
  await ui.keyboard.press('ArrowRight');
  await until(async () => (await statusOf()).r2[0] === 'read', 'ArrowRight marks it read');
  await ui.waitForTimeout(300); // the storage reload renders again
  assert.equal((await focused()).field, 'status:read', 'focus stays on the chosen status after the list is drawn again');
  assert.equal(await notice(), 'Marked “the canopy study” as read.');
  assert.deepEqual((await actions()).map((action) => [action.type, action.ids, action.status]), [['links.status', ['r2'], 'read']]);
  await ui.locator('#notice button', {hasText: 'Undo'}).focus(); await ui.keyboard.press('Enter');
  await until(async () => (await statusOf()).r2[0] === 'reading', 'Undo puts Reading back');
  assert.equal(await notice(), 'Put back the earlier reading status of “the canopy study”.');
  assert.equal(await row(1).locator('.status-seg input:checked').getAttribute('value'), 'reading');
  await row(1).locator('.status-seg input:checked').focus(); await ui.keyboard.press('Tab');
  assert.deepEqual(await focused(), {id: '', tag: 'BUTTON', field: 'star', linkId: 'r2', choice: ''}, 'Tab reaches Star');
  assert.deepEqual([await row(1).locator('.star-btn').getAttribute('aria-pressed'), await row(1).locator('.star-btn').innerText()], ['false', 'Star']);
  await ui.keyboard.press('Space');
  await until(async () => (await statusOf()).r2[1] === true, 'Space stars it');
  await ui.waitForTimeout(300);
  assert.deepEqual([await row(1).locator('.star-btn').getAttribute('aria-pressed'), await row(1).locator('.star-btn').innerText(), (await focused()).field], ['true', 'Star', 'star'], 'the label stays Star; pressed says it is starred');
  assert.equal(await notice(), 'Starred “the canopy study”.');
  await ui.locator('#notice button', {hasText: 'Undo'}).click();
  await until(async () => (await statusOf()).r2[1] === false, 'Undo removes the star');
  assert.equal(await row(1).locator('.star-btn').getAttribute('aria-pressed'), 'false');
  assert.deepEqual((await actions()).map((action) => [action.type, action.ids, action.status ?? action.starred]), [['links.status', ['r2'], 'reading'], ['links.star', ['r2'], true], ['links.star', ['r2'], false]]);
  pass('Reading is a radio group and Star a toggle, both from the keyboard; each change saves at once, keeps focus and has Undo');

  // Context, Identifiers and Cited from.
  assert.equal(await details.locator('.context').innerText(), canopyContext);
  assert.equal(await details.locator('.context mark').innerText(), 'the canopy study');
  assert.equal(await details.locator('.context-meta').innerText(), `The words around the link on “${titles[review]}”, as captured. Saved in this browser.`);
  const doi = details.locator('.ident');
  assert.equal(await doi.count(), 1);
  assert.equal(await doi.locator('b').innerText(), 'DOI');
  assert.deepEqual(await doi.locator('a.ident-value').evaluate((a) => ({href: a.href, target: a.target, rel: a.rel, text: a.textContent})), {href: 'https://doi.org/10.5555/uhi.2024.0142', target: '_blank', rel: 'noopener noreferrer', text: '10.5555/uhi.2024.0142'});
  await doi.locator('button', {hasText: 'Copy'}).focus(); await ui.keyboard.press('Enter');
  await until(async () => (await ui.evaluate(() => window.__copied.length)) === 1, 'Copy');
  assert.deepEqual(await ui.evaluate(() => window.__copied.splice(0)), ['10.5555/uhi.2024.0142']);
  assert.equal(await notice(), 'Copied the DOI.');
  assert.equal(await doi.locator('button').getAttribute('aria-label'), 'Copy DOI 10.5555/uhi.2024.0142');
  assert.equal(await details.locator('.cited-title').innerText(), titles[review]);
  assert.equal(await details.locator('.cited-line').innerText(), 'Amara Okafor, Jun Watanabe · Journal of Example Climate, vol. 12, no. 3, pp. 45–67 · March 2025 · DOI 10.5555/cool.2025.0007');
  assert.equal(await details.locator('.cited-note').innerText(), 'From the source page’s own citation tags, read when you captured it. Saved in this browser; nothing was looked up online.');
  assert.equal(context.pages().length, pagesBefore, 'nothing opened on its own');
  pass('Details show the context with the anchor text marked, the DOI with Copy and a doi.org link, and the source page’s citation');

  // Every identifier kind, and only the parts each link has.
  const partsOf = async (i) => {
    await toggle(i, true); const item = row(i).locator('.occurrence');
    const parts = {labels: await item.locator('.occ-label').allInnerTexts(), idents: await item.locator('.ident').evaluateAll((items) => items.map((li) => [li.querySelector('b').textContent, li.querySelector('.ident-value').textContent, li.querySelector('.ident-value').tagName]))};
    if (parts.labels.includes('Imported from')) parts.imported = await item.locator('.imported-from').innerText();
    await toggle(i, false);
    return parts;
  };
  assert.deepEqual(await partsOf(2), {labels: ['Identifiers', 'Cited from'], idents: [['arXiv', '2401.12345v2', 'SPAN']]});
  assert.deepEqual(await partsOf(3), {labels: ['Identifiers', 'Cited from'], idents: [['PubMed', '31452104', 'SPAN']]});
  assert.deepEqual(await partsOf(5), {labels: [], idents: []}, 'a link with none of them shows only Reading');
  assert.deepEqual(await partsOf(6), {labels: ['Identifiers'], idents: [['ISBN', '9780262033848', 'SPAN']]});
  assert.deepEqual(await partsOf(8), {labels: ['Imported from'], idents: [], imported: 'labs-shortlist.csv, row 2'});
  assert.deepEqual(await partsOf(11), {labels: ['Identifiers'], idents: [['PMC', 'PMC6716356', 'SPAN']]});
  assert.equal(await row(5).locator('.row-details[open]').count(), 0);
  pass('Identifiers show for arXiv, PubMed, ISBN and PMC; Imported from shows for imported links; parts a link lacks are left out');
  await toggle(1, false);

  /* Selection actions, with Undo per earlier value. */
  for (const i of [0, 1, 3]) { await row(i).locator('.row-select').focus(); await ui.keyboard.press('Space'); }
  assert.equal(await ui.locator('#reading-actions').isVisible(), true);
  assert.equal(await text('#star-selected-label'), 'Star', 'not every selected link is starred');
  await ui.locator('#mark-unread').focus(); await ui.keyboard.press('Enter');
  await until(async () => { const s = await statusOf(); return s.r1[0] === '' && s.r2[0] === ''; }, 'Mark as unread');
  assert.equal(await notice(), 'Marked 3 links as unread.');
  assert.deepEqual((await actions()).map((action) => [action.type, action.ids, action.status]), [['links.status', ['r1', 'r2'], '']], 'only links whose status changes are sent');
  await ui.locator('#notice button', {hasText: 'Undo'}).click();
  await until(async () => { const s = await statusOf(); return s.r1[0] === 'read' && s.r2[0] === 'reading' && s.r4[0] === ''; }, 'Undo puts each earlier status back');
  assert.deepEqual((await actions()).map((action) => [action.type, action.ids, action.status]), [['links.status', ['r1'], 'read'], ['links.status', ['r2'], 'reading']], 'one action per earlier value');
  assert.equal(await notice(), 'Put back the earlier reading status of 2 links.');
  await ui.locator('#star-selected').focus(); await ui.keyboard.press('Enter');
  await until(async () => { const s = await statusOf(); return s.r1[1] && s.r2[1] && s.r4[1]; }, 'Star');
  assert.equal(await notice(), 'Starred 3 links.');
  await until(async () => (await text('#star-selected-label')) === 'Unstar', 'the button offers Unstar');
  assert.deepEqual((await actions()).map((action) => [action.type, action.ids, action.starred]), [['links.star', ['r2', 'r4'], true]]);
  await ui.locator('#notice button', {hasText: 'Undo'}).click();
  await until(async () => { const s = await statusOf(); return s.r1[1] && !s.r2[1] && !s.r4[1]; }, 'Undo keeps only the earlier star');
  assert.deepEqual((await actions()).map((action) => [action.type, action.ids, action.starred]), [['links.star', ['r2', 'r4'], false]]);
  await ui.locator('#star-selected').click();
  await until(async () => (await text('#star-selected-label')) === 'Unstar', 'Unstar offered');
  await ui.locator('#star-selected').click();
  await until(async () => { const s = await statusOf(); return !s.r1[1] && !s.r2[1] && !s.r4[1]; }, 'Unstar');
  assert.equal(await notice(), 'Unstarred 3 links.');
  await ui.locator('#notice button', {hasText: 'Undo'}).click();
  await until(async () => { const s = await statusOf(); return s.r1[1] && s.r2[1] && s.r4[1]; }, 'Undo of Unstar');
  await rpc(ui, {type: 'state.mutate', action: {type: 'links.star', ids: ['r2', 'r4'], starred: false}});
  await actions();
  await ui.locator('#clear-selection').click();
  assert.equal(await ui.locator('#reading-actions').isVisible(), false, 'hidden without a selection');
  await row(0).locator('.row-select').check();
  await ui.locator('#mark-read').click();
  await until(async () => (await notice()) === 'The selected link is already read.', 'already read');
  assert.deepEqual(await actions(), [], 'nothing is sent when nothing changes');
  await ui.locator('#clear-selection').click();
  pass('Mark as read, Mark as unread, and Star or Unstar work on the selection; Undo sends one action per earlier value');

  /* View options: Reading and Starred only, with chips. */
  const visibleIds = () => ui.locator('.link-row .row-select').evaluateAll((boxes) => boxes.map((box) => box.dataset.rowId));
  const expectIds = async (options) => queryLinks((await collection()).links, options).rows.map((item) => item.id);
  await ui.locator('#filters-toggle').click();
  await ui.locator('#status-filter').selectOption('reading');
  await until(async () => (await visibleIds()).join() === (await expectIds({status: 'reading'})).join(), 'Reading filter');
  assert.deepEqual(await visibleIds(), ['r2', 'r3', 'r10']);
  assert.deepEqual(await ui.locator('#active-filters .chip span').allInnerTexts(), ['Reading status: Reading']);
  await ui.locator('#starred-filter').focus(); await ui.keyboard.press('Space');
  await until(async () => (await visibleIds()).join() === (await expectIds({status: 'reading', starred: true})).join(), 'Starred only');
  assert.deepEqual(await visibleIds(), ['r3']);
  assert.deepEqual(await ui.locator('#active-filters .chip span').allInnerTexts(), ['Reading status: Reading', 'Starred only']);
  assert.equal(await text('#filter-count'), '2');
  await ui.locator('#active-filters button[aria-label="Remove: Starred only"]').focus(); await ui.keyboard.press('Enter');
  await until(async () => (await visibleIds()).length === 3, 'chip removed');
  assert.equal(await ui.locator('#starred-filter').isChecked(), false);
  for (const status of ['unread', 'read']) {
    await ui.locator('#status-filter').selectOption(status);
    await until(async () => (await visibleIds()).join() === (await expectIds({status})).join(), `${status} filter`);
  }
  await ui.locator('#starred-filter').check();
  await ui.locator('#active-filters .chip-reset').click();
  await until(async () => (await visibleIds()).length === LINKS.length, 'Reset view');
  assert.deepEqual([await ui.locator('#status-filter').inputValue(), await ui.locator('#starred-filter').isChecked()], ['any', false]);
  await ui.locator('#filters-toggle').click();
  pass('Reading (Any, Unread, Reading, Read) and Starred only filter the list as queryLinks does, shown as chips that remove them');

  /* Insights: the numbers are insights() on the same links. */
  await ui.locator('#search').fill('no such link');
  await ui.locator('#show-insights').focus(); await ui.keyboard.press('Enter');
  await until(() => ui.locator('#insights').isVisible(), 'Insights shown');
  assert.deepEqual([await ui.locator('#show-insights').getAttribute('aria-pressed'), await ui.locator('#show-links').getAttribute('aria-pressed')], ['true', 'false']);
  assert.deepEqual([await ui.locator('#link-list').isVisible(), await ui.locator('#search').isVisible(), await ui.locator('.list-toolbar').isVisible()], [false, false, false]);
  assert.deepEqual([await text('#result-count'), await ui.locator('#review-title').textContent()], ['For the whole collection', 'Insights']);
  assert.equal((await focused()).id, 'show-insights');
  const checkInsights = async () => {
    const current = await collection();
    const expected = insights(current.links, {pages: current.pages || {}, limit: 12});
    const shown = await ui.evaluate(() => {
      const card = (name) => document.getElementById(`insight-${name}`).closest('.insight');
      const rows = (name) => [...card(name).querySelectorAll('.bar-row')].map((row) => [row.querySelector('.label').textContent, Number(row.querySelector('.num').textContent.replace(/\D/g, '')), row.tagName]);
      const chart = card('captures-over-time-by-week');
      return {
        totals: [...document.querySelectorAll('.totals .total')].map((item) => [Number(item.querySelector('b').textContent.replace(/\D/g, '')), item.querySelector('span').textContent, item.tagName]),
        sites: rows('top-sites'), types: rows('file-types'), status: rows('reading'), repeats: rows('saved-more-than-once'),
        repeatNote: card('saved-more-than-once').querySelector('.note').textContent,
        legend: [...card('other-sites-or-the-same-site').querySelectorAll('.legend li')].map((item) => item.textContent),
        columns: [...chart.querySelectorAll('.columns-chart i')].map((column) => column.getBoundingClientRect().height),
        weeks: [...chart.querySelectorAll('ul.sr-only li')].map((item) => item.textContent),
        axis: [...chart.querySelectorAll('.chart-axis span')].map((item) => item.textContent),
      };
    });
    const labels = await ui.evaluate((weeks) => weeks.map((week) => new Date(`${week.weekStart}T00:00:00Z`).toLocaleDateString(undefined, {month: 'short', day: 'numeric', timeZone: 'UTC'})), expected.timeline);
    assert.deepEqual(shown.totals, [[expected.total, 'links', 'DIV'], [expected.uniqueUrls, 'unique addresses', 'DIV'], [expected.sites, 'sites', 'DIV'], [expected.sourcePages, 'pages captured from', 'DIV'], [expected.withIdentifier, 'with an identifier', 'DIV'], [expected.starred, 'starred', expected.starred ? 'BUTTON' : 'DIV']]);
    assert.deepEqual(shown.sites, expected.topSites.slice(0, 8).map((site) => [site.host, site.count, 'BUTTON']));
    assert.deepEqual(shown.types, expected.fileTypes.map((type) => [type.group, type.count, 'BUTTON']));
    assert.deepEqual(shown.status, [['Unread', expected.status.unread], ['Reading', expected.status.reading], ['Read', expected.status.read]].map(([label, count]) => [label, count, count ? 'BUTTON' : 'DIV']));
    assert.deepEqual(shown.repeats, expected.repeats.top.map((entry) => [entry.anchorText || entry.url, entry.count, 'DIV']));
    assert.equal(shown.repeatNote, `${expected.repeats.addresses} ${expected.repeats.addresses === 1 ? 'address was' : 'addresses were'} saved more than once; ${expected.repeats.differentLabels} of them under different anchor text.`);
    const pct = (value) => `${Math.round((value / expected.total) * 100)}%`;
    const {other, same, unknown} = expected.relation;
    assert.deepEqual(shown.legend, [`Other sites ${other} (${pct(other)})`, `Same site as the page ${same} (${pct(same)})`, ...(unknown ? [`Email, phone or no source page ${unknown} (${pct(unknown)})`] : [])]);
    // Columns drawn to scale: each height over the busiest week's height is its count over the peak.
    const peak = Math.max(...expected.timeline.map((week) => week.count)), tallest = Math.max(...shown.columns);
    assert.equal(shown.columns.length, expected.timeline.length);
    expected.timeline.forEach((week, i) => assert.ok(Math.abs(shown.columns[i] - (week.count / peak) * tallest) <= 1, `week ${week.weekStart}: ${shown.columns[i]} px of ${tallest}`));
    assert.deepEqual(shown.weeks, expected.timeline.map((week, i) => `Week of ${labels[i]}: ${week.count} link${week.count === 1 ? '' : 's'}`));
    const peakWeek = expected.timeline.findIndex((week) => week.count === peak);
    assert.deepEqual(shown.axis, [labels[0], `Peak: ${peak} link${peak === 1 ? '' : 's'}, week of ${labels[peakWeek]}`, labels.at(-1)]);
    return expected;
  };
  const first = await checkInsights();
  assert.deepEqual([first.total, first.starred, first.status, first.timeline.map((week) => week.count)], [12, 2, {unread: 7, reading: 3, read: 2}, [4, 4, 0, 4]], 'the seed is as planned');
  pass('Insights totals, top sites, file types, other or same site, reading, repeats and weekly captures match insights() on the same links', {total: first.total, weeks: first.timeline.length});

  // Drawn again only when the collection changes.
  await ui.evaluate(() => { document.querySelector('#insights .insight').dataset.probe = 'kept'; document.querySelector('#empty-state h3').dataset.probe = 'list'; });
  await rpc(ui, {type: 'state.mutate', action: {type: 'settings.update', patch: {exportPrefix: 'reading-check'}}});
  await until(() => ui.evaluate(() => !document.querySelector('#empty-state h3').dataset.probe), 'the settings change renders the page (the empty list is drawn again)');
  assert.equal(await ui.evaluate(() => document.querySelector('#insights .insight').dataset.probe), 'kept', 'a settings change does not redraw the cards');
  await rpc(ui, {type: 'state.mutate', action: {type: 'links.status', ids: ['r6'], status: 'read'}});
  await until(() => ui.evaluate(() => !document.querySelector('#insights .insight').dataset.probe), 'a collection change redraws the cards');
  const second = await checkInsights();
  assert.equal(second.status.read, first.status.read + 1);
  pass('Insights are drawn again when the collection changes, and not for other changes');

  // Choosing a site, a file type, a status and Starred shows those links, from the keyboard.
  const option = (card, label) => ui.locator(`#insight-${card} ~ .bars button.bar-row`, {has: ui.locator('.label', {hasText: new RegExp(`^${label.replace(/[.]/g, '\\.')}$`)})});
  const choose = async (target, expectedIds, chip, check) => {
    if (!(await ui.locator('#insights').isVisible())) { await ui.locator('#show-insights').click(); await until(() => ui.locator('#insights').isVisible(), 'Insights again'); }
    assert.equal(await target.count(), 1, chip);
    await target.focus(); await ui.keyboard.press('Enter');
    await until(async () => (await ui.locator('#link-list').isVisible()) && (await visibleIds()).join() === expectedIds.join(), `choice ${chip}`);
    assert.equal((await focused()).id, 'show-links', 'focus goes to the Links switch');
    assert.equal(await ui.locator('#show-links').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await ui.locator('#active-filters .chip span').allInnerTexts(), [chip]);
    assert.equal(await ui.locator('#search').inputValue(), '', 'the search is cleared');
    assert.equal(await text('#result-count'), `${expectedIds.length} of ${LINKS.length} links`);
    await check();
  };
  await choose(option('top-sites', 'data.example.com'), await expectIds({site: 'data.example.com'}), 'Site: data.example.com', async () => assert.equal(await ui.locator('#site-filter').inputValue(), 'data.example.com'));
  assert.equal((await visibleIds()).length, second.topSites.find((item) => item.host === 'data.example.com').count);
  await choose(option('file-types', 'PDF'), await expectIds({typeGroup: 'PDF'}), 'Type: PDF', async () => assert.equal(await ui.locator('#type-group').inputValue(), 'PDF'));
  assert.equal((await visibleIds()).length, second.fileTypes.find((type) => type.group === 'PDF').count);
  await choose(option('reading', 'Read'), await expectIds({status: 'read'}), 'Reading status: Read', async () => assert.equal(await ui.locator('#status-filter').inputValue(), 'read'));
  assert.equal((await visibleIds()).length, second.status.read);
  await choose(ui.locator('.totals button.total'), await expectIds({starred: true}), 'Starred only', async () => assert.equal(await ui.locator('#starred-filter').isChecked(), true));
  assert.equal((await visibleIds()).length, second.starred);
  pass('Choosing a site, a file type, a reading status or Starred shows exactly those links, as a view option with its chip');

  // "/" from Insights shows the list and its search; an empty collection shows the list.
  await ui.locator('#show-insights').click(); await until(() => ui.locator('#insights').isVisible(), 'Insights');
  await ui.keyboard.press('/');
  await until(async () => (await focused()).id === 'search', '"/" searches the list');
  assert.equal(await ui.locator('#insights').isVisible(), false);
  await ui.locator('#show-insights').click(); await until(() => ui.locator('#insights').isVisible(), 'Insights');
  const checkId = (await rpc(ui, {type: 'state.get'})).activeCollectionId;
  await rpc(ui, {type: 'state.mutate', action: {type: 'collection.create', name: 'Empty for now'}});
  await until(async () => (await text('#collection-heading')) === 'Empty for now' && !(await ui.locator('#insights').isVisible()), 'an empty collection shows the list');
  assert.deepEqual([await ui.locator('#view-switch').isVisible(), await ui.locator('#review-title').isVisible(), await text('#review-title')], [false, true, 'Links']);
  await rpc(ui, {type: 'state.mutate', action: {type: 'collection.activate', id: checkId}});
  await until(async () => (await text('#collection-heading')) === 'Reading check' && (await ui.locator('#view-switch').isVisible()), 'back');
  await ui.locator('#active-filters .chip button').click();
  pass('"/" in Insights searches the list; an empty collection has no Insights switch and shows the title');

  /* 320 px: no horizontal overflow; details, the selection actions, the view options and Insights. */
  await ui.setViewportSize({width: 320, height: 900});
  await toggle(1, true);
  assert.equal(await overflow(ui), false, 'details at 320');
  const narrow = await row(1).locator('.occurrence').evaluate((item) => { const top = item.querySelector('.occ-new').getBoundingClientRect(), facts = item.querySelector('.facts').getBoundingClientRect(); return Math.round(top.width) === Math.round(facts.width) && top.bottom <= facts.top; });
  assert.equal(narrow, true, 'full width above the facts at 320');
  await row(1).evaluate((item) => scrollTo(0, item.getBoundingClientRect().top + scrollY - 8)); await shot('reading-details-320.png');
  await toggle(1, false);
  await row(0).locator('.row-select').check(); await row(2).locator('.row-select').check(); await ui.locator('#filters-toggle').click();
  assert.equal(await overflow(ui), false, 'selection actions and view options at 320');
  await ui.locator('#review').evaluate((item) => scrollTo(0, item.getBoundingClientRect().top + scrollY - 8)); await shot('reading-list-320.png');
  await ui.locator('#filters-toggle').click(); await ui.locator('#clear-selection').click();
  await ui.locator('#show-insights').click(); await until(() => ui.locator('#insights').isVisible(), 'Insights at 320');
  assert.equal(await overflow(ui), false, 'Insights at 320');
  await ui.locator('#review').evaluate((item) => scrollTo(0, item.getBoundingClientRect().top + scrollY - 8)); await shot('reading-insights-320.png', {fullPage: true});
  await ui.locator('#show-links').click();
  pass('At 320 px nothing overflows: details full width above the facts, the selection actions, the view options and Insights');

  /* Contrast in light and dark, with every new element on screen. */
  await ui.setViewportSize({width: 1440, height: 1000});
  for (const i of [0, 1, 8]) await toggle(i, true);
  await row(2).locator('.row-select').check(); await ui.locator('#filters-toggle').click();
  const listPairs = [['star badge', '.link-row .badge.star'], ['status badge', '.link-row .badge.status'], ['identifier badge', '.link-row .badge.badge-id'], ['imported badge', '.link-row .badge.imported'],
    ['status choice', '.status-seg label:not(:has(input:checked))'], ['chosen status', '.status-seg label:has(input:checked)'], ['star', '.star-btn[aria-pressed="false"]'], ['starred', '.star-btn[aria-pressed="true"]'],
    ['details label', '.occ-label'], ['context', '.context'], ['context mark', '.context mark'], ['context line', '.context-meta'], ['identifier kind', '.ident b'], ['identifier', '.ident .ident-value'], ['identifier copy', '.ident .link-btn'],
    ['cited title', '.cited-title'], ['cited line', '.cited-line'], ['cited note', '.cited-note'], ['imported from', '.imported-from'],
    ['Links switch', '#show-links'], ['Insights switch', '#show-insights'], ['Mark as read', '#mark-read'], ['Starred only', '.filter-check span']];
  const insightPairs = [['card title', '.insight h3'], ['total', '.total b'], ['total label', '.total span'], ['bar label', '.bar-row .label'], ['bar count', '.bar-row .num'], ['card note', '.insight .note'], ['legend', '.legend li'], ['chart axis', '.chart-axis span'], ['whole collection', '#result-count']];
  const measured = [];
  for (const scheme of ['light', 'dark']) {
    await ui.emulateMedia({colorScheme: scheme, reducedMotion: 'reduce'}); await ui.waitForTimeout(250);
    measured.push(...(await contrast(ui, listPairs)).map((entry) => ({...entry, name: `${scheme} ${entry.name}`})));
    await row(0).evaluate((item) => scrollTo(0, item.getBoundingClientRect().top + scrollY - 60)); await shot(`reading-details-${scheme}.png`);
    await ui.locator('#show-insights').click(); await until(() => ui.locator('#insights').isVisible(), 'Insights');
    measured.push(...(await contrast(ui, insightPairs)).map((entry) => ({...entry, name: `${scheme} ${entry.name}`})));
    await ui.locator('#review').evaluate((item) => scrollTo(0, item.getBoundingClientRect().top + scrollY - 8)); await shot(`reading-insights-${scheme}.png`);
    await ui.locator('#show-links').click(); await until(() => ui.locator('#link-list').isVisible(), 'Links');
  }
  for (const entry of measured) { assert.ok(!entry.missing, `${entry.name} missing`); assert.ok(entry.ratio >= 4.5, `${entry.name} contrast ${entry.ratio}`); }
  pass('Text contrast is at least 4.5:1 in light and dark for the badges, details, switch, selection actions, view options and Insights', {measured: measured.length, lowest: Math.min(...measured.map((entry) => entry.ratio))});
  result.contrast = measured;
  assert.deepEqual(errors, [], 'no page errors');
  result.result = 'PASS';
} catch (error) {
  result.result = 'FAIL'; result.error = error.stack; console.error(error); process.exitCode = 1;
} finally {
  await context?.close();
  result.finished = new Date().toISOString();
  await writeFile(resolve(evidence, 'reading-browser-results.json'), JSON.stringify(result, null, 2) + '\n');
}
