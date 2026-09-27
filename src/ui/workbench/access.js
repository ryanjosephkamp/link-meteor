// Access and opening rules shared by the welcome card, site settings, capture and opening modules.
// No imports and no DOM: these rules are also checked directly in Node (tests/access-ui.test.mjs).

export const ALL_SITES = ['http://*/*', 'https://*/*'];
export const OPEN_LIMIT = 500;
export const CONFIRM_ABOVE = 20;
export const STRONG_ABOVE = 100;

// What Chrome currently grants, kept current by settings.js from chrome.permissions.
export const grants = { allSites: false, tabs: false, known: false };

export function isMac(platform = globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || '') {
  return /mac/i.test(platform);
}

// The hold modifier's name: Command on macOS, Ctrl elsewhere. Option/Alt and Shift are not offered.
export function modifierName(mac = isMac()) { return mac ? 'Command' : 'Ctrl'; }

// How the hold gesture reads in help text and on the welcome card.
export function holdGesture(settings, mac = isMac()) {
  return settings?.holdTrigger === 'modifier' ? modifierName(mac) : String(settings?.holdKey || 'z').toUpperCase();
}

// Where hold-drag runs: 'all' only while Chrome still grants all sites.
export function effectiveScope(settings, allSites) {
  return settings?.holdScope === 'all' && allSites ? 'all' : 'sites';
}

// Opening tiers: 'none' (nothing to open), 'direct' (1 to 20), 'confirm' (21 to 100), 'strong'
// (101 to 500) and 'refuse' (above 500).
export function openTier(count) {
  if (!count) return 'none';
  if (count > OPEN_LIMIT) return 'refuse';
  if (count > STRONG_ABOVE) return 'strong';
  if (count > CONFIRM_ABOVE) return 'confirm';
  return 'direct';
}

const nf = (n) => Number(n).toLocaleString('en-US');
const links = (n) => `${nf(n)} web link${n === 1 ? '' : 's'}`;

// The inline confirmation's question for 21 to 500 links.
export function openQuestion(count, skipped = 0) {
  const skip = skipped ? ` ${nf(skipped)} non-web row${skipped === 1 ? '' : 's'} will be skipped.` : '';
  if (openTier(count) === 'strong') return `Open ${links(count)}? That is a lot of tabs at once, and Chrome may slow down while they load. A new window or a tab group keeps them together.${skip}`;
  return `Open ${links(count)} in new tabs?${skip}`;
}

// The notice after an opening finishes or is cancelled.
export function openOutcome(result, { total, mode = 'tabs', skipped = 0, groupTitle = '' } = {}) {
  const parts = [];
  const opened = `${nf(result.opened)} link${result.opened === 1 ? '' : 's'}`;
  if (result.cancelled) parts.push(`Stopped after opening ${nf(result.opened)} of ${nf(total)} links. The tabs already open stay open.`);
  else if (mode === 'window') parts.push(`Opened ${opened} in a new window.`);
  else if (mode === 'group') {
    parts.push(result.groupTitled ? `Opened ${opened} in a tab group named “${groupTitle}”.`
      : `Opened ${opened} in an unnamed tab group. Naming it after the collection needs Chrome’s tab-group access, which was not given.`);
  } else parts.push(`Opened ${opened} in new tabs.`);
  if (result.failed) parts.push(`${nf(result.failed)} could not open.`);
  if (skipped) parts.push(`${nf(skipped)} non-web row${skipped === 1 ? ' was' : 's were'} skipped.`);
  return parts.join(' ');
}

// Capture this page: whether the click should first ask Chrome for the tab's site. It asks only
// when the tab's site is known, the tab cannot already be read (a toolbar click, a site grant or
// all-sites access) and no grant is known. `probe` is the latest {tabId, url, ok} check. Without
// the tabs permission, Chrome shows a tab's address only while Link Meteor can read that tab, so
// a visible address means no prompt is needed, even if the last check is older than a toolbar click.
export function pageAccessPlan({ target, origin, probe, allSites, originGranted, tabsGranted = true }) {
  if (!target) return { ask: false, reason: 'no-target' };
  if (!origin) return { ask: false, reason: target.url ? 'unsupported' : 'hidden' };
  if (!tabsGranted) return { ask: false, reason: 'readable' };
  if (probe && probe.tabId === target.id && probe.url === target.url) return { ask: !probe.ok, reason: probe.ok ? 'readable' : 'blocked' };
  if (allSites || originGranted) return { ask: false, reason: 'granted' };
  return { ask: true, reason: 'unknown' };
}
