// Export: format, columns (including custom columns), what an export covers, downloads and
// clipboard copies, including rich links.
import { COLUMNS, makeExport, richLinks } from '../../core/export.js';
import { MAX_CUSTOM_FIELDS } from '../../core/model.js';
import { $, node, icon, count, plural } from './helpers.js';
import { ui, action, show, currentCollection, DEFAULT_COLUMNS } from './state.js';
import { onRender, onEscape } from './rendering.js';
import { FIELD_KEY, NAME_HELP, fieldsOf, addField, nameHelp } from './fields.js';
import { targetRows, requiredRows } from './review.js';
import { renderBookmarkTarget } from './bookmarks.js';
import { renderOpenTarget } from './open.js';
import { bindNames, renderNames, renderSavesAs, exportName, followFormatChange } from './names.js';
import { bindDownloads, renderDownloadTarget } from './downloads.js';

const FORMAT_HELP = {
  xlsx: 'Every cell is stored as text, so nothing is reinterpreted as a formula, number or date. Web and email addresses are clickable, and a second sheet, About, records when and how the file was exported.',
  csv: 'Cells that look like formulas start with an apostrophe so spreadsheets import them as text.',
  tsv: 'Tab-separated. Cells that look like formulas start with an apostrophe.',
  markdown: 'One [anchor text](URL) per line. Columns do not apply; empty anchor text stays empty.',
  html: 'A plain HTML table using your columns. Page text is escaped.',
  json: 'Every field for every link, including all grouped occurrences, after an about block that records when and how the file was exported. Columns do not apply.',
  text: 'One URL per line, exactly as captured. Columns do not apply.',
};

// The Add a column menu's last choice, which names and adds a custom column.
const NEW_COLUMN = 'new-custom-column';

export function columnLabel(key) {
  if (key.startsWith(FIELD_KEY)) return fieldsOf().find((field) => FIELD_KEY + field.id === key)?.name || key;
  return COLUMNS.find((item) => item.key === key)?.label || key;
}

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
  // The collection's custom columns, then New custom column…, which stays last.
  const fields = fieldsOf(), custom = document.createElement('optgroup');
  custom.label = 'Custom columns';
  for (const field of fields.filter((item) => !ui.columns.includes(FIELD_KEY + item.id))) custom.append(new Option(field.name, FIELD_KEY + field.id));
  const create = new Option(fields.length >= MAX_CUSTOM_FIELDS ? `New custom column… (${MAX_CUSTOM_FIELDS} is the most per collection)` : 'New custom column…', NEW_COLUMN);
  create.disabled = !currentCollection() || fields.length >= MAX_CUSTOM_FIELDS;
  custom.append(create); add.append(custom);
  add.disabled = [...add.options].every((option) => !option.value || option.disabled);
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
  if (grouped && rows.length) notes.push('Grouped rows use their first link for tables, text, Markdown and rich links. JSON keeps every occurrence and source.');
  $('export-scope').textContent = notes.join(' ');
  const format = $('format').value;
  $('download-label').textContent = `Download ${{ xlsx: 'Excel file', csv: 'CSV file', tsv: 'TSV file', markdown: 'Markdown file', html: 'HTML file', json: 'JSON file', text: 'URL list' }[format]}`;
  renderNames();
  $('format-help').textContent = (FORMAT_HELP[format] || '') + (format === 'json' && fieldsOf(collection).length ? ' Custom columns are in each link’s fields, and the about block names them.' : '');
  $('columns-help').textContent = ['markdown', 'json', 'text'].includes(format)
    ? 'Columns apply to the Table copy and to CSV, TSV, Excel and HTML files. This format ignores them.'
    : 'Columns apply to the Table copy and to CSV, TSV, Excel and HTML files.';
  for (const id of ['copy-table', 'copy-urls', 'copy-markdown', 'copy-rich', 'download', 'dock-copy']) $(id).disabled = !rows.length;
  renderBookmarkTarget(rows);
  renderOpenTarget(rows);
  renderDownloadTarget(rows);
}

// How the rows were chosen, for the About sheet and JSON about block. Read from the review
// controls, whose IDs are stable.
function viewDescription() {
  const group = $('dedupe').selectedOptions[0]?.textContent || 'Every occurrence';
  const sort = ($('sort').selectedOptions[0]?.textContent || 'Capture order').toLowerCase();
  return `${group}; sorted by ${sort}, ${$('direction').value === 'desc' ? 'descending' : 'ascending'}`;
}

function filterDescriptions() {
  const filters = [];
  if (ui.batchFilter) filters.push(`One capture only (batch ${ui.batchFilter})`);
  if ($('search').value.trim()) filters.push(`Search: “${$('search').value}”`);
  if ($('domain').value.trim()) filters.push(`Domain contains “${$('domain').value}”`);
  if ($('file-type').value.trim()) filters.push(`File type: ${$('file-type').value.replace(/^\./, '')}`);
  if ($('relation').value === 'internal') filters.push('Internal links only (same site as the source page)');
  if ($('relation').value === 'external') filters.push('External links only (other sites)');
  if ($('status-filter').value !== 'any') filters.push(`Reading status: ${$('status-filter').selectedOptions[0].textContent}`);
  if ($('starred-filter').checked) filters.push('Starred links only');
  if ($('type-group').value) filters.push(`Type: ${$('type-group').value}`);
  if (ui.selectedIds.size) filters.push('Selected links only');
  return filters;
}

