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
const text = value => typeof value === 'string' && value ? value : null;
// "a.example", "a.example and b.example", "a.example, b.example, c.example and 2 more".
export function siteNames(sites) {
  const hosts = sites.map(hostOf);
  if (hosts.length > 3) return `${hosts.slice(0, 3).join(', ')} and ${n(hosts.length - 3)} more`;
  return hosts.length > 1 ? `${hosts.slice(0, -1).join(', ')} and ${hosts.at(-1)}` : hosts[0] || '';
}

// Joins what the page script's scan answered in each frame. `results` is executeScript's list of
// {frameId, result}; a frame whose copy did nothing answers null. Starting from the top document,
// each frame a document couldn't read is paired with the copy that ran inside it: by its place in
// the page, or, for a frame inside a shadow root (which has no place), by its address and then by
// its site. A copy nobody pairs is left out: its frame is hidden in the page, or sits inside a frame
// that wasn't read.
// With `left` (the frames an earlier reading of the page left unread, each {site, at, key}) and
// `seen` (the keys of the frames it read), `links` holds just the links in those frames, where they
// are read now, and in the frames inside them: what is new since that reading. A frame is the same
// frame when its key is the same (the page script keeps one per frame element, so a place that
// changed, as when the page removes a frame before it, doesn't matter), or, without keys, when its
// site and its place are the same. A frame the page put in place of one left unread (that frame's
// element is gone, and this one is of the same site) counts as that frame, unless it was read before.
// Returns null when the top document didn't answer, otherwise {links, page, site, malformed, capped,
// read, fresh, seen, unread: [{site, at, key?, area, sealed?, loading?}]}; a site is '' and a place
// null where they can't be told. `seen` lists the keys of the frames whose links are now in the capture.
export function joinFrames(results, {left, seen} = {}) {
  const answers = (Array.isArray(results) ? results : []).filter(entry => Array.isArray(entry?.result?.links));
  const top = answers.find(entry => entry.frameId === 0) || answers.find(entry => entry.frameId === undefined);
  if (!top) return null;
  const others = answers.filter(entry => entry !== top && entry.frameId !== 0 && entry.frameId !== undefined);
  const placed = new Map(others.filter(entry => typeof entry.result.at === 'string' && entry.result.at).map(entry => [entry.result.at, entry]));
  const loose = others.filter(entry => typeof entry.result.at !== 'string');
  const used = new Set(), parts = [], unread = [], keys = new Set();
  // A frame without a place takes the unused copy at its address, or else one from its site.
  const pair = (url, site) => (url && loose.find(entry => !used.has(entry) && entry.result.url === url)) || (site && loose.find(entry => !used.has(entry) && webOrigin(entry.result.url) === site));
  const visit = (result, chrome, depth, frame, parent) => {
    const part = {result, chrome, frame, parent, fresh: false};
    parts.push(part);
    for (const item of Array.isArray(result.frames) ? result.frames.slice(0, MAX_FRAMES) : []) {
      const site = webOrigin(item?.site), at = text(item?.at), key = text(item?.key);
      if (key) keys.add(key);
      const info = {site, at, ...(key ? {key} : {}), area: Number(item?.area) > 0 ? Number(item.area) : 0, ...(item?.sealed === true ? {sealed: true} : {}), ...(item?.loading === true ? {loading: true} : {})};
      const inside = at ? placed.get(at) : pair(text(item?.url), site);
      if (!inside || used.has(inside) || depth >= MAX_DEPTH) { unread.push(info); continue; }
      used.add(inside);
      visit(inside.result, chrome || item.chrome === true, depth + 1, info, part);
    }
  };
  visit(top.result, false, 0, null, null);
  const frames = parts.slice(1), known = new Set(Array.isArray(seen) ? seen.filter(text) : []);
  if (Array.isArray(left)) {
    // Each frame left unread before counts once: a frame read now takes one of them.
    const waiting = left.map(item => ({site: webOrigin(item?.site), at: text(item?.at), key: text(item?.key)}));
    const take = test => { const index = waiting.findIndex(test); if (index !== -1) waiting.splice(index, 1); return index !== -1; };
    for (const part of frames) {
      const {site, at, key} = part.frame;
      part.fresh = part.parent.fresh || take(item => item.key && key ? item.key === key : item.site === site && item.at === at);
    }
    for (const part of frames) {
      const {site, key} = part.frame;
      if (!part.fresh) part.fresh = part.parent.fresh || (!!key && !known.has(key) && !!site && take(item => item.key && !keys.has(item.key) && item.site === site));
    }
  }
  const links = [];
  let capped = false, malformed = 0;
  for (const {result, chrome, fresh} of parts) {
    malformed += Number(result.malformed) || 0;
    if (result.capped === true) capped = true;
    if (Array.isArray(left) && !fresh) continue;
    for (const link of result.links) {
      if (links.length === MAX_LINKS) { capped = true; break; }
      // A frame's links belong to the page: they keep their own frameUrl, and take the page as their source.
      links.push(result === top.result ? link : {...link, sourceUrl: top.result.url ?? link.sourceUrl, sourceTitle: top.result.title ?? link.sourceTitle, ...(chrome ? {pageChrome: true} : {})});
    }
  }
  for (const part of frames) if (part.frame.key && (!Array.isArray(left) || part.fresh)) known.add(part.frame.key);
  return {links, page: top.result.page ?? null, site: webOrigin(top.result.url), malformed, capped, read: frames.length, fresh: frames.filter(part => part.fresh).length, seen: [...known], unread,
    // An answer without counts says them only in words.
    said: top.result.malformed === undefined && Array.isArray(top.result.warnings) ? top.result.warnings : null};
}

