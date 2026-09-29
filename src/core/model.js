// Pure collection state and non-destructive review views.
import { fileNamePart } from './export.js';
import { THEME_IDS } from './themes.js';
import { typeGroup } from './insights.js';

const LINK_STRINGS = ['id', 'anchorText', 'accessibleLabel', 'url', 'originalHref', 'sourceUrl', 'sourceTitle', 'frameUrl', 'capturedAt', 'batchId', 'notes'];
const SORTS = new Set(['page', 'anchor', 'url', 'domain', 'newest']);
const DEDUPES = new Set(['none', 'url', 'url-anchor']);
const RELATIONS = new Set(['all', 'internal', 'external']);
let nextId = 0;

// Settings are additive schema-v1 fields. A stored v1 state that predates a field loads with its
// default (migrateState), and version 0.2.2 keeps unknown settings fields when it writes, so the
// schema version stays 1. Every new field needs a default here and a check in settingsField.
export const SETTINGS_DEFAULTS = Object.freeze({
  holdKey: 'z',                     // one letter, used while holdTrigger is 'letter'
  holdOrigins: Object.freeze([]),   // HTTP(S) origins where hold-drag runs while holdScope is 'sites'
  holdTrigger: 'letter',            // 'letter', or 'modifier': Command on macOS, Ctrl elsewhere
  holdScope: 'sites',               // 'sites' (holdOrigins only) or 'all' (every HTTP(S) site)
  holdExceptions: Object.freeze([]),// HTTP(S) origins where hold-drag never runs
  welcomeSeen: false,               // the first-run welcome card was answered or dismissed
  exportPrefix: '',                 // optional file-name prefix, already a safe file-name part
  exportTimestamp: true,            // add the export date to default file names
  exportTimestampFormat: 'datetime',// 'datetime' (YYYY-MM-DD_HHmm) or 'date' (YYYY-MM-DD)
  theme: 'meteor',                  // one of THEME_IDS (core/themes.js)
  appearance: 'system',             // 'system', 'light' or 'dark', for the workbench and the page card
  afterDrag: 'card',                // what releasing a drag does: 'card', 'copy' or 'add'
  afterDragFormat: 'tsv',           // the copy format for afterDrag 'copy': 'tsv', 'text', 'markdown' or 'rich'
  contentOnly: false,               // leave out navigation, header, footer and sidebar links
  skipSaved: false,                 // when adding, skip URLs already in the destination collection
  saveContext: true,                // save the words around each link when capturing (0.5.0)
});
const HOLD_TRIGGERS = new Set(['letter', 'modifier']);
const HOLD_SCOPES = new Set(['sites', 'all']);
const TIMESTAMP_FORMATS = new Set(['datetime', 'date']);
const APPEARANCES = new Set(['system', 'light', 'dark']);
const AFTER_DRAG = new Set(['card', 'copy', 'add']);
const AFTER_DRAG_FORMATS = new Set(['tsv', 'text', 'markdown', 'rich']);
export const MAX_HOLD_EXCEPTIONS = 1000;
// Custom columns (0.4.0): per collection, named and filled in by hand, plain text.
export const MAX_CUSTOM_FIELDS = 20, MAX_FIELD_NAME = 60, MAX_FIELD_VALUE = 2000;
const FIELD_ID = /^[a-z0-9][a-z0-9-]{0,80}$/;
export const MAX_EXPORT_PREFIX = 40;
// Research data (0.5.0): optional per-link and per-collection fields; absent means none.
export const MAX_CONTEXT = 400, MAX_IMPORTED = 300, MAX_PAGES = 5000;
const LINK_STATUSES = new Set(['reading', 'read']);
const STATUS_FILTERS = new Set(['any', 'unread', 'reading', 'read']);
// A page citation's text fields and their limits; authors is a list of names as printed.
const PAGE_TEXT = { title: 300, date: 40, journal: 300, publisher: 300, volume: 300, issue: 300, firstPage: 300, lastPage: 300,
  doi: 300, pmid: 300, arxiv: 300, isbn: 300, pdfUrl: 2000, readAt: 40 };
export const MAX_AUTHORS = 50, MAX_AUTHOR = 200;

// Backup files have their own format version, independent of the storage schema.
export const BACKUP_FORMAT = 'link-meteor-backup';
// Format 2 (0.4.0) adds the appearance and capture settings; format 3 (0.5.0) adds context,
// reading status, stars, imported labels and page citations. Formats 1 and 2 still restore.
export const BACKUP_FORMAT_VERSION = 3;
// Backups travel through extension messaging, which carries at most 64 MiB per message.
export const BACKUP_LIMITS = Object.freeze({ bytes: 50 * 1024 * 1024, collections: 10000, links: 250000 });

function id() {
  return `lm-${Date.now().toString(36)}-${(++nextId).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value;
}

function string(value, name, nonempty = false) {
  if (typeof value !== 'string' || (nonempty && !value.trim())) throw new Error(`${name} must be ${nonempty ? 'a nonempty' : 'a'} string`);
  return value;
}

function stringList(value, name) {
  if (!Array.isArray(value) || value.some(x => typeof x !== 'string')) throw new Error(`${name} must be an array of strings`);
  return [...value];
}

function httpUrl(value, name, originOnly = false) {
  string(value, name, true);
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${name} must be an HTTP(S) URL`); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`${name} must be an HTTP(S) URL`);
  if (originOnly && value !== parsed.origin) throw new Error(`${name} must be an HTTP(S) origin`);
  return parsed;
}

