// Imports (0.5.0): saving a planned import as one batch, and its Undo. The workbench reads files and
// plans the import itself (core/imports.js); the background checks every link again, creates the
// collection and custom columns the import needs, and saves it all in one write. The contract is
// in docs/CONTRACTS.md ("Imports").
import {reduceState, pageKey, MAX_IMPORTED} from '../core/model.js';
import {MAX_IMPORT_LINKS} from '../core/imports.js';
import {serial, readState, writeState} from './store.js';

// Session key: the latest imports, newest last, each with what Undo needs to remove it exactly.
export const IMPORTS_KEY = 'linkMeteorImports';
const KEEP = 10, MAX_NAME = 120;
const FIELD_KEY = /^[a-z0-9][a-z0-9-]{0,80}$/;
const STATUSES = new Set(['reading', 'read']);
const n = value => Number(value).toLocaleString('en-US');
const CHANGED = 'These links changed since the import, so Undo is no longer possible. Remove them in the list instead.';

// JSON with object keys sorted, so links read back from chrome.storage fingerprint as written.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
async function digest(links) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(links))));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function recent() {
  const records = (await chrome.storage.session.get(IMPORTS_KEY))[IMPORTS_KEY];
  return Array.isArray(records) ? records : [];
}
async function remember(record) {
  try { await chrome.storage.session.set({[IMPORTS_KEY]: [...(await recent()), record].slice(-KEEP)}); }
  catch { /* Undo then says the import can no longer be undone */ }
}

const text = (value, what) => {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new Error(`Each imported link's ${what} must be text.`);
  return value;
};

// An imported link as stored: only what an import may set, with a new id, the import's batch and
// time, and new columns' keys turned into their ids. The model checks the rest when it's added.
// 0.6.0: a link read from a PDF may hold its page and the words around it, and a PDF read from a
// tab is the links' source page (sourceUrl, sourceTitle) in place of an `imported` label.
function importedLink(raw, {batchId, capturedAt, keys}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Each imported link must be an object.');
  const imported = text(raw.imported, 'source').trim();
  // Only a link read from a PDF in a tab names a source page; a file's links never do.
  const sourceUrl = raw.pdfPage !== undefined && !imported ? text(raw.sourceUrl, 'source page') : '';
  if (sourceUrl && (pageKey(sourceUrl) === '' || sourceUrl.length > 2000)) throw new Error("A link's source page must be a web address.");
  if ((!imported && !sourceUrl) || imported.length > MAX_IMPORTED) throw new Error(`Each imported link needs where it came from, in at most ${MAX_IMPORTED} characters.`);
  if (raw.tags !== undefined && (!Array.isArray(raw.tags) || raw.tags.some(tag => typeof tag !== 'string'))) throw new Error("Each imported link's tags must be a list of text.");
  const link = {id: crypto.randomUUID(), anchorText: text(raw.anchorText, 'anchor text'), accessibleLabel: '', url: text(raw.url, 'address'),
    originalHref: text(raw.originalHref, 'address as written'), sourceUrl, sourceTitle: sourceUrl ? text(raw.sourceTitle, 'source title').replace(/\s+/gu, ' ').trim().slice(0, 300) : '', frameUrl: '', capturedAt, batchId,
    notes: text(raw.notes, 'note'), tags: [...new Set((raw.tags || []).map(tag => tag.trim()).filter(Boolean))]};
  if (imported) link.imported = imported;
  if (raw.pdfPage !== undefined) link.pdfPage = raw.pdfPage;
  if (text(raw.context, 'context')) link.context = raw.context;
  if (raw.status !== undefined && raw.status !== '') {
    if (!STATUSES.has(raw.status)) throw new Error("An imported link's reading status must be 'reading' or 'read'.");
    link.status = raw.status;
  }
  if (raw.starred !== undefined && typeof raw.starred !== 'boolean') throw new Error("An imported link's star must be true or false.");
  if (raw.starred) link.starred = true;
  if (raw.fields !== undefined) {
    if (!raw.fields || typeof raw.fields !== 'object' || Array.isArray(raw.fields)) throw new Error("Each imported link's custom values must be an object.");
    const fields = {};
    for (const [key, value] of Object.entries(raw.fields)) {
      if (!keys.has(key)) throw new Error('An imported link has a value for a column the import doesn’t have.');
      if (text(value, 'custom value')) fields[keys.get(key)] = value;
    }
    if (Object.keys(fields).length) link.fields = fields;
  }
  return link;
}

