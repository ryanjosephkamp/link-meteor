import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../src/core/model.js';

const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);}});
const local={linkMeteorState:createState()},session={};
let failLocal=false,failSession=false,permitted=true;
let scripts=[],activeRegistrations=0,maxActiveRegistrations=0;
const tabs=[{id:1,windowId:1,url:'https://fixture.test/',title:'Fixture'},{id:2,windowId:1,url:'chrome-extension://meteor/ui/workbench.html',active:true}];
globalThis.chrome={
 storage:{local:{async get(key){return {[key]:structuredClone(local[key])};},async set(value){if(failLocal)throw Error('quota');Object.assign(local,structuredClone(value));}},session:{async get(key){return {[key]:structuredClone(session[key])};},async set(value){if(failSession)throw Error('session unavailable');Object.assign(session,structuredClone(value));}}},
 runtime:{getURL:path=>'chrome-extension://meteor/'+path,sendMessage:async()=>{},onMessage:event(),onInstalled:event(),onStartup:event()},
 tabs:{async query(query){return query?.active?[tabs[1]]:tabs;},async get(id){const tab=tabs.find(t=>t.id===id);if(!tab)throw Error('No tab');return tab;},sendMessage:async()=>{},create:async()=>{},update:async()=>{}},
 windows:{getAll:async()=>[{id:1,focused:true,tabs}],update:async()=>{}},
 permissions:{contains:async()=>permitted,onRemoved:event()},
 scripting:{async executeScript(spec){return spec.files?[]:[{result:{links:[{anchorText:'A',url:'https://fixture.test/destination',originalHref:'/destination',frameUrl:'https://fixture.test/'}],warnings:[]}}];},async getRegisteredContentScripts(){return scripts;},async unregisterContentScripts(){scripts=[];},async registerContentScripts(next){activeRegistrations++;maxActiveRegistrations=Math.max(maxActiveRegistrations,activeRegistrations);await new Promise(done=>setTimeout(done,8));scripts=next;activeRegistrations--;}},
 bookmarks:{},action:{onClicked:event()},sidePanel:{open:async()=>{}},commands:{onCommand:event()},contextMenus:{onClicked:event(),removeAll:async()=>{},create:()=>{}}
};
await import('../src/background.js');
const sender={url:'chrome-extension://meteor/ui/workbench.html',tab:tabs[1]};
const call=(message)=>new Promise(resolve=>chrome.runtime.onMessage.listeners[0](message,sender,resolve));

test('background adverse paths using explicit Chrome-API simulation',async t=>{
 await t.test('failed persistent write preserves saved collection',async()=>{const before=structuredClone(local.linkMeteorState);failLocal=true;const reply=await call({type:'state.mutate',action:{type:'collection.create',name:'Not saved'}});failLocal=false;assert.equal(reply.ok,false);assert.match(reply.error,/Existing collections are intact/);assert.deepEqual(local.linkMeteorState,before);});
 await t.test('session bookkeeping failure does not contradict successful capture',async()=>{failSession=true;const reply=await call({type:'capture.run',tabIds:[1]});failSession=false;assert.equal(reply.ok,true);assert.equal(reply.data.report.results.length,1);assert.equal(reply.data.report.results[0].status,'success');assert.equal(reply.data.report.capturedCount,1);});
 await t.test('simultaneous hold settings serialize registration and retain last requested state',async()=>{const replies=await Promise.all([call({type:'hold.configure',origin:'https://fixture.test',enabled:true,key:'a'}),call({type:'hold.configure',origin:'https://fixture.test',enabled:true,key:'b'})]);assert.ok(replies.every(r=>r.ok));assert.equal(maxActiveRegistrations,1);assert.equal(local.linkMeteorState.settings.holdKey,'b');assert.equal(scripts.length,1);});
 await t.test('revoked permission prunes persisted hold origins and registered scripts',async()=>{permitted=false;chrome.permissions.onRemoved.listeners[0]();for(let i=0;i<100&&local.linkMeteorState.settings.holdOrigins.length;i++)await new Promise(r=>setTimeout(r,5));assert.deepEqual(local.linkMeteorState.settings.holdOrigins,[]);assert.deepEqual(scripts,[]);const reply=await call({type:'settings.get'});assert.deepEqual(reply.data.holdOrigins,[]);});
 await t.test('unreadable saved schema is preserved',async()=>{const before=structuredClone(local.linkMeteorState);local.linkMeteorState.schemaVersion=999;const reply=await call({type:'state.get'});assert.equal(reply.ok,false);assert.equal(local.linkMeteorState.schemaVersion,999);local.linkMeteorState=before;});
});
