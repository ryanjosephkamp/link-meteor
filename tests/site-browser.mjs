// Loaded-extension checks on the site's practice page: each section's published answer key
// (data-expect) must match a real region drag through the extension overlay. Also captures
// the real screenshots used on the site. Serves site/ on the granted fixture origin.
// Run before tests/permission-browser.mjs, which revokes that origin.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launch,rpc,until,evidence} from './helpers/browser.mjs';
import {serve} from './site-preview.mjs';
const result={started:new Date().toISOString(),browser:'Chrome for Testing via Playwright; real unpacked extension',sections:[],screenshots:[],limits:['Practice-page counts were checked with synthetic pointer drags in automated Chrome for Testing.','Side-panel-width images render the workbench page in a tab at panel width; the native side-panel frame is not captured.']};
const {server,base}=await serve(Number(process.env.LINK_METEOR_FIXTURE_PORT || 52478));
let context;
const shot=async(target,name,options={})=>{await target.screenshot({path:resolve(evidence,name),...options});result.screenshots.push(name);};
try{
  const run=await launch(process.env.LINK_METEOR_TEST_PROFILE || 'acceptance-final',{headless:false,scale:2});context=run.context;
  for(const old of context.pages())await old.close();
  const page=await context.newPage();await page.setViewportSize({width:1440,height:1100});
  await page.goto(base+'/practice.html');await page.evaluate(()=>document.fonts.ready);await page.locator('#load-more').waitFor();
  const ui=await context.newPage();const uiURL=`chrome-extension://${run.id}/ui/workbench.html`;await ui.goto(uiURL);await ui.locator('#collection-heading').waitFor();
  await ui.evaluate(()=>chrome.storage.local.clear());await ui.reload();await ui.locator('#collection-heading').waitFor();
  await rpc(ui,{type:'state.mutate',action:{type:'collection.create',name:'Urban heat islands: sources'}});
  const tab=(await rpc(ui,{type:'tabs.list'})).tabs.find(t=>t.url===page.url());assert.ok(tab,'practice tab listed');
  const overlay=page.locator('#link-meteor-overlay');
  const arm=async()=>{await rpc(ui,{type:'capture.arm',tabId:tab.id});await overlay.waitFor();};
  const settle=()=>new Promise(r=>setTimeout(r,120));
  async function frame(id){await page.bringToFront();await page.evaluate(id=>{const el=document.getElementById(id);el.scrollIntoView({block:'start'});scrollBy(0,-72);},id);await settle();return page.locator('#'+id).boundingBox();}
  async function dragSection(id,{wheel=0,before=null}={}){
    if(before)await before();
    const box=await frame(id);await arm();
    await page.mouse.move(box.x+3,box.y+3);await page.mouse.down();
    // For the scrolling box, end inside it so the wheel scrolls the box, as a person would.
    const end=wheel?await page.locator('#archive-box').boundingBox().then(b=>({x:b.x+b.width-12,y:b.y+b.height-60})):{x:box.x+box.width-3,y:box.y+box.height-3};
    await page.mouse.move(end.x,end.y,{steps:10});
    for(let i=0;i<wheel;i++){await page.mouse.wheel(0,260);await settle();}
    await page.mouse.up();
    const text=await overlay.locator('.count').innerText();return parseInt(text,10);
  }
  const expected=await page.$$eval('[data-expect]',els=>els.map(el=>({id:el.id,expect:Number(el.dataset.expect)})));
  for(const {id,expect} of expected){
    const options=id==='archive'?{wheel:6}:id==='components'?{before:async()=>{await page.bringToFront();await page.locator('#load-more').click();await page.locator('#late-list a').nth(2).waitFor();}}:{};
    if(id==='archive')await page.evaluate(()=>{document.getElementById('archive-box').scrollTop=0;});
    const actual=await dragSection(id,options);
    result.sections.push({id,expected:expect,actual});
    assert.equal(actual,expect,`${id}: overlay selected ${actual}, answer key says ${expect}`);
    if(id==='reading'){
      await overlay.getByRole('button',{name:'Add to collection',exact:true}).click();
      await until(async()=>(await overlay.locator('.status').innerText()).startsWith('Saved'),'Reading list saved');
    }
    await page.keyboard.press('Escape');await until(async()=>await overlay.count()===0,'overlay closed');
    console.log('PASS',id,actual);
  }
  const active=async()=>{const s=await rpc(ui,{type:'state.get'});return s.collections.find(c=>c.id===s.activeCollectionId);};
  const reading=(await active()).links;
  assert.equal(reading.length,7);assert.equal(reading.filter(l=>l.anchorText==='Download PDF').length,2);
  assert.equal(reading.find(l=>l.url==='https://journal.example.org/figures/canopy-map').anchorText,'');
  assert.equal(reading.find(l=>l.url==='https://journal.example.org/figures/canopy-map').accessibleLabel,'Canopy coverage map, 2024');
  assert.equal(reading.filter(l=>l.url==='https://doi.org/10.5555/uhi.2024.0142').length,2);
  result.readingListFields='7 occurrences; empty anchor with separate accessible label; duplicate label and duplicate URL kept';

  // Screenshots of the overlay on the practice page.
  let box=await frame('reading');await arm();
  await page.mouse.move(box.x+3,box.y+3);await page.mouse.down();await page.mouse.move(box.x+box.width*0.72,box.y+box.height*0.62,{steps:10});await settle();
  await shot(page,'site-overlay-drag.png');
  await page.mouse.move(box.x+box.width-3,box.y+box.height-3,{steps:6});await page.mouse.up();await settle();
  await shot(page,'site-overlay-card.png');await page.keyboard.press('Escape');

  // Whole-page capture into the collection, then the tricky labels via the real pipeline.
  const whole=(await rpc(ui,{type:'capture.run',tabIds:[tab.id]})).report;
  assert.equal(whole.results[0].status,'success');result.wholePageCount=whole.capturedCount;
  const links=(await active()).links;
  const tricky=Object.fromEntries(links.filter(l=>/example\.org\/labels\//.test(l.url)).map(l=>[l.url.split('/').pop(),l]));
  assert.equal(tricky.formula.anchorText,'=SUM(A1:A3)');assert.equal(tricky.markup.anchorText,'<b>not bold</b>');
  assert.equal(tricky['icon-only'].anchorText,'');assert.equal(tricky['icon-only'].accessibleLabel,'Open settings');
  assert.equal(tricky['partly-hidden'].anchorText,'Visible words');assert.ok(!tricky.hidden);
  assert.ok(!links.some(l=>l.url.startsWith('javascript:')));
  assert.ok(links.some(l=>l.frameUrl.endsWith('/practice-frame.html')),'frame provenance');
  assert.ok(links.some(l=>l.url==='https://components.example.net/sources/tree-survey'),'shadow root link');
  result.pageFieldChecks='formula and markup labels kept as text; icon-only link empty with ARIA label; hidden text and hidden/script links excluded; frame and shadow-root links present';

  // Workbench screenshots with the captured practice data.
  await ui.bringToFront();await ui.setViewportSize({width:1440,height:1000});await ui.reload();await ui.locator('.link-row').first().waitFor();
  await ui.locator('#filters-toggle').click();await ui.locator('#dedupe').selectOption('url');await ui.locator('#filters-toggle').click();
  await ui.locator('.row-details summary').first().click();await ui.evaluate(()=>scrollTo(0,0));await ui.waitForTimeout(300);
  await shot(ui,'site-workbench.png');
  await ui.locator('#filters-toggle').click();await ui.locator('#dedupe').selectOption('none');await ui.locator('#filters-toggle').click();
  await ui.setViewportSize({width:400,height:900});await ui.evaluate(()=>scrollTo(0,0));await ui.waitForTimeout(300);await shot(ui,'site-panel.png');
  await ui.emulateMedia({colorScheme:'dark'});await ui.waitForTimeout(300);await shot(ui,'site-panel-dark.png');await ui.emulateMedia({colorScheme:'light'});
  await page.bringToFront();await page.setViewportSize({width:1040,height:900});await frame('reading');await shot(page,'site-practice.png');await page.setViewportSize({width:1440,height:1100});

  // A realistic mixed multi-tab report.
  const others=[];for(const path of ['/install.html','/privacy.html']){const p=await context.newPage();await p.goto(base+path);others.push(p);}
  const denied=await context.newPage();await denied.goto(base.replace('127.0.0.1','localhost')+'/guide.html');
  const restricted=await context.newPage();await restricted.goto('chrome://version');
  const tabs=(await rpc(ui,{type:'tabs.list'})).tabs;const id=url=>tabs.find(t=>t.url===url).id;
  const report=(await rpc(ui,{type:'capture.run',tabIds:[tab.id,id(others[0].url()),id(others[1].url()),id(denied.url()),id(restricted.url())]})).report;
  assert.deepEqual(report.results.map(r=>r.status),['success','success','success','denied','unsupported']);
  await ui.bringToFront();await ui.setViewportSize({width:1100,height:900});await ui.reload();await until(async()=>(await ui.locator('#capture-report').innerText()).includes('Access denied'),'report shown');
  await ui.locator('#capture-report').scrollIntoViewIfNeeded();await ui.waitForTimeout(200);await shot(ui.locator('#capture-report'),'site-report.png');
  result.reportStatuses=report.results.map(r=>r.status);
  for(const p of [...others,denied,restricted])await p.close();
  result.result='PASS';
}catch(error){result.result='FAIL';result.error=error.stack;console.error(error);process.exitCode=1;}
finally{if(context)await context.close();server.close();result.finished=new Date().toISOString();await writeFile(resolve(evidence,'site-browser-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({result:result.result,sections:result.sections,wholePageCount:result.wholePageCount,screenshots:result.screenshots}));}
