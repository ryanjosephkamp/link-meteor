// Import links (0.5.0): links from a file, pasted text or a Chrome bookmark folder, read in this page
// and never uploaded, with each column mapped to a part of a link, a preview of what is added and
// what is skipped (and why), and one Import that the notice can undo. Nothing is added before
// Import. Delimited text and lists are parsed in import-worker.js; workbooks and HTML are read here
// with DecompressionStream and DOMParser. The contract is in docs/CONTRACTS.md ("Imports").
import { MAX_IMPORT_BYTES, MAX_IMPORT_LINKS, SKIP_REASONS, decodeText, readText, readXlsx, readExportJson, detectHeader, columnNames, dataRows,
  guessMapping, planImport } from '../../core/imports.js';
import { $, node, count, plural } from './helpers.js';
import { ui, action, request, show } from './state.js';
import { render, onRender, onEscape, setView } from './rendering.js';

// The parts of a link a column can fill, in the mapping's order.
const STANDARD = [['url', 'Address (URL)'], ['anchorText', 'Anchor text'], ['notes', 'Notes'], ['tags', 'Tags'], ['status', 'Reading status'], ['starred', 'Starred']];
const PREVIEW_ROWS = 100, CELL_TEXT = 160, SHOWN_COLUMNS = 12;
// How the preview names what each source is made of, and its number column.
const UNITS = { row: { noun: 'row', heading: 'Row' }, line: { noun: 'link', heading: 'Line' }, link: { noun: 'link', heading: 'Link' } };
const TYPES = { csv: 'csv', tsv: 'tsv', tab: 'tsv', xlsx: 'xlsx', xlsm: 'xlsx', html: 'html', htm: 'html', json: 'json', txt: 'text', text: 'text', md: 'list', markdown: 'list' };
const PHRASES = {
  'no-address': (n) => (n === 1 ? '1 has no address' : `${count(n)} have no address`),
  'not-link': (n) => (n === 1 ? '1 isn’t a web, email or phone address' : `${count(n)} aren’t web, email or phone addresses`),
  repeat: (n) => (n === 1 ? '1 repeats an earlier row' : `${count(n)} repeat earlier rows`),
  saved: (n) => (n === 1 ? '1 is already saved there' : `${count(n)} are already saved there`),
  limit: (n) => `${count(n)} ${n === 1 ? 'is' : 'are'} over the ${count(MAX_IMPORT_LINKS)}-link limit`,
};

// The import on screen. `run` changes whenever a read starts or the view closes, so a late answer
// from an earlier read is ignored.
const view = { run: 0, kind: '', source: null, table: null, header: false, names: [], mapping: null, destination: 'new', plan: null, planned: null,
  folders: null, chosen: '', pasted: null, returnFocus: null, busy: false };
let worker = null, jobs = 0;

const collapse = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
const clip = (value, max = CELL_TEXT) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
const visible = (element) => !!element?.isConnected && element.getClientRects().length > 0;
const joined = (parts) => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts.join(''));
const filled = (row) => row.some((cell) => String(cell ?? '').trim());
function destination() { return view.destination === 'new' ? null : ui.state?.collections.find((item) => item.id === view.destination) || null; }

function progress(text) { $('import-progress').textContent = text; $('import-progress').hidden = !text; }

/* Opening and closing ---------------------------------------------------------------------------- */
function stopWorker() { worker?.terminate(); worker = null; }

function reset() {
  view.run++; stopWorker();
  Object.assign(view, { kind: '', source: null, table: null, header: false, names: [], mapping: null, destination: 'new', plan: null, planned: null, pasted: null });
  $('import-map').replaceChildren(); $('import-table').tHead.replaceChildren(); $('import-table').tBodies[0].replaceChildren();
  $('import-only-skipped').checked = false; $('import-skip-saved').checked = true;
  $('import-plan').hidden = true; $('import-commit').hidden = true; progress('');
}

