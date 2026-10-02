// Imports (0.5.0) in the background, with Chrome's APIs simulated in Node: import.commit to a new
// or an existing collection (columns created first, links checked again, one batch, one write),
// import.undo (the batch and anything the import created, refused once they changed), and
// bookmarks.folderLinks. API mocks, not Chrome itself; tests/imports-browser.mjs runs the real
// extension, and tests/extended-browser.mjs reads a real bookmark folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../src/core/model.js';
import {IMPORTS_KEY} from '../src/background/imports.js';

const event = () => ({listeners: [], addListener(fn) { this.listeners.push(fn); }});
const local = {linkMeteorState: createState()}, session = {};
let granted = true, failWrites = false;
const tree = {id: '0', title: '', children: [
  {id: '1', parentId: '0', title: 'Bookmarks bar', children: [
    {id: '10', parentId: '1', title: 'Research', children: [
      {id: '100', parentId: '10', title: 'Heat and Health Lab', url: 'https://heat-health.example.edu/'},
      {id: '101', parentId: '10', title: 'Labs', children: [
        {id: '1010', parentId: '101', title: 'Canopy', url: 'https://canopy.example.edu/join'},
        {id: '1011', parentId: '101', title: '', children: [{id: '10110', parentId: '1011', title: 'Deep', url: 'javascript:void(0)'}]},
      ]},
      {id: '102', parentId: '10', title: 'Mail the lab', url: 'mailto:lab@example.edu'},
    ]},
  ]},
  {id: '2', parentId: '0', title: 'Other bookmarks', children: []},
]};
const find = (id, node = tree) => node.id === id ? node : (node.children || []).map(child => find(id, child)).find(Boolean) || null;
globalThis.chrome = {
  storage: {
    onChanged: event(),
    local: {async get(key) { return {[key]: structuredClone(local[key])}; }, async set(value) { if (failWrites) throw new Error('QUOTA_BYTES quota exceeded'); Object.assign(local, structuredClone(value)); }},
    session: {async get(key) { return {[key]: structuredClone(session[key])}; }, async set(value) { Object.assign(session, structuredClone(value)); }, async remove(key) { delete session[key]; }},
  },
  runtime: {getURL: (path) => 'chrome-extension://meteor/' + path, sendMessage: async () => {}, onMessage: event(), onInstalled: event(), onStartup: event()},
  permissions: {async contains({permissions}) { return !!permissions && granted; }, onAdded: event(), onRemoved: event()},
  scripting: {async executeScript() { return []; }, async getRegisteredContentScripts() { return []; }, async unregisterContentScripts() {}, async registerContentScripts() {}},
  tabs: {async query() { return []; }, async get() { throw Error('No tab'); }, async sendMessage() {}, async create() { return {id: 99}; }, async update() {}},
  windows: {async getAll() { return []; }, async update() {}},
  bookmarks: {async getSubTree(id) { const node = find(id); if (!node) throw new Error("Can't find bookmark for id."); return [structuredClone(node)]; }},
  action: {onClicked: event()}, sidePanel: {open: async () => {}}, commands: {onCommand: event()}, contextMenus: {onClicked: event(), removeAll: async () => {}, create: () => {}},
};
await import('../src/background.js');

const WORKBENCH = {url: 'chrome-extension://meteor/ui/workbench.html'}, PAGE = {url: 'https://a.test/page', tab: {id: 1}};
const call = (message, sender = WORKBENCH) => new Promise((resolve) => chrome.runtime.onMessage.listeners[0](message, sender, resolve));
const ok = async (message, sender) => { const reply = await call(message, sender); assert.equal(reply.ok, true, reply.error); return reply.data; };
const refused = async (message, pattern, sender) => { const reply = await call(message, sender); assert.equal(reply.ok, false, 'expected a refusal'); assert.match(reply.error, pattern); return reply.error; };
const state = () => local.linkMeteorState;
const collection = (id) => state().collections.find((item) => item.id === id);
const planned = (i, extra = {}) => ({anchorText: `Lab ${i}`, url: `https://lab${i}.example.edu/`, originalHref: `lab${i}.example.edu`, notes: '', tags: [], imported: `labs.csv, row ${i + 1}`, ...extra});

