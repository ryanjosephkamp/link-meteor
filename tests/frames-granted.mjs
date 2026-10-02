// Allow these sites (0.6.0) with Chrome's real prompt, for the lead's owner session. Never run in CI.
// Run it in the per-site profile (prepared with `node tests/prepare-grants.mjs`, which grants the
// fixture site, 127.0.0.1), AFTER tests/browser.mjs and the other per-site suites and BEFORE
// tests/permission-browser.mjs, with the same fixture port as the preparation.
//
// ONE native prompt. It appears when this script clicks "Allow these sites" in the capture report,
// and it names two sites: localhost and third.localhost. The line with "awaiting-native-allow" is
// printed just before the click; the owner, or computer use at the owner's direction, clicks Allow.
// Under automation the request may resolve without an observed click, which is not proof of the prompt.
//
// What it checks: Capture this page on tests/fixtures/site/coverage/frames.html reads what the
// fixture site's grant reaches and names the five frames from the two other sites; the click asks
// Chrome once, for exactly those two sites; after Allow the page is read again and only the links
// in those frames (and in the frames inside them) are added, to the same capture, none twice; and
// a new capture then reads every frame with no prompt. At the end it removes the two grants it was
// given, so the profile is as it was prepared and the per-site suites can run again.
//   LINK_METEOR_TEST_PROFILE=<per-site profile> LINK_METEOR_FIXTURE_PORT=<port> node tests/frames-granted.mjs
// Writes frames-granted-results.json to the evidence folder.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixtureServer, launch, rpc, until, evidence} from './helpers/browser.mjs';