function destinationUrl(value) {
  string(value, 'link.url', true);
  if (/\s|[\u0000-\u001f\u007f]/u.test(value)) throw new Error('link.url must not contain whitespace or controls');
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('link.url must be an HTTP(S), mailto, or tel URL'); }
  if (!['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol) ||
      (parsed.protocol === 'tel:' && !parsed.pathname)) {
    throw new Error('link.url must be an HTTP(S), mailto, or tel URL');
  }
}

function link(value) {
  object(value, 'link');
  for (const key of LINK_STRINGS) string(value[key], `link.${key}`, key === 'id');
  destinationUrl(value.url);
  const checked = { ...value, tags: stringList(value.tags, 'link.tags') };
  if (value.fields !== undefined) checked.fields = fieldValues(value.fields);
  return research(checked);
}

/* Research data (0.5.0). A link may hold `context` (the words around it on its page), `status`
   ('reading' or 'read'; absent means unread), `starred: true` and `imported` (where an imported
   link came from). A collection may hold `pages: {pageUrl: PageCitation}`, citation details read
   from pages Link Meteor had open. All optional, so a 0.4.0 state needs no migration. */
function research(item, name = 'link') {
  const kept = { ...item };
  for (const [key, max] of [['context', MAX_CONTEXT], ['imported', MAX_IMPORTED]]) {
    if (kept[key] === undefined) continue;
    if (typeof kept[key] !== 'string') throw new Error(`${name}.${key} must be text`);
    if (kept[key].length > max) throw new Error(`${name}.${key} can be at most ${max} characters`);
    if (!kept[key]) delete kept[key];
  }
  if (kept.status !== undefined && !LINK_STATUSES.has(kept.status)) throw new Error(`${name}.status must be 'reading' or 'read'`);
  if (kept.starred !== undefined) {
    if (typeof kept.starred !== 'boolean') throw new Error(`${name}.starred must be true or false`);
    if (!kept.starred) delete kept.starred;
  }
  return kept;
}

// A page's address without its fragment: the key for its citation.
export function pageKey(url) {
  try { const parsed = new URL(url); parsed.hash = ''; return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : ''; } catch { return ''; }
}

function pageCitation(value, name = 'page citation') {
  object(value, name);
  const kept = {};
  for (const [key, text] of Object.entries(value)) {
    if (key === 'authors') {
      const authors = stringList(text, `${name}.authors`).map(author => author.trim().replace(/\s+/gu, ' ')).filter(Boolean);
      if (authors.length > MAX_AUTHORS) throw new Error(`${name} can list at most ${MAX_AUTHORS} authors`);
      if (authors.some(author => author.length > MAX_AUTHOR)) throw new Error(`An author's name can be at most ${MAX_AUTHOR} characters`);
      if (authors.length) kept.authors = authors;
      continue;
    }
    if (!(key in PAGE_TEXT)) throw new Error(`Unsupported ${name} field: ${key}`);
    if (typeof text !== 'string') throw new Error(`${name}.${key} must be text`);
    const clean = text.trim().replace(/\s+/gu, ' ');
    if (clean.length > PAGE_TEXT[key]) throw new Error(`${name}.${key} can be at most ${PAGE_TEXT[key]} characters`);
    if (clean) kept[key] = clean;
  }
  return kept;
}

function pagesMap(value, name = 'collection.pages') {
  if (value === undefined) return {};
  object(value, name);
  const entries = Object.entries(value);
  if (entries.length > MAX_PAGES) throw new Error(`A collection can keep citation details for at most ${MAX_PAGES.toLocaleString('en-US')} pages`);
  const kept = {};
  for (const [url, citation] of entries) {
    if (!url || pageKey(url) !== url) throw new Error(`${name} has an invalid page address: ${url}`);
    kept[url] = pageCitation(citation, `${name} entry`);
  }
  return kept;
}

// Merges newer page citations into older ones (a newer reading of the same address replaces it)
// and keeps at most MAX_PAGES, dropping the oldest readings first.
function mergePages(older, newer) {
  const merged = { ...older };
  for (const [url, citation] of Object.entries(newer)) { delete merged[url]; merged[url] = citation; }
  const entries = Object.entries(merged);
  if (entries.length <= MAX_PAGES) return merged;
  entries.sort(([, a], [, b]) => String(a.readAt || '').localeCompare(String(b.readAt || '')));
  return Object.fromEntries(entries.slice(entries.length - MAX_PAGES));
}
function withPages(item, pages) {
  const { pages: _old, ...rest } = item;
  return Object.keys(pages).length ? { ...rest, pages } : rest;
}

/* Custom columns (0.4.0). A collection may list `fields: [{id, name}]`, and each of its links may
   hold `fields: {fieldId: text}`. Both are optional (absent means none), so a 0.3.0 state needs no
   migration, and 0.3.0 keeps both when it writes because it keeps unknown fields. Values for a
   column that no longer exists are ignored, never an error. */
