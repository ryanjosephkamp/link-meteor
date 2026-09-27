// Prepares optional-permission grants in a NEW task-owned test profile by
// driving the product's own permission paths in Chrome for Testing (headed by default).
// The owner, or Codex computer use at the owner's direction, clicks Allow on each native
// prompt; each 'awaiting-native-allow' line names the prompt that is waiting.
// Under automation requests may resolve without an observed click. Successful
// grants are not evidence that native Allow/Deny sheets were exercised.
//
// LINK_METEOR_GRANTS=site (default): tabs, the fixture site and bookmarks, for the functional
//   suites. Then Capture this page on a newly visited site (a second local origin, the fixture
//   port + 10), which must ask for that site in the same click and then capture it: 4 prompts.
// LINK_METEOR_GRANTS=all-sites, in a SEPARATE new profile: tabs and the fixture site first (so a
//   per-site grant exists), then all sites from the welcome card, tab groups from Open as a tab
//   group, and bookmarks: 5 prompts. For tests/access-granted.mjs and the all-sites part of
//   tests/permission-browser.mjs.
import {fixtureServer,launch,rpc,until} from './helpers/browser.mjs';
import {secondFixture} from './access-fixture.mjs';
const profile=process.env.LINK_METEOR_TEST_PROFILE;
if(!profile)throw new Error('Set LINK_METEOR_TEST_PROFILE to a new task-owned profile name.');
const mode=process.env.LINK_METEOR_GRANTS||'site';
if(!['site','all-sites'].includes(mode))throw new Error("LINK_METEOR_GRANTS must be 'site' or 'all-sites'.");
const ALL_SITES=['http://*/*','https://*/*'];
const fixture=await fixtureServer();
const second=mode==='site'?await secondFixture():null;
const {context,id}=await launch(profile,{headless:process.env.LINK_METEOR_GRANTS_HEADLESS==='1'});
const grantTimeout=Number(process.env.LINK_METEOR_GRANT_TIMEOUT || 180000);
let ui,page;
const log=(step,data={})=>console.log(JSON.stringify({time:new Date().toISOString(),step,mode,...data}));
const has=request=>ui.evaluate(request=>chrome.permissions.contains(request),request);

