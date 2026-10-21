// In-memory PostgreSQL regression only. Fixture Auth/digest do not qualify native Auth or crypto.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const spec=process.env.MINUTA_PGLITE_MODULE||'@electric-sql/pglite';
const {PGlite}=await import(/^[A-Za-z]:[\\/]/.test(spec)?pathToFileURL(spec).href:spec);
const db=new PGlite();
const read=n=>readFileSync(new URL('../'+n,import.meta.url),'utf8').replaceAll('\r\n','\n');
const extract=(sql,name)=>{const start=sql.indexOf('create or replace function public.'+name+'(');assert.ok(start>=0);return sql.slice(start,sql.indexOf('\n$$;',start)+4);};
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]||{})[0];
const rejected=async(sql,args,pattern)=>assert.rejects(()=>db.query(sql,args),e=>pattern.test(e.message));
const owner='91000000-0000-4000-8000-000000000001',staff='91000000-0000-4000-8000-000000000002';
const org='92000000-0000-4000-8000-000000000001';
const request=()=>crypto.randomUUID();
const forward=read('scripts/manual-expense-business-date-forward.sql'),rollback=read('scripts/manual-expense-business-date-rollback.sql');
const schema=read('supabase-migration-v163.sql');
const snapshot=async()=>{const role=await scalar('select current_user');assert.ok(['postgres','authenticated','anon'].includes(role));await db.exec('reset role');try{return JSON.stringify((await db.query(`select
 (select jsonb_agg(to_jsonb(t) order by id) from public.financial_transactions t) transactions,
 (select jsonb_agg(to_jsonb(t) order by id) from public.financial_postings t) postings,
 (select jsonb_agg(to_jsonb(t) order by id) from public.financial_manual_expenses_v163 t) manual`)).rows);}finally{await db.exec('set role '+role);}};