test('import.commit to a new collection: the collection and its columns first, then the links as one batch, checked again', async () => {
  const first = state().activeCollectionId;
  const result = await ok({type: 'import.commit', newCollection: '  labs   shortlist ', newFields: [{key: 'new-1', name: 'Deadline'}, {key: 'new-2', name: 'PI'}], links: [
    planned(1, {id: 'ignored', batchId: 'ignored', capturedAt: '2000-01-01', sourceUrl: 'https://evil.example/', tags: ['heat', ' heat ', ''], status: 'read', starred: true, fields: {'new-1': 'Dec 1', 'new-2': ''}}),
    planned(2, {url: 'mailto:lab@example.edu', notes: 'Email first', status: '', starred: false, fields: {'new-2': 'Dr. Okafor'}}),
  ]});
  const home = collection(result.collectionId);
  assert.equal(home.name, 'labs shortlist');
  assert.equal(state().activeCollectionId, home.id, 'the new collection is shown');
  assert.deepEqual(home.fields.map((field) => field.name), ['Deadline', 'PI']);
  assert.deepEqual(result.fields, home.fields.map((field) => field.id));
  assert.equal(result.count, 2); assert.equal(result.skipped, 0);
  assert.deepEqual(result.state, state());
  const [one, two] = home.links;
  assert.equal(one.batchId, result.batchId); assert.equal(two.batchId, result.batchId);
  assert.notEqual(one.id, 'ignored'); assert.match(one.id, /^[0-9a-f-]{36}$/);
  assert.ok(Date.now() - Date.parse(one.capturedAt) < 60000);
  assert.deepEqual({...one, id: 'x', batchId: 'x', capturedAt: 'x'}, {id: 'x', anchorText: 'Lab 1', accessibleLabel: '', url: 'https://lab1.example.edu/', originalHref: 'lab1.example.edu',
    sourceUrl: '', sourceTitle: '', frameUrl: '', capturedAt: 'x', batchId: 'x', notes: '', tags: ['heat'], imported: 'labs.csv, row 2', status: 'read', starred: true, fields: {[home.fields[0].id]: 'Dec 1'}});
  assert.deepEqual([two.status, two.starred, two.fields], [undefined, undefined, {[home.fields[1].id]: 'Dr. Okafor'}]);
  assert.equal(session[IMPORTS_KEY].at(-1).batchId, result.batchId);
  // Undo removes the collection and goes back to the one that was open.
  const undone = await ok({type: 'import.undo', collectionId: home.id, batchId: result.batchId});
  assert.deepEqual([undone.count, undone.collectionRemoved, undone.fieldsRemoved], [2, true, 2]);
  assert.equal(collection(home.id), undefined);
  assert.equal(state().activeCollectionId, first);
  assert.equal(session[IMPORTS_KEY].some((record) => record.batchId === result.batchId), false);
  await refused({type: 'import.undo', collectionId: home.id, batchId: result.batchId}, /can no longer be undone/);
});

