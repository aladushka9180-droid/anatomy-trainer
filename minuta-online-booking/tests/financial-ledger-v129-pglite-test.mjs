import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const moduleName=process.env.MINUTA_PGLITE_MODULE||'@electric-sql/pglite';
const moduleSpecifier=/^[A-Za-z]:[\\/]/.test(moduleName)?pathToFileURL(moduleName).href:moduleName;
const {PGlite}=await import(moduleSpecifier);
const read=name=>readFileSync(new URL(`../${name}`,import.meta.url),'utf8').replace(/^\\set.*$/mg,'');
const migration=read('supabase-migration-v129.sql');
const rollback=read('supabase-migration-v129-rollback.sql');
const db=new PGlite();
const owner='10000000-0000-4000-8000-000000000001';
const outsider='10000000-0000-4000-8000-000000000002';
const org='20000000-0000-4000-8000-000000000001';
const booking='30000000-0000-4000-8000-000000000001';
const accountRequest='40000000-0000-4000-8000-000000000001';
const postRequest='40000000-0000-4000-8000-000000000002';
const reverseRequest='40000000-0000-4000-8000-000000000003';
const scalar=async sql=>Object.values((await db.query(sql)).rows[0]||{})[0];
const error=async(sql,message)=>assert.rejects(()=>db.exec(sql),value=>String(value?.message||value).includes(message));

