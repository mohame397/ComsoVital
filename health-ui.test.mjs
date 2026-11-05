import test from 'node:test';
import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import {createHealthUI} from '../dist/health-ui.js';
import {validateRecord,mergeRecords} from '../dist/core.js';
import {reconcileAlerts} from '../dist/alert-manager.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function setup({records=[],user=null,configured=false,prefs={timeZone:'UTC'},failSave=false}={}){
 let currentRecords=structuredClone(records),currentUser=user,alerts=[],writes=0,closed=0,modalParts=[],messages=[],linked=0;
 const state=()=>({configured,user:currentUser,profile:{preferences:prefs}});
 const store={getAlerts:()=>alerts,merge:rs=>mergeRecords(currentRecords,rs),async saveRecords(rs){if(failSave)throw new Error('Server rejected save.');writes++;currentRecords=structuredClone(rs);alerts=reconcileAlerts(alerts,rs);return rs},async acknowledge(){},async resolve(){}};
 const ui=createHealthUI({t:(en,ar)=>en,esc,icon:()=>'',modal:(...parts)=>modalParts=parts,closeModal:()=>closed++,toast:message=>messages.push(message),render:()=>{},getRecords:()=>currentRecords,getSettings:()=>prefs,getState:state,store,linkedCaseCount:()=>linked});
 return {ui,store,get records(){return currentRecords},get writes(){return writes},get closed(){return closed},get html(){return modalParts.join('')},get messages(){return messages},setUser(value){currentUser=value},setRecords(value){currentRecords=structuredClone(value)},setLinked(value){linked=value},setAlerts(value){alerts=value}};
}
const fd=(data={})=>{const f=new FormData();for(const[k,v]of Object.entries({userId:'local',timestamp:'2026-01-10T12:34:56',timeZone:'UTC',heart:'74',context:'unknown',...data}))f.set(k,v);return f};
const reading=(extra={})=>validateRecord({id:'reading-a',timestamp:'2026-01-10T12:34:56.789Z',created_at:'2026-01-11T10:00:00Z',source:'manual',values:{heart:72},notes:'Original',context:'resting',...extra});

