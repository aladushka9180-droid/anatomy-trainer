import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.3.10";

const psqlBody = (source: string) =>
  source.replace(/^\\set ON_ERROR_STOP on\s*/i, "");
const migration = psqlBody(
  await Deno.readTextFile(
    new URL("./supabase-migration-v126.sql", import.meta.url),
  ),
);
const rollback = psqlBody(
  await Deno.readTextFile(
    new URL("./supabase-migration-v126-rollback.sql", import.meta.url),
  ),
);
const database = new PGlite();
const organization = "00000000-0000-4000-8000-000000000001";
const performer = "00000000-0000-4000-8000-000000000002";
const service = "00000000-0000-4000-8000-000000000003";
const receiptOutbox = "10000000-0000-4000-8000-000000000001";
const otherReceiptOutbox = "10000000-0000-4000-8000-000000000002";

await database.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema extensions;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
  $$;
  create function auth.role() returns text language sql stable as $$
    select nullif(current_setting('request.jwt.claim.role',true),'')
  $$;
  create table public.organizations(id uuid primary key,status text not null default 'active');
  create table public.organization_memberships(
    organization_id uuid,user_id uuid,role text,active boolean default true
  );
  create table public.performer_profiles(id uuid primary key,display_name text);
  create table public.services(id uuid primary key,name text);
  create table public.bookings(
    id uuid primary key,booking_code text,manage_token uuid,performer_id uuid,service_id uuid,
    client_name text,client_phone text,booking_date date,booking_time time without time zone,
    status text,organization_id uuid
  );
  create function public.touch_minuta_updated_at() returns trigger language plpgsql as $$
  begin new.updated_at=now();return new;end $$;
  create function public.has_organization_role(uuid,text[]) returns boolean language sql stable as $$select true$$;
  create table public.organization_notification_settings(
    organization_id uuid primary key references public.organizations(id),enabled boolean not null default false,
    booking_created_enabled boolean not null default true,booking_confirmed_enabled boolean not null default true,
    booking_rescheduled_enabled boolean not null default true,booking_cancelled_enabled boolean not null default true,
    booking_reminder_enabled boolean not null default true,reminder_minutes_before integer not null default 1440,
    enabled_at timestamptz,enabled_by uuid,updated_at timestamptz not null default now()
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
    event_key text unique,kind text constraint notification_outbox_kind_check check(kind in(
      'booking_created','booking_confirmed','booking_rescheduled','booking_cancelled','booking_reminder')),
    channel text,status text default 'pending',attempts integer default 0,next_attempt_at timestamptz default now(),
    locked_at timestamptz,lock_token uuid,last_error_code text,last_error text,provider_message_id text,sent_at timestamptz,
    delivered_at timestamptz,delivery_receipt_at timestamptz,delivery_receipt_source text,
    created_at timestamptz default now(),updated_at timestamptz default now(),audience text,recipient_key text,
    payload jsonb default '{}'::jsonb,dispatcher text default 'unified',unique(id,performer_id)
  );
  create table public.notification_delivery_attempts(
    id bigint generated always as identity primary key,outbox_id uuid,performer_id uuid,attempt_no integer,
    outcome text,error_code text,error_message text,provider_message_id text,delivered_at timestamptz,
    delivery_receipt_source text,started_at timestamptz default now(),finished_at timestamptz,
    unique(outbox_id,attempt_no)
  );
  create table public.notification_v114_organization_cutovers(organization_id uuid primary key);
  create function public.enqueue_minuta_booking_notification(uuid,text) returns integer language sql as $$select 0$$;
  create function public.enqueue_minuta_booking_change_notification() returns trigger language plpgsql as $$begin return new;end$$;
  create trigger bookings_enqueue_change_notification_v88 after update of status,booking_date,booking_time on public.bookings
    for each row execute function public.enqueue_minuta_booking_change_notification();
  create function public.claim_minuta_notification_outbox(text[],integer)
  returns table(outbox_id uuid,lock_token uuid,event_key text,organization_id uuid,performer_id uuid,booking_id uuid,
    kind text,channel text,audience text,attempt_no integer,destination jsonb,message_payload jsonb)
  language sql as $$select null::uuid,null::uuid,null::text,null::uuid,null::uuid,null::uuid,
    null::text,null::text,null::text,0,null::jsonb,null::jsonb where false$$;
  create function public.fail_notification_outbox(uuid,uuid,text,text,boolean,integer)
    returns text language sql as $$select 'failed'::text$$;
  create function public.confirm_minuta_notification_delivery_v114(text,text,timestamptz,text)
    returns text language sql as $$select 'delivered'::text$$;
  create function public.get_minuta_notification_workspace(uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
  insert into public.organizations values('${organization}','active');
  insert into public.performer_profiles values('${performer}','Мастер');
  insert into public.services values('${service}','Услуга');
  insert into public.organization_notification_settings(organization_id,enabled) values('${organization}',true);
  insert into public.organization_notification_channels values
    ('${organization}','client','telegram',true,now()),('${organization}','client','sms',true,now()),
    ('${organization}','provider','telegram',true,now());
  insert into public.notification_v114_organization_cutovers values('${organization}');
  select set_config('request.jwt.claim.role','service_role',false);
`);

await database.exec(migration);
await database.exec(migration);

Deno.test("v126 quiet hours, confirmation request, fallback and rollback contracts", async () => {
  const defaults = await database.query<{
    confirmation: boolean;
    quiet: boolean;
    fallback_count: number;
  }>(
    `select booking_confirmation_request_enabled confirmation,quiet_hours_enabled quiet,
      (select count(*)::integer from public.organization_notification_fallbacks) fallback_count
    from public.organization_notification_settings where organization_id='${organization}'`,
  );
  assertEquals(defaults.rows, [{
    confirmation: false,
    quiet: false,
    fallback_count: 0,
  }]);

  await assertRejects(() =>
    database.exec(`update public.organization_notification_settings
    set quiet_hours_timezone='Invalid/Zone' where organization_id='${organization}'`)
  );
  await database.exec(`update public.organization_notification_settings
    set quiet_hours_enabled=true,quiet_hours_timezone='UTC',quiet_hours_start='22:00',quiet_hours_end='08:00'
    where organization_id='${organization}'`);
  const quiet = await database.query<{ deferred: string; allowed: string }>(`
    select public.minuta_notification_next_allowed_at_v126('${organization}','2026-09-08T23:00:00Z')::text deferred,
      public.minuta_notification_next_allowed_at_v126('${organization}','2026-09-08T12:00:00Z')::text allowed`);
  assertEquals(quiet.rows[0].deferred.startsWith("2026-09-09 08:00:00"), true);
  assertEquals(quiet.rows[0].allowed.startsWith("2026-09-08 12:00:00"), true);

  await database.exec(`update public.organization_notification_settings set
    quiet_hours_enabled=false,booking_confirmation_request_enabled=true,
    confirmation_request_minutes_before=1440 where organization_id='${organization}';
    insert into public.bookings values(
      gen_random_uuid(),'C1',gen_random_uuid(),'${performer}','${service}','Клиент','79990000001',
      ((now() at time zone 'UTC')+interval '24 hours')::date,
      ((now() at time zone 'UTC')+interval '24 hours')::time,'new','${organization}');
    select public.enqueue_due_minuta_booking_confirmation_requests_v126(20);
    select public.enqueue_due_minuta_booking_confirmation_requests_v126(20);`);
  const requestRows = await database.query<{ count: number }>(
    `select count(*)::integer count
    from public.notification_outbox where kind='booking_confirmation_request'`,
  );
  assertEquals(requestRows.rows, [{ count: 2 }]);

  await database.exec(`insert into public.notification_recipient_endpoints(
      organization_id,audience,subject_key,channel,destination,consent_source,consent_at,active)
    values('${organization}','client','79990000001','telegram','{"chat_id":"1"}','test',now(),true),
      ('${organization}','client','79990000001','sms','{"phone":"79990000001"}','test',now(),true);
    update public.organization_notification_settings set quiet_hours_enabled=true,
      quiet_hours_start=case when (now() at time zone 'UTC')::time<'12:00' then '00:00'::time else '12:00'::time end,
      quiet_hours_end=case when (now() at time zone 'UTC')::time<'12:00' then '12:00'::time else '00:00'::time end
    where organization_id='${organization}';`);
  const quietClaim = await database.query(
    `select * from public.claim_minuta_notification_outbox(array['telegram'],1)`,
  );
  assertEquals(quietClaim.rows.length, 0);
  await database.exec(
    `update public.organization_notification_settings set quiet_hours_enabled=false
    where organization_id='${organization}';
    select public.set_minuta_notification_fallback_v126(
      '${organization}','client','telegram','sms',true,0);`,
  );
  const claimed = await database.query<
    { outbox_id: string; lock_token: string }
  >(`
    select outbox_id,lock_token from public.claim_minuta_notification_outbox(array['telegram'],1)`);
  assertEquals(claimed.rows.length, 1);
  await database.exec(`select public.fail_notification_outbox(
    '${claimed.rows[0].outbox_id}','${
    claimed.rows[0].lock_token
  }','telegram_403','rejected',false,null)`);
  const fallback = await database.query<{ channel: string; depth: number }>(
    `select channel,fallback_depth::integer depth
    from public.notification_outbox where fallback_of='${
      claimed.rows[0].outbox_id
    }'`,
  );
  assertEquals(fallback.rows, [{ channel: "sms", depth: 1 }]);

  await database.exec(`insert into public.notification_outbox(
      performer_id,booking_id,organization_id,event_key,kind,channel,status,attempts,next_attempt_at,
      audience,recipient_key,payload,dispatcher,fallback_depth)
    select performer_id,booking_id,organization_id,event_key||':ambiguous-fixture',kind,channel,
      'pending',0,now(),audience,recipient_key,payload,dispatcher,0
    from public.notification_outbox where id='${claimed.rows[0].outbox_id}'`);
  const ambiguous = await database.query<
    { outbox_id: string; lock_token: string }
  >(`
    select outbox_id,lock_token from public.claim_minuta_notification_outbox(array['telegram'],1)`);
  assertEquals(ambiguous.rows.length, 1);
  await database.exec(`select public.fail_notification_outbox(
    '${ambiguous.rows[0].outbox_id}','${ambiguous.rows[0].lock_token}',
    'telegram_delivery_unknown','unknown',false,null)`);
  const unsafeFallback = await database.query<{ count: number }>(
    `select count(*)::integer count
    from public.notification_outbox where fallback_of='${
      ambiguous.rows[0].outbox_id
    }'`,
  );
  assertEquals(unsafeFallback.rows, [{ count: 0 }]);

  await database.exec(`insert into public.notification_outbox(
      id,performer_id,booking_id,organization_id,event_key,kind,channel,status,attempts,
      next_attempt_at,audience,recipient_key,payload,dispatcher,provider_message_id,sent_at)
    values
      ('${receiptOutbox}','${performer}',gen_random_uuid(),'${organization}',
        'receipt:exact:first','booking_created','sms','sent',1,now(),'client','79990000001',
        '{}'::jsonb,'unified','same-provider-message',now()-interval '2 minutes'),
      ('${otherReceiptOutbox}','${performer}',gen_random_uuid(),'${organization}',
        'receipt:exact:second','booking_created','sms','sent',1,now(),'client','79990000001',
        '{}'::jsonb,'unified','same-provider-message',now());
    insert into public.notification_delivery_attempts(
      outbox_id,performer_id,attempt_no,outcome,provider_message_id,finished_at)
    values
      ('${receiptOutbox}','${performer}',1,'sent','same-provider-message',now()),
      ('${otherReceiptOutbox}','${performer}',1,'sent','same-provider-message',now());`);
  for (
    const [outboxId, eventKey, organizationId, channel, messageId] of [
      [
        otherReceiptOutbox,
        "receipt:exact:first",
        organization,
        "sms",
        "same-provider-message",
      ],
      [
        receiptOutbox,
        "receipt:exact:second",
        organization,
        "sms",
        "same-provider-message",
      ],
      [
        receiptOutbox,
        "receipt:exact:first",
        "90000000-0000-4000-8000-000000000009",
        "sms",
        "same-provider-message",
      ],
      [
        receiptOutbox,
        "receipt:exact:first",
        organization,
        "email",
        "same-provider-message",
      ],
      [
        receiptOutbox,
        "receipt:exact:first",
        organization,
        "sms",
        "different-provider-message",
      ],
    ]
  ) {
    const mismatch = await database.query<{ state: string }>(`
      select public.confirm_minuta_notification_delivery_v126(
        '${outboxId}','${eventKey}','${organizationId}','${channel}',
        '${messageId}',now(),'fixture_gateway') state`);
    assertEquals(mismatch.rows, [{ state: "not_found" }]);
  }
  const receipt = await database.query<{ state: string }>(`
    select public.confirm_minuta_notification_delivery_v126(
      '${receiptOutbox}','receipt:exact:first','${organization}','sms',
      'same-provider-message',now(),'fixture_gateway') state`);
  assertEquals(receipt.rows, [{ state: "delivered" }]);
  const exactReceipt = await database.query<{
    id: string;
    delivered: boolean;
  }>(
    `select id,delivered_at is not null delivered from public.notification_outbox
    where id in('${receiptOutbox}','${otherReceiptOutbox}') order by id`,
  );
  assertEquals(exactReceipt.rows, [
    { id: receiptOutbox, delivered: true },
    { id: otherReceiptOutbox, delivered: false },
  ]);

  await database.exec(`delete from public.notification_delivery_attempts;
    delete from public.notification_outbox;
    delete from public.organization_notification_fallbacks;
    update public.organization_notification_settings
      set booking_confirmation_request_enabled=false,quiet_hours_enabled=false;`);
  await database.exec(rollback);
  const after = await database.query<
    {
      new_column: boolean;
      new_table: boolean;
      scheduler_compat: boolean;
      scheduler_result: number;
      receipt_compat: boolean;
      receipt_result: string;
    }
  >(`
    select exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='organization_notification_settings' and column_name='quiet_hours_enabled') new_column,
      to_regclass('public.organization_notification_fallbacks') is not null new_table,
      to_regprocedure('public.enqueue_due_minuta_booking_confirmation_requests_v126(integer)') is not null scheduler_compat,
      public.enqueue_due_minuta_booking_confirmation_requests_v126(20) scheduler_result,
      to_regprocedure('public.confirm_minuta_notification_delivery_v126(uuid,text,uuid,text,text,timestamp with time zone,text)') is not null receipt_compat,
      public.confirm_minuta_notification_delivery_v126(
        '${receiptOutbox}','receipt:exact:first','${organization}','sms',
        'same-provider-message',now(),'fixture_gateway') receipt_result`);
  assertEquals(after.rows, [{
    new_column: false,
    new_table: false,
    scheduler_compat: true,
    scheduler_result: 0,
    receipt_compat: true,
    receipt_result: "not_found",
  }]);

  await database.exec(migration);
  const reapplied = await database.query<{
    new_column: boolean;
    new_table: boolean;
    receipt_rpc: boolean;
  }>(
    `select exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='organization_notification_settings' and column_name='quiet_hours_enabled') new_column,
    to_regclass('public.organization_notification_fallbacks') is not null new_table,
    to_regprocedure('public.confirm_minuta_notification_delivery_v126(uuid,text,uuid,text,text,timestamp with time zone,text)') is not null receipt_rpc`,
  );
  assertEquals(reapplied.rows, [{
    new_column: true,
    new_table: true,
    receipt_rpc: true,
  }]);
});