test('import.commit to an existing collection: its columns by id, skipSaved, and Undo that keeps everything else', async () => {
  const other = (await ok({type: 'state.mutate', action: {type: 'collection.create', name: 'Other'}})).activeCollectionId;
  const thesis = (await ok({type: 'state.mutate', action: {type: 'collection.create', name: 'Thesis'}})).activeCollectionId;
  await ok({type: 'state.mutate', action: {type: 'fields.add', collectionId: thesis, name: 'Principal investigator'}});
  const pi = collection(thesis).fields[0].id;
  await ok({type: 'state.mutate', action: {type: 'links.append', collectionId: thesis, links: [{id: 'kept', anchorText: 'Kept', accessibleLabel: '', url: 'https://lab1.example.edu/', originalHref: '', sourceUrl: '',
    sourceTitle: '', frameUrl: '', capturedAt: '2026-09-01T00:00:00.000Z', batchId: 'capture', notes: '', tags: [], fields: {[pi]: 'Dr. Rivera'}}]}});
  await ok({type: 'state.mutate', action: {type: 'links.remove', collectionId: thesis, ids: ['kept']}});
  await ok({type: 'state.mutate', action: {type: 'links.undo'}});
  await ok({type: 'state.mutate', action: {type: 'links.append', collectionId: other, links: [{id: 'gone', anchorText: 'Gone', accessibleLabel: '', url: 'https://gone.example/', originalHref: '', sourceUrl: '',
    sourceTitle: '', frameUrl: '', capturedAt: '2026-09-01T00:00:00.000Z', batchId: 'capture', notes: '', tags: []}]}});
  await ok({type: 'state.mutate', action: {type: 'links.remove', collectionId: other, ids: ['gone']}});
  await ok({type: 'state.mutate', action: {type: 'collection.activate', id: other}});
  const undoBefore = structuredClone(state().undo);
  const result = await ok({type: 'import.commit', collectionId: thesis, skipSaved: true, newFields: [{key: 'new-1', name: 'Deadline'}],
    links: [planned(1, {fields: {[pi]: 'Dr. R'}}), planned(2, {fields: {[pi]: 'Dr. O', 'new-1': 'Jan 15'}}), planned(3)]});
  assert.deepEqual([result.count, result.skipped, result.collectionId], [2, 1, thesis]);
  assert.equal(state().activeCollectionId, thesis, 'the destination is shown');
  const deadline = collection(thesis).fields[1].id;
  assert.deepEqual(collection(thesis).links.map((link) => [link.anchorText, link.fields]), [['Kept', {[pi]: 'Dr. Rivera'}], ['Lab 2', {[pi]: 'Dr. O', [deadline]: 'Jan 15'}], ['Lab 3', undefined]]);
  // Refused while the batch or its new column changed; allowed again once they are back.
  await ok({type: 'state.mutate', action: {type: 'link.update', collectionId: thesis, id: collection(thesis).links[1].id, patch: {notes: 'changed'}}});
  await refused({type: 'import.undo', collectionId: thesis, batchId: result.batchId}, /changed since the import/);
  await ok({type: 'state.mutate', action: {type: 'link.update', collectionId: thesis, id: collection(thesis).links[1].id, patch: {notes: ''}}});
  await ok({type: 'state.mutate', action: {type: 'fields.fill', collectionId: thesis, fieldId: deadline, ids: ['kept'], value: 'Mine'}});
  await refused({type: 'import.undo', collectionId: thesis, batchId: result.batchId}, /Other links now have values in the columns this import added/);
  await ok({type: 'state.mutate', action: {type: 'fields.fill', collectionId: thesis, fieldId: deadline, ids: ['kept'], value: ''}});
  await ok({type: 'state.mutate', action: {type: 'links.star', collectionId: thesis, ids: [collection(thesis).links[2].id], starred: true}});
  await refused({type: 'import.undo', collectionId: thesis, batchId: result.batchId}, /changed since the import/);
  await ok({type: 'state.mutate', action: {type: 'links.star', collectionId: thesis, ids: [collection(thesis).links[2].id], starred: false}});
  await refused({type: 'import.undo', collectionId: 'nope', batchId: result.batchId}, /can no longer be undone/);
  const undone = await ok({type: 'import.undo', collectionId: thesis, batchId: result.batchId});
  assert.deepEqual([undone.count, undone.collectionRemoved, undone.fieldsRemoved], [2, false, 1]);
  assert.deepEqual(collection(thesis).links.map((link) => link.id), ['kept']);
  assert.deepEqual(collection(thesis).fields.map((field) => field.name), ['Principal investigator']);
  assert.deepEqual(state().undo, undoBefore, 'the list’s own removal Undo is kept');
  assert.equal(state().activeCollectionId, other, 'back to the collection that was open');
});

