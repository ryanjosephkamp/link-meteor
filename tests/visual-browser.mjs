// Loaded-extension presentation checks: responsive bounds, control labels, focus,
// measured contrast and screenshots of real states. Seeds a task-owned profile with
// the actual exported fixture occurrences; it is not a screen-reader or full WCAG audit.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launch,rpc,until,evidence} from './helpers/browser.mjs';
const result={started:new Date().toISOString(),checks:[],screenshots:[],limits:['Keyboard/label/contrast spot checks in automated Chrome for Testing, not a complete screen-reader or WCAG audit.','Compact widths render the workbench page at side-panel widths in a tab; the native side-panel frame itself is not captured.']};
const {context,id}=await launch(process.env.LINK_METEOR_VISUAL_PROFILE || 'visual-final',{headless:true});
const shot=async(page,name,options={})=>{await page.screenshot({path:resolve(evidence,name),animations:'disabled',...options});result.screenshots.push(name);};
const overflow=page=>page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
// Rasterizes any CSS color (including oklch) to sRGB, then computes WCAG contrast.
const contrast=(page,pairs)=>page.evaluate(pairs=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const rgb=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle='#000';ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3);};
  const lum=c=>c.map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
  const bg=el=>{for(let n=el;n;n=n.parentElement){const c=getComputedStyle(n).backgroundColor;if(c&&!/rgba\(0, 0, 0, 0\)|transparent/.test(c)&&!/\/ 0\)$/.test(c))return c;}return getComputedStyle(document.body).backgroundColor;};
  return pairs.map(([name,selector])=>{const el=document.querySelector(selector);if(!el)return {name,missing:true};const a=lum(rgb(getComputedStyle(el).color)),b=lum(rgb(bg(el)));return {name,ratio:Math.round(((Math.max(a,b)+.05)/(Math.min(a,b)+.05))*100)/100};});},pairs);
