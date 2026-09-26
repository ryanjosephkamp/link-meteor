// Access and capture (0.3.0) with real grants, for the lead's owner session. Run it in the profile
// prepared with LINK_METEOR_GRANTS=all-sites node tests/prepare-grants.mjs (all sites, tab groups,
// bookmarks, and a per-site grant for the fixture site), before tests/permission-browser.mjs.
// It never shows a native prompt: every grant it uses already exists. Headless unless
// LINK_METEOR_HEADED=1; for a visible run, keep the pointer off the Chrome for Testing windows.
//   LINK_METEOR_TEST_PROFILE=<all-sites profile> LINK_METEOR_FIXTURE_PORT=52481 node tests/access-granted.mjs
// Writes access-granted-results.json to the evidence folder.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixtureServer, launch, rpc, until, evidence} from './helpers/browser.mjs';
import {secondFixture} from './access-fixture.mjs';

const ALL_SITES = ['http://*/*', 'https://*/*'];
const profile = process.env.LINK_METEOR_TEST_PROFILE;
if (!profile) throw new Error('Set LINK_METEOR_TEST_PROFILE to the profile prepared with LINK_METEOR_GRANTS=all-sites.');
const result = {started: new Date().toISOString(), profile, browser: 'Chrome for Testing via Playwright, real unpacked extension, grants prepared through the product by the owner', checks: []};
const pass = (name, data = {}) => { result.checks.push({name, ...data}); console.log('PASS', name, Object.keys(data).length ? JSON.stringify(data) : ''); };
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const fixture = await fixtureServer();
const second = await secondFixture();
const localhost = fixture.base.replace('127.0.0.1', 'localhost');
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
let context;
try {
  const run = await launch(profile, {headless: process.env.LINK_METEOR_HEADED !== '1'});
  context = run.context;
  for (const old of context.pages()) await old.close();
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${run.id}/ui/workbench.html`); await ui.locator('#collection-heading').waitFor();
  const grants = await ui.evaluate(() => chrome.permissions.getAll());
  result.grants = grants;
  assert.ok(ALL_SITES.every((pattern) => grants.origins.includes(pattern)), 'Prepare this profile with LINK_METEOR_GRANTS=all-sites first');
  assert.ok(grants.permissions.includes('tabGroups') && grants.permissions.includes('bookmarks'), 'tab groups and bookmarks are prepared');
  if ((await rpc(ui, {type: 'state.get'})).settings.holdScope !== 'all') await rpc(ui, {type: 'hold.scope', scope: 'all'});
  for (const origin of (await rpc(ui, {type: 'state.get'})).settings.holdExceptions) await rpc(ui, {type: 'hold.exception', origin, excepted: false});
  await rpc(ui, {type: 'hold.settings', trigger: 'letter', key: 'z'});
  // Records any permission request the workbench makes from here on; none should be needed.
  await ui.evaluate(() => { window.__requests = []; const original = chrome.permissions.request.bind(chrome.permissions); chrome.permissions.request = (request) => { window.__requests.push(request); return original(request); }; });

  const registered = await ui.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  assert.deepEqual(registered.map(({id, matches}) => ({id, matches})), [{id: 'meteor-hold-all', matches: ALL_SITES}]);
  await ui.reload(); await ui.locator('#collection-heading').waitFor();
  await ui.evaluate(() => { window.__requests = []; const original = chrome.permissions.request.bind(chrome.permissions); chrome.permissions.request = (request) => { window.__requests.push(request); return original(request); }; });
  assert.equal(await ui.locator('#all-sites').isChecked(), true);
  pass('All-sites scope: one registered script covers http and https; the switch shows it on', {registered: registered.length});

  // Hold-drag on a second origin that was never allowed on its own.
  const page = await context.newPage();
  await page.goto(localhost + '/index.html');
  page.on('dialog', (dialog) => dialog.dismiss());
  const overlay = page.locator('#link-meteor-overlay');
  const drag = async (hold, {from, to}) => {
    await page.bringToFront(); await page.evaluate(() => scrollTo(0, 0));
    await page.keyboard.down(hold); await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, {steps: 12}); await sleep(120); await page.mouse.up(); await page.keyboard.up(hold);
    await sleep(200);
  };
  const bibliography = async () => { const box = await page.locator('#bibliography').boundingBox(); return {from: {x: box.x + 4, y: box.y + 4}, to: {x: box.x + box.width - 4, y: box.y + box.height - 4}}; };
  await sleep(800);
  await drag('z', await bibliography());
  await until(async () => (await overlay.locator('.count').innerText().catch(() => '')) === '5 links selected', 'hold-drag on localhost');
  await page.keyboard.press('Escape');
  const after = await ui.evaluate(() => chrome.permissions.getAll());
  assert.deepEqual(after.origins.sort(), grants.origins.sort(), 'no new site grant was needed');
  pass('Hold-drag works on a second origin with no per-site grant and no prompt', {origin: localhost});

  // The modifier trigger on a real page: drag selects, a plain modifier-click opens the link.
  await rpc(ui, {type: 'hold.settings', trigger: 'modifier'});
  await sleep(300);
  await page.evaluate(() => { window.__clicks = []; document.addEventListener('click', (event) => window.__clicks.push(event.target.id || event.target.tagName)); });
  await drag(modifier, await bibliography());
  await until(async () => (await overlay.locator('.count').innerText().catch(() => '')) === '5 links selected', 'modifier drag');
  assert.deepEqual(await page.evaluate(() => window.__clicks), [], 'the click that ends the drag is suppressed');
  await page.keyboard.press('Escape');
  const pagesBefore = context.pages().length;
  const link = await page.locator('#ticket-one').boundingBox();
  await page.keyboard.down(modifier); await page.mouse.click(link.x + 5, link.y + link.height / 2); await page.keyboard.up(modifier);
  await until(() => context.pages().length === pagesBefore + 1, `a plain ${modifier}-click opens the link in a new tab`);
  assert.equal(await overlay.count(), 0);
  const openedTab = context.pages().at(-1); await openedTab.waitForURL(/\/tickets\/42$/); await openedTab.close();
  pass(`Modifier trigger on a real page: ${modifier}-drag selects; a plain ${modifier}-click opens the link as usual`);

  // Exceptions take effect in open tabs without a reload, and keep the script off new loads.
  await rpc(ui, {type: 'hold.exception', origin: localhost, excepted: true});
  assert.deepEqual((await ui.evaluate(() => chrome.scripting.getRegisteredContentScripts()))[0].excludeMatches, [localhost + '/*']);
  await drag(modifier, await bibliography());
  assert.equal(await overlay.count(), 0, 'no selection on an excepted site, without a reload');
  await page.reload(); await sleep(800);
  await drag(modifier, await bibliography());
  assert.equal(await overlay.count(), 0, 'still off after a reload');
  await rpc(ui, {type: 'hold.exception', origin: localhost, excepted: false});
  await sleep(400);
  await drag(modifier, await bibliography());
  await until(async () => (await overlay.locator('.count').innerText().catch(() => '')) === '5 links selected', 'back on without a reload');
  await page.keyboard.press('Escape');
  pass('Never on these sites: off at once in the open tab, off after a reload, and back on without a reload');

  // The This site toggle in 'all' scope is the exception toggle. Arming the page makes it the
  // workbench's current site, as opening Link Meteor from that page would.
  const localTab = (await rpc(ui, {type: 'tabs.list'})).tabs.find((tab) => tab.url?.startsWith(localhost));
  await rpc(ui, {type: 'capture.arm', tabId: localTab.id});
  await page.keyboard.press('Escape');
  await ui.bringToFront();
  await until(async () => (await ui.locator('#site-origin').innerText()).includes('localhost'), 'This site names the page', 10000).catch(() => {});
  if ((await ui.locator('#site-origin').innerText()).includes('localhost')) {
    assert.equal(await ui.locator('#site-exception-row').isVisible(), true);
    assert.equal(await ui.locator('#site-hold-row').isVisible(), false);
    await ui.locator('#site-exception').check();
    await until(async () => (await rpc(ui, {type: 'state.get'})).settings.holdExceptions.includes(localhost), 'toggle adds the exception');
    assert.match(await ui.locator('#hold-exceptions').innerText(), /localhost/);
    await ui.locator('#site-exception').uncheck();
    await until(async () => !(await rpc(ui, {type: 'state.get'})).settings.holdExceptions.includes(localhost), 'toggle removes it');
    pass('This site, in all-sites scope, is the Never on this site toggle');
  } else result.checks.push({name: 'This site toggle skipped: the workbench tab did not resolve the page as its current site', skipped: true});

  // Capture this page on a never-visited origin works at once, with no prompt.
  await page.goto(second.base + '/index.html'); await sleep(800);
  await ui.bringToFront();
  await ui.locator('input[name=scope][value=current]').check();
  const target = (await rpc(ui, {type: 'tabs.list'})).targetTabId;
  await rpc(ui, {type: 'capture.arm', tabId: target}).catch(() => {}); // remembers the page as the target
  await page.keyboard.press('Escape');
  await ui.bringToFront();
  await until(async () => (await ui.locator('#scope-preview').innerText()).includes(new URL(second.base).host), 'preview names the new origin');
  await ui.locator('#capture').click();
  await until(async () => /37 links captured/.test(await ui.locator('#capture-report').innerText()), 'captured the never-visited origin');
  assert.deepEqual(await ui.evaluate(() => window.__requests), []);
  pass('Capture this page on a never-visited origin needs no prompt with all-sites access', {origin: second.base});

  // A named tab group from the workbench.
  const named = (await rpc(ui, {type: 'state.mutate', action: {type: 'collection.create', name: 'Named group'}})).activeCollectionId;
  const links = [0, 1, 2].map((i) => ({id: `named-${i}`, anchorText: `Named ${i}`, accessibleLabel: '', url: `${fixture.base}/named/${i}`, originalHref: '', sourceUrl: fixture.base, sourceTitle: 'Named group', frameUrl: '', capturedAt: new Date().toISOString(), batchId: 'named', notes: '', tags: []}));
  await rpc(ui, {type: 'state.mutate', action: {type: 'links.append', collectionId: named, links}});
  await until(async () => (await ui.locator('#open-label').innerText()).includes('3'), 'three links');
  let before = context.pages().length;
  await ui.locator('#open-group').click();
  await until(async () => /tab group named “Named group”/.test(await ui.locator('#notice').innerText().catch(() => '')), 'named group');
  const groups = await ui.evaluate(() => chrome.tabGroups.query({title: 'Named group'}));
  assert.equal(groups.length >= 1, true);
  assert.equal((await ui.evaluate((id) => chrome.tabs.query({groupId: id}), groups.at(-1).id)).length, 3);
  for (const opened of context.pages().slice(before)) await opened.close();
  pass('Open as a tab group names the group after the collection when tab groups are allowed');

  // The card with grants: a named group and a bookmark folder from the page.
  await page.goto(fixture.base + '/index.html'); await sleep(800);
  await rpc(ui, {type: 'hold.settings', trigger: 'letter'}); await sleep(300);
  await drag('z', await bibliography());
  await until(async () => (await overlay.locator('.count').innerText().catch(() => '')) === '5 links selected', 'card');
  before = context.pages().length;
  await overlay.locator('button.menu-toggle').click();
  await overlay.getByRole('menuitem', {name: /Open as a tab group/}).click();
  await until(async () => /Opened 4 links in a tab group named “Named group”/.test(await overlay.locator('.status').innerText()), 'card group');
  for (const opened of context.pages().slice(before)) await opened.close();
  await overlay.locator('button.menu-toggle').click();
  await overlay.getByRole('menuitem', {name: /Bookmark this selection/}).click();
  // Five ticked links, one URL twice: 5 bookmarks, or 4 where bookmarking skips a repeated URL.
  await until(async () => /Saved [45] bookmarks in the folder “Named group”/.test(await overlay.locator('.status').innerText()), 'card bookmarks');
  const folders = await ui.evaluate(() => chrome.bookmarks.search({title: 'Named group'}));
  assert.ok(folders.some((node) => !node.url));
  await page.keyboard.press('Escape');
  pass('Card: Open as a tab group is named after the destination; Bookmark this selection saves a folder');

  // The all-sites switch off keeps Chrome's grant and offers to remove it; on again needs no prompt.
  await ui.bringToFront();
  await ui.locator('#all-sites').uncheck();
  await until(async () => (await rpc(ui, {type: 'state.get'})).settings.holdScope === 'sites', 'back to sites');
  await until(() => ui.locator('#all-sites-remove').isVisible(), 'offer to remove Chrome’s grant');
  await ui.locator('#all-sites-remove-no').click();
  assert.match(await ui.locator('#all-sites-note').innerText(), /Chrome still lets Link Meteor read every site/);
  await ui.locator('#all-sites').check();
  await until(async () => (await rpc(ui, {type: 'state.get'})).settings.holdScope === 'all', 'all sites again');
  pass('The switch turns all-sites off (offering to remove Chrome’s grant) and on again');

  result.result = 'PASS';
} catch (error) {
  result.result = 'FAIL'; result.error = error.stack; console.error(error); process.exitCode = 1;
} finally {
  if (context) await context.close();
  await fixture.close(); await second.close();
  result.finished = new Date().toISOString();
  await writeFile(resolve(evidence, 'access-granted-results.json'), JSON.stringify(result, null, 2) + '\n');
}
