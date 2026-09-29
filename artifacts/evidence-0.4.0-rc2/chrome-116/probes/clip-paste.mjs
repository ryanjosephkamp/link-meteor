import {createRequire} from 'node:module';
import http from 'node:http';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PW);
const server = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>probe</title><div id=e contenteditable style="width:300px;height:100px">x</div>'); });
await new Promise((d) => server.listen(0, '127.0.0.1', d));
const base = `http://127.0.0.1:${server.address().port}/`;
for (const [label, path, args] of [['116', process.env.C116, ['--headless=new']], ['current', undefined, []]]) {
  const browser = await chromium.launch({executablePath: path, headless: true, args});
  const context = await browser.newContext({permissions: ['clipboard-read', 'clipboard-write']});
  const page = await context.newPage(); await page.goto(base); await page.click('#e');
  await page.evaluate(() => { window.__pasted = null; document.getElementById('e').addEventListener('paste', (ev) => { window.__pasted = {html: ev.clipboardData.getData('text/html'), text: ev.clipboardData.getData('text/plain'), types: [...ev.clipboardData.types]}; }); });
  await page.evaluate(async () => { await navigator.clipboard.write([new ClipboardItem({'text/html': new Blob(['<a href="https://a.example/">A</a>'], {type: 'text/html'}), 'text/plain': new Blob(['A (https://a.example/)'], {type: 'text/plain'})})]); });
  await page.keyboard.press('Meta+v'); await page.waitForTimeout(300);
  let pasted = await page.evaluate(() => window.__pasted);
  if (!pasted) { await page.keyboard.press('Control+v'); await page.waitForTimeout(300); pasted = await page.evaluate(() => window.__pasted); }
  console.log(label, browser.version(), JSON.stringify(pasted), JSON.stringify(await page.locator('#e').innerHTML()));
  await browser.close();
}
server.close();
