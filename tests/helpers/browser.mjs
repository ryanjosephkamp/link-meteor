import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile,readdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
const require=createRequire(import.meta.url);
// Exported for suites that launch Chrome for Testing themselves (see action.mjs).
export let playwright;
try { playwright=require('playwright'); }
catch { playwright=require(process.env.LINK_METEOR_PLAYWRIGHT || resolve(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
export const root=resolve(import.meta.dirname,'../..');
export const scratch=resolve(root,'.scratch');
export const evidence=resolve(root,process.env.LINK_METEOR_EVIDENCE_DIR || 'artifacts/evidence');

export async function fixtureServer() {
  const server=createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    const name=['/index.html','/frame.html','/empty.html'].includes(pathname)?pathname:'/empty.html';
    try {const body=await readFile(resolve(root,'tests/fixtures'+name));res.writeHead(200,{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'});res.end(body);}
    catch {res.writeHead(500);res.end('Fixture unavailable');}
  });
  await new Promise((done,fail)=>{server.once('error',fail);server.listen(Number(process.env.LINK_METEOR_FIXTURE_PORT || 52478),'127.0.0.1',done);});
  const base=`http://127.0.0.1:${server.address().port}`;
  return {base,server,close:()=>new Promise(done=>server.close(done))};
}

export async function launch(profile='acceptance',{headless=true,scale=1,args=[]}={}) {
  await mkdir(scratch,{recursive:true});await mkdir(evidence,{recursive:true});
  const extension=resolve(root,process.env.LINK_METEOR_EXTENSION_PATH || 'dist');
  const hash=createHash('sha256');
  async function digest(dir){for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const path=resolve(dir,entry.name);if(entry.isDirectory())await digest(path);else{hash.update(path.slice(extension.length));hash.update(await readFile(path));}}}
  await digest(extension);const buildHash=hash.digest('hex');const fingerprint=resolve(scratch,profile+'-build.sha256');
  let previous;try{previous=(await readFile(fingerprint,'utf8')).trim();}catch(error){if(error.code!=='ENOENT')throw error;}
  if(previous&&previous!==buildHash)throw new Error('Build changed since this profile was initialized. Use LINK_METEOR_TEST_PROFILE with a fresh task-owned profile, prepare optional grants, and repeat checks.');
  await writeFile(fingerprint,buildHash+'\n');
  const context=await playwright.chromium.launchPersistentContext(resolve(scratch,profile),{
    executablePath:playwright.chromium.executablePath(),headless,
    viewport:{width:1440,height:1000},deviceScaleFactor:scale,acceptDownloads:true,
    env:{...process.env,TMPDIR:scratch},
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--disable-background-networking','--disable-component-update',`--disk-cache-dir=${resolve(scratch,profile+'-cache')}`,...args]
  });
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker',{timeout:15000});
  const id=new URL(worker.url()).host;
  await writeFile(resolve(scratch,'runtime.json'),JSON.stringify({owner:'Link Meteor acceptance',nodePid:process.pid,profile:resolve(scratch,profile),extension,id,buildHash,headless,started:new Date().toISOString()},null,2));
  return {context,worker,id};
}

export const rpc=(page,message)=>page.evaluate(async message=>{const result=await chrome.runtime.sendMessage(message);if(!result?.ok)throw new Error(result?.error || 'No response');return result.data;},message);
export async function until(fn,message,timeout=5000) {
  const start=Date.now();let last;
  while(Date.now()-start<timeout){last=await fn();if(last)return last;await new Promise(done=>setTimeout(done,50));}
  throw new Error(message+' (timed out)');
}
