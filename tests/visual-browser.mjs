// Loaded-extension presentation checks: responsive bounds, control labels, focus,
// measured contrast and screenshots of real states. Seeds a task-owned profile with
// the actual exported fixture occurrences; it is not a screen-reader or full WCAG audit.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launch,rpc,until,evidence} from './helpers/browser.mjs';
import {THEME_IDS,THEMES} from '../src/core/themes.js';
const result={started:new Date().toISOString(),checks:[],screenshots:[],limits:['Keyboard/label/contrast spot checks in automated Chrome for Testing, not a complete screen-reader or WCAG audit.','Compact widths render the workbench page at side-panel widths in a tab; the native side-panel frame itself is not captured.']};
const {context,id,worker}=await launch(process.env.LINK_METEOR_VISUAL_PROFILE || 'visual-final',{headless:true});
const shot=async(page,name,options={})=>{await page.screenshot({path:resolve(evidence,name),animations:'disabled',...options});result.screenshots.push(name);};
// Measure the settled layout: after a resize, wait two animation frames so media queries and layout have caught up.
const overflow=page=>page.evaluate(async()=>{await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));return document.documentElement.scrollWidth>innerWidth;});
// Rasterizes any CSS color (including oklch) to sRGB, then computes WCAG contrast.
const contrast=(page,pairs)=>page.evaluate(pairs=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const rgb=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle='#000';ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3);};
  const lum=c=>c.map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
  const bg=el=>{for(let n=el;n;n=n.parentElement){const c=getComputedStyle(n).backgroundColor;if(c&&!/rgba\(0, 0, 0, 0\)|transparent/.test(c)&&!/\/ 0\)$/.test(c))return c;}return getComputedStyle(document.body).backgroundColor;};
  return pairs.map(([name,selector])=>{const el=document.querySelector(selector);if(!el)return {name,missing:true};const a=lum(rgb(getComputedStyle(el).color)),b=lum(rgb(bg(el)));return {name,ratio:Math.round(((Math.max(a,b)+.05)/(Math.min(a,b)+.05))*100)/100};});},pairs);
