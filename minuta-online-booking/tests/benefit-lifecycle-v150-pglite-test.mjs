import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { PGlite } = await import(process.env.MINUTA_PGLITE_MODULE
  ? pathToFileURL(process.env.MINUTA_PGLITE_MODULE).href : '@electric-sql/pglite');
const root = fileURLToPath(new URL('../', import.meta.url));
const db = new PGlite();
const ids = {
  owner:'00000000-0000-4000-8000-000000000150', outsider:'00000000-0000-4000-8000-000000000151',
  organization:'00000000-0000-4000-8000-000000000152', client:'00000000-0000-4000-8000-000000000153',
  booking:'00000000-0000-4000-8000-000000000154', instrument:'00000000-0000-4000-8000-000000000155',
  expired:'00000000-0000-4000-8000-000000000156', freeze:'00000000-0000-4000-8000-000000000157',
  unfreeze:'00000000-0000-4000-8000-000000000158', blockedFreeze:'00000000-0000-4000-8000-000000000159',
  location:'00000000-0000-4000-8000-000000000160', legacyFrozen:'00000000-0000-4000-8000-000000000161'
};
const q = value => `'${String(value).replaceAll("'", "''")}'`;
async function scalar(sql, key='value') { return (await db.query(sql)).rows[0]?.[key]; }
async function asActor(actor, callback) {
  await db.exec(`select set_config('request.jwt.claim.sub',${q(actor)},false); set role authenticated`);
  try { return await callback(); } finally { await db.exec('reset role'); }
}