function openView(kind, opener) {
  reset();
  view.kind = kind; view.returnFocus = opener;
  $('import-source').textContent = kind === 'paste' ? 'Paste links below, then preview them. Nothing is added until you choose Import.'
    : kind === 'folder' ? 'Choose a bookmark folder, then preview its links. Nothing is added until you choose Import.' : '';
  $('import-paste-step').hidden = kind !== 'paste';
  $('import-folder-step').hidden = kind !== 'folder';
  if (kind !== 'paste') $('import-text').value = '';
  $('import').hidden = false; $('main').classList.add('is-importing');
  setView('links');
  $('import-title').focus();
}

export function closeImport({ focus = true } = {}) {
  if ($('import').hidden) return;
  const opener = view.returnFocus;
  reset();
  Object.assign(view, { kind: '', folders: null, chosen: '', returnFocus: null, busy: false });
  $('import-text').value = ''; $('import-folder-search').value = ''; $('import-file').value = '';
  $('import').hidden = true; $('main').classList.remove('is-importing');
  if (focus) (visible(opener) ? opener : $('search')).focus();
}

function cancel() { if (view.busy) return; closeImport(); show('Import canceled. Nothing was added.'); }

/* Reading -------------------------------------------------------------------------------------- */
// Delimited text and lists, parsed by the worker; in this page when the worker can't start.
function parseText(message, onProgress) {
  const id = ++jobs;
  return new Promise((resolve, reject) => {
    const here = () => { try { resolve(readText(message.bytes ? decodeText(message.bytes) : message.text, message)); } catch (error) { reject(error); } };
    if (!worker) { try { worker = new Worker(new URL('./import-worker.js', import.meta.url), { type: 'module' }); } catch { worker = null; } }
    if (!worker) { here(); return; }
    const current = worker;
    const done = () => { current.removeEventListener('message', answer); current.removeEventListener('error', broken); };
    const answer = ({ data }) => {
      if (data.id !== id) return;
      if (data.progress) { onProgress?.(data.progress); return; }
      done();
      if (data.error) reject(new Error(data.error)); else resolve(data);
    };
    const broken = (event) => { event.preventDefault?.(); done(); current.terminate(); if (worker === current) worker = null; here(); };
    current.addEventListener('message', answer); current.addEventListener('error', broken);
    current.postMessage({ id, ...message });
  });
}

const listTable = (entries) => ({ names: ['Anchor text', 'Address'], rows: entries.map((entry) => [entry.anchorText, entry.href]), numbers: entries.map((entry) => entry.line), unit: 'line', fixed: true });

async function inflateRaw(bytes) {
  try { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()); }
  catch { throw new Error('This workbook is damaged, so it can’t be read. Open it in a spreadsheet app, save a copy, then import that.'); }
}
const parseXml = (text) => new DOMParser().parseFromString(text, 'application/xml');
async function readWorkbook(bytes, sheet = 0) {
  const book = await readXlsx(bytes, { inflateRaw, parseXml, sheet });
  return { rows: book.rows, numbers: book.numbers, unit: 'row', fixed: false, sheets: book.sheets, sheet: book.sheet, bytes };
}

