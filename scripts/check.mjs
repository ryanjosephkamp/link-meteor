// Runs every check that needs no optional grants, one after another: the build, the unit tests,
// the loaded-extension suites, the website checks and the site/package sync. Each suite writes its
// results into one folder, with its log in logs/<suite>.txt and a summary in summary.json and
// summary.md. Suites that need a person's Allow clicks (browser, extended-browser, site-browser,
// audit-granted-regressions, access-granted, permission-browser) never run here.
//
//   npm run check                        results in .scratch/check-<time>
//   npm run check -- <folder>            results in <folder>
//   npm run check -- <folder> --only unit,visual-browser
//   npm run check -- <folder> --skip backup-browser --keep-profiles
//
// Every browser suite gets a fresh task-owned profile under .scratch/, removed afterwards unless
// --keep-profiles is given. Exits 1 if any check fails.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const scratch = resolve(root, '.scratch');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const args = process.argv.slice(2);
const option = (name) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const list = (name) => option(name)?.split(',').map((item) => item.trim()).filter(Boolean);
const valued = new Set(['--only', '--skip']);
const positional = args.filter((arg, i) => !arg.startsWith('--') && !valued.has(args[i - 1]));
const out = resolve(root, positional[0] || `.scratch/check-${stamp}`);
const only = list('--only');
const skip = list('--skip') || [];
const keepProfiles = args.includes('--keep-profiles');
const minutes = Number(option('--minutes') || 20);

const manifest = JSON.parse(await readFile(resolve(root, 'src/manifest.json'), 'utf8'));
const zip = resolve(root, 'artifacts', `link-meteor-${manifest.version}.zip`);
const unitFiles = (await readdir(resolve(root, 'tests'))).filter((name) => name.endsWith('.test.mjs')).sort().map((name) => `tests/${name}`);
// The visual suite needs real captured occurrences to show; this is the newest committed export.
const seed = process.env.LINK_METEOR_SEED_JSON || 'artifacts/evidence-0.3.0-rc2/exports/browser.json';
const node = process.execPath;

const suites = [
  { name: 'build', command: [node, 'scripts/build.mjs'] },
  { name: 'unit', command: [node, '--test', ...unitFiles] },
  { name: 'access-browser', command: [node, 'tests/access-browser.mjs'] },
  { name: 'capture-page-access', command: [node, 'tests/capture-page-access.mjs'] },
  { name: 'access-content', command: [node, 'tests/access-content.mjs'] },
  { name: 'exports-browser', command: [node, 'tests/exports-browser.mjs'], profile: true },
  { name: 'backup-browser', command: [node, 'tests/backup-browser.mjs'] },
  { name: 'downloads-browser', command: [node, 'tests/downloads-browser.mjs'], profile: true },
  { name: 'reading-browser', command: [node, 'tests/reading-browser.mjs'], profile: true },
  { name: 'imports-browser', command: [node, 'tests/imports-browser.mjs'], profile: true },
  { name: 'move-browser', command: [node, 'tests/move-browser.mjs'], profile: true },
  { name: 'pdf-browser', command: [node, 'tests/pdf-browser.mjs'], profile: true },
  { name: 'lookup-browser', command: [node, 'tests/lookup-browser.mjs'], profile: true },
  { name: 'audit-overlay', command: [node, 'tests/audit-overlay.mjs'], profile: true },
  { name: 'audit-actions', command: [node, 'tests/audit-actions.mjs'], profile: true },
  { name: 'audit-regressions', command: [node, 'tests/audit-regressions.mjs'], profile: true },
  { name: 'visual-browser', command: [node, 'tests/visual-browser.mjs'], env: { LINK_METEOR_VISUAL_PROFILE: `check-visual-${stamp}`, LINK_METEOR_SEED_JSON: seed } },
  { name: 'site-check', command: [node, 'tests/site-check.mjs'] },
  // The site must offer the packaged ZIP of this version; between releases there is none yet.
  { name: 'sync-site', command: [node, 'scripts/sync-site.mjs', '--check'], skip: () => !existsSync(zip) && `no ${relative(root, zip)} yet; package this version first` },
];
const unknown = [...(only || []), ...skip].filter((name) => !suites.some((suite) => suite.name === name));
if (unknown.length) { console.error(`Unknown checks: ${unknown.join(', ')}. Known: ${suites.map((suite) => suite.name).join(', ')}`); process.exit(2); }

