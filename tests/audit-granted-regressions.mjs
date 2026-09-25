// Audit repairs exercised on an ordinary fixture page with real optional grants.
// Same-turn DOM clicks deliberately trigger concurrent Add/Review; no APIs are stubbed.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {launch,fixtureServer,rpc,until,evidence} from './helpers/browser.mjs';
const result={started:new Date().toISOString(),checks:[],limits:['Automated Chrome for Testing; no claim of native prompt or everyday Chrome acceptance.','Concurrent Add/Review uses two deliberate DOM clicks in the same event-loop turn.']};
const fixture=await fixtureServer();let context;
const pass=name=>{result.checks.push(name);console.log('PASS',name);};
try{
 const run=await launch(process.env.LINK_METEOR_TEST_PROFILE||'acceptance-final',{headless:false});context=run.context;
 for(const old of context.pages())await old.close();
 const page=await context.newPage();await page.goto(fixture.base+'/index.html');
 const ui=await context.newPage();await ui.goto(`chrome-extension://${run.id}/ui/workbench.html`);await ui.locator('#collection-heading').waitFor();
 const tab=(await rpc(ui,{type:'tabs.list'})).tabs.find(tab=>tab.url===page.url());assert.ok(tab);
 await ui.locator('input[name=scope][value=selected]').check();
 const checkbox=ui.locator(`#tab-options input[data-tab-id="${tab.id}"]`);await checkbox.waitFor();await checkbox.uncheck();await checkbox.focus();await ui.keyboard.press('Space');assert.equal(await checkbox.isChecked(),true);assert.equal(await ui.evaluate(()=>document.activeElement.dataset.tabId),String(tab.id));pass('Tab checkbox retains focus after keyboard selection');
 await rpc(ui,{type:'state.mutate',action:{type:'collection.create',name:'Granted Alpha'}});
 const overlay=page.locator('#link-meteor-overlay');await page.bringToFront();await page.evaluate(()=>scrollTo(0,0));await rpc(ui,{type:'capture.arm',tabId:tab.id});await overlay.waitFor();
 const box=await page.locator('#bibliography').boundingBox();await page.mouse.move(box.x+4,box.y+4);await page.mouse.down();await page.mouse.move(box.x+box.width-4,box.y+box.height-4,{steps:12});await page.mouse.up();assert.equal(await overlay.locator('.count').innerText(),'5 links selected');await until(async()=>(await overlay.locator('.dest').innerText()).includes('Granted Alpha'),'initial destination');
 const beta=await rpc(ui,{type:'state.mutate',action:{type:'collection.create',name:'Granted Beta'}});await until(async()=>(await overlay.locator('.dest').innerText()).includes('Granted Beta'),'updated destination');pass('Ordinary-page overlay updates its active collection destination');
 await overlay.evaluate(host=>{host.shadowRoot.querySelector('button.add').click();host.shadowRoot.querySelector('button.review').click();});await until(async()=>(await overlay.locator('.status').innerText()).startsWith('Saved'),'concurrent save');
 // Read through the serialized background queue after both actions settle.
 await until(async()=>(await overlay.locator('button.review').isDisabled())===false,'Review completed');
 const state=await rpc(ui,{type:'state.get'});const saved=state.collections.find(c=>c.id===beta.activeCollectionId);assert.equal(saved.links.length,5);assert.ok(saved.links.every(link=>link.sourceUrl===page.url()));assert.match(await overlay.locator('.status').innerText(),/Granted Beta/);pass('Concurrent ordinary-page Add and Review save once with the actual destination and provenance');
 await rpc(ui,{type:'state.mutate',action:{type:'collection.create',name:'Granted Gamma'}});await until(async()=>!(await overlay.locator('button.add').isEnabled()),'committed state');assert.match(await overlay.locator('.dest').innerText(),/Saved to Granted Beta/);pass('Saved receipt stays attached to its destination after a later collection switch');
 await page.bringToFront();await page.screenshot({path:resolve(evidence,'granted-overlay-receipt.png')});result.result='PASS';
}catch(error){result.result='FAIL';result.error=error.stack;console.error(error);process.exitCode=1;}
finally{if(context)await context.close();await fixture.close();result.finished=new Date().toISOString();await writeFile(resolve(evidence,'granted-regressions.json'),JSON.stringify(result,null,2)+'\n');}
