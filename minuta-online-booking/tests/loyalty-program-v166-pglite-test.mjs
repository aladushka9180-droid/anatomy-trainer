import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase-migration-v166.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase-migration-v166-operational-rollback.sql', import.meta.url), 'utf8');
const stateQuery = readFileSync(new URL('../scripts/loyalty-program-v166-state.sql', import.meta.url), 'utf8');
const db = new PGlite();
const q = async (text, params = []) => (await db.query(text, params)).rows;
const one = async (text, params = []) => (await q(text, params))[0];

const actor='00000000-0000-4000-8000-000000000001';
const org='00000000-0000-4000-8000-000000000010';
const foreignOrg='00000000-0000-4000-8000-000000000011';
const client='00000000-0000-4000-8000-000000000020';
const client2='00000000-0000-4000-8000-000000000021';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema extensions;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create table public.organizations(id uuid primary key,status text not null default 'active');
    create table public.organization_memberships(organization_id uuid,user_id uuid,role text,active boolean not null default true);
    create table public.client_accounts(id uuid primary key);
    create table public.bookings(
      id uuid primary key,organization_id uuid,client_account_id uuid,status text not null default 'active',
      booking_date date not null,booking_time time not null,client_name text,client_phone text,created_at timestamptz not null default now()
    );
    create table public.booking_outcomes(booking_id uuid primary key,visit_status text not null default 'scheduled');
    create function public.resolve_client_identity_session_v155(p_token text)
    returns table(session_id uuid,client_account_id uuid,session_scope text,claimed_booking_id uuid,organization_id uuid)
    language sql stable as $$
      select case when p_token in ('good','foreign') then '00000000-0000-4000-8000-000000000099'::uuid end,
        case when p_token='good' then '${client}'::uuid when p_token='foreign' then '${client2}'::uuid end,
        'organization'::text,null::uuid,
        case when p_token='good' then '${org}'::uuid when p_token='foreign' then '${foreignOrg}'::uuid end
    $$;
    create function public.resolve_client_session(p_token text) returns table(client_account_id uuid)
    language sql stable as $$select null::uuid where false$$;
    insert into auth.users values('${actor}');
    insert into organizations(id) values('${org}'),('${foreignOrg}');
    insert into organization_memberships values('${org}','${actor}','owner',true);
    insert into client_accounts values('${client}'),('${client2}');
    select set_config('test.uid','${actor}',false);
  `);
  await db.exec(migration);
  let releaseState=Object.values(await one(stateQuery))[0];
  assert.equal(releaseState.classification,'exact','Release state recognizes the exact applied schema');
  assert.equal(releaseState.authenticatedDirectSettings,false,'Release state proves direct tables stay private');

  const enabled = await one(`select public.set_minuta_loyalty_program_v166(
    '${org}',true,2,'percent',1000,'Скидка 10%','На одну услугу',30,'${id(100)}'
  ) value`);
  assert.equal(enabled.value.enabled,true);
  const recovered = await one(`select public.set_minuta_loyalty_program_v166(
    '${org}',true,2,'percent',1000,'Скидка 10%','На одну услугу',30,'${id(100)}'
  ) value`);
  assert.equal(recovered.value.recovered,true,'Settings retry recovers the original request');

  async function booking(number,{ account=client,status='active',visit='completed',date='2026-09-19' }={}) {
    const bookingId=id(200+number);
    await q(`insert into bookings(id,organization_id,client_account_id,status,booking_date,booking_time,client_name,client_phone)
      values($1,$2,$3,$4,$5,'10:00','Ирина','79990000000')`,[bookingId,org,account,status,date]);
    await q('insert into booking_outcomes(booking_id,visit_status) values($1,$2)',[bookingId,visit]);
    return bookingId;
  }

  const first=await booking(1);
  let workspace=(await one(`select public.get_minuta_loyalty_program_workspace_v166('${org}') value`)).value;
  assert.equal(workspace.accounts[0].progress,1,'First completed visit counts once');
  await q(`update booking_outcomes set visit_status='completed' where booking_id=$1`,[first]);
  workspace=(await one(`select public.get_minuta_loyalty_program_workspace_v166('${org}') value`)).value;
  assert.equal(workspace.accounts[0].progress,1,'Duplicate completion event is idempotent');

  await booking(2,{visit:'no_show'});
  await booking(3,{date:'2036-09-19'});
  await booking(4,{status:'cancelled'});
  workspace=(await one(`select public.get_minuta_loyalty_program_workspace_v166('${org}') value`)).value;
  assert.equal(workspace.accounts[0].progress,1,'No-show, future and cancelled bookings do not count');

  const threshold=await booking(5);
  workspace=(await one(`select public.get_minuta_loyalty_program_workspace_v166('${org}') value`)).value;
  assert.equal(workspace.rewards.length,1,'Goal issues one reward');
  assert.equal(workspace.accounts[0].progress,0,'A new cycle starts at zero');
  await q(`update booking_outcomes set visit_status='completed' where booking_id=$1`,[threshold]);
  workspace=(await one(`select public.get_minuta_loyalty_program_workspace_v166('${org}') value`)).value;
  assert.equal(workspace.rewards.length,1,'Repeated threshold event never duplicates reward');

  const reward=workspace.rewards[0];
  const redemptionRequest=id(101);
  let redemption=(await one(`select public.redeem_minuta_loyalty_reward_v166(
    '${org}','${reward.id}',null,'Подтверждено мастером','${redemptionRequest}'
  ) value`)).value;
  assert.equal(redemption.status,'redeemed');
  redemption=(await one(`select public.redeem_minuta_loyalty_reward_v166(
    '${org}','${reward.id}',null,'Подтверждено мастером','${redemptionRequest}'
  ) value`)).value;
  assert.equal(redemption.recovered,true,'Redemption retry is idempotent');

  await booking(6);
  const reversed=await booking(7);
  await q(`update booking_outcomes set visit_status='no_show' where booking_id=$1`,[reversed]);
  workspace=(await one(`select public.get_minuta_loyalty_program_workspace_v166('${org}') value`)).value;
  assert.ok(workspace.rewards.some(row=>row.status==='voided'),'Reversing a qualifying visit voids an unused reward');
  assert.equal(workspace.accounts[0].progress,1,'A voided threshold restores the unfinished cycle');
  assert.ok(workspace.history.some(row=>row.event_type==='visit_reversed'),'Reversal is retained in history');

  const adjustment=(await one(`select public.adjust_minuta_loyalty_progress_v166(
    '${org}','${client}',1,'Исправление истории','${id(102)}'
  ) value`)).value;
  assert.ok(adjustment.reward_id,'A reasoned adjustment can safely re-earn the voided cycle');
  workspace=(await one(`select public.get_minuta_loyalty_program_workspace_v166('${org}') value`)).value;
  assert.equal(workspace.rewards.filter(row=>row.status==='pending').length,1,'Re-earned reward reuses the original entitlement without duplication');

  await booking(8,{account:client2});
  const client2Threshold=await booking(9,{account:client2});
  workspace=(await one(`select public.get_minuta_loyalty_program_workspace_v166('${org}') value`)).value;
  const client2Reward=workspace.rewards.find(row=>row.client_account_id===client2 && row.status==='pending');
  await one(`select public.redeem_minuta_loyalty_reward_v166(
    '${org}','${client2Reward.id}',null,'Подтверждено мастером','${id(103)}'
  ) value`);
  await q(`update booking_outcomes set visit_status='no_show' where booking_id=$1`,[client2Threshold]);
  const debt=await one(`select manual_progress from loyalty_program_accounts_v166 where organization_id='${org}' and client_account_id='${client2}'`);
  assert.equal(debt.manual_progress,-1,'A reversed source of a consumed reward becomes one-visit debt instead of erasing history');
  await booking(10,{account:client2});
  await booking(11,{account:client2});
  workspace=(await one(`select public.get_minuta_loyalty_program_workspace_v166('${org}') value`)).value;
  assert.equal(workspace.accounts.find(row=>row.client_account_id===client2).progress,1,'Debt is hidden from the client and delays the next threshold');
  await booking(12,{account:client2});
  workspace=(await one(`select public.get_minuta_loyalty_program_workspace_v166('${org}') value`)).value;
  assert.equal(workspace.rewards.filter(row=>row.client_account_id===client2 && row.status==='pending').length,1,'The next reward needs one replacement visit after a redeemed reversal');

  const contract=(await one(`select public.get_client_loyalty_program_v166('good','${org}') value`)).value;
  assert.ok(['progress','available','used','expired'].includes(contract.state));
  assert.equal(contract.organization_id,org);
  assert.equal(Object.hasOwn(contract,'crm_status'),false,'Client contract never exposes internal CRM status');
  await assert.rejects(()=>q(`select public.get_client_loyalty_program_v166('foreign','${org}')`),/client_loyalty_access_denied/);

  const privileges=await one(`select
    has_table_privilege('authenticated','public.loyalty_program_rewards_v166','select') direct_rewards,
    has_function_privilege('anon','public.get_client_loyalty_program_v166(text,uuid)','execute') client_rpc`);
  assert.equal(privileges.direct_rewards,false,'Authenticated clients cannot read reward tables directly');
  assert.equal(privileges.client_rpc,true,'Client can only use the scoped RPC');

  await db.exec(rollback);
  releaseState=Object.values(await one(stateQuery))[0];
  assert.equal(releaseState.classification,'disabled','Release state recognizes the data-preserving operational rollback');
  const preserved=await one(`select
    (select count(*) from loyalty_program_history_v166) history_count,
    (select count(*) from loyalty_program_rewards_v166) reward_count,
    (select bool_and(not enabled) from loyalty_program_settings_v166) disabled`);
  assert.ok(Number(preserved.history_count)>0 && Number(preserved.reward_count)>0);
  assert.equal(preserved.disabled,true,'Operational rollback disables accrual but preserves data');
  const triggers=await one(`select count(*)::int count from pg_trigger where tgname in('booking_outcomes_loyalty_program_v166','bookings_loyalty_program_v166') and not tgisinternal`);
  assert.equal(triggers.count,0,'Operational rollback removes automatic writers');

  console.log('loyalty program v166 pglite: PASS');
} finally {
  await db.close();
}
