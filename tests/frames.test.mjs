// Frames from other sites (0.6.0): joining what the page script answered in each frame
// (background/frame-join.js), the report's words, and the background's pipeline with Chrome's APIs
// simulated in Node: Capture this page in every frame, the fallback when the frames don't answer,
// and Allow these sites (capture.frames). API mocks, not Chrome itself; tests/access-content.mjs
// joins real answers from a real page, and tests/coverage-browser.mjs runs the loaded extension.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../src/core/model.js';
import {joinFrames, framesWarning, siteNames} from '../src/background/frame-join.js';

const PAGE_URL = 'https://a.test/page', A = 'https://a.test', B = 'https://b.test', C = 'https://c.test';
const link = (name, frameUrl = PAGE_URL, extra = {}) => ({anchorText: name, accessibleLabel: '', url: `https://links.test/${encodeURIComponent(name)}`, originalHref: `/${name}`, sourceUrl: frameUrl, sourceTitle: 'A frame’s own title', frameUrl, ...extra});
// A scan answer, as the page script gives it.
const answer = (frameId, {links = [], frames = [], at = frameId ? String(frameId - 1) : '', url = PAGE_URL, title = 'Page A', malformed = 0, capped = false, page = null} = {}) =>
  ({frameId, result: {links, inaccessibleFrames: frames.length, warnings: [], page, frames, at, url, title, malformed, capped}});
const names = (joined) => joined.links.map((item) => item.anchorText);
const left = (joined) => joined.unread.map((frame) => [frame.site, frame.at]);

test('joinFrames: the top document alone, and answers that aren’t answers', () => {
  assert.equal(joinFrames(undefined), null);
  assert.equal(joinFrames([]), null);
  assert.equal(joinFrames([{frameId: 3, result: null}, {frameId: 4, result: {}}]), null, 'no top document, no join');
  assert.equal(joinFrames([answer(2, {links: [link('Only a frame')]})]), null);
  const alone = joinFrames([answer(0, {links: [link('One'), link('Two')], page: {title: 'Cited'}})]);
  assert.deepEqual([names(alone), alone.read, alone.unread, alone.page, alone.site, alone.said], [['One', 'Two'], 0, [], {title: 'Cited'}, A, null]);
  // An answer in the older shape (as the other unit suites' stand-ins give): one result, no frame id, words only.
  const older = joinFrames([{result: {links: [link('Old')], warnings: ['2 malformed link destinations were excluded.']}}]);
  assert.deepEqual([names(older), older.said, older.unread], [['Old'], ['2 malformed link destinations were excluded.'], []]);
});

test('joinFrames: each unread frame is paired with the copy inside it, by its place; nothing twice, hidden and orphaned copies left out', () => {
  const results = [
    answer(0, {links: [link('Top')], frames: [{site: B, at: '0', chrome: false}, {site: C, at: '1', chrome: true}, {site: B, at: '3', chrome: false}]}),
    answer(5, {links: [link('In B', 'https://b.test/frame')], at: '0', url: 'https://b.test/frame', title: 'Frame B', frames: [{site: A, at: '0.0', chrome: false}], malformed: 2}),
    answer(6, {links: [link('In A, inside B', 'https://a.test/inner')], at: '0.0', url: 'https://a.test/inner'}),
    answer(7, {links: [link('In C', 'https://c.test/side', {context: 'Words around In C.'})], at: '1', url: 'https://c.test/side'}),
    answer(8, {links: [link('Hidden in the page', 'https://b.test/hidden')], at: '2', url: 'https://b.test/hidden'}),
    {frameId: 9, result: null},
  ];
  const joined = joinFrames(results);
  assert.deepEqual(names(joined), ['Top', 'In B', 'In A, inside B', 'In C']);
  assert.deepEqual([joined.read, joined.unread, joined.malformed, joined.capped, joined.fresh], [3, [{site: B, at: '3'}], 2, false, 0]);
  assert.deepEqual(joined.links.map((item) => [item.frameUrl, item.sourceUrl, item.sourceTitle, item.pageChrome]), [
    [PAGE_URL, PAGE_URL, 'A frame’s own title', undefined], ['https://b.test/frame', PAGE_URL, 'Page A', undefined],
    ['https://a.test/inner', PAGE_URL, 'Page A', undefined], ['https://c.test/side', PAGE_URL, 'Page A', true]], 'frames keep their frameUrl, take the page as their source, and inherit page chrome from their frame');
  assert.equal(joined.links[3].context, 'Words around In C.');
  // A frame inside a frame that wasn't read is left out, and not counted: nobody knows it is there.
  const orphan = joinFrames(results.filter((entry) => entry.frameId !== 5));
  assert.deepEqual([names(orphan), orphan.read, left(orphan)], [['Top', 'In C'], 1, [[B, '0'], [B, '3']]]);
  // The same answer is never used for two frames.
  const twice = joinFrames([answer(0, {frames: [{site: B, at: '0'}, {site: B, at: '0'}]}), answer(1, {links: [link('Once')], at: '0', url: 'https://b.test/x'})]);
  assert.deepEqual([names(twice), left(twice)], [['Once'], [[B, '0']]]);
  // The input is not changed.
  const frozen = JSON.stringify(results); joinFrames(results); assert.equal(JSON.stringify(results), frozen);
});

