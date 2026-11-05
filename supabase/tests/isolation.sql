-- Run after the migration in disposable PostgreSQL with Supabase auth.uid().
-- Two auth identities are SQL fixtures; these are not live GoTrue/email accounts.
begin;
insert into auth.users(id,email,raw_user_meta_data) values
 ('11111111-1111-4111-8111-111111111111','a@example.test','{"display_name":"QA A"}'),
 ('22222222-2222-4222-8222-222222222222','b@example.test','{"display_name":"QA B"}');
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select public.load_health_workspace()->>'revision';
update public.profiles set preferences='{"timeZone":"Africa/Cairo"}' where id=auth.uid();
select public.save_health_workspace('[{"id":"qa-a","timestamp":"2026-01-03T23:30:00Z","source":"manual","context":"resting","values":{"heart":72,"mood":4},"notes":"SQL QA only"}]','{"schemaVersion":1,"cases":[],"consultations":[]}','[]',0)->>'revision';
do $$ begin
 if (select count(*) from public.health_readings)<>2 then raise exception 'A metric rows missing';end if;
 if (select checkin_date from public.daily_checkins limit 1)<>'2026-01-04'::date then raise exception 'Selected timezone not honored';end if;
 if (select count(*) from public.health_readings where created_at=measured_at)<>0 then raise exception 'Creation time replaced measurement time';end if;
end $$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ begin
 if jsonb_array_length(public.load_health_workspace()->'records')<>0 then raise exception 'A records leaked to B';end if;
 if (select count(*) from public.health_readings)<>0 then raise exception 'RLS metric leak';end if;
 if (select count(*) from public.profiles)<>1 then raise exception 'RLS profile leak';end if;
 begin insert into public.health_observations(user_id,id,measured_at,data_source) values(auth.uid(),'bad',now(),'manual');raise exception 'Direct insert unexpectedly permitted';exception when insufficient_privilege then null;end;
end $$;
select public.save_health_workspace('[{"id":"qa-b","user_id":"11111111-1111-4111-8111-111111111111","timestamp":"2026-01-03T10:00:00Z","source":"manual","values":{"heart":81}}]','{"schemaVersion":1,"cases":[],"consultations":[]}','[]',0)->>'revision';
do $$ begin
 if (public.load_health_workspace()->'records'->0->>'user_id')<>auth.uid()::text then raise exception 'Client forged ownership';end if;
 begin perform public.save_health_workspace('[]','{"schemaVersion":1,"cases":[],"consultations":[]}','[]',0);raise exception 'Stale revision permitted';exception when serialization_failure then null;end;
 begin perform public.save_health_workspace('[{"id":"bad","timestamp":"2026-01-03T10:00:00Z","source":"manual","values":{"heart":72},"meta":{"device":123}}]','{"schemaVersion":1,"cases":[],"consultations":[]}','[]',1);raise exception 'Invalid metadata accepted';exception when raise_exception then if sqlerrm='Invalid metadata accepted' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ begin
 if (public.load_health_workspace()->'records'->0->>'id')<>'qa-a' then raise exception 'B modified A';end if;
 if (select count(*) from public.health_readings)<>2 then raise exception 'B altered A metrics';end if;
end $$;
reset role;
select 'PASS: two-identity RLS, protected writes, server ownership/time, timezone, conflict and malformed metadata checks' as result;
rollback;