// 0.4.0 toolbar icon: record what the service worker passes to chrome.action.setIcon (and still set it).
// On Chrome 116, Playwright's view of the service worker has no extension APIs (the extension's own pages do),
// so the toolbar icon can't be recorded there; the rest of the suite still runs, and the results say so.
const workerApis=await worker.evaluate(()=>typeof chrome.action?.setIcon==='function');
if(workerApis)await worker.evaluate(()=>{globalThis.__iconCalls=[];const set=chrome.action.setIcon.bind(chrome.action);chrome.action.setIcon=details=>{globalThis.__iconCalls.push(details.imageData?{imageData:Object.fromEntries(Object.entries(details.imageData).map(([size,image])=>[size,{width:image.width,height:image.height,data:[...image.data]}]))}:{path:details.path});return set(details);};});
else result.limits.push('Toolbar icon not checked: in this Chrome version the test tool cannot reach the service worker\'s extension APIs.');
const iconCalls=()=>workerApis?worker.evaluate(()=>globalThis.__iconCalls):Promise.resolve([]);
// Rasterizes CSS colors in the page, as sRGB bytes.
const rasterize=(page,colors)=>page.evaluate(colors=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d',{willReadFrequently:true});return colors.map(color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3);});},colors);
try{
 const ui=await context.newPage();await ui.goto(`chrome-extension://${id}/ui/workbench.html`);
 await ui.locator('#collection-heading').waitFor();
 // 0.3.0 welcome card: a fresh profile shows it once. One screenshot, contrast in both themes, then answer it with Choose sites later.
 await until(async()=>await ui.locator('#welcome').isVisible(),'Welcome card on a fresh profile');
 const welcomePairs=[['welcome title','#welcome-title'],['welcome help','.welcome .help'],['welcome allow','#welcome-allow']];
 await ui.setViewportSize({width:390,height:844});await shot(ui,'panel-welcome.png');
 const welcomeLight=await contrast(ui,welcomePairs);await ui.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await ui.waitForTimeout(250);
 const welcomeDark=(await contrast(ui,welcomePairs)).map(entry=>({...entry,name:'dark '+entry.name}));await ui.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
 for(const entry of [...welcomeLight,...welcomeDark]){assert.ok(!entry.missing,`${entry.name} missing`);assert.ok(entry.ratio>=4.5,`${entry.name} contrast ${entry.ratio}`);}
 await ui.locator('#welcome-later').click();await until(async()=>!(await ui.locator('#welcome').isVisible()),'Welcome card answered');
 result.checks.push({welcomeCard:{shownOnFreshProfile:true,answeredWith:'Choose sites later',contrast:[...welcomeLight,...welcomeDark]}});
 await ui.setViewportSize({width:1440,height:1000});
 // Seed with real captured occurrences: this run's browser-suite export, or an explicit earlier export (LINK_METEOR_SEED_JSON).
 const seed=process.env.LINK_METEOR_SEED_JSON?resolve(import.meta.dirname,'..',process.env.LINK_METEOR_SEED_JSON):resolve(evidence,'exports/browser.json');result.seed=seed.slice(resolve(import.meta.dirname,'..').length+1);
 const seedData=JSON.parse(await readFile(seed,'utf8'));const rows=Array.isArray(seedData)?seedData:seedData.rows;// 0.2.2 exports are an array; 0.3.0 Export panel JSON is {about, rows}.
 await rpc(ui,{type:'state.mutate',action:{type:'collection.create',name:'Research sources'}});
 const active=(await rpc(ui,{type:'state.get'})).activeCollectionId;
 await rpc(ui,{type:'state.mutate',action:{type:'collection.update',id:active,patch:{notes:'Synthetic fixture captures for checking labels, provenance and exports.',tags:['fixture','research']}}});
 await rpc(ui,{type:'state.mutate',action:{type:'links.append',links:rows.map(r=>r.occurrences[0])}});await until(async()=>await ui.locator('.link-row').count()>0,'Rows');
 for(const width of [320,390,412,900,1440]){await ui.setViewportSize({width,height:1000});assert.equal(await overflow(ui),false,`overflow at ${width}`);result.checks.push({width,view:'links',horizontalOverflow:false});}
 for(const view of ['collections','export']){await ui.setViewportSize({width:320,height:900});await ui.locator(view==='export'?'#dock-export':'#collection-switch').click();assert.equal(await overflow(ui),false);result.checks.push({width:320,view,horizontalOverflow:false});await ui.locator(view==='export'?'#export-done':'#rail-done').click();}

 // One exception, so the Never on these sites list has an entry to measure.
 await rpc(ui,{type:'state.mutate',action:{type:'settings.update',patch:{holdExceptions:['https://maps.example.com']}}});await until(async()=>await ui.locator('.exception-item .origin').count()>0,'Exception listed');
 await ui.setViewportSize({width:1440,height:1000});await ui.evaluate(()=>scrollTo(0,0));await shot(ui,'workbench-desktop.png');
 const pairs=[['all-sites help','#all-sites-help'],['hold trigger help','#hold-trigger-help'],['exception origin','.exception-item .origin'],['muted summary','#collection-summary'],['destructive action','#delete-collection'],['link action','#shortcut-settings'],['field label','label[for="hold-key"]'],['help text','#hold-help'],['tag help','#tags-help'],['input text','#collection-tags'],['toolbar count','#result-count'],['row URL','.cell-url .url'],['source cell','.cell-source'],['primary button','#capture']];
 await ui.locator('#edit-collection').click();const light=await contrast(ui,pairs);await ui.locator('#cancel-edit').click();
 await ui.locator('#filters-toggle').click();await ui.locator('#dedupe').selectOption('url');await ui.locator('.row-details summary').first().click();await ui.locator('#review').scrollIntoViewIfNeeded();await shot(ui,'workbench-review.png');
 await ui.locator('#dedupe').selectOption('none');await ui.locator('#filters-toggle').click();await ui.evaluate(()=>scrollTo(0,0));
 await ui.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await ui.waitForTimeout(250);await shot(ui,'workbench-dark.png');
 await ui.locator('#edit-collection').click();const dark=(await contrast(ui,pairs)).map(entry=>({...entry,name:'dark '+entry.name}));await ui.locator('#cancel-edit').click();
 for(const entry of [...light,...dark]){assert.ok(!entry.missing,`${entry.name} missing`);assert.ok(entry.ratio>=4.5,`${entry.name} contrast ${entry.ratio}`);}
 result.checks.push({measuredTextContrast:[...light,...dark]});

 // 0.4.0 themes: every theme in light and dark, switched through settings.update: contrast of the existing pairs and the new
 // controls, no horizontal overflow at 320 px (links and settings), a side-panel screenshot, and the toolbar icon each theme sets.
 const themePairs=[...pairs,['theme name','.theme-choice:not(:has(input:checked)) .theme-name'],['chosen theme name','.theme-choice:has(input:checked) .theme-name'],['theme description','#theme-blurb'],['scheme choice','.scheme-mode .seg:not(:has(input:checked))'],['chosen scheme','.scheme-mode .seg:has(input:checked)'],['appearance help','#appearance-help'],['after-drag choice','.choice-list .choice span'],['after-drag help','#after-drag-help'],['copy format','#after-drag-format'],['capture default','.rail-check span'],['capture default help','#content-only-help']];
 await rpc(ui,{type:'state.mutate',action:{type:'settings.update',patch:{afterDrag:'copy'}}});await until(async()=>await ui.locator('#after-drag-format').isVisible(),'Copy format shown');
 const applied=(page,theme,scheme)=>page.evaluate(([theme,scheme])=>document.documentElement.dataset.theme===theme&&document.documentElement.dataset.scheme===scheme&&document.querySelector('input[name="theme"]:checked')?.value===theme,[theme,scheme]);
 const themeResults=[],icons={};
 for(const theme of THEME_IDS)for(const scheme of ['light','dark']){
  const callsBefore=(await iconCalls()).length,changed=(await rpc(ui,{type:'state.get'})).settings.theme!==theme;
  await ui.setViewportSize({width:1440,height:1000});await rpc(ui,{type:'state.mutate',action:{type:'settings.update',patch:{theme,appearance:scheme}}});
  await until(()=>applied(ui,theme,scheme),`${theme} ${scheme} applied`);
  await ui.locator('#edit-collection').click();const measured=await contrast(ui,themePairs);await ui.locator('#cancel-edit').click();
  for(const entry of measured){assert.ok(!entry.missing,`${theme} ${scheme} ${entry.name} missing`);assert.ok(entry.ratio>=4.5,`${theme} ${scheme} ${entry.name} contrast ${entry.ratio}`);}
  await ui.setViewportSize({width:320,height:900});const links=await overflow(ui);await ui.locator('#collection-switch').click();const settings=await overflow(ui);await ui.locator('#rail-done').click();
  assert.equal(links,false,`${theme} ${scheme}: overflow at 320`);assert.equal(settings,false,`${theme} ${scheme}: settings overflow at 320`);
  await ui.setViewportSize({width:390,height:844});await ui.evaluate(()=>{scrollTo(0,0);document.getElementById('notice').hidden=true;});const screenshot=`panel-theme-${theme}-${scheme}.png`;await shot(ui,screenshot);
  if(changed&&workerApis){await until(async()=>(await iconCalls()).length>callsBefore,`${theme} toolbar icon`);icons[theme]=(await iconCalls()).at(-1);}
  themeResults.push({theme,scheme,horizontalOverflowAt320:{links,settings},screenshot,contrast:measured});
 }
 // Back to Meteor: the manifest's own icons. Every other theme: the mark drawn at 16 and 32 px, tile and head in the theme's colors.
 const iconChecks=[];
 if(!workerApis)await rpc(ui,{type:'state.mutate',action:{type:'settings.update',patch:{theme:'meteor',appearance:'system',afterDrag:'card'}}});
 else{
 const callsBeforeMeteor=(await iconCalls()).length;await rpc(ui,{type:'state.mutate',action:{type:'settings.update',patch:{theme:'meteor',appearance:'system',afterDrag:'card'}}});
 await until(async()=>(await iconCalls()).length>callsBeforeMeteor,'Meteor toolbar icon');icons.meteor=(await iconCalls()).at(-1);
 const manifestIcons=await ui.evaluate(()=>chrome.runtime.getManifest().action.default_icon);assert.deepEqual(icons.meteor,{path:manifestIcons},'Meteor sets the packaged icons');
 const pixel=(image,x,y)=>image.data.slice((y*image.width+x)*4,(y*image.width+x)*4+4);
 const near=(a,b)=>a.every((v,i)=>Math.abs(v-b[i])<=3);
 for(const theme of THEME_IDS.filter(theme=>theme!=='meteor')){
  const call=icons[theme];assert.ok(call?.imageData,`${theme} sets drawn icons`);assert.deepEqual(Object.keys(call.imageData).sort(),['16','32']);
  const [head,tile]=await rasterize(ui,[THEMES[theme].highlight,THEMES[theme].light['mark-tile']]);
  for(const [size,headAt,tileAt] of [['16',[10,5],[13,14]],['32',[20,11],[26,26]]]){
   const image=call.imageData[size];assert.equal(image.width,Number(size));
   const [h,t]=[pixel(image,...headAt),pixel(image,...tileAt)];
   assert.ok(near(h.slice(0,3),head)&&h[3]===255,`${theme} ${size} px head ${h} is ${head}`);assert.ok(near(t.slice(0,3),tile)&&t[3]===255,`${theme} ${size} px tile ${t} is ${tile}`);
  }
  iconChecks.push({theme,sizes:[16,32],head:THEMES[theme].highlight,tile:THEMES[theme].light['mark-tile']});
 }
 // A strip of every toolbar icon, drawn from the image data the service worker set, next to the packaged Meteor icon.
 const iconUrls=await ui.evaluate(icons=>Promise.all(Object.entries(icons).map(async([theme,call])=>[theme,await Promise.all(['32','16'].map(async size=>{
  if(call.path)return new Promise(async done=>{const reader=new FileReader();reader.onload=()=>done(reader.result);reader.readAsDataURL(await (await fetch(chrome.runtime.getURL(call.path[size]))).blob());});
  const image=call.imageData[size],canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(image.data),image.width,image.height),0,0);return canvas.toDataURL();}))])).then(Object.fromEntries),icons);
 const strip=await context.newPage();await strip.setViewportSize({width:760,height:160});
 await strip.setContent(`<body style="margin:0;padding:12px;background:#dfe3ea;display:flex;gap:14px;align-items:flex-end;font:12px system-ui">${THEME_IDS.map(theme=>`<figure style="margin:0;display:grid;gap:4px;justify-items:center"><img src="${iconUrls[theme][0]}" alt="" style="width:64px;height:64px;image-rendering:pixelated"><img src="${iconUrls[theme][1]}" alt="" style="width:32px;height:32px;image-rendering:pixelated"><figcaption>${THEMES[theme].name}</figcaption></figure>`).join('')}</body>`);
 await strip.evaluate(()=>Promise.all([...document.images].map(image=>image.decode())));await shot(strip,'toolbar-icons.png');await strip.close();
 }

 // The theme picker and System, Light or Dark work from the keyboard, with a visible focus ring.
 await ui.setViewportSize({width:1440,height:1000});await ui.locator('input[name="theme"][value="meteor"]').focus();await ui.keyboard.press('ArrowRight');
 await until(async()=>(await rpc(ui,{type:'state.get'})).settings.theme==='comet','Arrow key saves the next theme');
 const pickerFocus=await ui.evaluate(()=>({value:document.activeElement.value,ring:getComputedStyle(document.activeElement.closest('.theme-choice')).outlineStyle,theme:document.documentElement.dataset.theme}));
 assert.deepEqual(pickerFocus,{value:'comet',ring:'solid',theme:'comet'});
 await ui.locator('input[name="appearance"][value="system"]').focus();await ui.keyboard.press('ArrowRight');
 await until(async()=>(await rpc(ui,{type:'state.get'})).settings.appearance==='light','Arrow key saves Light');
 assert.equal(await ui.evaluate(()=>document.documentElement.dataset.scheme),'light');
 // After a drag: each choice saves at once; the copy format shows only for Copy right away.
 await ui.locator('.choice:has(input[value="add"])').click();await until(async()=>(await rpc(ui,{type:'state.get'})).settings.afterDrag==='add','Add right away saved');
 assert.equal(await ui.locator('#after-drag-format').isVisible(),false);
 await ui.locator('.choice:has(input[value="copy"])').click();await until(async()=>await ui.locator('#after-drag-format').isVisible(),'Copy format shown');
 await ui.locator('#after-drag-format').selectOption('rich');await ui.locator('#content-only').check();await ui.locator('#skip-saved').check();
 await until(async()=>{const s=(await rpc(ui,{type:'state.get'})).settings;return s.afterDrag==='copy'&&s.afterDragFormat==='rich'&&s.contentOnly&&s.skipSaved;},'Capture defaults saved');
 await ui.locator('.after-drag').evaluate(section=>{section.closest('.rail').scrollTop=section.offsetTop-12;});await shot(ui,'workbench-settings.png',{clip:{x:0,y:0,width:260,height:1000}});await ui.locator('#rail').evaluate(rail=>{rail.scrollTop=0;});
 // The first frame already has the cached theme and scheme: a fresh page records them in its first animation frame, which runs
 // before that frame is painted.
 await rpc(ui,{type:'state.mutate',action:{type:'settings.update',patch:{theme:'ember',appearance:'dark'}}});await until(()=>applied(ui,'ember','dark'),'Ember dark applied');
 const boot=await context.newPage();
 await boot.addInitScript(()=>{requestAnimationFrame(()=>{const root=document.documentElement;globalThis.__firstFrame={theme:root?.dataset.theme||null,scheme:root?.dataset.scheme||null,themeStyle:!!document.getElementById('theme'),bodyBackground:document.body?getComputedStyle(document.body).backgroundColor:null};});});
 await boot.goto(`chrome-extension://${id}/ui/workbench.html`);await boot.locator('#collection-heading').waitFor();
 const firstFrame=await boot.evaluate(()=>({...globalThis.__firstFrame,renderBlocking:document.querySelector('script[type="module"]').blocking.contains('render')}));
 const [emberDark]=await rasterize(boot,[THEMES.ember.dark.bg]);
 assert.deepEqual([firstFrame.theme,firstFrame.scheme,firstFrame.themeStyle,firstFrame.renderBlocking],['ember','dark',true,true],JSON.stringify(firstFrame));
 assert.deepEqual((await rasterize(boot,[firstFrame.bodyBackground]))[0],emberDark,'first frame background');
 await boot.close();
 await rpc(ui,{type:'state.mutate',action:{type:'settings.update',patch:{theme:'meteor',appearance:'system',afterDrag:'card',afterDragFormat:'tsv',contentOnly:false,skipSaved:false}}});
 await until(async()=>await ui.evaluate(()=>document.documentElement.dataset.theme==='meteor'&&!document.getElementById('after-drag-format').checkVisibility()),'Back to Meteor and Show the card');
 result.checks.push({themes:{switchedThrough:'settings.update',results:themeResults},toolbarIcon:workerApis?{meteor:icons.meteor,drawn:iconChecks,screenshot:'toolbar-icons.png'}:'not checked in this Chrome version (see limits)',appearanceKeyboard:{arrowKeySavesTheme:true,focusRing:pickerFocus.ring,arrowKeySavesAppearance:true},afterDrag:{choicesSaved:true,copyFormatOnlyForCopy:true},firstFrame});
 // 0.3.0 states that are hard to hold still: the stronger confirmation comes from a real 150-link target (nothing opens); the
 // all-sites note and the opening progress line are shown with sample text in their real elements, with their real styles.
 await rpc(ui,{type:'state.mutate',action:{type:'collection.create',name:'Opening check'}});
 const many=Array.from({length:150},(_,i)=>({id:`visual-open-${i}`,anchorText:`Source ${i}`,accessibleLabel:'',url:`https://example.test/source/${i}`,originalHref:`/source/${i}`,sourceUrl:'https://example.test/list',sourceTitle:'Synthetic opening check',frameUrl:'',capturedAt:'2026-09-27T00:00:00.000Z',batchId:'visual-open',notes:'',tags:[]}));
 await rpc(ui,{type:'state.mutate',action:{type:'links.append',links:many}});await until(async()=>/150 links/.test(await ui.locator('#collection-summary').innerText()),'Opening check rows');
 const pagesBeforeOpen=context.pages().length;await ui.locator('#open-links').click();await until(async()=>await ui.locator('#open-confirm.open-confirm-strong').isVisible(),'Stronger confirmation above 100');
 await ui.evaluate(()=>{const note=document.getElementById('all-sites-note');note.textContent='Chrome no longer lets Link Meteor read every site, so hold-key drag runs only on the sites you chose.';note.hidden=false;document.getElementById('open-progress-text').textContent='Opening 10 of 150 links…';document.getElementById('open-progress').hidden=false;});
 const statePairs=[['strong confirmation','#open-confirm-text'],['all-sites note','#all-sites-note'],['opening progress','#open-progress-text']];
 const stateDark=(await contrast(ui,statePairs)).map(entry=>({...entry,name:'dark '+entry.name}));await ui.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});await ui.waitForTimeout(250);
 const stateLight=await contrast(ui,statePairs);
 for(const entry of [...stateLight,...stateDark]){assert.ok(!entry.missing,`${entry.name} missing`);assert.ok(entry.ratio>=4.5,`${entry.name} contrast ${entry.ratio}`);}
 await ui.evaluate(()=>{document.getElementById('open-progress').hidden=true;});await ui.keyboard.press('Escape');assert.equal(await ui.locator('#open-confirm').isVisible(),false);assert.equal(context.pages().length,pagesBeforeOpen,'No tab opened');
 await rpc(ui,{type:'state.mutate',action:{type:'collection.activate',id:active}});await until(async()=>(await ui.locator('#collection-heading').innerText())==='Research sources','Back to Research sources');
 result.checks.push({stateContrast:{strongConfirmationFromRealTarget:true,sampleTextIn:['#all-sites-note','#open-progress-text'],results:[...stateLight,...stateDark]}});
 await ui.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await ui.waitForTimeout(250);
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
 // 0.5.0 reading status, stars, link details and Insights, in every theme and scheme: measured contrast of the new badges, details,
 // switch, selection actions, view options and Insights cards; no horizontal overflow at 320 px; a side-panel screenshot of each.
 const review='https://review.example.net/articles/cooling-cities',at=(d)=>new Date(Date.UTC(2026,7,3+d,10)).toISOString();
 const R=(id,anchorText,url,d,extra={})=>({id,anchorText,accessibleLabel:'',url,originalHref:url,sourceUrl:review,sourceTitle:'Cooling cities: a review of street-level interventions',frameUrl:'',capturedAt:at(d),batchId:`visual-research-${d>6?2:1}`,notes:'',tags:[],...extra});
 await rpc(ui,{type:'state.mutate',action:{type:'collection.create',name:'Research details'}});
 await rpc(ui,{type:'state.mutate',action:{type:'links.append',links:[
  R('vr-1','the canopy study','https://doi.org/10.5555/uhi.2024.0142',0,{status:'read',starred:true,context:'Across forty mid-sized cities, the canopy study found that blocks with more than 30% tree cover stayed 2.1 °C cooler at 3 p.m. than blocks with less than 10%.'}),
  R('vr-2','Preprint','https://arxiv.org/abs/2401.12345v2',1,{status:'reading'}),
  R('vr-3','Heat and Health Lab','https://heat-health.example.edu/',8,{sourceUrl:'',sourceTitle:'',imported:'labs-shortlist.csv, row 2'}),
  R('vr-4','Methods (PDF)','https://review.example.net/files/methods.pdf',9)],
  pages:{[review]:{title:'Cooling cities: a review of street-level interventions',authors:['Amara Okafor','Jun Watanabe'],journal:'Journal of Example Climate',date:'March 2025',doi:'10.5555/cool.2025.0007',readAt:at(0)}}}});
 await ui.setViewportSize({width:1440,height:1000});await until(async()=>await ui.locator('.link-row').count()===4,'Research rows');await ui.waitForTimeout(400);// let the storage reload's render settle before opening details
 for(const i of [0,1,2]){await ui.locator('.row-details summary').nth(i).click();await until(async()=>await ui.locator('.link-row').nth(i).locator('.occurrence').count()===1,'Research details open');}
 await ui.locator('.row-select').nth(3).check();await ui.locator('#filters-toggle').click();
 const readingPairs=[['star badge','.link-row .badge.star'],['status badge','.link-row .badge.status'],['identifier badge','.link-row .badge.badge-id'],['imported badge','.link-row .badge.imported'],['status choice','.status-seg label:not(:has(input:checked))'],['chosen status','.status-seg label:has(input:checked)'],['star','.star-btn[aria-pressed="false"]'],['starred','.star-btn[aria-pressed="true"]'],['details label','.occ-label'],['context','.context'],['context mark','.context mark'],['context line','.context-meta'],['identifier kind','.ident b'],['identifier','.ident .ident-value'],['identifier copy','.ident .link-btn'],['cited title','.cited-title'],['cited line','.cited-line'],['cited note','.cited-note'],['imported from','.imported-from'],['Links switch','#show-links'],['Insights switch','#show-insights'],['Mark as read','#mark-read'],['Starred only','.filter-check span']];
 const insightPairs=[['card title','.insight h3'],['total','.total b'],['total label','.total span'],['bar label','.bar-row .label'],['bar count','.bar-row .num'],['card note','.insight .note'],['legend','.legend li'],['chart axis','.chart-axis span'],['whole collection','#result-count']];
 const readingResults=[];
 for(const theme of THEME_IDS)for(const scheme of ['light','dark']){
  await ui.setViewportSize({width:1440,height:1000});await rpc(ui,{type:'state.mutate',action:{type:'settings.update',patch:{theme,appearance:scheme}}});await until(()=>applied(ui,theme,scheme),`${theme} ${scheme} applied`);
  await until(async()=>await ui.locator('.occurrence').count()===3,'Details still open');
  // Colors change through a short transition even with reduced motion: measure once none is still running (slower machines caught it halfway; Chrome 116 keeps finished ones listed).
  await until(()=>ui.evaluate(()=>!document.getAnimations().some(animation=>animation.playState==='running'||animation.playState==='pending')),`${theme} ${scheme} colors settled`);
  const list=await contrast(ui,readingPairs);await ui.locator('#show-insights').click();await until(()=>ui.locator('#insights').isVisible(),'Insights');const cards=await contrast(ui,insightPairs);
  for(const entry of [...list,...cards]){assert.ok(!entry.missing,`${theme} ${scheme} ${entry.name} missing`);assert.ok(entry.ratio>=4.5,`${theme} ${scheme} ${entry.name} contrast ${entry.ratio}`);}
  await ui.setViewportSize({width:320,height:900});const insightsOverflow=await overflow(ui);await ui.locator('#show-links').click();const detailsOverflow=await overflow(ui);
  assert.equal(insightsOverflow,false,`${theme} ${scheme}: Insights overflow at 320`);assert.equal(detailsOverflow,false,`${theme} ${scheme}: details overflow at 320`);
  await ui.setViewportSize({width:390,height:1100});await ui.evaluate(()=>{document.getElementById('notice').hidden=true;const first=document.querySelector('.link-row');scrollTo(0,first.getBoundingClientRect().top+scrollY-8);});const details=`panel-research-${theme}-${scheme}.png`;await shot(ui,details);
  await ui.locator('#show-insights').click();await until(()=>ui.locator('#insights').isVisible(),'Insights');await ui.evaluate(()=>{const review=document.getElementById('review');scrollTo(0,review.getBoundingClientRect().top+scrollY-8);});const cardsShot=`panel-insights-${theme}-${scheme}.png`;await shot(ui,cardsShot);await ui.locator('#show-links').click();
  readingResults.push({theme,scheme,horizontalOverflowAt320:{details:detailsOverflow,insights:insightsOverflow},screenshots:[details,cardsShot],contrast:[...list,...cards]});
 }
 await rpc(ui,{type:'state.mutate',action:{type:'settings.update',patch:{theme:'meteor',appearance:'system'}}});
 result.checks.push({readingAndInsights:{themes:readingResults.length,lowestContrast:Math.min(...readingResults.flatMap(entry=>entry.contrast.map(item=>item.ratio))),results:readingResults}});
 result.result='PASS';
}catch(e){result.result='FAIL';result.error=e.stack;console.error(e);process.exitCode=1;}finally{await context.close();result.finished=new Date().toISOString();await writeFile(resolve(evidence,'visual-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({result:result.result,checks:result.checks.length,screenshots:result.screenshots}));}
