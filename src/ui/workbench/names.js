// Export file names: the File name field, the "Saves as" line and the name pattern settings.
import { exportFileName, fileNamePart, FORMAT_EXTENSIONS } from '../../core/export.js';
import { $ } from './helpers.js';
import { ui, action, mutate, show, currentCollection } from './state.js';

const MAX_PREFIX = 40;
const REFRESH_MS = 10000;
let shownCollectionId = '';
let shownFormat = '';

function settings() { return ui.state?.settings || {}; }
function extension() { return FORMAT_EXTENSIONS[$('format').value] || 'txt'; }

// The exact name a download made at this time would use.
export function exportName(date = new Date(), override = $('export-name').value) {
  return exportFileName({ collection: currentCollection()?.name || '', extension: extension(), settings: settings(), date, override });
}

// Shows the name a download uses. After a download, pass its own time so the line names that file.
export function renderSavesAs(date = new Date()) {
  if (!currentCollection()) return;
  const field = $('export-name');
  const placeholder = exportName(date, '');
  const line = `Saves as ${exportName(date)}`;
  if (field.placeholder !== placeholder) field.placeholder = placeholder;
  if ($('download-name').textContent !== line) $('download-name').textContent = line;
}

function renderPattern() {
  const { exportPrefix = '', exportTimestamp = true, exportTimestampFormat = 'datetime' } = settings();
  const parts = [exportPrefix, 'collection', ...(exportTimestamp ? ['YYYY-MM-DD', ...(exportTimestampFormat === 'date' ? [] : ['HHmm'])] : [])];
  $('name-pattern').textContent = `Pattern: ${parts.filter(Boolean).join('_')}.${extension()}`;
}

// Settings fields follow the saved state, except the one being edited.
function renderSettingsFields() {
  const { exportPrefix = '', exportTimestamp = true, exportTimestampFormat = 'datetime' } = settings();
  const focused = document.activeElement;
  if (focused !== $('name-prefix')) $('name-prefix').value = exportPrefix;
  if (focused !== $('name-timestamp')) $('name-timestamp').checked = exportTimestamp;
  if (focused !== $('name-timestamp-format')) $('name-timestamp-format').value = exportTimestampFormat;
  $('name-timestamp-format').disabled = !$('name-timestamp').checked;
}

export function renderNames() {
  const collection = currentCollection();
  if (!collection) return;
  // A typed name belongs to one collection's export; switching collections returns to the pattern.
  if (shownCollectionId && shownCollectionId !== collection.id && document.activeElement !== $('export-name')) $('export-name').value = '';
  shownCollectionId = collection.id;
  shownFormat = $('format').value;
  renderSettingsFields();
  renderPattern();
  renderSavesAs();
}

// Changing the format keeps a typed name but moves its typed extension to the new format.
export function followFormatChange() {
  const before = FORMAT_EXTENSIONS[shownFormat];
  const after = extension();
  const field = $('export-name');
  if (before && before !== after && new RegExp(`\\.${before}$`, 'i').test(field.value.trim())) {
    field.value = `${field.value.trim().slice(0, -before.length)}${after}`;
  }
  shownFormat = $('format').value;
}

async function savePrefix() {
  const input = $('name-prefix');
  const typed = input.value;
  const safe = fileNamePart(typed, MAX_PREFIX);
  const saved = settings().exportPrefix || '';
  if (safe !== saved) await mutate({ type: 'settings.update', patch: { exportPrefix: safe } });
  input.value = safe;
  renderPattern(); renderSavesAs();
  if (safe !== typed.trim()) {
    show(safe
      ? `Saved the prefix as “${safe}”. File names use only letters, digits, dots, underscores and hyphens.`
      : 'That prefix has no letters or digits, so file names have no prefix.');
  } else if (safe !== saved) {
    show(safe ? `File names now start with “${safe}_”.` : 'File names have no prefix now.');
  }
}

async function saveTimestamp() {
  const checked = $('name-timestamp').checked;
  $('name-timestamp-format').disabled = !checked;
  await mutate({ type: 'settings.update', patch: { exportTimestamp: checked } });
}

async function saveTimestampFormat() {
  await mutate({ type: 'settings.update', patch: { exportTimestampFormat: $('name-timestamp-format').value } });
}

export function bindNames() {
  $('export-name').addEventListener('input', () => renderSavesAs());
  $('name-prefix').addEventListener('change', () => action(savePrefix));
  $('name-prefix').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); $('name-prefix').blur(); } });
  $('name-timestamp').addEventListener('change', () => action(saveTimestamp));
  $('name-timestamp-format').addEventListener('change', () => action(saveTimestampFormat));
  // The default name carries the time to the minute, so keep the line current while it shows.
  setInterval(() => { if (!document.hidden && ui.state) renderSavesAs(); }, REFRESH_MS);
}
