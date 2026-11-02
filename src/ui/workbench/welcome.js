// The first-run welcome card: one explained choice about all-sites access, shown once while
// welcomeSeen is false (a fresh install or an upgrade). Nothing is requested at install.
import { $ } from './helpers.js';
import { ui, request, action, mutate, show } from './state.js';
import { ALL_SITES, holdGesture } from './access.js';

// After an answer, the card stays to say what happened until Done.
let outcome = '';

export function renderWelcome() {
  if (!ui.state) return;
  const visible = !ui.state.settings.welcomeSeen || !!outcome;
  $('welcome').hidden = !visible;
  if (!visible) return;
  $('welcome-key').textContent = holdGesture(ui.state.settings);
  $('welcome-ask').hidden = !!outcome;
  $('welcome-outcome').hidden = !outcome;
  $('welcome-outcome-text').textContent = outcome;
}

async function markSeen() {
  if (!ui.state.settings.welcomeSeen) await mutate({ type: 'settings.update', patch: { welcomeSeen: true } });
}

function answered(message) {
  outcome = message;
  renderWelcome();
  $('welcome-done').focus();
}

function leave() {
  outcome = '';
  renderWelcome();
  $('capture').focus();
}

// Allow on all sites: Chrome's prompt comes first, in the same click, with nothing awaited before it.
async function allow() {
  let granted = false, problem = '';
  try { granted = await chrome.permissions.request({ origins: ALL_SITES }); }
  catch (error) { problem = error.message || String(error); }
  if (!granted) {
    await markSeen();
    answered(`${problem ? `Chrome could not ask for access to all sites (${problem}).` : 'Chrome’s request for access to all sites was declined, so nothing changed.'} Link Meteor still works site by site: Capture this page asks for one site at a time, and hold-key drag can be turned on for one site under Site access.`);
    return;
  }
  ui.state = await request({ type: 'hold.scope', scope: 'all' });
  await markSeen();
  answered(`Link Meteor now works on all sites. Hold ${holdGesture(ui.state.settings)} and drag across links on any webpage. You can add sites where it never runs under Site access.`);
}

export function bindWelcome() {
  $('welcome-allow').addEventListener('click', () => action(allow));
  $('welcome-later').addEventListener('click', () => action(async () => {
    await markSeen(); leave();
    show('You can allow Link Meteor on all sites any time under Site access.');
  }));
  $('welcome-close').addEventListener('click', () => action(async () => { await markSeen(); leave(); }));
  $('welcome-done').addEventListener('click', leave);
}
