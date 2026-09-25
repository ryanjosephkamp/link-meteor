// Task-owned headed browser for native permission/shortcut acceptance. Send a newline to close it.
import {fixtureServer,launch,rpc,scratch} from './helpers/browser.mjs';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const fixture=await fixtureServer();
const {context,worker,id}=await launch(process.env.LINK_METEOR_TEST_PROFILE || 'acceptance-final',{headless:false});
const page=await context.newPage();await page.goto(fixture.base+'/index.html');
const ui=await context.newPage();await ui.goto(`chrome-extension://${id}/ui/workbench.html`);
console.log(JSON.stringify({id,base:fixture.base,pid:process.pid,ui:ui.url()}));
await writeFile(resolve(scratch,'interactive.json'),JSON.stringify({id,base:fixture.base,pid:process.pid,ui:ui.url()},null,2));
await ui.locator('input[name=scope][value=selected]').check();
await new Promise(done=>setTimeout(done,1200));
for(const cb of await ui.locator('#tab-options input').all())await cb.uncheck();
await ui.getByRole('checkbox',{name:'Include Meteor Research Lab — deterministic fixture',exact:true}).check();
await ui.locator('#capture').click();
console.log(JSON.stringify({permissions:await ui.evaluate(()=>chrome.permissions.getAll()),error:await ui.locator('#error').textContent(),tabs:await ui.locator('#tab-options input').count()}));
let closed=false;
async function close(){if(closed)return;closed=true;await context.close();await fixture.close();process.exit(0);}
process.stdin.resume();process.stdin.once('data',close);process.once('SIGINT',close);process.once('SIGTERM',close);
