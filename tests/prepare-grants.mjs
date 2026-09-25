// Prepares optional-permission grants in a NEW task-owned test profile by
// driving the product's own permission paths in a visible Chrome for Testing window.
// Under automation requests may resolve without an observed click. Successful
// grants are not evidence that native Allow/Deny sheets were exercised.
import {fixtureServer,launch,rpc,until} from './helpers/browser.mjs';
const profile=process.env.LINK_METEOR_TEST_PROFILE;
if(!profile)throw new Error('Set LINK_METEOR_TEST_PROFILE to a new task-owned profile name.');
const fixture=await fixtureServer();
const {context,id}=await launch(profile,{headless:process.env.LINK_METEOR_GRANTS_HEADLESS==='1'});
const grantTimeout=Number(process.env.LINK_METEOR_GRANT_TIMEOUT || 180000);
let ui;
const log=(step,data={})=>console.log(JSON.stringify({time:new Date().toISOString(),step,...data}));
try{
  for(const old of context.pages())await old.close();
  const page=await context.newPage();await page.goto(fixture.base+'/index.html');
  ui=await context.newPage();await ui.goto(`chrome-extension://${id}/ui/workbench.html`);await ui.locator('#collection-heading').waitFor();
  await ui.bringToFront();
  await ui.evaluate(async()=>{const window=await chrome.windows.getCurrent();await chrome.windows.update(window.id,{focused:true});});
  await ui.evaluate(()=>{globalThis.grantObservations=[];const original=chrome.permissions.request.bind(chrome.permissions);chrome.permissions.request=request=>{const entry={request,activeGesture:navigator.userActivation.isActive};grantObservations.push(entry);const promise=original(request);promise.then(value=>entry.granted=value,error=>entry.error=error.message);return promise;};});
  const has=request=>ui.evaluate(request=>chrome.permissions.contains(request),request);
  log('ready',{extension:id,fixture:fixture.base});
  if(!await has({permissions:['tabs']})){log('awaiting-native-allow',{permission:'tabs',via:'Pick tabs scope'});await ui.locator('input[name=scope][value=selected]').check();}
  await until(()=>has({permissions:['tabs']}),'tabs grant',grantTimeout);log('granted',{permission:'tabs'});
  await until(async()=>await ui.locator('#tab-options input').count()>0,'Tab inventory',10000);
  for(const box of await ui.locator('#tab-options input').all())await box.uncheck();
  await ui.getByRole('checkbox',{name:'Include Meteor Research Lab — deterministic fixture',exact:true}).check();
  const origin=`${fixture.base}/*`;
  if(!await has({origins:[origin]})){log('awaiting-native-allow',{origin,via:'Capture selected tab'});}
  await ui.locator('#capture').click();
  await until(()=>has({origins:[origin]}),'site grant',grantTimeout);log('granted',{origin});
  await until(async()=>(await ui.locator('#capture-report').innerText().catch(()=>'')).length>0,'capture report',20000);
  await ui.locator('#search').fill('Attention in small systems');
  if(!await has({permissions:['bookmarks']})){log('awaiting-native-allow',{permission:'bookmarks',via:'Bookmark web links'});}
  await ui.locator('#bookmark-name').fill('Link Meteor grant preparation');await ui.locator('#bookmark').click();
  await until(()=>has({permissions:['bookmarks']}),'bookmarks grant',grantTimeout);log('granted',{permission:'bookmarks'});
  await until(async()=>(await ui.locator('#notice').innerText().catch(()=>'')).includes('Created bookmark folder'),'bookmark folder',20000);
  log('complete',{observations:await ui.evaluate(()=>grantObservations),grants:await ui.evaluate(()=>chrome.permissions.getAll())});
}catch(error){log('failed',{error:error.message,uiError:await ui?.locator('#error').innerText().catch(()=>''),uiNotice:await ui?.locator('#notice').innerText().catch(()=>''),observations:await ui?.evaluate(()=>grantObservations).catch(()=>null),grants:await ui?.evaluate(()=>chrome.permissions.getAll()).catch(()=>null)});process.exitCode=1;}
finally{await context.close();await fixture.close();}