test('import.undo is refused once the import’s own collection has other links, or the batch is gone', async () => {
  const made = await ok({type: 'import.commit', newCollection: 'Fresh', links: [planned(5)]});
  await ok({type: 'state.mutate', action: {type: 'links.append', collectionId: made.collectionId, links: [{id: 'extra', anchorText: 'Extra', accessibleLabel: '', url: 'https://extra.example/', originalHref: '',
    sourceUrl: '', sourceTitle: '', frameUrl: '', capturedAt: '2026-09-01T00:00:00.000Z', batchId: 'capture', notes: '', tags: []}]}});
  await refused({type: 'import.undo', collectionId: made.collectionId, batchId: made.batchId}, /This collection changed since the import/);
  await ok({type: 'state.mutate', action: {type: 'links.remove', collectionId: made.collectionId, ids: [collection(made.collectionId).links[0].id]}});
  await refused({type: 'import.undo', collectionId: made.collectionId, batchId: made.batchId}, /changed since the import/);
  await ok({type: 'state.mutate', action: {type: 'collection.delete', id: made.collectionId}});
  await refused({type: 'import.undo', collectionId: made.collectionId, batchId: made.batchId}, /no longer exists/);
  await refused({type: 'import.undo', collectionId: made.collectionId}, /Say which import/);
});

test('import.commit checks its message and every link, and a refusal changes nothing', async () => {
  const before = structuredClone(state());
  const thesis = before.collections.find((item) => item.name === 'Thesis').id;
  const cases = [
    [{links: [planned(1)]}, /Choose one destination/],
    [{collectionId: thesis, newCollection: 'Both', links: [planned(1)]}, /Choose one destination/],
    [{collectionId: 7, links: [planned(1)]}, /Choose a destination collection/],
    [{newCollection: '   ', links: [planned(1)]}, /Name the new collection/],
    [{newCollection: 'X', links: []}, /no links to import/],
    [{newCollection: 'X', links: 'many'}, /no links to import/],
    [{newCollection: 'X', links: Array.from({length: 20001}, (_, i) => planned(i))}, /at most 20,000 links/],
    [{newCollection: 'X', links: [planned(1)], newFields: [{key: 'Bad key', name: 'A'}]}, /new columns for this import are not valid/],
    [{newCollection: 'X', links: [planned(1)], newFields: [{key: 'new-1', name: 'A'}, {key: 'new-1', name: 'B'}]}, /not valid/],
    [{newCollection: 'X', links: [planned(1)], newFields: [{key: 'new-1'}]}, /not valid/],
    [{newCollection: 'X', links: [planned(1)], skipSaved: 'yes'}, /skip links already saved/],
    [{collectionId: 'gone', links: [planned(1)]}, /no longer exists/],
    [{newCollection: 'X', links: [planned(1, {imported: ''})]}, /where it came from/],
    [{newCollection: 'X', links: [planned(1, {imported: 'x'.repeat(301)})]}, /at most 300 characters/],
    [{newCollection: 'X', links: [planned(1, {url: 'javascript:alert(1)'})]}, /HTTP\(S\), mailto, or tel URL/],
    [{newCollection: 'X', links: [planned(1, {anchorText: 5})]}, /anchor text must be text/],
    [{newCollection: 'X', links: [planned(1, {tags: 'a, b'})]}, /tags must be a list/],
    [{newCollection: 'X', links: [planned(1, {status: 'done'})]}, /reading status/],
    [{newCollection: 'X', links: [planned(1, {starred: 'yes'})]}, /star must be true or false/],
    [{newCollection: 'X', links: [planned(1, {fields: {'new-9': 'x'}})]}, /column the import doesn’t have/],
    [{newCollection: 'X', links: [planned(1, {fields: []})]}, /custom values must be an object/],
    [{newCollection: 'X', links: [null]}, /must be an object/],
    [{newCollection: 'X', links: [planned(1)], newFields: [{key: 'a', name: 'Same'}, {key: 'b', name: 'same'}]}, /Two custom columns are named/],
    [{newCollection: 'X', links: [planned(1)], newFields: Array.from({length: 21}, (_, i) => ({key: `k${i}`, name: `C${i}`}))}, /at most 20 custom columns/],
    [{collectionId: thesis, skipSaved: true, links: [planned(1), planned(1, {anchorText: 'Again'})]}, /Every link is already saved there/],
  ];
  for (const [message, pattern] of cases) await refused({type: 'import.commit', ...message}, pattern);
  failWrites = true;
  await refused({type: 'import.commit', newCollection: 'X', links: [planned(1)]}, /Could not save the import, so nothing was added/);
  failWrites = false;
  await refused({type: 'import.commit', newCollection: 'X', links: [planned(1)]}, /must be requested from the Link Meteor workbench/, PAGE);
  await refused({type: 'import.undo', collectionId: thesis, batchId: 'x'}, /must be requested from the Link Meteor workbench/, PAGE);
  assert.deepEqual(state(), before, 'nothing changed');
});