function fieldName(value, name) {
  const text = string(value, name, true).trim().replace(/\s+/gu, ' ');
  if (text.length > MAX_FIELD_NAME) throw new Error(`${name} can be at most ${MAX_FIELD_NAME} characters`);
  return text;
}
function fieldDefs(value, name = 'collection.fields') {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  if (value.length > MAX_CUSTOM_FIELDS) throw new Error(`A collection can have at most ${MAX_CUSTOM_FIELDS} custom columns`);
  const ids = new Set(), names = new Set();
  return value.map((field, i) => {
    object(field, `${name} entry`);
    const fieldId = string(field.id, `${name} id`, true), label = fieldName(field.name, `${name} name`);
    if (!FIELD_ID.test(fieldId)) throw new Error(`${name} id ${fieldId} is not a valid column id`);
    if (ids.has(fieldId)) throw new Error(`${name} lists column ${fieldId} twice`);
    if (names.has(label.toLowerCase())) throw new Error(`Two custom columns are named “${label}”`);
    ids.add(fieldId); names.add(label.toLowerCase());
    return { id: fieldId, name: label };
  });
}
// A link's custom values: only column ids as keys, only text up to MAX_FIELD_VALUE; empty values are dropped.
function fieldValues(value, name = 'link.fields') {
  object(value, name);
  const kept = {};
  for (const [key, text] of Object.entries(value)) {
    if (!FIELD_ID.test(key)) throw new Error(`${name} has an invalid column id: ${key}`);
    if (typeof text !== 'string') throw new Error(`${name}.${key} must be text`);
    if (text.length > MAX_FIELD_VALUE) throw new Error(`A custom value can be at most ${MAX_FIELD_VALUE.toLocaleString('en-US')} characters`);
    if (text) kept[key] = text;
  }
  if (Object.keys(kept).length > MAX_CUSTOM_FIELDS) throw new Error(`${name} has more than ${MAX_CUSTOM_FIELDS} values`);
  return kept;
}
function withFields(item, fields) {
  const { fields: _old, ...rest } = item;
  return Object.keys(fields).length ? { ...rest, fields } : rest;
}

function collection(name) {
  const now = new Date().toISOString();
  return { id: id(), name: string(name, 'name', true), notes: '', tags: [], createdAt: now, updatedAt: now, links: [] };
}

function validState(state) {
  object(state, 'state');
  if (state.schemaVersion !== 1 || !Array.isArray(state.collections) || !state.collections.length ||
      !state.collections.some(c => c.id === state.activeCollectionId)) throw new Error('Invalid version 1 state or active collection');
  for (const current of state.collections) {
    object(current, 'collection');
    for (const key of ['id', 'name', 'notes', 'createdAt', 'updatedAt']) string(current[key], `collection.${key}`);
    stringList(current.tags, 'collection.tags');
    if (!Array.isArray(current.links)) throw new Error('collection.links must be an array');
    fieldDefs(current.fields);
    pagesMap(current.pages);
    for (const item of current.links) {
      object(item, 'link');
      for (const key of LINK_STRINGS) string(item[key], `link.${key}`);
      stringList(item.tags, 'link.tags');
      if (item.fields !== undefined) fieldValues(item.fields);
      research(item);
    }
  }
  object(state.settings, 'settings');
  if (typeof state.settings.holdKey !== 'string' || !/^[a-z]$/i.test(state.settings.holdKey)) throw new Error('Invalid settings.holdKey');
  stringList(state.settings.holdOrigins, 'settings.holdOrigins');
  for (const key of Object.keys(SETTINGS_DEFAULTS)) {
    if (key !== 'holdKey' && key !== 'holdOrigins') settingsField(key, state.settings[key], `settings.${key}`);
  }
  disjointSites(state.settings);
  if (state.undo !== null) {
    object(state.undo, 'undo');
    string(state.undo.collectionId, 'undo.collectionId', true);
    if (!Array.isArray(state.undo.links) || !Array.isArray(state.undo.indices) || state.undo.links.length !== state.undo.indices.length) throw new Error('Invalid undo snapshot');
  }
  return state;
}

function target(state, collectionId) {
  const id = collectionId ?? state.activeCollectionId;
  const index = state.collections.findIndex(c => c.id === id);
  if (index < 0) throw new Error(`Collection not found: ${id}`);
  return { index, collection: state.collections[index] };
}

function replaceCollection(state, index, updated, undo = state.undo) {
  const collections = [...state.collections];
  collections[index] = { ...updated, updatedAt: new Date().toISOString() };
  return { ...state, collections, undo };
}

function patchFields(patch, allowed, name) {
  object(patch, name);
  const result = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.includes(key)) throw new Error(`Unsupported ${name} field: ${key}`);
    result[key] = key === 'tags' ? stringList(value, `${name}.tags`) : string(value, `${name}.${key}`, key === 'name');
  }
  return result;
}

function origins(value, name, max = Infinity) {
  const list = [...new Set(stringList(value, name))];
  list.forEach(origin => httpUrl(origin, `${name} entry`, true));
  if (list.length > max) throw new Error(`${name} can list at most ${max} sites`);
  return list;
}

