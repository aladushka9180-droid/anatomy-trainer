import fs from 'node:fs';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
const pgliteModule = process.env.MINUTA_PGLITE_MODULE ? pathToFileURL(process.env.MINUTA_PGLITE_MODULE).href : '@electric-sql/pglite';
const { PGlite } = await import(pgliteModule);
const db=new PGlite();
const q=async(sql,params=[]) => (await db.query(sql,params)).rows;
const one=async(sql,params=[]) => (await q(sql,params))[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1), admin=id(2), specialist=id(3), outsider=id(4), inactive=id(5);
const org=id(10), foreignOrg=id(11), inactiveOrg=id(12), client=id(20), client2=id(21), historicalClient=id(22);
let seq=900;
const request=()=>id(seq++);
const checks=[];
async function rpc(name,params) { return (await one(`select public.${name}(${params.map((_,i)=>'$'+(i+1)).join(',')}) result`,params)).result; }
async function enable(goal=2,kind='percent',value=1000,title='Скидка 10%',validity=30) { return rpc('set_minuta_loyalty_program_v166',[org,true,goal,kind,value,title,'На одну услугу',validity,request()]); }
async function workspace() {return rpc('get_minuta_loyalty_program_workspace_v166',[org]);}
async function adjust(who,delta,req=request(),reason='Тестовая корректировка') {return rpc('adjust_minuta_loyalty_progress_v166',[org,who,delta,reason,req]);}
async function complete(booking) {await q("update booking_outcomes set visit_status='completed' where booking_id=$1",[booking]);}
async function actor(uid,role='authenticated') {await q("select set_config('test.uid',$1,true)",[uid||'']);await db.exec(`set local role ${role}`);}
async function denied(fn,pattern=/denied|owner_required|authentication_required|permission denied/) {
  await db.exec('savepoint denied_probe');
  let result,error;
  try {result=await fn();} catch(e) {error=e;}
  await db.exec('rollback to savepoint denied_probe');
  assert.ok(error,`Access was allowed; result=${JSON.stringify(result)}`);
  assert.match(String(error.message),pattern);
}
async function check(key,block,expected,fn) {
  await db.exec('begin');
  try {await q("select set_config('test.uid',$1,true)",[owner]);const evidence=await fn();checks.push({key,block,status:'PASS',expected,evidence:evidence??null});}
  catch(e) {checks.push({key,block,status:'FAIL',expected,actual:String(e.message)});}
  finally {await db.exec('rollback');}
}
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema extensions;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create table public.organizations(id uuid primary key,status text not null default 'active');
    create table public.organization_memberships(organization_id uuid,user_id uuid,role text,active boolean not null default true);
    create table public.client_accounts(id uuid primary key);
    create table public.bookings(id uuid primary key,organization_id uuid,client_account_id uuid,status text not null default 'active',booking_date date not null,booking_time time not null,client_name text,client_phone text,created_at timestamptz not null default now());
    create table public.booking_outcomes(booking_id uuid primary key,visit_status text not null default 'scheduled');
    create function public.resolve_client_identity_session_v155(p_token text) returns table(session_id uuid,client_account_id uuid,session_scope text,claimed_booking_id uuid,organization_id uuid)
    language sql stable as $$select '${id(90)}'::uuid,case when p_token='client-one' then '${client}'::uuid when p_token='client-two' then '${client2}'::uuid when p_token='foreign' then '${client}'::uuid end,'organization'::text,null::uuid,case when p_token='foreign' then '${foreignOrg}'::uuid else '${org}'::uuid end where p_token in ('client-one','client-two','foreign')$$;
    create function public.resolve_client_session(p_token text) returns table(client_account_id uuid) language sql stable as $$select null::uuid where false$$;
    insert into auth.users values('${owner}'),('${admin}'),('${specialist}'),('${outsider}'),('${inactive}');
    insert into organizations(id,status) values('${org}','active'),('${foreignOrg}','active'),('${inactiveOrg}','inactive');
    insert into organization_memberships values('${org}','${owner}','owner',true),('${org}','${admin}','admin',true),('${org}','${specialist}','specialist',true),('${org}','${inactive}','owner',false),('${foreignOrg}','${outsider}','owner',true),('${inactiveOrg}','${owner}','owner',true);
    insert into client_accounts values('${client}'),('${client2}'),('${historicalClient}');
    insert into bookings values('${id(100)}','${org}','${client}','active',current_date-2,'10:00','Синтетический клиент 1','synthetic-1',now()),('${id(101)}','${org}','${client}','active',current_date-2,'11:00','Синтетический клиент 1','synthetic-1',now()),('${id(102)}','${org}','${client2}','active',current_date-2,'12:00','Синтетический клиент 2','synthetic-2',now()),('${id(103)}','${org}','${historicalClient}','active',current_date-5,'10:00','Исторический тестовый клиент','synthetic-history',now());
    insert into booking_outcomes values('${id(100)}','scheduled'),('${id(101)}','scheduled'),('${id(102)}','scheduled'),('${id(103)}','completed');
    select set_config('test.uid','${owner}',false);
  `);
  await db.exec(fs.readFileSync(new URL('../supabase-migration-v166.sql',import.meta.url),'utf8'));
  const patch=fs.readFileSync(new URL('../../supabase/migrations/20261014230135_loyalty_audit_hardening.sql',import.meta.url),'utf8');
  await db.exec(patch);
  const version=await one('select version() version');
  await check('disabled-default',5,'Программа выключена до первого включения',async()=>assert.equal((await workspace()).enabled,false));
  await check('no-historical-backfill',2,'Включение не засчитывает старые завершённые визиты',async()=>{await enable();assert.equal((await workspace()).accounts.length,0);});
  await check('historical-event-replay',2,'Повтор сохранённого старого завершения не начисляет новый визит',async()=>{await enable();await complete(id(103));const w=await workspace();assert.equal(w.accounts.find(a=>a.client_account_id===historicalClient)?.progress||0,0);});
  await check('prebooked-new-completion',2,'Запись, созданная раньше включения, засчитывается при новом завершении',async()=>{await enable();await complete(id(100));assert.equal((await workspace()).accounts[0].progress,1);});
  await check('duplicate-completion',2,'Повторное завершение не дублирует прогресс',async()=>{await enable();await complete(id(100));await complete(id(100));assert.equal((await workspace()).accounts[0].progress,1);});
  await check('future-completion',2,'Будущий визит не учитывается',async()=>{await enable();await q('update bookings set booking_date=current_date+3 where id=$1',[id(100)]);await complete(id(100));assert.equal((await workspace()).accounts.length,0);});
  await check('cancelled-completion',2,'Отменённый визит не учитывается',async()=>{await enable();await q("update bookings set status='cancelled' where id=$1",[id(100)]);await complete(id(100));assert.equal((await workspace()).accounts.length,0);});
  await check('no-show',2,'Неявка не учитывается',async()=>{await enable();await q("update booking_outcomes set visit_status='no_show' where booking_id=$1",[id(100)]);assert.equal((await workspace()).accounts.length,0);});
  await check('rescheduled-counted-future',2,'Ранее засчитанный визит, перенесённый в будущее, перестаёт учитываться',async()=>{await enable();await complete(id(100));await q('update bookings set booking_date=current_date+3 where id=$1',[id(100)]);assert.equal((await workspace()).accounts[0].progress,0);});
  await check('threshold-one-reward-reset',3,'На цели одна награда и новый цикл с нулевым прогрессом',async()=>{await enable();await complete(id(100));await complete(id(101));const w=await workspace();assert.equal(w.rewards.length,1);assert.equal(w.accounts[0].progress,0);assert.equal(w.accounts[0].cycle_number,2);});
  await check('percentage-units',3,'1000 внутренних единиц означают скидку 10%',async()=>{await enable();const w=await workspace();assert.equal(w.rule.reward_value,1000);assert.equal(w.rule.reward_kind,'percent');});
  await check('fixed-text-unlimited',3,'Фиксированная и текстовая награды, отсутствие срока поддерживаются',async()=>{await enable(2,'fixed',250,'Скидка 250 ₽',null);await adjust(client,2);let w=await workspace();assert.equal(w.rewards[0].reward_value,250);assert.equal(w.rewards[0].expires_at,null);await enable(2,'text',null,'Дополнение к услуге',null);await adjust(client2,2);w=await workspace();assert.ok(w.rewards.some(r=>r.reward_kind==='text'&&r.reward_value===null));});
  await check('reversal-pending',3,'Отмена исходного визита отзывает неиспользованную награду',async()=>{await enable();await complete(id(100));await complete(id(101));await q("update booking_outcomes set visit_status='no_show' where booking_id=$1",[id(101)]);const w=await workspace();assert.equal(w.rewards[0].status,'voided');assert.equal(w.accounts[0].progress,1);});
  await check('redeem-idempotent',4,'Повтор исходного использования возвращает прежний результат',async()=>{await enable();await adjust(client,2);const reward=(await workspace()).rewards[0];const req=request();await rpc('redeem_minuta_loyalty_reward_v166',[org,reward.id,null,'Тестовое подтверждение',req]);assert.equal((await rpc('redeem_minuta_loyalty_reward_v166',[org,reward.id,null,'Тестовое подтверждение',req])).recovered,true);assert.equal((await workspace()).stats.redeemed,1);});
  await check('redeem-twice-new-request',4,'Использованную награду нельзя использовать новым запросом',async()=>{await enable();await adjust(client,2);const reward=(await workspace()).rewards[0];await rpc('redeem_minuta_loyalty_reward_v166',[org,reward.id,null,'Тестовое подтверждение',request()]);await denied(()=>rpc('redeem_minuta_loyalty_reward_v166',[org,reward.id,null,'Тестовое подтверждение',request()]),/not_available/);});
  await check('adjust-idempotent',4,'Повтор исходной корректировки не удваивает прогресс',async()=>{await enable(5);const req=request();await adjust(client,1,req);assert.equal((await adjust(client,1,req)).recovered,true);assert.equal((await workspace()).accounts[0].progress,1);});
  await check('adjust-request-conflict',4,'Один идентификатор нельзя переиспользовать с иной корректировкой',async()=>{await enable(5);const req=request();await adjust(client,1,req);await denied(()=>adjust(client,2,req),/request_conflict/);});
  for(const [key,delta,reason] of [['zero',0,'Причина'],['below-zero',-1,'Причина'],['above-goal',3,'Причина'],['over-limit',101,'Причина'],['short-reason',1,'А']]) await check('adjust-'+key,4,'Некорректная корректировка отклоняется',async()=>{await enable();await denied(()=>adjust(client,delta,request(),reason),/invalid_loyalty_progress/);});
  await check('rule-snapshot-and-next-cycle',5,'Текущий цикл сохраняет старые правила, следующий получает новые',async()=>{await enable();await complete(id(100));await enable(3,'fixed',250,'Скидка 250 ₽');let w=await workspace();assert.equal(w.accounts[0].goal_visits,2);assert.equal(w.rule.goal_visits,3);const c=await rpc('get_client_loyalty_program_v166',['client-one',org]);assert.equal(c.reward.value,1000);assert.equal(c.reward.title,'Скидка 10%');await complete(id(101));w=await workspace();assert.equal(w.rewards[0].reward_value,1000);assert.equal(w.accounts[0].goal_visits,3);});
  await check('disable-preserves',5,'Выключение сохраняет награды и историю и прекращает начисление',async()=>{await enable();await adjust(client,2);const before=await workspace();await rpc('set_minuta_loyalty_program_v166',[org,false,null,null,null,null,null,null,request()]);await complete(id(102));const after=await workspace();assert.equal(after.enabled,false);assert.equal(after.rewards.length,before.rewards.length);assert.equal(after.accounts.length,before.accounts.length);assert.ok(after.history.length>before.history.length);});
  for(const goal of [1,101]) await check('invalid-goal-'+goal,5,'Цель вне диапазона 2–100 отклоняется',async()=>denied(()=>enable(goal),/invalid_loyalty_program/));
  await check('admin-read',6,'Администратор может прочитать программу',async()=>{await enable();await actor(admin);assert.equal((await workspace()).current_role,'admin');});
  await check('admin-cannot-settings',6,'Настройки меняет только владелец',async()=>{await enable();await actor(admin);await denied(()=>enable(3),/owner_required/);});
  await check('specialist-denied',6,'Специалисту запрещён управляющий запрос',async()=>{await enable();await actor(specialist);await denied(()=>workspace());});
  await check('unauthenticated-denied',6,'Без пользователя управляющий запрос отклоняется',async()=>{await enable();await actor(null);await denied(()=>workspace());});
  await check('outsider-read-denied',6,'Пользователь без членства не читает чужую программу',async()=>{await enable();await actor(outsider);await denied(()=>workspace());});
  await check('outsider-settings-denied',6,'Пользователь без членства не меняет чужие настройки',async()=>{await enable();await actor(outsider);await denied(()=>enable(3));});
  await check('outsider-adjust-denied',6,'Пользователь без членства не корректирует чужой прогресс',async()=>{await enable();await actor(outsider);await denied(()=>adjust(client,1));});
  await check('outsider-redeem-denied',6,'Пользователь без членства не использует чужую награду',async()=>{await enable();await adjust(client,2);const reward=(await workspace()).rewards[0];await actor(outsider);await denied(()=>rpc('redeem_minuta_loyalty_reward_v166',[org,reward.id,null,'Тестовое подтверждение',request()]));});
  await check('inactive-membership-denied',6,'Неактивное членство не даёт доступа',async()=>{await enable();await actor(inactive);await denied(()=>workspace());});
  await check('inactive-organization-denied',6,'Неактивная организация недоступна',async()=>{await actor(owner);await denied(()=>rpc('get_minuta_loyalty_program_workspace_v166',[inactiveOrg]));});
  await check('direct-table-denied',6,'У authenticated нет прямого чтения таблиц наград',async()=>{await enable();await actor(owner);await denied(()=>q('select * from public.loyalty_program_rewards_v166'),/permission denied/);});
  await check('client-scoped-contract',6,'Клиентский контракт не раскрывает чужие награды и CRM-статус',async()=>{await enable();await adjust(client,2);const c=await rpc('get_client_loyalty_program_v166',['client-two',org]);assert.equal(c.reward.available,null);assert.equal(Object.hasOwn(c,'crm_status'),false);await denied(()=>rpc('get_client_loyalty_program_v166',['foreign',org]),/client_loyalty_access_denied/);await denied(()=>rpc('get_client_loyalty_program_v166',['invalid',org]),/client_loyalty_access_denied/);});
  await check('expiry-on-read-once',3,'Просроченная награда исчезает из доступных, история добавляется один раз',async()=>{await enable();await adjust(client,2);await q("update loyalty_program_rewards_v166 set expires_at=now()-interval '1 second'");let w=await workspace();assert.equal(w.rewards[0].status,'expired');assert.equal(w.history.filter(h=>h.event_type==='reward_expired').length,1);w=await workspace();assert.equal(w.history.filter(h=>h.event_type==='reward_expired').length,1);});
  await check('immutable-history',6,'История не изменяется задним числом',async()=>{await enable();await denied(()=>q("update loyalty_program_history_v166 set reason='Другой текст'"),/history_immutable/);});
  const pins=JSON.parse(fs.readFileSync(new URL('../recovery/loyalty-audit/source-pins.json',import.meta.url),'utf8'));
  const fingerprints=async()=>q("select p.proname name,md5(regexp_replace(p.prosrc,'[[:space:]]','','g')) hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any($1::text[]) order by p.proname",[pins.functions.map(f=>f.name)]);
  const rowSnapshot=async()=>q("select * from (select tableoid::regclass::text name,to_jsonb(t) row from public.loyalty_program_settings_v166 t union all select tableoid::regclass::text,to_jsonb(t) from public.loyalty_program_rules_v166 t union all select tableoid::regclass::text,to_jsonb(t) from public.loyalty_program_accounts_v166 t union all select tableoid::regclass::text,to_jsonb(t) from public.loyalty_program_visits_v166 t union all select tableoid::regclass::text,to_jsonb(t) from public.loyalty_program_rewards_v166 t union all select tableoid::regclass::text,to_jsonb(t) from public.loyalty_program_history_v166 t) snapshot order by name,row::text");
  await check('workspace-cycle-title',6,'Сервер возвращает название награды правил текущего цикла',async()=>{await enable();await complete(id(100));await enable(3,'fixed',250,'Скидка 250 ₽');const w=await workspace();assert.equal(w.accounts[0].reward_title,'Скидка 10%');assert.equal(w.rule.reward_title,'Скидка 250 ₽');});
  await check('status-edit-no-historical-backfill',2,'Изменение статуса старой записи не пересчитывает прежнее завершение',async()=>{await enable();await q("update bookings set status='confirmed' where id=$1",[id(103)]);assert.equal((await workspace()).accounts.length,0);});
  await check('date-restore-no-duplicate',2,'Обратный перенос восстанавливает исходный визит без дубля',async()=>{await enable();await complete(id(100));await q('update bookings set booking_date=current_date+3 where id=$1',[id(100)]);await q('update bookings set booking_date=current_date-2 where id=$1',[id(100)]);const w=await workspace();assert.equal(w.accounts[0].progress,1);assert.equal((await one('select count(*)::int n from loyalty_program_visits_v166')).n,1);});
  const before=await rowSnapshot();await db.exec(patch);assert.deepEqual(await rowSnapshot(),before,'Repeated patch preserves all rows');
  assert.ok((await fingerprints()).every(row=>pins.functions.find(f=>f.name===row.name).patched===row.hash),'Applied function bodies match source pins');
  await enable(5);await adjust(client,1);const seeded=await rowSnapshot();
  const exact=fs.readFileSync(new URL('../recovery/loyalty-audit/isolated-exact-rollback.sql',import.meta.url),'utf8');
  await assert.rejects(()=>db.exec(exact),/rollback_requires_isolated_test/);await db.exec('rollback');
  assert.deepEqual(await rowSnapshot(),seeded,'Denied rollback preserves all data');
  await q("select set_config('minuta.loyalty_audit_isolated_rollback','enabled',false)");await db.exec(exact);
  assert.ok((await fingerprints()).every(row=>pins.functions.find(f=>f.name===row.name).baseline===row.hash),'Exact isolated rollback restores baseline function bodies');
  assert.deepEqual(await rowSnapshot(),seeded,'Exact rollback preserves settings, accounts, visits, rewards and history');
  await db.exec(patch);assert.deepEqual(await rowSnapshot(),seeded,'Reapply preserves all rows');
  const hold=fs.readFileSync(new URL('../recovery/loyalty-audit/operational-hold.sql',import.meta.url),'utf8');await db.exec(hold);
  assert.deepEqual(await rowSnapshot(),seeded,'Operational hold does not rewrite any rows');
  assert.equal((await one("select has_function_privilege('authenticated','public.adjust_minuta_loyalty_progress_v166(uuid,uuid,integer,text,uuid)','execute') allowed")).allowed,false);
  assert.equal((await one("select has_function_privilege('authenticated','public.get_minuta_loyalty_program_workspace_v166(uuid)','execute') allowed")).allowed,false);
  assert.equal((await one("select has_function_privilege('anon','public.get_client_loyalty_program_v166(text,uuid)','execute') allowed")).allowed,false);
  assert.equal((await one("select count(*)::int n from pg_trigger where tgname in ('booking_outcomes_loyalty_program_v166','bookings_loyalty_program_v166') and tgenabled='D'")).n,2);
  await db.exec(patch);assert.deepEqual(await rowSnapshot(),seeded,'Resume after hold preserves all rows');
  assert.equal((await one("select count(*)::int n from pg_trigger where tgname in ('booking_outcomes_loyalty_program_v166','bookings_loyalty_program_v166') and tgenabled='O'")).n,2);
  await check('drift-refused',6,'Миграция не перезаписывает неизвестное серверное определение',async()=>{await db.exec("create or replace function public.get_minuta_loyalty_program_role_v166(p_organization uuid) returns text language sql as 'select ''unexpected''::text'");await denied(()=>db.exec(patch),/source_drift/);});
  const result={environment:'Synthetic in-memory PGlite, v166 baseline + compatible hardening patch; no production connection',checks,summary:{total:checks.length,pass:checks.filter(c=>c.status==='PASS').length,fail:checks.filter(c=>c.status==='FAIL').length},rollback:{sourcePins:true,repeatApply:true,exactBaselineReadback:true,dataPreserved:true,operationalHold:true,reapply:true}};
  if(process.env.MINUTA_LOYALTY_AUDIT_OUTPUT)fs.writeFileSync(process.env.MINUTA_LOYALTY_AUDIT_OUTPUT,JSON.stringify(result,null,2));
  console.log(JSON.stringify({summary:result.summary,rollback:result.rollback,failures:checks.filter(c=>c.status==='FAIL')},null,2));assert.equal(result.summary.fail,0,'All hardening scenarios must pass');
}catch(error){console.error(JSON.stringify({message:error.message,code:error.code,detail:error.detail,query:error.query},null,2));process.exitCode=1;}finally{await db.close();}