try{
 const ui=await context.newPage();await ui.goto(`chrome-extension://${id}/ui/workbench.html`);
 await ui.locator('#collection-heading').waitFor();// Seed with real captured occurrences: this run's browser-suite export, or an explicit earlier export (LINK_METEOR_SEED_JSON).
 const seed=process.env.LINK_METEOR_SEED_JSON?resolve(import.meta.dirname,'..',process.env.LINK_METEOR_SEED_JSON):resolve(evidence,'exports/browser.json');result.seed=seed.slice(resolve(import.meta.dirname,'..').length+1);
 const seedData=JSON.parse(await readFile(seed,'utf8'));const rows=Array.isArray(seedData)?seedData:seedData.rows;// 0.2.2 exports are an array; 0.3.0 Export panel JSON is {about, rows}.
 await rpc(ui,{type:'state.mutate',action:{type:'collection.create',name:'Research sources'}});
 const active=(await rpc(ui,{type:'state.get'})).activeCollectionId;
 await rpc(ui,{type:'state.mutate',action:{type:'collection.update',id:active,patch:{notes:'Synthetic fixture captures for checking labels, provenance and exports.',tags:['fixture','research']}}});
 await rpc(ui,{type:'state.mutate',action:{type:'links.append',links:rows.map(r=>r.occurrences[0])}});await until(async()=>await ui.locator('.link-row').count()>0,'Rows');
 for(const width of [320,390,412,900,1440]){await ui.setViewportSize({width,height:1000});assert.equal(await overflow(ui),false,`overflow at ${width}`);result.checks.push({width,view:'links',horizontalOverflow:false});}
 for(const view of ['collections','export']){await ui.setViewportSize({width:320,height:900});await ui.locator(view==='export'?'#dock-export':'#collection-switch').click();assert.equal(await overflow(ui),false);result.checks.push({width:320,view,horizontalOverflow:false});await ui.locator(view==='export'?'#export-done':'#rail-done').click();}

 await ui.setViewportSize({width:1440,height:1000});await ui.evaluate(()=>scrollTo(0,0));await shot(ui,'workbench-desktop.png');
 const pairs=[['muted summary','#collection-summary'],['destructive action','#delete-collection'],['link action','#shortcut-settings'],['field label','label[for="hold-key"]'],['help text','#hold-help'],['tag help','#tags-help'],['input text','#collection-tags'],['toolbar count','#result-count'],['row URL','.cell-url .url'],['source cell','.cell-source'],['primary button','#capture']];
 await ui.locator('#edit-collection').click();const light=await contrast(ui,pairs);await ui.locator('#cancel-edit').click();
 await ui.locator('#filters-toggle').click();await ui.locator('#dedupe').selectOption('url');await ui.locator('.row-details summary').first().click();await ui.locator('#review').scrollIntoViewIfNeeded();await shot(ui,'workbench-review.png');
 await ui.locator('#dedupe').selectOption('none');await ui.locator('#filters-toggle').click();await ui.evaluate(()=>scrollTo(0,0));
 await ui.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await ui.waitForTimeout(250);await shot(ui,'workbench-dark.png');
 await ui.locator('#edit-collection').click();const dark=(await contrast(ui,pairs)).map(entry=>({...entry,name:'dark '+entry.name}));await ui.locator('#cancel-edit').click();
 for(const entry of [...light,...dark]){assert.ok(!entry.missing,`${entry.name} missing`);assert.ok(entry.ratio>=4.5,`${entry.name} contrast ${entry.ratio}`);}
 result.checks.push({measuredTextContrast:[...light,...dark]});
 await ui.setViewportSize({width:390,height:844});await ui.evaluate(()=>scrollTo(0,0));await ui.waitForTimeout(250);await shot(ui,'panel-dark.png');
 await ui.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});await ui.waitForTimeout(250);await shot(ui,'workbench-narrow.png');
 await ui.locator('#dock-export').click();await shot(ui,'panel-export.png',{fullPage:true});await ui.locator('#export-done').click();
 await ui.locator('#collection-switch').click();await shot(ui,'panel-collections.png');await ui.locator('#rail-done').click();
 await ui.keyboard.press('Tab');assert.ok(await ui.evaluate(()=>document.activeElement!==document.body));
 const focusRing=await ui.evaluate(()=>{const el=document.activeElement;const s=getComputedStyle(el);return {tag:el.tagName,outline:s.outlineStyle,width:s.outlineWidth};});assert.notEqual(focusRing.outline,'none');
 const labels=await ui.evaluate(()=>[...document.querySelectorAll('input,select,textarea,button')].filter(e=>e.getClientRects().length&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')&&!e.labels?.length&&!(e.tagName==='BUTTON'&&e.textContent.trim())).map(e=>e.id||e.outerHTML.slice(0,80)));assert.deepEqual(labels,[]);
 result.checks.push({unlabeledFormControls:0,keyboardFocusReachedControl:true,firstFocusRing:focusRing});
 // About and help: exact outbound links, version from the manifest, and nothing opens on its own.
 const aboutLinks=['https://ryanjosephkamp.github.io/','https://ryanjosephkamp.github.io/link-meteor/guide.html','https://github.com/ryanjosephkamp/link-meteor/issues','https://ryanjosephkamp.github.io/link-meteor/','https://github.com/ryanjosephkamp/link-meteor','https://github.com/sponsors/ryanjosephkamp'];
 const pagesBefore=context.pages().length;
 await ui.setViewportSize({width:1440,height:1000});assert.equal(await ui.locator('#about-panel').evaluate(d=>d.open),false,'About starts collapsed');
 await ui.locator('#help-toggle').click();await ui.waitForTimeout(150);
 const about=await ui.evaluate(()=>({open:document.getElementById('about-panel').open,focused:document.activeElement?.id,version:document.getElementById('about-version').textContent,manifest:chrome.runtime.getManifest().version,links:[...document.querySelectorAll('#about-panel a')].map(a=>({href:a.href,target:a.target,rel:a.rel,text:a.textContent.trim()}))}));
 assert.equal(about.open,true);assert.equal(about.focused,'about-summary');assert.equal(about.version,'v'+about.manifest);
 assert.deepEqual(about.links.map(l=>l.href),aboutLinks);assert.ok(about.links.every(l=>l.target==='_blank'&&/noopener/.test(l.rel)&&l.text));
 await shot(ui,'workbench-about.png');
 await ui.setViewportSize({width:390,height:844});await ui.locator('#about-panel').evaluate(d=>{d.open=false;});
 await ui.locator('#help-toggle').focus();await ui.keyboard.press('Enter');await ui.waitForTimeout(250);
 const compact=await ui.evaluate(()=>({view:document.getElementById('app').dataset.view,open:document.getElementById('about-panel').open,focused:document.activeElement?.id}));
 assert.deepEqual(compact,{view:'collections',open:true,focused:'about-summary'});
 await shot(ui,'panel-about.png');
 await ui.keyboard.press('Escape');await ui.waitForTimeout(150);assert.equal(await ui.evaluate(()=>document.getElementById('app').dataset.view),'links');
 assert.equal(context.pages().length,pagesBefore,'No tab opened without a click');
 result.checks.push({aboutAndHelp:{links:about.links.length,version:about.version,startsCollapsed:true,keyboardCompact:true,noAutomaticNavigation:true}});
 const collection=(await rpc(ui,{type:'state.get'})).activeCollectionId;await rpc(ui,{type:'state.mutate',action:{type:'collection.update',id:collection,patch:{name:'L'.repeat(120)}}});await until(async()=>(await ui.locator('#collection-heading').innerText()).length===120,'Long name');
 for(const width of [320,390,1440]){await ui.setViewportSize({width,height:900});assert.equal(await overflow(ui),false);}result.checks.push({longCollectionNameOverflow:false,widths:[320,390,1440]});
 await rpc(ui,{type:'state.mutate',action:{type:'collection.create',name:'Empty collection'}});await ui.setViewportSize({width:390,height:760});await until(async()=>(await ui.locator('#empty-state h3').innerText()).includes('Start'),'Empty state');await shot(ui,'panel-empty.png');
 result.result='PASS';
}catch(e){result.result='FAIL';result.error=e.stack;console.error(e);process.exitCode=1;}finally{await context.close();result.finished=new Date().toISOString();await writeFile(resolve(evidence,'visual-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({result:result.result,checks:result.checks.length,screenshots:result.screenshots}));}
