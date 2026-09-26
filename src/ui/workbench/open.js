// Opening the export target's web links in tabs, after an inline confirmation.
import { $, count, plural, safeUrl } from './helpers.js';
import { ui, request, action, show } from './state.js';
import { onEscape } from './rendering.js';
import { targetRows, requiredRows } from './review.js';

export function renderOpenTarget(rows) {
  const webUrls = new Set(rows.map((row) => safeUrl(row.url)).filter(Boolean)).size;
  $('open-label').textContent = webUrls ? `Open ${plural(webUrls, 'web link')}…` : 'Open links…';
  $('open-links').disabled = !rows.length;
  if (ui.pendingOpen && [...new Set(rows.map((row) => safeUrl(row.url)).filter(Boolean))].join('\n') !== ui.pendingOpen.join('\n')) cancelOpen();
}

export function openLinks() {
  const rows = requiredRows();
  const urls = [...new Set(rows.map((row) => safeUrl(row.url)).filter(Boolean))];
  const skipped = rows.filter((row) => !safeUrl(row.url)).length;
  if (!urls.length) throw new Error(`No HTTP(S) links are available to open. ${skipped} non-web row${skipped === 1 ? ' was' : 's were'} skipped.`);
  if (urls.length > 20) throw new Error(`${urls.length} unique HTTP(S) links are in the target and ${skipped} non-web rows would be skipped. Select at most 20 web links to open in one batch.`);
  ui.pendingOpen = urls;
  $('open-confirm-text').textContent = `Open ${plural(urls.length, 'web link')} in new background tabs?${skipped ? ` ${plural(skipped, 'non-web row')} will be skipped.` : ''}`;
  $('open-confirm-yes').textContent = `Open ${plural(urls.length, 'tab')}`;
  $('open-confirm').hidden = false;
  $('open-links').hidden = true;
  $('open-confirm-yes').focus();
}

export function cancelOpen() {
  ui.pendingOpen = null;
  $('open-confirm').hidden = true;
  $('open-links').hidden = false;
}

export async function confirmOpen() {
  const urls = ui.pendingOpen;
  if (!urls) return;
  const skipped = targetRows().filter((row) => !safeUrl(row.url)).length;
  cancelOpen(); $('open-links').focus();
  const result = await request({ type: 'links.open', urls });
  show(`Opened ${plural(result.opened, 'link')}; ${count(result.failed)} failed; ${count(skipped)} non-web row${skipped === 1 ? '' : 's'} skipped.`);
}

export function bindOpen() {
  $('open-links').addEventListener('click', () => action(openLinks));
  $('open-confirm-yes').addEventListener('click', () => action(confirmOpen));
  $('open-confirm-no').addEventListener('click', () => { cancelOpen(); $('open-links').focus(); });
  onEscape(() => {
    if ($('open-confirm').hidden) return false;
    cancelOpen(); $('open-links').focus();
    return true;
  });
}
