// Backup and restore: one file with everything, a restore preview, merge or replace, and Undo.
// Backing up and previewing need no message: the page builds the file and both plans itself,
// and only a chosen restore, its Undo and the Undo status go to the background.
import { createBackup, readBackup, planRestore, BACKUP_LIMITS } from '../../core/model.js';
import { exportFileName } from '../../core/export.js';
import { $, node, count, plural, formatTime, hostOf } from './helpers.js';
import { ui, request, action, show, reloadState } from './state.js';
import { render, onRender, onEscape } from './rendering.js';
import { closeEditor } from './collections.js';

const UNDO_KEY = 'linkMeteorRestoreUndo';
const SETTING_NAMES = {
  holdKey: 'Hold key', holdTrigger: 'Hold trigger', holdScope: 'Where hold-drag runs', holdOrigins: 'Hold-drag sites',
  holdExceptions: 'Never on these sites', welcomeSeen: 'Welcome card', exportPrefix: 'Export name prefix',
  exportTimestamp: 'Date in export names', exportTimestampFormat: 'Export date format',
};

let pending = null;       // the chosen file: {text, backup, fileName}
let previewedState = null; // the state the shown preview was planned against
let previewRun = 0;
let chooseRun = 0;
let busy = false;
let statusTimer;

function totalLinks(collections) { return collections.reduce((n, item) => n + item.links.length, 0); }
// "2 collections and 6 links", or "1 empty collection" when there are no links.
function collectionsAndLinks(collections, links) {
  return links ? `${plural(collections, 'collection')} and ${plural(links, 'link')}` : plural(collections, 'empty collection');
}

// The reader's own message, as one sentence the person can act on.
function readerMessage(error) {
  const text = String(error?.message || error).trim();
  const sentence = /[.!?]$/.test(text) ? text : `${text}.`;
  return /^(This|A backup)\b/.test(sentence) ? sentence : `This backup can't be restored: ${sentence}`;
}

/* Backing up --------------------------------------------------------------------- */
export async function downloadBackup() {
  await reloadState();
  const backup = createBackup(ui.state, { extensionVersion: chrome.runtime.getManifest().version });
  const text = JSON.stringify(backup);
  const name = exportFileName({ collection: 'link-meteor-backup', extension: 'json', settings: { exportTimestamp: true, exportTimestampFormat: 'datetime' } });
  const href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = href; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60000);
  const contents = `${plural(backup.state.collections.length, 'collection')}, ${plural(totalLinks(backup.state.collections), 'link')} and your settings`;
  if (text.length > BACKUP_LIMITS.bytes) {
    show(`Downloaded ${name} with ${contents}. It is larger than ${BACKUP_LIMITS.bytes / 1024 / 1024} MB, the most Link Meteor can restore at once, so keep it as a copy; to restore, remove links you no longer need and back up again.`, 'error');
  } else {
    show(`Downloaded ${name} with ${contents}.`);
  }
}

/* Choosing a file and the preview ------------------------------------------------ */
async function chooseFile() {
  const input = $('backup-file');
  const file = input.files?.[0];
  if (!file) return;
  closePreview({ keepFile: true });
  if (!ui.state) { input.value = ''; throw new Error('Link Meteor is still loading your collections. Choose the file again in a moment.'); }
  const run = ++chooseRun;
  try {
    // A file this large cannot hold a backup the reader accepts, so it is not read into memory.
    if (file.size > BACKUP_LIMITS.bytes * 4) throw new Error(`This backup is larger than ${BACKUP_LIMITS.bytes / 1024 / 1024} MB, the most Link Meteor can restore at once.`);
    const text = await file.text();
    if (run !== chooseRun) return;
    pending = { text, backup: readBackup(text), fileName: file.name };
    await renderPreview();
    if (run !== chooseRun || !pending) return;
    $('restore-preview').hidden = false;
    $('restore-title').focus();
  } catch (error) {
    if (run !== chooseRun) return;
    closePreview();
    throw new Error(`${readerMessage(error)} Nothing was changed.`);
  }
}

export function closePreview({ keepFile = false } = {}) {
  pending = null; previewedState = null; previewRun++;
  $('restore-preview').hidden = true;
  if (!keepFile) $('backup-file').value = '';
}

// Hold-drag sites in a plan that Chrome does not grant now. After a restore, the background
// turns hold-drag off on those sites until access is allowed again.
async function missingAccess(plans) {
  const origins = [...new Set(plans.flatMap((plan) => plan.state.settings.holdOrigins))];
  const missing = new Set();
  for (const origin of origins) {
    if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) missing.add(origin);
  }
  const allSites = plans.some((plan) => plan.state.settings.holdScope === 'all')
    && !(await chrome.permissions.contains({ origins: ['http://*/*', 'https://*/*'] }));
  return { missing, allSites };
}