// Validates one settings value and returns it in stored form.
function settingsField(key, value, name = key) {
  switch (key) {
    case 'holdKey':
      if (typeof value !== 'string' || !/^[a-z]$/i.test(value)) throw new Error('holdKey must be one alphabetic letter');
      return value.toLowerCase();
    case 'holdOrigins': return origins(value, name);
    case 'holdExceptions': return origins(value, name, MAX_HOLD_EXCEPTIONS);
    case 'holdTrigger':
      if (!HOLD_TRIGGERS.has(value)) throw new Error(`${name} must be 'letter' or 'modifier'`);
      return value;
    case 'holdScope':
      if (!HOLD_SCOPES.has(value)) throw new Error(`${name} must be 'sites' or 'all'`);
      return value;
    case 'welcomeSeen': case 'exportTimestamp': case 'contentOnly': case 'skipSaved': case 'saveContext':
      if (typeof value !== 'boolean') throw new Error(`${name} must be true or false`);
      return value;
    case 'exportPrefix':
      if (typeof value !== 'string' || value.length > MAX_EXPORT_PREFIX || fileNamePart(value, MAX_EXPORT_PREFIX) !== value) {
        throw new Error(`${name} must be at most ${MAX_EXPORT_PREFIX} letters, digits, dots, underscores or hyphens, without a leading or trailing dot or hyphen`);
      }
      return value;
    case 'exportTimestampFormat':
      if (!TIMESTAMP_FORMATS.has(value)) throw new Error(`${name} must be 'datetime' or 'date'`);
      return value;
    case 'theme':
      if (!THEME_IDS.includes(value)) throw new Error(`${name} must be one of ${THEME_IDS.join(', ')}`);
      return value;
    case 'appearance':
      if (!APPEARANCES.has(value)) throw new Error(`${name} must be 'system', 'light' or 'dark'`);
      return value;
    case 'afterDrag':
      if (!AFTER_DRAG.has(value)) throw new Error(`${name} must be 'card', 'copy' or 'add'`);
      return value;
    case 'afterDragFormat':
      if (!AFTER_DRAG_FORMATS.has(value)) throw new Error(`${name} must be 'tsv', 'text', 'markdown' or 'rich'`);
      return value;
    default: throw new Error(`Unsupported settings field: ${key}`);
  }
}

// A site is either a hold-drag site or an exception, never both.
function disjointSites(settings) {
  const exceptions = new Set(settings.holdExceptions);
  const both = settings.holdOrigins.find(origin => exceptions.has(origin));
  if (both) throw new Error(`${both} cannot be both a hold-drag site and an exception`);
}

function defaultSettings() {
  return { ...SETTINGS_DEFAULTS, holdOrigins: [], holdExceptions: [] };
}

// Brings a stored schema-v1 state up to the current settings fields. Only absent fields receive
// defaults: collections, links, the undo snapshot and every present value are kept exactly, and
// an up-to-date state is returned as the same object. Validation happens in reduceState.
export function migrateState(input) {
  object(input, 'state');
  if (input.schemaVersion !== 1) throw new Error('Invalid version 1 state or active collection');
  if (!input.settings || typeof input.settings !== 'object' || Array.isArray(input.settings)) return input;
  const missing = Object.keys(SETTINGS_DEFAULTS).filter(key => !(key in input.settings));
  if (!missing.length) return input;
  const defaults = defaultSettings();
  const settings = { ...input.settings };
  for (const key of missing) settings[key] = defaults[key];
  return { ...input, settings };
}

export function createState() {
  const first = collection('My research');
  return { schemaVersion: 1, activeCollectionId: first.id, collections: [first],
    settings: defaultSettings(), undo: null };
}

