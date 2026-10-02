// The capture report's frames from other sites (0.6.0). Capture this page reads every frame Link
// Meteor has access to; a result's `frames` ({read, unread, sites, left}) says how many frames were
// read by their own copy of the page script and how many weren't, and its warning names the sites
// Link Meteor has no access to. For those, the report offers Allow these sites: one Chrome request
// for exactly those sites, in the click, then the page is read again and only the links in the
// frames that weren't read before are added (capture.frames).
// The contract is in docs/CONTRACTS.md ("Frames from other sites, and closed components").
import { $, button, count, plural, hostOf } from './helpers.js';
import { ui, request, action, show } from './state.js';
import { render } from './rendering.js';

// "a.example", "a.example and b.example", "a.example, b.example, c.example and 2 more".
function siteNames(sites) {
  const hosts = sites.map((site) => hostOf(site) || site);
  if (hosts.length > 3) return `${hosts.slice(0, 3).join(', ')} and ${hosts.length - 3} more`;
  return hosts.length > 1 ? `${hosts.slice(0, -1).join(', ')} and ${hosts.at(-1)}` : hosts[0] || '';
}

// What the notice says once the page was read again: `added` is {count, skipped, leftOut, frames},
// where frames counts the frames that weren't read before and are now.
export function framesAdded(added, sites) {
  if (!added.frames) return `Link Meteor now has access to ${siteNames(sites)}, but the frames from ${sites.length === 1 ? 'that site' : 'those sites'} still couldn’t be read. The capture report says what is left.`;
  const frames = added.frames === 1 ? '1 more frame' : `${count(added.frames)} more frames`;
  const parts = [added.count ? `Added ${plural(added.count, 'link')} from ${frames}.` : `Read ${frames}: ${added.skipped || added.leftOut ? 'nothing new was added' : 'no links Link Meteor can read there'}.`];
  if (added.skipped) parts.push(`Skipped ${plural(added.skipped, 'link')} already saved.`);
  if (added.leftOut) parts.push(`Left out ${plural(added.leftOut, 'navigation link')}.`);
  return parts.join(' ');
}

async function allowFrames(result, report, again, allow) {
  const sites = result.frames.sites, names = siteNames(sites);
  // In the click, before anything is awaited: one request, for exactly these sites.
  const asking = chrome.permissions.request({ origins: sites.map((site) => `${site}/*`) });
  allow.disabled = true;
  try {
    let granted = false, problem = '';
    try { granted = await asking; } catch (error) { problem = error.message || String(error); }
    if (!granted) {
      show(problem ? `Chrome could not ask for access to ${names} (${problem}), so nothing changed.` : `Chrome’s request for access to ${names} was declined, so nothing changed. The frames from ${sites.length === 1 ? 'that site' : 'those sites'} are still not read.`, 'error');
      return;
    }
    const { state, report: merged, added } = await request({ type: 'capture.frames', tabId: result.tabId, batchId: report.batchId });
    if (added.count) { ui.flashBatch = merged.batchId; ui.flashStart = Date.now(); }
    ui.state = state; render(); again(merged);
    show(framesAdded(added, sites));
    // The button is gone, or new; focus stays in the report.
    const box = $('capture-report');
    (box.querySelector('.report-frames-allow') || box.querySelector('.report-actions:not(.report-left-out) button') || box.querySelector('.report-head button'))?.focus({ preventScroll: true });
  } finally { if (allow.isConnected) allow.disabled = false; }
}

// Adds Allow these sites to a page's report item, when it names sites Link Meteor could be allowed on.
// `again(report)` shows the report once the frames were added.
export function reportFrames(item, result, report, again) {
  const sites = result.frames?.sites || [];
  if (result.status !== 'success' || !sites.length) return;
  const allow = button(sites.length === 1 ? 'Allow this site' : 'Allow these sites', 'btn small report-allow report-frames-allow');
  allow.title = `Chrome asks to allow Link Meteor on ${sites.map((site) => hostOf(site) || site).join(', ')}. Then the page’s frames from ${sites.length === 1 ? 'that site' : 'those sites'} are read and their links added.`;
  allow.addEventListener('click', () => action(() => allowFrames(result, report, again, allow)));
  item.append(allow);
}
