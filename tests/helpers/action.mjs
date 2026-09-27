// Chrome for Testing with the unpacked extension, driven over the DevTools protocol through a
// pipe, so a suite can press Chrome's own toolbar action (Extensions.triggerAction). A toolbar
// press grants the same temporary page access (activeTab) as a person's click and opens the side
// panel. Requires --enable-unsafe-extension-debugging, so only use fresh task-owned profiles:
// by default each launch makes a temporary profile under .scratch/ and deletes it on close.
//
//   const browser = await launchWithAction();
//   const {targetId} = await browser.newTab(`${fixture.base}/index.html`);
//   const page = await browser.attach(targetId);
//   await browser.clickAction(fixture.base);          // 'clicked', or Chrome's error message
//   await browser.evaluate(page, 'document.title');
//   await browser.close();
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, realpath, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromePath, root, scratch} from './browser.mjs';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Chrome names an unpacked extension after its folder: the first 32 hex digits of the SHA-256
// of the absolute path, with 0-f written as a-p. The path is hashed as UTF-8 on macOS and Linux,
// and as UTF-16LE with an uppercase drive letter on Windows.
export async function unpackedExtensionId(folder) {
  const path = await realpath(folder);
  const bytes = process.platform === 'win32' ? Buffer.from(path.replace(/^[a-z]:/, (drive) => drive.toUpperCase()), 'utf16le') : Buffer.from(path);
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  return [...digest].map((digit) => String.fromCharCode(97 + parseInt(digit, 16))).join('');
}

export async function launchWithAction({extension = resolve(root, process.env.LINK_METEOR_EXTENSION_PATH || 'dist'), headless = true, profilePrefix = 'action-profile-', args = []} = {}) {
  await mkdir(scratch, {recursive: true});
  const profile = await mkdtemp(resolve(scratch, profilePrefix));
  const chrome = spawn(chromePath(), [
    ...(headless ? ['--headless=new'] : []), '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    // Ubuntu blocks the unprivileged namespaces Chrome's sandbox needs; Playwright's launches turn it off too.
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    `--user-data-dir=${profile}`, `--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
    '--no-first-run', '--disable-background-networking', '--disable-component-update', ...args, 'about:blank',
  ], {stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe']});
  // Keep Chrome's last output, to explain a Chrome that exits at startup.
  let stderr = '';
  chrome.stderr.on('data', (data) => { stderr = (stderr + data).slice(-4000); });
  const out = chrome.stdio[3], inp = chrome.stdio[4];
  const exitedEarly = new Promise((done) => chrome.once('exit', (code, signal) => done(new Error(`Chrome exited (${signal || code}) before answering. Its last output:\n${stderr.trim().split('\n').slice(-8).join('\n')}`))));
  for (const stream of [out, inp]) stream.on('error', () => {}); // a closed pipe is reported by the exit above
  let buffer = '', nextId = 1, closed = false;
  const pending = new Map(), workers = new Map(), listeners = new Set(); // workers: url -> targetId
  inp.on('data', (data) => {
    buffer += data.toString();
    let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      const target = message.params?.targetInfo;
      if (message.method === 'Target.targetCreated' && target.type === 'service_worker') workers.set(target.url, target.targetId);
      if (message.method) for (const listener of listeners) listener(message);
      if (message.id && pending.has(message.id)) {
        const {ok, no} = pending.get(message.id); pending.delete(message.id);
        message.error ? no(new Error(JSON.stringify(message.error))) : ok(message.result);
      }
    }
  });
  const exited = new Promise((done) => chrome.once('exit', done));
  // One DevTools protocol command; sessionId targets an attached page.
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => {
    const id = nextId++; pending.set(id, {ok, no});
    out.write(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}) + '\0');
  });
  const close = async () => {
    if (closed) return; closed = true;
    chrome.kill(); await Promise.race([exited, sleep(3000)]);
    await rm(profile, {recursive: true, force: true});
  };
  try {
    // The extension is ready once target discovery reports its service worker. Target.getTargets
    // does not list extension workers, and Chrome's own component extensions have workers too.
    let extensionId = await unpackedExtensionId(extension);
    let worker = `chrome-extension://${extensionId}/background.js`;
    // A Chrome that never answers (for example one too old for these flags) fails here instead of hanging.
    await Promise.race([send('Target.setDiscoverTargets', {discover: true}), exitedEarly.then((error) => { throw error; }), sleep(15000).then(() => { throw new Error('Chrome did not answer over the DevTools pipe'); })]);
    for (const start = Date.now(); !workers.has(worker); await sleep(100)) {
      // If the computed ID ever disagrees with Chrome's, fall back to the one unpacked
      // extension worker named background.js, and only when there is exactly one.
      const found = [...workers.keys()].filter((url) => /^chrome-extension:\/\/[a-p]{32}\/background\.js$/.test(url));
      if (Date.now() - start > 5000 && found.length === 1) { worker = found[0]; extensionId = new URL(worker).host; break; }
      if (Date.now() - start > 15000) throw new Error(`The extension service worker ${worker} did not start`);
    }
    const tabTarget = async (urlPrefix) => {
      const {targetInfos} = await send('Target.getTargets', {filter: [{type: 'tab'}]});
      return targetInfos.find((target) => target.url.startsWith(urlPrefix))?.targetId;
    };
    return {
      extensionId, extension, profile, send, close,
      // Every DevTools event (Target.*, and Runtime.* or Log.* from attached sessions); returns an unsubscribe function.
      onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
      workerTargetId: () => workers.get(worker),
      extensionUrl: (path = 'ui/workbench.html') => `chrome-extension://${extensionId}/${path}`,
      newTab: (url) => send('Target.createTarget', {url}),
      newWindow: (url) => send('Target.createTarget', {url, newWindow: true}),
      attach: async (targetId) => (await send('Target.attachToTarget', {targetId, flatten: true})).sessionId,
      evaluate: async (sessionId, expression) => {
        const {result, exceptionDetails} = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}, sessionId);
        if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
        return result.value;
      },
      navigate: (sessionId, url) => send('Page.navigate', {url}, sessionId),
      // Presses the toolbar action for the first tab whose URL starts with urlPrefix. The action
      // needs the tab's "tab" target, not its page target. Resolves 'clicked' or Chrome's error.
      clickAction: async (urlPrefix) => {
        const targetId = await tabTarget(urlPrefix);
        return targetId ? send('Extensions.triggerAction', {id: extensionId, targetId}).then(() => 'clicked', (error) => error.message) : 'no tab target';
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
