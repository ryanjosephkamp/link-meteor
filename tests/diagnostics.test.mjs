// Copy diagnostics (diagnostics.get) through the background's real message routing, with Chrome's
// APIs simulated in memory. The saved state, the restore Undo snapshot, the session capture
// report, Chrome's grants and the registered scripts are seeded with addresses, origins, titles,
// notes, tags and collection names; none of them may appear anywhere in the diagnostics JSON.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SETTINGS_DEFAULTS} from '../src/core/model.js';

const event = () => ({listeners: [], addListener(fn) { this.listeners.push(fn); }});
const link = (n, overrides = {}) => ({
  id: `occurrence-${n}-7f3a`, anchorText: `Payroll export ${n}`, accessibleLabel: `Salary sheet label ${n}`,
  url: `https://private-intranet.example.com/hr/salaries-${n}?employee=4242`, originalHref: `/hr/salaries-${n}?employee=4242`,
  sourceUrl: 'https://source-site.example.net/board/minutes', sourceTitle: 'Confidential board minutes',
  frameUrl: 'https://frame-host.example.org/embedded', capturedAt: '2024-01-02T03:04:05.000Z', batchId: 'batch-secret-91c2',
  notes: 'Call the lawyer before Friday', tags: ['merger-talks', 'layoff-list'], ...overrides,
});
const secretState = () => ({
  schemaVersion: 1, activeCollectionId: 'collection-zephyr',
  collections: [
    {id: 'collection-zephyr', name: 'Secret project Zephyr', notes: 'Acquisition shortlist notes', tags: ['board-only'], createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-03T00:00:00.000Z',
      links: [link(1), link(2), link(3, {url: 'mailto:ceo@bigco-private.example', anchorText: 'Email the chief executive', originalHref: 'mailto:ceo@bigco-private.example'}),
        link(4, {url: 'tel:+15551234567', anchorText: 'Hotline number', originalHref: 'tel:+15551234567'})]},
    {id: 'collection-health', name: 'Medical appointments 2026', notes: 'Oncology follow-up', tags: ['health-private'], createdAt: '2024-02-01T00:00:00.000Z', updatedAt: '2024-02-02T00:00:00.000Z',
      links: [link(5, {url: 'https://clinic-portal.example.health/results/biopsy', sourceTitle: 'Patient portal: lab results'})]},
  ],
  settings: {...SETTINGS_DEFAULTS, holdOrigins: ['https://hold-site.example.org', 'https://second-hold.example.dev'], holdExceptions: ['https://never-here.example.io'],
    holdTrigger: 'modifier', welcomeSeen: true, exportPrefix: 'Zephyr-internal-memo', theme: 'aurora', appearance: 'dark', afterDrag: 'copy', afterDragFormat: 'rich', contentOnly: true, skipSaved: true},
  undo: {collectionId: 'collection-zephyr', links: [link(6, {url: 'https://removed-link.example.com/deleted-page', notes: 'Removed but remembered'})], indices: [0]},
});
const restoreUndo = {createdAt: '2024-03-01T00:00:00.000Z', summary: {mode: 'replace', collectionsInBackup: 1},
  before: {...secretState(), collections: [{id: 'collection-old', name: 'Old divorce paperwork', notes: '', tags: [], createdAt: '2023-01-01T00:00:00.000Z', updatedAt: '2023-01-01T00:00:00.000Z', links: [link(7, {url: 'https://restore-before.example.com/lawyer'})]}], activeCollectionId: 'collection-old'},
  written: {fingerprint: 'abc123fingerprint', holdOrigins: ['https://hold-site.example.org'], holdScope: 'sites'}};
const captureReport = {report: {batchId: 'batch-secret-91c2', capturedCount: 2, results: [{tabId: 9, title: 'Session tab: bank statement', url: 'https://bank-session.example.com/statement', status: 'success', count: 2, warning: '', error: ''}]}, createdAt: '2024-04-01T00:00:00.000Z'};
const grants = {permissions: ['activeTab', 'scripting', 'storage', 'unlimitedStorage', 'tabs', 'tabGroups', 'downloads'], origins: ['https://granted-one.example.com/*', 'http://*/*', 'https://*/*']};
const registered = [{id: 'meteor-hold-all', matches: ['http://*/*', 'https://*/*'], excludeMatches: ['https://never-here.example.io/*'], js: ['content/capture.js'], runAt: 'document_idle', persistAcrossSessions: true}];

