import {publicConfig} from './config.js';
import {validateRecord, METRICS} from './core.js';
import {validateMissionState} from './mission.js';

const emptyMission = () => ({schemaVersion: 1, cases: [], consultations: []});
const text = (v, max = 200) => typeof v === 'string' && v.trim().length <= max ? v.trim() : '';
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);

export function validatePublicConfig(raw = {}) {
  const config = {
    supabaseUrl: text(raw.supabaseUrl, 2048),
    supabasePublishableKey: text(raw.supabasePublishableKey, 4096),
    siteUrl: text(raw.siteUrl, 2048)
  };
  if (!config.supabaseUrl && !config.supabasePublishableKey) return {...config, enabled: false};
  if (!config.supabaseUrl || !config.supabasePublishableKey) throw new Error('Set both the Supabase project URL and its public publishable key.');
  const url = new URL(config.supabaseUrl);
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('Use the Supabase project origin, without credentials or a path.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Supabase must use HTTPS, except for local development.');
  if (/^sb_secret_/i.test(config.supabasePublishableKey)) throw new Error('A secret key must never be included in the website. Use a publishable or anon key.');
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.supabasePublishableKey)) {
    try {
      const part = config.supabasePublishableKey.split('.')[1];
      const decode = globalThis.atob || (value => globalThis.Buffer.from(value, 'base64').toString('utf8'));
      const token = JSON.parse(decode(part.replace(/-/g, '+').replace(/_/g, '/')));
      if (token.role !== 'anon') throw new Error();
    } catch { throw new Error('Use a Supabase publishable key or legacy anon JWT, never a service-role key.'); }
  }
  if (config.siteUrl) {
    const site = new URL(config.siteUrl);
    if (site.username || site.password || site.protocol !== 'https:' && !(site.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(site.hostname))) throw new Error('Set a valid HTTPS application URL.');
  }
  return {...config, supabaseUrl: url.origin, enabled: true};
}

function providerError(error, fallback = 'The service could not complete this request.') {
  const message = typeof error?.message === 'string' ? error.message : fallback;
  const conflict = error?.code === '40001' || /workspace conflict|revision conflict|another device|stale revision/i.test(message);
  const result = new Error(conflict ? 'Your account data changed in another session. Reload the latest data before saving again.' : message);
  result.code = conflict ? 'WORKSPACE_CONFLICT' : error?.code || 'CLOUD_ERROR';
  return result;
}

export function normalizeCloudSnapshot(raw, userId) {
  if (!raw || typeof raw !== 'object' || !identifier(userId) || !Array.isArray(raw.records) || raw.records.length > 10000 || !Number.isSafeInteger(Number(raw.revision)) || Number(raw.revision) < 0) throw new Error('The server returned an invalid health workspace.');
  const records = raw.records.map(record => {
    if (record.user_id !== userId || !instant(record.created_at) || !instant(record.measured_at || record.timestamp)) throw new Error('The server returned a record with invalid ownership or timestamps.');
    if (record.measured_at && record.timestamp && Date.parse(record.measured_at) !== Date.parse(record.timestamp)) throw new Error('Measurement timestamp fields disagree.');
    const canonical = validateRecord({...record, timestamp: record.measured_at || record.timestamp});
    const output = {...canonical, user_id: userId, measured_at: canonical.timestamp, created_at: new Date(record.created_at).toISOString()};
    if (record.source_reference != null) output.source_reference = structuredClone(record.source_reference);
    if (record.checkin != null) output.checkin = structuredClone(record.checkin);
    if (Array.isArray(record.readings)) {
      output.readings = record.readings.map(reading => {
        if (!identifier(reading.id) || reading.user_id != null && reading.user_id !== userId || !instant(reading.created_at) || !instant(reading.measured_at) || !Number.isFinite(reading.metric_value) || !Object.hasOwn(canonical.values, reading.metric_name) || reading.metric_value !== canonical.values[reading.metric_name] || reading.metric_unit !== METRICS[reading.metric_name]?.unit) throw new Error('The server returned an invalid metric reading.');
        return structuredClone(reading);
      });
    }
    return output;
  });
  if (new Set(records.map(record => record.id)).size !== records.length) throw new Error('The server returned duplicate observation identifiers.');
  const missionState = validateMissionState(raw.missionState || emptyMission());
  const recordIds = new Set(records.map(record => record.id));
  if (missionState.cases.some(entry => entry.recordIds.some(id => !recordIds.has(id)))) throw new Error('The server returned a case with missing linked observations.');
  if (raw.profile && raw.profile.id !== userId) throw new Error('The server returned a profile belonging to another account.');
  if (!Array.isArray(raw.alerts || [])) throw new Error('The server returned an invalid alert history.');
  const alerts = structuredClone(raw.alerts || []);
  if (alerts.some(alert => alert.user_id != null && alert.user_id !== userId)) throw new Error('The server returned an alert belonging to another account.');
  return {records: records.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)), missionState, profile: raw.profile ? structuredClone(raw.profile) : null, alerts, revision: Number(raw.revision)};
}

