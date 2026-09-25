import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
const require=createRequire(import.meta.url);
let playwright;
try { playwright=require('playwright'); }
catch { playwright=require(process.env.LINK_METEOR_PLAYWRIGHT || resolve(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
export const root=resolve(import.meta.dirname,'../..');
export const scratch=resolve(root,'.scratch');
export const evidence=resolve(root,'artifacts/evidence');

export async function fixtureServer() {
  const server=createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    const name=['/index.html','/frame.html','/empty.html'].includes(pathname)?pathname:'/empty.html';
    try {const body=await readFile(resolve(root,'tests/fixtures'+name));res.writeHead(200,{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'});res.end(body);}
    catch {res.writeHead(500);res.end('Fixture unavailable');}
  });
  await new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done);});
  const base=`http://127.0.0.1:${server.address().port}`;
  return {base,server,close:()=>new Promise(done=>server.close(done))};
}

export async function launch(profile='acceptance',{headless=true}={}) {
  await mkdir(scratch,{recursive:true});await mkdir(evidence,{recursive:true});
  const extension=resolve(root,'dist');
  const context=await playwright.chromium.launchPersistentContext(resolve(scratch,profile),{
    executablePath:playwright.chromium.executablePath(),headless,
    viewport:{width:1440,height:1000},acceptDownloads:true,
    env:{...process.env,TMPDIR:scratch},
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--disable-background-networking','--disable-component-update',`--disk-cache-dir=${resolve(scratch,profile+'-cache')}`]
  });
  let worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker',{timeout:15000});
  const initialId=new URL(worker.url()).host;
  // Reload then open an extension page to wake the freshly loaded background worker.
  await worker.evaluate(()=>chrome.runtime.reload()).catch(()=>{});
  const bootstrap=await context.newPage();
  try {
    await bootstrap.goto(`chrome-extension://${initialId}/ui/workbench.html`);
    await bootstrap.waitForFunction(()=>typeof chrome?.runtime?.sendMessage==='function');
    await bootstrap.evaluate(()=>chrome.runtime.sendMessage({type:'state.get'}));
    worker=context.serviceWorkers().find(next=>new URL(next.url()).host===initialId) || await context.waitForEvent('serviceworker',{timeout:15000});
  } catch(error) { await context.close(); throw error; }
  await bootstrap.close();
  const id=new URL(worker.url()).host;
  await writeFile(resolve(scratch,'runtime.json'),JSON.stringify({owner:'Link Meteor acceptance',nodePid:process.pid,profile:resolve(scratch,profile),extension,id,headless,started:new Date().toISOString()},null,2));
  return {context,worker,id};
}

export const rpc=(page,message)=>page.evaluate(async message=>{const result=await chrome.runtime.sendMessage(message);if(!result?.ok)throw new Error(result?.error || 'No response');return result.data;},message);
export async function until(fn,message,timeout=5000) {
  const start=Date.now();let last;
  while(Date.now()-start<timeout){last=await fn();if(last)return last;await new Promise(done=>setTimeout(done,50));}
  throw new Error(message+' (timed out)');
}
