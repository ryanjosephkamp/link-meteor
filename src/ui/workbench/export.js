// Export: format, columns, what an export covers, downloads and clipboard copies.
import { COLUMNS, makeExport } from '../../core/export.js';
import { $, node, icon, count, plural, filename } from './helpers.js';
import { ui, action, show, currentCollection, DEFAULT_COLUMNS } from './state.js';
import { targetRows, requiredRows } from './review.js';
import { renderBookmarkTarget } from './bookmarks.js';
import { renderOpenTarget } from './open.js';

const FORMAT_HELP = {
  xlsx: 'Every cell is stored as text, so nothing is reinterpreted as a formula, number or date.',
  csv: 'Cells that look like formulas start with an apostrophe so spreadsheets import them as text.',
  tsv: 'Tab-separated. Cells that look like formulas start with an apostrophe.',
  markdown: 'One [anchor text](URL) per line. Columns do not apply; empty anchor text stays empty.',
  html: 'A plain HTML table using your columns. Page text is escaped.',
  json: 'Every field for every link, including all grouped occurrences. Columns do not apply.',
  text: 'One URL per line, exactly as captured. Columns do not apply.',
};

export function columnLabel(key) { return COLUMNS.find((item) => item.key === key)?.label || key; }

export function renderColumns() {
  const area = $('columns'); area.replaceChildren();
  for (const [index, column] of ui.columns.entries()) {
    const item = node('li', 'column-item');
    const label = columnLabel(column);
    const move = (offset, name) => {
      const control = node('button'); control.type = 'button'; control.append(icon(offset < 0 ? 'i-arrow-up' : 'i-arrow-down'));
      control.setAttribute('aria-label', `Move ${label} ${name}`); control.title = `Move ${name}`;
      control.disabled = offset < 0 ? index === 0 : index === ui.columns.length - 1;
      control.addEventListener('click', () => {
        [ui.columns[index + offset], ui.columns[index]] = [ui.columns[index], ui.columns[index + offset]];
        renderColumns();
        area.querySelectorAll('.column-item')[index + offset]?.querySelector(`button[aria-label="Move ${CSS.escape(label)} ${name}"]`)?.focus();
      });
      return control;
    };
    const remove = node('button'); remove.type = 'button'; remove.append(icon('i-x'));
    remove.setAttribute('aria-label', `Remove ${label} column`); remove.title = 'Remove column';
    remove.disabled = ui.columns.length === 1;
    remove.addEventListener('click', () => { ui.columns.splice(index, 1); renderColumns(); $('add-column').focus(); });
    item.append(node('span', 'name', label), move(-1, 'up'), move(1, 'down'), remove);
    area.append(item);
  }
  const add = $('add-column'); add.replaceChildren(new Option('Add a column…', ''));
  for (const column of COLUMNS.filter((item) => !ui.columns.includes(item.key))) add.add(new Option(column.label, column.key));
  add.disabled = ui.columns.length === COLUMNS.length;
  $('reset-columns').hidden = ui.columns.join() === DEFAULT_COLUMNS.join();
  $('copy-table-note').textContent = ui.columns.map(columnLabel).join(' · ');
  $('dock-copy-label').textContent = ui.columns.join() === DEFAULT_COLUMNS.join() ? 'Copy text + URL' : 'Copy table';
  renderExportTarget();
}

export function renderExportTarget() {
  const collection = currentCollection();
  if (!collection) return;
  const rows = targetRows();
  const grouped = $('dedupe').value !== 'none';
  const unit = grouped ? 'row' : 'link';
  const selected = ui.selectedIds.size > 0;
  const filtered = ui.rows.reduce((n, row) => n + row.occurrenceIds.length, 0) < collection.links.length;
  let headline, short;
  if (!rows.length) {
    headline = collection.links.length ? (selected ? 'No selected links in this view' : 'Nothing in this view') : 'No links yet';
    short = headline;
  } else if (selected) {
    headline = `${plural(rows.length, `selected ${unit}`)}`;
    short = `${count(rows.length)} selected`;
  } else {
    headline = `All ${plural(rows.length, unit)} in this view`;
    short = `All ${plural(rows.length, unit)}`;
  }
  $('export-target').textContent = headline;
  $('dock-target').textContent = short;
  $('export-target').parentElement.classList.toggle('is-empty', !rows.length);
  const notes = [];
  if (selected) notes.push('Only selected links that match the current filters are used.');
  else if (filtered) notes.push(`Filtered from ${plural(collection.links.length, 'link')}. Every matching link is used, across all pages.`);
  else if (rows.length) notes.push('Every link in the collection, across all pages.');
  if (grouped && rows.length) notes.push('Grouped rows use their first link for tables, text and Markdown. JSON keeps every occurrence and source.');
  $('export-scope').textContent = notes.join(' ');
  const format = $('format').value;
  const extension = { xlsx: 'xlsx', csv: 'csv', tsv: 'tsv', markdown: 'md', html: 'html', json: 'json', text: 'txt' }[format];
  $('download-label').textContent = `Download ${{ xlsx: 'Excel file', csv: 'CSV file', tsv: 'TSV file', markdown: 'Markdown file', html: 'HTML file', json: 'JSON file', text: 'URL list' }[format]}`;
  $('download-name').textContent = `Saves as ${filename(collection.name)}.${extension}`;
  $('format-help').textContent = FORMAT_HELP[format] || '';
  $('columns-help').textContent = ['markdown', 'json', 'text'].includes(format)
    ? 'Columns apply to the Table copy and to CSV, TSV, Excel and HTML files. This format ignores them.'
    : 'Columns apply to the Table copy and to CSV, TSV, Excel and HTML files.';
  for (const id of ['copy-table', 'copy-urls', 'copy-markdown', 'download', 'dock-copy']) $(id).disabled = !rows.length;
  renderBookmarkTarget(rows);
  renderOpenTarget(rows);
}

export async function download() {
  const result = makeExport(requiredRows(), { format: $('format').value, columns: ui.columns });
  const blob = new Blob([result.data], { type: result.mime });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = href; link.download = `${filename(currentCollection().name)}.${result.extension}`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 30000);
  show(`Downloaded ${link.download}.`);
}

export async function copy(format, columns) {
  const rows = requiredRows();
  const result = makeExport(rows, { format, columns });
  await navigator.clipboard.writeText(result.data);
  const n = rows.length;
  show(format === 'text' ? `Copied ${plural(n, 'URL')}, one per line.`
    : format === 'markdown' ? `Copied ${plural(n, 'Markdown link')}.`
    : `Copied ${plural(n, 'row')} as a table (${columns.map(columnLabel).join(', ')}). Paste into any spreadsheet.`);
}

export function bindExport() {
  $('dock-copy').addEventListener('click', () => action(() => copy('tsv', ui.columns)));
  $('format').addEventListener('change', renderExportTarget);
  $('add-column').addEventListener('change', (event) => { if (event.target.value) { ui.columns.push(event.target.value); renderColumns(); $('add-column').focus(); } });
  $('reset-columns').addEventListener('click', () => { ui.columns = [...DEFAULT_COLUMNS]; renderColumns(); $('add-column').focus(); });
  $('download').addEventListener('click', () => action(download));
  $('copy-table').addEventListener('click', () => action(() => copy('tsv', ui.columns)));
  $('copy-urls').addEventListener('click', () => action(() => copy('text', ui.columns)));
  $('copy-markdown').addEventListener('click', () => action(() => copy('markdown', ui.columns)));
}
