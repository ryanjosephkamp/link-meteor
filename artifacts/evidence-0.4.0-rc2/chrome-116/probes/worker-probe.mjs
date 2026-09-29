import {launch, root} from '../../../../tests/helpers/browser.mjs';
const run = await launch(process.env.P, {headless: true});
try {
  const r = await run.worker.evaluate(() => ({keys: Object.keys(chrome).sort(), action: typeof chrome.action, setIcon: typeof chrome.action?.setIcon, menus: typeof chrome.contextMenus, downloads: typeof chrome.downloads, offscreen: typeof OffscreenCanvas, ua: navigator.userAgent}));
  console.log(JSON.stringify(r));
  const page = await run.context.newPage();
  await page.goto(`chrome-extension://${run.id}/ui/workbench.html`);
  console.log(JSON.stringify(await page.evaluate(() => ({action: typeof chrome.action, keys: Object.keys(chrome).sort()}))));
} finally { await run.context.close(); }
