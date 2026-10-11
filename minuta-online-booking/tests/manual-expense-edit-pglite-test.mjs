import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const moduleName = process.env.MINUTA_PGLITE_MODULE || '@electric-sql/pglite';
const { PGlite } = await import(/^[A-Za-z]:[\\/]/.test(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const db = new PGlite();
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8').replace(/^\\set.*$/mg, '');
const owner = '10000000-0000-4000-8000-000000000001', outsider = '10000000-0000-4000-8000-000000000002';
const org = '20000000-0000-4000-8000-000000000001', org2 = '20000000-0000-4000-8000-000000000002';
const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const fails = async (sql, args, message) => assert.rejects(() => db.query(sql, args), error => String(error.message).includes(message));
const uuid = async () => scalar('select gen_random_uuid()');
const v163 = read('supabase-migration-v163.sql');
function actualFunction(name) {
  const start = v163.indexOf(`create or replace function public.${name}(`);
  assert(start >= 0, name);
  return v163.slice(start, v163.indexOf('\n$$;', start) + 4);
}
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions;
    create function extensions.digest(data bytea,kind text) returns bytea language sql immutable as $$
      select decode(md5(encode(data,'hex'))||md5(encode(data,'hex')||kind),'hex') $$;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    create table auth.users(id uuid primary key);
    create table public.organizations(id uuid primary key,status text not null default 'active');
    create table public.organization_memberships(organization_id uuid references public.organizations(id),
      user_id uuid references auth.users(id),role text not null,active boolean not null,primary key(organization_id,user_id));
    create function public.has_organization_role(p_organization uuid,p_roles text[]) returns boolean
      language sql stable security definer set search_path to '' as $$
      select exists(select 1 from public.organization_memberships where organization_id=p_organization
        and user_id=auth.uid() and active and role=any(p_roles)) $$;
    create table public.bookings(id uuid primary key,organization_id uuid references public.organizations(id),
      status text not null,payment_status text not null,deposit_amount_rub integer not null);
    create table public.booking_outcomes(booking_id uuid primary key references public.bookings(id),visit_status text not null,
      payment_method text not null,amount_rub integer not null,calculated_amount_rub integer,completion_source text not null,updated_at timestamptz not null);
    create table public.payments(id uuid primary key default gen_random_uuid(),booking_id uuid references public.bookings(id),status text not null);
    create table public.payment_provider_attempts(id uuid primary key default gen_random_uuid(),organization_id uuid references public.organizations(id),
      booking_id uuid references public.bookings(id),captured_amount_minor bigint not null default 0);
    create table public.locations(id uuid primary key default gen_random_uuid(),organization_id uuid references public.organizations(id),
      timezone text not null,active boolean not null default true,is_primary boolean not null default true);
    insert into auth.users values('${owner}'),('${outsider}');
    insert into public.organizations(id) values('${org}'),('${org2}');
    insert into public.organization_memberships values('${org}','${owner}','owner',true),('${org2}','${outsider}','owner',true);
    insert into public.locations(organization_id,timezone) values('${org}','Europe/Samara'),('${org2}','Europe/Samara');
  `);
  await db.exec(read('supabase-migration-v129.sql'));
  await db.exec(read('supabase-migration-v132.sql'));
  await db.exec(`
    alter table public.bookings add column booking_date date,add column booking_time time,
      add column performer_id uuid,add column service_id uuid;
    create table public.services(id uuid primary key,name text);
    create table public.financial_debt_settlement_sources(id uuid primary key,organization_id uuid,
      visit_transaction_id uuid,gross_minor bigint,commission_minor bigint);
    create table public.commercial_sales(id uuid primary key,organization_id uuid,seller_id uuid);
    create table public.commercial_sale_refunds(id uuid primary key,organization_id uuid,sale_id uuid);
    create table public.commercial_sale_lines(id uuid primary key,sale_id uuid,item_name text);
    create table public.recurring_expense_occurrences(id uuid primary key,organization_id uuid,expense_source_id uuid,rule_id uuid);
    create table public.organization_recurring_expenses(id uuid primary key,organization_id uuid,name text);
    create table public.financial_payroll_payment_sources(id uuid primary key,organization_id uuid,performer_id uuid);
  `);
  const tablesStart = v163.indexOf('create table public.organization_finance_categories_v163');
  const tablesEnd = v163.indexOf('create or replace function public.seed_minuta_finance_categories_v163');
  await db.exec(v163.slice(tablesStart, tablesEnd));
  for (const name of ['seed_minuta_finance_categories_v163','initialize_minuta_finance_screen_v163',
    'record_minuta_manual_expense_v163','reverse_minuta_manual_expense_v163','minuta_finance_event_rows_v163']) await db.exec(actualFunction(name));
  const candidate = read('scripts/manual-expense-edit-candidate.sql');
  await db.exec(candidate);
  await db.exec(read('scripts/manual-expense-edit-candidate-rollback.sql'));
  await db.exec(candidate);
  await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false);set role authenticated;`);
  await scalar('select public.set_minuta_finance_enabled_v129($1,true)', [org]);
  await scalar('select public.initialize_minuta_finance_screen_v163($1)', [org]);
  const accountResult = await scalar('select public.create_minuta_financial_account_v129($1,$2,$3,$4)', [org, await uuid(), 'Касса', 'cash']);
  const account = accountResult.id;
  await db.exec('reset role');
  const rent = await scalar("select id from public.organization_finance_categories_v163 where organization_id=$1 and system_key='rent'", [org]);
  const today = await scalar("select timezone('Europe/Samara',now())::date::text");
  const yesterday = await scalar("select (timezone('Europe/Samara',now())::date-1)::text");
  const originalDate = await scalar("select (timezone('Europe/Samara',now())::date-2)::text");
  await db.exec('set role authenticated');
  const original = await scalar('select public.record_minuta_manual_expense_v163($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [org, rent, 'Аренда', 'Аренда', 1800000, account, originalDate, owner, await uuid()]);
  const editSql = 'select public.edit_minuta_manual_expense_v1($1,$2,$3,$4,$5,$6,$7,$8)';
  const request = await uuid(), args = [org, original.id, rent, account, 2000000, yesterday, 'Исправленная сумма', request];
  const cash = async () => {
    await db.exec('reset role');
    const amount = await scalar("select coalesce(sum(case side when 'credit' then amount_minor else -amount_minor end),0)::bigint from public.financial_postings where account_id=$1", [account]);
    await db.exec('set role authenticated'); return Number(amount);
  };
  assert.equal(await cash(), 1800000);
  await fails(editSql, [org, original.id, await uuid(), account, 2000000, yesterday, '', await uuid()], 'active_finance_category_not_found');
  assert.equal(await cash(), 1800000);
  const edited = await scalar(editSql, args);
  assert.equal(edited.replayed, false);
  assert.equal(edited.original_id, original.id);
  assert.equal(await cash(), 2000000, 'one corrected expense, not original plus replacement');
  await db.exec('reset role');
  const count = Number(await scalar('select count(*) from public.financial_transactions'));
  assert.equal(Number(await scalar('select amount_minor from public.financial_manual_expenses_v163 where id=$1', [original.id])), 1800000, 'original history retained');
  assert.equal(await scalar('select performer_id::text from public.financial_manual_expenses_v163 where id=$1',[edited.id]),owner,'editing preserves the original performer');
  const perDay = (await db.query("select timezone('Europe/Samara',t.occurred_at)::date::text as business_day,sum(case p.side when 'credit' then p.amount_minor else -p.amount_minor end)::bigint as amount from public.financial_transactions t join public.financial_postings p on p.transaction_id=t.id where p.account_id=$1 group by 1", [account])).rows;
  assert.equal(Number(perDay.find(row => row.business_day === today)?.amount), 0, 'original business date cancelled');
  assert.equal(Number(perDay.find(row => row.business_day === yesterday)?.amount), 2000000, 'corrected business date used');
  const reportDays=(await db.query("select timezone('Europe/Samara',occurred_at)::date::text as business_day,-sum(flow_minor)::bigint as amount from public.minuta_finance_event_rows_v163($1,$2::date-interval '1 day',$3::date+interval '2 days',null) where source_kind='manual_expense' group by 1",[org,originalDate,today])).rows;
  assert.equal(Number(reportDays.find(row=>row.business_day===today)?.amount),0,'server report cancels original operation date');
  assert.equal(Number(reportDays.find(row=>row.business_day===yesterday)?.amount),2000000,'server report uses corrected date');
  assert.equal(Number(reportDays.find(row=>row.business_day===originalDate)?.amount||0),0,'server report leaves no old backdated amount');
  await db.exec('set role authenticated');
  assert.equal((await scalar(editSql, args)).id, edited.id);
  await fails(editSql, args.map((value, index) => index === 4 ? 2100000 : value), 'manual_expense_edit_request_conflict');
  const otherRequest = await uuid();
  await fails(editSql, args.map((value, index) => index === 7 ? otherRequest : value), 'manual_expense_edit_conflict');
  await db.exec('reset role');
  assert.equal(Number(await scalar('select count(*) from public.financial_transactions')), count, 'replay/stale version add no postings');
  await fails('update public.financial_manual_expense_edits_v1 set request_id=gen_random_uuid()', [], 'finance_screen_history_is_append_only');
  await db.exec(`select set_config('request.jwt.claim.sub','${outsider}',false);set role authenticated;`);
  await fails(editSql, args, 'financial_manager_role_required');
  assert.equal(Number(await scalar('select count(*) from public.financial_manual_expense_edits_v1')), 0, 'foreign organization sees no receipts');
  await db.exec(`reset role;select set_config('request.jwt.claim.sub','${owner}',false);`);
  await db.exec(`create function public.reject_fixture_edit() returns trigger language plpgsql as $$
    begin raise exception 'fixture_failure_after_postings';end $$;
    create trigger reject_fixture_edit before insert on public.financial_manual_expense_edits_v1
    for each row execute function public.reject_fixture_edit();set role authenticated;`);
  await fails(editSql, [org, edited.id, rent, account, 2500000, today, '', await uuid()], 'fixture_failure_after_postings');
  assert.equal(await cash(), 2000000, 'failed edit rolls back reversals and replacement');
  await db.exec('reset role');
  assert.equal(Number(await scalar('select count(*) from public.financial_transactions')), count);
  assert.equal(Number(await scalar('select count(*) from public.financial_manual_expense_edits_v1')), 1);
  await assert.rejects(()=>db.exec(read('scripts/manual-expense-edit-candidate-rollback.sql')), /manual_expense_edit_rollback_requires_preserved_history/);
  await db.exec('rollback');
  await db.exec('drop trigger reject_fixture_edit on public.financial_manual_expense_edits_v1;set role authenticated;');
  const bank=(await scalar('select public.create_minuta_financial_account_v129($1,$2,$3,$4)',[org,await uuid(),'Банк','bank'])).id;
  await db.exec('reset role');
  const materials=await scalar("select id from public.organization_finance_categories_v163 where organization_id=$1 and system_key='materials'",[org]);
  await db.exec('set role authenticated');
  const fullNote='Исправлен комментарий '+ 'а'.repeat(138);
  const changed=await scalar(editSql,[org,edited.id,materials,bank,2200000,yesterday,fullNote,await uuid()]);
  assert.equal(await cash(),0,'moving to bank cancels the previous cash debit');
  await db.exec('reset role');
  assert.equal(Number(await scalar("select sum(case side when 'credit' then amount_minor else -amount_minor end) from public.financial_postings where account_id=$1",[bank])),2200000);
  const saved=(await db.query('select category_id,title,performer_id from public.financial_manual_expenses_v163 where id=$1',[changed.id])).rows[0];
  assert.equal(saved.category_id,materials);assert.match(saved.title,/Исправлен комментарий/);assert.equal(saved.performer_id,owner);
  assert.equal(await scalar("select t.explanation->>'manual_expense_note' from public.financial_transactions t join public.financial_manual_expenses_v163 e on e.payment_transaction_id=t.id where e.id=$1",[changed.id]),fullNote,'the complete note is retained even when the display title is shortened');
  console.log('manual-expense-edit SQL PASS: net once, exact dates in both reports, category/account/note, original performer/history, replay, permissions, atomic failure, guarded rollback');
} catch (error) { console.error('manual-expense-edit SQL FAIL:', error.code || '', error.message); process.exitCode=1; }
finally { await db.close(); }