function settingValue(key, value) {
  switch (key) {
    case 'holdKey': return String(value).toUpperCase();
    case 'holdTrigger': return value === 'modifier' ? 'Command or Ctrl' : 'a letter';
    case 'holdScope': return value === 'all' ? 'all sites' : 'chosen sites';
    case 'welcomeSeen': return value ? 'answered' : 'not answered';
    case 'exportPrefix': return value || 'none';
    case 'exportTimestamp': return value ? 'on' : 'off';
    case 'exportTimestampFormat': return value === 'date' ? 'date only' : 'date and time';
    default: return String(value);
  }
}

function hostList(origins) {
  const hosts = origins.map(hostOf);
  return hosts.length > 3 ? `${hosts.slice(0, 3).join(', ')} and ${count(hosts.length - 3)} more` : hosts.join(', ');
}

function describeSetting(key, before, after) {
  const name = SETTING_NAMES[key] || key;
  if (key === 'holdOrigins' || key === 'holdExceptions') {
    const added = after[key].filter((origin) => !before[key].includes(origin));
    const removed = before[key].filter((origin) => !after[key].includes(origin));
    const parts = [added.length && `adds ${hostList(added)}`, removed.length && `removes ${hostList(removed)}`].filter(Boolean);
    return `${name}: ${parts.join('; ') || 'reordered'}`;
  }
  return `${name}: ${settingValue(key, before[key])} → ${settingValue(key, after[key])}`;
}

function modeBlock(title, note, lines, plan, access, before) {
  const block = node('div', 'restore-mode');
  const heading = node('p', 'restore-mode-title', title);
  heading.append(node('span', 'restore-mode-note', note));
  const list = node('ul');
  for (const line of lines) list.append(node('li', '', line));
  const settings = node('li');
  const changed = plan.summary.settingsChanged;
  if (!changed.length) settings.textContent = 'Settings stay as they are';
  else {
    settings.append('Settings that change:');
    const detail = node('ul', 'restore-settings');
    for (const key of changed) detail.append(node('li', '', describeSetting(key, before, plan.state.settings)));
    settings.append(detail);
  }
  list.append(settings);
  const needs = plan.state.settings.holdOrigins.filter((origin) => access.missing.has(origin));
  if (needs.length) list.append(node('li', 'restore-access', `Hold-drag needs Chrome's access again on ${hostList(needs)}. Until you allow it, hold-drag stays off there.`));
  if (plan.state.settings.holdScope === 'all' && access.allSites) list.append(node('li', 'restore-access', 'Hold-drag on all sites needs Chrome\'s access again. Until you allow it, hold-drag runs only on chosen sites.'));
  block.append(heading, list);
  return block;
}

async function renderPreview() {
  if (!pending || !ui.state) return;
  const run = ++previewRun;
  const state = ui.state;
  const merge = planRestore(state, pending.backup, 'merge');
  const replace = planRestore(state, pending.backup, 'replace');
  const access = await missingAccess([merge, replace]);
  if (run !== previewRun || !pending) return;
  previewedState = state;
  const { summary } = merge;
  const source = $('restore-source');
  source.replaceChildren(
    node('span', 'restore-file', pending.fileName),
    node('span', '', `Made ${formatTime(summary.backupCreatedAt)} with ${summary.backupExtensionVersion ? `Link Meteor ${summary.backupExtensionVersion}` : 'an unknown Link Meteor version'}`),
    node('span', '', `${plural(summary.collectionsInBackup, 'collection')} · ${plural(summary.linksInBackup, 'link')}`),
  );
  const m = merge.summary, r = replace.summary;
  const mergeLines = [
    m.linksAdded ? `Adds ${plural(m.linksAdded, 'link')}` : 'Adds no links: every one is already here',
    `${plural(m.collectionsAdded, 'new collection')}, ${count(m.collectionsMatched)} joined with ${m.collectionsMatched === 1 ? 'a collection' : 'collections'} here`,
  ];
  if (m.linksSkipped) mergeLines.push(`Skips ${plural(m.linksSkipped, 'link')} already here`);
  const replaceLines = [
    `Removes ${collectionsAndLinks(r.collectionsRemoved, r.linksRemoved)} here`,
    `Restores ${plural(r.collectionsAdded, 'collection')} and ${plural(r.linksAdded, 'link')} from the backup`,
  ];
  $('restore-modes').replaceChildren(
    modeBlock('Merge', 'keeps everything here', mergeLines, merge, access, state.settings),
    modeBlock('Replace', 'the backup takes the place of everything here', replaceLines, replace, access, state.settings),
  );
}

