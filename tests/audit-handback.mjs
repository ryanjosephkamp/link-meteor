// Proportional report + final install-copy checks. Never tests Copy or reads clipboard data.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {serve} from './site-preview.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.LINK_METEOR_PLAYWRIGHT||resolve(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'docs/audit-0.2.0');
const prompt=await readFile(resolve(dir,'NEXT_PROMPT.txt'),'utf8');
const canonical=await readFile(resolve(dir,'REPORT.md'),'utf8');assert.ok(canonical.includes('```text\n'+prompt+'```'));
const report={started:new Date().toISOString(),checks:[],limits:['Full automated browser checks only; no mobile preview/device acceptance.','Copy and clipboard behavior deliberately not investigated.']};
const browser=await chromium.launch({env:{...process.env,TMPDIR:resolve(root,'.scratch/audit-0.2.0')}});
const site=await serve();
try{
 for(const javaScriptEnabled of [true,false]){
  const context=await browser.newContext({javaScriptEnabled});const page=await context.newPage();const requests=[];
  page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await page.goto(pathToFileURL(resolve(dir,'report.html')).href);
  assert.equal(await page.locator('h1').count(),1);assert.equal(await page.locator('#report-prompt').textContent(),prompt);
  assert.equal(await page.locator('img').count(),3);
  for(const img of await page.locator('img').all()){await img.scrollIntoViewIfNeeded();await img.evaluate(image=>image.decode());}
  assert.equal(await page.locator('img').evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth>0&&i.alt)),true);
  for(const width of [320,390,412,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  assert.deepEqual(requests,[]);report.checks.push({surface:'report',javaScriptEnabled,widths:[320,390,412,1440],promptExact:true,embeddedImages:3,noRemoteRequests:true});
  if(javaScriptEnabled){await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:resolve(root,'artifacts/audit-0.2.0/handback-mobile.png')});}
  await context.close();
 }
 for(const scheme of ['light','dark'])for(const width of [320,390,1440]){
  const page=await browser.newPage({viewport:{width,height:1000},colorScheme:scheme,reducedMotion:'reduce'});
  await page.goto(site.base+'/link-meteor/install.html',{waitUntil:'networkidle'});
  assert.match(await page.locator('body').innerText(),/0\.2\.1 audit checked/);assert.match(await page.locator('body').innerText(),/full capture and permission rerun is still pending/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(width===1440&&scheme==='light')await page.screenshot({path:resolve(root,'artifacts/audit-0.2.0/repair-ui/site-install.png')});
  report.checks.push({surface:'updated install copy',width,scheme,overflow:false});await page.close();
 }
 report.result='PASS';
}catch(error){report.result='FAIL';report.error=error.stack;process.exitCode=1;console.error(error);}
finally{await browser.close();await new Promise(done=>site.server.close(done));report.finished=new Date().toISOString();await writeFile(resolve(root,'artifacts/audit-0.2.0/handback-checks.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