export function reduceState(input, action) {
  const state = validState(migrateState(input));
  object(action, 'action');
  switch (action.type) {
    case 'collection.create': {
      const created = collection(action.name);
      return { ...state, activeCollectionId: created.id, collections: [...state.collections, created] };
    }
    case 'collection.activate': {
      string(action.id, 'collection id', true);
      target(state, action.id);
      return { ...state, activeCollectionId: action.id };
    }
    case 'collection.update': {
      const { index, collection: current } = target(state, action.id);
      return replaceCollection(state, index, { ...current, ...patchFields(action.patch, ['name', 'notes', 'tags'], 'collection patch') });
    }
    case 'collection.delete': {
      const { index } = target(state, action.id);
      const collections = state.collections.filter((_, i) => i !== index);
      if (!collections.length) collections.push(collection('My research'));
      return { ...state, collections, activeCollectionId: state.activeCollectionId === action.id ? collections[0].id : state.activeCollectionId,
        undo: state.undo?.collectionId === action.id ? null : state.undo };
    }
    case 'links.append': {
      const { index, collection: current } = target(state, action.collectionId);
      if (!Array.isArray(action.links)) throw new Error('links must be an array');
      const existing = new Set([...state.collections.flatMap(c => c.links.map(x => x.id)),
        ...(state.undo?.links.map(x => x.id) || [])]);
      const appended = [];
      for (const raw of action.links) {
        const item = link(raw);
        if (existing.has(item.id)) continue;
        existing.add(item.id);
        appended.push(item);
      }
      // Citation details read from the pages involved (0.5.0) come with the links, if any.
      const pages = action.pages === undefined ? null : pagesMap(action.pages, 'pages');
      if (!appended.length && !(pages && Object.keys(pages).length)) return state;
      const updated = { ...current, links: [...current.links, ...appended] };
      return replaceCollection(state, index, pages && Object.keys(pages).length ? withPages(updated, mergePages(pagesMap(current.pages), pages)) : updated);
    }
    // Reading status and stars (0.5.0), for many links at once. The workbench keeps the earlier
    // values for Undo and sends one action per earlier value.
    case 'links.status': case 'links.star': {
      const { index, collection: current } = target(state, action.collectionId);
      const ids = new Set(stringList(action.ids, 'ids'));
      let apply;
      if (action.type === 'links.status') {
        if (action.status !== '' && !LINK_STATUSES.has(action.status)) throw new Error("status must be '', 'reading' or 'read'");
        apply = ({ status: _old, ...rest }) => (action.status ? { ...rest, status: action.status } : rest);
      } else {
        if (typeof action.starred !== 'boolean') throw new Error('starred must be true or false');
        apply = ({ starred: _old, ...rest }) => (action.starred ? { ...rest, starred: true } : rest);
      }
      let changed = false;
      const links = current.links.map(item => { if (!ids.has(item.id)) return item; changed = true; return apply(item); });
      return changed ? replaceCollection(state, index, { ...current, links }) : state;
    }
    case 'links.remove': {
      const { index, collection: current } = target(state, action.collectionId);
      const ids = new Set(stringList(action.ids, 'ids'));
      const removed = []; const indices = []; const links = [];
      current.links.forEach((item, i) => {
        if (ids.has(item.id)) { removed.push(item); indices.push(i); } else links.push(item);
      });
      if (!removed.length) return state;
      return replaceCollection(state, index, { ...current, links }, { collectionId: current.id, links: removed, indices });
    }
    case 'links.undo': {
      if (!state.undo) return state;
      const { collectionId, links: removed, indices } = state.undo;
      const { index, collection: current } = target(state, collectionId);
      const links = [...current.links];
      indices.forEach((position, i) => links.splice(position, 0, removed[i]));
      return replaceCollection(state, index, { ...current, links }, null);
    }
    case 'link.update': {
      const { index, collection: current } = target(state, action.collectionId);
      const position = current.links.findIndex(x => x.id === action.id);
      if (position < 0) throw new Error(`Link not found: ${action.id}`);
      const links = [...current.links];
      object(action.patch, 'link patch');
      const { fields: fieldPatch, ...rest } = action.patch;
      let updated = { ...links[position], ...patchFields(rest, ['notes', 'tags'], 'link patch') };
      if (fieldPatch !== undefined) {
        const known = new Set(fieldDefs(current.fields).map(field => field.id));
        object(fieldPatch, 'link patch fields');
        for (const key of Object.keys(fieldPatch)) if (!known.has(key)) throw new Error(`No custom column ${key} in this collection`);
        updated = withFields(updated, fieldValues({ ...(updated.fields || {}), ...fieldPatch }));
      }
      links[position] = updated;
      return replaceCollection(state, index, { ...current, links });
    }
    // Custom columns: add, rename, remove (values too), restore (Undo of a remove) and fill many.
    case 'fields.add': {
      const { index, collection: current } = target(state, action.collectionId);
      const fields = fieldDefs(current.fields);
      if (fields.length >= MAX_CUSTOM_FIELDS) throw new Error(`A collection can have at most ${MAX_CUSTOM_FIELDS} custom columns`);
      return replaceCollection(state, index, { ...current, fields: fieldDefs([...fields, { id: `f-${id()}`, name: action.name }]) });
    }
    case 'fields.rename': {
      const { index, collection: current } = target(state, action.collectionId);
      const fields = fieldDefs(current.fields);
      if (!fields.some(field => field.id === action.fieldId)) throw new Error(`No custom column ${action.fieldId} in this collection`);
      return replaceCollection(state, index, { ...current, fields: fieldDefs(fields.map(field => field.id === action.fieldId ? { ...field, name: action.name } : field)) });
    }
    case 'fields.remove': {
      const { index, collection: current } = target(state, action.collectionId);
      const fields = fieldDefs(current.fields);
      if (!fields.some(field => field.id === action.fieldId)) return state;
      const links = current.links.map(item => {
        if (!item.fields || !(action.fieldId in item.fields)) return item;
        const { [action.fieldId]: _gone, ...others } = item.fields;
        return withFields(item, others);
      });
      return replaceCollection(state, index, { ...current, fields: fields.filter(field => field.id !== action.fieldId), links });
    }
    case 'fields.restore': {
      const { index, collection: current } = target(state, action.collectionId);
      const fields = fieldDefs(current.fields);
      const [field] = fieldDefs([action.field], 'restored column');
      if (fields.some(item => item.id === field.id)) return state;
      const at = Math.max(0, Math.min(fields.length, Number.isInteger(action.index) ? action.index : fields.length));
      // values: {linkId: text}, the removed column's values; each goes back through the usual checks.
      const restored = object(action.values || {}, 'restored values');
      const links = current.links.map(item => typeof restored[item.id] === 'string' && restored[item.id]
        ? withFields(item, fieldValues({ ...(item.fields || {}), [field.id]: restored[item.id] })) : item);
      return replaceCollection(state, index, { ...current, fields: fieldDefs([...fields.slice(0, at), field, ...fields.slice(at)]), links });
    }
    case 'fields.fill': {
      const { index, collection: current } = target(state, action.collectionId);
      if (!fieldDefs(current.fields).some(field => field.id === action.fieldId)) throw new Error(`No custom column ${action.fieldId} in this collection`);
      const ids = new Set(stringList(action.ids, 'ids'));
      const value = string(action.value, 'value');
      if (value.length > MAX_FIELD_VALUE) throw new Error(`A custom value can be at most ${MAX_FIELD_VALUE.toLocaleString('en-US')} characters`);
      const links = current.links.map(item => ids.has(item.id) ? withFields(item, fieldValues({ ...(item.fields || {}), [action.fieldId]: value })) : item);
      return replaceCollection(state, index, { ...current, links });
    }
    case 'settings.update': {
      object(action.patch, 'settings patch');
      const patch = {};
      for (const [key, value] of Object.entries(action.patch)) patch[key] = settingsField(key, value);
      const settings = { ...state.settings, ...patch };
      disjointSites(settings);
      return { ...state, settings };
    }
    case 'backup.restore': {
      if (action.mode !== 'merge' && action.mode !== 'replace') throw new Error("Restore mode must be 'merge' or 'replace'");
      return planRestore(state, action.backup, action.mode).state;
    }
    default: throw new Error(`Unknown action type: ${action.type}`);
  }
}

