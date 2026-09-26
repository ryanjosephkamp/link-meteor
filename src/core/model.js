// Pure collection state and non-destructive review views.
import { fileNamePart } from './export.js';

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
});
const HOLD_TRIGGERS = new Set(['letter', 'modifier']);
const HOLD_SCOPES = new Set(['sites', 'all']);
const TIMESTAMP_FORMATS = new Set(['datetime', 'date']);
export const MAX_HOLD_EXCEPTIONS = 1000;
export const MAX_EXPORT_PREFIX = 40;

// Backup files have their own format version, independent of the storage schema.
export const BACKUP_FORMAT = 'link-meteor-backup';
export const BACKUP_FORMAT_VERSION = 1;
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
  return { ...value, tags: stringList(value.tags, 'link.tags') };
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
    for (const item of current.links) {
      object(item, 'link');
      for (const key of LINK_STRINGS) string(item[key], `link.${key}`);
      stringList(item.tags, 'link.tags');
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
    case 'welcomeSeen': case 'exportTimestamp':
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
      if (!appended.length) return state;
      return replaceCollection(state, index, { ...current, links: [...current.links, ...appended] });
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
      links[position] = { ...links[position], ...patchFields(action.patch, ['notes', 'tags'], 'link patch') };
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
  const { search = '', domain = '', fileType = '', relation = 'all', sort = 'page', direction = 'asc', dedupe = 'none' } = options;
  if (!SORTS.has(sort)) throw new Error(`Invalid sort: ${sort}`);
  if (!DEDUPES.has(dedupe)) throw new Error(`Invalid dedupe: ${dedupe}`);
  if (!RELATIONS.has(relation)) throw new Error(`Invalid relation: ${relation}`);
  if (!['asc', 'desc'].includes(direction)) throw new Error(`Invalid direction: ${direction}`);
  for (const [key, value] of Object.entries({ search, domain, fileType })) string(value, key);
  const term = search.toLowerCase();
  const hostTerm = domain.toLowerCase();
  const extension = fileType.toLowerCase().replace(/^\./, '');
  const matched = links.filter(item => {
    const host = hostname(item.url);
    if (term && ![item.anchorText, item.url, item.sourceTitle, item.sourceUrl, item.notes, ...(item.tags || [])]
      .some(value => String(value).toLowerCase().includes(term))) return false;
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
   {format:'link-meteor-backup', formatVersion:1, createdAt, extensionVersion,
    state:{schemaVersion:1, activeCollectionId, collections, settings}}
   The removal undo snapshot is not included. Readers keep only contract fields, so a release
   that adds stored fields must raise BACKUP_FORMAT_VERSION: older releases then refuse the
   file with an update message instead of silently dropping data. */

function backupLink(value) {
  const checked = link(value);
  const kept = {};
  for (const key of LINK_STRINGS) kept[key] = checked[key];
  kept.tags = checked.tags;
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
  kept.links = value.links.map(item => {
    const checked = backupLink(item);
    if (linkIds.has(checked.id)) throw new Error(`The backup lists link ${checked.id} twice`);
    linkIds.add(checked.id);
    return checked;
  });
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
    if (fresh.length || notes !== current.notes || tags.length !== current.tags.length) {
      collections[at] = { ...current, notes, tags, links: [...current.links, ...fresh], updatedAt: now };
    }
  }
  const local = state.settings;
  const holdOrigins = [...local.holdOrigins, ...incoming.settings.holdOrigins.filter(origin => !local.holdOrigins.includes(origin) && !local.holdExceptions.includes(origin))];
  const holdExceptions = [...local.holdExceptions, ...incoming.settings.holdExceptions.filter(origin => !local.holdExceptions.includes(origin) && !holdOrigins.includes(origin))];
  const settings = { ...local, holdOrigins, holdExceptions };
  summary.settingsChanged = changedSettings(local, settings);
  return { state: validState({ ...state, collections, settings }), summary };
}