// What the capture report says about the frames that weren't read. `sites` are the ones Link Meteor
// could be allowed on, and `named` the frames from them; `own` of those frames belong to the page's
// own site, `page` (sandboxed frames, which the toolbar's temporary access doesn't cover).
// `unasked` frames come from `unaskedSites` more sites, past the MAX_FRAME_SITES one request names;
// `loading` frames hadn't loaded yet. Any other frame that wasn't read is only counted: asking for a
// site wouldn't help it.
export function framesWarning({unread = 0, sites = [], named = 0, own = 0, page = '', unasked = 0, unaskedSites = 0, loading = 0} = {}) {
  const parts = [], rest = unread - named - unasked - loading, away = named - own, others = sites.filter(site => site !== page);
  const frames = (count, kind = '') => count === 1 ? `1 ${kind}frame` : `${n(count)} ${kind}frames`;
  const were = (count) => count === 1 ? 'wasn’t' : 'weren’t';
  if (away && own) {
    parts.push(`${frames(named)} weren’t read: ${n(away)} from ${others.length === 1 ? 'another site' : 'other sites'} (${siteNames(others)}), which Link Meteor has no access to, and ${frames(own, 'sandboxed ')} of this site, `
      + `which the toolbar’s temporary access doesn’t cover. Allow ${others.length === 1 ? 'that site' : 'those sites'} and this one (${hostOf(page)}) to include their links.`);
  } else if (away) {
    parts.push(`${away === 1 ? '1 frame from another site wasn’t' : `${n(away)} frames from ${others.length === 1 ? 'another site' : 'other sites'} weren’t`} read, because Link Meteor has no access to ${siteNames(others)}. `
      + `Allow ${others.length === 1 ? 'that site' : 'those sites'} to include ${away === 1 ? 'its' : 'their'} links.`);
  } else if (own) {
    parts.push(`${frames(own, 'sandboxed ')} of this site ${were(own)} read: the toolbar’s temporary access covers the page, not the frames it seals off. `
      + `Allow this site (${hostOf(page)}) to include ${own === 1 ? 'its' : 'their'} links.`);
  }
  if (unasked > 0) parts.push(`${frames(unasked, 'more ')} from ${unaskedSites === 1 ? '1 more site' : `${n(unaskedSites)} more sites`} ${were(unasked)} read: Link Meteor asks for at most ${MAX_FRAME_SITES} sites at a time, and offers the rest once these are allowed.`);
  if (rest > 0) parts.push(`${frames(rest, named || unasked ? 'more ' : '')} couldn’t be read: Chrome didn’t let Link Meteor into ${rest === 1 ? 'it' : 'them'}.`);
  if (loading > 0) parts.push(`${frames(loading, named || unasked || rest > 0 ? 'more ' : '')} hadn’t loaded yet, so ${loading === 1 ? 'it wasn’t' : 'they weren’t'} read: scroll to ${loading === 1 ? 'it' : 'them'}, let ${loading === 1 ? 'it' : 'them'} load, and capture the page again.`);
  return parts.join(' ');
}
