// Revocation, run last: it removes grants from the prepared profiles.
// Per-site part (LINK_METEOR_TEST_PROFILE, prepared with the default grants): revoking the fixture
// origin prunes the saved hold origin and its registration, stops the loaded gesture, and makes
// capture report denied.
// All-sites part (only when LINK_METEOR_ALL_SITES_PROFILE names the profile prepared with
// LINK_METEOR_GRANTS=all-sites): removing all-sites access returns the scope to 'sites', keeps the
// per-site grant and its hold-drag, and stops the gesture in open tabs of other sites without a
// reload. Chrome's own site-access menu is not driven here; that is a hands-on check.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launch,fixtureServer,rpc,until,evidence} from './helpers/browser.mjs';
const fixture=await fixtureServer();const site=process.env.LINK_METEOR_PERMISSION_ORIGIN || fixture.base;let context;const result={started:new Date().toISOString(),checks:[]};
const pass=name=>{result.checks.push(name);console.log('PASS',name);};
const ALL_SITES=['http://*/*','https://*/*'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function holdDrag(page,key){await page.bringToFront();await page.evaluate(()=>scrollTo(0,0));await page.keyboard.down(key);await page.mouse.move(250,350);await page.mouse.down();await page.mouse.move(900,550,{steps:5});await page.mouse.up();await page.keyboard.up(key);await sleep(300);return page.locator('#link-meteor-overlay').count();}
try{
 if(process.env.LINK_METEOR_SKIP_SITE_REVOCATION!=='1'){
 const run=await launch(process.env.LINK_METEOR_TEST_PROFILE||'acceptance-final',{headless:false});context=run.context;
 for(const p of context.pages())await p.close();
 const page=await context.newPage();await page.goto(site+'/index.html');const ui=await context.newPage();await ui.goto(`chrome-extension://${run.id}/ui/workbench.html`);
 const inventory=await rpc(ui,{type:'tabs.list'});const tab=inventory.tabs.find(t=>t.url===page.url());
 await rpc(ui,{type:'hold.configure',origin:site,enabled:true,key:'r'});
 assert.ok((await ui.evaluate(()=>chrome.scripting.getRegisteredContentScripts())).length);
 const removed=await ui.evaluate(origin=>chrome.permissions.remove({origins:[origin+'/*']}),site);assert.equal(removed,true);
 await until(async()=>!(await rpc(ui,{type:'state.get'})).settings.holdOrigins.includes(site),'Revoked hold settings');
 await until(async()=>(await ui.evaluate(()=>chrome.scripting.getRegisteredContentScripts())).length===0,'Removed registration');pass('Actual host permission revocation prunes saved hold origin and dynamic content registration');
 await page.bringToFront();await page.keyboard.down('r');await page.mouse.move(250,350);await page.mouse.down();await page.mouse.move(900,550,{steps:5});await page.mouse.up();await page.keyboard.up('r');assert.equal(await page.locator('#link-meteor-overlay').count(),0);pass('Already loaded page no longer starts the revoked hold-key gesture');
 const report=(await rpc(ui,{type:'capture.run',tabIds:[tab.id]})).report;assert.equal(report.results[0].status,'denied');pass('Capture after grant revocation is a denied result, not successful zero');
 await ui.bringToFront();await until(async()=>(await ui.locator('#capture-report').innerText()).includes('denied'),'Revoked capture report');await ui.screenshot({path:resolve(evidence,'permission-denied.png')});
 await context.close();context=null;
 }
 const allSitesProfile=process.env.LINK_METEOR_ALL_SITES_PROFILE;
 if(allSitesProfile){
  const run=await launch(allSitesProfile,{headless:false});context=run.context;
  for(const p of context.pages())await p.close();
  const local=fixture.base.replace('127.0.0.1','localhost');
  const fixturePage=await context.newPage();await fixturePage.goto(fixture.base+'/index.html');
  const other=await context.newPage();await other.goto(local+'/index.html');
  const ui=await context.newPage();await ui.goto(`chrome-extension://${run.id}/ui/workbench.html`);await ui.locator('#collection-heading').waitFor();
  const before=await ui.evaluate(()=>chrome.permissions.getAll());result.allSitesGrantsBefore=before;
  assert.ok(ALL_SITES.every(p=>before.origins.includes(p)),'Prepare this profile with LINK_METEOR_GRANTS=all-sites first');
  assert.ok(before.origins.includes(fixture.base+'/*'),'The prepared profile also holds a per-site grant for the fixture site');
  if((await rpc(ui,{type:'state.get'})).settings.holdScope!=='all')await rpc(ui,{type:'hold.scope',scope:'all'});
  await rpc(ui,{type:'hold.settings',trigger:'letter',key:'r'});
  await rpc(ui,{type:'hold.configure',origin:fixture.base,enabled:true,key:'r'});
  await sleep(500);
  assert.equal(await holdDrag(other,'r'),1,'hold-drag runs on localhost with all-sites access');await other.keyboard.press('Escape');
  const removed=await ui.evaluate(all=>chrome.permissions.remove({origins:all}),ALL_SITES);assert.equal(removed,true);
  await until(async()=>(await rpc(ui,{type:'state.get'})).settings.holdScope==='sites','Scope back to sites',10000);pass("Removing all-sites access returns the saved scope to 'sites'");
  const after=await ui.evaluate(()=>chrome.permissions.getAll());result.allSitesGrantsAfter=after;
  assert.ok(after.origins.includes(fixture.base+'/*'),'Chrome keeps the per-site grant after all-sites access is removed');
  await until(async()=>(await rpc(ui,{type:'state.get'})).settings.holdOrigins.includes(fixture.base),'Per-site hold origin kept');
  await until(async()=>{const scripts=await ui.evaluate(()=>chrome.scripting.getRegisteredContentScripts());return scripts.length===1&&scripts[0].id==='meteor-hold-sites'&&scripts[0].matches.join()===fixture.base+'/*';},'Per-site registration replaces the all-sites one');
  pass('The per-site grant, its saved hold origin and its registration are kept');
  assert.equal(await holdDrag(other,'r'),0,'the open localhost tab stops without a reload');pass('An open tab of a site no longer allowed stops the gesture without a reload');
  assert.equal(await holdDrag(fixturePage,'r'),1,'the per-site fixture tab keeps hold-drag');await fixturePage.keyboard.press('Escape');pass('The per-site tab keeps hold-drag');
  const tabs=(await rpc(ui,{type:'tabs.list'})).tabs;const otherTab=tabs.find(t=>t.url?.startsWith(local)||t.title==='Page (access required)');
  if(otherTab){const report=(await rpc(ui,{type:'capture.run',tabIds:[otherTab.id]})).report;assert.equal(report.results[0].status,'denied');pass('Capture on the no-longer-allowed site is denied');}
  await ui.bringToFront();await ui.reload();await ui.locator('#collection-heading').waitFor();
  assert.equal(await ui.locator('#all-sites').isChecked(),false);await ui.screenshot({path:resolve(evidence,'permission-all-sites-removed.png')});pass('The all-sites switch shows off after Chrome’s grant is removed');
 }
 result.result='PASS';result.limits=['Native Deny button was not verified. This suite removes existing grants through chrome.permissions.remove and verifies actual revoked access. Chrome’s site-access menu is not driven. Grant preparation and any user-reported approvals are recorded separately.'];
}catch(e){result.result='FAIL';result.error=e.stack;console.error(e);process.exitCode=1;}
finally{if(context)await context.close();await fixture.close();result.finished=new Date().toISOString();await writeFile(resolve(evidence,'permission-browser-results.json'),JSON.stringify(result,null,2)+'\n');}