test('bookmarks.folderLinks: a folder’s bookmarks with their folder paths, with or without subfolders', async () => {
  assert.deepEqual(await ok({type: 'bookmarks.folderLinks', folderId: '10', recursive: true}), {folder: {id: '10', title: 'Research'}, more: false, links: [
    {title: 'Heat and Health Lab', url: 'https://heat-health.example.edu/', path: 'Research'},
    {title: 'Canopy', url: 'https://canopy.example.edu/join', path: 'Research › Labs'},
    {title: 'Deep', url: 'javascript:void(0)', path: 'Research › Labs › (untitled folder)'},
    {title: 'Mail the lab', url: 'mailto:lab@example.edu', path: 'Research'},
  ]});
  assert.deepEqual((await ok({type: 'bookmarks.folderLinks', folderId: '10', recursive: false})).links.map((link) => link.title), ['Heat and Health Lab', 'Mail the lab']);
  assert.equal((await ok({type: 'bookmarks.folderLinks', folderId: '10'})).links.length, 4, 'subfolders by default');
  assert.deepEqual((await ok({type: 'bookmarks.folderLinks', folderId: '2'})).links, []);
  await refused({type: 'bookmarks.folderLinks', folderId: '100'}, /a bookmark, not a folder/);
  await refused({type: 'bookmarks.folderLinks', folderId: '999'}, /no longer exists/);
  await refused({type: 'bookmarks.folderLinks', folderId: ''}, /Choose a bookmark folder/);
  await refused({type: 'bookmarks.folderLinks', folderId: '10', recursive: 'yes'}, /include subfolders/);
  await refused({type: 'bookmarks.folderLinks', folderId: '10'}, /must be requested from the Link Meteor workbench/, PAGE);
  granted = false;
  await refused({type: 'bookmarks.folderLinks', folderId: '10'}, /Allow bookmark access before importing a folder/);
  granted = true;
  // At most 50,000 bookmarks; `more` says some were left out.
  find('2').children = Array.from({length: 50001}, (_, i) => ({id: `big-${i}`, parentId: '2', title: `B${i}`, url: `https://b.example/${i}`}));
  const big = await ok({type: 'bookmarks.folderLinks', folderId: '2'});
  assert.deepEqual([big.links.length, big.more], [50000, true]);
});

