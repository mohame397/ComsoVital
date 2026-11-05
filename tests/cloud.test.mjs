import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudService, validatePublicConfig, normalizeCloudSnapshot} from '../dist/cloud.js';

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const config = {supabaseUrl: 'https://example.supabase.co', supabasePublishableKey: 'sb_publishable_unit_test', siteUrl: 'https://cosmo-vital.vercel.app/'};
const date = new Date(Date.now() - 3600000).toISOString();
const baseRecord = () => ({id: 'old-observation-1', timestamp: date, measured_at: date, created_at: date, user_id: A, source: 'manual', values: {heart: 72}, context: 'resting', notes: '', meta: {device: 'QA device', method: 'resting', repeat: 'yes', signal: 'stable', glucoseTiming: 'unknown', temperatureSite: 'unknown'}});
const workspace = id => ({records: [{...baseRecord(), user_id: id}], missionState: {schemaVersion: 1, cases: [], consultations: []}, profile: {id, display_name: id === A ? 'Mohamed' : 'Mahmoud', preferences: {timezone: 'UTC'}}, alerts: [], revision: 0});
function harness({initialUser = {id: A, email: 'a@example.test'}} = {}) {
  const state = {user: initialUser, rows: new Map([[A, workspace(A)], [B, workspace(B)]]), calls: [], authListener: null, rpcOverride: null, error: null, verify: true};
  const emit = (event, user) => {state.user = user; state.authListener?.(event, user ? {user} : null);};
  const client = {
    auth: {
      onAuthStateChange(callback) {state.authListener = callback; return {data: {subscription: {unsubscribe() {state.authListener = null;}}}};},
      async getUser() {return state.getUserOverride ? state.getUserOverride() : {data: {user: state.user}, error: state.error};},
      async signUp(input) {state.calls.push(['signUp', input]); return {data: {user: {id: A, email: input.email}, session: state.verify ? null : {user: {id: A, email: input.email}}}, error: null};},
      async signInWithPassword(input) {state.calls.push(['signIn', input]); if (input.password === 'wrong') return {error: {message: 'Invalid login credentials', code: 'invalid_credentials'}}; const user = {id: input.email.startsWith('b') ? B : A, email: input.email}; emit('SIGNED_IN', user); return {data: {user, session: {user}}, error: null};},
      async signOut(options) {state.calls.push(['signOut', options]); if(state.signOutError)return {error:{message:'Network unavailable'}}; emit('SIGNED_OUT', null); return {error: null};},
      async resetPasswordForEmail(email, options) {state.calls.push(['reset', email, options]); return {error: null};},
      async updateUser(input) {state.calls.push(['updateUser', input]); return {data: {user: state.user}, error: null};}
    },
    from(table) {
      assert.equal(table, 'profiles'); let update, id;
      const query = {
        select() {return query;}, eq(key, value) {assert.equal(key, 'id'); id = value; return query;},
        update(input) {update = input; state.calls.push(['profile-update', input]); return query;},
        async maybeSingle() {return {data: structuredClone(state.rows.get(id)?.profile || null), error: null};},
        async single() {const row = state.rows.get(id); row.profile = {...row.profile, ...update}; return {data: structuredClone(row.profile), error: null};}
      };
      return query;
    },
    async rpc(name, args) {
      state.calls.push(['rpc', name, args]);
      if (state.rpcOverride) return state.rpcOverride(name, args);
      const row = state.rows.get(state.user.id);
      if (name === 'load_health_workspace') return {data: structuredClone(row), error: null};
      if (name === 'save_health_workspace') {
        if (row.revision !== args.p_expected_revision) return {error: {message: 'Workspace conflict', code: '40001'}};
        row.records = args.p_records.map(r => ({...r, user_id: state.user.id, measured_at: r.timestamp, created_at: date})); row.missionState = args.p_mission_state; row.alerts = args.p_alerts; row.revision++;
        return {data: structuredClone(row), error: null};
      }
      if (name === 'delete_my_account') {state.rows.delete(state.user.id); return {data: null, error: null};}
      throw new Error('Unexpected RPC');
    }
  };
  const service = createCloudService({config, clientFactory: (url, key, options) => {state.calls.push(['createClient', url, key, options]); return client;}});
  return {service, state, emit};
}

test('unconfigured builds do not pretend to provide cloud accounts', async () => {
  const service = createCloudService({config: {}}); assert.equal(service.enabled, false); const value = await service.initializeCloud(); assert.equal(value.configured, false); assert.equal(value.user, null); await assert.rejects(service.signIn({email: 'a@example.test', password: 'x'}), /not configured/);
});

