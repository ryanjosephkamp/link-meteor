// Moving and copying links to another collection (0.5.0 RC2), and its Undo. The model does the
// work (core/model.js, transferLinks and revertTransfer); this module saves it in one write inside
// the state queue and keeps what Undo needs. The contract is in docs/CONTRACTS.md ("Moving and
// copying links").
import {transferLinks, revertTransfer} from '../core/model.js';
import {serial, readState, writeState} from './store.js';

// Session key: the latest moves and copies, newest last, each with what Undo needs.
export const TRANSFERS_KEY = 'linkMeteorTransfers';
const KEEP = 10;
const CHANGED = 'These links changed since, so Undo is no longer possible. Move them back instead.';

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
const arrivedLinks = (state, record) => {
  const home = state.collections.find(item => item.id === record.toCollectionId);
  const byId = new Map((home?.links || []).map(link => [link.id, link]));
  return record.ids.map(id => byId.get(id));
};

async function recent() {
  const records = (await chrome.storage.session.get(TRANSFERS_KEY))[TRANSFERS_KEY];
  return Array.isArray(records) ? records : [];
}
async function remember(record) {
  try { await chrome.storage.session.set({[TRANSFERS_KEY]: [...(await recent()), record].slice(-KEEP)}); }
  catch { /* Undo then says the move can no longer be undone */ }
}

// links.transfer {fromCollectionId, ids, mode: 'move'|'copy', toCollectionId? | newCollection?}
export function transfer(message) {
  const {fromCollectionId, ids, mode, toCollectionId, newCollection} = message;
  if (typeof fromCollectionId !== 'string' || !Array.isArray(ids) || !ids.length) throw new Error('Choose the links to move or copy first.');
  return serial(async () => {
    const previous = await readState();
    const done = transferLinks(previous, {fromCollectionId, ids, mode, toCollectionId, newCollection}, {newId: () => crypto.randomUUID()});
    const verb = mode === 'move' ? 'moved' : 'copied';
    try { await writeState(previous, done.state); }
    catch { throw new Error(`Could not save this, so nothing was ${verb}. Export or remove an older collection to free extension storage, then retry.`); }
    const transferId = crypto.randomUUID();
    await remember({...done.record, transferId, digest: await digest(arrivedLinks(done.state, done.record)), createdAt: new Date().toISOString()});
    return {state: done.state, transferId, mode, moved: done.moved, skipped: done.skipped, fields: done.fields, collectionId: done.record.toCollectionId, name: done.name, createdCollection: done.record.createdCollection};
  });
}

// links.transferUndo {transferId}: while the links it added are unchanged, removes them (and any
// collection or columns it created) and, for a move, puts them back where they were.
export function undoTransfer(message) {
  if (typeof message.transferId !== 'string' || !message.transferId) throw new Error('Say which move to undo.');
  return serial(async () => {
    const records = await recent();
    const record = records.find(item => item.transferId === message.transferId);
    if (!record) throw new Error('This can no longer be undone. Move the links back instead.');
    const previous = await readState();
    const arrived = arrivedLinks(previous, record);
    if (arrived.some(link => !link) || await digest(arrived) !== record.digest) throw new Error(CHANGED);
    const state = revertTransfer(previous, record);
    try { await writeState(previous, state); } catch { throw new Error('Could not undo this. Nothing was changed.'); }
    await chrome.storage.session.set({[TRANSFERS_KEY]: records.filter(item => item !== record)}).catch(() => {});
    return {state, mode: record.mode, count: record.ids.length, collectionRemoved: record.createdCollection, fieldsRemoved: record.fields.length};
  });
}

// Messages this module answers. Like every table here, they are accepted only from the workbench.
export const workbenchMessages = {
  'links.transfer': (message) => transfer(message),
  'links.transferUndo': (message) => undoTransfer(message),
};
