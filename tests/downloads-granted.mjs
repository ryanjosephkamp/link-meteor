// Downloading files (0.4.0) with Chrome's real download access, for the owner's session. Run it in
// the per-site profile prepared with tests/prepare-grants.mjs, which asks for downloads last, after
// bookmarks, through the Export panel's Download files. It never shows a native prompt: every grant
// it uses already exists. Use the same LINK_METEOR_FIXTURE_PORT as when preparing the profile, so
// the fixture site is the one Chrome allowed. Headless unless LINK_METEOR_HEADED=1.
//   LINK_METEOR_TEST_PROFILE=<per-site profile> LINK_METEOR_FIXTURE_PORT=<port> node tests/downloads-granted.mjs
//
// Where files go: Chrome saves, names and files every download itself (Playwright's download
// handling is switched off), into .scratch/<profile>-downloads, which is the profile's download
// folder preference. Before anything downloads, Chrome's own settings page must report that folder,
// or the run stops (tests/helpers/browser.mjs, chromeDownloads). On macOS and Linux Chrome's home
// folder is under .scratch/ too, so even its fallback is not the Downloads folder. Afterwards the
// suite checks that every new file landed in that folder, and nowhere else.
//
// It downloads the fixture PDF, PNG and sign-in page (the paywall case), a [PDF]-labeled link at an
// address without an extension, and a missing file, from the Export panel, a link's details and the
// capture card; checks each file's bytes and name; confirms above 10; and cancels slow downloads.
// Writes downloads-granted-results.json (relative paths only) to the evidence folder.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readdir, readFile, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join, relative, resolve} from 'node:path';
import {fixtureServer, launch, rpc, until, evidence, root, scratch, downloadsFolder} from './helpers/browser.mjs';
import {downloadFolder} from '../src/core/files.js';

