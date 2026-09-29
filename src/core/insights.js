// Insights (0.5.0): counts for one collection, computed in this browser. Pure.
import { FILE_KINDS, urlFileType, isFileLink } from './files.js';
import { identifiersOf } from './identifiers.js';

const KIND_LABELS = { documents: 'Other documents', office: 'Office documents', openDocument: 'OpenDocument files', textAndData: 'Text and data',
  ebooks: 'E-books', archives: 'Archives', images: 'Images', audio: 'Audio', video: 'Video' };
const KIND_OF = new Map(Object.entries(FILE_KINDS).flatMap(([kind, types]) => types.map((type) => [type, kind])));
const DAY = 86400000;

function host(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.hostname.toLowerCase() : ''; } catch { return ''; } }
function scheme(value) { try { return new URL(value).protocol; } catch { return ''; } }

// The file-type group a link belongs to, as shown in Insights and used by its filter.
export function typeGroup(link) {
  const protocol = scheme(link.url);
  if (protocol === 'mailto:' || protocol === 'tel:') return 'Email and phone';
  const type = urlFileType(link.url);
  if (type === 'pdf' || (isFileLink(link) && !type)) return 'PDF';
  return type ? KIND_LABELS[KIND_OF.get(type)] : 'Web pages';
}

// Monday 00:00 UTC of the week holding this time.
function weekStart(time) {
  const day = new Date(Math.floor(time / DAY) * DAY);
  return day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY;
}

const top = (counts, limit) => [...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, limit);

// insights(links, {pages, weeks, limit}) for the links of one collection.
export function insights(links, { pages = {}, weeks = 26, limit = 10 } = {}) {
  const urls = new Map(), sites = new Map(), types = new Map(), sources = new Set();
  const status = { unread: 0, reading: 0, read: 0 };
  const relation = { other: 0, same: 0, unknown: 0 };
  let starred = 0, withIdentifier = 0;
  const times = [];
  for (const link of links) {
    const entry = urls.get(link.url) || { url: link.url, anchorText: link.anchorText, count: 0, labels: new Set() };
    entry.count++; entry.labels.add(link.anchorText); urls.set(link.url, entry);
    const site = host(link.url);
    if (site) sites.set(site, (sites.get(site) || 0) + 1);
    const group = typeGroup(link);
    types.set(group, (types.get(group) || 0) + 1);
    if (link.sourceUrl) sources.add(link.sourceUrl);
    status[link.status || 'unread']++;
    if (link.starred) starred++;
    if (Object.keys(identifiersOf(link, pages)).length) withIdentifier++;
    const source = host(link.sourceUrl);
    if (!site || !source) relation.unknown++; else if (site === source) relation.same++; else relation.other++;
    const time = Date.parse(link.capturedAt);
    if (Number.isFinite(time)) times.push(time);
  }
  const repeated = [...urls.values()].filter((entry) => entry.count > 1);
  // Weekly counts ending with the week of the latest capture, at most `weeks` weeks.
  const timeline = [];
  if (times.length) {
    const last = weekStart(Math.max(...times)), first = Math.max(weekStart(Math.min(...times)), last - (weeks - 1) * 7 * DAY);
    const counts = new Map();
    for (const time of times) { const week = weekStart(time); if (week >= first) counts.set(week, (counts.get(week) || 0) + 1); }
    for (let week = first; week <= last; week += 7 * DAY) timeline.push({ weekStart: new Date(week).toISOString().slice(0, 10), count: counts.get(week) || 0 });
  }
  return {
    total: links.length,
    uniqueUrls: urls.size,
    sites: sites.size,
    sourcePages: sources.size,
    withIdentifier,
    starred,
    topSites: top(sites, limit).map(([name, count]) => ({ host: name, count })),
    fileTypes: top(types, limit).map(([group, count]) => ({ group, count })),
    relation,
    status,
    repeats: {
      addresses: repeated.length,
      differentLabels: repeated.filter((entry) => entry.labels.size > 1).length,
      top: [...repeated].sort((a, b) => b.count - a.count || a.url.localeCompare(b.url)).slice(0, 5).map((entry) => ({ url: entry.url, anchorText: entry.anchorText, count: entry.count })),
    },
    timeline,
  };
}
