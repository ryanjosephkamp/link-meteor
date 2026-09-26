// Hold-key drag: where the page script runs (chosen sites, or all sites minus the "Never on
// these sites" list), which trigger it uses, and keeping saved settings honest about what Chrome
// still grants. The contracts are in docs/CONTRACTS.md ("All-sites access and the hold key").
import {reduceState} from '../core/model.js';
import {serial, readState, writeState} from './store.js';
import {ordinaryUrl} from './urls.js';

export const ALL_SITES = ['http://*/*', 'https://*/*'];
const SCRIPT_PREFIX = 'meteor-hold-';
const SCRIPT = {js: ['content/capture.js'], runAt: 'document_idle', persistAcrossSessions: true};
// A saved change to any of these re-registers the page script and reconfigures open tabs.
export const HOLD_FIELDS = ['holdScope', 'holdOrigins', 'holdExceptions', 'holdKey', 'holdTrigger'];

let holdQueue = Promise.resolve();
// Hold operations run one at a time, so registrations never interleave.
export function serialHold(operation) {
  const next = holdQueue.then(operation, operation);
  holdQueue = next.catch(() => {});
  return next;
}

export async function allSitesGranted() {
  try { return await chrome.permissions.contains({origins: ALL_SITES}); } catch { return false; }
}

async function originGranted(origin) {
  try { return await chrome.permissions.contains({origins: [origin + '/*']}); } catch { return false; }
}

// An ordinary HTTP(S) origin, exactly as the settings store it.
export function siteOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Choose an ordinary website for the hold-key shortcut.'); }
  if (!ordinaryUrl(url.href) || url.origin !== value) throw new Error('Choose an ordinary website for the hold-key shortcut.');
  return value;
}

// Whether hold-drag runs on a page of this origin.
export function holdRuns(origin, settings, allSites) {
  if (!origin || settings.holdExceptions.includes(origin)) return false;
  return settings.holdScope === 'all' ? allSites : settings.holdOrigins.includes(origin);
}

// The content scripts Chrome should have registered for these settings.
export function holdRegistration(settings, allSites) {
  if (settings.holdScope === 'all' && allSites) {
    const excludeMatches = settings.holdExceptions.map(origin => origin + '/*');
    return [{id: SCRIPT_PREFIX + 'all', matches: [...ALL_SITES], ...(excludeMatches.length ? {excludeMatches} : {}), ...SCRIPT}];
  }
  const origins = settings.holdOrigins.filter(origin => !settings.holdExceptions.includes(origin));
  return origins.length ? [{id: SCRIPT_PREFIX + 'sites', matches: origins.map(origin => origin + '/*'), ...SCRIPT}] : [];
}

const sorted = list => [...(list || [])].sort().join('\n');
function sameRegistration(registered, desired) {
  return registered.length === desired.length && desired.every(want => registered.some(have =>
    have.id === want.id && sorted(have.matches) === sorted(want.matches) && sorted(have.excludeMatches) === sorted(want.excludeMatches)
    && sorted(have.js) === sorted(want.js) && have.persistAcrossSessions !== false));
}

// Reads, patches and saves settings in one step of the state queue, so a patch never rests on a
// stale read. Returns the saved (or unchanged) state.
export function updateSettings(makePatch) {
  return serial(async () => {
    const previous = await readState();
    const patch = await makePatch(previous.settings);
    if (!patch || !Object.keys(patch).length) return previous;
    const next = reduceState(previous, {type: 'settings.update', patch});
    try { await writeState(previous, next); }
    catch { throw new Error('Could not save this change. Existing collections are intact. Export or remove an older collection to free extension storage, then retry.'); }
    return next;
  });
}

// Tells every open tab whose page script may be loaded how hold-drag should behave there, and
// loads the script into tabs of the origins in `inject` ('all' for every tab where it runs).
async function configureTabs(settings, allSites, inject) {
  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch { return; }
  await Promise.all(tabs.map(async tab => {
    // Chrome hides the address of a tab Link Meteor may no longer read (for example just after
    // all-sites access was removed): a page script still loaded there must stop.
    if (tab.url && !ordinaryUrl(tab.url)) return;
    const origin = tab.url ? new URL(tab.url).origin : '';
    const enabled = holdRuns(origin, settings, allSites);
    if (enabled && !tab.incognito && !tab.discarded && (inject === 'all' || inject.includes(origin))) {
      try { await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['content/capture.js']}); } catch { /* the page loads it on its next visit */ }
    }
    try { await chrome.tabs.sendMessage(tab.id, {type: 'content.configure', holdKey: settings.holdKey, holdTrigger: settings.holdTrigger, enabled}); }
    catch { /* no page script in this tab */ }
  }));
}

