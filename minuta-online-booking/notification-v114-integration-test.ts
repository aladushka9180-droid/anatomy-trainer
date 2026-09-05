import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.3.10";

const migration = await Deno.readTextFile(new URL("./supabase-migration-v114.sql", import.meta.url));
const rollback = await Deno.readTextFile(new URL("./supabase-migration-v114-rollback.sql", import.meta.url));
const database = new PGlite();

await database.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  create schema extensions;
  create schema cron;
  create table cron.job(
    jobid bigint generated always as identity primary key,jobname text,schedule text,command text,active boolean default true
  );
  create function cron.unschedule(p_jobid bigint) returns boolean language plpgsql as $$
  begin delete from cron.job where jobid=p_jobid;return found;end $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
  $$;
  create function auth.role() returns text language sql stable as $$
    select nullif(current_setting('request.jwt.claim.role',true),'')
  $$;
  create table public.organizations(id uuid primary key,status text not null default 'active');
  create table public.organization_memberships(organization_id uuid,user_id uuid,role text,active boolean default true);
  create table public.performer_profiles(id uuid primary key,display_name text);
  create table public.services(id uuid primary key,name text);
  create table public.bookings(
    id uuid primary key,booking_code text,manage_token uuid,performer_id uuid,service_id uuid,
    client_name text,client_phone text,booking_date date,booking_time time without time zone,
    status text,organization_id uuid
  );
  create table public.organization_notification_settings(
    organization_id uuid primary key,enabled boolean not null default false,
    booking_created_enabled boolean not null default true,booking_confirmed_enabled boolean not null default true,
    booking_rescheduled_enabled boolean not null default true,booking_cancelled_enabled boolean not null default true,
    booking_reminder_enabled boolean not null default true,reminder_minutes_before integer not null default 1440,
    enabled_at timestamptz,enabled_by uuid,updated_at timestamptz default now()
  );
  create table public.organization_notification_channels(
    organization_id uuid,audience text,channel text,enabled boolean default false,updated_at timestamptz default now(),
    primary key(organization_id,audience,channel)
  );
  create table public.notification_recipient_endpoints(
    id uuid primary key default gen_random_uuid(),organization_id uuid,audience text,subject_key text,channel text,
    destination jsonb,consent_source text,consent_at timestamptz,active boolean,revoked_at timestamptz,
    created_at timestamptz default now(),updated_at timestamptz default now(),
    unique(organization_id,audience,subject_key,channel)
  );
  create table public.notification_outbox(
    id uuid primary key default gen_random_uuid(),performer_id uuid,booking_id uuid,organization_id uuid,
    event_key text unique,kind text,channel text,status text default 'pending',attempts integer default 0,
    next_attempt_at timestamptz default now(),locked_at timestamptz,lock_token uuid,last_error_code text,last_error text,
    provider_message_id text,sent_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now(),
    audience text,recipient_key text,payload jsonb default '{}'::jsonb,dispatcher text default 'unified',
    unique(id,performer_id)
  );
  create table public.notification_delivery_attempts(
    id bigint generated always as identity primary key,outbox_id uuid,performer_id uuid,attempt_no integer,
    outcome text,error_code text,error_message text,provider_message_id text,
    started_at timestamptz default now(),finished_at timestamptz,unique(outbox_id,attempt_no)
  );
  create table public.client_telegram_subscriptions(
    id uuid primary key default gen_random_uuid(),performer_id uuid,client_phone text,chat_id bigint,
    telegram_user_id bigint,telegram_username text,active boolean default true,
    connected_at timestamptz default now(),updated_at timestamptz default now(),unique(performer_id,client_phone)
  );
  create table public.telegram_notification_log(
    id uuid primary key default gen_random_uuid(),booking_id uuid,event_type text,booking_date date,
    booking_time time without time zone,sent_at timestamptz default now(),
    unique(booking_id,event_type,booking_date,booking_time)
  );
  create function public.has_organization_role(uuid,text[]) returns boolean language sql stable as $$select true$$;
  create function public.enqueue_minuta_booking_notification(p_booking uuid,p_kind text)
  returns integer language plpgsql security definer set search_path to '' as $$
  declare b public.bookings%rowtype; inserted integer:=0;
  begin
    select * into b from public.bookings where id=p_booking;
    insert into public.notification_outbox(
      performer_id,booking_id,organization_id,event_key,kind,channel,status,audience,recipient_key,payload,dispatcher
    ) values(
      b.performer_id,b.id,b.organization_id,
      'booking:'||b.id::text||':'||p_kind||':'||b.booking_date::text||':'||b.booking_time::text||':client:telegram',
      p_kind,'telegram','pending','client',regexp_replace(b.client_phone,'[^0-9]','','g'),
      jsonb_build_object('client_name',b.client_name,'service_name','Услуга','booking_date',b.booking_date,'booking_time',b.booking_time),
      'unified'
    ) on conflict(event_key) do nothing;
    if found then inserted:=1; end if;
    return inserted;
  end $$;
  create function public.enqueue_booking_created_notification() returns trigger language plpgsql as $$
  begin perform public.enqueue_minuta_booking_notification(new.id,'booking_created');return new;end $$;
  create trigger bookings_enqueue_created_notification after insert on public.bookings
    for each row execute function public.enqueue_booking_created_notification();
  create function public.enqueue_minuta_booking_change_notification() returns trigger language plpgsql as $$begin return new;end$$;
  create trigger bookings_enqueue_change_notification_v88 after update of status,booking_date,booking_time on public.bookings
    for each row execute function public.enqueue_minuta_booking_change_notification();
  create function public.claim_minuta_notification_outbox(text[],integer)
  returns table(outbox_id uuid,lock_token uuid,event_key text,organization_id uuid,performer_id uuid,booking_id uuid,
    kind text,channel text,audience text,attempt_no integer,destination jsonb,message_payload jsonb)
    language sql as $$select null::uuid,null::uuid,null::text,null::uuid,null::uuid,null::uuid,null::text,null::text,null::text,0,null::jsonb,null::jsonb where false$$;
  create function public.get_minuta_notification_workspace(uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
  insert into cron.job(jobname,schedule,command) values
    ('minuta-notification-dispatcher','* * * * *','select net.http_post(url := ''https://test.invalid/functions/v1/notification-dispatcher'')'),
    ('telegram-client-reminders-hourly','15 * * * *','select net.http_post(url := ''https://test.invalid/functions/v1/telegram-client-notify/reminders'')');
`);

const organization = "00000000-0000-4000-8000-000000000001";
const performer = "00000000-0000-4000-8000-000000000002";
const service = "00000000-0000-4000-8000-000000000003";
const legacyBooking = "00000000-0000-4000-8000-000000000004";
await database.exec(`
  insert into public.organizations values('${organization}','active');
  insert into public.performer_profiles values('${performer}','Мастер');
  insert into public.services values('${service}','Услуга');
  insert into public.organization_notification_settings(organization_id,enabled) values('${organization}',false);
  insert into public.organization_notification_channels values('${organization}','client','telegram',false,now());
  alter table public.bookings disable trigger bookings_enqueue_created_notification;
  insert into public.bookings values('${legacyBooking}','L1',gen_random_uuid(),'${performer}','${service}','Клиент','79990000001','2099-09-10','14:00','new','${organization}');
  alter table public.bookings enable trigger bookings_enqueue_created_notification;
  insert into public.notification_outbox(performer_id,booking_id,organization_id,event_key,kind,channel,status,audience,recipient_key,payload,dispatcher)
    values('${performer}','${legacyBooking}','${organization}','legacy-direct','booking_created','telegram','pending','client','79990000001',
      '{"booking_date":"2099-09-10","booking_time":"14:00:00"}','unified');
  insert into public.telegram_notification_log(booking_id,event_type,booking_date,booking_time)
    values('${legacyBooking}','confirmation','2099-09-10','14:00');
`);

await database.exec(migration);
await database.exec(`select set_config('request.jwt.claim.role','service_role',false)`);

Deno.test("v114 keeps legacy cron beside the ready replacement before organization cutover", async () => {
  const jobs = await database.query<{ jobname:string; active:boolean }>(
    `select jobname,active from cron.job order by jobname`
  );
  assertEquals(jobs.rows, [
    { jobname:"minuta-notification-dispatcher", active:true },
    { jobname:"telegram-client-reminders-hourly", active:true },
  ]);
});

Deno.test("old Telegram stays live while unified is off and unavailable worker cannot activate it", async () => {
  const booking = "00000000-0000-4000-8000-000000000008";
  await database.exec(`
    insert into public.bookings values('${booking}','CUT1',gen_random_uuid(),'${performer}','${service}','Старый клиент','79990000008','2099-09-10','14:30','confirmed','${organization}');
    insert into public.client_telegram_subscriptions(performer_id,client_phone,chat_id) values('${performer}','79990000008',220008);
  `);
  const before = await database.query<{ cutover:boolean; legacy_allowed:boolean }>(`
    select public.is_minuta_notification_v114_cutover('${booking}') cutover,
      public.is_minuta_legacy_client_notification_allowed_v114('${booking}') legacy_allowed
  `);
  assertEquals(before.rows, [{ cutover:false, legacy_allowed:true }]);
  const blockedClaim = await database.query(`select * from public.claim_minuta_notification_outbox(array['telegram'],20)`);
  assertEquals(blockedClaim.rows.length,0);
  const lease = await database.query<{ result:{ allowed:boolean; state:string; lock_token:string } }>(`
    select public.begin_minuta_legacy_notification_delivery_v114(
      '${booking}','confirmation','2099-09-10','14:30'
    ) result
  `);
  assertEquals(lease.rows[0].result.allowed,true);

  await database.exec(`
    update public.organization_notification_settings set enabled=true where organization_id='${organization}';
    update public.organization_notification_channels set enabled=true where organization_id='${organization}' and audience='client' and channel='telegram';
    update cron.job set active=false where jobname='minuta-notification-dispatcher';
  `);
  await assertRejects(() => database.exec(`
    select public.activate_minuta_notification_v114_cutover('${organization}','v114',array['telegram'])
  `));
  const rejected = await database.query<{ cutover:boolean; legacy_jobs:number }>(`
    select public.is_minuta_notification_v114_cutover('${booking}') cutover,
      (select count(*)::integer from cron.job where jobname='telegram-client-reminders-hourly') legacy_jobs
  `);
  assertEquals(rejected.rows,[{ cutover:false,legacy_jobs:1 }]);

  await database.exec(`update cron.job set active=true where jobname='minuta-notification-dispatcher'`);
  await assertRejects(() => database.exec(`
    select public.activate_minuta_notification_v114_cutover('${organization}','v114',array['telegram'])
  `));
  await database.exec(`
    select public.mark_minuta_notification_worker_ready_v114('telegram_client_bridge','v114')
  `);
  await assertRejects(() => database.exec(`
    select public.activate_minuta_notification_v114_cutover('${organization}','v114',array['telegram'])
  `));
  const duringSend = await database.query<{ cutover:boolean }>(`
    select public.is_minuta_notification_v114_cutover('${booking}') cutover
  `);
  assertEquals(duringSend.rows,[{ cutover:false }]);
  await database.exec(`
    select public.finish_minuta_legacy_notification_delivery_v114(
      '${lease.rows[0].result.lock_token}','sent',now()
    )
  `);
  const mirrored = await database.query<{ status:string }>(`
    select status from public.notification_outbox where booking_id='${booking}'
  `);
  assertEquals(mirrored.rows,[{ status:"sent" }]);
  const activated = await database.query<{ result:{ activated:boolean; remaining_legacy_organizations:number; legacy_cron_disabled:boolean } }>(`
    select public.activate_minuta_notification_v114_cutover('${organization}','v114',array['telegram']) result
  `);
  assertEquals(activated.rows[0].result.activated,true);
  assertEquals(activated.rows[0].result.remaining_legacy_organizations,0);
  assertEquals(activated.rows[0].result.legacy_cron_disabled,true);
  const after = await database.query<{ cutover:boolean; legacy_allowed:boolean; legacy_jobs:number }>(`
    select public.is_minuta_notification_v114_cutover('${booking}') cutover,
      public.is_minuta_legacy_client_notification_allowed_v114('${booking}') legacy_allowed,
      (select count(*)::integer from cron.job where jobname='telegram-client-reminders-hourly') legacy_jobs
  `);
  assertEquals(after.rows,[{ cutover:true,legacy_allowed:false,legacy_jobs:0 }]);
  const newBooking = "00000000-0000-4000-8000-000000000009";
  await database.exec(`
    insert into public.bookings values('${newBooking}','CUT2',gen_random_uuid(),'${performer}','${service}','Старый клиент','79990000008','2099-09-10','14:45','confirmed','${organization}')
  `);
  const postCutoverLegacy = await database.query<{ result:{ allowed:boolean; state:string } }>(`
    select public.begin_minuta_legacy_notification_delivery_v114(
      '${newBooking}','confirmation','2099-09-10','14:45'
    ) result
  `);
  assertEquals(postCutoverLegacy.rows[0].result,{ allowed:false,state:"unified_cutover" });
  const unifiedClaim = await database.query<{ booking_id:string }>(`select booking_id from public.claim_minuta_notification_outbox(array['telegram'],20)`);
  assertEquals(unifiedClaim.rows.some(row => row.booking_id===booking),false);
  assertEquals(unifiedClaim.rows.some(row => row.booking_id===newBooking),true);
});

Deno.test("v114 reconciles a legacy direct send without replay", async () => {
  const result = await database.query<{ status:string; attempts:number }>(
    `select status,attempts from public.notification_outbox where event_key='legacy-direct'`
  );
  assertEquals(result.rows, [{ status:"sent", attempts:1 }]);
});

Deno.test("unconnected client remains queued and consumes no attempt", async () => {
  const booking = "00000000-0000-4000-8000-000000000010";
  await database.exec(`insert into public.bookings values('${booking}','B1',gen_random_uuid(),'${performer}','${service}','Клиент','79990000010','2099-09-10','15:00','new','${organization}')`);
  const claimed = await database.query(`select * from public.claim_minuta_notification_outbox(array['telegram'],20)`);
  assertEquals(claimed.rows.length, 0);
  const queued = await database.query<{ status:string; attempts:number }>(`select status,attempts from public.notification_outbox where booking_id='${booking}'`);
  assertEquals(queued.rows, [{ status:"pending", attempts:0 }]);
});

Deno.test("connection unlocks one idempotent send and delivery needs evidence", async () => {
  const booking = "00000000-0000-4000-8000-000000000020";
  await database.exec(`
    insert into public.bookings values('${booking}','B2',gen_random_uuid(),'${performer}','${service}','Клиент','79990000020','2099-09-10','16:00','new','${organization}');
    insert into public.client_telegram_subscriptions(performer_id,client_phone,chat_id) values('${performer}','79990000020',220020);
  `);
  const claimed = await database.query<{ outbox_id:string; lock_token:string }>(`select * from public.claim_minuta_notification_outbox(array['telegram'],20) where booking_id='${booking}'`);
  assertEquals(claimed.rows.length, 1);
  const [{ outbox_id, lock_token }] = claimed.rows;
  const sent = await database.query<{ ack:string }>(`select public.ack_minuta_notification_outbox_v114('${outbox_id}','${lock_token}','msg-20','sent',null,null) ack`);
  assertEquals(sent.rows[0].ack, "sent");
  await assertRejects(() => database.exec(`select public.confirm_minuta_notification_delivery_v114('telegram','msg-20',null,'test')`));
  const delivered = await database.query<{ state:string }>(`select public.confirm_minuta_notification_delivery_v114('telegram','msg-20','2026-09-05T10:00:00Z','mock_gateway') state`);
  assertEquals(delivered.rows[0].state, "delivered");
  const evidence = await database.query<{ delivered_at:string|null; delivery_receipt_source:string|null }>(`select delivered_at,delivery_receipt_source from public.notification_outbox where id='${outbox_id}'`);
  assert(evidence.rows[0].delivered_at);
  assertEquals(evidence.rows[0].delivery_receipt_source, "mock_gateway");
});

Deno.test("expired ambiguous Telegram lease is quarantined and never auto-claimed", async () => {
  const booking = "00000000-0000-4000-8000-000000000021";
  await database.exec(`
    insert into public.bookings values('${booking}','B21',gen_random_uuid(),'${performer}','${service}','Клиент','79990000020','2099-09-10','16:30','confirmed','${organization}');
    update public.notification_outbox set status='sending',attempts=1,locked_at=now()-interval '16 minutes',lock_token=gen_random_uuid()
      where booking_id='${booking}';
    insert into public.notification_delivery_attempts(outbox_id,performer_id,attempt_no,outcome)
      select id,performer_id,1,'sending' from public.notification_outbox where booking_id='${booking}';
  `);
  const claimed = await database.query<{ booking_id:string }>(`select booking_id from public.claim_minuta_notification_outbox(array['telegram'],20)`);
  assertEquals(claimed.rows.some(row => row.booking_id===booking),false);
  const state = await database.query<{ status:string; last_error_code:string; attempt_outcome:string; attempt_error:string }>(`
    select queue.status,queue.last_error_code,attempt.outcome attempt_outcome,attempt.error_code attempt_error
    from public.notification_outbox queue
    join public.notification_delivery_attempts attempt on attempt.outbox_id=queue.id and attempt.attempt_no=queue.attempts
    where queue.booking_id='${booking}'
  `);
  assertEquals(state.rows,[{
    status:"failed",last_error_code:"telegram_delivery_unknown",
    attempt_outcome:"failed",attempt_error:"telegram_delivery_unknown",
  }]);
  await assertRejects(() => database.exec(`select public.retry_notification_outbox((
    select id from public.notification_outbox where booking_id='${booking}'
  ))`));
});

Deno.test("confirmation, reschedule, reminder and cancellation supersede stale rows", async () => {
  const booking = "00000000-0000-4000-8000-000000000030";
  await database.exec(`
    insert into public.bookings values('${booking}','B3',gen_random_uuid(),'${performer}','${service}','Клиент','79990000030','2099-09-10','17:00','new','${organization}');
    update public.bookings set status='confirmed' where id='${booking}';
  `);
  let rows = await database.query<{ kind:string; status:string }>(`select kind,status from public.notification_outbox where booking_id='${booking}' order by created_at,event_key`);
  assertEquals(rows.rows.some(row => row.kind === 'booking_created' && row.status === 'cancelled'), true);
  assertEquals(rows.rows.some(row => row.kind === 'booking_confirmed' && row.status === 'pending'), true);

  await database.exec(`update public.bookings set booking_time='18:00' where id='${booking}'; select public.enqueue_minuta_booking_notification('${booking}','booking_reminder')`);
  await database.exec(`update public.bookings set booking_time='19:00' where id='${booking}'`);
  rows = await database.query<{ kind:string; status:string }>(`select kind,status from public.notification_outbox where booking_id='${booking}' order by created_at,event_key`);
  assertEquals(rows.rows.filter(row => row.kind === 'booking_reminder' && row.status === 'cancelled').length, 1);
  assertEquals(rows.rows.filter(row => row.kind === 'booking_rescheduled' && row.status === 'pending').length, 1);

  const beforeDuplicate = rows.rows.length;
  await database.exec(`select public.enqueue_minuta_booking_notification('${booking}','booking_rescheduled')`);
  rows = await database.query<{ kind:string; status:string }>(`select kind,status from public.notification_outbox where booking_id='${booking}' order by created_at,event_key`);
  assertEquals(rows.rows.length, beforeDuplicate);

  await database.exec(`update public.bookings set status='cancelled' where id='${booking}'`);
  rows = await database.query<{ kind:string; status:string }>(`select kind,status from public.notification_outbox where booking_id='${booking}' order by created_at,event_key`);
  assertEquals(rows.rows.filter(row => row.kind !== 'booking_cancelled' && row.status === 'pending').length, 0);
  assertEquals(rows.rows.filter(row => row.kind === 'booking_cancelled' && row.status === 'pending').length, 1);
});

Deno.test("compatibility rollback preserves data and RPCs while keeping replacement cron", async () => {
  const before = await database.query<{ outbox_count:number; attempt_count:number; endpoint_count:number; cutover_count:number; legacy_lease_count:number }>(`
    select
      (select count(*)::integer from public.notification_outbox) outbox_count,
      (select count(*)::integer from public.notification_delivery_attempts) attempt_count,
      (select count(*)::integer from public.notification_recipient_endpoints) endpoint_count,
      (select count(*)::integer from public.notification_v114_organization_cutovers) cutover_count,
      (select count(*)::integer from public.notification_v114_legacy_send_leases) legacy_lease_count
  `);
  await database.exec(rollback);
  const after = await database.query<{ outbox_count:number; attempt_count:number; endpoint_count:number; cutover_count:number; legacy_lease_count:number }>(`
    select
      (select count(*)::integer from public.notification_outbox) outbox_count,
      (select count(*)::integer from public.notification_delivery_attempts) attempt_count,
      (select count(*)::integer from public.notification_recipient_endpoints) endpoint_count,
      (select count(*)::integer from public.notification_v114_organization_cutovers) cutover_count,
      (select count(*)::integer from public.notification_v114_legacy_send_leases) legacy_lease_count
  `);
  assertEquals(after.rows, before.rows);

  const rpc = await database.query<{ claim_exists:boolean; ack_exists:boolean; state_exists:boolean; sync_trigger_exists:boolean }>(`
    select
      to_regprocedure('public.claim_minuta_notification_outbox(text[],integer)') is not null claim_exists,
      to_regprocedure('public.ack_minuta_notification_outbox_v114(uuid,uuid,text,text,timestamptz,text)') is not null ack_exists,
      to_regprocedure('public.get_minuta_client_notification_state_v114(uuid)') is not null state_exists,
      exists(select 1 from pg_trigger where tgname='client_telegram_subscription_sync_v114' and not tgisinternal) sync_trigger_exists
  `);
  assertEquals(rpc.rows, [{ claim_exists:true, ack_exists:true, state_exists:true, sync_trigger_exists:false }]);
  await assertRejects(() => database.exec(`
    select public.activate_minuta_notification_v114_cutover('${organization}','v114',array['telegram'])
  `));
  const jobs = await database.query<{ jobname:string; active:boolean }>(`select jobname,active from cron.job order by jobname`);
  assertEquals(jobs.rows, [{ jobname:"minuta-notification-dispatcher", active:true }]);
});

Deno.test("v114 reapplies after rollback without losing or duplicating data", async () => {
  const before = await database.query<{ outbox_count:number; attempt_count:number }>(`
    select (select count(*)::integer from public.notification_outbox) outbox_count,
      (select count(*)::integer from public.notification_delivery_attempts) attempt_count
  `);
  await database.exec(migration);
  const after = await database.query<{ outbox_count:number; attempt_count:number; sync_trigger_exists:boolean }>(`
    select (select count(*)::integer from public.notification_outbox) outbox_count,
      (select count(*)::integer from public.notification_delivery_attempts) attempt_count,
      exists(select 1 from pg_trigger where tgname='client_telegram_subscription_sync_v114' and not tgisinternal) sync_trigger_exists
  `);
  assertEquals(after.rows[0].outbox_count, before.rows[0].outbox_count);
  assertEquals(after.rows[0].attempt_count, before.rows[0].attempt_count);
  assertEquals(after.rows[0].sync_trigger_exists, true);
  const jobs = await database.query<{ jobname:string; active:boolean }>(`select jobname,active from cron.job order by jobname`);
  assertEquals(jobs.rows, [{ jobname:"minuta-notification-dispatcher", active:true }]);
});
