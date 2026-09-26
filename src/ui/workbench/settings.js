// Site settings: the hold key, hold-key drag on this site and the region shortcut.
import { $, node, shortcutKeys, kbdGroup } from './helpers.js';
import { ui, request, action, mutate, show } from './state.js';
import { render } from './rendering.js';
import { renderLinks } from './review.js';

export function renderSite() {
  if (!ui.state) return;
  $('hold-key').value = ui.holdKeyDraft ?? ui.state.settings.holdKey;
  $('hold-enabled').checked = !!ui.currentOrigin && ui.state.settings.holdOrigins.includes(ui.currentOrigin);
  $('hold-enabled').disabled = !ui.currentOrigin;
  $('site-origin').textContent = ui.currentOrigin || 'Current site unavailable';
  $('site-origin').title = ui.currentOrigin ? '' : 'Open Link Meteor from an ordinary webpage to configure it.';
}

export function renderShortcut() {
  if (ui.shortcut === null) { $('shortcut-keys').replaceChildren(); $('arm-keys').replaceChildren(); return; }
  const keys = shortcutKeys(ui.shortcut);
  $('shortcut-keys').replaceChildren(...(keys.length ? kbdGroup(keys) : [node('span', 'help', 'Not set')]));
  $('arm-keys').replaceChildren(...kbdGroup(keys));
  $('arm').title = keys.length ? `Shortcut on any webpage: ${keys.join(' ')}` : 'No keyboard shortcut is set';
  $('shortcut-settings').firstChild.textContent = keys.length ? 'Change' : 'Set a shortcut';
}

export async function configureHold(enabled) {
  const origin = ui.currentOrigin;
  if (!origin) throw new Error('Open an HTTP(S) page to configure hold-key selection.');
  const key = $('hold-key').value.trim().toLowerCase();
  if (!/^[a-z]$/.test(key)) throw new Error('Choose one letter for the hold key.');
  if (enabled) {
    const allowed = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!allowed) throw new Error(`Site access for ${origin} was declined, so hold-key drag stays off there.`);
  }
  ui.state = await request({ type: 'hold.configure', origin, enabled, key });
  ui.holdKeyDraft = null;
  render(); show(enabled ? `Hold-key drag is on for ${origin}: hold ${key.toUpperCase()} and drag across links.` : `Hold-key drag is off for ${origin}.`);
}

// Chrome keeps the region shortcut; read it to show it in the rail and on the Select button.
export function loadShortcut() {
  chrome.commands?.getAll?.().then((commands) => { ui.shortcut = commands.find((command) => command.name === 'select-region')?.shortcut || ''; renderShortcut(); if (ui.state) renderLinks(); }).catch(() => {});
}

export function bindSettings() {
  $('shortcut-settings').addEventListener('click', () => action(async () => { await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); }));
  $('hold-key').addEventListener('input', () => { ui.holdKeyDraft = $('hold-key').value; });
  $('hold-enabled').addEventListener('change', (event) => action(async () => { try { await configureHold(event.target.checked); } catch (error) { event.target.checked = !event.target.checked; throw error; } }));
  $('save-hold-key').addEventListener('click', () => action(async () => { const key = $('hold-key').value.trim().toLowerCase(); if (!/^[a-z]$/.test(key)) throw new Error('Choose one letter for the hold key.'); if (ui.currentOrigin && ui.state.settings.holdOrigins.includes(ui.currentOrigin)) { await configureHold(true); } else { await mutate({ type: 'settings.update', patch: { holdKey: key } }); show(`Hold key saved: ${key.toUpperCase()}.`); } ui.holdKeyDraft = null; renderSite(); }));
}