const local = {linkMeteorState: secretState(), linkMeteorRestoreUndo: structuredClone(restoreUndo)};
const session = {linkMeteorCaptureReport: structuredClone(captureReport), linkMeteorTarget: {tabId: 9, windowId: 1}};
const size = (value) => value === undefined ? 0 : new TextEncoder().encode(JSON.stringify(value)).length;
const tabs = [{id: 9, windowId: 1, url: 'https://bank-session.example.com/statement', title: 'Session tab: bank statement'}];
globalThis.chrome = {
  storage: {onChanged: event(),
    local: {async get(key) { return {[key]: structuredClone(local[key])}; }, async set(value) { Object.assign(local, structuredClone(value)); }, async remove(key) { delete local[key]; },
      async getBytesInUse(keys) { const list = keys === null ? Object.keys(local) : [keys].flat(); return list.reduce((sum, key) => sum + key.length + size(local[key]), 0); }},
    session: {async get(key) { return {[key]: structuredClone(session[key])}; }, async set(value) { Object.assign(session, structuredClone(value)); }}},
  runtime: {id: 'meteor', getURL: (path) => 'chrome-extension://meteor/' + path, getManifest: () => ({version: '0.4.0'}), getPlatformInfo: async () => ({os: 'mac', arch: 'arm64', nacl_arch: 'arm'}),
    sendMessage: async () => {}, onMessage: event(), onInstalled: event(), onStartup: event()},
  i18n: {getUILanguage: () => 'en-GB'},
  permissions: {getAll: async () => structuredClone(grants), contains: async ({origins = [], permissions = []}) => origins.every((o) => grants.origins.includes(o)) && permissions.every((p) => grants.permissions.includes(p)), onAdded: event(), onRemoved: event()},
  scripting: {getRegisteredContentScripts: async () => structuredClone(registered), registerContentScripts: async () => {}, unregisterContentScripts: async () => {}, executeScript: async () => []},
  tabs: {query: async () => tabs, get: async (id) => tabs.find((tab) => tab.id === id), sendMessage: async () => {}, create: async () => {}, update: async () => {}},
  windows: {getAll: async () => [{id: 1, focused: true, tabs}], update: async () => {}},
  bookmarks: {}, action: {onClicked: event()}, sidePanel: {open: async () => {}}, commands: {onCommand: event()}, contextMenus: {onClicked: event(), removeAll: async () => {}, create: () => {}},
};
Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  language: 'en-US', userAgentData: {brands: [{brand: 'Chromium', version: '151'}, {brand: 'Google Chrome', version: '151'}], mobile: false, platform: 'macOS'}}});

await import('../src/background.js');
const {SETTING_REPORTS} = await import('../src/background/diagnostics.js');
const workbench = {url: 'chrome-extension://meteor/ui/workbench.html'};
const call = (message, sender = workbench) => new Promise((resolve) => chrome.runtime.onMessage.listeners[0](message, sender, resolve));

