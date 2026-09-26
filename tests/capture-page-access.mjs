// "Capture this page" after the tab moves to a new site: Chrome's temporary page access from a
// toolbar click ends when the tab navigates, so the capture is denied. Clicking the Link Meteor
// toolbar icon again on the new page restores access for that page only. The toolbar click is
// Chrome's own action click, driven through the DevTools protocol (Extensions.triggerAction),
// in a fresh temporary profile with no site grants. The workbench window stands in for the
// open side panel. Writes capture-page-access.json to the evidence folder.
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require(resolve(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const root = resolve(import.meta.dirname, '..');
const {fixtureServer, evidence} = await import(resolve(root, 'tests/helpers/browser.mjs'));
const {writeFile} = await import('node:fs/promises');
const steps = [];
const fixture = await fixtureServer();
const ext = resolve(root, 'dist');
const profile = await mkdtemp(resolve(root, '.scratch/workaround-profile-'));
const chrome = spawn(pw.chromium.executablePath(), ['--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', `--user-data-dir=${profile}`, `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run', '--disable-background-networking', '--disable-component-update', 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe']});
const out = chrome.stdio[3], inp = chrome.stdio[4];
let buf = '', nextId = 1; const pending = new Map();
inp.on('data', (d) => { buf += d.toString(); let i; while ((i = buf.indexOf('\0')) >= 0) { const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (msg.id && pending.has(msg.id)) { const {ok, no} = pending.get(msg.id); pending.delete(msg.id); msg.error ? no(new Error(JSON.stringify(msg.error))) : ok(msg.result); } } });
const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = nextId++; pending.set(id, {ok, no}); out.write(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}) + '\0'); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (step, data) => { steps.push({step, data}); console.log(JSON.stringify({step, data})); };
try {
  await sleep(1500);
  const extId = 'pjiilikbbfiihbpagfhejbbbhadefjeg';
  // Page tab on site A (127.0.0.1).
  const {targetId: pageTarget} = await send('Target.createTarget', {url: `${fixture.base}/index.html`});
  await sleep(1500);
  // Workbench open as its own window, standing in for the open side panel.
  const {targetId: uiTarget} = await send('Target.createTarget', {url: `chrome-extension://${extId}/ui/workbench.html`, newWindow: true});
  const {sessionId: ui} = await send('Target.attachToTarget', {targetId: uiTarget, flatten: true});
  await sleep(1500);
  // Extensions.triggerAction needs the page's "tab" target, not its page target.
  const tabTargetFor = async (url) => { const {targetInfos} = await send('Target.getTargets', {filter: [{type: 'tab'}]}); return targetInfos.find((t) => t.url.startsWith(url))?.targetId; };
  const click = async (url) => { const tab = await tabTargetFor(url); return tab ? send('Extensions.triggerAction', {id: extId, targetId: tab}).then(() => 'clicked', (e) => e.message) : 'no tab target'; };
  const evalUi = async (expr) => (await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true}, ui)).result.value;
  const capture = () => evalUi(`chrome.runtime.sendMessage({type:'capture.run',tabIds:[]}).then(r => r.ok ? {status: r.data.report.results[0].status, count: r.data.report.results[0].count, url: r.data.report.results[0].url} : {error: r.error})`);
  const access = (origin) => evalUi(`chrome.permissions.contains({origins:['${origin}/*']})`);
  // 1. Open Link Meteor from the toolbar on site A (what opening the side panel does).
  log('toolbar-click-on-site-A', await click(fixture.base));
  await sleep(800);
  log('capture-site-A', await capture());
  // 2. The same tab moves to site B (localhost), panel still open.
  const {sessionId: pg} = await send('Target.attachToTarget', {targetId: pageTarget, flatten: true});
  const siteB = fixture.base.replace('127.0.0.1', 'localhost');
  await send('Page.navigate', {url: `${siteB}/index.html`}, pg); await sleep(1500);
  log('site-B-persistent-access', await access(siteB));
  log('capture-site-B-before-workaround', await capture());
  // 3. Workaround: click the Link Meteor toolbar icon while on site B, then Capture this page again.
  log('toolbar-click-on-site-B', await click(siteB));
  await sleep(800);
  log('capture-site-B-after-workaround', await capture());
  log('site-B-persistent-access-after', await access(siteB));
  const by = Object.fromEntries(steps.map((s) => [s.step, s.data]));
  const pass = by['capture-site-A']?.status === 'success' && by['site-B-persistent-access'] === false && by['capture-site-B-before-workaround']?.status === 'denied' && by['capture-site-B-after-workaround']?.status === 'success' && by['site-B-persistent-access-after'] === false;
  await writeFile(resolve(evidence, 'capture-page-access.json'), JSON.stringify({started: new Date().toISOString(), browser: 'Chrome for Testing, headless, fresh temporary profile, real unpacked extension', method: 'Toolbar clicks via DevTools protocol Extensions.triggerAction; the workbench in its own window stands in for the open side panel; the tab moves from 127.0.0.1 to localhost', result: pass ? 'PASS' : 'FAIL', steps}, null, 2) + '\n');
  console.log(pass ? 'PASS' : 'FAIL'); if (!pass) process.exitCode = 1;
} finally { chrome.kill(); await fixture.close(); await sleep(500); await rm(profile, {recursive: true, force: true}); }
