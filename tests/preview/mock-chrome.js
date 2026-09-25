// Design-preview simulation of the extension APIs used by the workbench.
// Uses the real model/export modules; nothing here is acceptance evidence.
import { createState, reduceState } from '../core/model.js';

const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') || 'research';
let n = 0;
const iso = (minutes) => new Date(Date.UTC(2026, 8, 25, 14, 10) + minutes * 60000).toISOString();
const batch = (name) => `batch-${name}-2b7c91e4`;
function link(anchorText, url, source, extra = {}) {
  n += 1;
  return { id: `lm-preview-${n}`, anchorText, accessibleLabel: '', url, originalHref: new URL(url).pathname + new URL(url).search, sourceUrl: source.url, sourceTitle: source.title, frameUrl: source.url, capturedAt: iso(extra.minute ?? n), batchId: extra.batch ?? batch('a'), notes: '', tags: [], ...extra };
}
const journal = { url: 'https://journal.example.org/search?q=urban+heat+islands', title: 'Search results: urban heat islands · Journal of Example Climate' };
const review = { url: 'https://review.example.net/articles/cooling-cities', title: 'Cooling cities: a review of street-level interventions' };
const portal = { url: 'https://data.example.com/datasets?topic=temperature', title: 'Open temperature datasets · Example Data Portal' };
const tickets = { url: 'https://desk.example.com/queues/research-ops', title: 'Research Ops queue · Example Desk' };

function researchLinks() {
  n = 0;
  const a = batch('a'), b = batch('b'), c = batch('c');
  return [
    link('Surface temperature and tree canopy in 40 mid-sized cities', 'https://doi.org/10.5555/uhi.2024.0142', journal, { batch: a, notes: 'Primary source for chapter 2. Table 3 has the canopy thresholds.', tags: ['chapter 2', 'canopy'] }),
    link('Download PDF', 'https://journal.example.org/articles/uhi-2024-0142.pdf', journal, { batch: a }),
    link('Night-time heat retention in dense street canyons', 'https://doi.org/10.5555/uhi.2023.0877', journal, { batch: a }),
    link('Download PDF', 'https://journal.example.org/articles/uhi-2023-0877.pdf', journal, { batch: a }),
    link('Cool roofs: a ten-year field comparison', 'https://doi.org/10.5555/uhi.2022.0310', journal, { batch: a, tags: ['roofs'] }),
    link('Supplementary data (CSV)', 'https://journal.example.org/articles/uhi-2022-0310/supplement.csv', journal, { batch: a }),
    link('', 'https://journal.example.org/figures/canopy-map', journal, { batch: a, accessibleLabel: 'Figure 2: canopy coverage map' }),
    link('Measuring pedestrian heat exposure with wearable sensors', 'https://doi.org/10.5555/uhi.2021.0055', journal, { batch: a }),
    link('Albedo, asphalt, and afternoon peaks', 'https://doi.org/10.5555/uhi.2020.0419', journal, { batch: a }),
    link('Surface temperature and tree canopy in 40 mid-sized cities', 'https://doi.org/10.5555/uhi.2024.0142', review, { batch: b, minute: 30 }),
    link('Street trees reduce midday temperature by up to 4 °C', 'https://review.example.net/articles/cooling-cities#trees', review, { batch: b, minute: 31 }),
    link('the canopy study', 'https://doi.org/10.5555/uhi.2024.0142', review, { batch: b, minute: 32 }),
    link('Green corridors and airflow', 'https://review.example.net/articles/green-corridors', review, { batch: b, minute: 33 }),
    link('Contact the editors', 'mailto:editors@review.example.net', review, { batch: b, minute: 34 }),
    link('Hourly station temperatures, 2015–2025', 'https://data.example.com/datasets/station-hourly.xlsx', portal, { batch: c, minute: 50, tags: ['data'] }),
    link('Land-surface temperature tiles (GeoTIFF)', 'https://data.example.com/datasets/lst-tiles', portal, { batch: c, minute: 51 }),
    link('Methodology notes', 'https://data.example.com/docs/methodology.pdf', portal, { batch: c, minute: 52 }),
    link('=IMPORTXML("https://example.com")', 'https://data.example.com/docs/formula-looking-title', portal, { batch: c, minute: 53 }),
  ];
}