test('joinFrames: a frame with no place (inside a shadow root) is paired by its site, each copy once', () => {
  const results = [
    answer(0, {links: [link('Top')], frames: [{site: B, at: null, chrome: false}, {site: B, at: null, chrome: false}, {site: C, at: null, chrome: false}, {site: B, at: null, chrome: false}]}),
    answer(1, {links: [link('First B')], at: null, url: 'https://b.test/one'}),
    answer(2, {links: [link('Second B')], at: null, url: 'https://b.test/two'}),
    answer(3, {links: [link('Placed B')], at: '4', url: 'https://b.test/placed'}),
  ];
  const joined = joinFrames(results);
  assert.deepEqual([names(joined), joined.read, left(joined)], [['Top', 'First B', 'Second B'], 2, [[C, null], [B, null]]], 'a placed copy is never taken for a frame without a place');
});

test('joinFrames: with `left`, only the frames an earlier reading left unread, and the frames inside them, give links', () => {
  // The page: a frame from b.test (holding one from c.test), one from c.test, and one with no site.
  const results = [
    answer(0, {links: [link('Top')], frames: [{site: B, at: '0'}, {site: C, at: '1'}, {site: 'not a site', at: '2'}, {site: A, at: '3'}]}),
    answer(1, {links: [link('In B')], at: '0', url: 'https://b.test/frame', frames: [{site: C, at: '0.0'}, {site: A, at: '0.1'}]}),
    answer(2, {links: [link('In C, inside B')], at: '0.0', url: 'https://c.test/inner'}),
    answer(3, {links: [link('In C')], at: '1', url: 'https://c.test/frame', malformed: 1}),
    answer(4, {links: [link('In A, inside B')], at: '0.1', url: 'https://a.test/inner'}),
    answer(5, {links: [link('Sandboxed')], at: '3', url: 'https://a.test/sealed'}),
  ];
  // Before, b.test's frame was unread: it is new, with everything inside it.
  const fresh = joinFrames(results, {left: [{site: B, at: '0'}]});
  assert.deepEqual([names(fresh), fresh.fresh, fresh.read, left(fresh), fresh.malformed], [['In B', 'In C, inside B', 'In A, inside B'], 3, 5, [['', '2']], 1], 'the counts are still the whole page’s');
  // Before, only the sandboxed frame of the page's own site was unread: the frame of that site
  // inside b.test's frame was read then, and is not added again.
  assert.deepEqual(names(joinFrames(results, {left: [{site: A, at: '3'}]})), ['Sandboxed']);
  assert.deepEqual(names(joinFrames(results, {left: [{site: C, at: '1'}, {site: C, at: '0.0'}]})), ['In C, inside B', 'In C']);
  // The same place with another site is another frame; nothing left unread means nothing new.
  assert.deepEqual(names(joinFrames(results, {left: [{site: C, at: '0'}]})), []);
  assert.deepEqual(names(joinFrames(results, {left: []})), []);
  // Frames without a place are told apart by site, one for one.
  const loose = [answer(0, {frames: [{site: B, at: null}, {site: B, at: null}]}), answer(1, {links: [link('Loose one')], at: null, url: 'https://b.test/1'}), answer(2, {links: [link('Loose two')], at: null, url: 'https://b.test/2'})];
  assert.deepEqual(names(joinFrames(loose, {left: [{site: B, at: null}]})), ['Loose one']);
  assert.deepEqual(names(joinFrames(loose, {left: [{site: B}, {site: B, at: ''}]})), ['Loose one', 'Loose two']);
});

