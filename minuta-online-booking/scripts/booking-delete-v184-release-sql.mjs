import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=new URL('../',import.meta.url);
export const manifest=JSON.parse(readFileSync(new URL('recovery/booking-delete-v184-manifest.json',root),'utf8'));
const read=name=>readFileSync(new URL(name,root),'utf8').replace(/\r\n/g,'\n');
const digest=(value,algorithm='sha256')=>createHash(algorithm).update(value).digest('hex');
export function verifySources() {
  for(const [mode,filename,legacy] of [
    ['candidate','supabase-migration-v184.sql','booking-delete-dialog-candidate.sql'],
    ['rollback','supabase-migration-v184-rollback.sql','booking-delete-dialog-rollback.sql']]) {
    const sql=read(filename);
    assert.equal(sql,read(`recovery/${legacy}`),'numbered SQL must equal tested recovery copy');
    assert.equal(digest(sql),manifest[`${mode}Sha256`],'SQL digest must equal the successful native test source');
    assert.equal(digest(Buffer.concat([Buffer.from(`blob ${Buffer.byteLength(sql)}\0`),Buffer.from(sql)]),'sha1'),manifest[`${mode}GitBlob`]);
  }
  return true;
}
export function healthSql() {
  return `select jsonb_build_object(
    'readOnly',current_setting('transaction_read_only')='on',
    'knownOriginal',(select md5(regexp_replace(prosrc,'[[:space:]]','','g'))='${manifest.originalBodyMd5}' from pg_proc where oid='public.provider_delete_booking(uuid)'::regprocedure),
    'knownCandidate',(select md5(regexp_replace(prosrc,'[[:space:]]','','g'))='${manifest.candidateBodyMd5}' from pg_proc where oid='public.provider_delete_booking(uuid)'::regprocedure),
    'marker',coalesce(obj_description('public.provider_delete_booking(uuid)'::regprocedure,'pg_proc'),''),
    'archiveColumnCount',(select count(*) from pg_attribute where attrelid in('public.message_conversations_v162'::regclass,'public.message_participants_v162'::regclass) and attname='deleted_booking_id' and not attisdropped),
    'archiveCheckCount',(select count(*) from pg_constraint where (conrelid,conname) in(('public.message_conversations_v162'::regclass,'message_conversations_booking_archive_check'),('public.message_participants_v162'::regclass,'message_participants_booking_archive_check'))),
    'authenticatedCanExecute',has_function_privilege('authenticated','public.provider_delete_booking(uuid)','EXECUTE'),
    'anonDenied',not has_function_privilege('anon','public.provider_delete_booking(uuid)','EXECUTE'),
    'serviceDenied',not has_function_privilege('service_role','public.provider_delete_booking(uuid)','EXECUTE'),
    'securityDefiner',(select prosecdef and proconfig=array['search_path=""'] from pg_proc where oid='public.provider_delete_booking(uuid)'::regprocedure),
    'ownerCanBypassRls',(select r.rolname='postgres' and (r.rolbypassrls or r.rolsuper) from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='public.provider_delete_booking(uuid)'::regprocedure),
    'tableRls',(select count(*)=4 and bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in('bookings','message_conversations_v162','message_participants_v162','conversation_messages_v162')),
    'archiveColumns',(select count(*)=2 and bool_and(a.atttypid='uuid'::regtype and not a.attnotnull and not a.atthasdef) from pg_attribute a where a.attrelid in('public.message_conversations_v162'::regclass,'public.message_participants_v162'::regclass) and a.attname='deleted_booking_id' and not a.attisdropped),
    'archiveChecks',(select count(*)=2 and bool_and(c.convalidated and obj_description(c.oid,'pg_constraint')='${manifest.marker}') from pg_constraint c where (c.conrelid,c.conname) in(('public.message_conversations_v162'::regclass,'message_conversations_booking_archive_check'),('public.message_participants_v162'::regclass,'message_participants_booking_archive_check')))
  );\n`;
}
export function buildTransaction(phase) {
  assert.ok(['apply','rollback'].includes(phase)); verifySources();
  const sql=read(`supabase-migration-v184${phase==='rollback'?'-rollback':''}.sql`);
  assert.equal((sql.match(/^begin;$/gm)||[]).length,1);
  assert.equal((sql.match(/^commit;$/gm)||[]).length,1);
  const body=sql.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
  const expected=phase==='apply'?manifest.candidateBodyMd5:manifest.originalBodyMd5;
  return `begin;
set local lock_timeout='5s';
set local statement_timeout='5min';
${read('scripts/booking-delete-v184-preservation.sql')}
${body}
do $verify$
begin
  if (select value from pg_temp.v184_preservation_before) is distinct from pg_temp.v184_preservation_snapshot() then
    raise exception using errcode='55000',message='v184_preservation_check_failed';
  end if;
  if not exists(select 1 from pg_proc where oid='public.provider_delete_booking(uuid)'::regprocedure
    and md5(regexp_replace(prosrc,'[[:space:]]','','g'))='${expected}') then
    raise exception using errcode='55000',message='v184_result_definition_mismatch';
  end if;
end
$verify$;
commit;
select jsonb_build_object('status','success','operation','${phase}','candidateVersion','v184',
  'businessRowsChanged',false,'securityPreserved',true,'historyPreserved',true,
  'deletionInvoked',false,'candidateSqlSha256','${manifest.candidateSha256}',
  'rollbackSqlSha256','${manifest.rollbackSha256}');\n`;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const [mode,destination]=process.argv.slice(2); verifySources();
    if(mode==='verify') {assert.equal(destination,undefined);console.log('v184 numbered SQL equals the exact tested source: PASS');}
    else {assert.ok(destination);writeFileSync(destination,mode==='health'?healthSql():buildTransaction(mode),{mode:0o600});}
  } catch {console.error('v184 SQL source or transaction guard failed; private input withheld');process.exitCode=1;}
}
