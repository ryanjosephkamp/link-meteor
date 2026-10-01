// A second toolbar click closes the side panel, and so does opening the full view (0.5.0), with
// Chrome's APIs simulated in Node:
// the background opens the panel first (inside the click) and then announces the click with its
// window; ui/workbench/panel.js closes only the side panel in that window, with Chrome's own close
// when it has one and window.close() otherwise. tests/access-browser.mjs presses Chrome's real
// toolbar action.
import test from 'node:test';
import assert from 'node:assert/strict';

const event = () => ({listeners: [], addListener(fn) { this.listeners.push(fn); }});
const calls = [];
const local = {}, session = {};
globalThis.chrome = {
  storage: {onChanged: event(), local: {async get(key) { return {[key]: local[key]}; }, async set(value) { Object.assign(local, value); }}, session: {async get(key) { return {[key]: session[key]}; }, async set(value) { Object.assign(session, value); }, async remove() {}}},
  runtime: {getURL: (path) => 'chrome-extension://meteor/' + path, sendMessage: async (message) => { calls.push(['message', message]); }, onMessage: event(), onInstalled: event(), onStartup: event()},
  permissions: {async contains() { return false; }, onAdded: event(), onRemoved: event()},
  scripting: {async executeScript() { return []; }, async getRegisteredContentScripts() { return []; }, async unregisterContentScripts() {}, async registerContentScripts() {}},
  tabs: {async query() { return []; }, async get() { throw Error('No tab'); }, async create(spec) { calls.push(['tab', spec.url]); }},
  windows: {async getAll() { return []; }},
  action: {onClicked: event()}, sidePanel: {open: async (spec) => { calls.push(['open', spec.windowId]); }}, commands: {onCommand: event()}, contextMenus: {onClicked: event(), removeAll: async () => {}, create: () => {}},
};
await import('../src/background.js');

test('a toolbar click opens the side panel in its window, inside the click, then announces the click', async () => {
  calls.length = 0;
  chrome.action.onClicked.listeners[0]({id: 1, windowId: 7, url: 'https://a.test/'});
  await new Promise((done) => setTimeout(done, 10));
  assert.deepEqual(calls, [['open', 7], ['message', {type: 'panel.toggle', windowId: 7}]]);
});

test('Open the full view in the toolbar’s menu opens it, then tells that window’s side panel to close', async () => {
  calls.length = 0;
  await chrome.contextMenus.onClicked.listeners[0]({menuItemId: 'meteor-full-view'}, {id: 1, windowId: 7, url: 'https://a.test/'});
  await new Promise((done) => setTimeout(done, 10));
  assert.deepEqual(calls, [['tab', 'chrome-extension://meteor/ui/workbench.html'], ['message', {type: 'panel.close', windowId: 7}]]);
});

test('only the side panel in that window closes itself: Chrome’s own close, else window.close()', async () => {
  const {closeOnToolbarClick, closeIfSidePanel} = await import('../src/ui/workbench/panel.js');
  const settle = () => new Promise((done) => setTimeout(done, 10));
  const page = ({tab, close}) => {
    const listeners = [], closed = [];
    globalThis.window = {close: () => closed.push('window.close')};
    globalThis.chrome = {
      tabs: {getCurrent: async () => tab},
      windows: {getCurrent: async () => ({id: 7})},
      runtime: {onMessage: {addListener: (fn) => listeners.push(fn)}},
      sidePanel: close === undefined ? {} : {close: async (spec) => { closed.push(['sidePanel.close', spec]); if (close === 'fails') throw new Error('No side panel'); }},
    };
    closeOnToolbarClick();
    return {send: (message) => listeners.forEach((fn) => fn(message)), closed, listeners};
  };
  let panel = page({tab: undefined, close: 'works'});
  await settle();
  panel.send({type: 'panel.toggle', windowId: 8});
  panel.send({type: 'state.changed'});
  assert.deepEqual(panel.closed, [], 'another window, or another message: nothing');
  panel.send({type: 'panel.toggle', windowId: 7});
  await settle();
  assert.deepEqual(panel.closed, [['sidePanel.close', {windowId: 7}]]);
  panel = page({tab: undefined, close: 'fails'});
  await settle();
  panel.send({type: 'panel.toggle', windowId: 7});
  await settle();
  assert.deepEqual(panel.closed, [['sidePanel.close', {windowId: 7}], 'window.close'], 'a failed close falls back');
  panel = page({tab: undefined, close: undefined});
  await settle();
  panel.send({type: 'panel.toggle', windowId: 7});
  await settle();
  assert.deepEqual(panel.closed, ['window.close'], 'an older Chrome without sidePanel.close');
  // The toolbar menu's Open the full view closes it too, and so does its own Full view button.
  panel = page({tab: undefined, close: 'works'});
  await settle();
  panel.send({type: 'panel.close', windowId: 9});
  assert.deepEqual(panel.closed, []);
  panel.send({type: 'panel.close', windowId: 7});
  await settle();
  assert.deepEqual(panel.closed, [['sidePanel.close', {windowId: 7}]]);
  await closeIfSidePanel();
  assert.equal(panel.closed.length, 2, 'the Full view button closes the panel it is in');
  panel = page({tab: {id: 3, windowId: 7}, close: 'works'});
  await settle();
  assert.equal(panel.listeners.length, 0, 'the full view in a tab doesn’t listen');
  await closeIfSidePanel();
  assert.deepEqual(panel.closed, [], 'and a tab never closes itself');
});