test('joinFrames: limits', () => {
  const many = (count, name) => Array.from({length: count}, (_, i) => link(`${name} ${i}`));
  const capped = joinFrames([answer(0, {links: many(19999, 'Top'), frames: [{site: B, at: '0'}]}), answer(1, {links: many(5, 'Frame'), at: '0', url: 'https://b.test/f'})]);
  assert.deepEqual([capped.links.length, capped.capped, capped.links.at(-1).anchorText], [20000, true, 'Frame 0']);
  assert.equal(joinFrames([answer(0, {links: many(3, 'Top'), capped: true})]).capped, true);
  // Frames nested deeper than any real page are counted, not followed forever.
  const deep = [answer(0, {frames: [{site: B, at: '0'}]})];
  for (let depth = 1; depth <= 40; depth++) deep.push(answer(depth, {links: [link(`Depth ${depth}`)], at: Array(depth).fill('0').join('.'), url: 'https://b.test/deep', frames: [{site: B, at: Array(depth + 1).fill('0').join('.')}]}));
  const followed = joinFrames(deep);
  assert.deepEqual([followed.links.length, left(followed)], [32, [[B, Array(33).fill('0').join('.')]]]);
});

test('the report’s words for frames that weren’t read', () => {
  assert.equal(siteNames([B]), 'b.test');
  assert.equal(siteNames([B, C]), 'b.test and c.test');
  assert.equal(siteNames([A, B, C]), 'a.test, b.test and c.test');
  assert.equal(siteNames([A, B, C, 'https://d.test', 'http://e.test:8080']), 'a.test, b.test, c.test and 2 more');
  assert.equal(framesWarning({}), '');
  assert.equal(framesWarning({unread: 1, sites: [B], named: 1, page: A}), '1 frame from another site wasn’t read, because Link Meteor has no access to b.test. Allow that site to include its links.');
  assert.equal(framesWarning({unread: 3, sites: [B], named: 3, page: A}), '3 frames from another site weren’t read, because Link Meteor has no access to b.test. Allow that site to include their links.');
  assert.equal(framesWarning({unread: 2, sites: [B, C], named: 2, page: A}), '2 frames from other sites weren’t read, because Link Meteor has no access to b.test and c.test. Allow those sites to include their links.');
  assert.equal(framesWarning({unread: 1, sites: [A], named: 1, own: 1, page: A}), '1 sandboxed frame of this site wasn’t read: the toolbar’s temporary access covers the page, not the frames it seals off. Allow this site (a.test) to include its links.');
  assert.equal(framesWarning({unread: 2, sites: [A], named: 2, own: 2, page: A}), '2 sandboxed frames of this site weren’t read: the toolbar’s temporary access covers the page, not the frames it seals off. Allow this site (a.test) to include their links.');
  assert.equal(framesWarning({unread: 3, sites: [A, B], named: 3, own: 1, page: A}), '3 frames weren’t read: 2 from another site (b.test), which Link Meteor has no access to, and 1 sandboxed frame of this site, which the toolbar’s temporary access doesn’t cover. Allow that site and this one (a.test) to include their links.');
  assert.equal(framesWarning({unread: 1, sites: [], named: 0, page: A}), '1 frame couldn’t be read: Chrome didn’t let Link Meteor into it.');
  assert.equal(framesWarning({unread: 2000, sites: [], named: 0, page: A}), '2,000 frames couldn’t be read: Chrome didn’t let Link Meteor into them.');
  assert.equal(framesWarning({unread: 3, sites: [B], named: 1, page: A}), '1 frame from another site wasn’t read, because Link Meteor has no access to b.test. Allow that site to include its links. 2 more frames couldn’t be read: Chrome didn’t let Link Meteor into them.');
});

