// Background bookmark handlers against a small in-memory Chrome bookmarks mock. The mock follows
// the documented API shapes; the real API is exercised by tests/extended-browser.mjs once the
// profile has bookmark access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bookmarkLinks, bookmarkFolders, workbenchMessages } from '../src/background/bookmarks.js';

function tree() {
  return {
    id: '0', title: '', children: [
      { id: '1', parentId: '0', title: 'Bookmarks bar', children: [
        { id: '10', parentId: '1', title: 'Research', children: [
          { id: '100', parentId: '10', title: 'Existing A', url: 'https://example.org/a' },
          { id: '101', parentId: '10', title: 'Heat', children: [
            { id: '1010', parentId: '101', title: 'Nested B', url: 'https://example.org/b' },
          ] },
        ] },
        { id: '11', parentId: '1', title: 'News', url: 'https://news.example/' },
      ] },
      { id: '2', parentId: '0', title: 'Other bookmarks', children: [
        { id: '20', parentId: '2', title: '', children: [] },
        { id: '21', parentId: '2', title: 'Loose', url: 'https://loose.example/' },
      ] },
      { id: '3', parentId: '0', title: 'Mobile bookmarks', children: [] },
      { id: '4', parentId: '0', title: 'Managed bookmarks', unmodifiable: 'managed', children: [
        { id: '40', parentId: '4', title: 'Policy', unmodifiable: 'managed', children: [] },
      ] },
    ],
  };
}

function mockChrome({ granted = true } = {}) {
  const root = tree();
  let nextId = 500;
  const calls = [];
  const find = (id, node = root) => {
    if (node.id === id) return node;
    for (const child of node.children || []) { const found = find(id, child); if (found) return found; }
    return null;
  };
  const shallow = node => { const { children, ...rest } = node; return structuredClone(rest); };
  const chrome = {
    permissions: { contains: async ({ permissions }) => { calls.push(['contains', permissions]); return granted; } },
    bookmarks: {
      getTree: async () => { calls.push(['getTree']); return [structuredClone(root)]; },
      get: async (id) => { calls.push(['get', id]); const node = find(id); if (!node) throw new Error("Can't find bookmark for id."); return [shallow(node)]; },
      getChildren: async (id) => { calls.push(['getChildren', id]); const node = find(id); if (!node) throw new Error("Can't find parent bookmark for id."); return (node.children || []).map(shallow); },
      create: async ({ parentId = '2', title = '', url }) => {
        calls.push(['create', parentId, title, url]);
        const parent = find(parentId);
        if (!parent || parent.url !== undefined) throw new Error("Can't find parent bookmark for id.");
        if (parent.id === '0') throw new Error("Can't modify the root bookmark folders.");
        if (parent.unmodifiable) throw new Error("Can't modify managed bookmarks.");
        if (url?.includes('fail')) throw new Error('Invalid URL.');
        const node = { id: String(nextId++), parentId, title, ...(url === undefined ? { children: [] } : { url }) };
        parent.children.push(node);
        return shallow(node);
      },
    },
  };
  globalThis.chrome = chrome;
  return { root, calls, find };
}

const link = (url, anchorText = 'Label') => ({ anchorText, url });

test('bookmarks.folders lists every writable folder in tree order by path, without the root', async () => {
  mockChrome();
  const { folders } = await workbenchMessages['bookmarks.folders']({ type: 'bookmarks.folders' });
  assert.deepEqual(folders, [
    { id: '1', title: 'Bookmarks bar', path: 'Bookmarks bar', depth: 0 },
    { id: '10', title: 'Research', path: 'Bookmarks bar › Research', depth: 1 },
    { id: '101', title: 'Heat', path: 'Bookmarks bar › Research › Heat', depth: 2 },
    { id: '2', title: 'Other bookmarks', path: 'Other bookmarks', depth: 0 },
    { id: '20', title: '', path: 'Other bookmarks › (untitled folder)', depth: 1 },
    { id: '3', title: 'Mobile bookmarks', path: 'Mobile bookmarks', depth: 0 },
  ]);
  assert.equal(folders.some(folder => folder.id === '0'), false, 'no invisible root');
  assert.equal(folders.some(folder => ['100', '11', '21'].includes(folder.id)), false, 'bookmarks are not folders');
  assert.equal(folders.some(folder => ['4', '40'].includes(folder.id)), false, 'managed folders cannot be written');
});

test('without bookmark access, nothing is read or written and the error says so', async () => {
  const { calls } = mockChrome({ granted: false });
  await assert.rejects(bookmarkFolders(), /Allow bookmark access before choosing a folder/);
  await assert.rejects(bookmarkLinks('New', [link('https://example.org/x')]), /Allow bookmark access before saving bookmarks/);
  await assert.rejects(workbenchMessages['links.bookmark']({ folderId: '10', links: [link('https://example.org/x')] }), /Allow bookmark access/);
  assert.deepEqual(calls.filter(([name]) => name !== 'contains'), []);
});