async function grantTabs(){
  if(!await has({permissions:['tabs']})){log('awaiting-native-allow',{permission:'tabs',via:'Pick tabs scope'});await ui.locator('input[name=scope][value=selected]').check();}
  await until(()=>has({permissions:['tabs']}),'tabs grant',grantTimeout);log('granted',{permission:'tabs'});
  await until(async()=>await ui.locator('#tab-options input').count()>0,'Tab inventory',10000);
}
async function grantFixtureSite(){
  for(const box of await ui.locator('#tab-options input').all())await box.uncheck();
  await ui.getByRole('checkbox',{name:'Include Meteor Research Lab — deterministic fixture',exact:true}).check();
  const origin=`${fixture.base}/*`;
  if(!await has({origins:[origin]})){log('awaiting-native-allow',{origin,via:'Capture selected tab'});}
  await ui.locator('#capture').click();
  await until(()=>has({origins:[origin]}),'site grant',grantTimeout);log('granted',{origin});
  await until(async()=>(await ui.locator('#capture-report').innerText().catch(()=>'')).length>0,'capture report',20000);
}
async function grantBookmarks(search){
  if(search)await ui.locator('#search').fill(search);
  if(!await has({permissions:['bookmarks']})){log('awaiting-native-allow',{permission:'bookmarks',via:'Bookmark web links'});}
  await ui.locator('#bookmark-name').fill('Link Meteor grant preparation');await ui.locator('#bookmark').click();
  await until(()=>has({permissions:['bookmarks']}),'bookmarks grant',grantTimeout);log('granted',{permission:'bookmarks'});
  await until(async()=>(await ui.locator('#notice').innerText().catch(()=>'')).includes('Created bookmark folder'),'bookmark folder',20000);
}
// Capture this page after the tab moves to a site Link Meteor has never been allowed on: the click
// asks for that site first, then captures. Evidence for the 0.3.0 "same click" route.
async function capturePageOnNewSite(){
  await page.goto(second.base+'/index.html');
  await ui.bringToFront();
  await ui.locator('input[name=scope][value=current]').check();
  await until(async()=>(await ui.locator('#scope-preview').innerText()).includes('Chrome will ask to allow Link Meteor on this site'),'This page preview names the new site',15000);
  const origin=`${second.base}/*`;
  log('awaiting-native-allow',{origin,via:'Capture this page on a newly visited site (same click)'});
  await ui.locator('#capture').click();
  await until(()=>has({origins:[origin]}),'new-site grant',grantTimeout);log('granted',{origin});
  await until(async()=>/37 links captured/.test(await ui.locator('#capture-report').innerText().catch(()=>'')),'capture of the new site after Allow',20000);
  log('captured',{origin,report:await ui.locator('#capture-report').innerText()});
}
async function grantAllSites(){
  await ui.bringToFront();
  await until(async()=>await ui.locator('#welcome-allow').isVisible(),'welcome card',10000);
  if(!await has({origins:ALL_SITES})){log('awaiting-native-allow',{origins:ALL_SITES,via:'Welcome card: Allow on all sites (recommended)'});}
  await ui.locator('#welcome-allow').click();
  await until(()=>has({origins:ALL_SITES}),'all-sites grant',grantTimeout);log('granted',{origins:ALL_SITES});
  await until(async()=>(await rpc(ui,{type:'state.get'})).settings.holdScope==='all','all-sites scope saved',20000);
  log('scope',{holdScope:'all',outcome:await ui.locator('#welcome-outcome-text').innerText()});
}
async function grantTabGroups(){
  const collection=(await rpc(ui,{type:'state.mutate',action:{type:'collection.create',name:'Grant preparation group'}})).activeCollectionId;
  const links=[0,1,2].map(i=>({id:`grant-group-${i}`,anchorText:`Group source ${i}`,accessibleLabel:'',url:`${fixture.base}/group/${i}`,originalHref:'',sourceUrl:`${fixture.base}/index.html`,sourceTitle:'Grant preparation',frameUrl:'',capturedAt:new Date().toISOString(),batchId:'grant-group',notes:'',tags:[]}));
  await rpc(ui,{type:'state.mutate',action:{type:'links.append',collectionId:collection,links}});
  await until(async()=>(await ui.locator('#open-label').innerText()).includes('3'),'three links to open');
  const pagesBefore=context.pages().length;
  if(!await has({permissions:['tabGroups']})){log('awaiting-native-allow',{permission:'tabGroups',via:'Open as a tab group'});}
  await ui.locator('#open-group').click();
  await until(()=>has({permissions:['tabGroups']}),'tabGroups grant',grantTimeout);log('granted',{permission:'tabGroups'});
  await until(async()=>/tab group named “Grant preparation group”/.test(await ui.locator('#notice').innerText().catch(()=>'')),'named tab group',20000);
  for(const opened of context.pages().slice(pagesBefore))await opened.close();
}

try{
  for(const old of context.pages())await old.close();
  page=await context.newPage();await page.goto(fixture.base+'/index.html');
  ui=await context.newPage();await ui.goto(`chrome-extension://${id}/ui/workbench.html`);await ui.locator('#collection-heading').waitFor();
  // Name only this test tab so a human can distinguish it from unrelated browser windows.
  await ui.evaluate(()=>{document.title='Link Meteor audit — permission setup';});
  await ui.bringToFront();
  await ui.evaluate(async()=>{const window=await chrome.windows.getCurrent();await chrome.windows.update(window.id,{focused:true});});
  await ui.evaluate(()=>{globalThis.grantObservations=[];const original=chrome.permissions.request.bind(chrome.permissions);chrome.permissions.request=request=>{const entry={request,activeGesture:navigator.userActivation.isActive};grantObservations.push(entry);const promise=original(request);promise.then(value=>entry.granted=value,error=>entry.error=error.message);return promise;};});
  log('ready',{extension:id,fixture:fixture.base,second:second?.base,profile,title:'Link Meteor audit — permission setup'});
  await grantTabs();
  await grantFixtureSite();
  if(mode==='site'){
    await grantBookmarks('Attention in small systems');
    await ui.locator('#search').fill('');
    await capturePageOnNewSite();
  } else {
    await grantAllSites();
    await grantTabGroups();
    await grantBookmarks('');
  }
  log('complete',{observations:await ui.evaluate(()=>grantObservations),grants:await ui.evaluate(()=>chrome.permissions.getAll())});
}catch(error){log('failed',{error:error.message,uiError:await ui?.locator('#error').innerText().catch(()=>''),uiNotice:await ui?.locator('#notice').innerText().catch(()=>''),observations:await ui?.evaluate(()=>grantObservations).catch(()=>null),grants:await ui?.evaluate(()=>chrome.permissions.getAll()).catch(()=>null)});process.exitCode=1;}
finally{await context.close();await fixture.close();await second?.close();}