/* The background's pipeline, with Chrome's APIs simulated. */
const event = () => ({listeners: [], addListener(fn) { this.listeners.push(fn); }});
const local = {linkMeteorState: createState()}, session = {};
const tabs = [{id: 1, windowId: 1, url: PAGE_URL, title: 'Page A'}, {id: 3, windowId: 1, url: 'chrome-extension://meteor/ui/workbench.html', title: 'Link Meteor', active: true}];
// What each frame answers, the sites Link Meteor has access to, and how the frames behave; set by the checks.
const page = {answers: [], allowed: new Set(), frames: 'answer'};
const scripted = [];
globalThis.chrome = {
  storage: {
    onChanged: event(),
    local: {async get(key) { return {[key]: structuredClone(local[key])}; }, async set(value) { Object.assign(local, structuredClone(value)); }},
    session: {async get(key) { return {[key]: structuredClone(session[key])}; }, async set(value) { Object.assign(session, structuredClone(value)); }, async remove(key) { delete session[key]; }},
  },
  runtime: {getURL: (path) => 'chrome-extension://meteor/' + path, sendMessage: async () => {}, onMessage: event(), onInstalled: event(), onStartup: event()},
  permissions: {async contains({origins = []}) { return origins.every((origin) => page.allowed.has(origin.replace(/\/\*$/, ''))); }, onAdded: event(), onRemoved: event()},
  scripting: {
    // Like Chrome: with allFrames, the top document and every frame Link Meteor has access to answer.
    async executeScript(spec) {
      scripted.push(spec);
      const all = spec.target.allFrames === true;
      if (all && page.frames === 'fail') throw new Error('Frame with ID 12 was removed.');
      if (all && page.frames === 'hang') return new Promise(() => {});
      if (spec.files) return [];
      if (spec.func.name === 'documentType') return [{frameId: 0, result: 'text/html'}];
      // The toolbar's temporary access reaches the page's own site, except a frame it seals off (`sealed`).
      const reached = (entry, origin = new URL(entry.result.url).origin) => page.allowed.has(origin) || (origin === A && !entry.sealed);
      return page.answers.filter((entry) => entry.frameId === 0 || (all && reached(entry))).map(({sealed, ...entry}) => structuredClone(entry));
    },
    async getRegisteredContentScripts() { return []; }, async unregisterContentScripts() {}, async registerContentScripts() {},
  },
  tabs: {async query() { return tabs; }, async get(id) { const tab = tabs.find((t) => t.id === id); if (!tab) throw Error('No tab with id: ' + id); return tab; }, async sendMessage() {}, async create() { return {id: 99}; }, async update() {}},
  windows: {async getAll() { return [{id: 1, focused: true, tabs}]; }, async update() {}},
  action: {onClicked: event()}, sidePanel: {open: async () => {}}, commands: {onCommand: event()}, contextMenus: {onClicked: event(), removeAll: async () => {}, create: () => {}},
};
await import('../src/background.js');
const {scanTab, FRAMES_MS} = await import('../src/background/frames.js');

const WORKBENCH = {url: 'chrome-extension://meteor/ui/workbench.html', tab: tabs[1]};
const call = (message, sender = WORKBENCH) => new Promise((resolve) => chrome.runtime.onMessage.listeners[0](message, sender, resolve));
const ok = async (message, sender) => { const reply = await call(message, sender); assert.equal(reply.ok, true, reply.error); return reply.data; };
const refused = async (message, pattern, sender) => { const reply = await call(message, sender); assert.equal(reply.ok, false, 'expected a refusal'); assert.match(reply.error, pattern); };
const collection = (id) => local.linkMeteorState.collections.find((c) => c.id === id);
const active = () => collection(local.linkMeteorState.activeCollectionId);
// A page at a.test with a frame from b.test (holding a frame from a.test), a sidebar frame from c.test, and a sandboxed frame of its own.
const PAGE = () => [
  answer(0, {links: [link('Top'), link('Nav', PAGE_URL, {pageChrome: true})], page: {title: 'Cited page'}, malformed: 1,
    frames: [{site: B, at: '0', chrome: false}, {site: C, at: '1', chrome: true}, {site: A, at: '2', chrome: false}]}),
  answer(4, {links: [link('In B', 'https://b.test/frame', {context: 'Words around In B.'})], at: '0', url: 'https://b.test/frame', frames: [{site: A, at: '0.0', chrome: false}]}),
  answer(5, {links: [link('In A, inside B', 'https://a.test/inner')], at: '0.0', url: 'https://a.test/inner'}),
  answer(6, {links: [link('In C', 'https://c.test/side')], at: '1', url: 'https://c.test/side', malformed: 2}),
];
const reset = async ({allowed = [], frames = 'answer', settings = {}} = {}) => {
  page.answers = PAGE(); page.allowed = new Set(allowed); page.frames = frames; scripted.length = 0; tabs[0].url = PAGE_URL;
  await ok({type: 'state.mutate', action: {type: 'settings.update', patch: {contentOnly: false, skipSaved: false, saveContext: true, ...settings}}});
};
const saved = (batchId, home = active()) => home.links.filter((item) => item.batchId === batchId).map((item) => item.anchorText);
const SEALED = () => ({...answer(7, {links: [link('Sandboxed', 'https://a.test/sealed')], at: '2', url: 'https://a.test/sealed'}), sealed: true});
const LEFT = {b: {site: B, at: '0'}, c: {site: C, at: '1'}, sealed: {site: A, at: '2'}};

