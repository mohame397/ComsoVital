import {getRecords as readLocalRecords, saveRecords as writeLocalRecords, validateRecord, mergeRecords, STORAGE_KEY, METRICS} from './core.js';
import {getMissionState as readLocalMission, saveMissionState as writeLocalMission, validateMissionState, MISSION_STORAGE_KEY} from './mission.js';
import {reconcileAlerts, validateAlerts, acknowledgeAlert, resolveAlert} from './alert-manager.js';
import * as cloud from './cloud.js';

const ALERT_KEY = 'cosmovital-alert-history-v3';
const emptyMission = () => ({schemaVersion:1,cases:[],consultations:[]});
const clone = value => structuredClone(value);

export function createHealthStore({service=cloud, local}={}) {
  const configured = Boolean(service.cloudEnabled ?? service.enabled);
  const configurationError=service.cloudConfigurationError||service.configurationError||'';
  if(!configured&&!configurationError&&!local){try{local=globalThis.localStorage}catch{local=null}}
  let state={configured,status:configured?'loading':'local',user:null,profile:null,records:[],missionState:emptyMission(),alerts:[],revision:0,saving:false,lastSync:null,error:'',isPasswordRecovery:false};
  let generation=0, initialization=null, refreshing=null;
  const listeners=new Set();
  const emit=()=>{for(const fn of listeners)fn(getSnapshot())};
  const getSnapshot=()=>clone(state);
  function clearPrivate(status='auth-required') {
    generation++;
    state={...state,status,user:null,profile:null,records:[],missionState:emptyMission(),alerts:[],revision:0,lastSync:null,saving:false,error:'',isPasswordRecovery:false};emit();
  }
  function ownerRecords(values) {
    if(!Array.isArray(values)||values.length>10000)throw new Error('Choose at most 10,000 observations.');
    return values.map(raw=>{
      if(configured&&raw.user_id&&raw.user_id!==state.user?.id)throw new Error('An observation belongs to a different account.');
      const r=validateRecord(raw);
      return {...r,user_id:configured?state.user?.id:null};
    });
  }
  function usable(){if(configurationError)throw new Error(configurationError);if(configured&&(!state.user||state.status!=='ready'))throw new Error('Log in and load your account data before making changes.');if(state.error)throw new Error(state.error);if(state.saving)throw new Error('A save is already in progress. Wait for confirmation before saving again.');if(configured&&globalThis.navigator?.onLine===false)throw new Error('You are offline. This form has not been saved remotely. Keep it open and reconnect before saving.');}
  function checkedMission(mission,records){const next=validateMissionState(mission);const ids=new Set(records.map(r=>r.id));if(ids.size!==records.length)throw new Error('Observation identifiers must be unique.');if(next.cases.some(c=>c.recordIds.some(id=>!ids.has(id))))throw new Error('A case has a missing linked observation.');return next;}
  function applyCloud(value){
    if(value.profile&&value.profile.id!==state.user?.id)throw new Error('The server returned a profile belonging to another account.');
    const records=ownerRecords(value.records).map((record,index)=>{
      const source=value.records[index];
      if(Array.isArray(source.readings))record.readings=source.readings.map(reading=>{
        if(reading.user_id!==state.user?.id||reading.metric_value!==record.values[reading.metric_name]||reading.metric_unit!==METRICS[reading.metric_name]?.unit||Date.parse(reading.measured_at)!==Date.parse(record.timestamp)||!Number.isFinite(Date.parse(reading.created_at)))throw new Error('The server returned inconsistent per-metric metadata.');
        return clone(reading);
      });
      return record;
    }),missionState=checkedMission(value.missionState,records);
    state={...state,...value,records,missionState,alerts:validateAlerts(value.alerts||[]),status:'ready',saving:false,error:'',lastSync:new Date().toISOString()};emit();
  }
  async function refresh(){
    if(!configured)return getSnapshot();
    if(refreshing)return refreshing;
    refreshing=(async()=>{
      const identityStamp=generation;
      const identity=await service.initializeCloud();
      if(identityStamp!==generation)throw new Error('The account changed while checking the session.');
      if(!identity.user){clearPrivate();return getSnapshot()}
      if(state.user?.id!==identity.user.id){clearPrivate('loading');state.user=clone(identity.user);}
      state.status='loading';state.isPasswordRecovery=Boolean(identity.isPasswordRecovery);emit();
      const stamp=generation,id=state.user.id;
      try{const value=await service.loadWorkspace();if(stamp!==generation||id!==state.user?.id)throw new Error('The account changed while loading.');applyCloud(value);return getSnapshot()}
      catch(e){if(stamp===generation){state={...state,status:'error',error:e.message,records:[],missionState:emptyMission(),alerts:[]};emit()}throw e}
    })().finally(()=>{refreshing=null});return refreshing;
  }
  async function initialize(){
    if(initialization)return initialization;
    initialization=(async()=>{
      if(configurationError){state={...state,status:'error',error:configurationError};emit();throw new Error(configurationError)}
      if(configured)return refresh();
      try{
        const records=readLocalRecords(),missionState=readLocalMission();
        const raw=local?.getItem(ALERT_KEY),alerts=raw?validateAlerts(JSON.parse(raw)):[];
        state={...state,records,missionState,alerts:reconcileAlerts(alerts,records),status:'local',error:''};emit();return getSnapshot();
      }catch(e){state={...state,status:'error',error:e.message};emit();throw e}
    })();return initialization;
  }
  async function save(next){
    usable();const stamp=generation,id=state.user?.id;
    const existingIds=new Set(state.records.map(record=>record.id));
    const records=ownerRecords(next.records??state.records).map(record=>!configured&&!existingIds.has(record.id)&&!record.created_at?{...record,created_at:new Date().toISOString()}:record),missionState=checkedMission(next.missionState??state.missionState,records);
    const alerts=validateAlerts(next.alerts??reconcileAlerts(state.alerts,records));
    state.saving=true;emit();
    try{
      if(configured){
        const saved=await service.saveWorkspace({records,missionState,alerts,expectedRevision:state.revision});
        if(stamp!==generation||id!==state.user?.id)throw new Error('The account changed while saving. No previous account data was applied.');
        applyCloud(saved);
      }else{
        // Validate everything before writing; attempt rollback if a later write fails.
        const keys=[STORAGE_KEY,MISSION_STORAGE_KEY,ALERT_KEY],previous=keys.map(key=>local?.getItem(key));
        try{const saved=writeLocalRecords(records);writeLocalMission(missionState,{replaceCorrupt:next.replaceCorrupt===true});local.setItem(ALERT_KEY,JSON.stringify(alerts));state={...state,records:saved,missionState,alerts,saving:false,error:''};}
        catch(e){try{keys.forEach((key,i)=>previous[i]===null?local.removeItem(key):local.setItem(key,previous[i]))}catch{throw new Error('Save failed and rollback could not complete. Recover an exported backup before further changes.')}throw e}
        emit();
      }
      return getSnapshot();
    }catch(e){if(stamp===generation){state.saving=false;if(e.code==='WORKSPACE_CONFLICT')state.error=e.message;emit()}throw e}
  }
  async function saveRecords(records){return (await save({records})).records}
  async function saveMissionState(missionState){return (await save({missionState,alerts:state.alerts})).missionState}
  async function restoreWorkspace({records,missionState,alerts}){
    if(configurationError)throw new Error(configurationError);
    if(!configured&&state.status==='error'){
      const canonical=ownerRecords(records),mission=checkedMission(missionState,canonical),history=validateAlerts(alerts??reconcileAlerts([],canonical));
      const oldError=state.error;state.error='';state.status='local';
      try{return await save({records:canonical,missionState:mission,alerts:history,replaceCorrupt:true})}catch(e){state.error=oldError;state.status='error';throw e}
    }
    return save({records,missionState,alerts:alerts??reconcileAlerts([],records)});
  }
  async function updateProfile(profile){usable();if(!configured)throw new Error('A cloud account is required to save an account profile.');const stamp=generation,id=state.user.id;const value=await service.updateProfile(profile);if(stamp!==generation||id!==state.user?.id)throw new Error('The account changed while saving the profile.');state.profile=value;emit();return clone(value)}
  async function logout(){clearPrivate();try{return await service.signOut()}finally{clearPrivate()}}
  async function reloadLocal(){if(configured)return refresh();initialization=null;return initialize()}
  const api={initialize,refresh,reloadLocal,getSnapshot,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},clearPrivate,saveRecords,saveMissionState,restoreWorkspace,updateProfile,
    getRecords:()=>clone(state.records),getMissionState:()=>clone(state.missionState),getAlerts:()=>clone(state.alerts),
    merge(incoming){return mergeRecords(state.records,ownerRecords(incoming))},
    async acknowledge(id){return save({alerts:acknowledgeAlert(state.alerts,id)})},
    async resolve(id,reason){return save({alerts:resolveAlert(state.alerts,id,{reason})})},
    async savePreferences(preferences){return updateProfile({...state.profile,preferences:{...state.profile?.preferences,...preferences}})},
    auth:{...service,async signIn(input){const value=await service.signIn(input);initialization=null;await refresh();return value},async signUp(input){const value=await service.signUp(input);if(service.getUser()){initialization=null;await refresh()}return value},signOut:logout,async updatePassword(password){const value=await service.updatePassword(password);state.isPasswordRecovery=false;emit();return value},async deleteAccount(){try{return await service.deleteAccount()}finally{clearPrivate()}}}
  };
  if(configured)service.onAuthChange(value=>{
    if(!value.user){if(value.event==='INITIAL_SESSION'&&!state.user)return;clearPrivate();return}
    if(value.event==='PASSWORD_RECOVERY'){state.isPasswordRecovery=true;emit()}
    if(state.user?.id!==value.user.id){
      clearPrivate('loading');state.user=clone(value.user);emit();
      const id=value.user.id;
      setTimeout(async()=>{
        if(refreshing)await refreshing.catch(()=>{});
        if(state.user?.id===id)await refresh().catch(()=>{});
      },0);
    }
  });
  return api;
}
export const healthStore=createHealthStore();