test('import.commit saves a PDF’s links (0.6.0): their pages, the PDF as their source when it was read from a tab, and its citation', async () => {
  const pdf = 'https://arxiv.org/pdf/2409.11211v1';
  const citation = {title: 'SplatFields', arxiv: '2409.11211', arxivVersion: 'v1', arxivCategory: 'cs.CV', date: '17 Sep 2024', pdfUrl: pdf, source: 'pdf', readAt: '2026-10-02T10:00:00.000Z'};
  const fromTab = await ok({type: 'import.commit', newCollection: 'From a PDF tab', pages: {[pdf]: citation}, links: [
    {anchorText: 'markomih.github.io/SplatFields', url: 'https://markomih.github.io/SplatFields', originalHref: 'https://markomih.github.io/SplatFields', sourceUrl: pdf, sourceTitle: '  SplatFields:   Neural Gaussian Splats ', pdfPage: 3, context: 'The code is publicly available: markomih.github.io/SplatFields.'},
    {anchorText: '', url: 'https://orcid.org/0000-0001-6305-3896', originalHref: 'https://orcid.org/0000-0001-6305-3896', sourceUrl: pdf, sourceTitle: 'SplatFields', pdfPage: 1},
  ]});
  const home = collection(fromTab.collectionId);
  assert.deepEqual(home.links.map((link) => [link.anchorText, link.pdfPage, link.sourceUrl, link.sourceTitle, link.imported, link.context]), [
    ['markomih.github.io/SplatFields', 3, pdf, 'SplatFields: Neural Gaussian Splats', undefined, 'The code is publicly available: markomih.github.io/SplatFields.'],
    ['', 1, pdf, 'SplatFields', undefined, undefined],
  ], 'empty anchor text stays empty; the PDF is the source page, not an "imported" label');
  assert.deepEqual(home.pages, {[pdf]: citation});
  assert.equal(new Set(home.links.map((link) => link.batchId)).size, 1, 'one batch');

  // From a file: no source page, an imported label, and the page.
  const fromFile = await ok({type: 'import.commit', collectionId: home.id, skipSaved: true, links: [
    {anchorText: 'the map', url: 'https://maps.example.org/site-4', originalHref: 'https://maps.example.org/site-4', imported: 'notes.pdf, page 1', pdfPage: 1, sourceUrl: 'https://evil.example/'},
    {anchorText: 'again', url: 'https://markomih.github.io/SplatFields', originalHref: 'x', imported: 'notes.pdf, page 2', pdfPage: 2},
  ]});
  assert.deepEqual([fromFile.count, fromFile.skipped], [1, 1]);
  const added = collection(home.id).links.at(-1);
  assert.deepEqual([added.imported, added.pdfPage, added.sourceUrl], ['notes.pdf, page 1', 1, ''], 'a file’s links never name a source page');

  // Undo removes the batch; refusals change nothing.
  const count = collection(home.id).links.length;
  await refused({type: 'import.commit', collectionId: home.id, links: [{anchorText: 'x', url: 'https://x.example/', originalHref: 'x', sourceUrl: 'file:///Users/someone/paper.pdf', pdfPage: 1}]}, /source page must be a web address/);
  await refused({type: 'import.commit', collectionId: home.id, links: [{anchorText: 'x', url: 'https://x.example/', originalHref: 'x', sourceUrl: pdf, pdfPage: 0}]}, /pdfPage must be a page number/);
  await refused({type: 'import.commit', collectionId: home.id, links: [{anchorText: 'x', url: 'https://x.example/', originalHref: 'x', sourceUrl: pdf}]}, /needs where it came from/);
  await refused({type: 'import.commit', collectionId: home.id, pages: [], links: [{anchorText: 'x', url: 'https://x.example/', originalHref: 'x', sourceUrl: pdf, pdfPage: 1}]}, /citation details for this import are not valid/);
  await refused({type: 'import.commit', collectionId: home.id, pages: {[pdf]: {source: 'elsewhere'}}, links: [{anchorText: 'x', url: 'https://x.example/', originalHref: 'x', sourceUrl: pdf, pdfPage: 1}]}, /source must be one of/);
  assert.equal(collection(home.id).links.length, count);
  await ok({type: 'import.undo', collectionId: home.id, batchId: fromFile.batchId});
  assert.equal(collection(home.id).links.length, count - 1);
});
