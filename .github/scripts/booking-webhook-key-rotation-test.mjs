import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {PROJECT,planRotation,rotationSql,catalogSql,secretApi} from './booking-webhook-key-rotation.mjs';
const old='a'.repeat(64),fresh='b'.repeat(64),digest=createHash('sha256').update(old).digest('hex');
const endpoint=`https://${PROJECT}.supabase.co/functions/v1/telegram-booking-notify`;
const sample=()=>({schema:'public',table:'bookings',name:'new_booking_telegram',enabled:'O',args:Buffer.from([endpoint,'POST',JSON.stringify({'x-booking-secret':old}),'{}','5000',''].join('\0')).toString('base64'),definition:`CREATE TRIGGER new_booking_telegram AFTER INSERT ON public.bookings FOR EACH ROW WHEN (NEW.id > 0) EXECUTE FUNCTION supabase_functions.http_request('${endpoint}', 'POST', '{"x-booking-secret":"${old}"}', '{}', '5000')`});
const plan=planRotation([sample()],digest,fresh),sql=rotationSql(plan);
assert.ok(!sql.includes(old));assert.match(sql,/begin;/);assert.match(sql,/commit;/);assert.match(sql,/WHEN \(NEW.id > 0\)/);assert.match(sql,/CREATE OR REPLACE TRIGGER/);assert.match(sql,/webhook_trigger_changed/);
for(const patch of [{schema:'private'},{table:'other'},{enabled:'D'},{name:'invalid;name'},{args:Buffer.from(['https://example.invalid/other','POST',JSON.stringify({'x-booking-secret':old}),''].join('\0')).toString('base64')}])assert.throws(()=>planRotation([{...sample(),...patch}],digest,fresh));
assert.throws(()=>planRotation([sample()],'0'.repeat(64),fresh));assert.throws(()=>planRotation([sample()],digest,old));assert.throws(()=>planRotation([],digest,fresh));
const denied=spawnSync(process.execPath,[fileURLToPath(new URL('./booking-webhook-key-rotation.mjs',import.meta.url))],{encoding:'utf8',env:{...process.env,GITHUB_REF:'refs/heads/other',SUPABASE_ACCESS_TOKEN:'dummy_sensitive_marker',MODE:'rotate'}});assert.equal(denied.status,1);assert.ok(!denied.stderr.includes('dummy_sensitive_marker'));assert.match(denied.stderr,/authorization/);
const workflow=readFileSync(new URL('../workflows/minuta-booking-webhook-key-rotation.yml',import.meta.url),'utf8');assert.match(workflow,/environment: minuta-production/);assert.match(workflow,/group: minuta-production-database/);assert.match(workflow,/default: check/);assert.match(workflow,/production-db-target-guard/);assert.doesNotMatch(workflow,/upload-artifact/);
if(process.env.ROTATION_TEST_DATABASE_URL){
 const url=new URL(process.env.ROTATION_TEST_DATABASE_URL);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.equal(url.pathname,'/postgres');assert.equal(process.env.GITHUB_ACTIONS,'true','real SQL test runs only in the declared ephemeral CI service');
 const db=query=>execFileSync('psql',[url.href,'-X','-qAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
 db(`create schema supabase_functions; create function supabase_functions.http_request() returns trigger language plpgsql as $$ begin return new; end $$; create table public.bookings(id integer); create table public.booking_page_visits(id integer); ${sample().definition}; insert into public.bookings values(1);`);
 const visitDefinition=sample().definition.replaceAll('new_booking_telegram','new_visitor_telegram').replaceAll('public.bookings','public.booking_page_visits');
 db(visitDefinition+'; insert into public.booking_page_visits values(1);');
 const rows=JSON.parse(db(catalogSql));const realPlan=planRotation(rows,digest,fresh);db(rotationSql(realPlan));db(rotationSql(realPlan));
 const after=JSON.parse(db(catalogSql));assert.equal(after.length,2);for(const row of after)assert.equal(JSON.parse(Buffer.from(row.args,'base64').toString('utf8').split('\0')[2])['x-booking-secret'],fresh);assert.equal(db('select count(*) from public.bookings;'),'1');
 db(visitDefinition.replace('CREATE TRIGGER ','CREATE OR REPLACE TRIGGER ')+';');
 db(`create or replace trigger new_booking_telegram after insert on public.bookings for each row execute function supabase_functions.http_request('changed');`);
 assert.throws(()=>db(rotationSql(realPlan)));assert.equal(db('select count(*) from public.bookings;'),'1');
 const rolledBack=JSON.parse(db(catalogSql)).find(row=>row.table==='booking_page_visits');assert.equal(JSON.parse(Buffer.from(rolledBack.args,'base64').toString('utf8').split('\0')[2])['x-booking-secret'],old,'failure at second trigger rolls back the earlier trigger replacement');assert.equal(db('select count(*) from public.booking_page_visits;'),'1');
 console.log('Isolated PostgreSQL: canonical trigger replacement, idempotent retry, drift rejection and preserved rows PASS');
}
console.log('Webhook key rotation: endpoint/digest/scope/authorization guards and private logs PASS');

const deniedUnconfirmed=spawnSync(process.execPath,[fileURLToPath(new URL('./booking-webhook-key-rotation.mjs',import.meta.url))],{encoding:'utf8',env:{...process.env,GITHUB_REF:'refs/heads/main',GITHUB_SHA:'a'.repeat(40),EXPECTED_SHA:'a'.repeat(40),MINUTA_PRODUCTION_PROJECT_REF:PROJECT,SUPABASE_DB_URL:'postgres://dummy:dummy@127.0.0.1/postgres',SUPABASE_ACCESS_TOKEN:'dummy_sensitive_marker',MODE:'rotate',CONFIRMATION:''}});
assert.equal(deniedUnconfirmed.status,1);assert.match(deniedUnconfirmed.stderr,/authorization/);assert.ok(!deniedUnconfirmed.stderr.includes('dummy_sensitive_marker'));

const originalFetch=globalThis.fetch;
try {
  globalThis.fetch=async()=>new Response('dummy_private_api_error_body',{status:403});
  await assert.rejects(secretApi('GET'),error=>error.safeCode==='secret_api_status_403' && !error.message.includes('dummy_private_api_error_body'));
} finally {globalThis.fetch=originalFetch;}
console.log('Management API rejection exposes status only, never response body: PASS');
