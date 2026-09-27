// Site access: all-sites access, hold-key drag on this site, the "Never on these sites" list, the
// hold trigger and the region shortcut. Binds the welcome card too.
import { $, node, button, shortcutKeys, kbdGroup } from './helpers.js';
import { ui, request, action, mutate, show } from './state.js';
import { render, onRender } from './rendering.js';
import { renderLinks } from './review.js';
import { ALL_SITES, grants, effectiveScope, modifierName, holdGesture } from './access.js';
import { bindWelcome, renderWelcome } from './welcome.js';

let exceptionsKey = '';
// Set after the all-sites switch is turned off while Chrome still grants every site.
let offerRemoval = false;

// Reads Chrome's all-sites grant; the switch and welcome card show it together with the saved scope.
export async function refreshGrants() {
  try { grants.allSites = !!(await chrome.permissions?.contains?.({ origins: ALL_SITES })); } catch { grants.allSites = false; }
  try { grants.tabs = !!(await chrome.permissions?.contains?.({ permissions: ['tabs'] })); } catch { grants.tabs = false; }
  grants.known = true;
  $('scope-access-help').hidden = grants.tabs;
  if (!grants.allSites) offerRemoval = false;
  renderSite();
}

function renderExceptions(exceptions) {
  const key = exceptions.join('\n');
  $('exception-count').textContent = String(exceptions.length);
  $('hold-exceptions-empty').hidden = exceptions.length > 0;
  if (key === exceptionsKey) return;
  const list = $('hold-exceptions');
  const focusedOrigin = list.contains(document.activeElement) ? document.activeElement.dataset.origin : null;
  exceptionsKey = key;
  list.replaceChildren(...exceptions.map((origin) => {
    const item = node('li', 'exception-item');
    const remove = button('Remove', 'btn quiet small');
    remove.dataset.origin = origin;
    remove.setAttribute('aria-label', `Remove ${origin} from Never on these sites`);
    remove.addEventListener('click', () => action(() => setException(origin, false)));
    item.append(node('span', 'origin', origin), remove);
    return item;
  }));
  if (focusedOrigin !== null) (list.querySelector('button') || $('hold-exceptions-empty')).focus?.();
}

export function renderSite() {
  if (!ui.state) return;
  const settings = ui.state.settings;
  const scope = effectiveScope(settings, grants.allSites);
  const origin = ui.currentOrigin;
  const excepted = !!origin && settings.holdExceptions.includes(origin);

  // All sites: the saved scope and Chrome's grant together.
  $('all-sites').checked = scope === 'all';
  const note = $('all-sites-note');
  note.replaceChildren();
  if (settings.holdScope === 'all' && grants.known && !grants.allSites) {
    note.append('Chrome no longer lets Link Meteor read every site, so hold-key drag runs only on the sites you chose.');
  } else if (scope === 'sites' && grants.allSites && !offerRemoval) {
    const remove = button('Remove it', 'link-btn');
    remove.addEventListener('click', () => { offerRemoval = true; renderSite(); $('all-sites-remove-yes').focus(); });
    note.append('Chrome still lets Link Meteor read every site.', remove);
  }
  note.hidden = !note.childNodes.length;
  $('all-sites-remove').hidden = !(offerRemoval && grants.allSites && scope === 'sites');

  // This site: hold-drag on or off in 'sites'; an exception in 'all'.
  $('site-origin').textContent = origin || 'Current site unavailable';
  $('site-origin').title = origin ? '' : 'Open Link Meteor from an ordinary webpage to configure it.';
  $('site-hold-row').hidden = $('hold-help').hidden = scope === 'all';
  $('site-exception-row').hidden = $('site-exception-help').hidden = scope !== 'all';
  $('hold-enabled').checked = !!origin && settings.holdOrigins.includes(origin) && !excepted;
  $('hold-enabled').disabled = !origin;
  $('site-exception').checked = excepted;
  $('site-exception').disabled = !origin;

  // The hold trigger: any letter, or Command on macOS and Ctrl elsewhere.
  $('hold-trigger').querySelector('option[value="modifier"]').textContent = modifierName();
  $('hold-trigger').value = settings.holdTrigger;
  $('hold-letter-row').hidden = settings.holdTrigger !== 'letter';
  $('hold-key').value = ui.holdKeyDraft ?? settings.holdKey;
  $('hold-trigger-help').textContent = settings.holdTrigger === 'modifier'
    ? `Hold ${modifierName()} and drag at least a few pixels to select links. A plain ${modifierName()}-click still opens links as usual. Typing never starts a selection.`
    : `Hold ${holdGesture(settings)} and drag to select links. Typing in a text field never starts a selection.`;
  renderExceptions(settings.holdExceptions);
}