function hostname(value) {
  try { return new URL(value).hostname.toLowerCase(); } catch { return ''; }
}

export function queryLinks(links, options = {}) {
  if (!Array.isArray(links)) throw new Error('links must be an array');
  object(options, 'options');
  const { search = '', domain = '', fileType = '', relation = 'all', sort = 'page', direction = 'asc', dedupe = 'none', status = 'any', starred = false, typeGroup: group = '' } = options;
  if (!STATUS_FILTERS.has(status)) throw new Error(`Invalid status: ${status}`);
  if (typeof starred !== 'boolean') throw new Error('starred must be true or false');
  if (!SORTS.has(sort)) throw new Error(`Invalid sort: ${sort}`);
  if (!DEDUPES.has(dedupe)) throw new Error(`Invalid dedupe: ${dedupe}`);
  if (!RELATIONS.has(relation)) throw new Error(`Invalid relation: ${relation}`);
  if (!['asc', 'desc'].includes(direction)) throw new Error(`Invalid direction: ${direction}`);
  for (const [key, value] of Object.entries({ search, domain, fileType, typeGroup: group })) string(value, key);
  const term = search.toLowerCase();
  const hostTerm = domain.toLowerCase();
  const extension = fileType.toLowerCase().replace(/^\./, '');
  const matched = links.filter(item => {
    const host = hostname(item.url);
    if (term && ![item.anchorText, item.url, item.sourceTitle, item.sourceUrl, item.notes, ...(item.tags || []), ...Object.values(item.fields || {}), item.context || '', item.imported || '']
      .some(value => String(value).toLowerCase().includes(term))) return false;
    if (status !== 'any' && (item.status || 'unread') !== status) return false;
    if (starred && item.starred !== true) return false;
    if (group && typeGroup(item) !== group) return false;
    if (hostTerm && !host.includes(hostTerm)) return false;
    if (extension) {
      let path;
      try { path = new URL(item.url).pathname.toLowerCase(); } catch { return false; }
      if (!path.endsWith(`.${extension}`)) return false;
    }
    const sourceHost = hostname(item.sourceUrl);
    if (relation !== 'all' && (!host || !sourceHost || (relation === 'internal') !== (host === sourceHost))) return false;
    return true;
  });
  const sorted = [...matched];
  if (sort !== 'page') {
    const key = item => ({ anchor: item.anchorText, url: item.url, domain: hostname(item.url), newest: item.capturedAt })[sort].toLowerCase();
    sorted.sort((a, b) => key(a).localeCompare(key(b)) * (direction === 'desc' ? -1 : 1));
  } else if (direction === 'desc') sorted.reverse();
  const groups = new Map();
  const rows = [];
  sorted.forEach(item => {
    const key = dedupe === 'none' ? Symbol() : dedupe === 'url' ? item.url : `${item.url}\u0000${item.anchorText}`;
    let row = groups.get(key);
    if (!row) {
      row = { ...item, occurrences: [], occurrenceIds: [] };
      groups.set(key, row);
      rows.push(row);
    }
    row.occurrences.push(item);
    row.occurrenceIds.push(item.id);
  });
  return { rows, matchedCount: matched.length, occurrenceCount: links.length };
}

/* Backup files ------------------------------------------------------------------------------
   A backup is UTF-8 JSON:
   {format:'link-meteor-backup', formatVersion:3, createdAt, extensionVersion,
    state:{schemaVersion:1, activeCollectionId, collections, settings}}
   The removal undo snapshot is not included. Readers keep only contract fields, so a release
   that adds stored fields must raise BACKUP_FORMAT_VERSION: older releases then refuse the
   file with an update message instead of silently dropping data. */

