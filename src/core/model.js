// Pure collection state and non-destructive review views.
const LINK_STRINGS = ['id', 'anchorText', 'accessibleLabel', 'url', 'originalHref', 'sourceUrl', 'sourceTitle', 'frameUrl', 'capturedAt', 'batchId', 'notes'];
const SORTS = new Set(['page', 'anchor', 'url', 'domain', 'newest']);
const DEDUPES = new Set(['none', 'url', 'url-anchor']);
const RELATIONS = new Set(['all', 'internal', 'external']);
let nextId = 0;

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

export function createState() {
  const first = collection('My research');
  return { schemaVersion: 1, activeCollectionId: first.id, collections: [first],
    settings: { holdKey: 'z', holdOrigins: [] }, undo: null };
}

export function reduceState(input, action) {
  const state = validState(input);
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
      for (const [key, value] of Object.entries(action.patch)) {
        if (key === 'holdKey') {
          if (typeof value !== 'string' || !/^[a-z]$/i.test(value)) throw new Error('holdKey must be one alphabetic letter');
          patch.holdKey = value.toLowerCase();
        } else if (key === 'holdOrigins') {
          patch.holdOrigins = [...new Set(stringList(value, 'holdOrigins'))];
          patch.holdOrigins.forEach(origin => httpUrl(origin, 'holdOrigins entry', true));
        } else throw new Error(`Unsupported settings field: ${key}`);
      }
      return { ...state, settings: { ...state.settings, ...patch } };
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
