// "Capture this page" after the tab moves to a new site: Chrome's temporary page access from a
// toolbar click ends when the tab navigates, so the capture is denied. Clicking the Link Meteor
// toolbar icon again on the new page restores access for that page only. The toolbar click is
// Chrome's own action click, driven through the DevTools protocol (tests/helpers/action.mjs),
// in a fresh temporary profile with no site grants. The workbench window stands in for the
// open side panel. Writes capture-page-access.json to the evidence folder.
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixtureServer, evidence} from './helpers/browser.mjs';
import {launchWithAction} from './helpers/action.mjs';
const steps = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (step, data) => { steps.push({step, data}); console.log(JSON.stringify({step, data})); };
const fixture = await fixtureServer();
const browser = await launchWithAction({profilePrefix: 'workaround-profile-'});
try {
  // Page tab on site A (127.0.0.1).
  const {targetId: pageTarget} = await browser.newTab(`${fixture.base}/index.html`);
  await sleep(1500);
  // Workbench open as its own window, standing in for the open side panel.
  const {targetId: uiTarget} = await browser.newWindow(browser.extensionUrl());
  const ui = await browser.attach(uiTarget);
  await sleep(1500);
  const capture = () => browser.evaluate(ui, `chrome.runtime.sendMessage({type:'capture.run',tabIds:[]}).then(r => r.ok ? {status: r.data.report.results[0].status, count: r.data.report.results[0].count, url: r.data.report.results[0].url} : {error: r.error})`);
  const access = (origin) => browser.evaluate(ui, `chrome.permissions.contains({origins:['${origin}/*']})`);
  // 1. Open Link Meteor from the toolbar on site A (what opening the side panel does).
  log('toolbar-click-on-site-A', await browser.clickAction(fixture.base));
  await sleep(800);
  log('capture-site-A', await capture());
  // 2. The same tab moves to site B (localhost), panel still open.
  const page = await browser.attach(pageTarget);
  const siteB = fixture.base.replace('127.0.0.1', 'localhost');
  await browser.navigate(page, `${siteB}/index.html`); await sleep(1500);
  log('site-B-persistent-access', await access(siteB));
  log('capture-site-B-before-workaround', await capture());
  // 3. Workaround: click the Link Meteor toolbar icon while on site B, then Capture this page again.
  log('toolbar-click-on-site-B', await browser.clickAction(siteB));
  await sleep(800);
  log('capture-site-B-after-workaround', await capture());
  log('site-B-persistent-access-after', await access(siteB));
  const by = Object.fromEntries(steps.map((s) => [s.step, s.data]));
  const pass = by['capture-site-A']?.status === 'success' && by['site-B-persistent-access'] === false && by['capture-site-B-before-workaround']?.status === 'denied' && by['capture-site-B-after-workaround']?.status === 'success' && by['site-B-persistent-access-after'] === false;
  await mkdir(evidence, {recursive: true});
  await writeFile(resolve(evidence, 'capture-page-access.json'), JSON.stringify({started: new Date().toISOString(), browser: 'Chrome for Testing, headless, fresh temporary profile, real unpacked extension', method: 'Toolbar clicks via DevTools protocol Extensions.triggerAction; the workbench in its own window stands in for the open side panel; the tab moves from 127.0.0.1 to localhost', result: pass ? 'PASS' : 'FAIL', steps}, null, 2) + '\n');
  console.log(pass ? 'PASS' : 'FAIL'); if (!pass) process.exitCode = 1;
} finally { await browser.close(); await fixture.close(); }
