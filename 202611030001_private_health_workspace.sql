-- Apply to a new Supabase project. No existing records or tables are dropped.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Explorer' check (length(btrim(display_name)) between 1 and 80),
  crew_identifier text check (length(crew_identifier) <= 80),
  mission_name text check (length(mission_name) <= 120),
  preferences jsonb not null default '{}' check (jsonb_typeof(preferences) = 'object' and octet_length(preferences::text) <= 16384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.health_observations (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  measured_at timestamptz not null,
  created_at timestamptz not null default now(),
  data_source text not null check (data_source in ('manual','imported')),
  source_reference jsonb,
  context text not null default 'unknown' check (context in ('unknown','resting','post-exercise','other')),
  notes text not null default '' check (length(notes) <= 1000),
  symptoms text not null default '' check (length(symptoms) <= 2000),
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  checkin jsonb not null default '{}' check (jsonb_typeof(checkin) = 'object'),
  primary key (user_id,id)
);
create table if not exists public.health_readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  observation_id text not null,
  measured_at timestamptz not null,
  created_at timestamptz not null default now(),
  metric_name text not null check (metric_name in ('heart','oxygen','sleep','temp','sys','dia','glucose','hrv','eda','mood','energy')),
  metric_value numeric not null,
  metric_unit text not null,
  data_source text not null check (data_source in ('manual','imported')),
  source_reference jsonb,
  foreign key (user_id,observation_id) references public.health_observations(user_id,id) on delete cascade,
  unique (user_id,observation_id,metric_name)
);
create index if not exists health_readings_owner_time on public.health_readings(user_id,measured_at desc);
create index if not exists health_readings_owner_metric_time on public.health_readings(user_id,metric_name,measured_at desc);
create table if not exists public.daily_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  observation_id text not null,
  checkin_date date not null,
  sleep_hours numeric check (sleep_hours between 0 and 24),
  mood smallint check (mood between 1 and 5),
  energy_level smallint check (energy_level between 1 and 5),
  symptoms jsonb not null default '[]' check (jsonb_typeof(symptoms) in ('array','object')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  foreign key (user_id,observation_id) references public.health_observations(user_id,id) on delete cascade,
  unique (user_id,observation_id)
);
create table if not exists public.health_alerts (
  id text not null check (id ~ '^[a-zA-Z0-9_-]{1,150}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  related_reading_id text,
  dedupe_key text not null,
  severity text not null check (severity in ('info','informational','review','urgent')),
  message text not null,
  status text not null check (status in ('active','acknowledged','resolved')),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  primary key(user_id,id),
  unique(user_id,dedupe_key),
  check (status <> 'resolved' or resolved_at is not null),
  check (status <> 'acknowledged' or acknowledged_at is not null)
);
create index if not exists health_alerts_owner_status on public.health_alerts(user_id,status,created_at desc);
create table if not exists public.medical_review_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  request_status text not null check (request_status in ('draft','prepared','exported','external-sharing-recorded')),
  summary text not null,
  packet jsonb not null check (jsonb_typeof(packet) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id,id)
);
create table if not exists public.workspace_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mission_state jsonb not null default '{"schemaVersion":1,"cases":[],"consultations":[]}' check (jsonb_typeof(mission_state) = 'object'),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

-- The RPCs derive the caller from auth.uid(). Private health data is never public.
alter table public.profiles enable row level security;
alter table public.health_observations enable row level security;
alter table public.health_readings enable row level security;
alter table public.daily_checkins enable row level security;
alter table public.health_alerts enable row level security;
alter table public.medical_review_requests enable row level security;
alter table public.workspace_state enable row level security;
do $policies$
declare v_table text;
begin
  foreach v_table in array array['profiles','health_observations','health_readings','daily_checkins','health_alerts','medical_review_requests','workspace_state'] loop
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=v_table and policyname='owner_read') then
      execute format('create policy owner_read on public.%I for select to authenticated using ((select auth.uid()) = %I)',v_table,case when v_table='profiles' then 'id' else 'user_id' end);
    end if;
  end loop;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='owner_profile_update') then
    create policy owner_profile_update on public.profiles for update to authenticated using ((select auth.uid())=id) with check ((select auth.uid())=id);
  end if;