// import.commit {collectionId? | newCollection?, links, newFields?, skipSaved?, pages?}: creates the
// new collection (or activates the chosen one), adds the new columns, and appends the links as one
// batch, all in one write. With skipSaved, addresses the collection already holds are skipped.
// `pages` (0.6.0) are page citations saved with the links, such as what a PDF says about itself.
export async function commitImport(message) {
  const {collectionId, newCollection, links, newFields = [], skipSaved = false, pages} = message;
  const hasCollection = collectionId !== undefined && collectionId !== null && collectionId !== '';
  const hasNew = newCollection !== undefined && newCollection !== null && newCollection !== '';
  if (hasCollection === hasNew) throw new Error('Choose one destination for the import: a collection here, or a new one.');
  if (hasCollection && typeof collectionId !== 'string') throw new Error('Choose a destination collection.');
  const name = typeof newCollection === 'string' ? newCollection.replace(/\s+/gu, ' ').trim().slice(0, MAX_NAME) : '';
  if (hasNew && !name) throw new Error('Name the new collection.');
  if (!Array.isArray(links) || !links.length) throw new Error('There are no links to import.');
  if (links.length > MAX_IMPORT_LINKS) throw new Error(`Import at most ${n(MAX_IMPORT_LINKS)} links at a time.`);
  if (!Array.isArray(newFields) || newFields.some(field => typeof field?.key !== 'string' || !FIELD_KEY.test(field.key) || typeof field.name !== 'string')
    || new Set(newFields.map(field => field.key)).size !== newFields.length) throw new Error('The new columns for this import are not valid.');
  if (typeof skipSaved !== 'boolean') throw new Error('Say whether to skip links already saved there.');
  if (pages !== undefined && (!pages || typeof pages !== 'object' || Array.isArray(pages))) throw new Error('The citation details for this import are not valid.');
  return serial(async () => {
    const previous = await readState();
    let state = previous, id = collectionId;
    if (hasNew) { state = reduceState(state, {type: 'collection.create', name}); id = state.activeCollectionId; }
    else if (!state.collections.some(item => item.id === id)) throw new Error('The chosen collection no longer exists, so nothing was imported. Choose another destination.');
    else if (state.activeCollectionId !== id) state = reduceState(state, {type: 'collection.activate', id});
    const home = () => state.collections.find(item => item.id === id);
    const keys = new Map((home().fields || []).map(field => [field.id, field.id]));
    const created = [];
    for (const field of newFields) {
      if (keys.has(field.key)) throw new Error('The new columns for this import are not valid.');
      state = reduceState(state, {type: 'fields.add', collectionId: id, name: field.name});
      const added = home().fields.at(-1).id;
      keys.set(field.key, added); created.push(added);
    }
    const batchId = crypto.randomUUID(), capturedAt = new Date().toISOString();
    const held = skipSaved ? new Set(home().links.map(link => link.url)) : null;
    const all = links.map(raw => importedLink(raw, {batchId, capturedAt, keys}));
    const fresh = held ? all.filter(link => !held.has(link.url)) : all;
    if (!fresh.length) throw new Error('Every link is already saved there, so nothing was imported.');
    state = reduceState(state, {type: 'links.append', collectionId: id, links: fresh, ...(pages ? {pages} : {})});
    try { await writeState(previous, state); }
    catch { throw new Error('Could not save the import, so nothing was added. Export or remove an older collection to free extension storage, then retry.'); }
    await remember({batchId, collectionId: id, createdCollection: hasNew, fields: created, previousActive: previous.activeCollectionId,
      count: fresh.length, digest: await digest(home().links.filter(link => link.batchId === batchId)), createdAt: capturedAt});
    return {state, batchId, collectionId: id, count: fresh.length, skipped: all.length - fresh.length, fields: created};
  });
}

// import.undo {collectionId, batchId}: removes that import's links, and the collection or columns it
// created, while they are exactly as the import left them. Anything else keeps it from undoing.
export function undoImport(message) {
  for (const key of ['collectionId', 'batchId']) if (typeof message[key] !== 'string' || !message[key]) throw new Error('Say which import to undo.');
  return serial(async () => {
    const records = await recent();
    const record = records.find(item => item.batchId === message.batchId && item.collectionId === message.collectionId);
    if (!record) throw new Error('This import can no longer be undone. Remove its links in the list instead.');
    const previous = await readState();
    const home = previous.collections.find(item => item.id === record.collectionId);
    if (!home) throw new Error('The collection this import went to no longer exists, so there is nothing to undo.');
    const batch = home.links.filter(link => link.batchId === record.batchId), others = home.links.filter(link => link.batchId !== record.batchId);
    if (batch.length !== record.count || await digest(batch) !== record.digest) throw new Error(CHANGED);
    if (record.createdCollection && (others.length || home.notes || home.tags.length)) throw new Error('This collection changed since the import, so Undo is no longer possible. Remove the imported links in the list instead.');
    if (others.some(link => record.fields.some(fieldId => link.fields?.[fieldId]))) throw new Error('Other links now have values in the columns this import added, so Undo is no longer possible. Remove the imported links in the list instead.');
    let state;
    if (record.createdCollection) state = reduceState(previous, {type: 'collection.delete', id: home.id});
    else {
      state = {...reduceState(previous, {type: 'links.remove', collectionId: home.id, ids: batch.map(link => link.id)}), undo: previous.undo};
      for (const fieldId of record.fields) state = reduceState(state, {type: 'fields.remove', collectionId: home.id, fieldId});
    }
    // Back to the collection that was open before the import, if the import's is still the open one.
    if (previous.activeCollectionId === home.id && record.previousActive !== home.id && state.collections.some(item => item.id === record.previousActive)) state = {...state, activeCollectionId: record.previousActive};
    try { await writeState(previous, state); } catch { throw new Error('Could not undo the import. Nothing was changed.'); }
    await chrome.storage.session.set({[IMPORTS_KEY]: records.filter(item => item !== record)}).catch(() => {});
    return {state, count: batch.length, collectionRemoved: record.createdCollection, fieldsRemoved: record.fields.length};
  });
}

// Messages this module answers. Like every table here, they are accepted only from the workbench.
export const workbenchMessages = {
  'import.commit': (message) => commitImport(message),
  'import.undo': (message) => undoImport(message),
};
