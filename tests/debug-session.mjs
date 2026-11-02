// Starts the unpacked extension (dist/, or LINK_METEOR_EXTENSION_PATH) in a fresh temporary
// Chrome for Testing profile and streams what its background does: console messages, uncaught
// errors and log entries, reattaching whenever Chrome restarts the service worker. Optionally
// streams tabs too (extension pages and the page script's console). Build first: npm run build.
//
//   npm run debug                                   visible window; Ctrl-C stops and deletes the profile
//   npm run debug -- --headless --seconds 30        for agents: stop on its own
//   npm run debug -- --url http://127.0.0.1:8000/ --tabs
//   npm run debug -- --headless --seconds 5 --eval "chrome.storage.local.get()"
//   npm run debug -- --log .scratch/debug.log       also append every line to a file
//
// --eval runs an expression in the background once it starts and prints the result, for example
// to read settings or collections. The profile is new and empty, so nothing personal is involved.
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchWithAction } from './helpers/action.mjs';
import { root } from './helpers/browser.mjs';

const args = process.argv.slice(2);
const values = (name) => args.flatMap((arg, i) => (arg === name && args[i + 1] ? [args[i + 1]] : []));
const headless = args.includes('--headless');
const tabs = args.includes('--tabs');
const seconds = Number(values('--seconds')[0] || 0);
const logFile = values('--log')[0] ? resolve(root, values('--log')[0]) : null;

const started = Date.now();
const write = async (source, kind, text) => {
  const line = `${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s [${source}] ${kind}: ${text}`;
  console.log(line);
  if (logFile) await appendFile(logFile, line + '\n');
};
// A console argument as readable text: strings as-is, objects by value or description.
const show = (value) => value.type === 'string' ? value.value
  : value.value !== undefined ? JSON.stringify(value.value)
  : value.preview?.properties ? `${value.preview.subtype === 'array' ? '[' : '{'}${value.preview.properties.map((p) => value.preview.subtype === 'array' ? p.value : `${p.name}: ${p.value}`).join(', ')}${value.preview.overflow ? ', …' : ''}${value.preview.subtype === 'array' ? ']' : '}'}`
  : value.description ?? value.type;

const browser = await launchWithAction({ headless, profilePrefix: 'debug-profile-' });
const sessions = new Map(); // sessionId -> label
const contexts = new Map(); // sessionId -> its JavaScript context, once Chrome reports it
const attached = new Map(); // targetId -> promise of its sessionId
let stopping = false;

function watch(targetId, label) {
  if (!attached.has(targetId)) attached.set(targetId, (async () => {
    try {
      const sessionId = await browser.attach(targetId);
      sessions.set(sessionId, label);
      await browser.send('Runtime.enable', {}, sessionId);
      await browser.send('Log.enable', {}, sessionId).catch(() => {});
      await write(label, 'attached', targetId);
      return sessionId;
    } catch (error) {
      attached.delete(targetId);
      await write(label, 'could not attach', error.message);
    }
  })());
  return attached.get(targetId);
}

browser.onEvent(async (message) => {
  const { method, params, sessionId } = message;
  if (method === 'Target.targetCreated' || method === 'Target.targetInfoChanged') {
    const target = params.targetInfo;
    if (target.type === 'service_worker' && target.url === browser.extensionUrl('background.js')) await watch(target.targetId, 'background');
    else if (tabs && target.type === 'page' && target.url && target.url !== 'about:blank') await watch(target.targetId, target.url.startsWith('chrome-extension://') ? `extension ${target.url.split('/').slice(3).join('/')}` : `tab ${new URL(target.url).host || new URL(target.url).protocol.replace(':', '')}`);
  } else if (method === 'Target.targetDestroyed') {
    attached.delete(params.targetId);
  } else if (method === 'Target.detachedFromTarget') {
    const label = sessions.get(params.sessionId);
    if (label && !stopping) await write(label, 'detached', label === 'background' ? 'Chrome stopped the service worker; it reattaches when it starts again' : 'closed');
    sessions.delete(params.sessionId);
  } else if (sessionId && sessions.has(sessionId)) {
    const label = sessions.get(sessionId);
    if (method === 'Runtime.executionContextCreated' && !contexts.has(sessionId)) contexts.set(sessionId, params.context.id);
    else if (method === 'Runtime.consoleAPICalled') await write(label, params.type, params.args.map(show).join(' '));
    else if (method === 'Runtime.exceptionThrown') {
      const details = params.exceptionDetails;
      await write(label, 'ERROR', `${details.exception?.description || details.text}${details.url ? ` (${details.url}:${details.lineNumber + 1})` : ''}`);
    } else if (method === 'Log.entryAdded') await write(label, `log ${params.entry.level}`, `${params.entry.text}${params.entry.url ? ` (${params.entry.url})` : ''}`);
  }
});

const background = await watch(browser.workerTargetId(), 'background');
await write('session', 'started', `extension ${browser.extensionId}, ${headless ? 'headless' : 'visible window'}, temporary profile`);
// Evaluate only once Chrome reports the worker's context; before that, its APIs aren't ready.
for (const start = Date.now(); values('--eval').length && !contexts.has(background) && Date.now() - start < 5000;) await new Promise((done) => setTimeout(done, 50));
for (const expression of values('--eval')) {
  try {
    const {result, exceptionDetails} = await browser.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true, contextId: contexts.get(background)}, background);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    await write('background', 'eval', `${expression} => ${JSON.stringify(result.value)}`);
  }
  catch (error) { await write('background', 'eval failed', `${expression} => ${error.message}`); }
}
for (const url of values('--url')) await browser.newTab(url);

const stop = async () => {
  if (stopping) return;
  stopping = true;
  await write('session', 'stopping', 'closing Chrome and deleting the temporary profile');
  await browser.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
if (seconds) setTimeout(stop, seconds * 1000);
else await write('session', 'running', 'press Ctrl-C to stop');