await mkdir(resolve(out, 'logs'), { recursive: true });
await mkdir(scratch, { recursive: true });
const scratchBefore = new Set(await readdir(scratch));

function run(suite) {
  return new Promise((done) => {
    const env = { ...process.env, LINK_METEOR_EVIDENCE_DIR: out, ...(suite.profile ? { LINK_METEOR_TEST_PROFILE: `check-${suite.name}-${stamp}` } : {}), ...suite.env };
    const child = spawn(suite.command[0], suite.command.slice(1), { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    child.stdout.on('data', (data) => chunks.push(data));
    child.stderr.on('data', (data) => chunks.push(data));
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, minutes * 60_000);
    child.on('close', (code) => { clearTimeout(timer); done({ code: timedOut ? 'timeout' : code, output: Buffer.concat(chunks).toString() }); });
  });
}

const results = [];
let browserVersion = '';
try {
  const { playwright, chromePath, headlessArgs } = await import('../tests/helpers/browser.mjs');
  const browser = await playwright.chromium.launch({ executablePath: chromePath(), args: headlessArgs() });
  browserVersion = browser.version();
  await browser.close();
} catch (error) { browserVersion = `unknown (${error.message.split('\n')[0]})`; }
console.log(`Checks without grants: Link Meteor ${manifest.version}, ${process.platform}, Node ${process.version}, Chrome for Testing ${browserVersion}`);
console.log(`Results: ${relative(root, out) || out}`);

for (const suite of suites) {
  if ((only && !only.includes(suite.name)) || skip.includes(suite.name)) continue;
  const reason = suite.skip?.();
  if (reason) { results.push({ check: suite.name, status: 'skip', reason }); console.log(`SKIP ${suite.name}: ${reason}`); continue; }
  const started = Date.now();
  const { code, output } = await run(suite);
  const seconds = Math.round((Date.now() - started) / 1000);
  const log = `logs/${suite.name}.txt`;
  await writeFile(resolve(out, log), output);
  const status = code === 0 ? 'pass' : 'fail';
  results.push({ check: suite.name, status, exitCode: code, seconds, log });
  console.log(`${status.toUpperCase()} ${suite.name} (${seconds} s)${status === 'fail' ? ` — see ${relative(root, resolve(out, log))}` : ''}`);
  // Without a build, nothing else can be trusted.
  if (suite.name === 'build' && status === 'fail') break;
}

if (!keepProfiles) {
  // Remove only what this run added to .scratch/: its profiles, their caches and fingerprints.
  const inside = relative(scratch, out);
  for (const name of await readdir(scratch)) {
    if (scratchBefore.has(name) || name === 'runtime.json' || (!inside.startsWith('..') && inside.split(/[\\/]/)[0] === name)) continue;
    await rm(resolve(scratch, name), { recursive: true, force: true });
  }
}

const failed = results.filter((result) => result.status === 'fail');
const summary = { started: stamp, finished: new Date().toISOString(), version: manifest.version, platform: process.platform, arch: process.arch, node: process.version, browser: browserVersion, result: failed.length ? 'FAIL' : 'PASS', results };
await writeFile(resolve(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
await writeFile(resolve(out, 'summary.md'), [
  `# Checks without grants: ${summary.result}`, '',
  `Link Meteor ${manifest.version} on ${process.platform} (${process.arch}), Node ${process.version}, Chrome for Testing ${browserVersion}. Started ${stamp}.`, '',
  '| Check | Result | Seconds | Log or reason |', '| --- | --- | --- | --- |',
  ...results.map((result) => `| ${result.check} | ${result.status} | ${result.seconds ?? ''} | ${result.log ? `[${result.log}](${result.log})` : result.reason} |`), '',
].join('\n'));
console.log(`${summary.result}: ${results.filter((result) => result.status === 'pass').length} passed, ${failed.length} failed, ${results.filter((result) => result.status === 'skip').length} skipped`);
process.exit(failed.length ? 1 : 0);