export function createCloudService({config: input = publicConfig, clientFactory} = {}) {
  let configError = null, config;
  try { config = validatePublicConfig(input); } catch (error) { configError = error; config = {...input, enabled: false}; }
  let client = null, user = null, profile = null, initialization = null, authUnsubscribe = null, generation = 0, recovery = false, lifecycle = 0, clientPromise = null, clientToken = null, authOperation = null;
  const authKey = config.enabled ? 'cosmovital-auth-' + new URL(config.supabaseUrl).hostname : '';
  const memoryAuth = new Map(), authKeys = new Set([authKey, authKey + '-code-verifier']);
  const authStorage = {
    getItem(key) { authKeys.add(key); try { return globalThis.localStorage?.getItem(key) ?? memoryAuth.get(key) ?? null; } catch { return memoryAuth.get(key) ?? null; } },
    setItem(key, value) { authKeys.add(key); memoryAuth.set(key, value); try { globalThis.localStorage?.setItem(key, value); } catch {} },
    removeItem(key) { memoryAuth.delete(key); try { globalThis.localStorage?.removeItem(key); } catch {} }
  };
  function clearLocalSession() { lifecycle++; clientToken=null; clientPromise=null; authOperation=null; authUnsubscribe?.(); authUnsubscribe = null; client?.auth.stopAutoRefresh?.(); for (const key of authKeys) authStorage.removeItem(key); client = null; initialization = null; setIdentity(null); recovery = false; }
  const listeners = new Set();
  const snapshot = () => ({user: user ? {...user} : null, profile: profile ? structuredClone(profile) : null, configured: config.enabled, isPasswordRecovery: recovery});
  const publish = (event = 'AUTH_CHANGED') => {
    const value = {...snapshot(), event};
    for (const listener of listeners) Promise.resolve().then(() => listener(value)).catch(() => {});
  };
  const setIdentity = next => {
    const idChanged = user?.id !== next?.id;
    if (idChanged) { generation++; profile = null; recovery = false; }
    user = next || null;
  };
  function assertLifecycle(stamp) {
    if (stamp !== lifecycle) throw new Error('The account changed while the request was running. No previous account data was applied.');
  }
  function beginAuth(email) {
    lifecycle++; initialization=null; if(!client) clientPromise=null;
    authOperation={epoch:lifecycle,email}; return lifecycle;
  }
  async function sdk() {
    if (configError) throw configError;
    if (!config.enabled) throw new Error('Cloud accounts are not configured. Set up Supabase before using this feature.');
    if (client) return client;
    if (clientPromise) return clientPromise;
    const epoch=lifecycle;
    const pending=(async()=>{
      const createClient = clientFactory || (await import('./vendor/supabase.js')).createClient;
      assertLifecycle(epoch);
      const token={}; clientToken=token;
      const instance = createClient(config.supabaseUrl, config.supabasePublishableKey, {auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: authKey, storage: authStorage}});
      client=instance;
      const subscription = instance.auth.onAuthStateChange((event, session) => {
        if(clientToken!==token) return;
        const next=session?.user||null;
        const expected=authOperation?.epoch===lifecycle && authOperation.email===next?.email?.toLowerCase();
        if(event==='SIGNED_OUT' || event!=='INITIAL_SESSION' && next?.id!==user?.id && !expected) lifecycle++;
        setIdentity(next);
        if (event === 'PASSWORD_RECOVERY') recovery = true;
        publish(event);
      });
      authUnsubscribe = () => subscription?.data?.subscription?.unsubscribe();
      return instance;
    })().finally(()=>{if(clientPromise===pending)clientPromise=null});
    clientPromise=pending;
    return pending;
  }
  function assertGeneration(value, id) {
    if (value !== generation || user?.id !== id) throw new Error('The account changed while the request was running. No previous account data was applied.');
  }
  async function requireUser() {
    const epoch=lifecycle, active = await sdk();
    assertLifecycle(epoch);
    const {data, error} = await active.auth.getUser();
    assertLifecycle(epoch);
    if (error) { if (error.name === 'AuthSessionMissingError' || /Auth session missing/i.test(error.message || '')) { setIdentity(null); publish('SIGNED_OUT'); throw new Error('Log in before opening private health data.'); } throw providerError(error); }
    setIdentity(data?.user || null);
    if (!user) throw new Error('Log in before opening private health data.');
    return {active, id: user.id, generation, epoch};
  }
  async function loadProfile(active, id, stamp, epoch=lifecycle) {
    const {data, error} = await active.from('profiles').select('*').eq('id', id).maybeSingle();
    if (error) throw providerError(error);
    assertLifecycle(epoch); assertGeneration(stamp, id);
    if (data && data.id !== id) throw new Error('Invalid profile ownership.');
    profile = data || null;
    return profile;
  }
  function redirect(recoveryMode = false) {
    const raw = config.siteUrl || globalThis.location?.origin + globalThis.location?.pathname;
    if (!raw || raw.startsWith('undefined')) throw new Error('Set the application site URL before enabling email verification and password reset.');
    const url = new URL(raw); url.hash = recoveryMode ? 'reset-password' : 'overview';
    if (recoveryMode) url.searchParams.set('auth', 'recovery');
    return url.href;
  }
  function credentials(email, password, strong = false) {
    email = text(email, 254).toLowerCase();
    if (!validEmail(email)) throw new Error('Enter a valid email address.');
    if (typeof password !== 'string' || !password || password.length > 128 || strong && password.length < 12) throw new Error(strong ? 'Use a password containing 12 to 128 characters.' : 'Enter your password.');
    return {email, password};
  }
  const api = {
    enabled: config.enabled,
    configurationError: configError?.message || '',
    getUser: () => user ? {...user} : null,
    getProfile: () => profile ? structuredClone(profile) : null,
    onAuthChange(listener) { if (typeof listener !== 'function') throw new Error('An authentication listener is required.'); listeners.add(listener); return () => listeners.delete(listener); },
    async initializeCloud() {
      if (configError) throw configError;
      if (!config.enabled) return snapshot();
      if (!initialization) initialization = (async () => {
        const epoch=lifecycle, active = await sdk();
        assertLifecycle(epoch);
        const {data, error} = await active.auth.getUser();
        assertLifecycle(epoch);
        if (error && error.name !== 'AuthSessionMissingError' && !/Auth session missing/i.test(error.message || '')) throw providerError(error);
        setIdentity(data?.user || null);
        if (user) await loadProfile(active, user.id, generation, epoch);
        return snapshot();
      })().catch(error => { initialization = null; throw error; });
      await initialization;
      return snapshot();
    },
    async signUp({displayName, email, password}) {
      const name = text(displayName, 80);
      if (!name) throw new Error('Enter a display name of up to 80 characters.');
      const clean = credentials(email, password, true), epoch=beginAuth(clean.email), active = await sdk();
      assertLifecycle(epoch);
      const {data, error} = await active.auth.signUp({...clean, options: {data: {display_name: name}, emailRedirectTo: redirect()}});
      assertLifecycle(epoch);
      if (error) throw providerError(error);
      authOperation=null; setIdentity(data?.session?.user || null);
      return {user: data?.user || null, verificationRequired: !data?.session, sessionEstablished: !!data?.session};
    },
    async signIn({email, password}) {
      const clean = credentials(email, password), epoch=beginAuth(clean.email), active = await sdk();
      assertLifecycle(epoch);
      const {data, error} = await active.auth.signInWithPassword(clean);
      assertLifecycle(epoch);
      if (error) throw providerError(error, 'The email or password is incorrect.');
      if (!data?.user || !data?.session) throw new Error('Login did not establish a secure session.');
      authOperation=null; setIdentity(data.user); recovery = false;
      await loadProfile(active, user.id, generation, epoch);
      return snapshot();
    },
    async signOut() {
      lifecycle++; authOperation=null; initialization=null; clientPromise=null;
      const active=client;
      if(!active){clearLocalSession();publish('SIGNED_OUT');return {localSessionCleared:true,serverRevocationConfirmed:false,warning:''};}
      let failure = null;
      try { const {error} = await active.auth.signOut({scope: 'local'}); failure = error || null; }
      catch (error) { failure = error; }
      finally { clearLocalSession(); publish('SIGNED_OUT'); }
      return {localSessionCleared: true, serverRevocationConfirmed: !failure, warning: failure ? 'This device was signed out. The server could not confirm session revocation while the connection was unavailable.' : ''};
    },
    async requestPasswordReset(email) {
      const clean = text(email, 254).toLowerCase();
      if (!validEmail(clean)) throw new Error('Enter a valid email address.');
      const active = await sdk();
      const {error} = await active.auth.resetPasswordForEmail(clean, {redirectTo: redirect(true)});
      if (error) throw providerError(error);
      return {requested: true};
    },
    async updatePassword(password) {
      credentials(user?.email || 'account@example.invalid', password, true);
      const {active, id, generation: stamp, epoch} = await requireUser();
      const {error} = await active.auth.updateUser({password});
      if (error) throw providerError(error);
      assertLifecycle(epoch); assertGeneration(stamp, id); recovery = false;
      return {updated: true};
    },
    async updateProfile(input) {
      const {active, id, generation: stamp, epoch} = await requireUser();
      const displayName = text(input.display_name ?? input.displayName, 80);
      if (!displayName) throw new Error('Enter a display name of up to 80 characters.');
      const crewRaw = input.crew_identifier ?? input.crewId ?? '', missionRaw = input.mission_name ?? input.missionName ?? '';
      if (typeof crewRaw !== 'string' || crewRaw.trim().length > 80 || typeof missionRaw !== 'string' || missionRaw.trim().length > 120) throw new Error('Crew ID supports up to 80 characters and mission name up to 120.');
      const crew = crewRaw.trim(), mission = missionRaw.trim();
      if (!input.preferences || typeof input.preferences !== 'object' || Array.isArray(input.preferences) || JSON.stringify(input.preferences).length > 4000) throw new Error('Provide valid account preferences.');
      const {data, error} = await active.from('profiles').update({display_name: displayName, crew_identifier: crew, mission_name: mission, preferences: structuredClone(input.preferences)}).eq('id', id).select('*').single();
      if (error) throw providerError(error);
      assertLifecycle(epoch); assertGeneration(stamp, id);
      if (data?.id !== id) throw new Error('The profile update returned invalid ownership.');
      profile = data; publish('PROFILE_UPDATED'); return structuredClone(profile);
    },
    async loadWorkspace() {
      const {active, id, generation: stamp, epoch} = await requireUser();
      const {data, error} = await active.rpc('load_health_workspace');
      if (error) throw providerError(error);
      assertLifecycle(epoch); assertGeneration(stamp, id);
      const value = normalizeCloudSnapshot(data, id); profile = value.profile; return value;
    },
    async saveWorkspace({records, missionState = emptyMission(), alerts = [], expectedRevision}) {
      if (!Array.isArray(records) || records.length > 10000 || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !Array.isArray(alerts)) throw new Error('A valid workspace and expected revision are required.');
      const canonical = records.map(validateRecord), mission = validateMissionState(missionState);
      const {active, id, generation: stamp, epoch} = await requireUser();
      if (records.some(record => record.user_id && record.user_id !== id)) throw new Error('Measurements belonging to another account cannot be saved.');
      const payload = canonical.map((record, index) => { const value = {...record}; delete value.user_id; delete value.created_at; delete value.readings; if (records[index].source_reference != null) value.source_reference = structuredClone(records[index].source_reference); if (records[index].checkin != null) value.checkin = structuredClone(records[index].checkin); return value; });
      const {data, error} = await active.rpc('save_health_workspace', {p_records: payload, p_mission_state: mission, p_alerts: alerts, p_expected_revision: expectedRevision});
      if (error) throw providerError(error);
      assertLifecycle(epoch); assertGeneration(stamp, id);
      const value = normalizeCloudSnapshot(data, id); profile = value.profile; return value;
    },
    async deleteAccount() {
      const {active, id, generation: stamp, epoch} = await requireUser();
      const {error} = await active.rpc('delete_my_account');
      if (error) throw providerError(error);
      assertLifecycle(epoch); assertGeneration(stamp, id);
      try { await active.auth.signOut({scope: 'local'}); } catch {} finally { clearLocalSession(); publish('SIGNED_OUT'); }
      return {deleted: true};
    },
    destroy() { authUnsubscribe?.(); listeners.clear(); user = null; profile = null; generation++; }
  };
  return api;
}

const service = createCloudService();
export const cloudEnabled = service.enabled;
export const cloudConfigurationError = service.configurationError;
export const initializeCloud = (...args) => service.initializeCloud(...args);
export const onAuthChange = (...args) => service.onAuthChange(...args);
export const getUser = (...args) => service.getUser(...args);
export const getProfile = (...args) => service.getProfile(...args);
export const signUp = (...args) => service.signUp(...args);
export const signIn = (...args) => service.signIn(...args);
export const signOut = (...args) => service.signOut(...args);
export const requestPasswordReset = (...args) => service.requestPasswordReset(...args);
export const updatePassword = (...args) => service.updatePassword(...args);
export const updateProfile = (...args) => service.updateProfile(...args);
export const loadWorkspace = (...args) => service.loadWorkspace(...args);
export const saveWorkspace = (...args) => service.saveWorkspace(...args);
export const deleteAccount = (...args) => service.deleteAccount(...args);
