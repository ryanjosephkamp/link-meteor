import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launch,fixtureServer,rpc,until,evidence} from './helpers/browser.mjs';
const fixture=await fixtureServer();const site=process.env.LINK_METEOR_PERMISSION_ORIGIN || fixture.base;let context;const result={started:new Date().toISOString(),checks:[]};
const pass=name=>{result.checks.push(name);console.log('PASS',name);};
try{
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
 await ui.bringToFront();await until(async()=>(await ui.locator('#capture-report').innerText()).includes('denied'),'Revoked capture report');await ui.screenshot({path:resolve(evidence,'permission-denied.png')});result.result='PASS';result.limits=['Native Deny button was not verified. This suite removes an existing test-origin grant through chrome.permissions.remove and verifies actual revoked access. Grant preparation and any user-reported approvals are recorded separately.'];
}catch(e){result.result='FAIL';result.error=e.stack;console.error(e);process.exitCode=1;}
finally{if(context)await context.close();await fixture.close();result.finished=new Date().toISOString();await writeFile(resolve(evidence,'permission-browser-results.json'),JSON.stringify(result,null,2)+'\n');}
