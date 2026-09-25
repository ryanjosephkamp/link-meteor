// Real loaded-extension audit probes. No design mocks; results include observed old-build defects.
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launch,rpc,until,evidence} from './helpers/browser.mjs';
const result={started:new Date().toISOString(),checks:[],mode:process.env.LINK_METEOR_AUDIT_EXPECT_FIXED?'repair acceptance':'original-build observations'};
const {context,id}=await launch(process.env.LINK_METEOR_TEST_PROFILE||'audit-020-probes',{headless:true});
const fixed=!!process.env.LINK_METEOR_AUDIT_EXPECT_FIXED;
try{
 const ui=await context.newPage();await ui.goto(`chrome-extension://${id}/ui/workbench.html`);await ui.locator('#collection-heading').waitFor();
 await mkdir(resolve(evidence,'exports'),{recursive:true});
 const state=await rpc(ui,{type:'state.get'});const collection=state.activeCollectionId;
 const links=Array.from({length:205},(_,i)=>({id:`audit-${i}`,accessibleLabel:'',anchorText:`${i<105?'Alpha':'Beta'} ${i}`,url:`https://example.test/${i}`,originalHref:`/${i}`,sourceUrl:'https://source.test/',sourceTitle:'Audit fixture',frameUrl:'https://source.test/',capturedAt:'2026-09-25T21:00:00Z',batchId:i<105?'batch-a':'batch-b',notes:'',tags:[]}));
 links[0].anchorText='=SUM(A1:A3)';links[1].anchorText='';links[1].accessibleLabel='Image label';links[2].anchorText='Quotes \"雪\", two\nlines';links[3].anchorText='<b>literal markup</b>';
 await rpc(ui,{type:'state.mutate',action:{type:'links.append',links}});await ui.reload();await ui.locator('.row-select').first().waitFor();
 const inspect=async(name,fn)=>{try{const data=await fn();result.checks.push({name,result:'PASS',...data});}catch(e){result.checks.push({name,result:'FAIL',error:e.message});if(fixed)process.exitCode=1;}};
 await inspect('Row checkbox retains keyboard focus',async()=>{await ui.locator('.row-select').first().focus();await ui.keyboard.press('Space');await until(async()=>(await ui.locator('#selection-count').innerText()).includes('1 selected'),'selection');assert.equal(await ui.evaluate(()=>document.activeElement?.classList.contains('row-select')),true);});
 await inspect('Hidden selection cannot be removed through current view',async()=>{await ui.locator('#search').fill('Beta');assert.equal(await ui.locator('#remove').isDisabled(),true);});
 // Prove original destructive target and restore only the synthetic row using Undo.
 if(!await ui.locator('#remove').isDisabled()){await ui.locator('#remove').click();await until(async()=>(await rpc(ui,{type:'state.get'})).collections.find(c=>c.id===collection).links.length===204,'remove');result.hiddenRemovalObserved=true;await ui.locator('#undo').click();await until(async()=>(await rpc(ui,{type:'state.get'})).collections.find(c=>c.id===collection).links.length===205,'undo');}
 await ui.locator('#search').fill('');if(await ui.locator('#clear-selection').isVisible())await ui.locator('#clear-selection').click();await ui.locator('#select-all').check();
 await inspect('Select all N selects all205 and exports them',async()=>{await ui.locator('#select-everything').click();assert.match(await ui.locator('#selection-count').innerText(),/205 selected/);await ui.locator('#format').selectOption('json');const promise=ui.waitForEvent('download');await ui.locator('#download').click();const download=await promise;const path=resolve(evidence,'select-all.json');await download.saveAs(path);const {readFile}=await import('node:fs/promises');assert.equal(JSON.parse(await readFile(path,'utf8')).length,205);});
 for(const format of ['csv','tsv','xlsx','markdown','html','json','text']){await ui.locator('#format').selectOption(format);const promise=ui.waitForEvent('download');await ui.locator('#download').click();const dl=await promise;await dl.saveAs(resolve(evidence,'exports',`browser.${format==='markdown'?'md':format==='text'?'txt':format}`));}
 result.actualExportFormats=['csv','tsv','xlsx','markdown','html','json','text'];
 await ui.locator('#clear-selection').click();
 await ui.evaluate(()=>chrome.storage.session.set({linkMeteorCaptureReport:{report:{batchId:'batch-a',capturedCount:105,results:[{tabId:123,title:'Synthetic capture',url:'https://source.test/',status:'success',count:105,warning:'',error:''}]},createdAt:'2026-09-25T21:00:00Z'}}));await ui.reload();await ui.getByRole('button',{name:'Show only these links',exact:true}).waitFor();await ui.getByRole('button',{name:'Show only these links',exact:true}).click();
 await inspect('Batch filter shows exact matching count',async()=>{assert.match(await ui.locator('#result-count').innerText(),/105 of 205/);});
 await ui.evaluate(()=>chrome.storage.session.set({linkMeteorCaptureReport:{report:{batchId:'batch-b',capturedCount:100,results:[{tabId:124,title:'Newer synthetic capture',url:'https://source.test/',status:'success',count:100,warning:'',error:''}]},createdAt:'2026-09-25T21:01:00Z'}}));await until(async()=>(await ui.locator('#capture-report').innerText()).includes('100 links'),'new report');
 await inspect('Batch filter label does not misidentify older batch as latest',async()=>{assert.doesNotMatch(await ui.locator('#active-filters').innerText(),/latest capture/i);});
 const beforeSwitch=(await rpc(ui,{type:'state.get'}));await rpc(ui,{type:'state.mutate',action:{type:'collection.create',name:'Other audit collection'}});await until(async()=>(await ui.locator('#collection-heading').innerText())==='Other audit collection','switch');
 await inspect('Old report action absent in another collection',async()=>{assert.equal(await ui.getByRole('button',{name:/Show (only these|all) links/}).count(),0);});
 await rpc(ui,{type:'state.mutate',action:{type:'collection.activate',id:collection}});await until(async()=>(await ui.locator('#collection-heading').innerText())===beforeSwitch.collections.find(c=>c.id===collection).name,'return');
 // Changing UI/data must preserve schema1 and all original occurrence facts.
 await inspect('Schema1 occurrence identities and facts preserved',async()=>{const after=await rpc(ui,{type:'state.get'});assert.equal(after.schemaVersion,1);assert.deepEqual(after.collections.find(c=>c.id===collection).links,links);});
 result.result=result.checks.some(c=>c.result==='FAIL')?'DEFECTS OBSERVED':'PASS';
}catch(e){result.result='ERROR';result.error=e.stack;process.exitCode=1;}finally{await context.close();result.finished=new Date().toISOString();await writeFile(resolve(evidence,'audit-regressions.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));}
