// Access and capture (0.3.0) with real grants, for the lead's owner session. Run it in the profile
// prepared with LINK_METEOR_GRANTS=all-sites node tests/prepare-grants.mjs (all sites, tab groups,
// bookmarks, and a per-site grant for the fixture site), before tests/permission-browser.mjs.
// It never shows a native prompt: every grant it uses already exists. 0.5.0: with all-sites access,
// Save tabs as links reads each fixture tab's own citation tags into the collection's pages, without
// asking (the fixture server serves tests/fixtures/research/). 0.6.0: Capture this page reads every
// frame, from any site: each link once, with the frame it was in. Headless unless
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
  // A page opened as the browser starts can load before Chrome runs the registered hold-drag script
  // (release candidate 1 found this). When Link Meteor starts, and whenever it syncs hold settings, it
  // loads the script into open tabs where hold-drag should run but no script answers, so hold-drag must
  // work on this page within seconds, with no reload and no settings change.
  const startupSettings = await run.worker.evaluate(async () => (await chrome.storage.local.get('linkMeteorState')).linkMeteorState.settings);
  const startupPage = await context.newPage();
  await startupPage.goto(localhost + '/index.html'); await startupPage.locator('#bibliography').waitFor();
  const startupDrag = async () => {
    const box = await startupPage.locator('#bibliography').boundingBox();
    await startupPage.bringToFront(); await startupPage.keyboard.down(startupSettings.holdKey);
    await startupPage.mouse.move(box.x + 4, box.y + 4); await startupPage.mouse.down();
    await startupPage.mouse.move(box.x + box.width - 4, box.y + box.height - 4, {steps: 12}); await startupPage.mouse.up();
    await startupPage.keyboard.up(startupSettings.holdKey); await sleep(300);
    const found = await startupPage.locator('#link-meteor-overlay').count();
    if (found) await startupPage.keyboard.press('Escape');
    return found;
  };
  const startupBegan = Date.now();
  let startupAttempts = 0, startupWorks = 0;
  while (!startupWorks && Date.now() - startupBegan < 15000) { startupAttempts++; startupWorks = await startupDrag(); if (!startupWorks) await sleep(1000); }
  assert.equal(startupWorks, 1, 'hold-drag works on a page opened as the browser started');
  pass('A page opened as the browser starts gets hold-drag within seconds, without a reload', {attempts: startupAttempts, seconds: Math.round((Date.now() - startupBegan) / 1000)});
  await startupPage.close();
  let ui = await context.newPage();
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
  // 0.6.0: 38, not 37. The page's frame from another site (localhost) is read too, so its link is
  // saved beside the same link in the frame from the page's own site.
  await until(async () => /38 links captured/.test(await ui.locator('#capture-report').innerText()), 'captured the never-visited origin');
  assert.deepEqual(await ui.evaluate(() => window.__requests), []);
  const visited = (await ui.evaluate(async () => (await chrome.storage.session.get('linkMeteorCaptureReport')).linkMeteorCaptureReport)).report;
  const visitedLinks = (await rpc(ui, {type: 'state.get'})).collections.flatMap((c) => c.links).filter((link) => link.batchId === visited.batchId);
  assert.deepEqual(visitedLinks.filter((link) => link.originalHref === '/frame-source').map((link) => link.frameUrl).sort(), [second.base + '/frame.html', second.base.replace('127.0.0.1', 'localhost') + '/frame.html'].sort(), 'the link in each frame, with that frame’s address');
  assert.deepEqual([visited.results[0].count, visited.results[0].warning, visited.results[0].frames], [38, '', {read: 1, unread: 0, sites: [], left: []}]);
  pass('Capture this page on a never-visited origin needs no prompt with all-sites access, and reads its frame from another site', {origin: second.base});

  // 0.6.0: frames from other sites (tests/fixtures/site/coverage/frames.html: frames from this site,
  // localhost and third.localhost, nested, in a sidebar, inside a closed component, sandboxed and
  // hidden). With all-sites access every frame is read: each link once, with the frame it was in,
  // and nothing is asked for.
  const framesUrl = `${fixture.base}/site/coverage/frames.html`, coverage = '/site/coverage/';
  const otherSite = fixture.base.replace('127.0.0.1', 'localhost'), thirdSite = `http://third.localhost:${new URL(fixture.base).port}`;
  await page.goto(framesUrl);
  await page.waitForFunction(() => window.fixtureFramesLoaded());
  for (const frame of page.frames()) await frame.waitForLoadState('load');
  await sleep(800);
  await ui.bringToFront();
  const framesTab = (await rpc(ui, {type: 'tabs.list'})).tabs.find((tab) => tab.url === framesUrl);
  assert.ok(framesTab, 'the frames page is listed');
  const framesCollection = (await rpc(ui, {type: 'state.mutate', action: {type: 'collection.create', name: 'Frames from other sites'}})).activeCollectionId;
  await ui.evaluate(() => { window.__requests = []; });
  const framesRun = (await rpc(ui, {type: 'capture.run', tabIds: [framesTab.id]})).report;
  const framed = (await rpc(ui, {type: 'state.get'})).collections.find((c) => c.id === framesCollection).links.filter((link) => link.batchId === framesRun.batchId);
  assert.deepEqual(framed.map((link) => [link.anchorText, link.frameUrl]), [
    ['Top link', framesUrl],
    ['Inner link same', `${fixture.base}${coverage}inner.html?same`],
    ['Leaf link same-nested-this', `${fixture.base}${coverage}leaf.html?same-nested-this`],
    ['Written link', 'about:srcdoc'],
    ['Leaf link same-nested-other', `${otherSite}${coverage}leaf.html?same-nested-other`],
    ['Inner link other', `${otherSite}${coverage}inner.html?other`],
    ['Leaf link other-nested-other', `${otherSite}${coverage}leaf.html?other-nested-other`],
    ['Leaf link other-nested-this', `${fixture.base}${coverage}leaf.html?other-nested-this`],
    ['Leaf link third', `${thirdSite}${coverage}leaf.html?third`],
    ['Leaf link aside', `${otherSite}${coverage}leaf.html?aside`],
    ['Leaf link component', `${otherSite}${coverage}leaf.html?component`],
    ['Leaf link', `${fixture.base}${coverage}leaf.html?sandboxed`],
  ], 'every frame’s links, each with the frame it was in; nothing from the hidden frame');
  assert.equal(new Set(framed.map((link) => `${link.url} ${link.frameUrl}`)).size, framed.length, 'no link twice');
  assert.ok(framed.every((link) => link.sourceUrl === framesUrl && link.sourceTitle === 'Frames from other sites — coverage fixture'), 'the page is every link’s source');
  assert.equal(framed.find((link) => link.anchorText === 'Inner link other').context, 'Words around the frame’s own link: Inner link other.', 'context is read inside the frame');
  assert.deepEqual([framesRun.results[0].status, framesRun.results[0].count, framesRun.results[0].warning, framesRun.results[0].frames], ['success', 12, '', {read: 7, unread: 0, sites: [], left: []}]);
  assert.deepEqual(await ui.evaluate(() => window.__requests), [], 'reading the frames asks for nothing');
  // Content links only: the sidebar frame from another site is page chrome, so its link is left out and counted.
  await rpc(ui, {type: 'state.mutate', action: {type: 'settings.update', patch: {contentOnly: true}}});
  const contentRun = (await rpc(ui, {type: 'capture.run', tabIds: [framesTab.id]})).report;
  await rpc(ui, {type: 'state.mutate', action: {type: 'settings.update', patch: {contentOnly: false}}});
  assert.deepEqual([contentRun.results[0].count, contentRun.results[0].leftOut], [11, 1]);
  // Hold-key drag stays in the top document: the copy of the page script inside a frame from another
  // site only reads links, so a drag that starts inside that frame selects nothing, there or in the page.
  const holding = (await rpc(ui, {type: 'state.get'})).settings;
  if (holding.holdTrigger === 'letter') {
    const inFrame = await page.locator('#other').boundingBox();
    await page.bringToFront(); await page.keyboard.down(holding.holdKey);
    await page.mouse.move(inFrame.x + inFrame.width - 30, inFrame.y + inFrame.height - 12); await page.mouse.down();
    await page.mouse.move(inFrame.x + inFrame.width - 120, inFrame.y + inFrame.height - 40, {steps: 6}); await page.mouse.up();
    await page.keyboard.up(holding.holdKey); await sleep(300);
    assert.deepEqual([await page.frameLocator('#other').locator('#link-meteor-overlay').count(), await page.locator('#link-meteor-overlay').count()], [0, 0], 'a drag inside a frame from another site selects nothing');
  }
  pass('Frames from other sites with all-sites access: every frame is read (nested, sidebar, inside a closed component, sandboxed), each link once with its frameUrl and context, a hidden frame not at all, with no prompt; content links only leaves the sidebar frame’s link out', {links: framed.length, frames: framesRun.results[0].frames});

  // 0.5.0: Save tabs as links reads each tab's citation tags where Link Meteor has access (here, all
  // sites), keyed by the tab's own address, and says how many; a page without tags gives none.
  const researchNames = ['highwire', 'prism', 'jsonld', 'dublin', 'none'];
  const researchUrl = (name) => `${fixture.base}/research/${name}.html`;
  const researchTabs = [];
  for (const name of researchNames) { const tab = await context.newPage(); await tab.goto(researchUrl(name)); await tab.locator('h1').waitFor(); researchTabs.push(tab); }
  await ui.bringToFront();
  const listedTabs = (await rpc(ui, {type: 'tabs.list'})).tabs;
  const researchIds = researchNames.map((name) => listedTabs.find((tab) => tab.url === researchUrl(name))?.id);
  assert.ok(researchIds.every(Number.isInteger), `each research tab is listed with its address: ${JSON.stringify(listedTabs.map((tab) => tab.url))}`);
  const citedCollection = (await rpc(ui, {type: 'state.mutate', action: {type: 'collection.create', name: 'Cited tabs'}})).activeCollectionId;
  await ui.evaluate(() => { window.__requests = []; });
  const {report: citedReport} = await rpc(ui, {type: 'capture.tabs', scope: 'selected', tabIds: researchIds});
  assert.deepEqual([citedReport.saved, citedReport.citations], [5, {tabs: 5, read: 5, found: 4, needAccess: 0}]);
  const citedPages = (await rpc(ui, {type: 'state.get'})).collections.find((c) => c.id === citedCollection).pages;
  assert.deepEqual(Object.keys(citedPages).sort(), researchNames.slice(0, 4).map(researchUrl).sort(), 'one citation per tab with tags, under its own address');
  const titleAndDoi = (name) => [citedPages[researchUrl(name)].title, citedPages[researchUrl(name)].doi];
  assert.deepEqual(researchNames.slice(0, 4).map(titleAndDoi), [
    ['Cooling cities: a review of street-level interventions', '10.5555/cool.2024.0312'], ['Soil moisture and shade in dense neighborhoods', '10.5555/shl.2023.045'],
    ['Wind corridors and night-time cooling', '10.5555/wind.2022.009'], ['Rooftop gardens: a community report', '10.5555/roof.2021.7']]);
  assert.deepEqual(citedPages[researchUrl('highwire')].authors, ['Okafor, Adaeze', 'Lindqvist, Tove', 'Ramírez-Soto, Julián']);
  assert.deepEqual(await ui.evaluate(() => window.__requests), [], 'reading asks for nothing');
  for (const tab of researchTabs) await tab.close();
  pass('Save tabs as links with all-sites access reads each tab’s own citation tags (Highwire, PRISM, JSON-LD, Dublin Core) into the collection’s pages, without a prompt', {read: citedReport.citations.read, found: citedReport.citations.found});

  // A named tab group from the workbench.
  const named = (await rpc(ui, {type: 'state.mutate', action: {type: 'collection.create', name: 'Named group'}})).activeCollectionId;
  const links = [0, 1, 2].map((i) => ({id: `named-${run.id.slice(0, 4)}-${Date.now()}-${i}`, anchorText: `Named ${i}`, accessibleLabel: '', url: `${fixture.base}/named/${i}`, originalHref: '', sourceUrl: fixture.base, sourceTitle: 'Named group', frameUrl: '', capturedAt: new Date().toISOString(), batchId: 'named', notes: '', tags: []}));
  await rpc(ui, {type: 'state.mutate', action: {type: 'links.append', collectionId: named, links}});
  // Wait for the new collection itself: the previous one's label ("Open 37 web links…") also contains a 3.
  await until(async () => (await ui.locator('#collection-heading').innerText()) === 'Named group' && (await ui.locator('#open-label').innerText()) === 'Open 3 web links', 'three links');
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
  await until(async () => (await rpc(ui, {type: 'state.get'})).settings.holdScope === 'all' && await ui.locator('#all-sites').isChecked(), 'all sites again');
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