const profile = process.env.LINK_METEOR_TEST_PROFILE;
if (!profile) throw new Error('Set LINK_METEOR_TEST_PROFILE to the per-site profile prepared with tests/prepare-grants.mjs.');
const grantTimeout = Number(process.env.LINK_METEOR_GRANT_TIMEOUT || 180000);
const result = {started: new Date().toISOString(), profile, browser: 'Chrome for Testing via Playwright, real unpacked extension; one native prompt, answered by the owner', checks: []};
const pass = (name, data = {}) => { result.checks.push({name, ...data}); console.log('PASS', name, Object.keys(data).length ? JSON.stringify(data) : ''); };
const log = (step, data = {}) => console.log(JSON.stringify({time: new Date().toISOString(), step, ...data}));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const fixture = await fixtureServer();
const coverage = '/site/coverage/', framesUrl = `${fixture.base}${coverage}frames.html`;
const other = fixture.other, third = `http://third.localhost:${new URL(fixture.base).port}`;
const hosts = {other: new URL(other).host, third: new URL(third).host};
const WANTED = [`${other}/*`, `${third}/*`];
let context, ui, settingsBefore;
try {
  const run = await launch(profile, {headless: process.env.LINK_METEOR_GRANTS_HEADLESS === '1'});
  context = run.context;
  for (const old of context.pages()) await old.close();
  const page = await context.newPage();
  await page.goto(framesUrl);
  await page.waitForFunction(() => window.fixtureFramesLoaded());
  for (const frame of page.frames()) await frame.waitForLoadState('load');
  ui = await context.newPage();
  await ui.goto(`chrome-extension://${run.id}/ui/workbench.html`); await ui.locator('#collection-heading').waitFor();
  await ui.evaluate(() => { document.title = 'Link Meteor audit — Allow these sites'; });
  const has = (origins) => ui.evaluate((origins) => chrome.permissions.contains({origins}), origins);
  assert.equal(await has([`${fixture.base}/*`]), true, 'Prepare this profile with tests/prepare-grants.mjs first: it must hold the fixture site’s grant');
  assert.equal(await has(['http://*/*', 'https://*/*']), false, 'Run this in the per-site profile, not the all-sites one');
  // A run that stopped halfway may have left the two grants: start without them.
  if (await has([WANTED[0]]) || await has([WANTED[1]])) { await ui.evaluate((origins) => chrome.permissions.remove({origins}), WANTED); log('removed-earlier-grants', {origins: WANTED}); }
  assert.deepEqual([await has([WANTED[0]]), await has([WANTED[1]])], [false, false]);
  settingsBefore = (await rpc(ui, {type: 'state.get'})).settings;
  await rpc(ui, {type: 'state.mutate', action: {type: 'settings.update', patch: {contentOnly: false, skipSaved: false, saveContext: true}}});
  const home = (await rpc(ui, {type: 'state.mutate', action: {type: 'collection.create', name: `Allow these sites ${Date.now()}`}})).activeCollectionId;
  const links = async (batchId) => (await rpc(ui, {type: 'state.get'})).collections.find((c) => c.id === home).links.filter((link) => link.batchId === batchId);
  const named = (list) => list.map((link) => [link.anchorText, link.frameUrl]);
  const storedReport = async () => (await ui.evaluate(async () => (await chrome.storage.session.get('linkMeteorCaptureReport')).linkMeteorCaptureReport)).report;
  const tab = (await rpc(ui, {type: 'tabs.list'})).tabs.find((item) => item.url === framesUrl);
  assert.ok(tab, 'the frames page is listed (tab access is prepared)');
  await ui.bringToFront();

  // 1. The first reading: what the fixture site's grant reaches (also its sandboxed frame).
  const first = (await rpc(ui, {type: 'capture.run', tabIds: [tab.id]})).report;
  const FIRST = [
    ['Top link', framesUrl], ['Inner link same', `${fixture.base}${coverage}inner.html?same`], ['Leaf link same-nested-this', `${fixture.base}${coverage}leaf.html?same-nested-this`],
    ['Written link', 'about:srcdoc'], ['Leaf link', `${fixture.base}${coverage}leaf.html?sandboxed`],
  ];
  const NOT_READ = `5 frames from other sites weren’t read, because Link Meteor has no access to ${hosts.other} and ${hosts.third}. Allow those sites to include their links.`;
  assert.deepEqual(named(await links(first.batchId)), FIRST);
  assert.deepEqual([first.results[0].status, first.results[0].count, first.results[0].warning, first.results[0].frames.read, first.results[0].frames.unread, first.results[0].frames.sites], ['success', 5, NOT_READ, 1, 5, [other, third]]);
  await until(async () => (await ui.locator('#capture-report').innerText()).includes(NOT_READ), 'the report names the two sites', 15000);
  const allow = ui.locator('#capture-report .report-frames-allow');
  assert.equal(await allow.innerText(), 'Allow these sites');
  pass('With the fixture site’s grant only: its own frames are read (the sandboxed one too), and the report names the five frames from localhost and third.localhost', {links: named(await links(first.batchId)), warning: NOT_READ});

  // 2. Allow these sites: one request, in the click, for exactly the two sites. THE NATIVE PROMPT IS HERE.
  await ui.evaluate(() => { globalThis.grantObservations = []; const original = chrome.permissions.request.bind(chrome.permissions); chrome.permissions.request = (request) => { const entry = {request, activeGesture: navigator.userActivation.isActive}; grantObservations.push(entry); const promise = original(request); promise.then((value) => { entry.granted = value; }, (error) => { entry.error = error.message; }); return promise; }; });
  log('awaiting-native-allow', {origins: WANTED, via: 'Capture report: Allow these sites', prompt: `Chrome asks to allow Link Meteor on ${hosts.other} and ${hosts.third}; click Allow`});
  await allow.click();
  await until(async () => await has(WANTED), 'the two sites allowed', grantTimeout);
  log('granted', {origins: WANTED});
  await until(async () => /Added 7 links from 6 more frames\./.test(await ui.locator('#notice').innerText().catch(() => '')), 'the frames’ links added', 20000);
  const observed = await ui.evaluate(() => grantObservations);
  assert.deepEqual(observed.map((entry) => [entry.request, entry.activeGesture, entry.granted]), [[{origins: WANTED}, true, true]], 'one request, in the click, for exactly the two named sites');
  const ADDED = [
    ['Leaf link same-nested-other', `${other}${coverage}leaf.html?same-nested-other`], ['Inner link other', `${other}${coverage}inner.html?other`],
    ['Leaf link other-nested-other', `${other}${coverage}leaf.html?other-nested-other`], ['Leaf link other-nested-this', `${fixture.base}${coverage}leaf.html?other-nested-this`],
    ['Leaf link third', `${third}${coverage}leaf.html?third`], ['Leaf link aside', `${other}${coverage}leaf.html?aside`], ['Leaf link component', `${other}${coverage}leaf.html?component`],
  ];
  const all = await links(first.batchId);
  assert.deepEqual(named(all), [...FIRST, ...ADDED], 'only the frames’ links were added, to the same capture');
  assert.equal(new Set(all.map((link) => `${link.url} ${link.frameUrl}`)).size, 12, 'no link twice');
  assert.ok(all.every((link) => link.sourceUrl === framesUrl), 'the page is every link’s source');
  const after = await storedReport();
  assert.deepEqual([after.batchId, after.capturedCount, after.results[0].count, after.results[0].warning, after.results[0].frames], [first.batchId, 12, 12, '', {read: 7, unread: 0, sites: [], left: []}]);
  assert.match(await ui.locator('#capture-report').innerText(), /12 links captured/);
  assert.equal(await ui.locator('#capture-report .report-frames-allow').count(), 0, 'nothing is left to allow');
  await ui.screenshot({path: resolve(evidence, 'frames-granted-after-allow.png')});
  pass('Allow these sites: one Chrome prompt for exactly localhost and third.localhost, in the click; then the page is read again and only the links in those frames, and in the frames inside them, join the same capture', {added: named(all).slice(5), observed});

  // 3. A new capture reads every frame at once, and asks for nothing.
  await ui.evaluate(() => { grantObservations.length = 0; });
  const second = (await rpc(ui, {type: 'capture.run', tabIds: [tab.id]})).report;
  const again = await links(second.batchId);
  assert.equal(again.length, 12);
  assert.deepEqual(named(again).map(String).sort(), named(all).map(String).sort(), 'the same twelve links');
  assert.deepEqual([second.results[0].warning, second.results[0].frames, await ui.evaluate(() => grantObservations.length)], ['', {read: 7, unread: 0, sites: [], left: []}, 0]);
  pass('With the two sites allowed, a new capture reads every frame, each link once, with no prompt');
  result.result = 'PASS';
} catch (error) {
  result.result = 'FAIL'; result.error = error.stack; console.error(error); process.exitCode = 1;
  if (ui) log('failed', {error: error.message, notice: await ui.locator('#notice').innerText().catch(() => ''), uiError: await ui.locator('#error').innerText().catch(() => ''), observations: await ui.evaluate(() => globalThis.grantObservations).catch(() => null)});
} finally {
  // Give back what this check was given, and the settings it changed.
  if (ui) {
    try {
      const removed = await ui.evaluate((origins) => chrome.permissions.remove({origins}).catch((error) => String(error.message || error)), WANTED);
      result.removedGrants = {origins: WANTED, removed, left: await ui.evaluate(() => chrome.permissions.getAll())};
      if (settingsBefore) await rpc(ui, {type: 'state.mutate', action: {type: 'settings.update', patch: {contentOnly: settingsBefore.contentOnly, skipSaved: settingsBefore.skipSaved, saveContext: settingsBefore.saveContext}}});
    } catch (error) { result.cleanupError = String(error.message || error); }
  }
  if (context) await context.close();
  await fixture.close();
  result.finished = new Date().toISOString();
  await writeFile(resolve(evidence, 'frames-granted-results.json'), JSON.stringify(result, null, 2) + '\n');
}