function seed() {
  let state = createState();
  const firstId = state.activeCollectionId;
  if (scenario === 'empty') return state;
  state = reduceState(state, { type: 'collection.update', id: firstId, patch: { name: 'Urban heat islands: thesis sources', notes: 'Peer-reviewed studies and datasets on street-level cooling. Check every DOI before citing.', tags: ['thesis', 'climate'] } });
  state = reduceState(state, { type: 'links.append', links: researchLinks() });
  state = reduceState(state, { type: 'collection.create', name: 'Research Ops tickets' });
  n = 100;
  state = reduceState(state, { type: 'links.append', links: [link('OPS-1142 Renew dataset licence', 'https://desk.example.com/tickets/1142', tickets), link('OPS-1150 Archive 2019 survey', 'https://desk.example.com/tickets/1150', tickets)] });
  state = reduceState(state, { type: 'collection.create', name: 'Reading list, spring' });
  if (scenario === 'large') {
    n = 1000;
    const many = Array.from({ length: 1240 }, (_, i) => link(`Catalog record ${i + 1}: specimen survey notes`, `https://archive.example.org/records/${i + 1}`, { url: 'https://archive.example.org/catalog', title: 'Specimen catalog · Example Archive' }));
    state = reduceState(state, { type: 'links.append', links: many });
  }
  return reduceState(state, { type: 'collection.activate', id: scenario === 'large' ? state.collections.at(-1).id : firstId });
}

let state = seed();
const tabs = [
  { id: 1, windowId: 7, title: journal.title, url: journal.url, active: true },
  { id: 2, windowId: 7, title: review.title, url: review.url, active: false },
  { id: 3, windowId: 7, title: portal.title, url: portal.url, active: false },
  { id: 4, windowId: 7, title: 'Settings', url: 'chrome://settings/', active: false },
  { id: 5, windowId: 8, title: tickets.title, url: tickets.url, active: true },
  { id: 6, windowId: 8, title: 'Example Domain', url: 'https://example.com/', active: false },
];
const report = {
  batchId: batch('c'), capturedCount: 4,
  results: scenario === 'mixed' ? [
    { tabId: 3, title: portal.title, url: portal.url, status: 'success', count: 4, warning: '1 inaccessible frame was excluded. Same-origin frames and open shadow roots are supported.', error: '' },
    { tabId: 6, title: 'Example Domain', url: 'https://example.com/', status: 'success', count: 0, warning: '', error: '' },
    { tabId: 5, title: tickets.title, url: tickets.url, status: 'denied', count: 0, warning: '', error: 'Cannot access contents of the page. Extension manifest must request permission to access the respective host.' },
    { tabId: 4, title: 'Settings', url: 'chrome://settings/', status: 'unsupported', count: 0, warning: 'Browser-internal pages, the Chrome Web Store, and incognito pages cannot be captured.', error: '' },
  ] : [{ tabId: 3, title: portal.title, url: portal.url, status: 'success', count: 4, warning: '', error: '' }],
};
const session = scenario === 'empty' || scenario === 'large' ? {} : { linkMeteorCaptureReport: { report, createdAt: iso(55) } };
const listeners = new Set();
const noop = { addListener() {} };
const ok = (data) => ({ ok: true, data: structuredClone(data) });

async function handle(message) {
  try {
    switch (message.type) {
      case 'state.get': return ok(state);
      case 'state.mutate': state = reduceState(state, message.action); return ok(state);
      case 'tabs.list': return ok({ tabs, currentWindowId: 7, targetTabId: 1 });
      case 'capture.run': return ok({ state, report });
      case 'capture.arm': return ok({ tabId: 1 });
      case 'links.open': return ok({ opened: message.urls.length, failed: 0 });
      case 'links.bookmark': return ok({ folderId: '1', count: message.links.length, failed: 0 });
      case 'hold.configure': {
        const origins = new Set(state.settings.holdOrigins);
        message.enabled ? origins.add(message.origin) : origins.delete(message.origin);
        state = reduceState(state, { type: 'settings.update', patch: { holdKey: message.key, holdOrigins: [...origins] } });
        return ok(state);
      }
      case 'ui.open': return ok({});
      default: return { ok: false, error: `Preview has no simulation for ${message.type}` };
    }
  } catch (error) { return { ok: false, error: error.message }; }
}

globalThis.chrome = {
  runtime: { sendMessage: handle, onMessage: { addListener: (fn) => listeners.add(fn) }, getURL: (path) => `/${path}` },
  storage: { onChanged: noop, session: { get: async () => structuredClone(session), set: async (value) => Object.assign(session, value), remove: async () => {} } },
  permissions: { request: async () => true, contains: async ({ origins }) => !origins?.some((origin) => origin.includes('desk.example.com')), onAdded: noop, onRemoved: noop },
  tabs: { create: async () => ({}), getCurrent: async () => (params.has('tab') ? { id: 99 } : undefined), onActivated: noop, onUpdated: noop, onRemoved: noop },
  windows: { onFocusChanged: noop },
  commands: { getAll: async () => [{ name: 'select-region', shortcut: params.get('shortcut') ?? '⌥⇧L' }] },
};
