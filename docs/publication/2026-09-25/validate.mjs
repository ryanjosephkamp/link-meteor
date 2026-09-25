// Proposal-only validation: no extension, permission, personal profile or Copy tests.
import assert from 'node:assert/strict';
import {readFile,writeFile,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const dir=dirname(fileURLToPath(import.meta.url)),root=resolve(dir,'../../..');
const require=createRequire(import.meta.url);
const {chromium}=require('/Users/noir/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const prompt=await readFile(resolve(dir,'NEXT_PROMPT.txt'),'utf8');
const md=await readFile(resolve(dir,'REPORT.md'),'utf8');
const verification=JSON.parse(await readFile(resolve(dir,'START.json'),'utf8'));
assert.ok(md.includes('```text\n'+prompt+'```'));
assert.ok(md.includes(verification.archive.sha256));
const result={startedAt:new Date().toISOString(),result:'RUNNING',checks:[],limits:['Automated Chrome for Testing report layout only; no physical phone or in-app mobile preview acceptance.','Copy and clipboard intentionally not tested.','No extension or personal profile loaded. No new functional acceptance.']};
await writeFile(resolve(dir,'VALIDATION.json'),JSON.stringify(result,null,2)+'\n');
let browser;
try{
 browser=await chromium.launch({headless:true,env:{...process.env,TMPDIR:resolve(root,'.scratch/publication-01')}});
 for(const javaScriptEnabled of [true,false]){
  const context=await browser.newContext({javaScriptEnabled});
  const page=await context.newPage(); const external=[],errors=[];
  page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url())});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(resolve(dir,'report.html')).href);
  assert.equal(await page.locator('h1').count(),1);
  assert.equal(await page.locator('#report-prompt').textContent(),prompt);
  assert.ok((await page.locator('body').innerText()).includes('What was integrated and published'));
  assert.equal(await page.locator('img').count(),3);
  for(const img of await page.locator('img').all()){await img.scrollIntoViewIfNeeded();await img.evaluate(i=>i.decode());}
  assert.ok(await page.locator('img').evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth>0&&i.alt)));
  await page.evaluate(()=>scrollTo(0,0));
  let localLinks=0;
  for(const href of await page.locator('a[href]').evaluateAll(a=>a.map(x=>x.getAttribute('href')))){
   if(href.startsWith('#')) { assert.equal(await page.locator(href).count(),1); continue; }
   if(/^[a-z]+:/i.test(href))continue;
   await access(fileURLToPath(new URL(href,pathToFileURL(resolve(dir,'report.html')))));localLinks++;
  }
  for(const width of [320,390,412,1440]){
   await page.setViewportSize({width,height:900});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Overflow ${width}`);
   result.checks.push({javaScriptEnabled,width,overflow:false,promptExact:true,localLinksResolved:localLinks});
  }
  if(javaScriptEnabled){
   await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));
   await page.keyboard.press('Tab');
   const focused=await page.evaluate(()=>({tag:document.activeElement.tagName,visible:!!document.activeElement.getBoundingClientRect().width}));
   assert.ok(focused.visible&&focused.tag!=='BODY');
   await page.evaluate(()=>document.activeElement.blur());
   await page.screenshot({path:resolve(dir,'mobile-preview.png')});
   result.keyboardFocus=focused;
  }
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  await context.close();
 }
 result.result='PASS';result.embeddedImages=3;
}catch(e){result.result='FAIL';result.error=e.stack;process.exitCode=1;}
finally{if(browser)await browser.close();result.finishedAt=new Date().toISOString();result.taskBrowserClosed=true;await writeFile(resolve(dir,'VALIDATION.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));}