test('public config rejects incomplete credentials, non-TLS remote hosts and service-role keys', () => {
  assert.equal(validatePublicConfig(config).enabled, true);
  assert.throws(() => validatePublicConfig({...config, supabasePublishableKey: ''}), /both/);
  assert.throws(() => validatePublicConfig({...config, supabaseUrl: 'http://remote.example'}), /HTTPS/);
  assert.throws(() => validatePublicConfig({...config, supabasePublishableKey: 'sb_secret_private'}), /secret key/);
  const jwt = value => 'x.' + Buffer.from(JSON.stringify(value)).toString('base64url') + '.x';
  assert.throws(() => validatePublicConfig({...config, supabasePublishableKey: jwt({role: 'service_role'})}), /service-role/);
  assert.equal(validatePublicConfig({...config, supabasePublishableKey: jwt({role: 'anon'})}).enabled, true);
  assert.throws(() => validatePublicConfig({...config, supabaseUrl: 'https://user:password@example.supabase.co'}), /credentials/);
});

test('SDK adapter validates registration, credentials, verification and password reset redirect', async () => {
  const {service, state} = harness({initialUser: null});
  await assert.rejects(service.signUp({displayName: 'Crew', email: 'bad', password: 'longpassword123'}), /email/);
  await assert.rejects(service.signUp({displayName: 'Crew', email: 'a@example.test', password: 'short'}), /12/);
  const result = await service.signUp({displayName: ' Crew ', email: ' A@EXAMPLE.TEST ', password: 'longpassword123'});
  assert.equal(result.verificationRequired, true); assert.equal(service.getUser(), null);
  const call = state.calls.find(c => c[0] === 'signUp')[1]; assert.equal(call.options.data.display_name, 'Crew'); assert.equal(call.email, 'a@example.test');
  await assert.rejects(service.signIn({email: 'a@example.test', password: 'wrong'}), /Invalid login/);
  await service.requestPasswordReset(' A@EXAMPLE.TEST '); const reset = state.calls.find(c => c[0] === 'reset'); assert.equal(reset[1], 'a@example.test'); assert.match(reset[2].redirectTo, /auth=recovery#reset-password/);
  assert.equal(state.calls.filter(c => c[0] === 'createClient').length, 1);
});

test('private data requires a server-verified session and profile ownership', async () => {
  const {service, state} = harness({initialUser: null});
  await assert.rejects(service.loadWorkspace(), /Log in/);
  assert.equal(state.calls.some(c => c[0] === 'rpc'), false);
  await service.signIn({email: 'a@example.test', password: 'valid'});
  assert.equal(service.getProfile().id, A);
  const result = await service.loadWorkspace(); assert.equal(result.records[0].user_id, A); assert.equal(result.records[0].measured_at, date);
});

test('normalization rejects foreign owners and mismatched timestamps instead of leaking records', () => {
  assert.throws(() => normalizeCloudSnapshot(workspace(A), B), /ownership/);
  const mixed = workspace(A); mixed.records[0].measured_at = new Date(Date.now() - 60000).toISOString(); assert.throws(() => normalizeCloudSnapshot(mixed, A), /disagree/);
  const profile = workspace(A); profile.profile.id = B; assert.throws(() => normalizeCloudSnapshot(profile, A), /profile/);
  const alerts = workspace(A); alerts.alerts.push({id: 'alert', user_id: B}); assert.throws(() => normalizeCloudSnapshot(alerts, A), /alert/);
});

test('save strips client-created ownership/timestamps and forwards actual observation time and revision', async () => {
  const {service, state} = harness(); await service.initializeCloud();
  const record = {...baseRecord(), created_at: '1900-01-01T00:00:00Z'};
  await service.saveWorkspace({records: [record], expectedRevision: 0});
  const call = state.calls.find(c => c[0] === 'rpc' && c[1] === 'save_health_workspace')[2];
  assert.equal(call.p_expected_revision, 0); assert.equal(call.p_records[0].timestamp, date);
  // The server generates immutable creation timestamps, regardless of client input.
  assert.notEqual((await service.loadWorkspace()).records[0].created_at, record.created_at);
  await assert.rejects(service.saveWorkspace({records: [{...record, user_id: B}], expectedRevision: 1}), /another account/);
});

test('revision conflicts reject instead of applying or overwriting stale account data', async () => {
  const {service, state} = harness(); state.rows.get(A).revision = 4;
  await assert.rejects(service.saveWorkspace({records: [baseRecord()], expectedRevision: 0}), error => error.code === 'WORKSPACE_CONFLICT');
  assert.equal(state.rows.get(A).revision, 4);
});

test('late private responses cannot be applied after switching accounts', async () => {
  const {service, state, emit} = harness(); await service.initializeCloud();
  let finish; const pending = new Promise(resolve => {finish = resolve;}); state.rpcOverride = () => pending;
  const load = service.loadWorkspace();
  await new Promise(resolve => setTimeout(resolve, 0));
  emit('SIGNED_IN', {id: B, email: 'b@example.test'});
  finish({data: workspace(A), error: null});
  await assert.rejects(load, /account changed/); assert.equal(service.getUser().id, B); assert.equal(service.getProfile(), null);
});

test('profile updates permit known fields and never use display names as identity', async () => {
  const {service, state} = harness(); await service.initializeCloud();
  const result = await service.updateProfile({id: B, display_name: 'Same Name', crew_identifier: 'Crew-5', mission_name: 'Mission', preferences: {timezone: 'Africa/Cairo'}});
  assert.equal(result.id, A); assert.equal(result.display_name, 'Same Name'); assert.equal(state.rows.get(B).profile.display_name, 'Mahmoud');
  assert.equal('id' in state.calls.find(c => c[0] === 'profile-update')[1], false);
});

test('adapter writes no health data to local storage; signout and deletion clear cached identity', async () => {
  const original = globalThis.localStorage; let writes = 0; globalThis.localStorage = {setItem() {writes++;}, getItem() {return null;}};
  try {
    const {service, state} = harness(); await service.initializeCloud(); await service.loadWorkspace(); await service.saveWorkspace({records: [baseRecord()], expectedRevision: 0});
    assert.equal(writes, 0);
    await service.deleteAccount(); assert.equal(service.getUser(), null); assert.equal(service.getProfile(), null); assert.equal(state.rows.has(A), false); assert.equal(state.rows.has(B), true);
  } finally {if (original === undefined) delete globalThis.localStorage; else globalThis.localStorage = original;}
});


test('an old initialization getUser response cannot resurrect identity after logout', async () => {
  const {service, state} = harness();
  let finish; const pending = new Promise(resolve => {finish = resolve;}); state.getUserOverride = () => pending;
  const initialize = service.initializeCloud();
  await new Promise(resolve => setTimeout(resolve, 0));
  await service.signOut(); assert.equal(service.getUser(), null);
  finish({data: {user: {id: A, email: 'a@example.test'}}, error: null});
  await assert.rejects(initialize, /account changed/); assert.equal(service.getUser(), null); assert.equal(service.getProfile(), null);
  assert.equal(state.calls.some(call => call[0] === 'rpc'), false);
});

test('an old session check cannot begin a private RPC after logout', async () => {
  const {service, state} = harness(); await service.initializeCloud();
  let finish; const pending = new Promise(resolve => {finish = resolve;}); state.getUserOverride = () => pending;
  const load = service.loadWorkspace(); await new Promise(resolve => setTimeout(resolve, 0));
  await service.signOut(); finish({data: {user: {id: A, email: 'a@example.test'}}, error: null});
  await assert.rejects(load, /account changed/); assert.equal(service.getUser(), null);
  assert.equal(state.calls.filter(call => call[0] === 'rpc').length, 0);
});

test('provider logout failure still clears this device session without claiming server revocation', async () => {
  const {service, state, emit} = harness(); await service.initializeCloud();
  const sdkCall = state.calls.find(call => call[0] === 'createClient'), storage = sdkCall[3].auth.storage;
  storage.setItem(sdkCall[3].auth.storageKey, 'isolated-fake-auth-token');
  state.signOutError = true; const oldListener=state.authListener;
  const result = await service.signOut();
  assert.equal(result.localSessionCleared, true); assert.equal(result.serverRevocationConfirmed, false); assert.match(result.warning, /could not confirm/);
  assert.equal(storage.getItem(sdkCall[3].auth.storageKey), null); assert.equal(service.getUser(), null);
  oldListener('SIGNED_IN', {user: {id: A, email: 'a@example.test'}});
  assert.equal(service.getUser(), null, 'callbacks belonging to a destroyed SDK client are ignored');
});