// Every string a person or a page put into the seeded data, and each address's origin, host,
// path and query.
function secrets(...values) {
  const found = new Set();
  const walk = (value) => {
    if (typeof value === 'string') {
      found.add(value);
      try { const url = new URL(value); for (const part of [url.origin, url.host, url.hostname, url.pathname, url.search]) found.add(part); } catch { /* not an address */ }
    } else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  values.forEach(walk);
  return [...found].filter((value) => value.length > 3);
}
// Fixed setting choices may appear: they are the same for everyone who picks them.
const CHOICES = new Set(['letter', 'modifier', 'sites', 'all', 'datetime', 'date', 'system', 'light', 'dark', 'card', 'copy', 'add', 'tsv', 'text', 'markdown', 'rich', 'meteor', 'comet', 'aurora', 'ember', 'nebula', 'graphite', 'contrast']);

test('diagnostics.get never includes addresses, origins, titles, notes, tags or collection names', async (t) => {
  const started = Date.now();
  const reply = await call({type: 'diagnostics.get'});
  assert.equal(reply.ok, true, reply.error);
  const report = reply.data;
  const json = JSON.stringify(report, null, 2);

  await t.test('it is JSON-safe', () => {
    assert.deepEqual(JSON.parse(json), report);
  });

  await t.test('no seeded string, host or path appears anywhere', () => {
    const forbidden = secrets(secretState(), restoreUndo, captureReport, grants.origins, registered.map((script) => script.excludeMatches)).filter((value) => !CHOICES.has(value));
    assert.ok(forbidden.length > 80, `checked ${forbidden.length} strings`);
    const leaked = forbidden.filter((value) => json.includes(value));
    assert.deepEqual(leaked, []);
    for (const pattern of [/:\/\//, /https?:/i, /mailto:|tel:/i, /@/, /example/i, /\.(com|org|net|io|dev|health)\b/i]) assert.doesNotMatch(json, pattern);
  });

  await t.test('only counts, choices and browser facts are reported', () => {
    const strings = [];
    const walk = (value, path) => {
      if (typeof value === 'string') strings.push(path);
      else if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${path}[${i}]`));
      else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
    };
    walk(report, '');
    const allowed = /^\.(createdAt|version|browser\.(userAgent|platform|os|arch|language|uiLanguage|brands\[\d+\]\.(brand|version))|settings\.(holdKey|holdTrigger|holdScope|exportTimestampFormat|theme|appearance|afterDrag|afterDragFormat)|scripts\.scope)$/;
    assert.deepEqual(strings.filter((path) => !allowed.test(path)), [], 'every other value is a number, boolean or null');
  });

  await t.test('fields and counts', async () => {
    assert.deepEqual(Object.keys(report), ['createdAt', 'version', 'browser', 'settings', 'permissions', 'scripts', 'storage', 'data']);
    assert.ok(Date.parse(report.createdAt) >= started - 1000 && Date.parse(report.createdAt) <= Date.now());
    assert.equal(report.version, '0.4.0');
    assert.deepEqual(report.browser, {userAgent: navigator.userAgent, brands: [{brand: 'Chromium', version: '151'}, {brand: 'Google Chrome', version: '151'}], mobile: false, platform: 'macOS', os: 'mac', arch: 'arm64', language: 'en-US', uiLanguage: 'en-GB'});
    assert.deepEqual(report.settings, {holdKey: 'z', holdOrigins: 2, holdTrigger: 'modifier', holdScope: 'sites', holdExceptions: 1, welcomeSeen: true, exportPrefix: 'Zephyr-internal-memo'.length,
      exportTimestamp: true, exportTimestampFormat: 'datetime', theme: 'aurora', appearance: 'dark', afterDrag: 'copy', afterDragFormat: 'rich', contentOnly: true, skipSaved: true, saveContext: true, otherFields: 0});
    assert.deepEqual(report.permissions, {tabs: true, bookmarks: false, tabGroups: true, downloads: true, allSites: true, siteOriginCount: 1});
    // Saved scope is 'sites' while the registration is for all sites, so they don't match.
    assert.deepEqual(report.scripts, {count: 1, scope: 'all', matchCount: 2, excludeCount: 1, matchesSettings: false});
    const bytes = await chrome.storage.local.getBytesInUse(null);
    assert.deepEqual(report.storage, {bytesInUse: bytes, stateBytes: await chrome.storage.local.getBytesInUse('linkMeteorState'), restoreUndoBytes: await chrome.storage.local.getBytesInUse('linkMeteorRestoreUndo')});
    assert.ok(report.storage.stateBytes > 0 && report.storage.restoreUndoBytes > 0 && report.storage.bytesInUse >= report.storage.stateBytes + report.storage.restoreUndoBytes);
    assert.deepEqual(report.data, {readable: true, collections: 2, links: 5, undoLinks: 1});
  });
});

test('every saved setting has a diagnostics report', () => {
  assert.deepEqual(Object.keys(SETTING_REPORTS).sort(), Object.keys(SETTINGS_DEFAULTS).sort());
});

test('a matching registration is reported as matching the settings', async () => {
  const saved = structuredClone(local.linkMeteorState);
  local.linkMeteorState.settings = {...local.linkMeteorState.settings, holdScope: 'all'};
  const reply = await call({type: 'diagnostics.get'});
  local.linkMeteorState = saved;
  assert.equal(reply.data.scripts.matchesSettings, true);
  assert.equal(reply.data.settings.holdScope, 'all');
});

test('corrupt or unknown settings report "invalid" and a count, never their values', async () => {
  const saved = structuredClone(local.linkMeteorState);
  local.linkMeteorState.settings = {...local.linkMeteorState.settings, theme: 'https://theme-leak.example.com/x', holdKey: 'https://key-leak.example.com', holdTrigger: 'Secret project Zephyr',
    holdOrigins: 'https://not-a-list.example.com', contentOnly: 'https://flag-leak.example.com', exportPrefix: ['https://prefix-leak.example.com'],
    futureSetting: 'https://future-leak.example.com/private', anotherFuture: {nested: 'Medical appointments 2026'}};
  const reply = await call({type: 'diagnostics.get'});
  // Settings that aren't an object at all are reported as missing, one by one.
  local.linkMeteorState.settings = 'https://settings-leak.example.com/Secret project Zephyr';
  const whole = await call({type: 'diagnostics.get'});
  local.linkMeteorState = saved;
  assert.equal(reply.ok, true, reply.error);
  const {settings} = reply.data;
  assert.deepEqual([settings.theme, settings.holdKey, settings.holdTrigger, settings.holdOrigins, settings.contentOnly, settings.exportPrefix, settings.otherFields],
    ['invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid', 2]);
  assert.equal(reply.data.scripts.matchesSettings, null, 'no registration is expected from unreadable site lists');
  assert.equal(whole.ok, true, whole.error);
  assert.deepEqual(Object.values(whole.data.settings), [...Object.keys(SETTINGS_DEFAULTS).map(() => 'missing'), 0]);
  for (const json of [JSON.stringify(reply.data), JSON.stringify(whole.data)]) {
    for (const pattern of [/leak/, /future/i, /Zephyr/, /Medical/, /:\/\//, /example/]) assert.doesNotMatch(json, pattern);
  }
});

test('unreadable saved data still gives diagnostics, without guessing counts', async () => {
  const saved = structuredClone(local.linkMeteorState);
  local.linkMeteorState = {...saved, schemaVersion: 999};
  const reply = await call({type: 'diagnostics.get'});
  local.linkMeteorState = saved;
  assert.equal(reply.ok, true, reply.error);
  assert.equal(reply.data.settings, null);
  assert.deepEqual(reply.data.data, {readable: false, collections: null, links: null, undoLinks: null});
  assert.equal(reply.data.scripts.matchesSettings, null);
  assert.doesNotMatch(JSON.stringify(reply.data), /example|Zephyr|:\/\//);
});

test('diagnostics.get is refused outside the workbench', async () => {
  const fromPage = await call({type: 'diagnostics.get'}, {url: 'https://bank-session.example.com/statement', tab: tabs[0]});
  assert.equal(fromPage.ok, false);
  assert.match(fromPage.error, /Link Meteor workbench/);
  const noSender = await call({type: 'diagnostics.get'}, {});
  assert.equal(noSender.ok, false);
});

test('Chrome API failures leave nulls instead of failing', async () => {
  const saved = {getAll: chrome.permissions.getAll, scripts: chrome.scripting.getRegisteredContentScripts, bytes: chrome.storage.local.getBytesInUse, platform: chrome.runtime.getPlatformInfo};
  chrome.permissions.getAll = async () => { throw new Error('unavailable'); };
  chrome.scripting.getRegisteredContentScripts = async () => { throw new Error('unavailable'); };
  chrome.storage.local.getBytesInUse = async () => { throw new Error('unavailable'); };
  chrome.runtime.getPlatformInfo = async () => { throw new Error('unavailable'); };
  const reply = await call({type: 'diagnostics.get'});
  Object.assign(chrome.permissions, {getAll: saved.getAll}); chrome.scripting.getRegisteredContentScripts = saved.scripts; chrome.storage.local.getBytesInUse = saved.bytes; chrome.runtime.getPlatformInfo = saved.platform;
  assert.equal(reply.ok, true, reply.error);
  assert.deepEqual(reply.data.permissions, {tabs: false, bookmarks: false, tabGroups: false, downloads: false, allSites: true, siteOriginCount: 0});
  assert.deepEqual(reply.data.scripts, {count: null, scope: 'unknown', matchCount: null, excludeCount: null, matchesSettings: null});
  assert.deepEqual(reply.data.storage, {bytesInUse: null, stateBytes: null, restoreUndoBytes: null});
  assert.deepEqual([reply.data.browser.os, reply.data.browser.arch], ['', '']);
});