test('folderId must name an existing, writable folder; name and folderId are exclusive', async () => {
  const { calls } = mockChrome();
  const links = [link('https://example.org/x')];
  const save = message => workbenchMessages['links.bookmark']({ links, ...message });
  await assert.rejects(save({ folderId: '999' }), /no longer exists/);
  await assert.rejects(save({ folderId: '100' }), /bookmark, not a folder/);
  await assert.rejects(save({ folderId: '0' }), /inside your bookmarks/);
  await assert.rejects(save({ folderId: '40' }), /manages that folder/);
  await assert.rejects(save({ folderId: 10 }), /Choose a bookmark folder/);
  await assert.rejects(save({ name: 'New', folderId: '10' }), /not both/);
  await assert.rejects(save({}), /Enter a bookmark folder name/);
  await assert.rejects(save({ name: '   ' }), /Enter a bookmark folder name/);
  await assert.rejects(save({ folderId: '10', skipExisting: 'yes' }), /skipExisting/);
  await assert.rejects(save({ folderId: '10', links: [link('mailto:a@example.org')] }), /Only HTTP and HTTPS/);
  await assert.rejects(save({ folderId: '10', links: Array.from({ length: 20001 }, (_, i) => link(`https://example.org/${i}`)) }), /at most 20,000/);
  assert.equal(calls.filter(([name]) => name === 'create').length, 0, 'nothing was created');
});

test('skipExisting skips exact URLs already directly in the folder, and repeats within one action', async () => {
  const { find } = mockChrome();
  const links = [link('https://example.org/a'), link('https://example.org/c', 'C'), link('https://example.org/c', 'C again'), link('https://example.org/b', 'B'), link('https://example.org/A', 'Case differs')];
  const result = await workbenchMessages['links.bookmark']({ type: 'links.bookmark', folderId: '10', links });
  assert.deepEqual(result, { folderId: '10', created: false, count: 3, skipped: 2, failed: 0 });
  assert.deepEqual(find('10').children.map(child => child.url ?? `folder:${child.title}`), ['https://example.org/a', 'folder:Heat', 'https://example.org/c', 'https://example.org/b', 'https://example.org/A'],
    'a URL only in a subfolder is not a direct child, so it is saved');
  assert.deepEqual(find('10').children.slice(2).map(child => child.title), ['C', 'B', 'Case differs']);
});

test('skipExisting false saves every link, including repeats', async () => {
  const { find } = mockChrome();
  const result = await bookmarkLinks(undefined, [link('https://example.org/a'), link('https://example.org/a')], { folderId: '10', skipExisting: false });
  assert.deepEqual(result, { folderId: '10', created: false, count: 2, skipped: 0, failed: 0 });
  assert.equal(find('10').children.filter(child => child.url === 'https://example.org/a').length, 3);
});

test('a new folder goes under Other bookmarks; the two-argument call still works', async () => {
  const { find } = mockChrome();
  const result = await bookmarkLinks('  Heat sources  ', [link('https://example.org/1', ''), link('https://example.org/2', 'Two'), link('https://example.org/1', 'Repeat')]);
  assert.equal(result.created, true);
  assert.deepEqual({ ...result, folderId: undefined }, { folderId: undefined, created: true, count: 2, skipped: 1, failed: 0 });
  const folder = find(result.folderId);
  assert.equal(folder.parentId, '2');
  assert.equal(folder.title, 'Heat sources');
  assert.deepEqual(folder.children.map(child => [child.title, child.url]), [['https://example.org/1', 'https://example.org/1'], ['Two', 'https://example.org/2']], 'a textless link is titled with its URL');
});

test('failed creations are counted and do not stop the rest', async () => {
  mockChrome();
  const result = await bookmarkLinks('Mixed', [link('https://example.org/ok'), link('https://example.org/fail'), link('https://example.org/fail'), link('https://example.org/ok2')]);
  assert.deepEqual({ count: result.count, skipped: result.skipped, failed: result.failed }, { count: 2, skipped: 0, failed: 2 }, 'a failed link is not remembered as present, so its repeat is tried again');
});

test('saving into an existing folder changes nothing else in the bookmarks', async () => {
  const { root } = mockChrome();
  const before = structuredClone(root);
  await workbenchMessages['links.bookmark']({ folderId: '101', links: [link('https://example.org/new')] });
  const strip = node => ({ ...node, children: node.children?.filter(child => !(node.id === '101' && child.url === 'https://example.org/new')).map(strip) });
  assert.deepEqual(strip(root), strip(before));
  assert.equal(root.children[0].children[0].children[1].children.at(-1).url, 'https://example.org/new');
});

test('the message table answers exactly links.bookmark and bookmarks.folders', () => {
  assert.deepEqual(Object.keys(workbenchMessages).sort(), ['bookmarks.folders', 'links.bookmark']);
});