function backupLink(value, columns = new Set()) {
  const checked = link(value);
  const kept = {};
  for (const key of LINK_STRINGS) kept[key] = checked[key];
  kept.tags = checked.tags;
  // Custom values are kept only for the collection's own columns.
  const fields = Object.fromEntries(Object.entries(checked.fields || {}).filter(([key]) => columns.has(key)));
  if (Object.keys(fields).length) kept.fields = fields;
  for (const key of ['context', 'status', 'starred', 'imported']) if (checked[key] !== undefined) kept[key] = checked[key];
  return kept;
}

function backupCollection(value, index, collectionIds, linkIds) {
  object(value, `backup collection ${index + 1}`);
  const kept = { id: string(value.id, 'collection.id', true), name: string(value.name, 'collection.name', true),
    notes: string(value.notes, 'collection.notes'), tags: stringList(value.tags, 'collection.tags'),
    createdAt: string(value.createdAt, 'collection.createdAt'), updatedAt: string(value.updatedAt, 'collection.updatedAt') };
  if (collectionIds.has(kept.id)) throw new Error(`The backup lists collection ${kept.id} twice`);
  collectionIds.add(kept.id);
  if (!Array.isArray(value.links)) throw new Error('collection.links must be an array');
  const fields = fieldDefs(value.fields);
  if (fields.length) kept.fields = fields;
  const columns = new Set(fields.map(field => field.id));
  kept.links = value.links.map(item => {
    const checked = backupLink(item, columns);
    if (linkIds.has(checked.id)) throw new Error(`The backup lists link ${checked.id} twice`);
    linkIds.add(checked.id);
    return checked;
  });
  // Page citations are kept only for pages a link refers to: its own address or its source page.
  const used = new Set(kept.links.flatMap(item => [pageKey(item.url), pageKey(item.sourceUrl)]));
  const pages = Object.fromEntries(Object.entries(pagesMap(value.pages)).filter(([url]) => used.has(url)));
  if (Object.keys(pages).length) kept.pages = pages;
  return kept;
}

function backupSettings(value) {
  object(value, 'backup settings');
  const settings = defaultSettings();
  for (const key of Object.keys(SETTINGS_DEFAULTS)) {
    if (key in value) settings[key] = settingsField(key, value[key], `backup settings.${key}`);
  }
  disjointSites(settings);
  return settings;
}

