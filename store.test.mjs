// Store boundary tests use an injected provider, not real Supabase accounts.
import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createHealthStore} from '../dist/store.js';
import {validateRecord, STORAGE_KEY} from '../dist/core.js';
import {MISSION_STORAGE_KEY} from '../dist/mission.js';

const USER_A = {id:'11111111-1111-4111-8111-111111111111',email:'a@example.com'};
const USER_B = {id:'22222222-2222-4222-8222-222222222222',email:'b@example.com'};
const ALERT_KEY = 'cosmovital-alert-history-v3';
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis,'localStorage');
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis,'navigator');
afterEach(()=>{
  if(storageDescriptor)Object.defineProperty(globalThis,'localStorage',storageDescriptor);else delete globalThis.localStorage;
  if(navigatorDescriptor)Object.defineProperty(globalThis,'navigator',navigatorDescriptor);else delete globalThis.navigator;
});
function memoryStorage(initial={},deny=false){
  const values=new Map(Object.entries(initial)),calls=[];let failKey=null;
  const api={calls,values,getItem(key){calls.push(['get',key]);if(deny)throw new Error('Legacy health storage must not be read');return values.get(key)??null},setItem(key,value){calls.push(['set',key]);if(failKey===key){failKey=null;throw new Error('Storage full')}values.set(key,String(value))},removeItem(key){calls.push(['remove',key]);values.delete(key)},failNext(key){failKey=key}};
  Object.defineProperty(globalThis,'localStorage',{value:api,configurable:true});return api;
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const mission=()=>({schemaVersion:1,cases:[],consultations:[]});
function observation(id='reading-a',user=USER_A,value=72){return validateRecord({id,timestamp:'2026-01-03T10:00:00Z',created_at:'2026-01-03T10:02:00Z',user_id:user?.id??null,source:'manual',values:{heart:value},context:'resting',notes:'Isolated store test fixture'});}
function snapshot(user=USER_A,records=[observation(user===USER_A?'reading-a':'reading-b',user)],revision=4){return {records,missionState:mission(),profile:{id:user.id,display_name:user===USER_A?'User A':'User B',preferences:{timeZone:'UTC'}},alerts:[],revision}}
function fakeService(user=USER_A){
  let listener;const calls=[];
  const service={cloudEnabled:true,user,calls,workspace:snapshot(user),getUser(){return service.user},onAuthChange(fn){listener=fn;return()=>{listener=null}},initializeCloud:async()=>({user:service.user}),loadWorkspace:async()=>{calls.push(['load',service.user?.id]);return structuredClone(service.workspace)},saveWorkspace:async input=>{calls.push(['save',structuredClone(input)]);return {...structuredClone(input),profile:service.workspace.profile,revision:input.expectedRevision+1}},updateProfile:async profile=>profile,signOut:async()=>{service.user=null;listener?.({user:null,event:'SIGNED_OUT'})},signIn:async()=>({user:service.user}),signUp:async()=>({user:service.user}),updatePassword:async()=>({}),deleteAccount:async()=>({}),emit(user,event='SIGNED_IN'){service.user=user;listener?.({user,event})}};
  return service;
}

// Regression: cancellation must be established before awaiting provider identity.
test('logout during pending identity lookup cannot reopen the previous private account',async()=>{
  const local=memoryStorage({},true),provider=fakeService(),identity=deferred();
  provider.initializeCloud=()=>identity.promise;
  const store=createHealthStore({service:provider,local});
  const initial=store.initialize().catch(error=>error);
  await store.auth.signOut();
  identity.resolve({user:USER_A});await initial;await tick();
  assert.equal(store.getSnapshot().user,null,'Stale provider identity must not reopen an account after logout');
  assert.deepEqual(store.getRecords(),[]);
  assert.equal(provider.calls.some(call=>call[0]==='load'),false,'Cancelled identity lookup must not fetch health records');
  assert.equal(local.calls.length,0);
});

test('account B automatically loads after replacing account A during an in-flight A load',async()=>{
  const local=memoryStorage({},true),provider=fakeService(),firstLoad=deferred();let loads=0;
  provider.loadWorkspace=async()=>{loads++;return loads===1?firstLoad.promise:snapshot(USER_B)};
  const store=createHealthStore({service:provider,local}),seen=[];
  store.subscribe(value=>seen.push(value));
  const initial=store.initialize().catch(error=>error);await tick();
  assert.equal(store.getSnapshot().user.id,USER_A.id);
  provider.workspace=snapshot(USER_B);provider.emit(USER_B);await tick();
  firstLoad.resolve(snapshot(USER_A));await initial;await tick();await tick();
  assert.equal(store.getSnapshot().user?.id,USER_B.id);
  assert.equal(store.getSnapshot().status,'ready','New owner must receive a fresh load after old request settles');
  assert.deepEqual(store.getRecords().map(r=>r.id),['reading-b']);
  assert.equal(seen.some(value=>value.user?.id===USER_B.id&&value.records.some(r=>r.user_id===USER_A.id)),false);
});

test('configured loading never reads or claims legacy anonymous health storage',async()=>{
  const local=memoryStorage({[STORAGE_KEY]:'legacy private health information'},true),provider=fakeService();
  const store=createHealthStore({service:provider,local});await store.initialize();
  assert.equal(store.getSnapshot().user.id,USER_A.id);
  assert.deepEqual(store.getRecords().map(r=>r.id),['reading-a']);
  assert.equal(local.calls.length,0);
});

test('cloud save updates the shared snapshot only after the server confirms it',async()=>{
  const local=memoryStorage({},true),provider=fakeService(),save=deferred();
  provider.saveWorkspace=async input=>{provider.calls.push(['save',input]);return save.promise};
  const store=createHealthStore({service:provider,local});await store.initialize();
  const next=observation('reading-new',USER_A,74),request=store.saveRecords([next]);
  assert.equal(store.getSnapshot().saving,true);
  assert.deepEqual(store.getRecords().map(r=>r.id),['reading-a']);
  assert.equal(provider.calls.find(x=>x[0]==='save')[1].expectedRevision,4);
  save.resolve(snapshot(USER_A,[next],5));await request;
  assert.equal(store.getSnapshot().saving,false);assert.equal(store.getSnapshot().revision,5);
  assert.deepEqual(store.getRecords().map(r=>r.id),['reading-new']);assert.equal(local.calls.length,0);
});

test('a failed cloud save preserves confirmed observations and never writes local PHI',async()=>{
  const local=memoryStorage({},true),provider=fakeService();
  provider.saveWorkspace=async()=>{throw new Error('Network unavailable')};
  const store=createHealthStore({service:provider,local});await store.initialize();const before=store.getRecords();
  await assert.rejects(store.saveRecords([observation('not-saved',USER_A,74)]),/Network unavailable/);
  assert.deepEqual(store.getRecords(),before);assert.equal(store.getSnapshot().saving,false);assert.equal(store.getSnapshot().revision,4);assert.equal(local.calls.length,0);
});

test('CAS conflicts block further writes until an explicit successful refresh',async()=>{
  const local=memoryStorage({},true),provider=fakeService();let saves=0;
  provider.saveWorkspace=async input=>{
    saves++;if(saves===1){const error=new Error('Account data changed in another session');error.code='WORKSPACE_CONFLICT';throw error}
    return snapshot(USER_A,input.records,input.expectedRevision+1);
  };
  const store=createHealthStore({service:provider,local});await store.initialize();
  await assert.rejects(store.saveRecords([observation('next',USER_A,74)]),/another session/);
  await assert.rejects(store.saveRecords([observation('next',USER_A,74)]),/another session/);
  assert.equal(saves,1);
  provider.workspace=snapshot(USER_A,[observation('updated-elsewhere',USER_A,75)],8);
  await store.refresh();assert.equal(store.getSnapshot().error,'');assert.equal(store.getSnapshot().revision,8);
  await store.saveRecords([observation('next',USER_A,74)]);assert.equal(saves,2);assert.equal(store.getSnapshot().revision,9);
});

test('offline configured store rejects before network and does not fall back to local saving',async()=>{
  const local=memoryStorage({},true),provider=fakeService(),store=createHealthStore({service:provider,local});await store.initialize();
  Object.defineProperty(globalThis,'navigator',{value:{onLine:false},configurable:true});
  await assert.rejects(store.saveRecords([observation('offline',USER_A,74)]),/not been saved remotely/);
  assert.equal(provider.calls.some(x=>x[0]==='save'),false);assert.equal(local.calls.length,0);assert.deepEqual(store.getRecords().map(r=>r.id),['reading-a']);
});

test('logout clears all private in-memory entities even if provider signout fails',async()=>{
  const local=memoryStorage({},true),provider=fakeService();provider.signOut=async()=>{throw new Error('Provider unavailable')};
  const store=createHealthStore({service:provider,local});await store.initialize();
  await assert.rejects(store.auth.signOut(),/Provider unavailable/);
  const value=store.getSnapshot();assert.equal(value.user,null);assert.equal(value.profile,null);assert.deepEqual(value.records,[]);assert.deepEqual(value.missionState,mission());assert.deepEqual(value.alerts,[]);assert.equal(value.revision,0);assert.equal(value.lastSync,null);assert.equal(local.calls.length,0);
});

test('a confirmed save for old account A cannot replace loaded account B data',async()=>{
  const local=memoryStorage({},true),provider=fakeService(),oldSave=deferred();
  provider.saveWorkspace=()=>oldSave.promise;
  const store=createHealthStore({service:provider,local});await store.initialize();
  const request=store.saveRecords([observation('a-new',USER_A,74)]).catch(error=>error);
  provider.workspace=snapshot(USER_B);provider.emit(USER_B);await tick();await tick();
  assert.equal(store.getSnapshot().user.id,USER_B.id);assert.equal(store.getSnapshot().status,'ready');
  oldSave.resolve(snapshot(USER_A,[observation('a-new',USER_A,74)],5));
  const result=await request;assert.match(result.message,/account changed/i);
  assert.equal(store.getSnapshot().user.id,USER_B.id);assert.deepEqual(store.getRecords().map(r=>r.id),['reading-b']);
});

test('a profile response for old account A cannot replace account B profile',async()=>{
  const local=memoryStorage({},true),provider=fakeService(),profileSave=deferred();provider.updateProfile=()=>profileSave.promise;
  const store=createHealthStore({service:provider,local});await store.initialize();
  const request=store.updateProfile({display_name:'Changed A'}).catch(error=>error);
  provider.workspace=snapshot(USER_B);provider.emit(USER_B);await tick();await tick();
  profileSave.resolve({id:USER_A.id,display_name:'Changed A'});const result=await request;
  assert.match(result.message,/account changed/i);assert.equal(store.getSnapshot().profile.id,USER_B.id);assert.equal(store.getSnapshot().profile.display_name,'User B');
});

test('explicit imports bind anonymous observations to the active owner and deduplicate content',async()=>{
  const local=memoryStorage({},true),provider=fakeService(),store=createHealthStore({service:provider,local});await store.initialize();
  const duplicate={...observation('same-content-different-id',null)};
  const merged=store.merge([duplicate]);assert.equal(merged.length,1);assert.equal(merged[0].user_id,USER_A.id);
  assert.throws(()=>store.merge([observation('foreign',USER_B)]),/different account/);
  await assert.rejects(store.saveRecords([observation('foreign',USER_B)]),/different account/);
  assert.equal(provider.calls.some(x=>x[0]==='save'),false);
});

test('returned snapshots are independent and cannot mutate store state',async()=>{
  const local=memoryStorage({},true),provider=fakeService(),store=createHealthStore({service:provider,local});await store.initialize();
  const exposed=store.getSnapshot();exposed.records[0].values.heart=200;exposed.profile.display_name='mutated';exposed.missionState.cases.push({id:'fake'});
  assert.equal(store.getRecords()[0].values.heart,72);assert.equal(store.getSnapshot().profile.display_name,'User A');assert.deepEqual(store.getMissionState(),mission());
});

test('local compatibility loads and updates legacy records without creating account identity',async()=>{
  const legacy={id:'legacy',timestamp:'2020-04-04T07:00:00Z',source:'manual',values:{heart:70},notes:'old browser record',context:'resting'};
  const local=memoryStorage({[STORAGE_KEY]:JSON.stringify([legacy]),[MISSION_STORAGE_KEY]:JSON.stringify(mission())});
  const store=createHealthStore({service:{cloudEnabled:false},local});await store.initialize();
  assert.equal(store.getSnapshot().configured,false);assert.equal(store.getSnapshot().status,'local');assert.equal(store.getSnapshot().user,null);assert.equal(store.getRecords()[0].id,'legacy');
  await store.saveRecords([...store.getRecords(),observation('new-local',null,74)]);
  assert.equal(store.getRecords().length,2);assert.equal(store.getRecords().every(r=>r.user_id===null),true);assert.equal(JSON.parse(local.values.get(STORAGE_KEY)).length,2);
});

test('local multi-key failure rolls back previously written observations and retains the old snapshot',async()=>{
  const rawRecords=JSON.stringify([observation('old-local',null)]),rawMission=JSON.stringify(mission()),rawAlerts='[]';
  const local=memoryStorage({[STORAGE_KEY]:rawRecords,[MISSION_STORAGE_KEY]:rawMission,[ALERT_KEY]:rawAlerts});
  const store=createHealthStore({service:{cloudEnabled:false},local});await store.initialize();const before=store.getSnapshot();
  local.failNext(MISSION_STORAGE_KEY);
  await assert.rejects(store.saveRecords([observation('failed-local',null,74)]),/could not be saved/);
  assert.equal(local.values.get(STORAGE_KEY),rawRecords);assert.equal(local.values.get(MISSION_STORAGE_KEY),rawMission);assert.equal(local.values.get(ALERT_KEY),rawAlerts);assert.deepEqual(store.getRecords(),before.records);assert.equal(store.getSnapshot().saving,false);
});

test('explicit validated restore recovers corrupt local storage without silently claiming an owner',async()=>{
  const local=memoryStorage({[STORAGE_KEY]:'[broken',[MISSION_STORAGE_KEY]:'{broken'}),store=createHealthStore({service:{cloudEnabled:false},local});
  await assert.rejects(store.initialize(),/unreadable/);assert.equal(store.getSnapshot().status,'error');
  await store.restoreWorkspace({records:[observation('restored-local',null)],missionState:mission(),alerts:[]});
  assert.equal(store.getSnapshot().status,'local');assert.equal(store.getSnapshot().user,null);assert.equal(store.getRecords()[0].id,'restored-local');assert.equal(store.getSnapshot().error,'');
});

test('confirmed cloud per-metric IDs, ownership and database creation metadata remain available to every consumer',async()=>{
  const local=memoryStorage({},true),provider=fakeService();
  const reading={id:'33333333-3333-4333-8333-333333333333',user_id:USER_A.id,measured_at:'2026-01-03T10:00:00Z',created_at:'2026-01-03T10:02:00Z',metric_name:'heart',metric_value:72,metric_unit:'bpm',data_source:'manual'};
  provider.workspace.records[0].readings=[reading];
  const store=createHealthStore({service:provider,local});await store.initialize();
  const record=store.getRecords()[0];
  assert.equal(Date.parse(record.measured_at),Date.parse(reading.measured_at));assert.equal(Date.parse(record.created_at),Date.parse(reading.created_at));assert.equal(record.user_id,USER_A.id);
  assert.deepEqual(record.readings,[reading],'Do not drop validated per-metric server metadata when normalizing the shared store');
});

test('configured mode can initialize without accessing an unavailable browser-storage getter',async()=>{
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('Storage access is blocked')}});
  const provider=fakeService();
  const store=createHealthStore({service:provider});
  await store.initialize();
  assert.equal(store.getSnapshot().status,'ready');assert.equal(store.getSnapshot().user.id,USER_A.id);
});