test('Capture this page runs the page script in every frame at once, joins the answers, and names the frames it couldn’t read', async () => {
  await reset();
  const {report} = await ok({type: 'capture.run', tabIds: [1]});
  const [result] = report.results;
  assert.deepEqual(scripted.map((spec) => [spec.files ? 'files' : spec.func.name, spec.target.allFrames === true, spec.injectImmediately === true]),
    [['documentType', false, false], ['files', false, false], ['files', true, true], ['scan', true, true]], 'the top document as before; then every frame, without waiting for frames still loading');
  assert.deepEqual(scripted.at(-1).args, [{context: true}]);
  assert.deepEqual([result.status, result.count, result.frames], ['success', 2, {read: 0, unread: 3, sites: [A, B, C], left: [LEFT.b, LEFT.c, LEFT.sealed]}]);
  assert.equal(result.warning, '1 malformed link destination was excluded. 3 frames weren’t read: 2 from other sites (b.test and c.test), which Link Meteor has no access to, and 1 sandboxed frame of this site, which the toolbar’s temporary access doesn’t cover. Allow those sites and this one (a.test) to include their links.');
  assert.deepEqual(saved(report.batchId), ['Top', 'Nav']);
  assert.equal(report.collectionId, active().id, 'the report says where the capture went');
  assert.equal(active().pages[PAGE_URL].title, 'Cited page', 'the page’s citation is the top document’s');
  assert.deepEqual(session.linkMeteorCaptureReport.report, report);

  // With access to b.test: its frame is read, and the frame of the page's own site inside it (the
  // toolbar's access reaches that one); c.test's frame and the sandboxed one are named.
  await reset({allowed: [B]});
  const some = (await ok({type: 'capture.run', tabIds: [1]})).report;
  assert.deepEqual([some.results[0].count, some.results[0].frames, some.results[0].warning], [4, {read: 2, unread: 2, sites: [A, C], left: [LEFT.c, LEFT.sealed]},
    '1 malformed link destination was excluded. 2 frames weren’t read: 1 from another site (c.test), which Link Meteor has no access to, and 1 sandboxed frame of this site, which the toolbar’s temporary access doesn’t cover. Allow that site and this one (a.test) to include their links.']);
  const links = active().links.filter((item) => item.batchId === some.batchId);
  assert.deepEqual(links.map((item) => [item.anchorText, item.frameUrl, item.sourceUrl, item.sourceTitle, item.context]), [
    ['Top', PAGE_URL, PAGE_URL, 'Page A', undefined], ['Nav', PAGE_URL, PAGE_URL, 'Page A', undefined],
    ['In B', 'https://b.test/frame', PAGE_URL, 'Page A', 'Words around In B.'], ['In A, inside B', 'https://a.test/inner', PAGE_URL, 'Page A', undefined]]);

  // A site Link Meteor has access to, whose frame still didn't answer: counted, with nothing to ask for.
  await reset({allowed: [A, B]});
  const counted = (await ok({type: 'capture.run', tabIds: [1]})).report.results[0];
  assert.deepEqual([counted.frames, counted.warning], [{read: 2, unread: 2, sites: [C], left: [LEFT.c, LEFT.sealed]},
    '1 malformed link destination was excluded. 1 frame from another site wasn’t read, because Link Meteor has no access to c.test. Allow that site to include its links. 1 more frame couldn’t be read: Chrome didn’t let Link Meteor into it.']);

  // With every site: everything once, nothing left to say but the malformed links (counted across frames).
  await reset({allowed: [A, B, C]});
  page.answers.push(SEALED());
  const all = (await ok({type: 'capture.run', tabIds: [1]})).report;
  assert.deepEqual([saved(all.batchId), all.results[0].frames, all.results[0].warning], [['Top', 'Nav', 'In B', 'In A, inside B', 'In C', 'Sandboxed'], {read: 4, unread: 0, sites: [], left: []}, '3 malformed link destinations were excluded.']);
  // A page without frames from other sites says nothing about frames.
  page.answers = [answer(0, {links: [link('Plain')]})];
  const plain = (await ok({type: 'capture.run', tabIds: [1]})).report.results[0];
  assert.deepEqual(['frames' in plain, plain.warning], [false, '']);
});