const groups=[];
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions;
    create function extensions.digest(data bytea,kind text) returns bytea language sql immutable as $$select decode(md5(encode(data,'hex'))||md5(encode(data,'hex')||kind),'hex')$$;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    create table auth.users(id uuid primary key);
    create table public.organizations(id uuid primary key,status text not null default 'active');
    create table public.organization_memberships(organization_id uuid references public.organizations,user_id uuid references auth.users,role text,active boolean,primary key(organization_id,user_id));
    create function public.has_organization_role(p_organization uuid,p_roles text[]) returns boolean language sql stable security definer set search_path to '' as $$select exists(select 1 from public.organization_memberships where organization_id=p_organization and user_id=auth.uid() and active and role=any(p_roles))$$;
    create table public.locations(id uuid default gen_random_uuid(),organization_id uuid,timezone text,active boolean,is_primary boolean);
    create table public.bookings(id uuid primary key,organization_id uuid,performer_id uuid,booking_date date,status text);
    create table public.booking_outcomes(booking_id uuid primary key,performer_id uuid,visit_status text,payment_method text,amount_rub integer,completion_source text,updated_at timestamptz);
    create table public.payments(id uuid primary key default gen_random_uuid(),booking_id uuid,status text);
    create table public.payment_provider_attempts(id uuid primary key default gen_random_uuid(),organization_id uuid,booking_id uuid,captured_amount_minor bigint default 0);
    insert into auth.users values('${owner}'),('${staff}');
    insert into public.organizations(id) values('${org}');
    insert into public.organization_memberships values('${org}','${owner}','owner',true),('${org}','${staff}','specialist',true);
    insert into public.locations(organization_id,timezone,active,is_primary) values('${org}','Europe/Samara',true,true);
  `);
  await db.exec(read('supabase-migration-v129.sql'));
  await db.exec(read('supabase-migration-v132.sql'));
  for(const table of ['organization_finance_categories_v163','financial_manual_expenses_v163']) {
    const ddl=schema.match(new RegExp('create table public\\.'+table+' \\([\\s\\S]*?\\n\\);'))?.[0];assert.ok(ddl,table);await db.exec(ddl);
  }
  await db.exec(extract(schema,'record_minuta_manual_expense_v163'));
  await db.exec('grant select on public.financial_manual_expenses_v163 to authenticated');
  const recordSignature='public.record_minuta_manual_expense_v163(uuid,uuid,text,text,bigint,uuid,date,uuid,uuid)';
  const oldSignature='public.pay_minuta_supplier_expense_v132(uuid,uuid,uuid,uuid)';
  const newSignature='public.pay_minuta_supplier_expense_on_v163(uuid,uuid,uuid,uuid,timestamptz)';
  const originalRecord=await scalar('select pg_get_functiondef($1::regprocedure)',[recordSignature]);
  const originalPay=await scalar('select pg_get_functiondef($1::regprocedure)',[oldSignature]);
  await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false);set role authenticated;`);
  await scalar('select public.set_minuta_finance_enabled_v132($1,true)',[org]);
  const cash=(await scalar('select public.create_minuta_financial_account_v129($1,$2,$3,$4)',[org,request(),'Regression cash','cash'])).id;
  await db.exec('reset role');
  const category=await scalar(`insert into public.organization_finance_categories_v163(organization_id,system_key,name,created_by) values($1,'materials','Materials',$2) returning id`,[org,owner]);
  const save='select public.record_minuta_manual_expense_v163($1,$2,$3,$4,$5,$6,$7,$8,$9)';
  const args=(amount,date,performer=staff,id=request())=>[org,category,'QA date source','QA date expense',amount,cash,date,performer,id];
  await db.exec('set role authenticated');
  const legacy=await scalar(save,args(2100,'2020-08-13'));
  assert.equal(await scalar("select (occurred_at at time zone 'Europe/Samara')::date::text from public.financial_manual_expenses_v163 where id=$1",[legacy.id]),'2020-08-13');
  assert.notEqual(await scalar("select (occurred_at at time zone 'Europe/Samara')::date::text from public.financial_transactions where id=$1",[legacy.payment_transaction_id]),'2020-08-13');
  groups.push('reproduced legacy metadata/ledger date mismatch');
  await db.exec('reset role');const before=await snapshot();await db.exec(forward);await db.exec(forward);assert.equal(await snapshot(),before);
  assert.equal(await scalar('select pg_get_functiondef($1::regprocedure)',[oldSignature]),originalPay);
  for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar('select has_function_privilege($1,$2,\'execute\')',[role,newSignature]),false);
  groups.push('additive apply/reapply preserves rows, old API and internal-only helper');
  await db.exec('set role authenticated');
  const firstArgs=args(12000,'2020-08-13');const first=await scalar(save,firstArgs),second=await scalar(save,args(8000,'2020-08-13',null));
  for(const entry of [first,second]) {
    assert.equal(await scalar("select (occurred_at at time zone 'Europe/Samara')::date::text from public.financial_transactions where id=$1",[entry.payment_transaction_id]),'2020-08-13');
    assert.equal(Number(await scalar("select sum(case side when 'debit' then amount_minor else -amount_minor end) from public.financial_postings where transaction_id=$1",[entry.payment_transaction_id])),0);
  }
  assert.equal(Number(await scalar('select sum(amount_minor) from public.financial_manual_expenses_v163 where id=any($1::uuid[])',[ [first.id,second.id] ])),20000);
  assert.equal(await scalar('select performer_id from public.financial_manual_expenses_v163 where id=$1',[first.id]),staff);
  assert.equal(await scalar('select performer_id from public.financial_manual_expenses_v163 where id=$1',[second.id]),null);
  groups.push('selected date, balanced payment and staff/shared assignment');
  const posted=await snapshot();assert.equal((await scalar(save,firstArgs)).id,first.id);assert.equal(await snapshot(),posted);
  const changed=[...firstArgs];changed[6]='2020-08-14';await rejected(save,changed,/manual_expense_idempotency_conflict/);assert.equal(await snapshot(),posted);
  await rejected(`select public.pay_minuta_supplier_expense_on_v163($1,$2,$3,$4,$5)`,[org,first.expense_source_id,cash,request(),'2020-08-14T08:00Z'],/permission denied/);
  groups.push('same request replay, changed-date conflict and direct-helper denial');
  const future=args(1,'2999-01-01');await rejected(save,future,/manual_expense_future_date/);assert.equal(await snapshot(),posted);
  await db.exec(`reset role;select set_config('request.jwt.claim.sub','${staff}',false);set role authenticated;`);
  await rejected(save,args(1,'2020-08-13'),/financial_manager_role_required/);assert.equal(await snapshot(),posted);
  await db.exec(`reset role;select set_config('request.jwt.claim.sub','',false);set role anon;`);
  await rejected(save,args(1,'2020-08-13'),/financial_manager_role_required/);assert.equal(await snapshot(),posted);
  groups.push('future-date, specialist and anonymous rejection without rows');
  await db.exec(`reset role;select set_config('request.jwt.claim.sub','${owner}',false);update public.locations set timezone='Europe/London';set role authenticated;`);
  const dst=await scalar(save,args(100,'2020-03-29'));
  assert.equal(await scalar('select occurred_at::text from public.financial_transactions where id=$1',[dst.payment_transaction_id]),'2020-03-29 11:00:00+00');
  groups.push('organization timezone and DST noon retained');
  await db.exec('reset role');const populated=await snapshot();await db.exec(rollback);assert.equal(await snapshot(),populated);
  assert.equal(await scalar('select pg_get_functiondef($1::regprocedure)',[recordSignature]),originalRecord);
  assert.equal(await scalar('select to_regprocedure($1)',[newSignature]),null);
  await db.exec(forward);assert.equal(await snapshot(),populated);assert.equal(await scalar('select pg_get_functiondef($1::regprocedure)',[oldSignature]),originalPay);
  groups.push('populated rollback/reapply preserves all rows and restores exact original writer');
  console.log(JSON.stringify({status:'PASS',groups:groups.length,checks:groups,qualification:'local regression only; genuine native Auth and UI acceptance are separate'}));
} catch(error) {console.error(JSON.stringify({status:'FAIL',message:error.message,code:error.code,where:error.where?.slice(0,400)}));process.exitCode=1;} finally {await db.close();}