// Validates a backup file's text or parsed value and returns it in the current format, with
// every collection, link and setting checked as untrusted input. Throws a readable Error.
export function readBackup(input) {
  let value = input;
  if (typeof input === 'string') {
    if (input.length > BACKUP_LIMITS.bytes) throw new Error(`This backup is larger than ${BACKUP_LIMITS.bytes / 1024 / 1024} MB, the most Link Meteor can restore at once.`);
    try { value = JSON.parse(input); } catch { throw new Error('This file is not a Link Meteor backup: it is not valid JSON.'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.format !== BACKUP_FORMAT) {
    throw new Error('This file is not a Link Meteor backup.');
  }
  if (!Number.isInteger(value.formatVersion) || value.formatVersion < 1) throw new Error('This backup has an unknown format version.');
  if (value.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new Error(`This backup was made by a newer version of Link Meteor (backup format ${value.formatVersion}). Update Link Meteor, then restore it.`);
  }
  const createdAt = string(value.createdAt, 'backup.createdAt');
  const extensionVersion = string(value.extensionVersion, 'backup.extensionVersion');
  const source = object(value.state, 'backup.state');
  if (source.schemaVersion !== 1) throw new Error('backup.state must be schema version 1');
  if (!Array.isArray(source.collections) || !source.collections.length) throw new Error('backup.state.collections must be a nonempty array');
  if (source.collections.length > BACKUP_LIMITS.collections) throw new Error(`A backup can hold at most ${BACKUP_LIMITS.collections.toLocaleString('en-US')} collections.`);
  const linkCount = source.collections.reduce((n, item) => n + (Array.isArray(item?.links) ? item.links.length : 0), 0);
  if (linkCount > BACKUP_LIMITS.links) throw new Error(`A backup can hold at most ${BACKUP_LIMITS.links.toLocaleString('en-US')} links.`);
  const collectionIds = new Set(), linkIds = new Set();
  const collections = source.collections.map((item, index) => backupCollection(item, index, collectionIds, linkIds));
  if (!collectionIds.has(source.activeCollectionId)) throw new Error('backup.state.activeCollectionId must name one of its collections');
  return { format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, createdAt, extensionVersion,
    state: { schemaVersion: 1, activeCollectionId: source.activeCollectionId, collections, settings: backupSettings(source.settings) } };
}

// Builds a backup of every collection and setting. It is read back before it is returned, so a
// state that could not be restored fails here rather than producing an unusable file.
export function createBackup(input, { createdAt = new Date().toISOString(), extensionVersion = '' } = {}) {
  const state = validState(migrateState(input));
  return readBackup({ format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, createdAt, extensionVersion,
    state: { schemaVersion: 1, activeCollectionId: state.activeCollectionId, collections: state.collections, settings: state.settings } });
}

function nameKey(name) { return name.trim().normalize('NFC'); }

function changedSettings(before, after) {
  return Object.keys(SETTINGS_DEFAULTS).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

// Computes a restore without saving it, for the preview and for the backup.restore action.
// merge: backup collections join the one with the same ID, else the first with the same name,
//   else are added. Links whose occurrence ID is already saved (or held for Undo) are skipped,
//   so restoring the same backup twice adds nothing. Local names, notes, active collection,
//   removal undo and single-value settings are kept; tags and site lists are combined, and a
//   site that is local on one list is not added to the other.
// replace: the backup's collections, active collection and settings replace local ones and the
//   removal undo snapshot is cleared. welcomeSeen stays true if either side has it.
export function planRestore(input, backupInput, mode) {
  const state = validState(migrateState(input));
  const backup = readBackup(backupInput);
  const incoming = backup.state;
  const localLinks = state.collections.reduce((n, item) => n + item.links.length, 0);
  const summary = { mode, backupCreatedAt: backup.createdAt, backupExtensionVersion: backup.extensionVersion,
    collectionsInBackup: incoming.collections.length, linksInBackup: incoming.collections.reduce((n, item) => n + item.links.length, 0),
    collectionsAdded: 0, collectionsMatched: 0, linksAdded: 0, linksSkipped: 0, collectionsRemoved: 0, linksRemoved: 0, settingsChanged: [] };
  if (mode === 'replace') {
    const settings = { ...incoming.settings, welcomeSeen: state.settings.welcomeSeen || incoming.settings.welcomeSeen };
    const next = { schemaVersion: 1, activeCollectionId: incoming.activeCollectionId, collections: incoming.collections, settings, undo: null };
    Object.assign(summary, { collectionsAdded: incoming.collections.length, linksAdded: summary.linksInBackup,
      collectionsRemoved: state.collections.length, linksRemoved: localLinks, settingsChanged: changedSettings(state.settings, settings) });
    return { state: validState(next), summary };
  }
  if (mode !== 'merge') throw new Error("Restore mode must be 'merge' or 'replace'");
  const collections = [...state.collections];
  const known = new Set([...state.collections.flatMap(item => item.links.map(x => x.id)), ...(state.undo?.links.map(x => x.id) || [])]);
  const byId = new Map(collections.map((item, index) => [item.id, index]));
  const byName = new Map();
  collections.forEach((item, index) => { if (!byName.has(nameKey(item.name))) byName.set(nameKey(item.name), index); });
  const now = new Date().toISOString();
  for (const source of incoming.collections) {
    const fresh = source.links.filter(item => !known.has(item.id));
    fresh.forEach(item => known.add(item.id));
    summary.linksAdded += fresh.length;
    summary.linksSkipped += source.links.length - fresh.length;
    const at = byId.get(source.id) ?? byName.get(nameKey(source.name));
    if (at === undefined) {
      collections.push({ ...source, links: fresh });
      byId.set(source.id, collections.length - 1);
      if (!byName.has(nameKey(source.name))) byName.set(nameKey(source.name), collections.length - 1);
      summary.collectionsAdded++;
      continue;
    }
    summary.collectionsMatched++;
    const current = collections[at];
    const tags = [...new Set([...current.tags, ...source.tags])];
    const notes = current.notes.trim() ? current.notes : source.notes;
    // Custom columns join by name (ignoring case); a backup column with no match is added while
    // there is room. The fresh links' values follow their column to its local id.
    const fields = fieldDefs(current.fields), remap = new Map();
    for (const column of source.fields || []) {
      const match = fields.find(field => field.name.toLowerCase() === column.name.toLowerCase());
      if (match) remap.set(column.id, match.id);
      else if (fields.length < MAX_CUSTOM_FIELDS) { const added = { id: fields.some(field => field.id === column.id) ? `f-${id()}` : column.id, name: column.name }; fields.push(added); remap.set(column.id, added.id); summary.fieldsAdded = (summary.fieldsAdded || 0) + 1; }
      else summary.fieldsDropped = (summary.fieldsDropped || 0) + 1;
    }
    const joined = fresh.map(item => item.fields ? withFields(item, Object.fromEntries(Object.entries(item.fields).filter(([key]) => remap.has(key)).map(([key, text]) => [remap.get(key), text]))) : item);
    const fieldsChanged = fields.length !== fieldDefs(current.fields).length;
    // Page citations join too; a page already known here keeps its local reading.
    const localPages = pagesMap(current.pages), pages = mergePages(source.pages || {}, localPages);
    const pagesChanged = Object.keys(pages).length !== Object.keys(localPages).length;
    if (fresh.length || notes !== current.notes || tags.length !== current.tags.length || fieldsChanged || pagesChanged) {
      collections[at] = withPages({ ...current, notes, tags, ...(fields.length ? { fields } : {}), links: [...current.links, ...joined], updatedAt: now }, pages);
    }
  }
  const local = state.settings;
  const holdOrigins = [...local.holdOrigins, ...incoming.settings.holdOrigins.filter(origin => !local.holdOrigins.includes(origin) && !local.holdExceptions.includes(origin))];
  const holdExceptions = [...local.holdExceptions, ...incoming.settings.holdExceptions.filter(origin => !local.holdExceptions.includes(origin) && !holdOrigins.includes(origin))];
  const settings = { ...local, holdOrigins, holdExceptions };
  summary.settingsChanged = changedSettings(local, settings);
  return { state: validState({ ...state, collections, settings }), summary };
}