test('content links only and Skip saved work per frame: a frame in page chrome is left out with its links', async () => {
  await reset({allowed: [A, B, C], settings: {contentOnly: true}});
  await ok({type: 'state.mutate', action: {type: 'collection.create', name: 'Per frame'}});
  const {report} = await ok({type: 'capture.run', tabIds: [1]});
  assert.deepEqual([saved(report.batchId), report.results[0].count, report.results[0].leftOut], [['Top', 'In B', 'In A, inside B'], 3, 2]);
  assert.deepEqual(session.linkMeteorLeftOut.links.map((item) => [item.anchorText, item.frameUrl]), [['Nav', PAGE_URL], ['In C', 'https://c.test/side']]);
  await ok({type: 'state.mutate', action: {type: 'settings.update', patch: {contentOnly: false, skipSaved: true}}});
  const again = (await ok({type: 'capture.run', tabIds: [1]})).report.results[0];
  assert.deepEqual([again.count, again.skipped], [2, 3], 'only the two links not saved yet');
});

test('when the frames don’t answer, the top document is read alone and its frames are reported', async () => {
  for (const frames of ['fail', 'hang']) {
    await reset({allowed: [A, B, C], frames});
    const read = await scanTab(1, {context: false}, {ms: 40});
    assert.deepEqual([read.links.map((item) => item.anchorText), read.frames], [['Top', 'Nav'], {read: 0, unread: 3, sites: [], left: [LEFT.b, LEFT.c, LEFT.sealed]}], frames);
    assert.equal(read.warnings.join(' '), '1 malformed link destination was excluded. 3 frames couldn’t be read: Chrome didn’t let Link Meteor into them.', 'with access to their sites there is nothing to ask for');
    assert.deepEqual([scripted.at(-1).target.allFrames, scripted.at(-1).func.name, scripted.at(-1).args], [undefined, 'scan', [{context: false}]]);
  }
  assert.equal(FRAMES_MS, 10000);
  // A caller that already holds the top document's answer hands it over: the frames' answers join it.
  await reset({allowed: [B]});
  const {result: gathered} = answer(0, {links: [link('Gathered while scrolling')], frames: PAGE()[0].result.frames});
  const handed = await scanTab(1, {context: true}, {top: gathered});
  assert.deepEqual([handed.links.map((item) => item.anchorText), handed.frames.read, handed.frames.sites], [['Gathered while scrolling', 'In B', 'In A, inside B'], 2, [A, C]]);
  page.frames = 'fail';
  assert.deepEqual((await scanTab(1, {context: true}, {top: gathered})).links.map((item) => item.anchorText), ['Gathered while scrolling'], 'also when the frames don’t answer');
  // No answer at all (the tab went away): an error, in plain words.
  await reset(); page.answers = [];
  await assert.rejects(scanTab(1, {}), /The page didn’t answer/);
});

