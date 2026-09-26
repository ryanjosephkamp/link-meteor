// Bookmarks: saving the export target as a Chrome bookmark folder.
import { $, count, plural, safeUrl } from './helpers.js';
import { request, action, show, currentCollection } from './state.js';
import { requiredRows } from './review.js';

export function renderBookmarkDefaults(collection) { $('bookmark-name').placeholder = collection.name; }

export function renderBookmarkTarget(rows) {
  const webRows = rows.filter((row) => safeUrl(row.url)).length;
  $('bookmark-label').textContent = webRows ? `Bookmark ${plural(webRows, 'web link')}` : 'Create bookmark folder';
  $('bookmark').disabled = !rows.length;
}

export async function bookmark() {
  const rows = requiredRows();
  const links = rows.filter((row) => safeUrl(row.url)).map((row) => ({ anchorText: row.anchorText, url: row.url }));
  const skipped = rows.length - links.length;
  if (!links.length) throw new Error(`No HTTP(S) links are available to bookmark. ${skipped} non-web row${skipped === 1 ? ' was' : 's were'} skipped.`);
  const allowed = await chrome.permissions.request({ permissions: ['bookmarks'] });
  if (!allowed) throw new Error('Bookmark access was declined. Nothing was saved to your bookmarks.');
  const name = $('bookmark-name').value.trim() || currentCollection().name;
  const result = await request({ type: 'links.bookmark', name, links });
  show(`Created bookmark folder “${name}”: ${count(result.count)} saved, ${count(result.failed)} failed, ${count(skipped)} non-web row${skipped === 1 ? '' : 's'} skipped.`);
}

export function bindBookmarks() {
  $('bookmark').addEventListener('click', () => action(bookmark));
}