test('invalid cloud configuration blocks local writes instead of starting an empty local ledger',async()=>{
  const legacy=JSON.stringify([observation('existing-local',null)]);
  const local=memoryStorage({[STORAGE_KEY]:legacy,[MISSION_STORAGE_KEY]:JSON.stringify(mission())});
  const store=createHealthStore({service:{cloudEnabled:false,cloudConfigurationError:'Both public Supabase configuration values are required'},local});
  await assert.rejects(store.initialize(),/Supabase configuration/);
  await assert.rejects(store.saveRecords([observation('new-local',null,74)]),/Supabase configuration/);
  assert.equal(local.values.get(STORAGE_KEY),legacy,'Misconfigured cloud mode must never overwrite anonymous browser records');
  assert.equal(store.getSnapshot().status,'error');
});

 test('initial empty SDK session is not treated as a logout racing initialization',async()=>{
 const local=memoryStorage({},true),provider=fakeService(),identity=deferred();provider.initializeCloud=()=>identity.promise;
 const store=createHealthStore({service:provider,local}),initial=store.initialize();
 provider.emit(null,'INITIAL_SESSION');identity.resolve({user:null});
 await initial;assert.equal(store.getSnapshot().status,'auth-required');assert.equal(store.getSnapshot().error,'');assert.deepEqual(store.getRecords(),[]);
 });
