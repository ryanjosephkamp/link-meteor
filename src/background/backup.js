// Backup and restore messages (0.3.0). The contracts are in docs/CONTRACTS.md.
// The workbench builds backups and restore previews itself; the background saves a restore and
// its Undo snapshot together, inside the state queue, so a failed write changes nothing.
import {migrateState, planRestore} from '../core/model.js';
import {serial, readState, writeState} from './store.js';

export const RESTORE_UNDO_KEY = 'linkMeteorRestoreUndo';

// Settings the background narrows on its own after a write, when Chrome no longer grants a site
// or all-sites access. That upkeep does not count as a change that blocks Undo.
const ACCESS_FIELDS = ['holdOrigins', 'holdScope'];

// JSON with object keys sorted, so a state read back from chrome.storage (whose key order is
// not the order it was written in) fingerprints the same as the state that was written.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function fingerprint(state) {
  const settings = {...state.settings};
  for (const key of ACCESS_FIELDS) delete settings[key];
  const bytes = new TextEncoder().encode(canonical({...state, settings}));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// What a restore wrote, in the form Undo compares against: a fingerprint of everything except
// the access fields, plus those fields themselves.
async function writtenMark(state) {
  return {fingerprint: await fingerprint(state), holdOrigins: [...state.settings.holdOrigins], holdScope: state.settings.holdScope};
}

// The saved state is still the one the restore wrote, allowing only for the background having
// dropped hold-drag sites (in order) or all-sites mode because Chrome's access is gone.
async function unchangedSince(current, written) {
  if (!written || typeof written.fingerprint !== 'string' || !Array.isArray(written.holdOrigins)) return false;
  if (await fingerprint(current) !== written.fingerprint) return false;
  const {holdOrigins, holdScope} = current.settings;
  if (holdScope !== written.holdScope && holdScope !== 'sites') return false;
  let at = 0;
  for (const origin of holdOrigins) {
    at = written.holdOrigins.indexOf(origin, at);
    if (at < 0) return false;
    at++;
  }
  return true;
}

async function readSnapshot() {
  const snapshot = (await chrome.storage.local.get(RESTORE_UNDO_KEY))[RESTORE_UNDO_KEY];
  const usable = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) &&
    snapshot.before && typeof snapshot.before === 'object' && snapshot.summary && typeof snapshot.summary === 'object';
  return usable ? snapshot : null;
}

export async function restore({backup, mode}) {
  if (mode !== 'merge' && mode !== 'replace') throw new Error("Restore mode must be 'merge' or 'replace'.");
  return serial(async () => {
    const previous = await readState();
    // planRestore reads the backup as untrusted input and throws the reader's own message.
    const {state, summary} = planRestore(previous, backup, mode);
    const snapshot = {createdAt: new Date().toISOString(), summary, before: previous, written: await writtenMark(state)};
    try { await writeState(previous, state, {[RESTORE_UNDO_KEY]: snapshot}); }
    catch { throw new Error('Could not save the restore. Nothing was changed: your collections, settings and any earlier restore Undo are as they were.'); }
    return {state, summary};
  });
}

export function undoRestore() {
  return serial(async () => {
    const snapshot = await readSnapshot();
    if (!snapshot) throw new Error('There is no restore to undo.');
    const current = await readState();
    if (!(await unchangedSince(current, snapshot.written))) {
      throw new Error('Link Meteor changed after this restore, so undoing it now would lose those changes. The restore and its Undo are both kept; discard Undo if you no longer need it.');
    }
    const before = migrateState(snapshot.before);
    // The state and the cleared snapshot are one write; removing the emptied key afterwards only tidies.
    try { await writeState(current, before, {[RESTORE_UNDO_KEY]: null}); }
    catch { throw new Error('Could not undo the restore. Nothing was changed.'); }
    await chrome.storage.local.remove(RESTORE_UNDO_KEY).catch(() => {});
    return {state: before};
  });
}

export function restoreStatus() {
  return serial(async () => {
    const snapshot = await readSnapshot();
    return {undo: snapshot ? {createdAt: snapshot.createdAt, summary: snapshot.summary} : null};
  });
}

export function discardRestoreUndo() {
  return serial(async () => {
    await chrome.storage.local.remove(RESTORE_UNDO_KEY);
    return {};
  });
}

// Messages this module answers. Like every table here, they are accepted only from the workbench.
export const workbenchMessages = {
  'backup.restore': (message) => restore(message),
  'backup.undo': () => undoRestore(),
  'backup.status': () => restoreStatus(),
  'backup.discardUndo': () => discardRestoreUndo(),
};
