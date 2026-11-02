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
 await ui.locator('#select-all').check();await ui.locator('#page-next').click();assert.match(await ui.locator('#page-range').innerText(),/101–200/);assert.match(await ui.locator('#selection-count').innerText(),/^100 selected · 0 on this page$/);assert.equal(await ui.locator('.row-select:checked').count(),0);
 await ui.locator('#page-prev').click();await ui.locator('#select-all').uncheck();
 await ui.locator('#format').selectOption('json');const pending=ui.waitForEvent('download');await ui.locator('#download').click();const download=await pending;const exported=JSON.parse(await readFile(await download.path(),'utf8'));assert.deepEqual(Object.keys(exported),['about','rows']);assert.equal(exported.rows.length,5037);assert.equal(exported.about.count,5037);pass('Selection persists across pages and unselected export includes all 5,037 rows');
 await ui.locator('#search').fill('Large source 4999');await until(async()=>await ui.locator('.link-row').count()===1,'Large filter');assert.match(await ui.locator('#page-range').innerText(),/1–1/);pass('Filtering resets page and finds final loaded source');
 await ui.locator('#bookmark-name').fill('Link Meteor automated fixture');await ui.locator('#bookmark').click();await until(async()=>(await ui.locator('#notice').innerText()).includes('Created bookmark folder'),'Bookmark save',10000);
 const nodes=await ui.evaluate(()=>chrome.bookmarks.search({title:'Link Meteor automated fixture'}));const folder=nodes.at(-1);assert.ok(folder);const children=await ui.evaluate(id=>chrome.bookmarks.getChildren(id),folder.id);assert.equal(children.length,1);assert.equal(children[0].title,'Large source 4999');assert.equal(children[0].url,fixture.base+'/large/4999');pass('Actual bookmark folder contains correct anchor title and URL');
 // 0.3.0 bookmark folders (needs bookmark access in this profile): the picker lists real folders by path and searches them,
 // saving into an existing folder skips links already there (on by default) or saves repeats when turned off, and nothing else changes.
 const treeBefore=await ui.evaluate(()=>chrome.bookmarks.getTree());
 await ui.locator('#bookmark-mode input[value=existing]').check();await until(async()=>await ui.locator('#bookmark-folder option').count()>0,'Real folders listed',10000);
 // The parent's name comes from Chrome ("Other Bookmarks" in Chrome for Testing, "Other bookmarks" in some builds).
 const folderPath=`${(await ui.evaluate(id=>chrome.bookmarks.get(id),folder.parentId))[0].title} › Link Meteor automated fixture`;
 const listed=await rpc(ui,{type:'bookmarks.folders'});assert.ok(listed.folders.some(f=>f.id===folder.id&&f.path===folderPath&&f.depth===1));assert.ok(!listed.folders.some(f=>f.id==='0'));
 assert.equal(await ui.locator('#bookmark-folder option').count(),listed.folders.length);
 await ui.locator('#bookmark-folder-search').fill('automated other');const matches=await ui.locator('#bookmark-folder option').count();assert.ok(matches>=1&&matches<listed.folders.length);assert.match(await ui.locator('#bookmark-folder-status').innerText(),new RegExp(`^${matches} of ${listed.folders.length} folders\\.`));
 await ui.locator('#bookmark-folder').selectOption(folder.id);assert.ok((await ui.locator('#bookmark-folder-status').innerText()).endsWith(`Saves to ${folderPath}.`));
 assert.equal(await ui.locator('#bookmark-skip-existing').isChecked(),true);
 await ui.locator('#bookmark').click();await until(async()=>(await ui.locator('#notice').innerText()).startsWith(`Saved to “${folderPath}”: 0 saved, 1 skipped (already in the folder), 0 failed.`),'Skip existing',10000);
 await ui.locator('#search').fill('Large source 499');await until(async()=>await ui.locator('.link-row').count()===11,'Eleven sources');
 await ui.locator('#bookmark').click();await until(async()=>(await ui.locator('#notice').innerText()).startsWith(`Saved to “${folderPath}”: 10 saved, 1 skipped (already in the folder), 0 failed.`),'Existing folder save',10000);
 await ui.locator('#search').fill('Large source 4999');await until(async()=>await ui.locator('.link-row').count()===1,'Back to one source');
 await ui.locator('#bookmark-skip-existing').uncheck();await ui.locator('#bookmark').click();await until(async()=>(await ui.locator('#notice').innerText()).startsWith(`Saved to “${folderPath}”: 1 saved, 0 skipped`),'Repeat saved with Skip off',10000);await ui.locator('#bookmark-skip-existing').check();
 const filled=await ui.evaluate(id=>chrome.bookmarks.getChildren(id),folder.id);assert.equal(filled.length,12);assert.deepEqual(filled.map(b=>b.url).sort(),[...Array.from({length:9},(_,i)=>fixture.base+'/large/'+(4990+i)),fixture.base+'/large/4999',fixture.base+'/large/4999',fixture.base+'/large/499'].sort());
 const strip=node=>({...node,dateGroupModified:undefined,children:node.id===folder.id?undefined:node.children?.map(strip)});assert.deepEqual(strip((await ui.evaluate(()=>chrome.bookmarks.getTree()))[0]),strip(treeBefore[0]),'no other bookmark changed');
 await ui.locator('#bookmark-folder-search').fill('');await ui.locator('#bookmark-mode input[value=new]').check();
 pass('Existing bookmark folder: real folders listed by path and searchable, skip-existing counts, repeats saved only with Skip off, other bookmarks unchanged',{folders:listed.folders.length,matches});
 const pagesBefore=context.pages().length;assert.equal(await ui.locator('#open-label').innerText(),'Open 1 web link');await ui.locator('#open-links').click();assert.equal(await ui.locator('#open-confirm').isVisible(),false,'1 to 20 links open without a confirmation');await until(async()=>context.pages().length===pagesBefore+1,'Opened selected link');const opened=context.pages().find(p=>p!==ui&&p!==page);await opened.waitForLoadState();assert.equal(opened.url(),fixture.base+'/large/4999');await opened.close();pass('Opener shows the count and opens up to 20 links at once, at the exact local destination');
 await ui.locator('#search').fill('');await ui.locator('#open-links').click();await until(async()=>(await ui.locator('#error').innerText()).includes('opens at most 500'),'Open limit');assert.equal(context.pages().length,pagesBefore);assert.equal(await ui.locator('#open-confirm').isVisible(),false);pass('An open action above 500 links (5,037) is rejected before opening any tabs');
 await rpc(ui,{type:'state.mutate',action:{type:'collection.create',name:'Grouped synthetic occurrences'}});
 const base=(await rpc(ui,{type:'state.get'})).collections.find(c=>c.name==='Large synthetic collection').links[0];
 const many=Array.from({length:350},(_,i)=>({...base,id:'group-'+i,anchorText:'Variant '+i}));
 await rpc(ui,{type:'state.mutate',action:{type:'links.append',links:many}});await until(async()=>await ui.locator('.link-row').count()===100,'Grouped rows before dedup');await ui.locator('#filters-toggle').click();await ui.locator('#dedupe').selectOption('url');assert.equal(await ui.locator('.link-row').count(),1);assert.equal(await ui.locator('.occurrence').count(),0);
 await ui.locator('.row-details summary').click();await until(async()=>await ui.locator('.occurrence').count()===100,'First details page');await ui.getByRole('button',{name:'Show next 100 occurrences',exact:true}).click();await until(async()=>await ui.locator('.occurrence').count()===200,'Second details page');await ui.locator('.row-details summary').click();await until(async()=>await ui.locator('.occurrence').count()===0,'Collapsed detail cleanup');pass('Large duplicate group details load on demand in 100-occurrence increments');
 const single=(await active()).links[0];await ui.locator('.row-details summary').click();const note=ui.getByRole('textbox',{name:'Note for Variant 0',exact:true});await note.fill('Unsaved draft survives');
 await rpc(ui,{type:'state.mutate',action:{type:'collection.update',id:(await active()).id,patch:{tags:['refresh']}}});await new Promise(r=>setTimeout(r,250));assert.equal(await note.inputValue(),'Unsaved draft survives');await note.locator('xpath=ancestor::form').getByRole('button',{name:'Save',exact:true}).click();await until(async()=>(await active()).links[0].notes==='Unsaved draft survives','Per-link note');pass('Per-link draft survives background update and saves separately from anchor text');
 // 0.5.0 Import links from a bookmark folder (needs bookmark access in this profile, so Chrome shows no prompt): a small real folder made
 // here with chrome.bookmarks, read with its subfolder, imported into a new collection with folder paths (a repeated bookmark skipped),
 // undone, and removed again, leaving every other bookmark as it was.
 const importTreeBefore=await ui.evaluate(()=>chrome.bookmarks.getTree());
 const importRoot=await ui.evaluate(async base=>{const root=await chrome.bookmarks.create({title:'Link Meteor import fixture'});await chrome.bookmarks.create({parentId:root.id,title:'Heat and Health Lab',url:base+'/large/1'});
  const labs=await chrome.bookmarks.create({parentId:root.id,title:'Labs'});await chrome.bookmarks.create({parentId:labs.id,title:'Urban Canopy Group',url:base+'/large/2'});await chrome.bookmarks.create({parentId:labs.id,title:'Heat and Health Lab',url:base+'/large/1'});return root;},fixture.base);
 try{
  const importPath=`${(await ui.evaluate(id=>chrome.bookmarks.get(id),importRoot.parentId))[0].title} › Link Meteor import fixture`;
  const collectionBefore=(await rpc(ui,{type:'state.get'})).activeCollectionId;
  await ui.locator('#import-bookmarks').click();await until(async()=>await ui.locator('#import-folder option').count()>0,'Import: real folders listed',10000);
  await ui.locator('#import-folder-search').fill('Link Meteor import fixture');await ui.locator('#import-folder').selectOption(importRoot.id);
  assert.ok((await ui.locator('#import-folder-status').innerText()).endsWith(`Imports from ${importPath}.`));assert.equal(await ui.locator('#import-subfolders').isChecked(),true);
  await ui.locator('#import-read-folder').click();await until(()=>ui.locator('#import-plan').isVisible(),'Import: folder preview',10000);
  assert.equal(await ui.locator('#import-source').innerText(),`From the bookmark folder ${importPath} and its subfolders · 3 bookmarks`);
  assert.deepEqual(await ui.evaluate(()=>[...document.querySelectorAll('#import-table tbody tr')].map(row=>[row.cells[1].textContent,row.cells[row.cells.length-1].textContent])),[['Heat and Health Lab',''],['Urban Canopy Group',''],['Heat and Health Lab','Repeats row 1']]);
  assert.equal(await ui.locator('#import-destination option:checked').innerText(),'A new collection “Link Meteor import fixture”');
  await ui.locator('#import-commit').click();await until(async()=>(await ui.locator('#notice').innerText()).includes('Imported 2 links into “Link Meteor import fixture”.'),'Import: imported',10000);
  const importedState=await rpc(ui,{type:'state.get'});const importedHome=importedState.collections.find(c=>c.id===importedState.activeCollectionId);
  assert.deepEqual(importedHome.links.map(l=>[l.anchorText,l.url,l.imported,l.sourceUrl]),[['Heat and Health Lab',fixture.base+'/large/1','Bookmarks › Link Meteor import fixture',''],['Urban Canopy Group',fixture.base+'/large/2','Bookmarks › Link Meteor import fixture › Labs','']]);
  await ui.locator('#notice button',{hasText:'Undo'}).click();await until(async()=>(await ui.locator('#notice').innerText()).includes('Import undone: removed 2 links and the collection “Link Meteor import fixture”.'),'Import: undone',10000);
  const undoneState=await rpc(ui,{type:'state.get'});assert.equal(undoneState.activeCollectionId,collectionBefore);assert.ok(!undoneState.collections.some(c=>c.name==='Link Meteor import fixture'));
  pass('Import links from a real bookmark folder with its subfolder: folder paths kept, a repeated bookmark skipped, and undone',{folder:importPath});
 }finally{await ui.evaluate(id=>chrome.bookmarks.removeTree(id).catch(()=>{}),importRoot.id);}
 const importStrip=node=>({...node,dateGroupModified:undefined,children:node.children?.map(importStrip)});assert.deepEqual(importStrip((await ui.evaluate(()=>chrome.bookmarks.getTree()))[0]),importStrip(importTreeBefore[0]),'the import fixture folder is gone and no other bookmark changed');
 // Return the captured large collection to the smaller user-facing test dataset for later inspection.
 const primary=(await rpc(ui,{type:'state.get'})).collections.find(c=>c.name==='Browser acceptance');if(primary)await rpc(ui,{type:'state.mutate',action:{type:'collection.activate',id:primary.id}});
 result.result='PASS';
}catch(e){result.result='FAIL';result.error=e.stack;console.error(e);process.exitCode=1;}
finally{if(context)await context.close();await fixture.close();result.finished=new Date().toISOString();await writeFile(resolve(evidence,'extended-browser-results.json'),JSON.stringify(result,null,2)+'\n');}