end
$policies$;
revoke all on public.profiles,public.health_observations,public.health_readings,public.daily_checkins,public.health_alerts,public.medical_review_requests,public.workspace_state from anon,authenticated;
grant select on public.profiles,public.health_observations,public.health_readings,public.daily_checkins,public.health_alerts,public.medical_review_requests,public.workspace_state to authenticated;
grant update (display_name,crew_identifier,mission_name,preferences) on public.profiles to authenticated;

create or replace function public.cosmovital_touch_profile()
returns trigger language plpgsql set search_path='' as $$
begin new.updated_at=now();new.id=old.id;new.created_at=old.created_at;return new;end $$;
do $trigger$ begin if not exists(select 1 from pg_trigger where tgrelid='public.profiles'::regclass and tgname='cosmovital_profile_updated') then create trigger cosmovital_profile_updated before update on public.profiles for each row execute function public.cosmovital_touch_profile();end if;end $trigger$;

-- Helper execution is not exposed as an API. Bounds catch unit/input errors;
-- they are not medical normal ranges, clinical thresholds, or diagnoses.
create or replace function public.cosmovital_validate_record(p_record jsonb)
returns void language plpgsql set search_path='' as $$
declare v_key text;v_value jsonb;v_number numeric;v_min numeric;v_max numeric;v_unit text;v_when timestamptz;v_meta jsonb;v_checkin jsonb;
begin
 if jsonb_typeof(p_record) is distinct from 'object' or coalesce(p_record->>'id','') !~ '^[a-zA-Z0-9_-]{1,100}$' then raise exception 'Invalid observation identifier';end if;
 if coalesce(p_record->>'source','') not in ('manual','imported') or lower(coalesce(p_record->>'training','false')) in ('true','1','yes') or lower(coalesce(p_record->>'isTraining','false')) in ('true','1','yes') or lower(coalesce(p_record->>'simulated','false')) in ('true','1','yes') or lower(coalesce(p_record->>'synthetic','false')) in ('true','1','yes') then raise exception 'Only actual manual/imported observations are permitted';end if;
 if coalesce(p_record->>'timestamp','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$' then raise exception 'Measurement time requires an explicit timezone';end if;
 begin v_when=(p_record->>'timestamp')::timestamptz;exception when others then raise exception 'Invalid measurement timestamp';end;
 if v_when<'1900-01-01T00:00:00Z'::timestamptz or v_when>now()+interval '5 minutes' then raise exception 'Measurement timestamp is outside supported bounds';end if;
 if p_record ? 'measured_at' and (p_record->>'measured_at')::timestamptz is distinct from v_when then raise exception 'Conflicting measurement timestamps';end if;
 if coalesce(p_record->>'context','unknown') not in ('unknown','resting','post-exercise','other') then raise exception 'Unknown activity context';end if;
 if jsonb_typeof(p_record->'values') is distinct from 'object' or (select count(*) from jsonb_object_keys(p_record->'values')) not between 1 and 11 then raise exception 'One to eleven numeric metrics are required';end if;
 for v_key,v_value in select key,value from jsonb_each(p_record->'values') loop
  if jsonb_typeof(v_value)<>'number' then raise exception 'Metrics must be numeric';end if;
  v_number=(v_value#>>'{}')::numeric;
  select x.lo,x.hi,x.unit into v_min,v_max,v_unit from (values ('heart',20::numeric,250::numeric,'bpm'),('oxygen',50,100,'%'),('sleep',0,24,'h'),('temp',30,43,'°C'),('sys',50,260,'mmHg'),('dia',30,180,'mmHg'),('glucose',20,600,'mg/dL'),('hrv',0,300,'ms'),('eda',0,100,'µS'),('mood',1,5,'/5'),('energy',1,5,'/5')) as x(key,lo,hi,unit) where x.key=v_key;
  if v_unit is null or v_number<v_min or v_number>v_max then raise exception 'Unsupported metric or value/unit: %',v_key;end if;
  if v_key in ('heart','oxygen','sys','dia','mood','energy') and v_number<>trunc(v_number) then raise exception 'Metric requires a whole number: %',v_key;end if;
  if p_record ? 'metric_units' and p_record->'metric_units' ? v_key and p_record->'metric_units'->>v_key<>v_unit then raise exception 'Unsupported metric unit: %',v_key;end if;
 end loop;
 if (p_record->'values' ? 'sys')<>(p_record->'values' ? 'dia') then raise exception 'Blood pressure requires a pair';end if;
 if p_record->'values' ? 'sys' and (p_record->'values'->>'sys')::numeric <= (p_record->'values'->>'dia')::numeric then raise exception 'Systolic must exceed diastolic';end if;
 if jsonb_typeof(coalesce(p_record->'notes','""'))<>'string' or length(coalesce(p_record->>'notes',''))>1000 then raise exception 'Observation notes must be plain text up to 1000 characters';end if;
 if jsonb_typeof(coalesce(p_record->'symptoms','""'))<>'string' or length(coalesce(p_record->>'symptoms',''))>2000 then raise exception 'Symptoms must be plain text up to 2000 characters';end if;
 if p_record ? 'source_reference' and jsonb_typeof(p_record->'source_reference') not in ('string','null') then raise exception 'Invalid source reference';end if;
 if length(coalesce(p_record->>'source_reference',''))>2000 then raise exception 'Source reference too large';end if;
 v_meta=coalesce(p_record->'meta','{}');
 if jsonb_typeof(v_meta)<>'object' or octet_length(v_meta::text)>4096 then raise exception 'Invalid measurement metadata';end if;
 if exists(select 1 from jsonb_object_keys(v_meta) as k where k not in ('device','method','repeat','signal','glucoseTiming','temperatureSite')) then raise exception 'Unknown measurement metadata';end if;
 if (v_meta ? 'device' and jsonb_typeof(v_meta->'device') not in ('string','null')) or (v_meta ? 'method' and jsonb_typeof(v_meta->'method') not in ('string','null')) then raise exception 'Measurement metadata must be text';end if;
 if length(coalesce(v_meta->>'device',''))>100 or length(coalesce(v_meta->>'method',''))>200 then raise exception 'Measurement metadata text too long';end if;
 if coalesce(v_meta->>'repeat','unknown') not in ('unknown','yes','no') or coalesce(v_meta->>'signal','unknown') not in ('unknown','stable','unstable') or coalesce(v_meta->>'glucoseTiming','unknown') not in ('unknown','fasting','after-meal','other') or coalesce(v_meta->>'temperatureSite','unknown') not in ('unknown','oral','axillary','ear','forehead','other') then raise exception 'Unknown measurement metadata value';end if;
 v_checkin=coalesce(p_record->'checkin','{}');
 if jsonb_typeof(v_checkin)<>'object' or octet_length(v_checkin::text)>8192 then raise exception 'Invalid check-in context';end if;
 if v_checkin ? 'date' and (v_checkin->>'date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid check-in date';end if;
 if v_checkin ? 'date' then perform (v_checkin->>'date')::date;end if;
 if v_checkin ? 'energy_level' and (jsonb_typeof(v_checkin->'energy_level')<>'number' or (v_checkin->>'energy_level')::numeric not between 1 and 5 or (v_checkin->>'energy_level')::numeric<>trunc((v_checkin->>'energy_level')::numeric)) then raise exception 'Energy must be an integer from 1 to 5';end if;
 if v_checkin ? 'symptoms' and jsonb_typeof(v_checkin->'symptoms') not in ('array','object') then raise exception 'Symptoms must be a list or object';end if;
end $$;
revoke all on function public.cosmovital_validate_record(jsonb) from public,anon,authenticated;

create or replace function public.load_health_workspace()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid=auth.uid();v_profile jsonb;v_records jsonb;v_mission jsonb;v_alerts jsonb;v_revision bigint;
begin
 if v_uid is null then raise exception using errcode='28000',message='Authentication required';end if;
 insert into public.profiles(id,display_name) select v_uid,coalesce(nullif(left(btrim(u.raw_user_meta_data->>'display_name'),80),''),'Explorer') from auth.users u where u.id=v_uid on conflict(id) do nothing;
 insert into public.workspace_state(user_id) values(v_uid) on conflict(user_id) do nothing;
 perform 1 from public.workspace_state where user_id=v_uid for update;
 select to_jsonb(p)||jsonb_build_object('email',u.email,'email_verified',u.email_confirmed_at is not null) into v_profile from public.profiles p join auth.users u on u.id=p.id where p.id=v_uid;
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'user_id',o.user_id,'timestamp',o.measured_at,'measured_at',o.measured_at,'created_at',o.created_at,'source',o.data_source,'source_reference',o.source_reference,'notes',o.notes,'symptoms',o.symptoms,'context',o.context,'meta',o.metadata,'checkin',o.checkin,'values',(select jsonb_object_agg(r.metric_name,r.metric_value) from public.health_readings r where r.user_id=v_uid and r.observation_id=o.id),'readings',(select jsonb_agg(jsonb_build_object('id',r.id,'user_id',r.user_id,'measured_at',r.measured_at,'created_at',r.created_at,'metric_name',r.metric_name,'metric_value',r.metric_value,'metric_unit',r.metric_unit,'data_source',r.data_source,'source_reference',r.source_reference) order by r.metric_name) from public.health_readings r where r.user_id=v_uid and r.observation_id=o.id)) order by o.measured_at,o.id),'[]') into v_records from public.health_observations o where o.user_id=v_uid;
 select mission_state,revision into v_mission,v_revision from public.workspace_state where user_id=v_uid;
 select coalesce(jsonb_agg(a.payload||jsonb_build_object('id',a.id,'user_id',a.user_id,'created_at',a.created_at,'status',a.status,'severity',a.severity,'message',a.message,'acknowledged_at',a.acknowledged_at,'resolved_at',a.resolved_at) order by a.created_at desc,a.id),'[]') into v_alerts from public.health_alerts a where a.user_id=v_uid;
 return jsonb_build_object('records',v_records,'missionState',v_mission,'profile',v_profile,'alerts',v_alerts,'revision',v_revision);
