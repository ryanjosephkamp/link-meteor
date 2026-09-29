// Copy diagnostics (0.4.0): what a bug report needs to know about this install, and nothing about
// what was captured. Every value is a count, a yes or no, a setting's fixed choice, a byte size or
// a fact about the browser, so no URL, origin, page title, note, tag or collection name can
// appear. The contract is in docs/CONTRACTS.md ("Added in 0.4.0").
import {THEME_IDS} from '../core/themes.js';
import {serial, readState, STATE_KEY} from './store.js';
import {RESTORE_UNDO_KEY} from './backup.js';
import {ALL_SITES, allSitesGranted, holdRegistration} from './hold.js';

const INVALID = 'invalid';
const choice = values => value => values.includes(value) ? value : INVALID;
const yesNo = value => typeof value === 'boolean' ? value : INVALID;
const count = value => Array.isArray(value) ? value.length : INVALID;

// How each saved setting is reported. Site lists become counts and the export prefix its length,
// because those hold the person's own text. A value outside its fixed choices reads 'invalid',
// never the value itself. A new setting needs an entry here (tests/diagnostics.test.mjs checks).
export const SETTING_REPORTS = Object.freeze({
  holdKey: value => typeof value === 'string' && /^[a-z]$/i.test(value) ? value.toLowerCase() : INVALID,
  holdOrigins: count,
  holdTrigger: choice(['letter', 'modifier']),
  holdScope: choice(['sites', 'all']),
  holdExceptions: count,
  welcomeSeen: yesNo,
  exportPrefix: value => typeof value === 'string' ? value.length : INVALID,
  exportTimestamp: yesNo,
  exportTimestampFormat: choice(['datetime', 'date']),
  theme: choice(THEME_IDS),
  appearance: choice(['system', 'light', 'dark']),
  afterDrag: choice(['card', 'copy', 'add']),
  afterDragFormat: choice(['tsv', 'text', 'markdown', 'rich']),
  contentOnly: yesNo,
  skipSaved: yesNo,
  saveContext: yesNo,
});

function settingsReport(settings) {
  const saved = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  const report = Object.fromEntries(Object.entries(SETTING_REPORTS).map(([key, read]) => [key, Object.hasOwn(saved, key) ? read(saved[key]) : 'missing']));
  // Fields a later version saved: how many, never their names or values.
  report.otherFields = Object.keys(saved).filter(key => !Object.hasOwn(SETTING_REPORTS, key)).length;
  return report;
}

const quietly = async (read, fallback = null) => { try { return await read(); } catch { return fallback; } };

async function permissionsReport(allSites) {
  const grants = await quietly(() => chrome.permissions.getAll(), {});
  const permissions = Array.isArray(grants?.permissions) ? grants.permissions : [];
  const origins = Array.isArray(grants?.origins) ? grants.origins : [];
  return {
    tabs: permissions.includes('tabs'), bookmarks: permissions.includes('bookmarks'), tabGroups: permissions.includes('tabGroups'),
    downloads: permissions.includes('downloads'),
    allSites, siteOriginCount: origins.filter(origin => !ALL_SITES.includes(origin)).length,
  };
}

// The page script's registrations: how many, the hold-drag scope they serve ('none', 'sites',
// 'all', 'other' or 'mixed') and pattern counts only. matchesSettings says whether they are what
// the saved settings and Chrome's grants call for.
async function scriptsReport(settings, allSites) {
  const registered = await quietly(() => chrome.scripting.getRegisteredContentScripts(), null);
  if (!Array.isArray(registered)) return {count: null, scope: 'unknown', matchCount: null, excludeCount: null, matchesSettings: null};
  const scopes = new Set(registered.map(script => ({'meteor-hold-all': 'all', 'meteor-hold-sites': 'sites'})[script.id] || 'other'));
  const matchCount = registered.reduce((sum, script) => sum + (script.matches?.length || 0), 0);
  const excludeCount = registered.reduce((sum, script) => sum + (script.excludeMatches?.length || 0), 0);
  const sorted = list => [...(list || [])].sort().join('\n');
  let matchesSettings = null;
  try {
    const desired = holdRegistration(settings, allSites);
    matchesSettings = registered.length === desired.length && desired.every(want => registered.some(have => have.id === want.id
      && sorted(have.matches) === sorted(want.matches) && sorted(have.excludeMatches) === sorted(want.excludeMatches)));
  } catch { /* unreadable settings: left as null */ }
  return {count: registered.length, scope: !scopes.size ? 'none' : scopes.size === 1 ? [...scopes][0] : 'mixed', matchCount, excludeCount, matchesSettings};
}

const bytes = keys => quietly(() => chrome.storage.local.getBytesInUse(keys));

async function browserReport() {
  const agent = globalThis.navigator?.userAgentData;
  const platform = await quietly(() => chrome.runtime.getPlatformInfo(), {});
  return {
    userAgent: String(globalThis.navigator?.userAgent || ''),
    brands: Array.isArray(agent?.brands) ? agent.brands.map(({brand, version}) => ({brand: String(brand), version: String(version)})) : [],
    mobile: typeof agent?.mobile === 'boolean' ? agent.mobile : null,
    platform: String(agent?.platform || ''),
    os: String(platform?.os || ''), arch: String(platform?.arch || ''),
    language: String(globalThis.navigator?.language || ''),
    uiLanguage: String((await quietly(() => chrome.i18n.getUILanguage(), '')) || ''),
  };
}

// diagnostics.get: a JSON-safe object the workbench copies as indented JSON.
export async function diagnostics() {
  const createdAt = new Date().toISOString();
  // Saved data that can't be read is exactly when diagnostics help, so a failed read is reported.
  const state = await quietly(() => serial(readState));
  const collections = Array.isArray(state?.collections) ? state.collections : [];
  const allSites = await allSitesGranted();
  return {
    createdAt,
    version: String(chrome.runtime.getManifest().version || ''),
    browser: await browserReport(),
    settings: state ? settingsReport(state.settings) : null,
    permissions: await permissionsReport(allSites),
    scripts: await scriptsReport(state?.settings, allSites),
    storage: {bytesInUse: await bytes(null), stateBytes: await bytes(STATE_KEY), restoreUndoBytes: await bytes(RESTORE_UNDO_KEY)},
    data: {
      readable: Boolean(state), collections: state ? collections.length : null,
      links: state ? collections.reduce((sum, collection) => sum + (Array.isArray(collection?.links) ? collection.links.length : 0), 0) : null,
      undoLinks: state ? (Array.isArray(state.undo?.links) ? state.undo.links.length : 0) : null,
    },
  };
}

// Workbench-only messages this module answers; the entry routes them.
export const workbenchMessages = {
  'diagnostics.get': () => diagnostics(),
};
