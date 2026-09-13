import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase-migration-v155.sql', import.meta.url), 'utf8').replace(/\r/g, '');
const rollback = readFileSync(new URL('../supabase-migration-v155-rollback.sql', import.meta.url), 'utf8').replace(/\r/g, '');
const concurrency = readFileSync(new URL('./client-identity-v155-postgres-concurrency-test.mjs', import.meta.url), 'utf8').replace(/\r/g, '');
const v54 = readFileSync(new URL('../supabase-migration-v54.sql', import.meta.url), 'utf8').replace(/\r/g, '');
const v61 = readFileSync(new URL('../supabase-migration-v61.sql', import.meta.url), 'utf8').replace(/\r/g, '');
const v76 = readFileSync(new URL('../supabase-migration-v76.sql', import.meta.url), 'utf8').replace(/\r/g, '');

function body(source, name) {
  const start = source.toLowerCase().indexOf(`create or replace function public.${name.toLowerCase()}`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const bodyStart = source.indexOf('as $$', start) + 5;
  const bodyEnd = source.indexOf('$$;', bodyStart);
  assert.ok(bodyStart >= 5 && bodyEnd > bodyStart, `invalid function body ${name}`);
  return source.slice(bodyStart, bodyEnd);
}
function lastBody(source, name) {
  const start = source.toLowerCase().lastIndexOf(`create or replace function public.${name.toLowerCase()}`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const bodyStart = source.indexOf('as $$', start) + 5;
  const bodyEnd = source.indexOf('$$;', bodyStart);
  assert.ok(bodyStart >= 5 && bodyEnd > bodyStart, `invalid function body ${name}`);
  return source.slice(bodyStart, bodyEnd);
}
const sha = value => createHash('sha256').update(value).digest('hex');

assert.doesNotMatch(migration + rollback, /__HASH_|\bv154\b/i);
assert.match(migration, /v155_apply_blocked_partial_or_newer_objects/);
assert.match(migration, /v155_legacy_client_reader_drift/);
assert.match(migration, /if v_assign_hash not in\(\s*'76b6e4f7e27ade7b378e7b3af803f75204f41397e3eafc86db61466a0d669e1c',\s*'065b00c979459c007bcda7b597c9f22b4e6d879085e7ee384ff04b3a27b5eea9'\s*\)/);
assert.match(migration, /if v_bootstrap_hash not in\(\s*'883ef40330c4e6fad714724108fd0522a8ad634179002d0f16b96ec4caf28951',\s*'94c1b8095abc5463911fdf95cfc1ce8ec029165470f123fb3ec6918328014a23',\s*'f44a81abf6333cc9b32e66caa753557985f5791bcf456e3ed3754d7fb76fc74b'\s*\)/);
assert.match(migration, /if v_public_benefit_hash not in\(\s*'4575f87c0fda3fa091e5bb984948650fadd77a8aa82e5bb156f5a9d734961955',\s*'53796773fc8c71ab5c178e1418e403cd706b8d5d1ee0b39a9c8ee3597b3b422c'(?:,\s*'53796773fc8c71ab5c178e1418e403cd706b8d5d1ee0b39a9c8ee3597b3b422c')?\s*\)/);
const compactMigration = migration.replace(/\s+/g, '');
for (const fingerprint of [
  "('public.resolve_client_session(text)','2a70ad04d39ba2d61358a23a1af608d16ed55c09c8456dbad45735d76cf7e172','search_path=pg_catalog,extensions','internal')",
  "('public.login_client_access(text,text,text)','c777cd9ee659220c1fd27a7179b85ce29892a2a177722bd40922b1bfa2a55cba','search_path=pg_catalog,extensions','public')",
  "('public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)','5920e1426745c8c5425cb15822474952557781b9959d3557f9f3b965e2aae1be','search_path=','public')",
  "('public.restore_client_session(text)','e3ab49fd1035fc7b9d2f411ba472901b5da0e553661ca41e03a9715cdd5ab4f0','ff71198fb90cd25d506183c3f56735b9e265ea941cdc35602d489615668f3375')",
  "('public.get_client_bookings_v3(text)','d3ef0acdcf8c78d061a4a9968ddc85e9e79f2a3ea9e0f15b066dff88fb4bbb74','3170303328b9dc187fd24e9722e85b9aeaef05bc06384d66617c210783639e09')",
  "('public.submit_booking_review(text,uuid,integer,text)','433a9f21e3964337c9a4a9d90f64cdd22a1ae50b9432eba76574a80405a3b77f','c44fd2ec429a9a68aab42a7674d51954f69b333d682c2c1797a2fa62e10d83d7')",
  "('public.revoke_client_session(text)','ae93ead6daa3744db31a84dd44437330d67f63010d67ab9785fa971809bf5d68','59430788863dfe1ef1c3bd20e65d0bc8466c9299ab3f7b3f825e9c13e4f8b088')",
  "'21222864e0aeb280f0d5fd5974dc928891b3b779a5043365495aaa4b10ddc154'",
  "'cb45298118e9bbadbb09481bb2711c061a7073fd9c6ae67a1984a8fe80010ed8'"
]) {
  assert.ok(compactMigration.includes(fingerprint.replace(/\s+/g, '')), `missing exact legacy dependency fingerprint: ${fingerprint}`);
}
assert.match(rollback, /v155_rollback_blocked_newer_function_definition/);
assert.doesNotMatch(migration + rollback, /'roles',policy_row\.polroles/);
assert.match(migration + rollback, /pg_get_userbyid\(role_oid\)/);

for (const table of ['sessions', 'claim_grants', 'transfers', 'booking_requests', 'audit']) {
  assert.match(migration, new RegExp(`alter table public\\.client_identity_${table}_v155 enable row level security`));
}
assert.match(migration, /'minuta_client_identity_v155:sha256='\|\|v_hash/);
assert.match(migration, /v155_apply_blocked_newer_table_definition/);
assert.equal((migration.match(/trigger_row\.tgconstraint=0/g) ?? []).length, 3);
assert.equal((rollback.match(/trigger_row\.tgconstraint=0/g) ?? []).length, 1);
assert.match(migration, /session_scope='account' and claimed_booking_id is null and client_account_id is not null/);
assert.match(migration, /session_scope='organization' and claimed_booking_id is null and client_account_id is not null and organization_id is not null/);
for (const reference of ['client_accounts', 'client_identity_sessions_v155', 'bookings']) {
  assert.match(
    migration,
    new RegExp(`client_identity_audit_v155\\([^]*?references public\\.${reference}\\(id\\) on delete restrict`, 'i')
  );
}
assert.doesNotMatch(migration, /\b(session_token|transfer_token|transfer_code)\s+text\s+not null/i);
assert.match(migration, /token_hash text not null unique check\(token_hash~'\^\[0-9a-f\]\{64\}\$'\)/);
assert.match(migration, /transfer_token_hash text not null unique/);
assert.match(migration, /display_code_hash text not null unique/);
assert.match(migration, /create table if not exists public\.client_identity_transfers_v155\([^]*failed_attempts integer not null default 0 check\(failed_attempts between 0 and 5\)[^]*locked_at timestamptz/s);

const assign = body(migration, 'assign_booking_client_account');
assert.match(assign, /if tg_op='INSERT' then\s+new\.client_account_id:=null/);
assert.match(assign, /new\.client_account_id:=old\.client_account_id/);
assert.doesNotMatch(assign, /normalize_client_phone/);

const bootstrap = body(migration, 'bootstrap_client_access');
assert.match(bootstrap, /claim_client_booking_identity_v155/);
assert.doesNotMatch(bootstrap, /client_accounts|client_device_sessions|access_code_hash/);

const claim = body(migration, 'claim_client_booking_identity_v155');
assert.match(claim, /booking\.manage_token=p_manage_token/);
assert.match(claim, /booking\.client_access_eligible_until>=now\(\)/);
assert.match(claim, /'booking','manage_token'/);

const legacyUpgrade = body(migration, 'upgrade_legacy_client_identity_session_v155');
assert.match(migration, /upgrade_legacy_client_identity_session_v155\(\s*p_legacy_session_token text,\s*p_access_code text,\s*p_device_name text/s);
assert.match(legacyUpgrade, /char_length\(v_code_raw\)<>16/);
assert.match(legacyUpgrade, /v_account\.access_code_hash<>encode\(extensions\.digest\(/);
assert.match(legacyUpgrade, /update public\.client_device_sessions set revoked_at=now\(\)/);
const rotateAccessCode = body(migration, 'rotate_client_access_code');
assert.match(rotateAccessCode, /raise exception using errcode='P0001',message='identity_confirmation_required'/);
assert.doesNotMatch(rotateAccessCode, /client_accounts|client_device_sessions|access_code_hash|update|insert/);

const promote = body(migration, 'promote_client_identity_v155');
for (const term of [
  'v_grant.organization_id is distinct from v_booking.organization_id',
  'v_grant.booking_id is distinct from v_booking.id',
  "session_scope='organization'",
  'claimed_booking_id=null',
  'consumed_by_session_id=v_session.session_id'
]) {
  assert.ok(promote.includes(term), `promotion gate missing: ${term}`);
}
assert.doesNotMatch(promote, /where booking\.client_account_id is null\s+and booking\.client_phone/);

const issueGrant = body(migration, 'issue_client_identity_claim_grant_v155');
assert.match(issueGrant, /v_is_service boolean:=coalesce\(auth\.role\(\),''\)='service_role'/);
assert.match(issueGrant, /membership\.role in\('owner','admin'\)/);
assert.match(issueGrant, /membership\.role='specialist' and v_booking\.performer_id=v_issuer/);
assert.match(issueGrant, /booking\.id=p_booking and booking\.organization_id=p_organization/);
assert.match(issueGrant, /booking\.status<>'cancelled'[\s\S]*booking\.status='confirmed' or booking\.payment_status='paid'/);
assert.match(issueGrant, /select public\.normalize_client_phone\(booking\.client_phone\) into v_phone/);
assert.ok(issueGrant.indexOf("'client-account:'||v_phone") < issueGrant.indexOf('select booking.* into v_booking'), 'account advisory must precede booking row lock');
assert.match(issueGrant, /update public\.bookings set client_account_id=v_account\s+where id=p_booking and organization_id=p_organization and client_account_id is null/);
assert.doesNotMatch(issueGrant, /where booking\.client_account_id is null\s+and booking\.client_phone/);
assert.match(migration, /issue_client_identity_claim_grant_v155\(\s*p_organization uuid,\s*p_booking uuid,\s*p_request_id uuid,\s*p_expires_minutes integer default 10,\s*p_actor uuid default null/s);
assert.match(issueGrant, /grant_row\.organization_id=p_organization and grant_row\.request_id=p_request_id/);
assert.match(issueGrant, /set superseded_at=now\(\)/);
assert.match(issueGrant, /client_claim_already_consumed/);
assert.match(issueGrant, /client_claim_superseded/);
assert.match(issueGrant, /issue_generation=v_generation/);
assert.match(issueGrant, /created_at=now\(\),expires_at=v_expires/);
assert.match(issueGrant, /'v155-booking-claim:'\|\|v_account_secret/);
assert.match(migration, /unique\(request_id\)/);
assert.match(migration, /client_identity_claim_grants_booking_active_v155_idx[\s\S]*where claim_kind='booking' and consumed_at is null and superseded_at is null/);

const issueSaleClaim = body(migration, 'issue_client_identity_sale_claim_v155');
assert.match(issueSaleClaim, /coalesce\(p_expires_minutes,0\) not between 1 and 10/);
assert.match(migration, /issue_client_identity_sale_claim_v155\(\s*p_organization uuid,\s*p_sale uuid,\s*p_request_id uuid,\s*p_expires_minutes integer default 10,\s*p_actor uuid default null,\s*p_client_phone text default null/s);
assert.match(issueSaleClaim, /v_token:='PTS1-'\|\|substr\(v_token,1,4\)/);
assert.equal(issueSaleClaim.match(/v_token:=upper\(substr\(encode\(extensions\.digest\(/g)?.length, 3,
  'initial, replay and reissue sale claim tokens must all use uppercase digest text');
assert.doesNotMatch(issueSaleClaim, /v_token:=lower\(/);
assert.match(issueSaleClaim, /digest\(replace\(v_token,'-',''\),'sha256'\)/);
assert.doesNotMatch(issueSaleClaim, /and sale\.booking_id is null/);
assert.match(issueSaleClaim, /sale\.status='paid' and sale\.refunded_minor=0/);
assert.match(issueSaleClaim, /sale\.payment_method in\('cash','manual'\)/);
assert.match(issueSaleClaim, /update public\.commercial_sales set client_account_id=v_account\s+where id=p_sale and organization_id=p_organization and client_account_id is null/);
assert.match(issueSaleClaim, /update public\.bookings set client_account_id=v_account\s+where id=v_booking_id and organization_id=p_organization and client_account_id is null/);
assert.match(issueSaleClaim, /membership\.role='specialist' and \(v_sale\.seller_id=v_issuer/);
assert.match(issueSaleClaim, /client_claim_already_consumed/);
assert.match(issueSaleClaim, /client_claim_superseded/);
assert.match(issueSaleClaim, /issue_generation=v_generation/);
assert.match(issueSaleClaim, /created_at=now\(\),expires_at=v_expires/);
assert.match(issueSaleClaim, /'v155-sale-claim:'\|\|v_account_secret/);
assert.match(issueSaleClaim, /set superseded_at=now\(\)/);
assert.ok(issueSaleClaim.indexOf("'client-account:'||v_phone") < issueSaleClaim.indexOf("'client-identity-booking:'||p_organization::text"), 'sale enrollment must lock account before booking');
assert.ok(issueSaleClaim.indexOf("'client-identity-booking:'||p_organization::text") < issueSaleClaim.indexOf("'client-identity-sale:'||p_organization::text"), 'sale enrollment must lock booking before sale');
assert.ok(issueSaleClaim.lastIndexOf('select sale.* into v_sale') < issueSaleClaim.indexOf('select grant_row.* into v_existing'), 'sale row lock must precede grant row lock');
assert.match(migration, /client_identity_claim_grants_sale_active_v155_idx[\s\S]*where claim_kind='sale' and consumed_at is null and superseded_at is null/);
assert.doesNotMatch(issueGrant + issueSaleClaim, /v155-phone:|phone_ref/);
assert.match(migration, /grant execute on function public\.issue_client_identity_claim_grant_v155\(uuid,uuid,uuid,integer,uuid\) to authenticated,service_role/);
assert.match(migration, /grant execute on function public\.issue_client_identity_sale_claim_v155\(uuid,uuid,uuid,integer,uuid,text\) to authenticated,service_role/);
assert.doesNotMatch(migration, /grant execute on function public\.issue_client_identity_(?:sale_)?claim_grant_v155[^;]*\bto anon\b/);
const inspectSaleClaim = body(migration, 'inspect_client_identity_sale_claim_v155');
assert.match(migration, /inspect_client_identity_sale_claim_v155\(\s*p_claim_token text,\s*p_request_id uuid\s*\)\s*returns table\(\s*account_ref text,\s*organization_ref text,\s*claim_scope text,\s*claim_status text,\s*claim_expires_at timestamptz,\s*revision text/s);
assert.match(inspectSaleClaim, /v_claim_normalized text:=replace\(upper\(btrim\(coalesce\(p_claim_token,''\)\)\),'-',''\)/);
assert.match(inspectSaleClaim, /grant_row\.claim_kind='sale'[\s\S]*grant_row\.token_hash=encode\(extensions\.digest\(v_claim_normalized,'sha256'\),'hex'\)/);
assert.match(inspectSaleClaim, /if btrim\(coalesce\(p_claim_token,''\)\)!~'\^PTS1-\[0-9A-F\]\{4\}-\[0-9A-F\]\{4\}-\[0-9A-F\]\{4\}-\[0-9A-F\]\{4\}\$'/);
assert.doesNotMatch(inspectSaleClaim, /if upper\(btrim\(coalesce\(p_claim_token,''\)\)\)!~/);
assert.doesNotMatch(inspectSaleClaim, /grant_row\.request_id=p_request_id/);
assert.match(inspectSaleClaim, /v_grant\.consumed_at is not null/);
assert.match(inspectSaleClaim, /v_grant\.expires_at<=now\(\)/);
assert.match(inspectSaleClaim, /'purchase'::text,'active'::text/);
assert.doesNotMatch(inspectSaleClaim, /sale\.booking_id is null/);
assert.match(inspectSaleClaim, /v_sale\.booking_id is distinct from v_booking_id/);
assert.match(inspectSaleClaim, /v_booking\.client_account_id is distinct from v_grant\.client_account_id/);
assert.ok(inspectSaleClaim.indexOf('select sale.* into v_sale') < inspectSaleClaim.lastIndexOf('select grant_row.* into v_grant'), 'inspect sale row lock must precede grant row lock');
for (const stableRef of ['ptac_', 'ptorg_', 'ptrv_']) assert.ok(inspectSaleClaim.includes(`'${stableRef}'`));
assert.doesNotMatch(inspectSaleClaim, /\b(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\./i);
assert.match(migration, /grant execute on function public\.inspect_client_identity_sale_claim_v155\(text,uuid\) to service_role/);
assert.doesNotMatch(migration, /grant execute on function public\.inspect_client_identity_sale_claim_v155\(text,uuid\) to (?:anon|authenticated)/);
assert.match(rollback, /drop function public\.inspect_client_identity_sale_claim_v155\(text,uuid\)/);
const consumeSaleClaim = body(migration, 'consume_client_identity_sale_claim_v155');
assert.match(migration, /consume_client_identity_sale_claim_v155\(\s*p_claim_token text,\s*p_device_name text,\s*p_request_id uuid\s*\)\s*returns table\(\s*session_token text,\s*session_scope text,\s*account_ref text,\s*organization_ref text,\s*revision text,/s);
assert.match(consumeSaleClaim, /v_claim_normalized text:=replace\(upper\(btrim\(coalesce\(p_claim_token,''\)\)\),'-',''\)/);
assert.match(consumeSaleClaim, /if btrim\(coalesce\(p_claim_token,''\)\)!~'\^PTS1-\[0-9A-F\]\{4\}-\[0-9A-F\]\{4\}-\[0-9A-F\]\{4\}-\[0-9A-F\]\{4\}\$'/);
assert.doesNotMatch(consumeSaleClaim, /if upper\(btrim\(coalesce\(p_claim_token,''\)\)\)!~/);
assert.match(consumeSaleClaim, /grant_row\.token_hash=encode\(extensions\.digest\(v_claim_normalized,'sha256'\),'hex'\)/);
assert.doesNotMatch(consumeSaleClaim, /grant_row\.request_id=p_request_id/);
assert.match(consumeSaleClaim, /'client-identity-sale:'\|\|v_grant\.organization_id::text\|\|':'\|\|v_grant\.commercial_sale_id::text/);
assert.ok(consumeSaleClaim.indexOf('select sale.* into v_sale') < consumeSaleClaim.lastIndexOf('select grant_row.* into v_grant'), 'consume sale row lock must precede grant row lock');
assert.match(consumeSaleClaim, /'v155-sale-session:'\|\|v_claim_normalized\|\|':'\|\|p_request_id::text/);
assert.match(consumeSaleClaim, /v_grant\.consume_request_id is distinct from p_request_id/);
assert.match(consumeSaleClaim, /'organization','sale_claim'/);
for (const stableRef of [
  "'ptac_'||encode(extensions.digest('v155-account:'||v_grant.client_account_id::text,'sha256'),'hex')",
  "'ptorg_'||encode(extensions.digest('v155-organization:'||v_grant.organization_id::text,'sha256'),'hex')",
  "'ptrv_'||encode(extensions.digest('v155-sale-claim:'||v_grant.id::text,'sha256'),'hex')"
]) assert.ok(consumeSaleClaim.split(stableRef).length - 1 >= 2, `sale claim must return stable ${stableRef} on first call and replay`);
assert.doesNotMatch(consumeSaleClaim, /raise exception/);

const approve = body(migration, 'approve_client_identity_transfer_v155');
assert.match(migration, /approve_client_identity_transfer_v155\(\s*p_session_token text,\s*p_transfer_token text,\s*p_transfer_code text/s);
assert.match(approve, /v_code_raw text:=replace\(upper\(btrim\(coalesce\(p_transfer_code,''\)\)\),'-',''\)/);
assert.match(approve, /\^PTX1-\[0-9A-F\]\{4\}-\[0-9A-F\]\{4\}-\[0-9A-F\]\{4\}-\[0-9A-F\]\{4\}\$/);
assert.match(approve, /transfer_row\.transfer_token_hash=v_transfer_hash/);
assert.match(approve, /v_transfer\.display_code_hash<>encode\(extensions\.digest\(v_code_raw,'sha256'\),'hex'\)/);
assert.match(approve, /if not found then return jsonb_build_object\('status','unavailable'\)/);
assert.match(approve, /failed_attempts=least\(5,failed_attempts\+1\)/);
assert.match(approve, /locked_at=case when failed_attempts\+1>=5 then coalesce\(locked_at,now\(\)\)/);
const consume = body(migration, 'consume_client_identity_transfer_v155');
assert.match(consume, /v_code_raw text:=replace\(upper\(btrim\(coalesce\(p_transfer_code,''\)\)\),'-',''\)/);
assert.match(consume, /\^PTX1-\[0-9A-F\]\{4\}-\[0-9A-F\]\{4\}-\[0-9A-F\]\{4\}-\[0-9A-F\]\{4\}\$/);
assert.match(consume, /v_transfer\.display_code_hash<>encode\(extensions\.digest\(v_code_raw,'sha256'\),'hex'\)/);
assert.match(consume, /failed_attempts=least\(5,failed_attempts\+1\)/);
assert.match(consume, /locked_at=case when failed_attempts\+1>=5 then coalesce\(locked_at,now\(\)\)/);
assert.match(consume, /consumed_session_id/);
assert.match(consume, /session_row\.token_hash=v_session_hash/);
assert.match(consume, /'v155-transfer-session:'\|\|lower\(p_transfer_token\)/);
assert.match(consume, /client_device_sessions legacy where legacy\.token_hash=v_session_hash/);
const beginTransfer = body(migration, 'begin_client_identity_transfer_v155');
assert.match(beginTransfer, /v_session\.session_scope<>'account'/);
assert.match(beginTransfer, /v_code_raw:=upper\(encode\(extensions\.gen_random_bytes\(8\),'hex'\)\)/);
assert.match(beginTransfer, /v_code:='PTX1-'\|\|substr\(v_code_raw,1,4\)/);
assert.match(beginTransfer, /digest\(replace\(v_code,'-',''\),'sha256'\)/);

const identityContext = body(migration, 'get_client_identity_context_v155');
for (const secret of ['manage_token', 'payment_url', 'client_phone', 'public_code']) assert.doesNotMatch(identityContext, new RegExp(secret));
const commerce = body(migration, 'get_client_commerce_v155');
assert.match(commerce, /sale\.client_account_id=v_session\.client_account_id/);
assert.match(commerce, /instrument\.client_account_id=v_session\.client_account_id/);
assert.match(commerce, /v_session\.session_scope='account' or scoped_instrument\.organization_id=v_session\.organization_id/);
for (const secret of ['manage_token', 'payment_url', 'public_code', 'seller_id', 'actor_id']) assert.doesNotMatch(commerce, new RegExp(secret));
for (const prefix of ['ptac_', 'ptorg_', 'ptpu_', 'ptbf_', 'ptev_', 'ptm_', 'pts_']) {
  assert.ok(commerce.includes(`'${prefix}'`), `portfolio reference prefix missing: ${prefix}`);
}
assert.match(commerce, /'version',instrument\.client_version/);
assert.match(commerce, /'revision','ptrv_'\|\|encode\(extensions\.digest/);

const bumpBenefitVersion = body(migration, 'bump_client_benefit_version_v155');
assert.match(migration, /add column if not exists client_version integer not null default 1/);
assert.match(bumpBenefitVersion, /new\.client_version:=old\.client_version\+1/);
assert.match(bumpBenefitVersion, /new\.client_version:=old\.client_version/);
assert.match(migration, /create trigger client_benefit_instruments_version_v155[\s\S]*before update on public\.client_benefit_instruments[\s\S]*execute function public\.bump_client_benefit_version_v155\(\)/);

const atomic = body(migration, 'book_client_with_benefit_v155');
assert.match(migration, /book_client_with_benefit_v155\([^]*?returns table\(/i);
assert.match(migration, /book_client_with_benefit_v155\(\s*p_session_token text,[^]*?p_benefit_ref text,\s*p_expected_benefit_version integer,\s*p_amount_rub integer default null/i);
assert.match(atomic, /resolve_client_identity_session_v155/);
assert.match(atomic, /instrument\.client_account_id=v_account\.id/);
assert.match(atomic, /digest\('v155-benefit:'\|\|instrument\.id::text,'sha256'\)/);
assert.match(atomic, /v_session\.session_scope='organization' and v_session\.organization_id is distinct from v_organization/);
assert.match(atomic, /book_minuta_appointment_v2/);
assert.match(atomic, /set client_account_id=v_account\.id/);
assert.match(atomic, /reserve_client_benefit_v155/);
assert.match(atomic, /client_identity_booking_requests_v155/);
assert.match(atomic, /hashtextextended\('booking-request:'\|\|p_request_id::text,0\)/);
assert.match(atomic, /p_expected_duration_minutes,p_benefit_ref,p_expected_benefit_version,p_amount_rub/);
assert.match(atomic, /v_existing\.benefit_version/);
assert.match(atomic, /\(v_benefit->>'version'\)::integer/);
assert.match(migration, /grant execute on function public\.book_client_with_benefit_v155\(\s*text,uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text,integer,integer\s*\) to service_role/s);
assert.doesNotMatch(migration, /grant execute on function public\.book_client_with_benefit_v155\([^;]+\) to (?:anon|authenticated)/s);
for (const forbidden of ['refund_minuta_commercial_sale', 'set_minuta_benefit_lifecycle', 'apply_minuta_benefit_v149', 'get_minuta_commerce_workspace']) {
  assert.doesNotMatch(atomic, new RegExp(forbidden));
}

const legacyBenefit = body(migration, 'book_minuta_appointment_with_benefit_v115');
assert.match(legacyBenefit, /raise exception using errcode='P0001',message='benefit_not_available'/);
assert.doesNotMatch(legacyBenefit, /book_minuta_appointment|reserve_minuta_public_benefit/);

const compatibleBookings = body(migration, 'get_client_bookings_v3');
assert.match(compatibleBookings, /v_identity\.session_scope='booking'\s+and booking\.id=v_identity\.claimed_booking_id/);
assert.match(compatibleBookings, /case when v_identity\.session_id is null then booking\.manage_token else null::uuid end/);
assert.match(compatibleBookings, /case when v_identity\.session_id is null then booking\.payment_url::text else null::text end/);
assert.match(body(migration, 'restore_client_session'), /resolve_client_identity_session_v155/);
assert.match(body(migration, 'submit_booking_review'), /booking\.id=v_identity\.claimed_booking_id/);
assert.match(body(migration, 'revoke_client_session'), /revoke_client_identity_session_v155/);

const expectedBodies = [
  ['restore_client_session', v54],
  ['get_client_bookings_v3', v76],
  ['submit_booking_review', v61],
  ['revoke_client_session', v54]
];
for (const [name, source] of expectedBodies) {
  assert.equal(sha(lastBody(rollback, name)), sha(body(source, name)), `rollback does not restore ${name}`);
}
assert.equal(
  sha(lastBody(rollback, 'assign_booking_client_account')),
  sha(body(migration, 'assign_booking_client_account')),
  'rollback must retain the safe booking identity boundary'
);
for (const [name, error] of [
  ['bootstrap_client_access', 'booking_unavailable'],
  ['book_minuta_appointment_with_benefit_v115', 'benefit_not_available']
]) {
  const effective = lastBody(rollback, name);
  assert.match(effective, new RegExp(`raise exception using errcode='P0001',message='${error}'`));
  assert.doesNotMatch(effective, /client_accounts|client_device_sessions|book_minuta_appointment|reserve_minuta_public_benefit/);
}
assert.match(rollback, /minuta_client_identity_rollback_safe_v155/);

assert.match(concurrency, /const sessionTokens = \[randomBytes\(32\)[^]*randomBytes\(32\)/);
assert.match(concurrency, /replayPromise = outcome\(second\.query\(rpcSql/);
assert.match(concurrency, /await awaitBlocked\(admin, secondPid\)/);
for (const exactCount of ['bookings:1', 'requests:1', 'redemptions:1', 'ledgers:1', 'identity_audits:1', 'benefit_audits:1']) {
  assert.ok(concurrency.includes(exactCount), `concurrency cardinality missing: ${exactCount}`);
}
assert.match(concurrency, /await admin\.query\(rollback\)[^]*await admin\.query\(migration\)[^]*await admin\.query\(migration\)[^]*await smoke\(admin\)/);

for (const name of [
  'assign_booking_client_account', 'bootstrap_client_access',
  'protect_client_identity_immutable_v155', 'resolve_client_identity_session_v155',
  'claim_client_booking_identity_v155', 'upgrade_legacy_client_identity_session_v155',
  'issue_client_identity_claim_grant_v155', 'issue_client_identity_sale_claim_v155',
  'inspect_client_identity_sale_claim_v155', 'consume_client_identity_sale_claim_v155', 'promote_client_identity_v155',
  'begin_client_identity_transfer_v155', 'approve_client_identity_transfer_v155',
  'consume_client_identity_transfer_v155', 'revoke_client_identity_session_v155',
  'restore_client_session', 'get_client_bookings_v3', 'submit_booking_review',
  'revoke_client_session', 'get_client_identity_context_v155',
  'get_client_commerce_v155', 'reserve_client_benefit_v155',
  'book_client_with_benefit_v155', 'book_minuta_appointment_with_benefit_v115'
]) {
  const hash = sha(body(migration, name));
  assert.ok(migration.includes(hash), `migration does not pin ${name}`);
  assert.ok(rollback.includes(hash), `rollback does not guard ${name}`);
}

console.log('client identity v155 static contract: PASS');