end $$;
revoke all on function public.load_health_workspace() from public,anon;
grant execute on function public.load_health_workspace() to authenticated;

create or replace function public.cosmovital_iso_timestamp(p_text text,p_allow_future boolean default false)
returns timestamptz language plpgsql set search_path='' as $$
declare v_time timestamptz;
begin
 if p_text is null or p_text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$' then raise exception 'A timestamp with an explicit timezone is required';end if;
 v_time=p_text::timestamptz;
 if v_time<'1900-01-01T00:00:00Z'::timestamptz or (not p_allow_future and v_time>now()+interval '5 minutes') then raise exception 'Timestamp outside supported bounds';end if;
 return v_time;
end $$;
revoke all on function public.cosmovital_iso_timestamp(text,boolean) from public,anon,authenticated;

create or replace function public.cosmovital_validate_case(p_case jsonb,p_record_ids text[])
returns void language plpgsql set search_path='' as $$
declare v_event jsonb;
begin
 if jsonb_typeof(p_case)<>'object' or coalesce(p_case->>'id','') !~ '^[a-zA-Z0-9_-]{1,100}$' or jsonb_typeof(p_case->'title') is distinct from 'string' or length(btrim(p_case->>'title')) not between 1 and 200 or length(coalesce(p_case->>'summary',''))>2000 then raise exception 'Invalid case identifier or text';end if;
 if coalesce(p_case->>'status','') not in ('open','follow-up','awaiting-review','archived') then raise exception 'Unknown organizational case status';end if;
 if p_case->>'status'='archived' and length(btrim(coalesce(p_case->>'archiveReason','')))=0 then raise exception 'Archiving requires an explicit reason';end if;
 if length(coalesce(p_case->>'archiveReason',''))>2000 then raise exception 'Archive reason too long';end if;
 if public.cosmovital_iso_timestamp(p_case->>'updatedAt')<public.cosmovital_iso_timestamp(p_case->>'createdAt') then raise exception 'Case update precedes creation';end if;
 if p_case->>'followUpAt' is not null then perform public.cosmovital_iso_timestamp(p_case->>'followUpAt',true);end if;
 if jsonb_typeof(p_case->'recordIds') is distinct from 'array' or jsonb_array_length(p_case->'recordIds') not between 1 and 10000 then raise exception 'Case must link actual observations';end if;
 if exists(select 1 from jsonb_array_elements(p_case->'recordIds') as x where jsonb_typeof(x)<>'string' or not (x#>>'{}'=any(p_record_ids))) or (select count(*) from jsonb_array_elements_text(p_case->'recordIds'))<>(select count(distinct x) from jsonb_array_elements_text(p_case->'recordIds') as x) then raise exception 'Case references missing or duplicate observations';end if;
 if jsonb_typeof(p_case->'symptoms') is distinct from 'object' or octet_length((p_case->'symptoms')::text)>16384 then raise exception 'Invalid saved symptom context';end if;
 if jsonb_typeof(p_case->'events') is distinct from 'array' or jsonb_array_length(p_case->'events') not between 1 and 2000 then raise exception 'Case event history is required';end if;
 if (select count(*) from jsonb_array_elements(p_case->'events'))<>(select count(distinct x->>'id') from jsonb_array_elements(p_case->'events') as x) then raise exception 'Case event IDs must be unique';end if;
 for v_event in select value from jsonb_array_elements(p_case->'events') loop
  if jsonb_typeof(v_event)<>'object' or coalesce(v_event->>'id','') !~ '^[a-zA-Z0-9_-]{1,100}$' or coalesce(v_event->>'type','') !~ '^[a-z][a-z0-9-]{0,59}$' or jsonb_typeof(v_event->'text') is distinct from 'string' or length(btrim(v_event->>'text')) not between 1 and 4000 then raise exception 'Invalid case event';end if;
  perform public.cosmovital_iso_timestamp(v_event->>'timestamp');
  if v_event ? 'recordId' and not (p_case->'recordIds' ? (v_event->>'recordId')) then raise exception 'Event refers to an unlinked observation';end if;
 end loop;
end $$;
revoke all on function public.cosmovital_validate_case(jsonb,text[]) from public,anon,authenticated;

create or replace function public.save_health_workspace(p_records jsonb,p_mission_state jsonb,p_alerts jsonb,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_uid uuid=auth.uid();v_revision bigint;v_ids text[];v_case_ids text[];v_rec jsonb;v_case jsonb;v_packet jsonb;v_event jsonb;v_alert jsonb;v_key text;v_val jsonb;v_unit text;v_created timestamptz;v_when timestamptz;v_zone text;v_related text;v_status text;v_ack timestamptz;v_resolved timestamptz;v_snapshot_ids text[];
begin
 if v_uid is null then raise exception using errcode='28000',message='Authentication required';end if;
 if p_expected_revision is null or p_expected_revision<0 then raise exception 'A workspace revision is required';end if;
 if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records)>10000 or octet_length(p_records::text)>16777216 then raise exception 'Workspace supports at most 10000 observations / 16 MiB';end if;
 if jsonb_typeof(p_mission_state) is distinct from 'object' or p_mission_state->'schemaVersion' is distinct from '1'::jsonb or jsonb_typeof(p_mission_state->'cases') is distinct from 'array' or jsonb_typeof(p_mission_state->'consultations') is distinct from 'array' then raise exception 'Unsupported mission workspace schema';end if;
 if jsonb_array_length(p_mission_state->'cases')>500 or jsonb_array_length(p_mission_state->'consultations')>500 or octet_length(p_mission_state::text)>16777216 then raise exception 'Mission workspace is too large';end if;
 if jsonb_typeof(p_alerts) is distinct from 'array' or jsonb_array_length(p_alerts)>10000 or octet_length(p_alerts::text)>16777216 then raise exception 'Alert history is too large';end if;
 select coalesce(array_agg(x->>'id'),array[]::text[]) into v_ids from jsonb_array_elements(p_records) as x;
 if cardinality(v_ids)<>(select count(distinct x) from unnest(v_ids) as x) then raise exception 'Observation IDs must be unique';end if;
 for v_rec in select value from jsonb_array_elements(p_records) loop perform public.cosmovital_validate_record(v_rec);end loop;
 select coalesce(array_agg(x->>'id'),array[]::text[]) into v_case_ids from jsonb_array_elements(p_mission_state->'cases') as x;
 if cardinality(v_case_ids)<>(select count(distinct x) from unnest(v_case_ids) as x) then raise exception 'Case IDs must be unique';end if;
 for v_case in select value from jsonb_array_elements(p_mission_state->'cases') loop perform public.cosmovital_validate_case(v_case,v_ids);end loop;
 if jsonb_array_length(p_mission_state->'consultations')<>(select count(distinct x->>'id') from jsonb_array_elements(p_mission_state->'consultations') as x) then raise exception 'Consultation IDs must be unique';end if;
 for v_packet in select value from jsonb_array_elements(p_mission_state->'consultations') loop
  if jsonb_typeof(v_packet)<>'object' or coalesce(v_packet->>'id','') !~ '^[a-zA-Z0-9_-]{1,100}$' or not(coalesce(v_packet->>'caseId','')=any(v_case_ids)) or coalesce(v_packet->>'status','') not in ('draft','prepared','exported','external-sharing-recorded') or coalesce(v_packet->>'context','') not in ('earth','mission') or jsonb_typeof(v_packet->'question') is distinct from 'string' or length(btrim(v_packet->>'question')) not between 1 and 2000 then raise exception 'Invalid local consultation draft or state';end if;
  if public.cosmovital_iso_timestamp(v_packet->>'updatedAt')<public.cosmovital_iso_timestamp(v_packet->>'createdAt') then raise exception 'Consultation update precedes creation';end if;
  if jsonb_typeof(v_packet->'payload') is distinct from 'object' or v_packet->'payload'->'schemaVersion' is distinct from '1'::jsonb or v_packet->'payload'->'case'->>'id' is distinct from v_packet->>'caseId' or jsonb_typeof(v_packet->'payload'->'records') is distinct from 'array' then raise exception 'Consultation snapshot is incomplete';end if;
  select coalesce(array_agg(x->>'id'),array[]::text[]) into v_snapshot_ids from jsonb_array_elements(v_packet->'payload'->'records') as x;
  if cardinality(v_snapshot_ids)<>(select count(distinct x) from unnest(v_snapshot_ids) as x) then raise exception 'Snapshot observation IDs must be unique';end if;
  perform public.cosmovital_validate_case(v_packet->'payload'->'case',v_snapshot_ids);
  if cardinality(v_snapshot_ids)<>jsonb_array_length(v_packet->'payload'->'case'->'recordIds') or v_packet->'payload'->'events' is distinct from v_packet->'payload'->'case'->'events' or v_packet->'payload'->'symptoms' is distinct from v_packet->'payload'->'case'->'symptoms' then raise exception 'Consultation snapshot links or history mismatch';end if;
  for v_rec in select value from jsonb_array_elements(v_packet->'payload'->'records') loop perform public.cosmovital_validate_record(v_rec);end loop;
  if jsonb_typeof(v_packet->'events') is distinct from 'array' or jsonb_array_length(v_packet->'events') not between 1 and 2000 then raise exception 'Consultation event history is required';end if;
  for v_event in select value from jsonb_array_elements(v_packet->'events') loop
   if coalesce(v_event->>'type','') not in ('drafted','prepared','export-recorded','external-sharing-recorded') or length(coalesce(v_event->>'text','')) not between 1 and 4000 then raise exception 'Only local consultation events are supported';end if;
   perform public.cosmovital_iso_timestamp(v_event->>'timestamp');
  end loop;
  if v_packet->>'status'='external-sharing-recorded' and (v_packet->'externalSharing'->'userDeclared' is distinct from 'true'::jsonb or v_packet->'externalSharing'->'deliveryVerified' is distinct from 'false'::jsonb or length(btrim(coalesce(v_packet->'externalSharing'->>'channel',''))) not between 1 and 100) then raise exception 'External sharing must be user-declared and unverified';end if;
 end loop;
 if jsonb_array_length(p_alerts)<>(select count(distinct x->>'id') from jsonb_array_elements(p_alerts) as x) or jsonb_array_length(p_alerts)<>(select count(distinct x->>'dedupe_key') from jsonb_array_elements(p_alerts) as x) then raise exception 'Alert IDs and deduplication keys must be unique';end if;
 for v_alert in select value from jsonb_array_elements(p_alerts) loop
  if jsonb_typeof(v_alert)<>'object' or coalesce(v_alert->>'id','') !~ '^[a-zA-Z0-9_-]{1,150}$' or length(btrim(coalesce(v_alert->>'dedupe_key',''))) not between 1 and 250 or coalesce(v_alert->>'status','') not in ('active','acknowledged','resolved') or coalesce(v_alert->>'severity','') not in ('info','informational','review','urgent') or jsonb_typeof(v_alert->'message') is distinct from 'string' or length(btrim(v_alert->>'message')) not between 1 and 4000 then raise exception 'Invalid alert history entry';end if;
  if v_alert ? 'classification' and v_alert->>'classification' not in ('reference-prompt','information') then raise exception 'Unsupported alert classification';end if;
  if v_alert ? 'is_current' and jsonb_typeof(v_alert->'is_current')<>'boolean' then raise exception 'Alert current-state flag must be boolean';end if;
  if v_alert->>'related_reading_id' is not null and length(v_alert->>'related_reading_id')>100 then raise exception 'Invalid related observation';end if;
  if v_alert->>'measured_at' is not null then perform public.cosmovital_iso_timestamp(v_alert->>'measured_at');end if;
  if v_alert->>'acknowledged_at' is not null then perform public.cosmovital_iso_timestamp(v_alert->>'acknowledged_at');end if;
  if v_alert->>'resolved_at' is not null then perform public.cosmovital_iso_timestamp(v_alert->>'resolved_at');end if;
  if v_alert->>'status'='acknowledged' and v_alert->>'acknowledged_at' is null then raise exception 'Acknowledgement time is required';end if;
  if v_alert->>'status'='resolved' and (v_alert->>'resolved_at' is null or length(btrim(coalesce(v_alert->>'resolution_note','')))=0) then raise exception 'Resolution requires an explicit note and time';end if;
  if length(coalesce(v_alert->>'resolution_note',''))>2000 then raise exception 'Resolution note too long';end if;
 end loop;
 -- Acquire an owner-specific lock after validating the entire incoming snapshot.
 perform public.load_health_workspace();
 select revision into v_revision from public.workspace_state where user_id=v_uid for update;
 if p_expected_revision is distinct from v_revision then raise exception using errcode='40001',message='workspace_conflict',detail='Another session changed this workspace. Reload before retrying; no data was overwritten.';end if;
 select coalesce(nullif(preferences->>'timeZone',''),nullif(preferences->>'timezone',''),'UTC') into v_zone from public.profiles where id=v_uid;
 if not exists(select 1 from pg_timezone_names where name=v_zone) then v_zone='UTC';end if;
 delete from public.health_observations where user_id=v_uid and not(id=any(v_ids));
 for v_rec in select value from jsonb_array_elements(p_records) loop
  v_when=(v_rec->>'timestamp')::timestamptz;
  insert into public.health_observations(user_id,id,measured_at,data_source,source_reference,context,notes,symptoms,metadata,checkin)
   values(v_uid,v_rec->>'id',v_when,v_rec->>'source',v_rec->'source_reference',coalesce(v_rec->>'context','unknown'),coalesce(v_rec->>'notes',''),coalesce(v_rec->>'symptoms',''),coalesce(v_rec->'meta','{}'),coalesce(v_rec->'checkin','{}'))
   on conflict(user_id,id) do update set measured_at=excluded.measured_at,data_source=excluded.data_source,source_reference=excluded.source_reference,context=excluded.context,notes=excluded.notes,symptoms=excluded.symptoms,metadata=excluded.metadata,checkin=excluded.checkin;
  select created_at into v_created from public.health_observations where user_id=v_uid and id=v_rec->>'id';
  delete from public.health_readings where user_id=v_uid and observation_id=v_rec->>'id' and not(v_rec->'values' ? metric_name);
  for v_key,v_val in select key,value from jsonb_each(v_rec->'values') loop
   v_unit=case v_key when 'heart' then 'bpm' when 'oxygen' then '%' when 'sleep' then 'h' when 'temp' then '°C' when 'sys' then 'mmHg' when 'dia' then 'mmHg' when 'glucose' then 'mg/dL' when 'hrv' then 'ms' when 'eda' then 'µS' else '/5' end;
   insert into public.health_readings(user_id,observation_id,measured_at,metric_name,metric_value,metric_unit,data_source,source_reference)
    values(v_uid,v_rec->>'id',v_when,v_key,(v_val#>>'{}')::numeric,v_unit,v_rec->>'source',v_rec->'source_reference')
    on conflict(user_id,observation_id,metric_name) do update set measured_at=excluded.measured_at,metric_value=excluded.metric_value,metric_unit=excluded.metric_unit,data_source=excluded.data_source,source_reference=excluded.source_reference;
  end loop;
  if v_rec->'values' ?| array['sleep','mood','energy'] or length(coalesce(v_rec->>'symptoms',''))>0 or v_rec->'checkin'<>'{}'::jsonb then
   insert into public.daily_checkins(user_id,observation_id,checkin_date,sleep_hours,mood,energy_level,symptoms,notes)
    values(v_uid,v_rec->>'id',(v_when at time zone v_zone)::date,(v_rec->'values'->>'sleep')::numeric,(v_rec->'values'->>'mood')::smallint,coalesce((v_rec->'values'->>'energy')::smallint,(v_rec->'checkin'->>'energy_level')::smallint),coalesce(v_rec->'checkin'->'symptoms',jsonb_build_object('reported',coalesce(v_rec->>'symptoms',''))),coalesce(v_rec->>'notes',''))
    on conflict(user_id,observation_id) do update set checkin_date=excluded.checkin_date,sleep_hours=excluded.sleep_hours,mood=excluded.mood,energy_level=excluded.energy_level,symptoms=excluded.symptoms,notes=excluded.notes;
  else delete from public.daily_checkins where user_id=v_uid and observation_id=v_rec->>'id';end if;
 end loop;
 delete from public.medical_review_requests where user_id=v_uid and not(id in(select x->>'id' from jsonb_array_elements(p_mission_state->'consultations') as x));
 for v_packet in select value from jsonb_array_elements(p_mission_state->'consultations') loop
  insert into public.medical_review_requests(user_id,id,request_status,summary,packet) values(v_uid,v_packet->>'id',v_packet->>'status',v_packet->>'question',v_packet)
   on conflict(user_id,id) do update set request_status=excluded.request_status,summary=excluded.summary,packet=excluded.packet,updated_at=now();
 end loop;
 -- Removing an alert requires explicit history replacement via the complete workspace.
 delete from public.health_alerts where user_id=v_uid and not(id in(select x->>'id' from jsonb_array_elements(p_alerts) as x));
 for v_alert in select value from jsonb_array_elements(p_alerts) loop
  insert into public.health_alerts(user_id,id,related_reading_id,dedupe_key,severity,message,status,acknowledged_at,resolved_at,payload)
   values(v_uid,v_alert->>'id',v_alert->>'related_reading_id',v_alert->>'dedupe_key',v_alert->>'severity',v_alert->>'message',v_alert->>'status',(v_alert->>'acknowledged_at')::timestamptz,(v_alert->>'resolved_at')::timestamptz,v_alert-'user_id'-'created_at')
   on conflict(user_id,id) do update set related_reading_id=excluded.related_reading_id,dedupe_key=excluded.dedupe_key,severity=excluded.severity,message=excluded.message,status=excluded.status,acknowledged_at=excluded.acknowledged_at,resolved_at=excluded.resolved_at,payload=excluded.payload;
 end loop;
 update public.workspace_state set mission_state=p_mission_state,revision=revision+1,updated_at=now() where user_id=v_uid;
 return public.load_health_workspace();
end $$;
revoke all on function public.save_health_workspace(jsonb,jsonb,jsonb,bigint) from public,anon;
grant execute on function public.save_health_workspace(jsonb,jsonb,jsonb,bigint) to authenticated;

-- Called only after the application asks for explicit account/data deletion.
-- Cascading FKs delete this caller's private records. No service key is needed.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path='' as $$
declare v_uid uuid=auth.uid();
begin
 if v_uid is null then raise exception using errcode='28000',message='Authentication required';end if;
 delete from auth.users where id=v_uid;
end $$;
revoke all on function public.delete_my_account() from public,anon;
grant execute on function public.delete_my_account() to authenticated;
