// Joining what the page script answered in each frame of a page (0.6.0), and the words the capture
// report uses for the frames nobody could read. Pure: no Chrome and no page access, so the suites
// can join real answers themselves. background/frames.js runs the script and uses these.
// The contract is in docs/CONTRACTS.md ("Frames from other sites, and closed components").
const MAX_LINKS = 20000;
// At most this many frames of one document are followed, this deep, and at most this many sites
// are named in one request.
const MAX_FRAMES = 1000, MAX_DEPTH = 32;
export const MAX_FRAME_SITES = 20;
const n = value => Number(value).toLocaleString('en-US');
const webOrigin = value => { try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : ''; } catch { return ''; } };
const hostOf = site => { try { return new URL(site).host; } catch { return site; } };
// "a.example", "a.example and b.example", "a.example, b.example, c.example and 2 more".
export function siteNames(sites) {
  const hosts = sites.map(hostOf);
  if (hosts.length > 3) return `${hosts.slice(0, 3).join(', ')} and ${n(hosts.length - 3)} more`;
  return hosts.length > 1 ? `${hosts.slice(0, -1).join(', ')} and ${hosts.at(-1)}` : hosts[0] || '';
}

// Joins what the page script's scan answered in each frame. `results` is executeScript's list of
// {frameId, result}; a frame whose copy did nothing answers null. Starting from the top document,
// each frame a document couldn't read is paired with the copy that ran inside it: by its place in
// the page, or, for a frame inside a shadow root (which has no place), by its site. A copy nobody
// pairs is left out: its frame is hidden in the page, or sits inside a frame that wasn't read.
// With `left` (the frames an earlier reading of the page left unread, each {site, at}), `links`
// holds just the links in those frames, where they are read now, and in the frames inside them:
// what is new since that reading. A frame is the same frame when its site and its place are the same.
// Returns null when the top document didn't answer, otherwise
// {links, page, site, malformed, capped, read, fresh, unread: [{site, at}]}; a site is '' and a
// place null where they can't be told.
export function joinFrames(results, {left} = {}) {
  const answers = (Array.isArray(results) ? results : []).filter(entry => Array.isArray(entry?.result?.links));
  const top = answers.find(entry => entry.frameId === 0) || answers.find(entry => entry.frameId === undefined);
  if (!top) return null;
  const others = answers.filter(entry => entry !== top && entry.frameId !== 0 && entry.frameId !== undefined);
  const placed = new Map(others.filter(entry => typeof entry.result.at === 'string' && entry.result.at).map(entry => [entry.result.at, entry]));
  const loose = others.filter(entry => typeof entry.result.at !== 'string');
  // Each frame left unread before counts once: a frame read now takes one of them.
  const waiting = Array.isArray(left) ? left.map(item => ({site: webOrigin(item?.site), at: typeof item?.at === 'string' && item.at ? item.at : null})) : null;
  const wasLeft = (site, at) => { const index = waiting ? waiting.findIndex(item => item.site === site && item.at === at) : -1; if (index !== -1) waiting.splice(index, 1); return index !== -1; };
  const used = new Set(), parts = [], unread = [];
  const visit = (result, chrome, fresh, depth) => {
    parts.push({result, chrome, fresh});
    for (const frame of Array.isArray(result.frames) ? result.frames.slice(0, MAX_FRAMES) : []) {
      const site = webOrigin(frame?.site), at = typeof frame?.at === 'string' && frame.at ? frame.at : null;
      const inside = at ? placed.get(at) : loose.find(entry => !used.has(entry) && webOrigin(entry.result.url) === site);
      if (!inside || used.has(inside) || depth >= MAX_DEPTH) { unread.push({site, at}); continue; }
      used.add(inside);
      visit(inside.result, chrome || frame.chrome === true, fresh || wasLeft(site, at), depth + 1);
    }
  };
  visit(top.result, false, false, 0);
  const links = [];
  let capped = false, malformed = 0;
  for (const {result, chrome, fresh} of parts) {
    malformed += Number(result.malformed) || 0;
    if (result.capped === true) capped = true;
    if (waiting && !fresh) continue;
    for (const link of result.links) {
      if (links.length === MAX_LINKS) { capped = true; break; }
      // A frame's links belong to the page: they keep their own frameUrl, and take the page as their source.
      links.push(result === top.result ? link : {...link, sourceUrl: top.result.url ?? link.sourceUrl, sourceTitle: top.result.title ?? link.sourceTitle, ...(chrome ? {pageChrome: true} : {})});
    }
  }
  return {links, page: top.result.page ?? null, site: webOrigin(top.result.url), malformed, capped, read: parts.length - 1, fresh: parts.filter(part => part.fresh).length, unread,
    // An answer without counts says them only in words.
    said: top.result.malformed === undefined && Array.isArray(top.result.warnings) ? top.result.warnings : null};
}

// What the capture report says about the frames that weren't read. `sites` are the ones Link Meteor
// could be allowed on, and `named` the frames from them; `own` of those frames belong to the page's
// own site, `page` (sandboxed frames, which the toolbar's temporary access doesn't cover). Any
// other frame that wasn't read is only counted: asking for a site wouldn't help it.
export function framesWarning({unread = 0, sites = [], named = 0, own = 0, page = ''} = {}) {
  const parts = [], rest = unread - named, away = named - own, others = sites.filter(site => site !== page);
  const frames = (count, kind = '') => count === 1 ? `1 ${kind}frame` : `${n(count)} ${kind}frames`;
  if (away && own) {
    parts.push(`${frames(named)} weren’t read: ${n(away)} from ${others.length === 1 ? 'another site' : 'other sites'} (${siteNames(others)}), which Link Meteor has no access to, and ${frames(own, 'sandboxed ')} of this site, `
      + `which the toolbar’s temporary access doesn’t cover. Allow ${others.length === 1 ? 'that site' : 'those sites'} and this one (${hostOf(page)}) to include their links.`);
  } else if (away) {
    parts.push(`${away === 1 ? '1 frame from another site wasn’t' : `${n(away)} frames from ${others.length === 1 ? 'another site' : 'other sites'} weren’t`} read, because Link Meteor has no access to ${siteNames(others)}. `
      + `Allow ${others.length === 1 ? 'that site' : 'those sites'} to include ${away === 1 ? 'its' : 'their'} links.`);
  } else if (own) {
    parts.push(`${frames(own, 'sandboxed ')} of this site ${own === 1 ? 'wasn’t' : 'weren’t'} read: the toolbar’s temporary access covers the page, not the frames it seals off. `
      + `Allow this site (${hostOf(page)}) to include ${own === 1 ? 'its' : 'their'} links.`);
  }
  if (rest > 0) parts.push(`${frames(rest, named ? 'more ' : '')} couldn’t be read: Chrome didn’t let Link Meteor into ${rest === 1 ? 'it' : 'them'}.`);
  return parts.join(' ');
}
