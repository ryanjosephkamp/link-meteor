// Browserless scope-race checks. This evaluates the current product runCapture
// function; Chrome messaging, permission prompts, storage-driven inventory,
// and DOM rendering are simulated. Loaded-extension behavior is tested elsewhere.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../src/ui/workbench/capture.js', import.meta.url), 'utf8');
const start = source.indexOf('async function runCapture() {');
const end = source.indexOf('\n}\n', start) + 2;
assert.ok(start >= 0 && end > start, 'The product runCapture function must be available to this harness');
const runCaptureSource = source.slice(start, end);
// Formatting helpers used by runCapture's status messages, taken from the product's helpers module.
const helpers = readFileSync(new URL('../src/ui/workbench/helpers.js', import.meta.url), 'utf8');
const helperSource = ['function count(', 'function plural('].map((signature) => {
  const at = helpers.indexOf(signature);
  assert.ok(at >= 0, `${signature} must be available to this harness`);
  return helpers.slice(at, helpers.indexOf('\n', at));
}).join('\n');

const tab = (id, windowId, url) => ({ id, windowId, url });
function originOf(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : '';
  } catch { return ''; }
}

function simulate({ scope, initialTabs, afterPermissionTabs, selectedIds = [], targetTabId, pagePlan = { ask: false }, pdf = '' }) {
  const messages = [];
  const permissionCalls = [];
  const reports = [];
  const pdfCalls = [];
  let visibleTabs = initialTabs;
  const captureButton = { disabled: false };
  const ui = {
    busy: false,
    scope,
    inventory: { tabs: initialTabs, currentWindowId: 7, targetTabId },
    selectedTabs: new Set(selectedIds),
    originAccess: new Map(),
    state: null,
  };
  const dependencies = {
    ui,
    inventoryTimer: null,
    clearTimeout,
    originOf,
    show() {},
    render() {},
    captureReport(report, options) { reports.push({ report, options }); },
    currentPagePlan: () => pagePlan,
    // PDFs (0.6.0, pdf.js): `pdf` is 'local' for a PDF opened from the computer, 'web' for one on the web.
    targetTab: () => initialTabs.find((item) => item.id === targetTabId),
    chooseLocalPdf: () => { if (pdf === 'local') pdfCalls.push('choose'); return pdf === 'local'; },
    capturePdf: async (target, options) => { if (pdf === 'web') pdfCalls.push({ tabId: target?.id, ...options }); return pdf === 'web'; },
    // Scroll to the end first and Follow Next (0.6.0) are off here: the plain capture goes on.
    runFurther: async () => false,
    renderCaptureButton() {},
    $: () => captureButton,
    chrome: {
      permissions: {
        request: async (request) => {
          permissionCalls.push(request);
          // Tabs may close, open, or navigate while Chrome asks for access.
          visibleTabs = afterPermissionTabs;
          return true;
        },
      },
    },
    loadInventory: async () => ({ tabs: visibleTabs, currentWindowId: 7 }),
    request: async (message) => {
      messages.push(message);
      return { state: {}, report: { capturedCount: 0, results: [] } };
    },
  };
  const runCapture = runInNewContext(`${helperSource}\n${runCaptureSource}\nrunCapture`, dependencies);
  return { runCapture, ui, captureButton, messages, permissionCalls, reports, pdfCalls };
}

test('closed selected tab keeps its original ID for background error reporting', async () => {
  const harness = simulate({
    scope: 'selected',
    initialTabs: [tab(1, 7, 'https://a.test/one'), tab(2, 7, 'https://b.test/two')],
    afterPermissionTabs: [tab(1, 7, 'https://a.test/one')],
    selectedIds: [1, 2],
  });
  await harness.runCapture();
  assert.deepEqual(Array.from(harness.messages.find((m) => m.type === 'capture.run').tabIds), [1, 2]);
  assert.deepEqual(Array.from(harness.permissionCalls[0].origins), ['https://a.test/*', 'https://b.test/*']);
  assert.equal(harness.ui.busy, false);
  assert.equal(harness.captureButton.disabled, false);
});

