// Loaded packaged content module + real extension messaging/storage on an extension page.
// This isolates receipt/concurrency behavior without claiming ordinary-site access or native gesture acceptance.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launch,rpc,until,evidence} from './helpers/browser.mjs';
const result={started:new Date().toISOString(),checks:[],limits:['Actual packaged content code and real Chrome storage/messages, hosted on an extension page with synthetic links.','Not evidence of an ordinary webpage grant, native activation, or the main geometry suites.']};
const {context,id}=await launch(process.env.LINK_METEOR_TEST_PROFILE||'audit-overlay',{headless:true});
const fixed=process.env.LINK_METEOR_AUDIT_EXPECT_FIXED==='1';
try{
 const page=await context.newPage();await page.goto(`chrome-extension://${id}/ui/workbench.html`);await page.locator('#collection-heading').waitFor();
 await rpc(page,{type:'state.mutate',action:{type:'collection.create',name:'Destination Alpha'}});
 await page.addScriptTag({url:`chrome-extension://${id}/content/capture.js`});
 await page.evaluate(()=>{const section=document.createElement('div');section.id='audit-links';section.style.cssText='position:fixed;left:40px;top:150px;width:210px;height:180px;z-index:500;background:white';for(let i=0;i<5;i++){const a=document.createElement('a');a.href=`https://synthetic.example/${i}`;a.textContent=`Audit source ${i}`;a.style.cssText='display:block;width:180px;height:24px';section.append(a);}document.body.append(section);});
 const overlay=page.locator('#link-meteor-overlay');
 const arm=async()=>{await page.evaluate(()=>globalThis.__linkMeteor.arm());await overlay.waitFor();await page.mouse.move(39,149);await page.mouse.down();await page.mouse.move(251,280,{steps:8});await page.mouse.up();assert.match(await overlay.locator('.count').innerText(),/^5 links/);};
 await arm();await until(async()=>(await overlay.locator('.dest').innerText()).includes('Destination Alpha'),'initial destination');
 const beta=await rpc(page,{type:'state.mutate',action:{type:'collection.create',name:'Destination Beta'}});
 const inspect=async(name,fn)=>{try{await fn();result.checks.push({name,result:'PASS'});}catch(e){result.checks.push({name,result:'FAIL',error:e.message});if(fixed)process.exitCode=1;}};
 await new Promise(r=>setTimeout(r,150));
 await inspect('Open overlay reflects a changed active collection',async()=>assert.match(await overlay.locator('.dest').innerText(),/Destination Beta/));
 await overlay.getByRole('button',{name:'Add to collection',exact:true}).click();await until(async()=>(await overlay.locator('.status').innerText()).startsWith('Saved'),'saved');
 const saved=await rpc(page,{type:'state.get'});assert.equal(saved.collections.find(c=>c.id===beta.activeCollectionId).links.length,5);
 await inspect('Saved receipt names the actual destination',async()=>{assert.match(await overlay.locator('.status').innerText(),/Destination Beta/);assert.match(await overlay.locator('.dest').innerText(),/Saved to Destination Beta/);});
 await rpc(page,{type:'state.mutate',action:{type:'collection.create',name:'Destination Gamma'}});await new Promise(r=>setTimeout(r,100));
 await inspect('Saved destination is stable after later collection changes',async()=>assert.match(await overlay.locator('.dest').innerText(),/Saved to Destination Beta/));
 await page.screenshot({path:resolve(evidence,'overlay-destination.png')});await page.keyboard.press('Escape');await arm();
 const before=await rpc(page,{type:'state.get'});const active=before.activeCollectionId;const count=before.collections.find(c=>c.id===active).links.length;
 // Dispatch two save actions in the same event-loop turn to exercise an overlapping request.
 await overlay.evaluate(host=>{host.shadowRoot.querySelector('button.add').click();host.shadowRoot.querySelector('button.review').click();});
 await until(async()=>(await overlay.locator('.status').innerText()).startsWith('Saved'),'concurrent save');await new Promise(r=>setTimeout(r,150));
 await inspect('Overlapping Add and Review save the region once',async()=>{const after=await rpc(page,{type:'state.get'});assert.equal(after.collections.find(c=>c.id===active).links.length,count+5);});
 result.result=result.checks.every(c=>c.result==='PASS')?'PASS':'DEFECTS OBSERVED';
}catch(e){result.result='ERROR';result.error=e.stack;process.exitCode=1;}finally{await context.close();result.finished=new Date().toISOString();await writeFile(resolve(evidence,'audit-overlay.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));}