/* Restoring and Undo --------------------------------------------------------------- */
function resetView(state) {
  ui.state = state;
  ui.page = 0; ui.batchFilter = '';
  ui.selectedIds.clear(); ui.openDetails.clear(); ui.detailLimits.clear();
  closeEditor();
  render();
}

function settingsNote(summary) {
  return summary.settingsChanged.length ? ` Changed settings: ${summary.settingsChanged.map((key) => (SETTING_NAMES[key] || key).toLowerCase()).join(', ')}.` : '';
}

function restoredMessage(summary) {
  if (summary.mode === 'replace') {
    return `Replaced everything with the backup: ${plural(summary.collectionsAdded, 'collection')} and ${plural(summary.linksAdded, 'link')}. Removed ${collectionsAndLinks(summary.collectionsRemoved, summary.linksRemoved)} that ${summary.collectionsRemoved === 1 && !summary.linksRemoved ? 'was' : 'were'} here.${settingsNote(summary)}`;
  }
  const added = summary.linksAdded ? `added ${plural(summary.linksAdded, 'link')}${summary.collectionsAdded ? ` and ${plural(summary.collectionsAdded, 'new collection')}` : ''}` : 'added nothing new';
  return `Merged the backup: ${added}${summary.linksSkipped ? `; skipped ${plural(summary.linksSkipped, 'link')} already here` : ''}.${settingsNote(summary)}`;
}

function setBusy(value, control = null) {
  busy = value;
  for (const id of ['backup-download', 'restore-merge', 'restore-replace', 'restore-undo', 'restore-discard']) $(id).disabled = value;
  if (control) control.setAttribute('aria-busy', String(value));
}

async function restore(mode, control) {
  if (!pending || busy) return;
  setBusy(true, control);
  try {
    const result = await request({ type: 'backup.restore', backup: pending.text, mode });
    closePreview();
    resetView(result.state);
    show(restoredMessage(result.summary), 'notice', { actionLabel: 'Undo', onAction: undoRestore });
    await refreshStatus();
  } finally { setBusy(false, control); }
  $('restore-undo').focus();
}

export async function undoRestore() {
  if (busy) return;
  setBusy(true, $('restore-undo'));
  try {
    const result = await request({ type: 'backup.undo' });
    resetView(result.state);
    show('Restore undone. Your collections and settings are as they were before it.');
  } finally {
    setBusy(false, $('restore-undo'));
    await refreshStatus().catch(() => {});
  }
  $('backup-download').focus();
}

async function discardUndo() {
  if (busy) return;
  await request({ type: 'backup.discardUndo' });
  await refreshStatus();
  show('Discarded Undo for the last restore. The restored collections and settings stay.');
  $('backup-download').focus();
}

// The last restore's Undo, read from the background so it survives closing the page.
export async function refreshStatus() {
  const { undo } = await request({ type: 'backup.status' });
  $('restore-status').hidden = !undo;
  if (!undo) return;
  const { summary } = undo;
  const what = summary.mode === 'replace'
    ? `Replaced everything with a backup of ${plural(summary.linksAdded, 'link')}`
    : `Merged a backup, adding ${plural(summary.linksAdded, 'link')}`;
  $('restore-status-text').textContent = `${what}, ${formatTime(undo.createdAt)}.`;
}

function scheduleStatus() { clearTimeout(statusTimer); statusTimer = setTimeout(() => action(refreshStatus), 120); }

export function bindBackup() {
  $('backup-download').addEventListener('click', () => action(downloadBackup));
  $('backup-file').addEventListener('change', () => action(chooseFile));
  $('restore-merge').addEventListener('click', () => action(() => restore('merge', $('restore-merge'))));
  $('restore-replace').addEventListener('click', () => action(() => restore('replace', $('restore-replace'))));
  $('restore-cancel').addEventListener('click', () => { closePreview(); $('backup-file').focus(); show('Restore canceled. Nothing was changed.'); });
  $('restore-undo').addEventListener('click', () => action(undoRestore));
  $('restore-discard').addEventListener('click', () => action(discardUndo));
  onEscape(() => {
    if ($('restore-preview').hidden) return false;
    closePreview(); $('backup-file').focus();
    return true;
  });
  // A preview stays true to the saved state: when it changes, both plans are made again.
  onRender(() => { if (pending && !$('restore-preview').hidden && ui.state !== previewedState) action(renderPreview); });
  chrome.storage?.onChanged?.addListener((changes, area) => { if (area === 'local' && UNDO_KEY in changes) scheduleStatus(); });
  scheduleStatus();
}
