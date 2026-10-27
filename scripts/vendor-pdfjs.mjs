// Maintainer's step, never run by a build or a test: copies one exact pdfjs-dist release into
// src/vendor/pdfjs/.   node scripts/vendor-pdfjs.mjs 6.3.289
// It downloads that version's package from the npm registry, checks the registry's integrity
// value, and copies the legacy build's two files and the license. README.md there records the
// version, the source and each file's SHA-256; tests/vendor.test.mjs checks them offline.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error('Usage: node scripts/vendor-pdfjs.mjs <exact version, such as 6.3.289>');
const FILES = ['pdf.min.mjs', 'pdf.worker.min.mjs'];
const out = join(root, 'src/vendor/pdfjs');

const info = await (await fetch(`https://registry.npmjs.org/pdfjs-dist/${version}`)).json();
if (info.version !== version || !info.dist?.tarball || !/^sha512-/.test(info.dist.integrity || '')) throw new Error(`The registry has no usable pdfjs-dist ${version}`);
if (info.license !== 'Apache-2.0') throw new Error(`pdfjs-dist ${version} is licensed ${info.license}, not Apache-2.0: review it before vendoring`);
const tarball = Buffer.from(await (await fetch(info.dist.tarball)).arrayBuffer());
const integrity = 'sha512-' + createHash('sha512').update(tarball).digest('base64');
if (integrity !== info.dist.integrity) throw new Error(`The download's integrity is ${integrity}; the registry says ${info.dist.integrity}`);

await mkdir(join(root, '.scratch'), { recursive: true });
const work = await mkdtemp(join(root, '.scratch/vendor-pdfjs-'));
try {
  await writeFile(join(work, 'package.tgz'), tarball);
  execFileSync('tar', ['-xzf', 'package.tgz', ...FILES.map((file) => `package/legacy/build/${file}`), 'package/LICENSE'], { cwd: work });
  await mkdir(out, { recursive: true });
  const lines = [];
  for (const file of FILES) {
    await copyFile(join(work, 'package/legacy/build', file), join(out, file));
    const bytes = await readFile(join(out, file));
    lines.push(`- \`${file}\`: ${bytes.length} bytes, SHA-256 \`${createHash('sha256').update(bytes).digest('hex')}\``);
  }
  await copyFile(join(work, 'package/LICENSE'), join(out, 'LICENSE'));
  const license = await readFile(join(out, 'LICENSE'));
  lines.push(`- \`LICENSE\`: ${license.length} bytes, SHA-256 \`${createHash('sha256').update(license).digest('hex')}\``);
  await writeFile(join(out, 'README.md'), `# PDF.js, as shipped inside Link Meteor

Link Meteor reads and combines PDFs with [PDF.js](https://mozilla.github.io/pdf.js/) by Mozilla, licensed under the Apache License 2.0 (see \`LICENSE\` in this folder). These files are copied unmodified from the legacy build of the npm package \`pdfjs-dist\`, and loaded only from inside the extension.

- Version: ${version}
- Source: ${info.dist.tarball}
- Package integrity: \`${info.dist.integrity}\`

Files:
${lines.join('\n')}

To update, a maintainer runs \`node scripts/vendor-pdfjs.mjs <version>\`, which checks the package's integrity value before copying. \`tests/vendor.test.mjs\` checks these files against the hashes above without contacting the network.
`);
  console.log(`Vendored pdfjs-dist ${version} into src/vendor/pdfjs:\n${lines.join('\n')}`);
} finally { await rm(work, { recursive: true, force: true }); }
