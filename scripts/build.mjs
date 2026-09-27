import {cp,mkdir,readFile,readdir,rm,stat} from 'node:fs/promises';
import {resolve,dirname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FIXED_FILES,releaseFiles} from './release-files.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source = resolve(root,'src'), out = resolve(root,'dist');
const manifest = JSON.parse(await readFile(resolve(source,'manifest.json'),'utf8'));
for (const file of [...FIXED_FILES,...Object.values(manifest.icons)]) await stat(resolve(source,file));
const sourceFiles = [];
async function list(dir) { for (const entry of await readdir(dir,{withFileTypes:true})) { const p = resolve(dir,entry.name); if (entry.isDirectory()) await list(p); else sourceFiles.push(relative(source,p).split(sep).join('/')); } }
await list(source);
const release = releaseFiles(sourceFiles,manifest);
if (manifest.manifest_version !== 3 || manifest.host_permissions?.length) throw new Error('Unexpected manifest/required host permission');
await rm(out,{recursive:true,force:true});
await mkdir(out,{recursive:true});
await cp(source,out,{recursive:true});
let bytes=0,files=0;
async function walk(dir) { for(const entry of await readdir(dir,{withFileTypes:true})){const p=resolve(dir,entry.name); if(entry.isDirectory())await walk(p);else{bytes+=(await stat(p)).size;files++;}} }
await walk(out);
if (files !== release.length) throw new Error(`dist has ${files} files; the release list has ${release.length}`);
console.log(JSON.stringify({version:manifest.version,out,files,bytes}));