await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema extensions;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth to authenticated,anon,service_role;
create table public.organizations(id uuid primary key,status text not null default 'active');
create table public.organization_memberships(organization_id uuid,user_id uuid,role text,active boolean,primary key(organization_id,user_id));
create table public.performer_profiles(id uuid primary key,display_name text);
create table public.client_accounts(id uuid primary key);
create table public.bookings(id uuid primary key,organization_id uuid,client_account_id uuid);
create table public.locations(id uuid primary key,organization_id uuid,timezone text,active boolean,is_primary boolean);
create function public.has_organization_role(p_organization uuid,p_roles text[])
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.organization_memberships m where m.organization_id=p_organization and m.user_id=auth.uid() and m.active and m.role=any(p_roles))
$$;
create function public.get_minuta_benefit_role(p_organization uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare v_role text; begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select m.role into v_role from public.organization_memberships m join public.organizations o on o.id=m.organization_id and o.status='active'
  where m.organization_id=p_organization and m.user_id=auth.uid() and m.active;
  if v_role is null or v_role not in('owner','admin') then raise exception using errcode='42501',message='benefit_management_denied'; end if;
  return v_role;
end $$;
create table public.client_benefit_instruments(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),product_id uuid not null,
  client_account_id uuid not null references public.client_accounts(id),request_id uuid not null,public_code text not null unique,
  status text not null default 'active' check(status in('active','frozen','exhausted','expired','cancelled')),product_snapshot jsonb not null,
  remaining_amount_rub integer not null default 0,remaining_visits integer not null default 0,issued_at timestamptz not null default now(),
  expires_on date not null,issued_by uuid references auth.users(id),updated_at timestamptz not null default now(),unique(id,organization_id)
);
create table public.benefit_redemptions(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null,instrument_id uuid not null,booking_id uuid,
  service_id uuid,units integer not null default 0,amount_rub integer not null default 0,status text not null,
  reserved_at timestamptz not null default now(),redeemed_at timestamptz,released_at timestamptz,acted_by uuid,updated_at timestamptz not null default now(),
  unique(id,organization_id),foreign key(instrument_id,organization_id) references public.client_benefit_instruments(id,organization_id)
);
create table public.benefit_ledger(
  id bigint generated always as identity primary key,organization_id uuid not null,instrument_id uuid not null,redemption_id uuid,
  event_type text not null constraint benefit_ledger_event_type_check check(event_type in('issued','reserved','redeemed','released','frozen','activated','cancelled')),
  amount_delta_rub integer not null default 0,visits_delta integer not null default 0,amount_balance_rub integer not null,
  visits_balance integer not null,details jsonb not null default '{}'::jsonb,actor_id uuid references auth.users(id),created_at timestamptz not null default now(),
  foreign key(instrument_id,organization_id) references public.client_benefit_instruments(id,organization_id)
);
create table public.benefit_audit_log(
  id bigint generated always as identity primary key,organization_id uuid not null,actor_id uuid,action text not null,subject_id uuid,
  details jsonb not null default '{}'::jsonb,created_at timestamptz not null default now()
);
create function public.write_minuta_benefit_audit(p_organization uuid,p_action text,p_subject uuid,p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path='' as $$
  insert into public.benefit_audit_log(organization_id,actor_id,action,subject_id,details) values(p_organization,auth.uid(),p_action,p_subject,coalesce(p_details,'{}'::jsonb))
$$;
create function public.get_minuta_client_commerce_v147(p_organization uuid,p_client_account uuid)
returns jsonb language sql stable as $$ select '{}'::jsonb $$;
-- This PGlite bundle has no pgcrypto. Production requires the real v129
-- SHA-256 function; this deterministic stand-in exercises stamp comparisons.
create function public.minuta_financial_sha256_v129(p_value jsonb)
returns text language sql immutable security definer set search_path='' as $$
  select md5(p_value::text)
$$;
create function public.apply_minuta_benefit_v149(
  p_organization uuid,p_instrument uuid,p_booking uuid,p_action text,p_amount_rub integer default null,p_request_id uuid default null
) returns jsonb language sql as $$ select jsonb_build_object('organization_id',p_organization,'status','reserved','request_id',p_request_id) $$;
grant select on public.client_benefit_instruments,public.benefit_redemptions,public.benefit_ledger,public.benefit_audit_log to authenticated;
insert into auth.users values(${q(ids.owner)}),(${q(ids.outsider)});
insert into public.organizations values(${q(ids.organization)},'active');
insert into public.organization_memberships values(${q(ids.organization)},${q(ids.owner)},'owner',true);
insert into public.performer_profiles values(${q(ids.owner)},'Владелец');
insert into public.client_accounts values(${q(ids.client)});
insert into public.bookings values(${q(ids.booking)},${q(ids.organization)},${q(ids.client)});
insert into public.locations values(${q(ids.location)},${q(ids.organization)},'Europe/Samara',true,true);
insert into public.client_benefit_instruments(
  id,organization_id,product_id,client_account_id,request_id,public_code,status,product_snapshot,remaining_visits,expires_on,issued_by
) values(
  ${q(ids.legacyFrozen)},${q(ids.organization)},gen_random_uuid(),${q(ids.client)},gen_random_uuid(),'MIN-LEGACY-FROZEN-150','frozen',
  '{"name":"Старая заморозка","kind":"visit_pass"}',2,pg_catalog.timezone('Europe/Samara',clock_timestamp())::date+20,${q(ids.owner)}
);
`);

const migration = readFileSync(root+'supabase-migration-v150.sql','utf8');
const rollback = readFileSync(root+'supabase-migration-v150-rollback.sql','utf8');
const v149Definition = await scalar(`select pg_get_functiondef('public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid)'::regprocedure) value`);
await db.exec(migration);
assert.equal(await scalar(`select count(*)::int value from public.benefit_freeze_periods where instrument_id=${q(ids.legacyFrozen)} and thawed_at is null`), 1);
// Simulate a v73 call that had already started before the compatibility function became visible.
await db.exec(`update public.client_benefit_instruments set status='active' where id=${q(ids.legacyFrozen)}`);
await db.exec(migration);
assert.equal(await scalar(`select count(*)::int value from public.benefit_freeze_periods where instrument_id=${q(ids.legacyFrozen)} and thawed_at is null`), 0);
assert.equal(await scalar(`select count(*)::int value from public.benefit_freeze_periods where instrument_id=${q(ids.legacyFrozen)} and thawed_at is not null`), 1);
assert.equal(await scalar(`select pg_get_functiondef('public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid)'::regprocedure)=${q(v149Definition)} value`), true);
assert.equal(await scalar(`select public.minuta_benefit_frozen_days_v150('Pacific/Kiritimati','2026-09-11 09:59:00+00'::timestamptz,'2026-09-11 10:01:00+00'::timestamptz) value`), 1);
for (const signature of [
  'public.get_minuta_benefit_timezone_v150(uuid)',
  'public.minuta_benefit_frozen_days_v150(text,timestamptz,timestamptz)',
  'public.sync_minuta_benefit_expiry_v150(uuid,uuid)',
  'public.set_minuta_benefit_lifecycle_v150(uuid,uuid,text,text,uuid)',
  'public.get_minuta_benefit_lifecycle_v150(uuid,uuid)',
  'public.set_minuta_benefit_status(uuid,uuid,text)'
]) assert.match(await scalar(`select obj_description(${q(signature)}::regprocedure::oid,'pg_proc') value`), /^minuta_benefit_lifecycle_v150:sha256=[0-9a-f]+$/);
for (const relation of ['public.benefit_freeze_periods','public.benefit_lifecycle_requests'])
  assert.match(await scalar(`select obj_description(${q(relation)}::regclass::oid,'pg_class') value`), /^minuta_benefit_lifecycle_v150:sha256=[0-9a-f]+$/);
assert.match(await scalar("select obj_description(oid,'pg_constraint') value from pg_catalog.pg_constraint where conrelid='public.benefit_ledger'::regclass and conname='benefit_ledger_event_type_check'"), /^minuta_benefit_lifecycle_v150:sha256=[0-9a-f]+$/);
assert.deepEqual(await scalar(`select coalesce(jsonb_agg(role_name order by role_name),'[]'::jsonb) value from (
  select distinct pg_get_userbyid(role_oid) role_name from pg_catalog.pg_policy policy_row
  cross join lateral unnest(policy_row.polroles) role_oid
  where policy_row.polrelid in ('public.benefit_freeze_periods'::regclass,'public.benefit_lifecycle_requests'::regclass)
) stable_roles`), ['authenticated']);

await db.exec('create role lifecycle_future_owner');
await db.exec('alter function public.get_minuta_benefit_timezone_v150(uuid) owner to lifecycle_future_owner');
await assert.rejects(db.exec(migration), /v150_apply_blocked_newer_function_definition/);
await db.exec('rollback');
assert.equal(await scalar("select pg_get_userbyid(proowner) value from pg_catalog.pg_proc where oid='public.get_minuta_benefit_timezone_v150(uuid)'::regprocedure"), 'lifecycle_future_owner');
await db.exec('alter function public.get_minuta_benefit_timezone_v150(uuid) owner to postgres');

await db.exec('alter table public.benefit_lifecycle_requests owner to lifecycle_future_owner');
await assert.rejects(db.exec(migration), /v150_apply_blocked_newer_table_definition/);
await db.exec('rollback');
await db.exec('alter table public.benefit_lifecycle_requests owner to postgres');

await db.exec('alter table public.benefit_freeze_periods force row level security');
await assert.rejects(db.exec(migration), /v150_apply_blocked_newer_table_definition/);
await db.exec('rollback');
await db.exec('alter table public.benefit_freeze_periods no force row level security');

await db.exec(`create function public.v150_future_trigger_test() returns trigger language plpgsql as $$ begin return new; end $$;
  create trigger v150_future_trigger before insert on public.benefit_freeze_periods
  for each row execute function public.v150_future_trigger_test()`);
await assert.rejects(db.exec(migration), /v150_apply_blocked_newer_table_definition/);
await db.exec('rollback');
assert.equal(await scalar("select tgenabled value from pg_catalog.pg_trigger where tgrelid='public.benefit_freeze_periods'::regclass and tgname='v150_future_trigger'"), 'O');
await db.exec('drop trigger v150_future_trigger on public.benefit_freeze_periods; drop function public.v150_future_trigger_test()');

const timezoneDefinition = await scalar("select pg_get_functiondef('public.get_minuta_benefit_timezone_v150(uuid)'::regprocedure) value");
const timezoneStamp = await scalar("select obj_description('public.get_minuta_benefit_timezone_v150(uuid)'::regprocedure::oid,'pg_proc') value");
await db.exec("create or replace function public.get_minuta_benefit_timezone_v150(p_organization uuid) returns text language sql stable security definer set search_path='' as $$ select 'Etc/UTC'::text $$");
await assert.rejects(db.exec(migration), /v150_apply_blocked_newer_function_definition/);
await db.exec('rollback');
assert.match(await scalar("select prosrc value from pg_catalog.pg_proc where oid='public.get_minuta_benefit_timezone_v150(uuid)'::regprocedure"), /Etc\/UTC/);
await db.exec(timezoneDefinition);
await db.exec(`comment on function public.get_minuta_benefit_timezone_v150(uuid) is ${q(timezoneStamp)}`);

const freezeTableStamp = await scalar("select obj_description('public.benefit_freeze_periods'::regclass::oid,'pg_class') value");
await db.exec('alter table public.benefit_freeze_periods add column future_v151_marker boolean');
await assert.rejects(db.exec(migration), /v150_apply_blocked_newer_table_definition/);
await db.exec('rollback');
assert.equal(await scalar("select count(*)::int value from pg_catalog.pg_attribute where attrelid='public.benefit_freeze_periods'::regclass and attname='future_v151_marker' and not attisdropped"), 1);
await db.exec('alter table public.benefit_freeze_periods drop column future_v151_marker');
await db.exec(`comment on table public.benefit_freeze_periods is ${q(freezeTableStamp)}`);

await db.exec(`
insert into public.client_benefit_instruments(id,organization_id,product_id,client_account_id,request_id,public_code,product_snapshot,remaining_visits,expires_on,issued_by)
values
(${q(ids.instrument)},${q(ids.organization)},gen_random_uuid(),${q(ids.client)},gen_random_uuid(),'MIN-LIFECYCLE-150','{"name":"Пакет 5 визитов","kind":"package"}',5,pg_catalog.timezone('Europe/Samara',clock_timestamp())::date+10,${q(ids.owner)}),
(${q(ids.expired)},${q(ids.organization)},gen_random_uuid(),${q(ids.client)},gen_random_uuid(),'MIN-EXPIRED-150','{"name":"Старый абонемент","kind":"visit_pass"}',2,pg_catalog.timezone('Europe/Samara',clock_timestamp())::date-1,${q(ids.owner)});
insert into public.benefit_ledger(organization_id,instrument_id,event_type,visits_delta,amount_balance_rub,visits_balance,actor_id)
values(${q(ids.organization)},${q(ids.instrument)},'issued',5,0,5,${q(ids.owner)}),(${q(ids.organization)},${q(ids.expired)},'issued',2,0,2,${q(ids.owner)});
`);

await asActor(ids.owner, async () => {
  const first = await scalar(`select public.get_minuta_benefit_lifecycle_v150(${q(ids.organization)},${q(ids.client)}) value`);
  const parsedFirst = typeof first === 'string' ? JSON.parse(first) : first;
  assert.equal(parsedFirst.instruments.find(item => item.id === ids.expired).status, 'expired');
  assert.equal(await scalar(`select count(*)::int value from public.benefit_ledger where instrument_id=${q(ids.expired)} and event_type='expired'`), 1);

  const frozen = await scalar(`select public.set_minuta_benefit_lifecycle_v150(${q(ids.organization)},${q(ids.instrument)},'freeze','Отпуск',${q(ids.freeze)}) value`);
  const parsedFrozen = typeof frozen === 'string' ? JSON.parse(frozen) : frozen;
  assert.equal(parsedFrozen.status, 'frozen');
  assert.equal(parsedFrozen.replayed, false);
  assert.equal(await scalar(`select status value from public.client_benefit_instruments where id=${q(ids.instrument)}`), 'frozen');
  assert.equal(await scalar(`select freeze_reason value from public.benefit_freeze_periods where instrument_id=${q(ids.instrument)} and thawed_at is null`), 'Отпуск');
});

await db.exec(`update public.benefit_freeze_periods set frozen_at=now()-interval '3 days' where instrument_id=${q(ids.instrument)} and thawed_at is null`);
await asActor(ids.owner, async () => {
  const thawed = await scalar(`select public.set_minuta_benefit_lifecycle_v150(${q(ids.organization)},${q(ids.instrument)},'unfreeze','Возвращение',${q(ids.unfreeze)}) value`);
  const parsedThawed = typeof thawed === 'string' ? JSON.parse(thawed) : thawed;
  assert.equal(parsedThawed.status, 'active');
  assert.equal(parsedThawed.extended_days, 3);
  assert.equal(await scalar(`select expires_on=pg_catalog.timezone('Europe/Samara',clock_timestamp())::date+13 value from public.client_benefit_instruments where id=${q(ids.instrument)}`), true);
  assert.equal(await scalar(`select close_kind value from public.benefit_freeze_periods where instrument_id=${q(ids.instrument)}`), 'unfrozen');

  const replay = await scalar(`select public.set_minuta_benefit_lifecycle_v150(${q(ids.organization)},${q(ids.instrument)},'unfreeze','Возвращение',${q(ids.unfreeze)}) value`);
  const parsedReplay = typeof replay === 'string' ? JSON.parse(replay) : replay;
  assert.equal(parsedReplay.replayed, true);
  assert.equal(await scalar(`select count(*)::int value from public.benefit_ledger where instrument_id=${q(ids.instrument)} and event_type='activated'`), 1);
  await assert.rejects(
    scalar(`select public.set_minuta_benefit_lifecycle_v150(${q(ids.organization)},${q(ids.instrument)},'unfreeze','',gen_random_uuid()) value`),
    /invalid_benefit_status_transition/
  );
});

await db.exec(`insert into public.benefit_redemptions(organization_id,instrument_id,booking_id,status) values(${q(ids.organization)},${q(ids.instrument)},${q(ids.booking)},'reserved')`);
await asActor(ids.owner, async () => {
  await assert.rejects(
    scalar(`select public.set_minuta_benefit_lifecycle_v150(${q(ids.organization)},${q(ids.instrument)},'freeze','',${q(ids.blockedFreeze)}) value`),
    /release_reserved_benefits_before_freeze/
  );
});
await db.exec(`delete from public.benefit_redemptions where instrument_id=${q(ids.instrument)}`);

await asActor(ids.owner, async () => {
  await scalar(`select public.set_minuta_benefit_lifecycle_v150(${q(ids.organization)},${q(ids.instrument)},'freeze','Повторная пауза',gen_random_uuid()) value`);
  const cancelled = await scalar(`select public.set_minuta_benefit_status(${q(ids.organization)},${q(ids.instrument)},'cancelled') value`);
  const parsedCancelled = typeof cancelled === 'string' ? JSON.parse(cancelled) : cancelled;
  assert.equal(parsedCancelled.status, 'cancelled');
  assert.equal(await scalar(`select close_kind value from public.benefit_freeze_periods where instrument_id=${q(ids.instrument)} order by frozen_at desc limit 1`), 'cancelled');

  const finalState = await scalar(`select public.get_minuta_benefit_lifecycle_v150(${q(ids.organization)},${q(ids.client)}) value`);
  const parsedFinal = typeof finalState === 'string' ? JSON.parse(finalState) : finalState;
  const instrument = parsedFinal.instruments.find(item => item.id === ids.instrument);
  assert.equal(instrument.status, 'cancelled');
  assert.deepEqual(instrument.allowed_actions, []);
  assert.ok(instrument.history.length >= 5);
  assert.equal(instrument.history.some(event => event.event_type === 'activated' && event.actor_name === 'Владелец'), true);
});

await assert.rejects(
  asActor(ids.outsider, () => scalar(`select public.get_minuta_benefit_lifecycle_v150(${q(ids.organization)},${q(ids.client)}) value`)),
  /benefit_management_denied/
);

assert.equal(await scalar(`select count(*)::int value from public.benefit_lifecycle_requests where organization_id=${q(ids.organization)} and request_id=${q(ids.unfreeze)}`), 1);
assert.equal(await scalar(`select count(*)::int value from public.benefit_ledger where instrument_id=${q(ids.expired)} and event_type='expired'`), 1);

const statusStamp = await scalar("select obj_description('public.set_minuta_benefit_status(uuid,uuid,text)'::regprocedure::oid,'pg_proc') value");
await db.exec("comment on function public.set_minuta_benefit_status(uuid,uuid,text) is 'minuta_benefit_lifecycle_compatibility_v151'");
await assert.rejects(db.exec(rollback), /v150_rollback_blocked_unexpected_function_version/);
await db.exec('rollback');
assert.equal(await scalar("select to_regprocedure('public.set_minuta_benefit_lifecycle_v150(uuid,uuid,text,text,uuid)') is not null value"), true);
await db.exec(`comment on function public.set_minuta_benefit_status(uuid,uuid,text) is ${q(statusStamp)}`);
const constraintStamp = await scalar("select obj_description(oid,'pg_constraint') value from pg_catalog.pg_constraint where conrelid='public.benefit_ledger'::regclass and conname='benefit_ledger_event_type_check'");
await db.exec("comment on constraint benefit_ledger_event_type_check on public.benefit_ledger is 'minuta_benefit_lifecycle_v151:sha256=future'");
await assert.rejects(db.exec(rollback), /v150_rollback_blocked_unexpected_constraint_version/);
await db.exec('rollback');
await db.exec(`comment on constraint benefit_ledger_event_type_check on public.benefit_ledger is ${q(constraintStamp)}`);
await db.exec("delete from public.benefit_lifecycle_requests; delete from public.benefit_ledger where event_type='expired'");
await assert.rejects(db.exec(rollback), /v150_rollback_blocked_freeze_history_exists/);
await db.exec('rollback');
assert.equal(await scalar("select to_regclass('public.benefit_freeze_periods') is not null value"), true);

// A rollback is allowed only after this isolated fixture removes every v150
// history row it created. The v149 idempotent application contract must survive
// both the rollback and the following reapply.
await db.exec('delete from public.benefit_freeze_periods');
await db.exec(rollback);
assert.equal(await scalar("select to_regclass('public.benefit_freeze_periods') is null value"), true);
assert.equal(await scalar("select to_regprocedure('public.set_minuta_benefit_lifecycle_v150(uuid,uuid,text,text,uuid)') is null value"), true);
assert.equal(await scalar(`select pg_get_functiondef('public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid)'::regprocedure)=${q(v149Definition)} value`), true);
await db.exec(migration);
assert.equal(await scalar("select to_regclass('public.benefit_freeze_periods') is not null value"), true);
assert.equal(await scalar("select to_regprocedure('public.set_minuta_benefit_lifecycle_v150(uuid,uuid,text,text,uuid)') is not null value"), true);
assert.equal(await scalar(`select pg_get_functiondef('public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid)'::regprocedure)=${q(v149Definition)} value`), true);

console.log('PASS: benefit lifecycle v150 state transitions, expiry, idempotency and history');
await db.close();
