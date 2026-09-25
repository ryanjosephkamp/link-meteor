// Browserless scope-race checks. This evaluates the current product runCapture
// function; Chrome messaging, permission prompts, storage-driven inventory,
// and DOM rendering are simulated. Loaded-extension behavior is tested elsewhere.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../src/ui/workbench.js', import.meta.url), 'utf8');
const start = source.indexOf('async function runCapture() {');
const end = source.indexOf('\nasync function download()', start);
assert.ok(start >= 0 && end > start, 'The product runCapture function must be available to this harness');
const runCaptureSource = source.slice(start, end);
// Formatting helpers used by runCapture's status messages, taken from the same product file.
const helperSource = ['function count(', 'function plural('].map((signature) => {
  const at = source.indexOf(signature);
  assert.ok(at >= 0, `${signature} must be available to this harness`);
  return source.slice(at, source.indexOf('\n', at));
}).join('\n');

const tab = (id, windowId, url) => ({ id, windowId, url });
function originOf(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : '';
  } catch { return ''; }
}

function simulate({ scope, initialTabs, afterPermissionTabs, selectedIds = [] }) {
  const messages = [];
  const permissionCalls = [];
  let visibleTabs = initialTabs;
  const captureButton = { disabled: false };
  const ui = {
    busy: false,
    scope,
    inventory: { tabs: initialTabs, currentWindowId: 7 },
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
    captureReport() {},
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
  return { runCapture, ui, captureButton, messages, permissionCalls };
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
