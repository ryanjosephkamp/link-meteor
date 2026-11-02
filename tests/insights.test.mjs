// Insights (0.5.0): counts for one collection, computed in the browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { insights, typeGroup } from '../src/core/insights.js';

let n = 0;
const link = (anchorText, url, sourceUrl, capturedAt, extra = {}) => ({ id: `i${++n}`, anchorText, accessibleLabel: '', url, originalHref: '', sourceUrl, sourceTitle: '', frameUrl: '', capturedAt, batchId: 'b', notes: '', tags: [], ...extra });
const review = 'https://review.example.net/articles/cooling';
const links = [
  link('Canopy study', 'https://doi.org/10.5555/uhi.2024.0142', review, '2026-09-01T10:00:00Z', { status: 'read', starred: true }),
  link('the canopy study', 'https://doi.org/10.5555/uhi.2024.0142', review, '2026-09-02T10:00:00Z'),
  link('Canopy study', 'https://doi.org/10.5555/uhi.2024.0142', review, '2026-09-15T10:00:00Z', { status: 'reading' }),
  link('Methods (PDF)', 'https://review.example.net/files/methods.pdf', review, '2026-09-15T11:00:00Z'),
  link('[PDF] Preprint', 'https://arxiv.org/pdf/2401.12345', review, '2026-09-16T11:00:00Z'),
  link('Data', 'https://data.example.com/station.xlsx', '', '2026-09-16T12:00:00Z', { imported: 'list.csv, row 2' }),
  link('Editors', 'mailto:editors@review.example.net', review, '2026-09-16T12:30:00Z'),
];

test('totals, sites, file types, relation and reading status', () => {
  const got = insights(links);
  assert.deepEqual([got.total, got.uniqueUrls, got.sites, got.sourcePages, got.withIdentifier, got.starred], [7, 5, 4, 1, 4, 1]);
  assert.deepEqual(got.topSites, [{ host: 'doi.org', count: 3 }, { host: 'arxiv.org', count: 1 }, { host: 'data.example.com', count: 1 }, { host: 'review.example.net', count: 1 }]);
  assert.deepEqual(got.fileTypes, [{ group: 'PDF', count: 2 }, { group: 'Web pages', count: 3 }].concat([{ group: 'Email and phone', count: 1 }, { group: 'Office documents', count: 1 }]).sort((a, b) => b.count - a.count || a.group.localeCompare(b.group)));
  assert.deepEqual(got.relation, { other: 4, same: 1, unknown: 2 });
  assert.deepEqual(got.status, { unread: 5, reading: 1, read: 1 });
});

test('repeats and different labels', () => {
  const { repeats } = insights(links);
  assert.deepEqual(repeats, { addresses: 1, differentLabels: 1, top: [{ url: 'https://doi.org/10.5555/uhi.2024.0142', anchorText: 'Canopy study', count: 3 }] });
});

test('captures over time, by week starting Monday, capped to the latest weeks', () => {
  const { timeline } = insights(links);
  assert.deepEqual(timeline, [{ weekStart: '2026-08-31', count: 2 }, { weekStart: '2026-09-07', count: 0 }, { weekStart: '2026-09-14', count: 5 }]);
  assert.deepEqual(insights(links, { weeks: 2 }).timeline, [{ weekStart: '2026-09-07', count: 0 }, { weekStart: '2026-09-14', count: 5 }]);
  assert.deepEqual(insights([]).timeline, []);
});

test('type groups', () => {
  assert.equal(typeGroup({ url: 'https://example.org/a.png', anchorText: '' }), 'Images');
  assert.equal(typeGroup({ url: 'https://example.org/page', anchorText: '[PDF] A paper' }), 'PDF');
  assert.equal(typeGroup({ url: 'tel:+15551234567', anchorText: 'Call' }), 'Email and phone');
  assert.equal(typeGroup({ url: 'https://example.org/notes.bib', anchorText: '' }), 'Text and data');
});
