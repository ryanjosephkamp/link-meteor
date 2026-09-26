// Saved state: every read-modify-write of linkMeteorState goes through one serialized queue.
import {createState, migrateState, reduceState} from '../core/model.js';

export const STATE_KEY = 'linkMeteorState';
let writeQueue = Promise.resolve();

export function serial(operation) {
  const next = writeQueue.then(operation, operation);
  writeQueue = next.catch(() => {});
  return next;
}

export async function readState() {
  const stored = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY];
  if (!stored) {
    const state = createState();
    await chrome.storage.local.set({[STATE_KEY]:state});
    return state;
  }
  if (stored.schemaVersion !== 1 || !Array.isArray(stored.collections)) {
    throw new Error('Saved collection data could not be read. It has been preserved; do not reset the extension.');
  }
  // Settings added after 0.2.2 read as their defaults; the next write stores them.
  return migrateState(stored);
}

const writeListeners = [];
// Area modules can follow saved changes; for example, hold-key registration follows settings.
// Listeners get (previous, next) after each successful write. They are not awaited, so queue
// any further state work through serial(), and a listener error never undoes a saved write.
export function onStateWritten(listener) { writeListeners.push(listener); }

// Saves a new state, and any other local keys in the same storage write, then announces it.
// Call it inside serial() with the state it replaces. A failed write changes nothing.
export async function writeState(previous, next, extra = {}) {
  await chrome.storage.local.set({[STATE_KEY]:next,...extra});
  chrome.runtime.sendMessage({type:'state.changed'}).catch(() => {});
  for (const listener of writeListeners) {
    try { Promise.resolve(listener(previous,next)).catch(() => {}); } catch { /* the write stands */ }
  }
}

export async function mutate(action) {
  return serial(async () => {
    const previous = await readState();
    const state = reduceState(previous, action);
    try { await writeState(previous, state); }
    catch { throw new Error('Could not save this change. Existing collections are intact. Export or remove an older collection to free extension storage, then retry.'); }
    return state;
  });
}
