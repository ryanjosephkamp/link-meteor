// The workbench's access and opening rules (src/ui/workbench/access.js), checked directly in Node.
// They decide the opening tiers and their wording, the hold modifier's name, and whether
// Capture this page asks Chrome for the tab's site in the same click.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openTier, openQuestion, openOutcome, modifierName, holdGesture, effectiveScope, pageAccessPlan, isMac, ALL_SITES } from '../src/ui/workbench/access.js';

test('opening tiers: 1 to 20 at once, confirm to 100, stronger to 500, refuse above', () => {
  assert.deepEqual([0, 1, 20, 21, 100, 101, 500, 501].map(openTier), ['none', 'direct', 'direct', 'confirm', 'confirm', 'strong', 'strong', 'refuse']);
  assert.equal(openQuestion(45), 'Open 45 web links in new tabs?');
  assert.equal(openQuestion(45, 2), 'Open 45 web links in new tabs? 2 non-web rows will be skipped.');
  assert.match(openQuestion(250), /^Open 250 web links\? That is a lot of tabs at once, and Chrome may slow down while they load\./);
  assert.match(openQuestion(1500), /1,500/);
});

test('opening outcomes say what happened, including cancel and unnamed groups', () => {
  assert.equal(openOutcome({opened: 5, failed: 0}, {total: 5}), 'Opened 5 links in new tabs.');
  assert.equal(openOutcome({opened: 1, failed: 0}, {total: 1, mode: 'window'}), 'Opened 1 link in a new window.');
  assert.equal(openOutcome({opened: 30, failed: 0, groupTitled: true}, {total: 30, mode: 'group', groupTitle: 'Sources'}), 'Opened 30 links in a tab group named “Sources”.');
  assert.match(openOutcome({opened: 30, failed: 0, groupTitled: false}, {total: 30, mode: 'group'}), /unnamed tab group.*tab-group access/);
  assert.equal(openOutcome({opened: 20, failed: 1, cancelled: true}, {total: 150, skipped: 2}), 'Stopped after opening 20 of 150 links. The tabs already open stay open. 1 could not open. 2 non-web rows were skipped.');
});

test('the hold modifier is Command on macOS and Ctrl elsewhere; never Option, Alt or Shift', () => {
  assert.equal(isMac('MacIntel'), true);
  assert.equal(isMac('macOS'), true);
  assert.equal(isMac('Win32'), false);
  assert.equal(modifierName(true), 'Command');
  assert.equal(modifierName(false), 'Ctrl');
  assert.equal(holdGesture({holdTrigger: 'letter', holdKey: 'q'}, true), 'Q');
  assert.equal(holdGesture({holdTrigger: 'modifier', holdKey: 'q'}, false), 'Ctrl');
  assert.ok(!/alt|option|shift/i.test(modifierName(true) + modifierName(false)));
});

test("all-sites scope counts only while Chrome grants it", () => {
  assert.deepEqual(ALL_SITES, ['http://*/*', 'https://*/*']);
  assert.equal(effectiveScope({holdScope: 'all'}, true), 'all');
  assert.equal(effectiveScope({holdScope: 'all'}, false), 'sites');
  assert.equal(effectiveScope({holdScope: 'sites'}, true), 'sites');
});

test('Capture this page asks for the site only when it cannot already be read', () => {
  const target = {id: 7, url: 'https://en.wikipedia.org/wiki/Meteor'};
  const origin = 'https://en.wikipedia.org';
  // A newly visited site with no grant: ask in the same click.
  assert.deepEqual(pageAccessPlan({target, origin, probe: null, allSites: false, originGranted: false}), {ask: true, reason: 'unknown'});
  // The latest check says the tab cannot be read now: ask.
  assert.deepEqual(pageAccessPlan({target, origin, probe: {tabId: 7, url: target.url, ok: false}, allSites: false, originGranted: false}), {ask: true, reason: 'blocked'});
  // A toolbar click (temporary access) or a grant makes the tab readable: no prompt.
  assert.deepEqual(pageAccessPlan({target, origin, probe: {tabId: 7, url: target.url, ok: true}, allSites: false, originGranted: false}), {ask: false, reason: 'readable'});
  assert.deepEqual(pageAccessPlan({target, origin, probe: null, allSites: true, originGranted: false}), {ask: false, reason: 'granted'});
  assert.deepEqual(pageAccessPlan({target, origin, probe: null, allSites: false, originGranted: true}), {ask: false, reason: 'granted'});
  // A check of an older page in the same tab does not count.
  assert.equal(pageAccessPlan({target, origin, probe: {tabId: 7, url: 'https://other.test/', ok: true}, allSites: false, originGranted: false}).ask, true);
  // Chrome hides the address: there is no site to ask for, so the capture reports why instead.
  assert.deepEqual(pageAccessPlan({target: {id: 7, url: ''}, origin: '', probe: null, allSites: false, originGranted: false}), {ask: false, reason: 'hidden'});
  assert.deepEqual(pageAccessPlan({target: {id: 7, url: 'chrome://settings'}, origin: '', probe: null}), {ask: false, reason: 'unsupported'});
  assert.deepEqual(pageAccessPlan({target: null, origin: ''}), {ask: false, reason: 'no-target'});
  // Without the tabs permission a visible address means the tab can be read (a toolbar click), even
  // when the last check predates that click.
  assert.deepEqual(pageAccessPlan({target, origin, probe: {tabId: 7, url: target.url, ok: false}, allSites: false, originGranted: false, tabsGranted: false}), {ask: false, reason: 'readable'});
});