export function renderShortcut() {
  if (ui.shortcut === null) { $('shortcut-keys').replaceChildren(); $('arm-keys').replaceChildren(); return; }
  const keys = shortcutKeys(ui.shortcut);
  $('shortcut-keys').replaceChildren(...(keys.length ? kbdGroup(keys) : [node('span', 'help', 'Not set')]));
  $('arm-keys').replaceChildren(...kbdGroup(keys));
  $('arm').title = keys.length ? `Shortcut on any webpage: ${keys.join(' ')}` : 'No keyboard shortcut is set';
  $('shortcut-settings').firstChild.textContent = keys.length ? 'Change' : 'Set a shortcut';
}

// Hold-key drag on this site while the scope is 'sites'. Chrome asks for this site only, first.
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
  render(); show(enabled ? `Hold-key drag is on for ${origin}: hold ${holdGesture(ui.state.settings)} and drag across links.` : `Hold-key drag is off for ${origin}.`);
}

async function setException(origin, excepted) {
  ui.state = await request({ type: 'hold.exception', origin, excepted });
  render();
  show(excepted ? `Hold-key drag will never run on ${origin}. Pages already open there stop using it now.` : `${origin} is off the Never list.`);
}

// All sites on: Chrome's prompt first, in the same click. Off: back to the chosen sites, and an
// offer to remove Chrome's grant.
async function setAllSites(on) {
  if (on) {
    let granted = false;
    try { granted = await chrome.permissions.request({ origins: ALL_SITES }); }
    catch (error) { throw new Error(`Chrome could not ask for access to all sites: ${error.message}`); }
    await refreshGrants();
    if (!granted) throw new Error('Chrome’s request for access to all sites was declined, so nothing changed. Hold-key drag and capture keep working site by site.');
    ui.state = await request({ type: 'hold.scope', scope: 'all' });
    if (!ui.state.settings.welcomeSeen) await mutate({ type: 'settings.update', patch: { welcomeSeen: true } });
    render(); show(`Link Meteor now works on all sites. Hold ${holdGesture(ui.state.settings)} and drag across links on any webpage.`);
    return;
  }
  ui.state = await request({ type: 'hold.scope', scope: 'sites' });
  offerRemoval = grants.allSites;
  render();
  show('Hold-key drag now runs only on the sites you chose.');
  if (offerRemoval) $('all-sites-remove-yes').focus();
}

async function removeAllSites() {
  const removed = await chrome.permissions.remove({ origins: ALL_SITES });
  offerRemoval = false;
  await refreshGrants();
  show(removed ? 'Chrome no longer lets Link Meteor read every site. Sites you allowed one by one keep their access.' : 'Chrome kept Link Meteor’s access to all sites. You can change it in Chrome’s extension settings.');
  $('all-sites').focus();
}

async function saveHold(patch, message) {
  ui.state = await request({ type: 'hold.settings', ...patch });
  ui.holdKeyDraft = null;
  render(); show(message);
}

// Chrome keeps the region shortcut; read it to show it in the rail and on the Select button.
export function loadShortcut() {
  chrome.commands?.getAll?.().then((commands) => { ui.shortcut = commands.find((command) => command.name === 'select-region')?.shortcut || ''; renderShortcut(); if (ui.state) renderLinks(); }).catch(() => {});
}

// When a change did not happen, the switches show the saved state and Chrome's grant again.
function revertOnError(event, fn) {
  return action(async () => { try { await fn(event.target.checked); } catch (error) { renderSite(); throw error; } });
}

export function bindSettings() {
  bindWelcome();
  onRender(renderWelcome);
  refreshGrants();
  chrome.permissions?.onAdded?.addListener(refreshGrants);
  chrome.permissions?.onRemoved?.addListener(refreshGrants);
  $('shortcut-settings').addEventListener('click', () => action(async () => { await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); }));
  $('hold-key').addEventListener('input', () => { ui.holdKeyDraft = $('hold-key').value; });
  $('hold-enabled').addEventListener('change', (event) => revertOnError(event, configureHold));
  $('site-exception').addEventListener('change', (event) => revertOnError(event, (excepted) => {
    if (!ui.currentOrigin) throw new Error('Open an HTTP(S) page to choose where hold-key drag runs.');
    return setException(ui.currentOrigin, excepted);
  }));
  $('all-sites').addEventListener('change', (event) => revertOnError(event, setAllSites));
  $('all-sites-remove-yes').addEventListener('click', () => action(removeAllSites));
  $('all-sites-remove-no').addEventListener('click', () => { offerRemoval = false; renderSite(); $('all-sites').focus(); });
  $('hold-trigger').addEventListener('change', (event) => action(async () => {
    const trigger = event.target.value;
    try { await saveHold({ trigger }, trigger === 'modifier' ? `Hold ${modifierName()} and drag to select links. A plain ${modifierName()}-click still opens links.` : `Hold ${holdGesture(ui.state.settings)} and drag to select links.`); }
    catch (error) { renderSite(); throw error; }
  }));
  $('save-hold-key').addEventListener('click', () => action(async () => {
    const key = $('hold-key').value.trim().toLowerCase();
    if (!/^[a-z]$/.test(key)) throw new Error('Choose one letter for the hold key.');
    await saveHold({ key }, `Hold key saved: ${key.toUpperCase()}.`);
  }));
}