const profile = process.env.LINK_METEOR_TEST_PROFILE;
if (!profile) throw new Error('Set LINK_METEOR_TEST_PROFILE to the per-site profile prepared with node tests/prepare-grants.mjs.');
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
const result = {started: new Date().toISOString(), profile, browser: 'Chrome for Testing via Playwright, real unpacked extension, Chrome’s own downloads; grants prepared through the product by the owner', checks: []};
const pass = (name, data = {}) => { result.checks.push({name, ...data}); console.log('PASS', name, Object.keys(data).length ? JSON.stringify(data) : ''); };
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const folder = downloadsFolder(profile), home = resolve(scratch, `${profile}-home`);
const files = async (dir) => { const out = []; const walk = async (d) => { for (const e of await readdir(d, {withFileTypes: true}).catch(() => [])) { const p = join(d, e.name); if (e.isDirectory()) await walk(p); else out.push(relative(dir, p).split('\\').join('/')); } }; await walk(dir); return out.sort(); };
const fixtureBytes = (name) => readFile(resolve(root, 'tests/fixtures/files', name));
const fixture = await fixtureServer();
const names = {panel: `Downloads check ${stamp}`, card: `Card downloads ${stamp}`, stopped: `Stopped downloads ${stamp}`};
const owner = Object.fromEntries(Object.entries(names).map(([key, name]) => [key, join(homedir(), 'Downloads', ...downloadFolder(name).split('/'))]));
let context;
try {
  for (const path of Object.values(owner)) assert.equal(existsSync(path), false, 'a clean start');
  const before = await files(folder);
  const run = await launch(profile, {headless: process.env.LINK_METEOR_HEADED !== '1', chromeDownloads: true});
  context = run.context;
  pass('Chrome’s settings report the profile’s own download folder under .scratch/, and Playwright’s download handling is off');
  for (const old of context.pages()) await old.close();
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${run.id}/ui/workbench.html`); await ui.locator('#collection-heading').waitFor();
  assert.equal(await ui.evaluate(() => chrome.permissions.contains({permissions: ['downloads']})), true, 'Prepare grants first: node tests/prepare-grants.mjs asks for downloads after bookmarks.');
  // Chrome's prompt must never appear here: any request would mean access is missing.
  await ui.evaluate(() => { window.__requests = []; const original = chrome.permissions.request.bind(chrome.permissions); chrome.permissions.request = (request) => { window.__requests.push(request); return original(request); }; });
  const text = (id) => ui.locator(`#${id}`).innerText();
  const L = (path, anchorText, i, batch) => ({id: `granted-${batch}-${i}`, anchorText, accessibleLabel: '', url: fixture.base + path, originalHref: path, sourceUrl: `${fixture.base}/files.html`, sourceTitle: 'Meteor Research Lab — downloads fixture', frameUrl: '', capturedAt: new Date().toISOString(), batchId: `granted-${batch}`, notes: '', tags: []});
  const FIXTURE = [['/files/paper.pdf', 'Attention in small systems'], ['/files/figure.png', 'Figure 1: heat map'], ['/files/paywalled.pdf', 'Paywalled article'], ['/files/paper', '[PDF] fixture.test'], ['/files/missing.pdf', 'Missing paper'], ['/files/paper.pdf?copy=2', 'Attention in small systems'], ['/index.html', 'The lab’s home page']];
  const collection = async (name, links, batch) => {
    const state = await rpc(ui, {type: 'state.mutate', action: {type: 'collection.create', name}});
    await rpc(ui, {type: 'state.mutate', action: {type: 'links.append', collectionId: state.activeCollectionId, links: links.map(([path, anchor], i) => L(path, anchor, i, batch))}});
    await until(async () => (await text('collection-heading')) === name, `collection ${name}`, 8000);
    return state.activeCollectionId;
  };

  /* The Export panel: six file links, one of them a sign-in page and one missing. */
  await collection(names.panel, FIXTURE, 'panel');
  await until(async () => (await text('downloads-label')) === 'Download 6 files', 'six file links');
  assert.equal(await ui.locator('#downloads-access').isHidden(), true, 'with access granted, the reason steps aside');
  await ui.locator('#downloads-start').click();
  await until(async () => !(await ui.locator('#downloads-result').isHidden()), 'the result', 60000);
  const panelFolder = downloadFolder(names.panel);
  const panelResult = await text('downloads-result');
  assert.match(panelResult, new RegExp(`^Saved 4 files to Link Meteor › ${panelFolder.split('/')[1]} in your downloads folder\\. 1 link gave a web page instead of a file, often a sign-in page\\. 1 download failed\\.`));
  assert.match(panelResult, /“Paywalled article”: gave a web page instead of a file, saved as “Paywalled-article\.html”/);
  assert.match(panelResult, /“Missing paper”: failed: the site says the file isn’t there \(SERVER_BAD_CONTENT\)/);
  const panelFiles = (await files(folder)).filter((path) => path.startsWith(`${panelFolder}/`)).map((path) => path.slice(panelFolder.length + 1));
  assert.deepEqual(panelFiles, ['Attention-in-small-systems (1).pdf', 'Attention-in-small-systems.pdf', 'Figure-1-heat-map.png', 'Paywalled-article.html', 'fixture.test.pdf']);
  const inPanel = (name) => readFile(join(folder, ...panelFolder.split('/'), name));
  assert.deepEqual(await inPanel('Attention-in-small-systems.pdf'), await fixtureBytes('paper.pdf'));
  assert.deepEqual(await inPanel('Attention-in-small-systems (1).pdf'), await fixtureBytes('paper.pdf'));
  assert.deepEqual(await inPanel('fixture.test.pdf'), await fixtureBytes('paper.pdf'), 'the [PDF] link without an extension is a .pdf, from the type Chrome reported');
  assert.deepEqual(await inPanel('Figure-1-heat-map.png'), await fixtureBytes('figure.png'));
  assert.match((await inPanel('Paywalled-article.html')).toString(), /Sign in to continue/, 'the sign-in page is saved as a web page, not a fake PDF');
  pass('Download files saves the PDF, PNG and [PDF] link named after their anchor text, reports the sign-in page and the missing file, and keeps both same-named PDFs', {folder: panelFolder, files: panelFiles, result: panelResult.split('\n')[0]});

  /* Download in a link's details, for one file. */
  const row = ui.locator('.link-row').filter({hasText: 'Figure 1: heat map'}).first();
  await row.locator('.row-details summary').click();
  await row.locator('.occurrence-download button').click();
  await until(async () => /^Saved “Figure-1-heat-map \(1\)\.png”/.test(await row.locator('.occurrence-download .help').innerText()), 'the details download', 30000);
  assert.deepEqual(await inPanel('Figure-1-heat-map (1).png'), await fixtureBytes('figure.png'));
  pass('Download in a link’s details saves that one file into the collection’s folder');

  /* Above 10: a confirmation, then Cancel while the slow files download. Nothing partial stays. */
  await collection(names.stopped, Array.from({length: 11}, (_, i) => [`/files/slow.pdf?n=${i}`, `Slow paper ${i + 1}`]), 'stopped');
  await until(async () => (await text('downloads-label')) === 'Download 11 files…', 'eleven files');
  await ui.locator('#downloads-start').click();
  assert.equal(await ui.locator('#downloads-confirm').isVisible(), true);
  await ui.locator('#downloads-confirm-yes').click();
  await until(async () => /: [0-9]+ done…$/.test(await text('downloads-progress-text')), 'progress');
  await sleep(1500);
  await ui.locator('#downloads-cancel').click();
  await until(async () => !(await ui.locator('#downloads-result').isHidden()), 'the canceled result', 30000);
  assert.equal(await text('downloads-result'), 'Canceled 11 downloads that hadn’t finished.');
  await sleep(1000);
  const stoppedFolder = downloadFolder(names.stopped);
  assert.deepEqual((await files(folder)).filter((path) => path.startsWith(`${stoppedFolder}/`)), [], 'no partial files');
  pass('11 files: confirmed first; Cancel stops the downloads in progress and starts no more, leaving no partial files');

  /* The capture card: Download N files for the ticked file links, into the destination's folder. */
  await collection(names.card, [], 'card');
  const page = await context.newPage();
  await page.goto(`${fixture.base}/files.html`); await page.locator('#files').waitFor();
  const {tabs} = await rpc(ui, {type: 'tabs.list'});
  const tab = tabs.find((item) => item.url === `${fixture.base}/files.html`);
  assert.ok(tab, 'the fixture page is listed: prepare grants first (tabs and the fixture site)');
  await rpc(ui, {type: 'capture.arm', tabId: tab.id});
  await page.bringToFront();
  await page.waitForFunction(() => !!document.getElementById('link-meteor-overlay'));
  const box = await page.locator('#files').boundingBox();
  await page.mouse.move(box.x + 2, box.y + 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height - 2, {steps: 10}); await page.mouse.up();
  const card = page.locator('#link-meteor-overlay');
  await until(async () => (await card.locator('.count').innerText().catch(() => '')) === '7 links selected', 'seven links in the card');
  await card.locator('button.menu-toggle').click();
  assert.equal(await card.locator('.m-files-label').innerText(), 'Download 6 files');
  await card.locator('button.m-files').click();
  await until(async () => /^Saved 4 files/.test(await card.locator('.status').innerText().catch(() => '')), 'the card’s result', 60000);
  const cardFolder = downloadFolder(names.card);
  assert.equal(await card.locator('.status').innerText(), `Saved 4 files to Link Meteor › ${cardFolder.split('/')[1]} in your downloads folder. 1 link gave a web page instead of a file, often a sign-in page. 1 download failed.`);
  const cardFiles = (await files(folder)).filter((path) => path.startsWith(`${cardFolder}/`)).map((path) => path.slice(cardFolder.length + 1));
  assert.deepEqual(cardFiles, panelFiles);
  pass('The card’s Download 6 files saves into the destination collection’s folder and says what arrived', {folder: cardFolder, files: cardFiles});
  await page.keyboard.press('Escape'); await page.close();

  /* Nowhere else: only the expected files are new, under .scratch/<profile>-downloads/Link Meteor. */
  const added = (await files(folder)).filter((path) => !before.includes(path));
  const expected = [...panelFiles.map((name) => `${panelFolder}/${name}`), `${panelFolder}/Figure-1-heat-map (1).png`, ...cardFiles.map((name) => `${cardFolder}/${name}`)].sort();
  assert.deepEqual(added, expected);
  assert.deepEqual((await files(join(home, 'Downloads'))), [], 'Chrome never fell back to its home Downloads folder');
  for (const path of Object.values(owner)) assert.equal(existsSync(path), false, 'nothing in the Downloads folder of the person running the suite');
  const reported = await run.worker.evaluate((names) => chrome.downloads.search({}).then((items) => items.filter((item) => names.some((name) => item.filename.includes(name))).map((item) => item.filename)), Object.values(names).map((name) => downloadFolder(name).split('/')[1]));
  assert.ok(reported.length >= expected.length && reported.every((path) => resolve(path).startsWith(folder + (process.platform === 'win32' ? '\\' : '/'))), 'Chrome reports every file inside the profile’s folder');
  assert.deepEqual(await ui.evaluate(() => window.__requests), [], 'no permission was requested: access already existed');
  pass('Every new file is in the profile’s own download folder, and nowhere else', {added: added.length, where: relative(root, folder).split('\\').join('/')});
  result.result = 'PASS';
} catch (error) {
  result.result = 'FAIL'; result.error = error.stack; console.error(error); process.exitCode = 1;
} finally {
  await context?.close(); await fixture.close();
  result.finished = new Date().toISOString();
  await writeFile(resolve(evidence, 'downloads-granted-results.json'), JSON.stringify(result, null, 2) + '\n');
}
