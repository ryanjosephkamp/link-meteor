// Copies extension-owned files the site depends on into site/, or verifies them with --check.
// The site's export preview runs the extension's own export modules; the install page offers
// the packaged development ZIP with its SHA-256. Nothing here deploys or publishes anything.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const check = process.argv.includes('--check');
const manifest = JSON.parse(await readFile(resolve(root, 'src/manifest.json'), 'utf8'));
const zipName = `link-meteor-${manifest.version}.zip`;
const pairs = [
  ['src/core/export.js', 'site/assets/js/core/export.js'],
  ['src/core/xlsx.js', 'site/assets/js/core/xlsx.js'],
  ['assets/brand/icon.svg', 'site/assets/img/icon.svg'],
  ['assets/brand/mark.svg', 'site/assets/img/mark.svg'],
  ['src/icons/32.png', 'site/assets/img/icon-32.png'],
  ['src/icons/128.png', 'site/assets/img/icon-128.png'],
  [`artifacts/${zipName}`, `site/downloads/${zipName}`],
];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
// Header and footer are authored once in site/index.html and copied into every other page.
const master = await readFile(resolve(root, 'site/index.html'), 'utf8');
const block = (html, name) => { const start = html.indexOf(`<!-- ${name} -->`), end = html.indexOf(`<!-- /${name} -->`); if (start < 0 || end < 0) throw new Error(`Missing ${name} markers`); return [start, end + `<!-- /${name} -->`.length]; };
// 404.html and the embedded practice frame deliberately have no site chrome.
const standalone = new Set(['index.html', '404.html', 'practice-frame.html']);
const pages = (await readdir(resolve(root, 'site'))).filter((name) => name.endsWith('.html') && !standalone.has(name));
const problems = [];
for (const [from, to] of pairs) {
  const source = await readFile(resolve(root, from));
  let target = null;
  try { target = await readFile(resolve(root, to)); } catch { /* missing */ }
  if (check) { if (!target || !source.equals(target)) problems.push(`${to} differs from ${from}`); continue; }
  await mkdir(resolve(root, to, '..'), { recursive: true });
  await copyFile(resolve(root, from), resolve(root, to));
}
for (const name of pages) {
  const path = resolve(root, 'site', name);
  let html = await readFile(path, 'utf8');
  for (const part of ['site-header', 'site-footer']) {
    const [ms, me] = block(master, part), [ps, pe] = block(html, part);
    const wanted = master.slice(ms, me);
    if (html.slice(ps, pe) !== wanted) { if (check) problems.push(`${name}: ${part} differs from index.html`); else html = html.slice(0, ps) + wanted + html.slice(pe); }
  }
  if (!check) await writeFile(path, html);
}
const zip = await readFile(resolve(root, 'artifacts', zipName));
const latest = { version: manifest.version, file: `downloads/${zipName}`, bytes: zip.length, sha256: sha(zip), minimumChromeVersion: manifest.minimum_chrome_version };
const latestPath = resolve(root, 'site/downloads/latest.json');
const buildText = { version: latest.version, filename: zipName, sha256: latest.sha256, size: `${Math.round(latest.bytes / 1024)} KB ZIP`, minimumChromeVersion: latest.minimumChromeVersion };
// Fills <tag data-build="key">…</tag> text and data-build-href links from the packaged ZIP.
function fillBuild(html) {
  return html
    .replace(/(<(\w+)\b[^>]*\bdata-build="(\w+)"[^>]*>)[^<]*(<\/\2>)/g, (match, open, tag, key, close) => key in buildText ? `${open}${buildText[key]}${close}` : match)
    .replace(/href="[^"]*"(\s+data-build-href="file")/g, `href="${latest.file}"$1`);
}
if (check) {
  let current = null;
  try { current = JSON.parse(await readFile(latestPath, 'utf8')); } catch { /* missing */ }
  if (JSON.stringify(current) !== JSON.stringify(latest)) problems.push('site/downloads/latest.json is stale');
  const html = await readFile(resolve(root, 'site/install.html'), 'utf8');
  if (fillBuild(html) !== html) problems.push('site/install.html build details are stale; run node scripts/sync-site.mjs');
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  console.log(JSON.stringify({ check: 'pass', ...latest }));
} else {
  for (const entry of await readdir(resolve(root, 'site/downloads'))) {
    if (entry.endsWith('.zip') && entry !== zipName) await rm(resolve(root, 'site/downloads', entry));
  }
  await writeFile(latestPath, JSON.stringify(latest, null, 2) + '\n');
  const installPath = resolve(root, 'site/install.html');
  await writeFile(installPath, fillBuild(await readFile(installPath, 'utf8')));
  console.log(JSON.stringify(latest));
}