export function exportAbout(rows, date) {
  return { exportedAt: date, collection: currentCollection().name, count: rows.length, view: viewDescription(),
    filters: filterDescriptions(), columns: [...ui.columns], version: chrome.runtime.getManifest().version };
}

export async function download() {
  const rows = requiredRows();
  const date = new Date();
  const name = exportName(date);
  const result = makeExport(rows, { format: $('format').value, columns: ui.columns, about: exportAbout(rows, date), fields: fieldsOf() });
  const blob = new Blob([result.data], { type: result.mime });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = href; link.download = name;
  renderSavesAs(date);
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 30000);
  show(`Downloaded ${name}.`);
}

export async function copy(format, columns) {
  const rows = requiredRows();
  const result = makeExport(rows, { format, columns, fields: fieldsOf() });
  await navigator.clipboard.writeText(result.data);
  const n = rows.length;
  show(format === 'text' ? `Copied ${plural(n, 'URL')}, one per line.`
    : format === 'markdown' ? `Copied ${plural(n, 'Markdown link')}.`
    : `Copied ${plural(n, 'row')} as a table (${columns.map(columnLabel).join(', ')}). Paste into any spreadsheet.`);
}

// Rich links: HTML that Google Docs, Word and Notion paste as clickable anchor text, with a plain
// text copy alongside. If Chrome refuses the HTML, the plain text alone is copied and the status
// says so.
export async function copyRich() {
  const rows = requiredRows();
  const { html, text } = richLinks(rows);
  const n = rows.length;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
  } catch {
    await navigator.clipboard.writeText(text);
    show(`Copied ${plural(n, 'link')} as plain text, each with its URL, because Chrome didn't accept rich links here. They won't paste as clickable links.`);
    return;
  }
  show(`Copied ${plural(n, 'link')} as rich links. Paste into Google Docs, Word or Notion to keep them clickable.`);
}

/* Custom columns in the export ------------------------------------------------------------ */
let fieldsKey = '', fieldsCollection = '';
// When the collection or its columns change, export columns that no longer exist are dropped and
// the list shows current names.
function followFields(collection) {
  if (collection.id !== fieldsCollection) { fieldsCollection = collection.id; closeNewColumn(); }
  const fields = fieldsOf(collection), key = JSON.stringify([collection.id, fields]);
  if (key === fieldsKey) return;
  fieldsKey = key;
  const known = new Set(fields.map((field) => FIELD_KEY + field.id));
  ui.columns = ui.columns.filter((column) => !column.startsWith(FIELD_KEY) || known.has(column));
  if (!ui.columns.length) ui.columns = [...DEFAULT_COLUMNS];
  renderColumns();
}

function newColumnHelp() { return `Adds a column to “${currentCollection()?.name || ''}” and to this export. Fill it in each link’s details. ${NAME_HELP}`; }

function openNewColumn() {
  $('new-column').hidden = false;
  $('new-column-name').value = ''; $('new-column-name').removeAttribute('aria-invalid');
  $('new-column-help').textContent = newColumnHelp(); $('new-column-help').classList.remove('is-problem');
  $('new-column-name').focus();
}
function closeNewColumn() { $('new-column').hidden = true; }

async function createColumn() {
  const input = $('new-column-name'), help = $('new-column-help');
  const collection = currentCollection();
  let field;
  try { field = await addField(input.value); } catch (error) {
    help.textContent = error.message; help.classList.add('is-problem'); input.setAttribute('aria-invalid', 'true'); input.focus();
    return;
  }
  ui.columns.push(FIELD_KEY + field.id);
  closeNewColumn(); renderColumns(); $('add-column').focus();
  show(`Added the column “${field.name}” to “${collection.name}” and to this export. Fill it in each link’s details, or select links and use Fill for selected links.`);
}

export function bindExport() {
  $('dock-copy').addEventListener('click', () => action(() => copy('tsv', ui.columns)));
  $('format').addEventListener('change', () => { followFormatChange(); renderExportTarget(); });
  bindNames();
  $('add-column').addEventListener('change', (event) => {
    const { value } = event.target;
    if (value === NEW_COLUMN) { event.target.value = ''; openNewColumn(); return; }
    if (value) { ui.columns.push(value); renderColumns(); $('add-column').focus(); }
  });
  $('new-column').addEventListener('submit', (event) => { event.preventDefault(); action(createColumn); });
  $('new-column-name').addEventListener('input', () => {
    $('new-column-name').removeAttribute('aria-invalid'); $('new-column-help').classList.remove('is-problem');
    $('new-column-help').textContent = nameHelp($('new-column-name').value, newColumnHelp());
  });
  $('new-column-cancel').addEventListener('click', () => { closeNewColumn(); $('add-column').focus(); });
  onEscape(() => {
    if ($('new-column').hidden) return false;
    closeNewColumn(); $('add-column').focus();
    return true;
  });
  onRender(followFields);
  $('reset-columns').addEventListener('click', () => { ui.columns = [...DEFAULT_COLUMNS]; renderColumns(); $('add-column').focus(); });
  $('download').addEventListener('click', () => action(download));
  $('copy-table').addEventListener('click', () => action(() => copy('tsv', ui.columns)));
  $('copy-urls').addEventListener('click', () => action(() => copy('text', ui.columns)));
  $('copy-markdown').addEventListener('click', () => action(() => copy('markdown', ui.columns)));
  $('copy-rich').addEventListener('click', () => action(copyRich));
  bindDownloads();
}
