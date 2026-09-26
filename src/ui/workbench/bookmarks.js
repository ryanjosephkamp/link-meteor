// Bookmarks: saving the export target into a new or an existing Chrome bookmark folder.
import { $, count, plural, safeUrl } from './helpers.js';
import { request, action, show, currentCollection } from './state.js';
import { requiredRows, targetRows } from './review.js';

// Folders load when the person chooses Existing folder; chosen is a folder ID.
const picker = { folders: null, chosen: '', loading: false };
const HELP = {
  new: 'Creates a new folder in Other bookmarks. Web links only. Chrome may sync bookmarks according to your browser settings.',
  existing: 'Adds links to the folder you choose and changes nothing else in your bookmarks. Web links only. Chrome may sync bookmarks according to your browser settings.',
};

function mode() { return document.querySelector('input[name="bookmark-mode"]:checked')?.value === 'existing' ? 'existing' : 'new'; }

function setMode(value) {
  for (const input of document.querySelectorAll('input[name="bookmark-mode"]')) input.checked = input.value === value;
  $('bookmark-new').hidden = value !== 'new';
  $('bookmark-existing').hidden = value !== 'existing';
  $('bookmark-help').textContent = HELP[value];
  renderBookmarkTarget(targetRows());
}

export function renderBookmarkDefaults(collection) { $('bookmark-name').placeholder = collection.name; }

// With Skip on, repeated URLs are saved once, so the count is of distinct web links.
export function renderBookmarkTarget(rows) {
  const web = rows.filter((row) => safeUrl(row.url)).map((row) => row.url);
  const n = $('bookmark-skip-existing').checked ? new Set(web).size : web.length;
  $('bookmark-label').textContent = n ? `Bookmark ${plural(n, 'web link')}` : mode() === 'new' ? 'Create bookmark folder' : 'Add to folder';
  $('bookmark').disabled = !rows.length;
}

function chosenFolder() { return picker.folders?.find((folder) => folder.id === picker.chosen) || null; }

// Lists the folders whose path contains every typed word, keeping the chosen one selected.
function renderFolders() {
  const select = $('bookmark-folder');
  const status = $('bookmark-folder-status');
  if (picker.loading || !picker.folders) {
    select.replaceChildren();
    status.textContent = picker.loading ? 'Loading your bookmark folders…' : '';
    return;
  }
  const words = $('bookmark-folder-search').value.toLowerCase().split(/\s+/).filter(Boolean);
  const seen = new Map();
  const options = [];
  for (const folder of picker.folders) {
    const repeat = (seen.get(folder.path) || 0) + 1;
    seen.set(folder.path, repeat);
    if (!words.every((word) => folder.path.toLowerCase().includes(word))) continue;
    const label = repeat > 1 ? `${folder.path} (${repeat})` : folder.path;
    const option = new Option(label, folder.id, false, folder.id === picker.chosen);
    option.title = label;
    options.push(option);
  }
  select.replaceChildren(...options);
  const total = picker.folders.length;
  const found = !total ? 'You have no bookmark folders yet.'
    : !options.length ? `No folders match “${$('bookmark-folder-search').value.trim()}”.`
    : words.length ? `${count(options.length)} of ${plural(total, 'folder')}.` : `${plural(total, 'folder')}.`;
  const chosen = chosenFolder();
  status.textContent = chosen ? `${found} Saves to ${chosen.path}.` : `${found} Choose one to save into.`;
}

async function loadFolders() {
  picker.loading = true; renderFolders();
  try { picker.folders = (await request({ type: 'bookmarks.folders' })).folders; }
  finally {
    picker.loading = false;
    if (!chosenFolder()) picker.chosen = '';
    renderFolders();
  }
}

// Choosing Existing folder asks for bookmark access in the same click, before anything else.
function chooseMode(event) {
  if (!event.target.checked) return;
  if (event.target.value !== 'existing') { setMode('new'); return; }
  let pending;
  try { pending = chrome.permissions.request({ permissions: ['bookmarks'] }); }
  catch (error) { pending = Promise.reject(error); }
  setMode('existing');
  picker.loading = true; renderFolders();
  action(async () => {
    let allowed = false;
    try { allowed = await pending; } catch { allowed = false; }
    if (mode() !== 'existing') { picker.loading = false; renderFolders(); return; } // the person chose New folder meanwhile
    if (!allowed) {
      picker.loading = false; renderFolders();
      setMode('new');
      $('bookmark-mode').querySelector('input[value="new"]').focus();
      throw new Error('Bookmark access was declined, so existing folders can’t be listed. Choose Existing folder again to allow it, or save into a new folder.');
    }
    await loadFolders();
  });
}

export async function bookmark() {
  const rows = requiredRows();
  const links = rows.filter((row) => safeUrl(row.url)).map((row) => ({ anchorText: row.anchorText, url: row.url }));
  const left = rows.length - links.length;
  if (!links.length) throw new Error(`No HTTP(S) links are available to bookmark. ${left} non-web row${left === 1 ? ' was' : 's were'} skipped.`);
  const existing = mode() === 'existing';
  const folder = chosenFolder();
  if (existing && !folder) { $('bookmark-folder-search').focus(); throw new Error('Choose a bookmark folder to save into, or choose New folder.'); }
  const allowed = await chrome.permissions.request({ permissions: ['bookmarks'] });
  if (!allowed) throw new Error('Bookmark access was declined. Nothing was saved to your bookmarks.');
  const skipExisting = $('bookmark-skip-existing').checked;
  const name = $('bookmark-name').value.trim() || currentCollection().name;
  let result;
  try {
    result = await request(existing ? { type: 'links.bookmark', folderId: folder.id, links, skipExisting } : { type: 'links.bookmark', name, links, skipExisting });
  } catch (error) {
    if (existing) loadFolders().catch(() => {}); // the folder may have been moved or removed
    throw error;
  }
  const counts = `${count(result.count)} saved, ${count(result.skipped)} skipped ${existing ? '(already in the folder)' : 'as repeats'}, ${count(result.failed)} failed.`;
  const leftOut = left ? ` ${plural(left, 'mail or phone link')} left out; only web links can be bookmarked.` : '';
  show(existing ? `Saved to “${folder.path}”: ${counts}${leftOut}` : `Created bookmark folder “${name}”: ${counts}${leftOut}`);
  if (!existing && picker.folders) picker.folders = null; // the new folder appears next time
}

export function bindBookmarks() {
  $('bookmark').addEventListener('click', () => action(bookmark));
  for (const input of document.querySelectorAll('input[name="bookmark-mode"]')) input.addEventListener('change', chooseMode);
  $('bookmark-folder-search').addEventListener('input', renderFolders);
  $('bookmark-folder-search').addEventListener('keydown', (event) => {
    const select = $('bookmark-folder');
    if (event.key === 'ArrowDown' && select.options.length) { event.preventDefault(); select.focus(); }
    if (event.key === 'Enter' && select.options.length === 1) { event.preventDefault(); picker.chosen = select.options[0].value; renderFolders(); }
  });
  $('bookmark-folder').addEventListener('change', (event) => { picker.chosen = event.target.value; renderFolders(); });
  $('bookmark-skip-existing').addEventListener('change', () => renderBookmarkTarget(targetRows()));
  setMode('new');
}
