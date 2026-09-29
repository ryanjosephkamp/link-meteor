// Links and page citations for the citation format checks (0.5.0): tests/cite.test.mjs compares
// each format with the golden files in tests/fixtures/cite/, and tests/exports-browser.mjs saves
// the same links in the loaded extension. Captured at noon UTC, so the access date is the same
// calendar day from UTC-11 to UTC+11.
const base = { accessibleLabel: '', originalHref: '', sourceUrl: 'https://review.example.net/articles/cooling', sourceTitle: 'Cooling cities: a review',
  frameUrl: '', capturedAt: '2026-09-25T12:00:00.000Z', batchId: 'cite-batch', notes: '', tags: [] };
const link = (id, extra) => ({ ...base, id: `cite-${id}`, ...extra });

export const FIELDS = [{ id: 'f-pi', name: 'Principal investigator' }, { id: 'f-due', name: 'Deadline' }];

export const LINKS = [
  link('doi', { anchorText: 'Surface temperature and tree canopy in 40 mid-sized cities', url: 'https://doi.org/10.5555/uhi.2024.0142',
    notes: 'Primary source for chapter 2.\nTable 3 has the canopy thresholds.', tags: ['chapter 2', 'canopy'],
    context: 'Across forty mid-sized cities, the canopy study found that blocks with more than 30% tree cover stayed cooler.', status: 'read', starred: true,
    fields: { 'f-pi': 'Dr. Okafor', 'f-due': '=March 1' } }),
  link('article', { anchorText: 'the review', url: 'https://journal.example.org/articles/42#results', tags: ['review'], status: 'reading' }),
  link('article2', { anchorText: 'a second paper', url: 'https://journal.example.org/articles/43' }),
  link('arxiv', { anchorText: 'Attention Is All You Need', url: 'https://arxiv.org/abs/1706.03762v5', context: 'Transformers, introduced in Attention Is All You Need, replaced recurrence.' }),
  link('pubmed', { anchorText: 'Heat-related mortality, a cohort study', url: 'https://pubmed.ncbi.nlm.nih.gov/31452104/' }),
  link('pmc', { anchorText: 'Full text on PMC', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6702837/' }),
  link('isbn', { anchorText: 'Urban Climates', url: 'https://openlibrary.org/isbn/9780306406157', imported: 'labs-shortlist.csv, row 3' }),
  link('specials', { anchorText: 'Heat & cooling: 50% of #cities_{2024} \\ ~ ^ <b> | $5 == [draft]', url: 'https://example.org/a_b?q={x}&y=%20',
    notes: '- = not a list\n## not a heading', tags: ['#heat island', '2024'] }),
  link('surface2', { anchorText: 'Surface albedo and street heat', url: 'https://data.example.com/albedo' }),
  link('label', { anchorText: '', accessibleLabel: 'Download the dataset', url: 'https://data.example.com/files/stations.csv' }),
  link('bare', { anchorText: '', url: 'https://www.cool-streets.example.org/' }),
  link('who', { anchorText: 'WHO heat guidance', url: 'https://who.example.int/heat' }),
  link('mail', { anchorText: 'Write to the lab', url: 'mailto:lab@example.edu?subject=Data' }),
];

export const PAGES = {
  'https://journal.example.org/articles/42': { title: 'Cooling cities: a review of street-level interventions', authors: ['Okafor, Amara', 'Jun Watanabe'],
    date: '2025/03/14', journal: 'Journal of Example Climate', volume: '12', issue: '3', firstPage: '45', lastPage: '52',
    doi: '10.5555/cool.2025.0007', readAt: '2026-09-25T12:00:00.000Z' },
  'https://journal.example.org/articles/43': { title: 'Green roofs & street canyons', authors: ['Okafor, Amara'], date: '14 March 2025',
    journal: 'Journal of Example Climate', firstPage: 'e1024', readAt: '2026-09-25T12:00:00.000Z' },
  'https://who.example.int/heat': { title: 'Heat and health', authors: ['World Health Organization', 'Smith, Jr., John'], date: 'n.d.', readAt: '2026-09-25T12:00:00.000Z' },
  // Only the source page was read: its citation is not the links' own.
  'https://review.example.net/articles/cooling': { title: 'Cooling cities: a review', authors: ['Rivera, Ana'], date: '2024', readAt: '2026-09-25T12:00:00.000Z' },
};

// The export time the golden files use, in local time.
export const EXPORTED_AT = new Date(2026, 8, 29, 11, 26, 30);
export const COLLECTION = 'Urban heat islands: thesis sources';