try{
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions;
    create function extensions.digest(data bytea,kind text) returns bytea language sql immutable as $$
      select decode(md5(encode(data,'hex'))||md5(encode(data,'hex')||kind),'hex')
    $$;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    create table auth.users(id uuid primary key);
    create table public.organizations(id uuid primary key);
    create table public.organization_memberships(
      organization_id uuid not null references public.organizations(id),
      user_id uuid not null references auth.users(id),role text not null,active boolean not null,
      primary key(organization_id,user_id)
    );
    create function public.has_organization_role(p_organization uuid,p_roles text[]) returns boolean
      language sql stable security definer set search_path to '' as $$
        select exists(select 1 from public.organization_memberships
          where organization_id=p_organization and user_id=auth.uid() and active and role=any(p_roles))
      $$;
    create table public.bookings(
      id uuid primary key,organization_id uuid not null references public.organizations(id),
      status text not null,payment_status text not null,deposit_amount_rub integer not null
    );
    create table public.booking_outcomes(
      booking_id uuid primary key references public.bookings(id),visit_status text not null,
      payment_method text not null,amount_rub integer not null,calculated_amount_rub integer,
      completion_source text not null,updated_at timestamptz not null
    );
    create table public.payments(
      id uuid primary key default gen_random_uuid(),booking_id uuid not null references public.bookings(id),status text not null
    );
    create table public.payment_provider_attempts(
      id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
      booking_id uuid not null references public.bookings(id),captured_amount_minor bigint not null default 0
    );
    insert into auth.users values('${owner}'),('${outsider}');
    insert into public.organizations values('${org}');
    insert into public.organization_memberships values('${org}','${owner}','owner',true);
    insert into public.bookings values('${booking}','${org}','confirmed','not_required',0);
    insert into public.booking_outcomes values('${booking}','completed','cash',600,1000,'manual',now());
  `);
  await db.exec(migration);
  await db.exec(migration);

  await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false);set role authenticated;`);
  await db.exec(`select public.set_minuta_finance_enabled_v129('${org}',true)`);
  const account=await scalar(`select public.create_minuta_financial_account_v129(
    '${org}','${accountRequest}','Основная касса','cash')`);
  const replayedAccount=await scalar(`select public.create_minuta_financial_account_v129(
    '${org}','${accountRequest}','Основная касса','cash')`);
  assert.equal(account.id,replayedAccount.id);assert.equal(replayedAccount.replayed,true);
  await error(`select public.create_minuta_financial_account_v129(
    '${org}','${accountRequest}','Другая касса','cash')`,'financial_account_idempotency_conflict');

  const posted=await scalar(`select public.post_minuta_visit_finance_v129(
    '${org}','${booking}','${account.id}','${postRequest}')`);
  const replayed=await scalar(`select public.post_minuta_visit_finance_v129(
    '${org}','${booking}','${account.id}','${postRequest}')`);
  assert.equal(posted.id,replayed.id);assert.equal(replayed.replayed,true);
  assert.equal(Number(await scalar(`select sum(case side when 'debit' then amount_minor else -amount_minor end)
    from public.financial_postings where transaction_id='${posted.id}'`)),0);
  assert.equal(Number(await scalar(`select count(*) from public.financial_postings where transaction_id='${posted.id}'`)),3);
  const explanation=await scalar(`select explanation from public.financial_transactions where id='${posted.id}'`);
  assert.deepEqual([explanation.received_minor,explanation.debt_minor,explanation.service_value_minor],[60000,40000,100000]);
  assert.equal(Object.keys(explanation).some(key=>/client|phone|name/i.test(key)),false);

  const reversed=await scalar(`select public.reverse_minuta_financial_transaction_v129(
    '${org}','${posted.id}','${reverseRequest}','source_corrected')`);
  const reverseReplay=await scalar(`select public.reverse_minuta_financial_transaction_v129(
    '${org}','${posted.id}','${reverseRequest}','source_corrected')`);
  assert.equal(reversed.id,reverseReplay.id);assert.equal(reverseReplay.replayed,true);
  assert.equal(Number(await scalar(`select sum(case posting.side when 'debit' then posting.amount_minor else -posting.amount_minor end)
    from public.financial_postings posting join public.financial_transactions transaction_row
      on transaction_row.id=posting.transaction_id
    where transaction_row.id='${posted.id}' or transaction_row.reversal_of='${posted.id}'`)),0);

  await db.exec('reset role;');
  await db.exec(`update public.booking_outcomes set completion_source='auto',updated_at=now() where booking_id='${booking}'`);
  await db.exec('set role authenticated;');
  await error(`select public.post_minuta_visit_finance_v129('${org}','${booking}','${account.id}',gen_random_uuid())`,'manual_completion_required');
  await db.exec('reset role;');
  await db.exec(`update public.booking_outcomes set completion_source='manual',payment_method='card',updated_at=now() where booking_id='${booking}'`);
  await db.exec('set role authenticated;');
  await error(`select public.post_minuta_visit_finance_v129('${org}','${booking}','${account.id}',gen_random_uuid())`,'card_requires_provider_adapter');
  await db.exec('reset role;');
  await db.exec(`update public.booking_outcomes set payment_method='cash',amount_rub=1001,updated_at=now() where booking_id='${booking}'`);
  await db.exec('set role authenticated;');
  await error(`select public.post_minuta_visit_finance_v129('${org}','${booking}','${account.id}',gen_random_uuid())`,'overpayment_requires_advance_account');
  await db.exec('reset role;');

  await db.exec(`select set_config('request.jwt.claim.sub','${outsider}',false);set role authenticated;`);
  assert.equal(await scalar(`select count(*) from public.financial_transactions where organization_id='${org}'`),0);
  await error(`select public.get_minuta_financial_workspace_v129('${org}')`,'financial_manager_role_required');
  await db.exec('reset role;');

  await error(rollback,'v129_rollback_disable_finance_first');
  await db.exec('rollback;');
  await db.exec(`set session_replication_role=replica;
    delete from public.financial_postings;delete from public.financial_transactions;
    delete from public.financial_accounts;delete from public.organization_finance_settings;
    set session_replication_role=origin;`);
  await db.exec(rollback);
  assert.equal(await scalar("select to_regclass('public.financial_transactions') is null"),true);
  await db.exec(migration);
  console.log('financial ledger v129 PGlite: apply/reapply, RLS, exact retry, balance, guards, reversal, rollback OK');
}finally{await db.close();}