// Keeping access honest: drops origins Chrome no longer grants, returns the scope to 'sites' when
// all-sites access is gone, registers the page script to match and reconfigures open tabs.
// Run it inside serialHold. Returns the saved state.
export async function syncHold({inject = []} = {}) {
  let allSites = false;
  const state = await updateSettings(async settings => {
    allSites = await allSitesGranted();
    const origins = [];
    for (const origin of settings.holdOrigins) if (await originGranted(origin)) origins.push(origin);
    const patch = {};
    if (origins.length !== settings.holdOrigins.length) patch.holdOrigins = origins;
    if (settings.holdScope === 'all' && !allSites) patch.holdScope = 'sites';
    return patch;
  });
  let problem = null;
  try {
    const desired = holdRegistration(state.settings, allSites);
    const registered = (await chrome.scripting.getRegisteredContentScripts()).filter(script => script.id.startsWith(SCRIPT_PREFIX));
    if (!sameRegistration(registered, desired)) {
      if (registered.length) await chrome.scripting.unregisterContentScripts({ids: registered.map(script => script.id)});
      if (desired.length) await chrome.scripting.registerContentScripts(desired);
    }
  } catch (error) { problem = error; }
  // Open tabs follow the saved settings even when Chrome refused the registration.
  await configureTabs(state.settings, allSites, inject);
  if (problem) throw new Error(`Your settings were saved, but Chrome could not update where hold-key drag runs: ${problem.message || problem}`);
  return state;
}

let pendingSync = null;
// Queues one sync after the current hold operation; requests made before it starts share it.
export function requestSync() {
  if (!pendingSync) pendingSync = serialHold(() => { pendingSync = null; return syncHold(); });
  return pendingSync.catch(() => {});
}

// With all-sites access, every page load asks for settings.get, so the settings are kept in memory
// between saved changes instead of reading the whole saved state each time. A restarted service
// worker starts empty, and any change to the saved state replaces or clears the copy.
let settingsCache = null;
export function forgetSettings() { settingsCache = null; }

// onStateWritten listener: any saved change to hold settings, including a restore and its Undo,
// re-registers scripts and reconfigures open tabs.
export function followHoldWrites(previous, next) {
  settingsCache = next?.settings || null;
  const changed = HOLD_FIELDS.some(key => JSON.stringify(previous?.settings?.[key]) !== JSON.stringify(next?.settings?.[key]));
  if (changed) requestSync();
}

// settings.get: the saved settings, limited to what Chrome still grants.
export async function grantedSettings() {
  if (!settingsCache) settingsCache = (await serial(readState)).settings;
  const settings = settingsCache;
  const allSites = await allSitesGranted();
  const holdOrigins = [];
  for (const origin of settings.holdOrigins) if (await originGranted(origin)) holdOrigins.push(origin);
  return {...settings, holdOrigins, holdScope: settings.holdScope === 'all' && !allSites ? 'sites' : settings.holdScope};
}

// hold.scope: 'all' needs Chrome's all-sites access, requested by the page in the same click.
export async function setScope({scope}) {
  if (scope !== 'sites' && scope !== 'all') throw new Error("Choose 'sites' or 'all' for where hold-key drag runs.");
  if (scope === 'all' && !(await allSitesGranted())) throw new Error('Link Meteor does not have access to all sites yet. Allow it in Chrome’s prompt, then try again. Nothing was changed.');
  await updateSettings(() => ({holdScope: scope}));
  return syncHold({inject: scope === 'all' ? 'all' : []});
}

// hold.exception: "Never on these sites". Adding a site also takes it off the hold-drag sites.
export async function setException({origin, excepted}) {
  const site = siteOrigin(origin);
  if (typeof excepted !== 'boolean') throw new Error('Say whether this site is an exception.');
  try {
    await updateSettings(settings => excepted
      ? {holdExceptions: settings.holdExceptions.includes(site) ? settings.holdExceptions : [...settings.holdExceptions, site], holdOrigins: settings.holdOrigins.filter(item => item !== site)}
      : {holdExceptions: settings.holdExceptions.filter(item => item !== site)});
  } catch (error) {
    if (/at most/.test(error.message)) throw new Error('The “Never on these sites” list holds at most 1,000 sites. Remove one first.');
    throw error;
  }
  return syncHold({inject: excepted ? [] : [site]});
}

// hold.configure: hold-drag on one site while the scope is 'sites'. The page requests that exact
// origin first when enabling. Turning a site on takes it off the exceptions list.
export async function configureSite({origin, enabled, key}) {
  const site = siteOrigin(origin);
  if (typeof enabled !== 'boolean') throw new Error('Say whether hold-key drag is on for this site.');
  if (enabled && !(await originGranted(site))) throw new Error('Allow access to this site before enabling the hold-key shortcut.');
  await updateSettings(settings => {
    const origins = new Set(settings.holdOrigins);
    if (enabled) origins.add(site); else origins.delete(site);
    const patch = {holdOrigins: [...origins]};
    if (enabled && settings.holdExceptions.includes(site)) patch.holdExceptions = settings.holdExceptions.filter(item => item !== site);
    if (key !== undefined) patch.holdKey = key;
    return patch;
  });
  return syncHold({inject: enabled ? [site] : []});
}

// hold.settings: the trigger and letter, sent on to every tab where hold-drag runs.
export async function saveHoldSettings({trigger, key}) {
  const patch = {};
  if (trigger !== undefined) patch.holdTrigger = trigger;
  if (key !== undefined) patch.holdKey = key;
  if (!Object.keys(patch).length) throw new Error('Choose a hold trigger or a letter.');
  await updateSettings(() => patch);
  return syncHold();
}

// Workbench-only messages this module answers; the entry routes them.
export const workbenchMessages = {
  'hold.scope': message => serialHold(() => setScope(message)),
  'hold.exception': message => serialHold(() => setException(message)),
  'hold.configure': message => serialHold(() => configureSite(message)),
  'hold.settings': message => serialHold(() => saveHoldSettings(message)),
};
