import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launch,fixtureServer,rpc,until,evidence} from './helpers/browser.mjs';
const result={started:new Date().toISOString(),checks:[],limits:['Single-machine synthetic measurement, not a cross-device performance guarantee.']};
const pass=(name,data={})=>{result.checks.push({name,...data});console.log('PASS',name,JSON.stringify(data));};
const fixture=await fixtureServer();let context;
try{
 const run=await launch(process.env.LINK_METEOR_TEST_PROFILE||'acceptance-final',{headless:false});context=run.context;
 for(const p of context.pages())await p.close();
 const page=await context.newPage();await page.goto(fixture.base+'/index.html?large');
 const ui=await context.newPage();await ui.goto(`chrome-extension://${run.id}/ui/workbench.html`);await ui.locator('#collection-heading').waitFor();
 const active=async()=>{const s=await rpc(ui,{type:'state.get'});return s.collections.find(c=>c.id===s.activeCollectionId);};
 await rpc(ui,{type:'state.mutate',action:{type:'collection.create',name:'Large synthetic collection'}});
 // Permission request must retain a real UI gesture. The prepared profile already has 127.0.0.1 access.
 await ui.locator('input[name=scope][value=selected]').check();await until(async()=>await ui.locator('#tab-options input').count()>0,'Tab inventory');
 for(const cb of await ui.locator('#tab-options input').all())await cb.uncheck();
 await ui.getByRole('checkbox',{name:'Include Meteor Research Lab — deterministic fixture',exact:true}).check();
 const start=performance.now();await ui.locator('#capture').click();await until(async()=>(await active()).links.length===5037,'Large capture',20000);
 await until(async()=>await ui.locator('.link-row').count()===100,'Bounded page rendering',10000);
 const elapsedMs=Math.round(performance.now()-start);
 assert.equal(await ui.locator('.occurrence').count(),0);pass('5,037 real page occurrences captured; only 100 top-level rows and no closed details rendered',{elapsedMs});
 await ui.locator('#select-all').check();await ui.locator('#page-next').click();assert.match(await ui.locator('#page-range').innerText(),/101–200/);assert.match(await ui.locator('#selection-count').innerText(),/100 occurrences selected overall/);assert.equal(await ui.locator('.row-select:checked').count(),0);
 await ui.locator('#page-prev').click();await ui.locator('#select-all').uncheck();
 await ui.locator('#format').selectOption('json');const pending=ui.waitForEvent('download');await ui.locator('#download').click();const download=await pending;assert.equal(JSON.parse(await readFile(await download.path(),'utf8')).length,5037);pass('Selection persists across pages and unselected export includes all 5,037 rows');
 await ui.locator('#search').fill('Large source 4999');await until(async()=>await ui.locator('.link-row').count()===1,'Large filter');assert.match(await ui.locator('#page-range').innerText(),/1–1/);pass('Filtering resets page and finds final loaded source');
 await ui.locator('#bookmark-name').fill('Link Meteor automated fixture');await ui.locator('#bookmark').click();await until(async()=>(await ui.locator('#notice').innerText()).includes('Created bookmark folder'),'Bookmark save',10000);
 const nodes=await ui.evaluate(()=>chrome.bookmarks.search({title:'Link Meteor automated fixture'}));const folder=nodes.at(-1);assert.ok(folder);const children=await ui.evaluate(id=>chrome.bookmarks.getChildren(id),folder.id);assert.equal(children.length,1);assert.equal(children[0].title,'Large source 4999');assert.equal(children[0].url,fixture.base+'/large/4999');pass('Actual bookmark folder contains correct anchor title and URL');
 const pagesBefore=context.pages().length;let confirmation='';ui.once('dialog',async d=>{confirmation=d.message();await d.accept();});await ui.locator('#open-links').click();await until(async()=>context.pages().length===pagesBefore+1,'Opened selected link');assert.match(confirmation,/Open 1 HTTP/);const opened=context.pages().find(p=>p!==ui&&p!==page);await opened.waitForLoadState();assert.equal(opened.url(),fixture.base+'/large/4999');await opened.close();pass('Bounded opener shows count and opens exact local destination');
 await ui.locator('#search').fill('');await ui.locator('#open-links').click();await until(async()=>(await ui.locator('#error').innerText()).includes('at most 20'),'Open limit');assert.equal(context.pages().length,pagesBefore);pass('Large open action rejected before opening any tabs');
 await rpc(ui,{type:'state.mutate',action:{type:'collection.create',name:'Grouped synthetic occurrences'}});
 const base=(await rpc(ui,{type:'state.get'})).collections.find(c=>c.name==='Large synthetic collection').links[0];
 const many=Array.from({length:350},(_,i)=>({...base,id:'group-'+i,anchorText:'Variant '+i}));
 await rpc(ui,{type:'state.mutate',action:{type:'links.append',links:many}});await until(async()=>await ui.locator('.link-row').count()===100,'Grouped rows before dedup');await ui.locator('#dedupe').selectOption('url');assert.equal(await ui.locator('.link-row').count(),1);assert.equal(await ui.locator('.occurrence').count(),0);
 await ui.locator('.row-details summary').click();await until(async()=>await ui.locator('.occurrence').count()===100,'First details page');await ui.getByRole('button',{name:'Show next 100 occurrences',exact:true}).click();await until(async()=>await ui.locator('.occurrence').count()===200,'Second details page');await ui.locator('.row-details summary').click();await until(async()=>await ui.locator('.occurrence').count()===0,'Collapsed detail cleanup');pass('Large duplicate group details load on demand in 100-occurrence increments');
 const single=(await active()).links[0];await ui.locator('.row-details summary').click();const note=ui.getByRole('textbox',{name:'Note for Variant 0',exact:true});await note.fill('Unsaved draft survives');
 await rpc(ui,{type:'state.mutate',action:{type:'collection.update',id:(await active()).id,patch:{tags:['refresh']}}});await new Promise(r=>setTimeout(r,250));assert.equal(await note.inputValue(),'Unsaved draft survives');await note.locator('xpath=ancestor::form').getByRole('button',{name:'Save',exact:true}).click();await until(async()=>(await active()).links[0].notes==='Unsaved draft survives','Per-link note');pass('Per-link draft survives background update and saves separately from anchor text');
 // Return the captured large collection to the smaller user-facing test dataset for later inspection.
 const primary=(await rpc(ui,{type:'state.get'})).collections.find(c=>c.name==='Browser acceptance');if(primary)await rpc(ui,{type:'state.mutate',action:{type:'collection.activate',id:primary.id}});
 result.result='PASS';
}catch(e){result.result='FAIL';result.error=e.stack;console.error(e);process.exitCode=1;}
finally{if(context)await context.close();await fixture.close();result.finished=new Date().toISOString();await writeFile(resolve(evidence,'extended-browser-results.json'),JSON.stringify(result,null,2)+'\n');}