test('Allow these sites (capture.frames) reads the page again and adds only the frames’ links, to the same capture', async () => {
  await reset();
  await ok({type: 'state.mutate', action: {type: 'collection.create', name: 'Allowed later'}});
  const home = active().id;
  const first = (await ok({type: 'capture.run', tabIds: [1]})).report;
  assert.deepEqual(first.results[0].frames.sites, [A, B, C]);
  // The person allowed b.test and c.test; the active collection changed meanwhile.
  await ok({type: 'state.mutate', action: {type: 'collection.create', name: 'Now active'}});
  page.allowed = new Set([B, C]); scripted.length = 0;
  const reply = await ok({type: 'capture.frames', tabId: 1, batchId: first.batchId});
  assert.deepEqual(reply.added, {count: 3, skipped: 0, leftOut: 0, frames: 3});
  assert.deepEqual(collection(home).links.slice(2).map((item) => [item.anchorText, item.batchId, item.frameUrl, item.sourceUrl]), [
    ['In B', first.batchId, 'https://b.test/frame', PAGE_URL], ['In A, inside B', first.batchId, 'https://a.test/inner', PAGE_URL], ['In C', first.batchId, 'https://c.test/side', PAGE_URL]],
    'the frames’ links only, with the frame inside one of them, in the capture’s batch and collection');
  assert.deepEqual(saved(first.batchId, collection(home)), ['Top', 'Nav', 'In B', 'In A, inside B', 'In C'], 'nothing twice');
  assert.equal(active().links.length, 0, 'not the collection that is active now');
  assert.deepEqual([reply.report.batchId, reply.report.collectionId, reply.report.capturedCount, reply.report.results[0].count, reply.report.results[0].frames], [first.batchId, home, 5, 5, {read: 3, unread: 1, sites: [A], left: [LEFT.sealed]}]);
  assert.equal(reply.report.results[0].warning, '3 malformed link destinations were excluded. 1 sandboxed frame of this site wasn’t read: the toolbar’s temporary access covers the page, not the frames it seals off. Allow this site (a.test) to include its links.');
  assert.deepEqual(session.linkMeteorCaptureReport.report, reply.report, 'the kept report shows the same to a view opened later');
  assert.deepEqual(scripted.map((spec) => [spec.files ? 'files' : spec.func.name, spec.target.allFrames === true, spec.injectImmediately === true]), [['files', true, true], ['scan', true, true]]);
  assert.equal(reply.state.collections.find((c) => c.id === home).links.length, 5);

  // Then the page's own site, for its sandboxed frame. The frame of that site inside b.test's
  // frame was read last time, and is not added again.
  page.allowed = new Set([A, B, C]);
  const still = await ok({type: 'capture.frames', tabId: 1, batchId: first.batchId});
  assert.deepEqual([still.added, saved(first.batchId, collection(home)), still.report.results[0].frames.sites], [{count: 0, skipped: 0, leftOut: 0, frames: 0}, ['Top', 'Nav', 'In B', 'In A, inside B', 'In C'], []], 'the frame still doesn’t answer: nothing is added, and there is nothing left to ask for');
  page.answers.push(SEALED());
  const sealed = await ok({type: 'capture.frames', tabId: 1, batchId: first.batchId});
  assert.deepEqual([sealed.added, saved(first.batchId, collection(home)), sealed.report.results[0].frames, sealed.report.capturedCount, sealed.report.results[0].warning],
    [{count: 1, skipped: 0, leftOut: 0, frames: 1}, ['Top', 'Nav', 'In B', 'In A, inside B', 'In C', 'Sandboxed'], {read: 4, unread: 0, sites: [], left: []}, 6, '3 malformed link destinations were excluded.']);
  // Nothing is left unread: there is nothing to add.
  await refused({type: 'capture.frames', tabId: 1, batchId: first.batchId}, /left no frames unread/);
  await ok({type: 'state.mutate', action: {type: 'collection.activate', id: home}});
});