test('new form has no invented current measurement time and exposes quality by name',()=>{
 const s=setup();s.ui.openLog();assert.match(s.html,/name="timestamp"[^>]+value="" required/);assert.match(s.html,/health-now/);assert.match(s.html,/Recording context &amp; data quality|Recording context & data quality/);assert.match(s.html,/name="energy"/);assert.match(s.html,/name="symptoms"/);
});
test('historical local submission keeps measured time separate from actual creation time',async()=>{
 const s=setup();await s.ui.submit({id:'reading-form'},fd());assert.equal(s.records.length,1);assert.equal(s.records[0].measured_at,'2026-01-10T12:34:56.000Z');assert.ok(Date.now()-Date.parse(s.records[0].created_at)<1000);assert.equal(s.records[0].context,'unknown');assert.equal(s.writes,1);assert.match(s.messages[0],/Saved on this device/);
});
test('blank dates, blanks-only indicators and invalid decimal syntax do not write',async()=>{
 for(const data of [{timestamp:''},{heart:''},{heart:'0x50'},{heart:'Infinity'}]){const s=setup();await assert.rejects(s.ui.submit({id:'reading-form'},fd(data)));assert.equal(s.writes,0)}
});
test('entry timezone is bound to the form instead of changing with later profile preferences',async()=>{
 const s=setup({prefs:{timeZone:'Asia/Tokyo'}});await s.ui.submit({id:'reading-form'},fd({timestamp:'2026-01-10T12:34:56',timeZone:'Africa/Cairo'}));assert.equal(s.records[0].timestamp,'2026-01-10T10:34:56.000Z');
});
test('correction preserves identifier, original creation time and unchanged timestamp milliseconds',async()=>{
 const original=reading(),s=setup({records:[original]});s.ui.openLog(original.id);assert.match(s.html,/2026-01-10T12:34:56/);await s.ui.submit({id:'reading-form'},fd({recordId:original.id,recordFingerprint:JSON.stringify(original),originalEnteredTimestamp:'2026-01-10T12:34:56',notes:'Corrected',heart:'80'}));assert.equal(s.records.length,1);assert.equal(s.records[0].id,original.id);assert.equal(s.records[0].timestamp,original.timestamp);assert.equal(s.records[0].created_at,original.created_at);assert.equal(s.records[0].values.heart,80);assert.equal(s.records[0].notes,'Corrected');
});
test('stale edits and changed authenticated identity reject before writing',async()=>{
 const original=reading(),s=setup({records:[original]});s.setRecords([{...original,notes:'Newer note'}]);await assert.rejects(s.ui.submit({id:'reading-form'},fd({recordId:original.id,recordFingerprint:JSON.stringify(original)})),/changed while editing/);assert.equal(s.writes,0);
 const a=setup({user:{id:'user-b'},configured:true});await assert.rejects(a.ui.submit({id:'reading-form'},fd({userId:'user-a'})),/account changed/);assert.equal(a.writes,0);
});
test('cloud success is declared only after save, server errors preserve form and have no success claim',async()=>{
 const failed=setup({configured:true,user:{id:'user-a'},failSave:true});await assert.rejects(failed.ui.submit({id:'reading-form'},fd({userId:'user-a'})),/Server rejected/);assert.equal(failed.closed,0);assert.equal(failed.messages.length,0);
 const good=setup({configured:true,user:{id:'user-a'}});await good.ui.submit({id:'reading-form'},fd({userId:'user-a'}));assert.equal(good.records[0].created_at,null);assert.equal(good.records[0].user_id,'user-a');assert.match(good.messages[0],/after server confirmation/);
});
test('Fahrenheit and mmol input convert to the shared canonical units without fabricated fields',async()=>{
 const s=setup();await s.ui.submit({id:'reading-form'},fd({heart:'',temp:'98.6',temperatureUnit:'°F',glucose:'5',glucoseUnit:'mmol/L'}));assert.ok(Math.abs(s.records[0].values.temp-37)<1e-9);assert.equal(s.records[0].values.glucose,90.091);assert.equal(s.records[0].values.oxygen,undefined);
});
test('history visible quality label, source text, notes escaping and date/metric filters work',()=>{
 const s=setup({records:[reading({notes:'<img src=x onerror=evil()>'}),reading({id:'sleep',timestamp:'2026-01-12T10:00:00Z',measured_at:'2026-01-12T10:00:00Z',values:{sleep:7}})]});
 assert.match(s.ui.recordRows(),/Context & quality/);assert.match(s.ui.recordRows(),/&lt;img/);assert.doesNotMatch(s.ui.recordRows(),/<img/);s.ui.change({id:'history-filter-metric',value:'sleep'});assert.doesNotMatch(s.ui.recordRows(),/data-id="reading-a"/);assert.match(s.ui.recordRows(),/data-id="sleep"/);s.ui.change({id:'history-filter-from',value:'2026-01-13'});assert.match(s.ui.recordRows(),/No matching measurements/);
});
test('linked deletion is blocked both before confirmation and at mutation',async()=>{
 const s=setup({records:[reading()]});s.setLinked(1);await assert.rejects(s.ui.action({dataset:{action:'delete',id:'reading-a'}}),/linked to a case/);assert.equal(s.writes,0);
 s.setLinked(0);await s.ui.action({dataset:{action:'delete',id:'reading-a'}});assert.match(s.html,/health-delete-actor/);const previous=globalThis.document;globalThis.document={querySelector:()=>({value:'local'})};try{s.setLinked(1);await assert.rejects(s.ui.action({dataset:{action:'confirm-delete',id:'reading-a'}}),/now linked/);assert.equal(s.writes,0)}finally{globalThis.document=previous}
});
test('canonical import requires preview, explicit personal intent and preserves exact original timestamps',async()=>{
 const s=setup(),content=JSON.stringify({records:[reading()]}),form=new FormData();form.set('userId','local');form.set('file',new File([content],'observations.json',{type:'application/json'}));await s.ui.submit({id:'import-form'},form);assert.equal(s.writes,0);assert.match(s.html,/health-import-confirm/);assert.match(s.html,/personalIntent/);await assert.rejects(s.ui.submit({id:'health-import-confirm'},fd()),/explicit personal/);assert.equal(s.writes,0);await s.ui.submit({id:'health-import-confirm'},fd({personalIntent:'on'}));assert.equal(s.records[0].timestamp,'2026-01-10T12:34:56.789Z');assert.equal(s.records[0].source,'imported');assert.equal(s.writes,1);
});
test('TSV mapping and row-error preview never automatically interpret numeric columns or save invalid rows',async()=>{
 const s=setup(),form=new FormData();form.set('userId','local');form.set('file',new File(['time\tbpm\n2026-01-10T10:00:00Z\t72\n2026-01-10T11:00:00Z\tbad'],'measurements.tsv'));await s.ui.submit({id:'import-form'},form);assert.match(s.html,/health-import-map/);assert.equal(s.writes,0);await s.ui.submit({id:'health-import-map'},fd({timestampColumn:'0',valueColumn:'1',metric:'heart',unit:'bpm',dataSource:'my export',timeZone:'UTC'}));assert.match(s.html,/errors · nothing will be saved/);assert.doesNotMatch(s.html,/type="submit" form="health-import-confirm"/);await assert.rejects(s.ui.submit({id:'health-import-confirm'},fd({personalIntent:'on'})),/no fully validated/);assert.equal(s.writes,0);
});
test('import previews bind to original account and get cleared explicitly on logout',async()=>{
 const s=setup(),form=new FormData();form.set('userId','local');form.set('file',new File([JSON.stringify({records:[reading()]})],'records.json'));await s.ui.submit({id:'import-form'},form);s.ui.clearSensitive();await assert.rejects(s.ui.submit({id:'health-import-confirm'},fd({personalIntent:'on'})),/no fully validated/);assert.equal(s.writes,0);
});
test('alerts label reference limitations, distinguish acknowledgement from closure, and keep source timestamps',()=>{
 const r=reading({values:{oxygen:90}}),alerts=reconcileAlerts([], [r]),s=setup({records:[r]});s.setAlerts(alerts);const html=s.ui.alertsView();assert.match(html,/not clinically validated astronaut alerts/);assert.match(html,/Acknowledge · keep unresolved/);assert.match(html,/Record organizational closure/);assert.match(html,/2026/);assert.match(html,/Scientific reference/);assert.match(s.ui.recentAlerts(),/active · view history/);
});
