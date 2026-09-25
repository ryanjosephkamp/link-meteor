// Actual packaged workbench/background on synthetic stored data. No capture grant is assumed.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launch,fixtureServer,rpc,until,evidence} from './helpers/browser.mjs';
const result={started:new Date().toISOString(),checks:[],limits:['Synthetic occurrences are inserted via the real reducer; this does not establish webpage capture or bookmark/host grants.','No native permission prompt or everyday Chrome profile is exercised.']};
const pass=name=>{result.checks.push(name);console.log('PASS',name);};
const fixture=await fixtureServer();let context;
const profile=process.env.LINK_METEOR_TEST_PROFILE||'audit-actions';
try{
 let run=await launch(profile,{headless:true});context=run.context;
 let ui=await context.newPage();const url=`chrome-extension://${run.id}/ui/workbench.html`;await ui.goto(url);await ui.locator('#collection-heading').waitFor();
 await ui.locator('#new-collection').fill('Audit actions');await ui.locator('#create-collection button').click();
 const active=async()=>{const state=await rpc(ui,{type:'state.get'});return state.collections.find(c=>c.id===state.activeCollectionId);};
 await until(async()=>(await active()).name==='Audit actions','create');
 const links=Array.from({length:21},(_,i)=>({id:`action-${i}`,anchorText:`Local source ${i}`,accessibleLabel:'',url:`${fixture.base}/empty.html?source=${i}`,originalHref:`/empty.html?source=${i}`,sourceUrl:fixture.base+'/index.html',sourceTitle:'Synthetic audit actions',frameUrl:fixture.base+'/index.html',capturedAt:'2026-09-25T21:00:00Z',batchId:'actions',notes:'',tags:[]}));
 await rpc(ui,{type:'state.mutate',action:{type:'links.append',links}});await until(async()=>await ui.locator('.link-row').count()===21,'rows');
 await ui.locator('#edit-collection').click();await ui.locator('#collection-notes').fill('Preserve notes separately');await ui.locator('#collection-tags').fill('research, audit');await ui.locator('#collection-details button[type=submit]').click();
 await until(async()=>(await active()).notes==='Preserve notes separately','notes');assert.deepEqual((await active()).tags,['research','audit']);pass('Collection creation, notes and tags save through the UI');
 const pagesBefore=context.pages().length;await ui.locator('#open-links').click();await until(async()=>(await ui.locator('#error').innerText()).includes('at most 20'),'limit');assert.equal(context.pages().length,pagesBefore);
 await assert.rejects(rpc(ui,{type:'links.open',urls:links.map(l=>l.url)}),/20/);assert.equal(context.pages().length,pagesBefore);pass('Both UI and background reject 21 links before opening tabs');
 await ui.locator('#search').fill('Local source 20');await ui.locator('#open-links').click();assert.equal(await ui.locator('#open-confirm-text').innerText(),'Open 1 web link in new background tabs?');assert.equal(context.pages().length,pagesBefore);
 await ui.locator('#search').fill('Local source 19');assert.equal(await ui.locator('#open-confirm-yes').isVisible(),false);assert.equal(context.pages().length,pagesBefore);pass('Changing the target invalidates inline confirmation without opening a tab');
 await ui.locator('#open-links').click();await ui.locator('#open-confirm-yes').click();await until(async()=>context.pages().length===pagesBefore+1,'open one');const opened=context.pages().find(p=>!p.url().startsWith('chrome-extension:')&&p.url()!=='about:blank');assert.ok(opened);await opened.waitForLoadState();assert.equal(opened.url(),links[19].url);await opened.close();pass('Explicit inline confirmation opens exactly the selected local URL');
 await ui.locator('#search').fill('');await ui.locator('.row-select').nth(3).check();await ui.locator('#remove').click();await until(async()=>(await active()).links.length===20,'remove');await ui.locator('#undo').click();await until(async()=>(await active()).links.length===21,'undo');assert.deepEqual((await active()).links,links);pass('Visible removal and positional Undo preserve all occurrence fields');
 await rpc(ui,{type:'state.mutate',action:{type:'links.append',links:[{...links[0],id:'action-duplicate',anchorText:'Another label'}]}});await until(async()=>await ui.locator('.link-row').count()===22,'duplicate');await ui.locator('#filters-toggle').click();await ui.locator('#dedupe').selectOption('url');assert.equal(await ui.locator('.link-row').count(),21);await ui.locator('#dedupe').selectOption('none');assert.equal(await ui.locator('.link-row').count(),22);pass('Reversible URL grouping keeps separately labeled occurrences');
 await ui.locator('.row-details summary').first().click();const note=ui.getByRole('textbox',{name:'Note for Local source 0',exact:true});await note.fill('Unsubmitted local note');await rpc(ui,{type:'state.mutate',action:{type:'collection.update',id:(await active()).id,patch:{tags:['research','audit','refresh']}}});await until(async()=>(await active()).tags.length===3,'state refresh');assert.equal(await note.inputValue(),'Unsubmitted local note');await note.locator('xpath=ancestor::form').getByRole('button',{name:'Save',exact:true}).click();await until(async()=>(await active()).links[0].notes==='Unsubmitted local note','link note');assert.equal((await active()).links[0].anchorText,links[0].anchorText);pass('Per-link note draft survives a state update and leaves anchor text untouched');
 const fixturePage=await context.newPage();await fixturePage.goto(fixture.base+'/index.html');const tabId=await ui.evaluate(()=>chrome.tabs.query({})).then(tabs=>tabs.find(tab=>tab.id&& !tab.url)?.id);assert.ok(tabId);
 const denied=(await rpc(ui,{type:'capture.run',tabIds:[tabId,987654321]})).report;assert.deepEqual(denied.results.map(r=>r.status),['denied','error']);assert.equal(denied.capturedCount,0);assert.equal((await active()).links.length,22);pass('Real missing-grant and closed-tab failures preserve the existing collection');
 const saved=await rpc(ui,{type:'state.get'});await context.close();context=null;run=await launch(profile,{headless:true});context=run.context;ui=await context.newPage();await ui.goto(url);assert.deepEqual(await rpc(ui,{type:'state.get'}),saved);pass('Exact schema-v1 state survives a full isolated browser and worker restart');
 result.result='PASS';
}catch(error){result.result='FAIL';result.error=error.stack;console.error(error);process.exitCode=1;}
finally{if(context)await context.close();await fixture.close();result.finished=new Date().toISOString();await writeFile(resolve(evidence,'audit-actions.json'),JSON.stringify(result,null,2)+'\n');}