test('capture.frames keeps content links only and Skip saved, and follows Include them', async () => {
  await reset({settings: {contentOnly: true}});
  await ok({type: 'state.mutate', action: {type: 'collection.create', name: 'Content only'}});
  const first = (await ok({type: 'capture.run', tabIds: [1]})).report;
  assert.deepEqual([saved(first.batchId), first.results[0].leftOut], [['Top'], 1]);
  page.allowed = new Set([B, C]);
  const reply = await ok({type: 'capture.frames', tabId: 1, batchId: first.batchId});
  assert.deepEqual([reply.added, reply.report.results[0].count, reply.report.results[0].leftOut], [{count: 2, skipped: 0, leftOut: 1, frames: 3}, 3, 2]);
  assert.deepEqual([session.linkMeteorLeftOut.batchId, session.linkMeteorLeftOut.total, session.linkMeteorLeftOut.links.map((item) => item.anchorText)], [first.batchId, 2, ['Nav', 'In C']], 'the sidebar frame’s link joins the navigation links kept for Include them');
  const included = await ok({type: 'capture.includeLeftOut', batchId: first.batchId});
  assert.deepEqual([included.count, saved(first.batchId)], [2, ['Top', 'In B', 'In A, inside B', 'Nav', 'In C']]);

  // After Include them, a later Allow adds a sidebar frame's links too.
  await reset({settings: {contentOnly: true}});
  await ok({type: 'state.mutate', action: {type: 'collection.create', name: 'Included first'}});
  const second = (await ok({type: 'capture.run', tabIds: [1]})).report;
  await ok({type: 'capture.includeLeftOut', batchId: second.batchId});
  page.allowed = new Set([C]);
  const later = await ok({type: 'capture.frames', tabId: 1, batchId: second.batchId});
  assert.deepEqual([later.added, saved(second.batchId), later.report.leftOutIncluded], [{count: 1, skipped: 0, leftOut: 0, frames: 1}, ['Top', 'Nav', 'In C'], 1]);

  // Skip saved: a frame's link the collection already holds is skipped and counted.
  await reset({settings: {skipSaved: true}});
  await ok({type: 'state.mutate', action: {type: 'collection.create', name: 'Skips'}});
  await ok({type: 'state.mutate', action: {type: 'links.append', collectionId: active().id, links: [{id: 'held', anchorText: 'Held', accessibleLabel: '', url: link('In B').url, originalHref: '', sourceUrl: '', sourceTitle: '', frameUrl: '', capturedAt: new Date().toISOString(), batchId: 'earlier', notes: '', tags: []}]}});
  const third = (await ok({type: 'capture.run', tabIds: [1]})).report;
  page.allowed = new Set([B, C]);
  const skipping = await ok({type: 'capture.frames', tabId: 1, batchId: third.batchId});
  assert.deepEqual([skipping.added, skipping.report.results[0].skipped, saved(third.batchId)], [{count: 2, skipped: 1, leftOut: 0, frames: 3}, 1, ['Top', 'Nav', 'In A, inside B', 'In C']]);
});

test('capture.frames refuses what it can’t do, in plain words', async () => {
  await reset();
  await ok({type: 'state.mutate', action: {type: 'collection.create', name: 'Refusals'}});
  const first = (await ok({type: 'capture.run', tabIds: [1]})).report;
  const good = {type: 'capture.frames', tabId: 1, batchId: first.batchId};
  await refused(good, /must be requested from the Link Meteor workbench/, {url: PAGE_URL, tab: tabs[0]});
  await refused({...good, tabId: 'one'}, /Choose a capture/);
  await refused({...good, batchId: ''}, /Choose a capture/);
  await refused({...good, batchId: 'another-capture'}, /no longer kept/);
  await refused({...good, tabId: 2}, /no longer kept/);
  tabs[0].url = 'https://a.test/elsewhere';
  await refused(good, /moved to another page/);
  tabs[0].url = PAGE_URL;
  page.answers = []; page.allowed = new Set([B]);
  await refused(good, /can no longer read that page, so its frames weren’t added \(The page didn’t answer/);
  const tab = tabs.shift();
  await refused(good, /That tab is closed/);
  tabs.unshift(tab);
  const home = active();
  page.answers = PAGE();
  await ok({type: 'state.mutate', action: {type: 'collection.create', name: 'Replacement'}});
  await ok({type: 'state.mutate', action: {type: 'collection.delete', id: home.id}});
  await refused(good, /went to no longer exists/);
  // A capture of several tabs: only the asked tab's result changes.
  await reset();
  tabs.push({id: 2, windowId: 1, url: 'https://a.test/second', title: 'Page A2'});
  const both = (await ok({type: 'capture.run', tabIds: [1, 2]})).report;
  page.allowed = new Set([B]);
  const one = await ok({type: 'capture.frames', tabId: 1, batchId: both.batchId});
  assert.deepEqual(one.report.results.map((item) => [item.tabId, item.count]), [[1, 4], [2, 2]]);
  assert.equal(one.report.capturedCount, 6);
  tabs.pop();
  // A page without frames from other sites has nothing to add.
  page.answers = [answer(0, {links: [link('Plain')]})];
  const plain = (await ok({type: 'capture.run', tabIds: [1]})).report;
  await refused({type: 'capture.frames', tabId: 1, batchId: plain.batchId}, /left no frames unread/);
});