test('new tab in the current window is excluded from this capture', async () => {
  const harness = simulate({
    scope: 'window',
    initialTabs: [tab(1, 7, 'https://a.test/one'), tab(2, 8, 'https://b.test/two')],
    afterPermissionTabs: [tab(1, 7, 'https://a.test/one'), tab(2, 8, 'https://b.test/two'), tab(3, 7, 'https://c.test/three')],
  });
  await harness.runCapture();
  assert.deepEqual(Array.from(harness.messages.find((m) => m.type === 'capture.run').tabIds), [1]);
});

test('new tab in any window is excluded from all-windows capture', async () => {
  const harness = simulate({
    scope: 'all',
    initialTabs: [tab(1, 7, 'https://a.test/one'), tab(2, 8, 'https://b.test/two')],
    afterPermissionTabs: [tab(1, 7, 'https://a.test/one'), tab(2, 8, 'https://b.test/two'), tab(3, 9, 'https://c.test/three')],
  });
  await harness.runCapture();
  assert.deepEqual(Array.from(harness.messages.find((m) => m.type === 'capture.run').tabIds), [1, 2]);
});

test('surviving tab that changes origin stops before capture.run', async () => {
  const harness = simulate({
    scope: 'selected',
    initialTabs: [tab(1, 7, 'https://a.test/one')],
    afterPermissionTabs: [tab(1, 7, 'https://other.test/two')],
    selectedIds: [1],
  });
  await assert.rejects(harness.runCapture(), /changed origin/);
  assert.equal(harness.messages.some((m) => m.type === 'capture.run'), false);
  assert.equal(harness.ui.busy, false);
  assert.equal(harness.captureButton.disabled, false);
});

test('a current page whose address Chrome hides offers all sites instead of asking for one site', async () => {
  const harness = simulate({
    scope: 'current',
    initialTabs: [tab(7, 7, '')],
    afterPermissionTabs: [tab(7, 7, '')],
    targetTabId: 7,
    pagePlan: { ask: false, reason: 'hidden' },
  });
  await harness.runCapture();
  assert.deepEqual(harness.permissionCalls, [], 'nothing is requested before the person chooses');
  assert.deepEqual(Array.from(harness.messages.find((m) => m.type === 'capture.run').tabIds), []);
  const { options } = harness.reports[0];
  assert.deepEqual([...options.offerAllSites], [7]);
  assert.match(options.reasons.get(7), /Allow Link Meteor on all sites/);
});

test('a PDF in the current tab is read as a PDF, with the site asked for in the same click; the page capture never runs', async () => {
  const web = simulate({ scope: 'current', initialTabs: [tab(7, 7, 'https://papers.test/a.pdf')], afterPermissionTabs: [tab(7, 7, 'https://papers.test/a.pdf')], targetTabId: 7,
    pagePlan: { ask: true, origin: 'https://papers.test', tabId: 7 }, pdf: 'web' });
  await web.runCapture();
  assert.deepEqual(Array.from(web.permissionCalls[0].origins), ['https://papers.test/*'], 'the same click asks for the site');
  assert.deepEqual(JSON.parse(JSON.stringify(web.pdfCalls)), [{ tabId: 7, declined: false, origin: 'https://papers.test' }], 'the site was allowed');
  assert.equal(web.messages.some((m) => m.type === 'capture.run'), false);
  assert.deepEqual([web.ui.busy, web.captureButton.disabled], [false, false]);
  // A PDF opened from the computer: the click opens the file chooser at once, and asks for nothing.
  const local = simulate({ scope: 'current', initialTabs: [tab(8, 7, 'file:///Users/me/paper.pdf')], afterPermissionTabs: [], targetTabId: 8, pdf: 'local' });
  await local.runCapture();
  assert.deepEqual([JSON.parse(JSON.stringify(local.pdfCalls)), local.permissionCalls, local.messages], [['choose'], [], []]);
  // In a capture of several tabs, a PDF is left to the background, which reports it.
  const several = simulate({ scope: 'window', initialTabs: [tab(1, 7, 'https://a.test/one'), tab(2, 7, 'https://papers.test/a.pdf')], afterPermissionTabs: [tab(1, 7, 'https://a.test/one'), tab(2, 7, 'https://papers.test/a.pdf')], targetTabId: 2, pdf: 'web' });
  await several.runCapture();
  assert.deepEqual([several.pdfCalls, Array.from(several.messages.find((m) => m.type === 'capture.run').tabIds)], [[], [1, 2]]);
});
