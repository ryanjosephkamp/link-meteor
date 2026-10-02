// Capture their pages… with a real grant for the sites it names (0.6.0), for the lead's owner
// session. Run it in the per-site profile prepared with tests/prepare-grants.mjs
// (LINK_METEOR_GRANTS=site), with the same fixture port, and before tests/permission-browser.mjs.
//
// It needs ONE native prompt. Three links are selected: one on the fixture site, which the
// profile already allows, and one on each of two sites it doesn't (the same servers at
// "localhost"). The panel names those two sites. When this script clicks "Allow these 2 sites",
// Chrome asks to read and change data on both, in one prompt; the 'awaiting-native-allow' line is
// printed just before that click. The owner, or computer use at the owner's direction, clicks
// Allow. The run then reads all three pages in background tabs.
//
// At the end the two grants are removed again, so the profile is as it was prepared.
// Headed unless LINK_METEOR_GRANTS_HEADLESS=1 (a headless Chrome shows no prompt to click).
//   LINK_METEOR_TEST_PROFILE=<per-site profile> LINK_METEOR_FIXTURE_PORT=<its port> node tests/runs-granted.mjs
// Writes runs-granted-results.json to the evidence folder.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixtureServer, launch, rpc, until, evidence} from './helpers/browser.mjs';
import {secondFixture} from './access-fixture.mjs';

