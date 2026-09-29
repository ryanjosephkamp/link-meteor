import {createRequire} from 'node:module';
import http from 'node:http';
import {mkdtempSync} from 'node:fs';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PW);
const server = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>probe</title><button id=b>b</button>'); });
await new Promise((d) => server.listen(0, '127.0.0.1', d));
const base = `http://127.0.0.1:${server.address().port}/`;
for (const [label, path, args] of [['116', process.env.C116, ['--headless=new']], ['current', undefined, []]]) {
  const browser = await chromium.launch({executablePath: path, headless: true, args});
  const context = await browser.newContext({permissions: ['clipboard-read', 'clipboard-write']});
  const page = await context.newPage(); await page.goto(base); await page.click('#b');
  const out = {version: browser.version()};
  const step = async (name, fn) => { try { out[name] = await page.evaluate(fn); } catch (e) { out[name] = 'ERROR ' + e.message.split('\n')[0]; } };
  await step('writeText', async () => { await navigator.clipboard.writeText('plain one'); return 'ok'; });
  await step('readText', () => navigator.clipboard.readText());
  await step('readAfterText', async () => { const [item] = await navigator.clipboard.read(); return item.types; });
  await step('writeRich', async () => { await navigator.clipboard.write([new ClipboardItem({'text/html': new Blob(['<a href="https://a.example/">A</a>'], {type: 'text/html'}), 'text/plain': new Blob(['A (https://a.example/)'], {type: 'text/plain'})})]); return 'ok'; });
  await step('readTextAfterRich', () => navigator.clipboard.readText());
  await step('readAfterRich', async () => { const [item] = await navigator.clipboard.read(); return {types: item.types, html: item.types.includes('text/html') ? await (await item.getType('text/html')).text() : null}; });
  console.log(label, JSON.stringify(out));
  await browser.close();
}
server.close();