// The folder names above a link in a browser's bookmarks file, from the outermost folder in.
function folderPath(anchor) {
  const names = [];
  for (let list = anchor.closest('dl'); list; list = list.parentElement?.closest('dl')) {
    for (let before = list.previousElementSibling; before; before = before.previousElementSibling) {
      if (before.tagName === 'H3') { names.unshift(collapse(before.textContent) || '(untitled folder)'); break; }
      if (before.tagName === 'DL' || before.tagName === 'A') break;
    }
  }
  return names.join(' › ');
}
// A bookmarks file's description of a link: the <DD> after its <DT>.
function description(anchor) {
  const next = anchor.closest('dt')?.nextElementSibling;
  return next?.tagName === 'DD' ? collapse(next.firstChild?.nodeType === Node.TEXT_NODE ? next.firstChild.textContent : next.textContent) : '';
}
// Every <a href> of an HTML page or bookmarks file, with its text, and in a bookmarks file its
// folder path, tags and description. A relative address is resolved against the page's <base>, or
// the address a saved page names; otherwise it stays as written, and the preview skips it.
function htmlTable(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const saved = /<!--\s*saved from url=\(\d+\)(\S+?)\s*-->/i.exec(text.slice(0, 4000))?.[1];
  const base = doc.querySelector('base[href]')?.getAttribute('href') || saved || '';
  const bookmarks = /^\s*<!DOCTYPE\s+NETSCAPE-Bookmark-file/i.test(text);
  const rows = [], originals = [];
  for (const anchor of doc.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href');
    let address = href;
    if (base && !/^\s*[a-z][a-z0-9+.-]*:/i.test(href)) { try { address = new URL(href.trim(), new URL(base).href).href; } catch { /* stays as written */ } }
    const label = collapse(anchor.textContent) || collapse(anchor.getAttribute('aria-label')) || collapse(anchor.getAttribute('title')) || collapse(anchor.querySelector('img[alt]')?.getAttribute('alt'));
    rows.push([label, address, bookmarks ? folderPath(anchor) : '', anchor.getAttribute('tags') || '', bookmarks ? description(anchor) : '']);
    originals.push(href);
  }
  const keep = [0, 1, ...[2, 3, 4].filter((i) => rows.some((row) => row[i]))];
  return { names: keep.map((i) => ['Anchor text', 'Address', 'Folder', 'Tags', 'Notes'][i]), rows: rows.map((row) => keep.map((i) => row[i])), originals,
    unit: 'link', fixed: true, pathColumn: keep.indexOf(2), bookmarks, folders: new Set(rows.map((row) => row[2]).filter(Boolean)).size };
}