const profile = process.env.LINK_METEOR_TEST_PROFILE;
if (!profile) throw new Error('Set LINK_METEOR_TEST_PROFILE to the profile prepared with LINK_METEOR_GRANTS=site.');
const grantTimeout = Number(process.env.LINK_METEOR_GRANT_TIMEOUT || 180000);
const result = {started: new Date().toISOString(), profile, browser: 'Chrome for Testing via Playwright, real unpacked extension, one native prompt answered by the owner', checks: []};
const pass = (name, data = {}) => { result.checks.push({name, ...data}); console.log('PASS', name, Object.keys(data).length ? JSON.stringify(data) : ''); };
const log = (step, data = {}) => console.log(JSON.stringify({time: new Date().toISOString(), step, ...data}));
const fixture = await fixtureServer();
const second = await secondFixture();
const secondOther = second.base.replace('127.0.0.1', 'localhost');
// The two sites to be allowed, and the three pages.
const needed = [fixture.other, secondOther];
const pages = [`${fixture.base}/site/runs/page.html?of=1&source=allowed`, `${fixture.other}/site/runs/page.html?of=1&source=other`, `${secondOther}/index.html`];
let context, ui;
try {
  const run = await launch(profile, {headless: process.env.LINK_METEOR_GRANTS_HEADLESS === '1'});
  context = run.context;
  for (const old of context.pages()) await old.close();
  ui = await context.newPage();
  await ui.goto(`chrome-extension://${run.id}/ui/workbench.html`); await ui.locator('#collection-heading').waitFor();
  await ui.evaluate(() => { document.title = 'Link Meteor audit — Capture their pages'; });
  await ui.bringToFront();
  await ui.evaluate(async () => { const current = await chrome.windows.getCurrent(); await chrome.windows.update(current.id, {focused: true}); });
  const has = (origins) => ui.evaluate((origins) => chrome.permissions.contains({origins}), origins);
  const before = await ui.evaluate(() => chrome.permissions.getAll());
  result.grantsBefore = before;
  assert.equal(await has([`${fixture.base}/*`]), true, 'Prepare this profile with LINK_METEOR_GRANTS=site and the same fixture port first');
  assert.equal(await has(['http://*/*']), false, 'This check is for the per-site profile, not the all-sites one');
  for (const origin of needed) assert.equal(await has([`${origin}/*`]), false, `${origin} must not be allowed yet`);
  // Records each request the workbench makes, and whether it was made in a click.
  await ui.evaluate(() => { window.__requests = []; const original = chrome.permissions.request.bind(chrome.permissions); chrome.permissions.request = (request) => { window.__requests.push({request, activeGesture: navigator.userActivation.isActive}); return original(request); }; });

  const home = (await rpc(ui, {type: 'state.mutate', action: {type: 'collection.create', name: `Pages to allow ${Date.now()}`}})).activeCollectionId;
  await rpc(ui, {type: 'state.mutate', action: {type: 'links.append', collectionId: home, links: pages.map((url, i) => ({id: `allow-page-${Date.now()}-${i}`, anchorText: `Source ${i + 1}`, accessibleLabel: '', url, originalHref: url,
    sourceUrl: fixture.base, sourceTitle: 'Sources', frameUrl: '', capturedAt: new Date().toISOString(), batchId: 'allow-seed', notes: '', tags: []}))}});
  await until(async () => (await ui.locator('.link-row').count()) === 3, 'the three sources');
  await ui.locator('#select-all').check();
  await ui.locator('#pages-selected').click();
  const hosts = needed.map((origin) => new URL(origin).host);
  await until(async () => (await ui.locator('#pages-access').innerText()) === `Needs access to 2 sites: ${hosts[0]} (1 page), ${hosts[1]} (1 page)`, 'the panel names the two sites it needs');
  assert.equal(await ui.locator('#pages-allow').innerText(), 'Allow these 2 sites');
  assert.equal(await ui.locator('#pages-apply').isDisabled(), true, 'Capture waits for access');
  pass('The panel names exactly the two sites without access; the site already allowed is not asked for again');

  // The one native prompt: it appears when Allow these 2 sites is clicked.
  log('awaiting-native-allow', {origins: needed.map((origin) => `${origin}/*`), via: 'Capture their pages…: Allow these 2 sites', prompt: 'Chrome asks to let Link Meteor read and change your data on both sites, in one prompt. Click Allow.'});
  await ui.locator('#pages-allow').click();
  await until(() => has(needed.map((origin) => `${origin}/*`)), 'the grant for both sites', grantTimeout);
  log('granted', {origins: needed});
  const asked = await ui.evaluate(() => window.__requests);
  assert.deepEqual(asked.map((entry) => entry.request), [{origins: needed.map((origin) => `${origin}/*`)}], 'one request, naming exactly those sites');
  assert.equal(asked[0].activeGesture, true, 'asked in the click');
  assert.equal(await has(['http://*/*']), false, 'nothing wider was granted');
  await until(async () => !(await ui.locator('#pages-apply').isDisabled()), 'Capture is ready');
  assert.equal(await ui.locator('#pages-access').innerText(), 'Link Meteor has access to the 3 sites these pages are on.');
  assert.equal(await ui.locator('#pages-allow').isVisible(), false);
  pass('Allow these 2 sites: one request in the click, for exactly those two sites; the panel then says access is there', {native: 'the owner clicked Allow on Chrome’s prompt'});

  const tabsBefore = context.pages().length;
  await ui.locator('#pages-apply').click();
  await until(async () => /^Captured 3 selected pages: added \d+ links/.test(await ui.locator('#notice .msg').innerText().catch(() => '')), 'the run of three pages', 90000);
  const rows = await ui.locator('#capture-report .run-table tbody tr').evaluateAll((items) => items.map((row) => [...row.cells].map((cell) => cell.innerText)));
  assert.deepEqual(rows.map((row) => [row[0], row[4]]), [['1', 'Captured'], ['2', 'Captured'], ['3', 'Captured']]);
  assert.deepEqual(rows.slice(0, 2).map((row) => [row[2], row[3]]), [['12', '12'], ['12', '12']]);
  const added = (await rpc(ui, {type: 'state.get'})).collections.find((c) => c.id === home).links.filter((link) => link.batchId !== 'allow-seed');
  assert.equal(new Set(added.map((link) => link.batchId)).size, 1, 'one batch');
  assert.deepEqual([...new Set(added.map((link) => new URL(link.sourceUrl).host))], pages.map((url) => new URL(url).host), 'each of the three sites was read');
  assert.equal(context.pages().length, tabsBefore, 'every background tab is closed');
  assert.equal((await ui.evaluate(() => window.__requests)).length, 1, 'no second prompt');
  await ui.locator('#notice button', {hasText: 'Undo'}).click();
  await until(async () => /^Undone: removed \d+ links/.test(await ui.locator('#notice .msg').innerText().catch(() => '')), 'Undo for the run');
  assert.equal((await rpc(ui, {type: 'state.get'})).collections.find((c) => c.id === home).links.length, 3);
  pass('With the two sites allowed, all three pages are read in background tabs and closed, as one batch with one Undo', {links: added.length});

  // The profile goes back to what was prepared.
  await ui.evaluate((origins) => chrome.permissions.remove({origins}), needed.map((origin) => `${origin}/*`));
  for (const origin of needed) assert.equal(await has([`${origin}/*`]), false);
  assert.deepEqual((await ui.evaluate(() => chrome.permissions.getAll())).origins.sort(), before.origins.sort(), 'the grants are as they were prepared');
  pass('The two grants are removed again');
  result.result = 'PASS';
} catch (error) {
  result.result = 'FAIL'; result.error = error.stack; console.error(error); process.exitCode = 1;
  log('failed', {error: error.message, uiError: await ui?.locator('#error').innerText().catch(() => ''), requests: await ui?.evaluate(() => window.__requests).catch(() => null)});
} finally {
  if (context) await context.close();
  await fixture.close(); await second.close();
  result.finished = new Date().toISOString();
  await writeFile(resolve(evidence, 'runs-granted-results.json'), JSON.stringify(result, null, 2) + '\n');
}
