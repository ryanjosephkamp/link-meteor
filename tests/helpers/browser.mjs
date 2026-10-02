import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile,readdir} from 'node:fs/promises';
import {mkdirSync} from 'node:fs';
import {resolve,extname,dirname} from 'node:path';
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
// LINK_METEOR_CHROME_PATH runs the suites on another Chrome for Testing build, such as the oldest supported one.
export const chromePath=()=>process.env.LINK_METEOR_CHROME_PATH ? resolve(root,process.env.LINK_METEOR_CHROME_PATH) : playwright.chromium.executablePath();
// Before Chrome 132 a bare --headless (what Playwright passes) is the old headless mode, which runs no extensions.
export const headlessArgs=(headless=true)=>headless&&process.env.LINK_METEOR_CHROME_PATH?['--headless=new']:[];

// Files behind links, for the download checks: a PDF, a PNG, a sign-in page where a PDF was
// expected (the paywall case), the PDF at an address without an extension, the PDF sent slowly
// (for Cancel), and a missing file.
const FILES={'/files/paper.pdf':['files/paper.pdf','application/pdf'],'/files/figure.png':['files/figure.png','image/png'],'/files/paywalled.pdf':['files/sign-in.html','text/html;charset=utf-8'],'/files/paper':['files/paper.pdf','application/pdf'],'/files/slow.pdf':['files/paper.pdf','application/pdf']};
// 0.6.0: the PDF fixtures (tests/fixtures/pdf), each at several kinds of address:
//   /pdf/<name>            shown by Chrome's PDF viewer
//   /pdf-plain/<name>      the same, at an address without ".pdf" (give the name without it)
//   /pdf-download/<name>   sent as a download (Content-Disposition: attachment)
//   /pdf-moved/<name>      redirects to the other fixture site's /pdf/<name>
//   /pdf-signin/<name>     a sign-in page where a PDF was expected
// and every file under tests/fixtures/site/ at /site/…, for pages a suite adds.
const SITE_TYPES={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.json':'application/json','.png':'image/png','.pdf':'application/pdf','.txt':'text/plain;charset=utf-8'};
async function fixtureFile(res,file,type,headers={}){
  try {const body=await readFile(resolve(root,'tests/fixtures',file));res.writeHead(200,{'Content-Type':type,'Content-Length':body.length,...headers});res.end(body);}
  catch {res.writeHead(404,{'Content-Type':'text/html;charset=utf-8'});res.end('<!doctype html><title>Not found</title><p>Not found');}
}
// fixtureServer({routes}): `routes(req, res, url)` may answer a request itself (return true), for
// pages that must behave: slow, redirecting, counting. Returns {base, other, server, close}:
// `other` is the same server as a second site (http://localhost:<port>), for frames, Next links
// and files on another site.
export async function fixtureServer({routes}={}) {
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,`http://${req.headers.host||'localhost'}`),pathname=url.pathname;
    if(routes&&await routes(req,res,url))return;
    const pdf=/^\/(pdf|pdf-plain|pdf-download|pdf-moved|pdf-signin)\/([a-z0-9-]+(?:\.pdf)?)$/.exec(pathname);
    if(pdf){
      const name=pdf[2].endsWith('.pdf')?pdf[2]:pdf[2]+'.pdf',port=server.address().port;
      if(pdf[1]==='pdf-moved'){res.writeHead(302,{Location:`http://localhost:${port}/pdf/${name}`});return res.end();}
      if(pdf[1]==='pdf-signin'){res.writeHead(200,{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'});return res.end('<!doctype html><title>Sign in</title><p>Please sign in to read this article.');}
      return fixtureFile(res,`pdf/${name}`,'application/pdf',{'Cache-Control':'max-age=600',...(pdf[1]==='pdf-download'?{'Content-Disposition':`attachment; filename="${name}"`}:{})});
    }
    if(pathname.startsWith('/site/')&&!pathname.split('/').includes('..')){
      const type=SITE_TYPES[pathname.slice(pathname.lastIndexOf('.'))];
      if(type)return fixtureFile(res,pathname.slice(1),type,{'Cache-Control':'no-store'});
    }
    if(FILES[pathname]){
      const [file,type]=FILES[pathname];
      try {
        const body=await readFile(resolve(root,'tests/fixtures',file));
        res.writeHead(200,{'Content-Type':type,'Content-Length':body.length,'Cache-Control':'no-store'});
        if(pathname!=='/files/slow.pdf')return res.end(body);
        // One byte every 100 ms: about a minute, so a download is still running when Cancel is pressed.
        let at=0;const timer=setInterval(()=>{if(res.destroyed||at>=body.length){clearInterval(timer);res.end();return;}res.write(body.subarray(at,at+1));at++;},100);
        req.on('close',()=>clearInterval(timer));
      } catch {res.writeHead(500);res.end('Fixture unavailable');}
      return;
    }
    if(pathname.startsWith('/files/')){res.writeHead(404,{'Content-Type':'text/html;charset=utf-8'});res.end('<!doctype html><title>Not found</title><p>Not found');return;}
    // 0.5.0: /research/<name>.html are the pages with citation tags and context blocks.
    const name=['/index.html','/frame.html','/empty.html','/files.html'].includes(pathname)||/^\/research\/[a-z0-9-]+\.html$/.test(pathname)?pathname:'/empty.html';
    try {const body=await readFile(resolve(root,'tests/fixtures'+name));res.writeHead(200,{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'});res.end(body);}
    catch {res.writeHead(500);res.end('Fixture unavailable');}
  });
  await new Promise((done,fail)=>{server.once('error',fail);server.listen(Number(process.env.LINK_METEOR_FIXTURE_PORT || 52478),'127.0.0.1',done);});
  const base=`http://127.0.0.1:${server.address().port}`,other=`http://localhost:${server.address().port}`;
  return {base,other,server,close:()=>new Promise(done=>{server.closeAllConnections?.();server.close(done);})};
}

// Downloads never reach the person's own downloads folder. Each profile downloads into its own
// .scratch/<profile>-downloads: Playwright saves downloads there (acceptDownloads), and Chrome's
// download folder preference points there too, for anything Playwright doesn't handle.
export const downloadsFolder=profile=>resolve(scratch,profile+'-downloads');
// Chrome for Testing also creates and at once removes a temporary file in the system's Downloads
// folder for each download, whatever folder it saves into. On macOS, a home folder for the browser
// under .scratch/ (CFFIXED_USER_HOME) keeps even that there. Returns the environment to add.
export function browserHome(home){mkdirSync(resolve(home,'Downloads'),{recursive:true});return process.platform==='darwin'?{CFFIXED_USER_HOME:home}:{};}
async function pointDownloads(profileDir,folder){
  const path=resolve(profileDir,'Default','Preferences');let prefs={};
  try{prefs=JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  prefs.download={...prefs.download,default_directory:folder,prompt_for_download:false,directory_upgrade:true};
  prefs.savefile={...prefs.savefile,default_directory:folder};
  await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(prefs));
}
// With chromeDownloads (tests/downloads-granted.mjs), Playwright's download handling is switched off,
// so Chrome saves, names and files downloads itself, as for a person. Chrome for Testing then uses
// the profile's download folder preference, and without it the system's Downloads folder, so the
// browser's home folder is under .scratch/ on Linux too (HOME), as on macOS. Nothing may download
// until Chrome's own settings page reports the profile's folder; otherwise the run stops here.
async function useChromeDownloads(context,folder){
  const page=await context.newPage();
  try{
    await page.goto('chrome://settings/downloads');
    await (await context.newCDPSession(page)).send('Browser.setDownloadBehavior',{behavior:'default'});
    const pref=name=>page.evaluate(name=>new Promise(done=>chrome.settingsPrivate.getPref(name,done)),name);
    const where=(await pref('download.default_directory'))?.value,ask=(await pref('download.prompt_for_download'))?.value;
    if(typeof where!=='string'||resolve(where)!==folder||ask!==false)throw new Error(`Chrome would save downloads to ${where} (asking: ${ask}), not ${folder}. Stopped before anything downloaded.`);
  }finally{await page.close();}
}

export async function launch(profile='acceptance',{headless=true,scale=1,args=[],chromeDownloads=false}={}) {
  await mkdir(scratch,{recursive:true});await mkdir(evidence,{recursive:true});
  const extension=resolve(root,process.env.LINK_METEOR_EXTENSION_PATH || 'dist');
  const hash=createHash('sha256');
  async function digest(dir){for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const path=resolve(dir,entry.name);if(entry.isDirectory())await digest(path);else{hash.update(path.slice(extension.length));hash.update(await readFile(path));}}}
  await digest(extension);const buildHash=hash.digest('hex');const fingerprint=resolve(scratch,profile+'-build.sha256');
  let previous;try{previous=(await readFile(fingerprint,'utf8')).trim();}catch(error){if(error.code!=='ENOENT')throw error;}
  if(previous&&previous!==buildHash)throw new Error('Build changed since this profile was initialized. Use LINK_METEOR_TEST_PROFILE with a fresh task-owned profile, prepare optional grants, and repeat checks.');
  await writeFile(fingerprint,buildHash+'\n');
  const downloads=downloadsFolder(profile);await mkdir(downloads,{recursive:true});await pointDownloads(resolve(scratch,profile),downloads);
  const home=resolve(scratch,profile+'-home');
  const context=await playwright.chromium.launchPersistentContext(resolve(scratch,profile),{
    executablePath:chromePath(),headless,
    viewport:{width:1440,height:1000},deviceScaleFactor:scale,acceptDownloads:true,downloadsPath:downloads,
    env:{...process.env,TMPDIR:scratch,...browserHome(home),...(chromeDownloads&&process.platform!=='win32'?{HOME:home}:{})},
    args:[...headlessArgs(headless),`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--disable-background-networking','--disable-component-update',`--disk-cache-dir=${resolve(scratch,profile+'-cache')}`,...args]
  });
  if(chromeDownloads){try{await useChromeDownloads(context,downloads);}catch(error){await context.close();throw error;}}
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