function fileType(name, bytes) {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase() || '';
  if (['xls', 'xlsb', 'ods', 'numbers'].includes(extension)) throw new Error(`Link Meteor can’t read .${extension} files. Save ${name} as .xlsx or CSV, then import that.`);
  if (TYPES[extension]) return TYPES[extension];
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'xlsx';
  const head = decodeText(bytes.subarray(0, 512)).trimStart();
  return head.startsWith('<') ? 'html' : /^[[{]/.test(head) ? 'json' : 'text';
}

async function readFileTable(file, bytes, run) {
  const type = fileType(file.name, bytes);
  if (type === 'xlsx') return readWorkbook(bytes);
  if (type === 'html') return htmlTable(decodeText(bytes));
  if (type === 'json') return { ...readExportJson(decodeText(bytes)), unit: 'row', fixed: true };
  const read = await parseText({ bytes, kind: type === 'csv' || type === 'tsv' ? 'table' : type, delimiter: type === 'tsv' ? '\t' : 'sniff' },
    (rows) => { if (run === view.run) progress(`Reading ${file.name}: ${count(rows)} ${type === 'list' ? 'lines' : 'rows'} so far…`); });
  return read.kind === 'list' ? listTable(read.entries) : { rows: read.rows, unit: 'row', fixed: false };
}

async function chooseFile() {
  const input = $('import-file'), file = input.files?.[0];
  if (!file) return;
  openView('file', input);
  const run = view.run;
  try {
    if (file.size > MAX_IMPORT_BYTES) throw new Error(`${file.name} is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB, the most Link Meteor imports at once. Split it into smaller files, then import each.`);
    progress(`Reading ${file.name}…`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (run !== view.run) return;
    const table = await readFileTable(file, bytes, run);
    if (run !== view.run) return;
    setTable(table, { kind: 'file', name: file.name, label: file.name, collection: file.name.replace(/\.[a-z0-9]{1,8}$/i, '') || file.name });
  } catch (error) {
    if (run !== view.run) return;
    closeImport();
    throw new Error(`${String(error?.message || error)} Nothing was imported.`);
  } finally { input.value = ''; }
}

function startPaste(event) { openView('paste', event.currentTarget); $('import-text').focus(); }

// Links copied from a web page arrive with their HTML too, which keeps their anchor text.
function rememberPaste(event) {
  const html = event.clipboardData?.getData('text/html') || '';
  view.pasted = /<a\s[^>]*href/i.test(html) ? { html, text: null } : null;
  const pasted = view.pasted;
  setTimeout(() => { if (pasted && view.pasted === pasted) pasted.text = $('import-text').value; });
}

async function readPaste() {
  const text = $('import-text').value;
  if (!text.trim()) { $('import-text').focus(); throw new Error('Paste some links first: addresses, Markdown links, HTML or cells from a spreadsheet.'); }
  const run = ++view.run;
  let table;
  if (view.pasted?.html && view.pasted.text === text) table = htmlTable(view.pasted.html);
  else if (/<a\s[^>]*href\s*=/i.test(text)) table = htmlTable(text);
  else {
    const read = await parseText({ text, kind: 'text' });
    table = read.kind === 'list' ? listTable(read.entries) : { rows: read.rows, unit: 'row', fixed: false };
  }
  if (run !== view.run) return;
  if (!table.rows.length) throw new Error('No links were found in the pasted text. Paste addresses that start with http, https, mailto or tel, Markdown links or HTML.');
  setTable(table, { kind: 'paste', name: 'pasted text', label: 'Pasted links', collection: 'Pasted links' });
}

/* Bookmark folders ------------------------------------------------------------------------------ */
function chosenFolder() { return view.folders?.find((folder) => folder.id === view.chosen) || null; }

function renderFolders() {
  const select = $('import-folder'), status = $('import-folder-status');
  $('import-read-folder').disabled = !chosenFolder();
  if (!view.folders) { select.replaceChildren(); status.textContent = 'Loading your bookmark folders…'; return; }
  const words = $('import-folder-search').value.toLowerCase().split(/\s+/).filter(Boolean);
  const seen = new Map(), options = [];
  for (const folder of view.folders) {
    const repeat = (seen.get(folder.path) || 0) + 1;
    seen.set(folder.path, repeat);
    if (!words.every((word) => folder.path.toLowerCase().includes(word))) continue;
    const label = repeat > 1 ? `${folder.path} (${repeat})` : folder.path;
    const option = new Option(label, folder.id, false, folder.id === view.chosen);
    option.title = label;
    options.push(option);
  }
  select.replaceChildren(...options);
  const total = view.folders.length, chosen = chosenFolder();
  const found = !total ? 'You have no bookmark folders yet.' : !options.length ? `No folders match “${$('import-folder-search').value.trim()}”.`
    : words.length ? `${count(options.length)} of ${plural(total, 'folder')}.` : `${plural(total, 'folder')}.`;
  status.textContent = chosen ? `${found} Imports from ${chosen.path}.` : `${found} Choose one to import.`;
}

// Asks for bookmark access in the click itself, before anything else, as Chrome requires.
function startFolder(event) {
  let pending;
  try { pending = chrome.permissions.request({ permissions: ['bookmarks'] }); } catch (error) { pending = Promise.reject(error); }
  openView('folder', event.currentTarget);
  view.folders = null; view.chosen = ''; renderFolders();
  const run = view.run;
  action(async () => {
    let allowed = false;
    try { allowed = await pending; } catch { allowed = false; }
    if (run !== view.run) return;
    try {
      if (!allowed) throw new Error('Bookmark access was declined, so your bookmark folders can’t be listed. Choose From a bookmark folder again to allow it.');
      const { folders } = await request({ type: 'bookmarks.folders' });
      if (run !== view.run) return;
      view.folders = folders; renderFolders();
      $('import-folder-search').focus();
    } catch (error) { if (run === view.run) closeImport(); throw error; }
  });
}

async function readFolder() {
  const folder = chosenFolder();
  if (!folder) { $('import-folder').focus(); throw new Error('Choose a bookmark folder to import.'); }
  const recursive = $('import-subfolders').checked, run = ++view.run;
  progress(`Reading ${folder.path}…`);
  let result;
  try { result = await request({ type: 'bookmarks.folderLinks', folderId: folder.id, recursive }); } finally { if (run === view.run) progress(''); }
  if (run !== view.run) return;
  if (!result.links.length) throw new Error(`${folder.path} has no bookmarks${recursive ? '' : ' of its own. Include subfolders to import theirs'}.`);
  const table = { names: ['Anchor text', 'Address', 'Folder'], rows: result.links.map((link) => [link.title, link.url, link.path]), unit: 'link', fixed: true, pathColumn: 2 };
  setTable(table, { kind: 'folder', name: folder.path, label: 'Bookmarks', collection: folder.title || 'Bookmarks', recursive, more: result.more });
}

/* The mapping ---------------------------------------------------------------------------------- */
function setTable(table, source) {
  if (!table.rows.some(filled)) throw new Error(`${source.name} has no ${table.fixed ? 'links' : 'rows'} to import.`);
  view.source = source; view.table = table;
  view.header = !table.fixed && detectHeader(table.rows);
  progress('');
  remap();
  renderAll();
  $('import-plan').hidden = false; $('import-commit').hidden = false;
}

function destinationFields() { return destination()?.fields || []; }

// The likeliest mapping for the table as it is now. With keepStandard, the choices for the link's own
// parts stay and only the custom columns are worked out again (after choosing another destination).
function remap({ keepStandard = false } = {}) {
  const { table } = view;
  view.names = table.fixed ? table.names : columnNames(table.rows, view.header);
  const rows = table.fixed ? table.rows : dataRows(table.rows, view.header);
  const fields = destinationFields();
  const guess = guessMapping(view.names, rows, { fields, skip: table.pathColumn >= 0 ? [table.pathColumn] : [] });
  const kept = keepStandard && view.mapping ? Object.fromEntries(STANDARD.map(([key]) => [key, view.mapping[key]])) : {};
  view.mapping = { ...guess, ...kept, existing: Object.fromEntries(fields.map((field) => [field.id, guess.fields.find((item) => item.id === field.id)?.column ?? -1])),
    fresh: guess.fresh.map((item) => ({ name: item.name, column: item.use ? item.column : -1 })), fieldsKey: JSON.stringify(fields), sample: rows.slice(0, 50) };
}

function optionLabel(i) {
  const name = view.names[i];
  if (view.table.fixed || view.header) return name;
  const sample = view.mapping?.sample.map((row) => collapse(row[i])).find(Boolean);
  return sample ? `${name}: ${clip(sample, 36)}` : name;
}

function mapSelect(id, label, note, value, none, onChange) {
  const holder = node('label', note === '(required)' ? 'required' : '');
  const title = node('span', 'map-label', label);
  if (note) title.append(' ', node('span', 'map-note', note));
  const select = document.createElement('select');
  select.id = id;
  select.append(...view.names.map((_, i) => new Option(optionLabel(i), String(i))), ...(none ? [new Option(none, '-1')] : []));
  select.value = String(value >= 0 || !none ? Math.max(0, value) : -1);
  select.addEventListener('change', () => { onChange(Number(select.value)); plan(); });
  holder.append(title, select);
  return holder;
}

function renderMapping() {
  const { mapping } = view;
  const items = STANDARD.map(([key, label]) => mapSelect(`import-map-${key}`, label, key === 'url' ? '(required)' : '', mapping[key], key === 'url' ? '' : '(none)', (value) => { mapping[key] = value; }));
  destinationFields().forEach((field, i) => items.push(mapSelect(`import-map-field-${i + 1}`, field.name, '', mapping.existing[field.id] ?? -1, '(none)', (value) => { mapping.existing[field.id] = value; })));
  mapping.fresh.forEach((item, i) => items.push(mapSelect(`import-map-new-${i + 1}`, item.name, '(new column)', item.column, '(skip this column)', (value) => { item.column = value; })));
  $('import-map').replaceChildren(...items);
  const help = $('import-map-help');
  help.textContent = mapping.overflow ? `${plural(mapping.overflow, 'more column')} can’t be added: a collection holds at most 20 custom columns.` : '';
  help.hidden = !mapping.overflow;
}

function newCollectionName() {
  const base = collapse(view.source?.collection).slice(0, 110) || 'Imported links';
  const names = new Set((ui.state?.collections || []).map((item) => item.name.trim().toLowerCase()));
  let name = base;
  for (let n = 2; names.has(name.toLowerCase()); n++) name = `${base} (${n})`;
  return name;
}

function renderDestination() {
  if (view.destination !== 'new' && !destination()) view.destination = 'new';
  const select = $('import-destination');
  select.replaceChildren(new Option(`A new collection “${newCollectionName()}”`, 'new'), ...(ui.state?.collections || []).map((item) => new Option(item.name, item.id)));
  select.value = view.destination;
  $('import-skip-saved').disabled = view.destination === 'new';
}

function renderSource() {
  const { source, table } = view;
  const line = $('import-source');
  const rows = table.fixed ? table.rows.length : dataRows(table.rows, view.header).length;
  const parts = [];
  if (source.kind === 'folder') line.replaceChildren('From the bookmark folder ', node('span', 'file', source.name), source.recursive ? ' and its subfolders' : '');
  else if (source.kind === 'paste') line.replaceChildren('From pasted text');
  else line.replaceChildren('From ', node('span', 'file', source.name), table.sheets?.length > 1 ? `, sheet “${table.sheets[table.sheet]}”` : '');
  if (table.unit === 'row') {
    parts.push(plural(rows, 'row'));
    const shown = view.names.slice(0, SHOWN_COLUMNS).join(', ');
    parts.push(`columns: ${view.names.length > SHOWN_COLUMNS ? `${shown} and ${count(view.names.length - SHOWN_COLUMNS)} more` : shown}`);
  } else {
    parts.push(`${plural(rows, source.kind === 'folder' || table.bookmarks ? 'bookmark' : 'link')}${table.folders ? ` in ${plural(table.folders, 'folder')}` : ''}`);
    if (source.more) parts.push('the first 50,000');
  }
  line.append(` · ${parts.join(' · ')}`);
}

function renderAll() {
  renderSource();
  const { table } = view;
  $('import-sheet-row').hidden = !(table.sheets?.length > 1);
  if (table.sheets?.length > 1) { $('import-sheet').replaceChildren(...table.sheets.map((name, i) => new Option(name, String(i)))); $('import-sheet').value = String(table.sheet); }
  $('import-header-row').hidden = table.fixed;
  $('import-header').checked = view.header;
  renderDestination();
  renderMapping();
  plan();
}

/* The preview ---------------------------------------------------------------------------------- */
function plan() {
  if (!view.table || !view.mapping) return;
  const { mapping, table } = view, home = destination();
  const fields = [...Object.entries(mapping.existing).filter(([, column]) => column >= 0).map(([id, column]) => ({ id, column })),
    ...mapping.fresh.filter((item) => item.column >= 0).map((item) => ({ name: item.name, column: item.column }))];
  view.plan = planImport(table.rows, { header: view.header, url: mapping.url, anchorText: mapping.anchorText, notes: mapping.notes, tags: mapping.tags,
    status: mapping.status, starred: mapping.starred, path: table.pathColumn ?? -1, fields }, { links: home?.links || [], skipSaved: !!home && $('import-skip-saved').checked,
    source: table.sheets?.length > 1 ? `${view.source.label} › ${table.sheets[table.sheet]}` : view.source.label, unit: table.unit, numbers: table.numbers,
    originals: table.originals, batchId: 'preview', preview: PREVIEW_ROWS });
  view.planned = { state: ui.state, links: home?.links || null };
  renderPlan();
}

function renderPlan() {
  const { plan: result, mapping, table } = view, unit = UNITS[table.unit];
  const extra = [['notes', 'Notes'], ['tags', 'Tags'], ['status', 'Reading status'], ['starred', 'Starred']].filter(([key]) => mapping[key] >= 0);
  const names = new Map(destinationFields().map((field) => [field.id, field.name]));
  const custom = [...Object.entries(mapping.existing).filter(([, column]) => column >= 0).map(([id]) => [id, names.get(id)]), ...result.newFields.map((field) => [field.key, field.name])];
  const head = node('tr');
  for (const label of [unit.heading, 'Anchor text', 'Address', ...extra.map(([, label]) => label), ...custom.map(([, name]) => name)]) { const th = node('th', '', label); th.scope = 'col'; head.append(th); }
  const why = node('th'); why.scope = 'col'; why.append(node('span', 'sr-only', 'Skipped because')); head.append(why);
  $('import-table').tHead.replaceChildren(head);
  const onlySkipped = $('import-only-skipped').checked;
  const entries = onlySkipped ? result.previewSkipped : result.preview;
  $('import-table').tBodies[0].replaceChildren(...entries.map((entry) => {
    const row = node('tr', entry.reason ? 'skip' : '');
    const { values } = entry;
    row.append(node('td', 'num', count(entry.row)), node('td', '', clip(values.anchorText)), node('td', 'url', clip(values.address) || '(empty)'),
      ...extra.map(([key]) => node('td', '', clip(values[key]))), ...custom.map(([key]) => node('td', '', clip(values.fields[key] || ''))),
      node('td', 'why', entry.reason ? (entry.reason === 'repeat' ? `${SKIP_REASONS.repeat} ${count(entry.of)}` : SKIP_REASONS[entry.reason]) : ''));
    return row;
  }));
  const { counts } = result, skipped = result.skipped.reduce((n, item) => n + (item.rows || 1), 0);
  const total = onlySkipped ? skipped : counts.rows;
  $('import-table-note').textContent = !total ? (onlySkipped ? `No ${unit.noun}s are skipped.` : '')
    : entries.length < total ? `Showing the first ${count(entries.length)} of ${plural(total, onlySkipped ? `skipped ${unit.noun}` : unit.noun)}.`
    : onlySkipped ? `All ${plural(total, `skipped ${unit.noun}`)}.` : total === 1 ? `The only ${unit.noun}.` : `All ${plural(total, unit.noun)}.`;
  $('import-only-skipped').parentElement.hidden = !skipped && !onlySkipped;
  const links = counts.links, fresh = result.newFields.length;
  $('import-summary').classList.toggle('is-empty', !links);
  $('import-summary-main').textContent = links ? `Adds ${plural(links, 'link')}, marked Imported${fresh ? `, and ${plural(fresh, 'new custom column')}` : ''}.` : 'Nothing to add.';
  const reasons = Object.keys(PHRASES).filter((reason) => counts[reason]).map((reason) => PHRASES[reason](counts[reason]));
  $('import-summary-skips').textContent = [
    skipped ? `Skips ${plural(skipped, unit.noun)}: ${reasons.join(', ')}.` : '',
    result.cut ? `${plural(result.cut, 'custom value')} ${result.cut === 1 ? 'is' : 'are'} cut to 2,000 characters, the most a custom column holds.` : '',
    links ? 'You can undo the import.' : 'Choose another column for the addresses, or another destination.',
  ].filter(Boolean).join(' ');
  $('import-commit-label').textContent = links ? `Import ${plural(links, 'link')}` : 'Import links';
  $('import-commit').disabled = !links || view.busy;
}

/* Importing and Undo --------------------------------------------------------------------------- */
function setBusy(value) {
  view.busy = value;
  $('import-commit').disabled = value || !view.plan?.links.length;
  $('import-commit').setAttribute('aria-busy', String(value));
}

function resetList(state) {
  ui.state = state;
  ui.page = 0; ui.batchFilter = '';
  ui.selectedIds.clear(); ui.openDetails.clear(); ui.detailLimits.clear();
}

async function commit() {
  if (view.busy || !view.plan?.links.length) return;
  const home = destination(), name = home ? home.name : newCollectionName();
  const links = view.plan.links.map(({ anchorText, url, originalHref, notes, tags, imported, status, starred, fields }) =>
    ({ anchorText, url, originalHref, notes, tags, imported, ...(status ? { status } : {}), ...(starred ? { starred } : {}), ...(fields ? { fields } : {}) }));
  setBusy(true);
  let result;
  try {
    result = await request({ type: 'import.commit', links, newFields: view.plan.newFields, skipSaved: !!home && $('import-skip-saved').checked,
      ...(home ? { collectionId: home.id } : { newCollection: name }) });
  } finally { setBusy(false); }
  const opener = view.returnFocus;
  closeImport({ focus: false });
  resetList(result.state);
  ui.flashBatch = result.batchId; ui.flashStart = Date.now();
  render();
  const columns = result.fields.length ? ` and added ${plural(result.fields.length, 'custom column')}` : '';
  const already = result.skipped ? ` ${plural(result.skipped, 'more link')} ${result.skipped === 1 ? 'was' : 'were'} already saved there.` : '';
  show(`Imported ${plural(result.count, 'link')} into “${name}”${columns}.${already}`, 'notice', { actionLabel: 'Undo', onAction: () => undoImport({ ...result, name }) });
  (visible(opener) ? opener : $('search')).focus();
}

async function undoImport({ collectionId, batchId, name }) {
  const result = await request({ type: 'import.undo', collectionId, batchId });
  resetList(result.state);
  render();
  const removed = [plural(result.count, 'link'), result.collectionRemoved && `the collection “${name}”`, result.fieldsRemoved && plural(result.fieldsRemoved, 'custom column')].filter(Boolean);
  show(`Import undone: removed ${joined(removed)}.`);
}

/* Binding -------------------------------------------------------------------------------------- */
export function bindImports() {
  $('import-file').addEventListener('change', () => action(chooseFile));
  $('import-paste').addEventListener('click', startPaste);
  $('import-bookmarks').addEventListener('click', startFolder);
  $('import-text').addEventListener('paste', rememberPaste);
  $('import-read-text').addEventListener('click', () => action(readPaste));
  $('import-folder-search').addEventListener('input', renderFolders);
  $('import-folder-search').addEventListener('keydown', (event) => {
    const select = $('import-folder');
    if (event.key === 'ArrowDown' && select.options.length) { event.preventDefault(); select.focus(); }
    if (event.key === 'Enter' && select.options.length === 1) { event.preventDefault(); view.chosen = select.options[0].value; renderFolders(); }
  });
  $('import-folder').addEventListener('change', (event) => { view.chosen = event.target.value; renderFolders(); });
  $('import-read-folder').addEventListener('click', () => action(readFolder));
  $('import-sheet').addEventListener('change', () => action(async () => {
    const run = ++view.run, { source } = view;
    progress(`Reading sheet “${view.table.sheets[Number($('import-sheet').value)]}”…`);
    const table = await readWorkbook(view.table.bytes, Number($('import-sheet').value));
    if (run === view.run) setTable(table, source);
  }));
  $('import-header').addEventListener('change', () => { view.header = $('import-header').checked; remap(); renderAll(); });
  $('import-destination').addEventListener('change', () => { view.destination = $('import-destination').value; remap({ keepStandard: true }); renderDestination(); renderMapping(); plan(); });
  $('import-skip-saved').addEventListener('change', plan);
  $('import-only-skipped').addEventListener('change', renderPlan);
  $('import-commit').addEventListener('click', () => action(commit));
  $('import-cancel').addEventListener('click', cancel);
  onEscape(() => {
    if ($('import').hidden) return false;
    cancel();
    return true;
  });
  // The preview stays true to the saved state: another collection's name, or links saved meanwhile.
  onRender(() => {
    if ($('import').hidden || !view.table || ui.state === view.planned?.state) return;
    renderDestination();
    if (JSON.stringify(destinationFields()) !== view.mapping.fieldsKey) { remap({ keepStandard: true }); renderMapping(); }
    plan();
  });
}
