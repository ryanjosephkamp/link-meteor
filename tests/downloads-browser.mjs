// Downloading files (0.4.0) in the workbench, with no grants: Chrome for Testing, headless, a fresh
// task-owned profile, the real unpacked build. It checks the Export panel's Download files section
// (the count of file links, the reason for Chrome's download access next to the button, the
// confirmation above 10, Escape), Download in a link's details, the files the card or the menu
// leave waiting for the full view, and the 320 px layout. Chrome's permission prompt is never
// shown: the workbench's chrome.permissions.request is replaced by a stub that records each request
// and whether the click's gesture was still active, then declines ("simulated decline") or grants
// ("simulated grant", which the background still refuses, because Chrome has granted nothing).
// Nothing downloads in this suite; tests/downloads-granted.mjs downloads for real.
//   npm run build && LINK_METEOR_FIXTURE_PORT=52496 node tests/downloads-browser.mjs
import assert from 'node:assert/strict';
import {mkdir, readdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixtureServer, launch, rpc, until, evidence, downloadsFolder} from './helpers/browser.mjs';

const profile = process.env.LINK_METEOR_TEST_PROFILE || `downloads-browser-${Date.now()}`;
const result = {started: new Date().toISOString(), profile, browser: 'Chrome for Testing via Playwright, headless, fresh profile, real unpacked extension, no optional grants; permission requests are stubbed', checks: []};
const pass = (name, data = {}) => { result.checks.push({name, ...data}); console.log('PASS', name, Object.keys(data).length ? JSON.stringify(data) : ''); };
const fixture = await fixtureServer();
let context;
try {
  await mkdir(evidence, {recursive: true});
  const run = await launch(profile, {headless: true});
  context = run.context;
  const url = `chrome-extension://${run.id}/ui/workbench.html`;
  const open = async (width = 1440) => {
    const page = await context.newPage();
    await page.setViewportSize({width, height: 1000});
    const errors = []; page.on('pageerror', (error) => errors.push(error.message)); page.errors = errors;
    await page.goto(url); await page.waitForFunction(() => !!document.getElementById('collection-heading')?.textContent);
    // Stands in for Chrome's prompt; records each request, the gesture, and what reached the background.
    await page.evaluate(() => {
      window.__requests = []; window.__answer = false; window.__sent = [];
      chrome.permissions.request = async (request) => { window.__requests.push({request, activeGesture: navigator.userActivation.isActive}); return window.__answer; };
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (message) => { window.__sent.push(message.type); return send(message); };
    });
    return page;
  };
  let ui = await open();
  const requests = () => ui.evaluate(() => window.__requests.splice(0));
  const sentTypes = () => ui.evaluate(() => window.__sent.splice(0));
  const text = (id) => ui.locator(`#${id}`).innerText();
  const L = (path, anchorText, i) => ({id: `dl-${path}-${i}`, anchorText, accessibleLabel: '', url: fixture.base + path, originalHref: path, sourceUrl: `${fixture.base}/files.html`, sourceTitle: 'Meteor Research Lab — downloads fixture', frameUrl: '', capturedAt: new Date().toISOString(), batchId: 'downloads-fixture', notes: '', tags: []});
  const FILES = [['/files/paper.pdf', 'Attention in small systems'], ['/files/figure.png', 'Figure 1: heat map'], ['/files/paywalled.pdf', 'Paywalled article'], ['/files/paper', '[PDF] fixture.test'], ['/files/missing.pdf', 'Missing paper'], ['/files/paper.pdf?copy=2', 'Attention in small systems'], ['/index.html', 'The lab’s home page']];
  let state = await rpc(ui, {type: 'state.mutate', action: {type: 'collection.create', name: 'Many files'}});
  const many = state.activeCollectionId;
  await rpc(ui, {type: 'state.mutate', action: {type: 'links.append', collectionId: many, links: Array.from({length: 12}, (_, i) => L(`/files/paper.pdf?n=${i}`, `Paper ${i + 1}`, i))}});
  state = await rpc(ui, {type: 'state.mutate', action: {type: 'collection.create', name: 'Downloads fixture'}});
  await rpc(ui, {type: 'state.mutate', action: {type: 'links.append', collectionId: state.activeCollectionId, links: FILES.map(([path, anchor], i) => L(path, anchor, i))}});
  await until(async () => (await text('collection-heading')) === 'Downloads fixture' && (await text('downloads-label')) === 'Download 6 files', 'the section counts the file links', 8000);
  await sentTypes();

  /* The section: count, help, the reason for Chrome's access, and nothing asked on load. */
  assert.equal(await text('downloads-title'), 'Download files');
  assert.equal(await text('downloads-help'), 'Saves the file behind each file link to Link Meteor › Downloads-fixture in your downloads folder, named after its anchor text, 3 at a time. The other 1 link isn’t a file link. You can download any link from its details.');
  assert.equal(await ui.locator('#downloads-access').isVisible(), true);
  assert.equal(await text('downloads-access'), 'The first time, Chrome asks to let Link Meteor “Manage your downloads”. Link Meteor saves only the files you choose. It never reads, opens, changes or removes your other downloads.');
  assert.equal(await ui.locator('#downloads-start').getAttribute('aria-describedby'), 'downloads-help downloads-access');
  assert.deepEqual(await requests(), [], 'nothing is asked when the workbench opens');
  pass('Download files counts the 6 file links in the view and explains Chrome’s download access next to the button', {label: await text('downloads-label')});

  /* Declined: asked in the click, with the gesture still active; nothing reaches the background. */
  await ui.locator('#downloads-start').click();
  await until(async () => !(await ui.locator('#downloads-result').isHidden()), 'the declined result');
  assert.deepEqual(await requests(), [{request: {permissions: ['downloads']}, activeGesture: true}]);
  assert.equal(await text('downloads-result'), 'Chrome didn’t allow downloads, so nothing was downloaded. Choose Download again to be asked again.');
  assert.ok(!(await sentTypes()).includes('downloads.start'), 'no download request after a decline');
  assert.equal(await ui.locator('#downloads-progress').isHidden(), true); assert.equal(await ui.locator('#downloads-start').isEnabled(), true);
  pass('Download files asks Chrome in the click (simulated decline) and says nothing was downloaded');

  /* Simulated grant: the request reaches the background, which refuses because Chrome granted nothing. */
  await ui.evaluate(() => { window.__answer = true; });
  await ui.locator('#downloads-start').click();
  await until(async () => /^Download access is needed/.test(await ui.locator('#error').innerText().catch(() => '')), 'the background’s refusal');
  assert.deepEqual(await sentTypes(), ['downloads.start']);
  assert.deepEqual(await requests(), [{request: {permissions: ['downloads']}, activeGesture: true}]);
  assert.equal(await ui.locator('#downloads-access').isVisible(), true, 'the reason stays while Chrome reports no access');
  assert.equal(await ui.locator('#downloads-progress').isHidden(), true); assert.equal(await ui.locator('#downloads-start').isEnabled(), true);
  assert.deepEqual(await readdir(downloadsFolder(profile)), [], 'nothing downloaded');
  await ui.evaluate(() => { window.__answer = false; document.querySelector('#error .btn')?.click(); });
  pass('With a simulated grant the background still refuses, because Chrome granted nothing, and nothing downloads');

  /* A file link and a page link each offer Download in their details. */
  const details = async (label) => {
    const row = ui.locator('.link-row').filter({hasText: label}).first();
    await row.locator('.row-details summary').click();
    return row.locator('.occurrence').first();
  };
  let occurrence = await details('Figure 1: heat map');
  const go = occurrence.locator('.occurrence-download button');
  assert.equal(await go.getAttribute('aria-label'), 'Download the file behind Figure 1: heat map');
  assert.equal(await go.innerText(), 'Download');
  assert.equal(await occurrence.locator('.occurrence-download .help').innerText(), 'Saves the file to Link Meteor › Downloads-fixture in your downloads folder, named after the anchor text. Chrome asks for download access the first time.');
  await go.click();
  await until(async () => /^Chrome didn’t allow downloads/.test(await occurrence.locator('.occurrence-download .help').innerText()), 'the declined note');
  assert.deepEqual(await requests(), [{request: {permissions: ['downloads']}, activeGesture: true}]);
  occurrence = await details('The lab’s home page');
  assert.equal(await occurrence.locator('.occurrence-download button').getAttribute('aria-label'), 'Download the file behind The lab’s home page', 'any link can be downloaded from its details');
  pass('Download in a link’s details, for file links and any other link, asks Chrome in the click (simulated decline)');

  /* Above 10 files: an inline confirmation first; the request comes only with its click. */
  await rpc(ui, {type: 'state.mutate', action: {type: 'collection.activate', id: many}});
  await until(async () => (await text('downloads-label')) === 'Download 12 files…', 'twelve files');
  await ui.locator('#downloads-start').click();
  assert.equal(await ui.locator('#downloads-confirm').isVisible(), true);
  assert.equal(await ui.locator('#downloads-start').isHidden(), true);
  assert.equal(await text('downloads-confirm-text'), 'Download 12 files to Link Meteor › Many-files in your downloads folder? Chrome saves them 3 at a time, and you can cancel.');
  assert.equal(await text('downloads-confirm-yes'), 'Download 12 files');
  assert.equal(await ui.evaluate(() => document.activeElement.id), 'downloads-confirm-yes');
  assert.deepEqual(await requests(), [], 'not asked before the confirmation');
  await ui.keyboard.press('Escape');
  assert.equal(await ui.locator('#downloads-confirm').isHidden(), true);
  assert.equal(await ui.evaluate(() => document.activeElement.id), 'downloads-start');
  await ui.locator('#downloads-start').click();
  await ui.locator('#downloads-confirm-yes').click();
  await until(async () => !(await ui.locator('#downloads-result').isHidden()) && (await ui.locator('#downloads-confirm').isHidden()), 'the declined result after confirming');
  assert.deepEqual(await requests(), [{request: {permissions: ['downloads']}, activeGesture: true}]);
  pass('12 files: an inline confirmation names the folder; Escape closes it; the request comes with its click (simulated decline)');

  /* 320 px: the section fits, with no sideways scrolling. */
  await ui.setViewportSize({width: 320, height: 900});
  await ui.locator('#dock-export').click();
  await ui.locator('#downloads-section').scrollIntoViewIfNeeded();
  assert.equal(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const box = await ui.locator('#downloads-start').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 320, JSON.stringify(box));
  await ui.screenshot({path: resolve(evidence, 'downloads-panel-320.png')});
  pass('At 320 px the Download files section fits without sideways scrolling', {button: box});
  assert.deepEqual(ui.errors, []);
  await ui.close();

  /* Files the card left waiting: the next full view shows them once, at the downloads section. */
  const helper = await open();
  const wait = (value) => helper.evaluate((value) => chrome.storage.session.set({linkMeteorPendingDownloads: value}), value);
  const now = () => new Date().toISOString();
  await wait({links: [{url: `${fixture.base}/files/paper.pdf`, anchorText: 'Waiting paper', accessibleLabel: ''}, {url: `${fixture.base}/files/figure.png`, anchorText: 'Waiting figure', accessibleLabel: ''}], collectionName: 'Thesis sources', source: 'card', createdAt: now()});
  ui = await open();
  await until(() => ui.locator('#downloads-pending').isVisible(), 'the waiting files');
  assert.equal(await text('downloads-pending-text'), 'From the capture card: 2 file links you ticked. Download them to Link Meteor › Thesis-sources in your downloads folder?');
  assert.equal(await text('downloads-pending-start'), 'Download 2 files');
  await until(async () => (await ui.evaluate(() => document.activeElement.id)) === 'downloads-pending-start', 'focus on the waiting files');
  assert.equal(await helper.evaluate(async () => (await chrome.storage.session.get('linkMeteorPendingDownloads')).linkMeteorPendingDownloads), undefined, 'shown once');
  await ui.locator('#downloads-pending-start').click();
  await until(async () => !(await ui.locator('#downloads-result').isHidden()), 'the declined result');
  assert.deepEqual(await ui.evaluate(() => window.__requests), [{request: {permissions: ['downloads']}, activeGesture: true}]);
  assert.equal(await ui.locator('#downloads-pending').isHidden(), true);
  pass('Files the card left waiting show once in the next full view, focused, and ask Chrome in the click (simulated decline)');
  await ui.close();

  // From the menu, at a compact width: the export view opens at the waiting link.
  await wait({links: [{url: `${fixture.base}/files/paper.pdf`, anchorText: 'Waiting report', accessibleLabel: ''}], collectionName: 'My research', source: 'menu', createdAt: now()});
  ui = await open(420);
  await until(() => ui.locator('#downloads-pending').isVisible(), 'the waiting link');
  assert.equal(await ui.locator('#app').getAttribute('data-view'), 'export');
  assert.equal(await text('downloads-pending-text'), 'From the right-click menu: “Waiting report”. Download it to Link Meteor › My-research in your downloads folder?');
  assert.equal(await text('downloads-pending-start'), 'Download 1 file');
  await ui.locator('#downloads-pending-dismiss').click();
  assert.equal(await ui.locator('#downloads-pending').isHidden(), true);
  assert.deepEqual(await ui.evaluate(() => window.__requests), [], 'Dismiss asks nothing');
  pass('A link the menu left waiting opens the export view at a compact width; Dismiss asks nothing');
  await ui.close();

  // Waiting files expire after 10 minutes.
  await wait({links: [{url: `${fixture.base}/files/paper.pdf`, anchorText: 'Old', accessibleLabel: ''}], collectionName: 'X', source: 'card', createdAt: new Date(Date.now() - 11 * 60 * 1000).toISOString()});
  ui = await open();
  await ui.waitForTimeout(600);
  assert.equal(await ui.locator('#downloads-pending').isHidden(), true);
  pass('Files left waiting more than 10 minutes ago are not shown');
  await ui.close(); await helper.close();
  assert.deepEqual(await readdir(downloadsFolder(profile)), [], 'nothing downloaded in this suite');
  result.result = 'PASS';
} catch (error) {
  result.result = 'FAIL'; result.error = error.stack; console.error(error); process.exitCode = 1;
} finally {
  await context?.close(); await fixture.close();
  result.finished = new Date().toISOString();
  await writeFile(resolve(evidence, 'downloads-browser-results.json'), JSON.stringify(result, null, 2) + '\n');
}
