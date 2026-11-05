import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAccountUI, validateAccountForm, validateProfileInput} from '../dist/account-ui.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const A = {id:'11111111-1111-4111-8111-111111111111',email:'a@example.com',created_at:'2026-01-01T00:00:00Z'};
const B = {id:'22222222-2222-4222-8222-222222222222',email:'b@example.com'};
function harness(initial = {}, lang = 'en') {
  let current = {configured:true,user:null,profile:null,status:'auth-required',...initial};
  const calls = [], navigations = [], toasts = [], modals = [];
  const h = {calls,navigations,toasts,modals,set:next=>{current={...current,...next}},get:()=>current};
  const ctx = {t:(en,ar)=>lang==='ar'?ar:en,esc,icon:()=>'<svg></svg>',modal:(...v)=>modals.push(v),closeModal:()=>calls.push(['close']),toast:v=>toasts.push(v),render:()=>calls.push(['render']),navigate:v=>navigations.push(v),getState:()=>current,updateProfile:async p=>{calls.push(['profile',p]);current.profile=p;return p},auth:{
    signIn:async v=>{calls.push(['signIn',v]);current.user=A;return {user:A}},signUp:async v=>{calls.push(['signUp',v]);return {session:null,user:A}},signOut:async()=>{calls.push(['signOut']);current.user=null},requestPasswordReset:async email=>{calls.push(['resetRequest',email]);return {}},updatePassword:async password=>{calls.push(['password',password]);return {}},deleteAccount:async()=>{calls.push(['delete']);current.user=null;return {}}
  }};
  h.ctx=ctx;h.ui=createAccountUI(ctx);return h;
}
const form = id => ({id:'acct-'+id,setAttribute(){}});
const fd = values => new Map(Object.entries(values));

test('signup validates email, display name, password and matching confirmation', () => {
  assert.deepEqual(validateAccountForm('signup',{displayName:' A ',email:' A@Example.com ',password:'a secure password',confirmPassword:'a secure password'}),{displayName:'A',email:'a@example.com',password:'a secure password'});
  assert.throws(()=>validateAccountForm('signup',{displayName:'A',email:'bad',password:'123456789012',confirmPassword:'123456789012'}),/email/);
  assert.throws(()=>validateAccountForm('signup',{displayName:'A',email:'a@example.com',password:'short',confirmPassword:'short'}),/12 and 128/);
  assert.throws(()=>validateAccountForm('signup',{displayName:'A',email:'a@example.com',password:'123456789012',confirmPassword:'different'}),/match/);
  assert.throws(()=>validateAccountForm('signup',{displayName:' ',email:'a@example.com',password:'123456789012',confirmPassword:'123456789012'}),/display name/);
});

test('profile accepts only editable fields, valid units and a real IANA zone', () => {
  const p=validateProfileInput({id:B.id,email:'other@example.com',display_name:'A',crew_identifier:'C7',mission_name:'Orbit',timeZone:'Africa/Cairo',temperatureUnit:'°F',glucoseUnit:'mmol/L'});
  assert.deepEqual(Object.keys(p).sort(),['crew_identifier','display_name','mission_name','preferences']);
  assert.equal(p.preferences.timeZone,'Africa/Cairo');
  assert.throws(()=>validateProfileInput({display_name:'A',timeZone:'fake/zone'}),/IANA/);
  assert.throws(()=>validateProfileInput({display_name:'A',temperatureUnit:'K'}),/°C/);
  assert.throws(()=>validateProfileInput({display_name:'A',glucoseUnit:'mg'}),/mg\/dL/);
  assert.throws(()=>validateProfileInput({display_name:'A',crew_identifier:'x'.repeat(81)}),/too long/);
  assert.throws(()=>validateProfileInput({display_name:'A',mission_name:'x'.repeat(121)}),/too long/);
});

test('unconfigured cloud UI is explicit, disabled and never invokes authentication', async () => {
  const h=harness({configured:false});
  assert.match(h.ui.views.login(),/Cloud accounts are not configured/);
  assert.match(h.ui.views.signup(),/<fieldset disabled>/);
  assert.equal(h.ui.protected('overview'),false);
  await assert.rejects(h.ui.submit(form('login'),fd({email:A.email,password:'pass'})),/not configured/);
  assert.equal(h.calls.length,0);
});

