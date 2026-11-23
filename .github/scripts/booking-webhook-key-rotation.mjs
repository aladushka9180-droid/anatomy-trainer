import {createHash,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
export const PROJECT='cawexmmrqjvothcbgjxr';
const KEY_NAME='BOOKING_WEBHOOK_SECRET',HEADER='x-booking-secret';
const sha=value=>createHash('sha256').update(value).digest('hex');
const md5=value=>createHash('md5').update(value).digest('hex');
const requireCondition=(condition,code)=>{if(!condition)throw new Error(code);};
export function planRotation(rows,edgeDigest,newKey){
  requireCondition(Array.isArray(rows),'invalid_catalog');
  requireCondition(/^[a-f0-9]{64}$/.test(newKey),'invalid_new_key');
  const targets=[];
  for(const row of rows){
    const args=Buffer.from(row.args,'base64').toString('utf8').split('\0');
    if(args.at(-1)==='')args.pop();
    let headers;try{headers=JSON.parse(args[2]||'{}');}catch{throw new Error('invalid_header_configuration');}
    if(!Object.hasOwn(headers,HEADER))continue;
    requireCondition(args[0]===`https://${PROJECT}.supabase.co/functions/v1/telegram-booking-notify`,'unexpected_webhook_target');
    requireCondition(args[1]==='POST' && row.enabled==='O','unexpected_trigger_state');
    requireCondition(row.schema==='public' && ['bookings','booking_page_visits'].includes(row.table) && /^[a-z_][a-z0-9_]*$/.test(row.name),'unexpected_trigger_scope');
    const oldKey=headers[HEADER];requireCondition(typeof oldKey==='string' && /^[a-f0-9]{64}$/.test(oldKey) && oldKey!==newKey,'unexpected_old_key');
    requireCondition(typeof row.definition==='string' && row.definition.startsWith('CREATE TRIGGER ') && row.definition.split(oldKey).length===2,'unexpected_trigger_definition');
    const after=row.definition.replace(oldKey,newKey);
    targets.push({schema:row.schema,table:row.table,name:row.name,oldKey,beforeMd5:md5(row.definition),afterMd5:md5(after),ddl:after.replace(/^CREATE TRIGGER /,'CREATE OR REPLACE TRIGGER ')});
  }
  requireCondition(targets.length>0 && targets.length<10 && targets.some(t=>t.table==='bookings'),'missing_booking_trigger');
  requireCondition(targets.every(t=>t.oldKey===targets[0].oldKey),'inconsistent_trigger_keys');
  requireCondition(edgeDigest===sha(targets[0].oldKey),'edge_trigger_key_mismatch');
  return {targets,oldKey:targets[0].oldKey,newKey};
}
export function rotationSql(plan){
  const tables=[...new Set(plan.targets.map(t=>t.schema+'.'+t.table))].sort();
  return `begin;\nset local lock_timeout='5s';\nset local statement_timeout='30s';\nlock table ${tables.join(',')} in share row exclusive mode;\n`+plan.targets.map(t=>`do $guard$ begin
if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='${t.schema}.${t.table}'::regclass and tgname='${t.name}' and tgenabled='O' and md5(pg_catalog.pg_get_triggerdef(oid)) in ('${t.beforeMd5}','${t.afterMd5}')) then raise exception 'webhook_trigger_changed'; end if;
end $guard$;\n${t.ddl};`).join('\n')+'\ncommit;\n';
}
export const catalogSql=`select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_catalog.pg_get_triggerdef(t.oid),'args',encode(t.tgargs,'base64')) order by c.relname,t.tgname),'[]'::jsonb) from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace join pg_catalog.pg_proc p on p.oid=t.tgfoid join pg_catalog.pg_namespace pn on pn.oid=p.pronamespace where not t.tgisinternal and n.nspname='public' and c.relname in ('bookings','booking_page_visits') and pn.nspname='supabase_functions' and p.proname='http_request';`;
function database(sql,write=false){
  const connection=new URL(process.env.SUPABASE_DB_URL);if(connection.port==='6543')connection.port='5432';
  const result=execFileSync('psql',[connection.href,'-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',maxBuffer:8*1024*1024,timeout:45000,stdio:['pipe','pipe','pipe'],env:{...process.env,PGOPTIONS:`-c default_transaction_read_only=${write?'off':'on'} -c statement_timeout=30000 -c lock_timeout=5000`}});
  return result.trim();
}
async function secretApi(method,body){
  const response=await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/secrets`,{method,headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  requireCondition(response.ok,'secret_api_failed');return method==='GET'?response.json():null;
}
async function digest(){const rows=await secretApi('GET');const entry=rows.find(row=>row.name===KEY_NAME);requireCondition(entry && typeof entry.value==='string','missing_edge_secret');return entry.value.toLowerCase();}
function catalog(){return JSON.parse(database('begin read only;\n'+catalogSql+'\nrollback;'));}
function keysMatch(rows,plan,key){return plan.targets.every(target=>{const row=rows.find(r=>r.schema===target.schema&&r.table===target.table&&r.name===target.name);if(!row)return false;try{return JSON.parse(Buffer.from(row.args,'base64').toString('utf8').split('\0')[2])[HEADER]===key;}catch{return false;}});}
let phase='authorization';
async function main(){
  requireCondition(process.env.GITHUB_REF==='refs/heads/main' && process.env.GITHUB_SHA===process.env.EXPECTED_SHA && /^[a-f0-9]{40}$/.test(process.env.EXPECTED_SHA||''),'exact_main_required');
  requireCondition(process.env.MINUTA_PRODUCTION_PROJECT_REF===PROJECT && process.env.SUPABASE_ACCESS_TOKEN && process.env.SUPABASE_DB_URL,'target_required');
  const mode=process.env.MODE;requireCondition(['check','rotate'].includes(mode),'invalid_mode');
  if(mode==='rotate')requireCondition(process.env.CONFIRMATION==='ROTATE_BOOKING_WEBHOOK_SECRET','explicit_rotation_confirmation_required');
  phase='preflight';
  requireCondition(Number(database('show server_version_num;'))>=140000,'postgres_version_required');
  const before=catalog(),newKey=randomBytes(32).toString('hex');
  const plan=planRotation(before,await digest(),newKey);
  console.log(`Webhook preflight passed for ${plan.targets.length} trigger(s); handler digest matches. No values disclosed.`);
  if(mode==='check')return;
  phase='edge_secret_update';
  try{await secretApi('POST',[{name:KEY_NAME,value:newKey}]);}catch{requireCondition(await digest()===sha(newKey),'edge_update_uncertain');}
  requireCondition(await digest()===sha(newKey),'edge_update_not_confirmed');
  phase='trigger_key_update';
  try{database(rotationSql(plan),true);}catch{
    if(!keysMatch(catalog(),plan,newKey)){
      requireCondition(keysMatch(catalog(),plan,plan.oldKey),'trigger_update_uncertain');
      database(rotationSql(plan),true);
    }
  }
  phase='verification';
  requireCondition(await digest()===sha(newKey) && keysMatch(catalog(),plan,newKey),'rotation_not_confirmed');
  requireCondition(!keysMatch(catalog(),plan,plan.oldKey),'old_key_still_active');
  console.log(`Webhook key rotation confirmed for handler and ${plan.targets.length} trigger(s). Old key replaced. No customer messages sent.`);
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){main().catch(()=>{console.error(`Webhook operation failed at ${phase}; configuration may require verification. Sensitive details withheld.`);process.exitCode=1;});}