test('private routes require authentication while research/training remain public', () => {
  const h=harness();
  for(const view of ['overview','cases','consultations','records','profile','alerts']) assert.equal(h.ui.protected(view),true,view);
  for(const view of ['research','training','login','signup']) assert.equal(h.ui.protected(view),false,view);
  h.set({user:A});assert.equal(h.ui.protected('records'),false);
});

test('sign in redirects only after the asynchronous provider succeeds', async () => {
  const h=harness();
  let resolve;h.ctx.auth.signIn=()=>new Promise(r=>{resolve=r});
  const request=h.ui.submit(form('login'),fd({email:A.email,password:'existing password'}));
  assert.deepEqual(h.navigations,[]);
  resolve({user:A});assert.equal(await request,true);assert.deepEqual(h.navigations,['overview']);
  const failure=harness();failure.ctx.auth.signIn=async()=>{throw new Error('Invalid login credentials')};
  await assert.rejects(failure.ui.submit(form('login'),fd({email:A.email,password:'wrong'})),/Invalid login/);
  assert.deepEqual(failure.navigations,[]);
});

test('signup without a session requests verification without claiming email delivery', async () => {
  const h=harness();
  await h.ui.submit(form('signup'),fd({displayName:'A',email:A.email,password:'123456789012',confirmPassword:'123456789012'}));
  assert.deepEqual(h.navigations,['login']);
  const html=h.ui.views.login();assert.match(html,/does not confirm email delivery/);assert.doesNotMatch(html,/<fieldset disabled>/);
});

test('forgot password shows a generic request response and restores usable controls', async () => {
  const h=harness();await h.ui.submit(form('forgot-password'),fd({email:A.email}));
  const html=h.ui.views['forgot-password']();
  assert.match(html,/If this address has an eligible account/);assert.match(html,/Delivery is not confirmed/);assert.doesNotMatch(html,/<fieldset disabled>/);
});

test('profile and reset forms bind to the account that opened them', async () => {
  const h=harness({user:A,profile:{display_name:'A'}});
  assert.match(h.ui.views.profile(),new RegExp(`name="userId" value="${A.id}"`));
  assert.match(h.ui.views['reset-password'](),new RegExp(`name="userId" value="${A.id}"`));
  h.set({user:B});
  await assert.rejects(h.ui.submit(form('profile'),fd({userId:A.id,display_name:'A',timeZone:'UTC',temperatureUnit:'°C',glucoseUnit:'mg/dL'})),/account changed/);
  await assert.rejects(h.ui.submit(form('reset-password'),fd({userId:A.id,password:'123456789012',confirmPassword:'123456789012'})),/account changed/);
  assert.equal(h.calls.length,0);
});

test('profile output escapes identity fields and survives malformed stored timezone', () => {
  const h=harness({user:{...A,email:'<script>bad</script>@example.com'},profile:{display_name:'<img src=x onerror=bad>',preferences:{timeZone:'not/a-zone'}}});
  const html=h.ui.views.profile();assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<img src=x/);assert.match(html,/value="UTC" selected/);
});

test('account deletion requires explicit text, reauthentication and unchanged identity', async () => {
  const h=harness({user:A});
  await h.ui.action({dataset:{action:'acct-delete-open'}});
  assert.match(h.modals[0][2],/name="confirmation"/);
  await assert.rejects(h.ui.submit(form('delete'),fd({userId:A.id,confirmation:'delete',password:'pass'})),/DELETE exactly/);
  assert.equal(h.calls.length,0);
  await h.ui.submit(form('delete'),fd({userId:A.id,confirmation:'DELETE',password:'pass'}));
  assert.deepEqual(h.calls.slice(0,2).map(x=>x[0]),['signIn','delete']);assert.deepEqual(h.navigations,['login']);
  const switched=harness({user:A});switched.ctx.auth.signIn=async()=>{switched.set({user:B});return {user:A}};
  await assert.rejects(switched.ui.submit(form('delete'),fd({userId:A.id,confirmation:'DELETE',password:'pass'})),/identity could not be confirmed/);
  assert.equal(switched.calls.some(x=>x[0]==='delete'),false);
});

test('Arabic local validation is translated and authentication errors never navigate', async () => {
  const h=harness({},'ar');
  await assert.rejects(h.ui.submit(form('signup'),fd({displayName:'أ',email:A.email,password:'123456789012',confirmPassword:'different'})),/غير متطابقتين/);
  assert.deepEqual(h.navigations,[]);
});
