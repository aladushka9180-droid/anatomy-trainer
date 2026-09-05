import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = name => readFileSync(join(root, name), 'utf8');
const migration = read('supabase-migration-v105.sql');
const rollback = read('supabase-migration-v105-rollback.sql');
const v74 = read('supabase-migration-v74.sql');
const app = read('app.js');
const provider = read('provider.js');
const privacy = read('privacy.html');
const worker = read('sw.js');
const integration = read('visitor-presence-v105-integration-test.sh');
const workflow = readFileSync(join(root, '..', '.github', 'workflows', 'minuta-safe-release.yml'), 'utf8');
const guard = read('scripts/migration-safety-guard.mjs');

assert.match(migration, /^-- v105:[\s\S]*\nbegin;[\s\S]*\ncommit;\s*$/i, 'v105 must be atomic');
assert.match(migration, /to_regprocedure\('public\.normalize_client_phone\(text\)'\)/, 'v105 must require the immutable phone normalizer');
assert.match(migration, /bookings_organization_phone_v105_idx[\s\S]*organization_id,public\.normalize_client_phone\(client_phone\),created_at desc,id desc/i, 'known-client lookup needs an organization-scoped phone index');
assert.match(migration, /where booking\.organization_id=v_organization[\s\S]*normalize_client_phone\(booking\.client_phone\)=v_normalized_phone[\s\S]*lower\(pg_catalog\.btrim\(booking\.client_name\)\)=pg_catalog\.lower\(v_submitted_name\)/i, 'known-client identity must match organization, phone and name');
assert.doesNotMatch(migration, /booking\.organization_id=v_organization\s+or\s+exists/i, 'a performer membership must not widen known-client lookup across organizations');
assert.match(migration, /booking_page_visits_owner_session_idx[\s\S]*organization_id,performer_id,session_id/i, 'presence session uniqueness must include organization');
assert.match(migration, /hashtextextended\(v_organization::text\|\|':'\|\|v_performer::text,105\)/i, 'quota checks must share one organization/owner advisory lock');
assert.match(migration, /v_recent_new_count>=60\s+or\s+v_retained_count>=2500/i, 'anonymous presence must have a server-side rate and retained-row cap');
assert.match(migration, /v_existing_seen_at<=pg_catalog\.now\(\)-interval '10 seconds'/i, 'heartbeats must be throttled on the server');
assert.match(migration, /security definer set search_path to ''/i, 'public RPC must pin an empty search path');
assert.match(migration, /revoke all on function public\.upsert_public_booking_presence[^;]+from public,anon,authenticated,service_role;/i, 'RPC ACL must be reset before grants');
assert.match(migration, /grant execute on function public\.upsert_public_booking_presence[^;]+to anon,authenticated,service_role;/i, 'public RPC must be explicitly callable by supported API roles');

assert.match(rollback, /^-- v105 rollback:[\s\S]*\nbegin;[\s\S]*\ncommit;\s*$/i, 'v105 rollback must be atomic');
assert.match(rollback, /drop index if exists public\.bookings_organization_phone_v105_idx;/i, 'rollback must remove the phone lookup index');
assert.match(rollback, /drop function if exists public\.upsert_public_booking_presence/i, 'rollback must remove the v105 RPC');
assert.match(rollback, /join public\.performer_profiles profile on profile\.id\s*=\s*membership\.user_id[\s\S]*membership\.role in \('owner',\s*'admin'\)/i, 'rollback must restore the exact v74 recipient query');
const legacyFunctionPattern = /create or replace function public\.register_public_booking_visit\(p_slug text\)[\s\S]*?grant execute on function public\.register_public_booking_visit\(text\) to anon, authenticated, service_role;/i;
assert.equal(rollback.match(legacyFunctionPattern)?.[0].replace(/\r\n/g,'\n'), v74.match(legacyFunctionPattern)?.[0].replace(/\r\n/g,'\n'), 'rollback must restore the exact v74 function body and ACL');

assert.match(app, /const storageKey = `\$\{VISITOR_PRESENCE_KEY\}:\$\{requestedOrganizationSlug \|\| 'default'\}`;/, 'browser presence session must be scoped per organization slug');
assert.match(app, /VISITOR_FIRST_SOURCE_TTL = 90 \* 24 \* 60 \* 60 \* 1000/, 'first-source attribution needs a finite TTL');
assert.match(app, /Date\.now\(\) - savedAt <= VISITOR_FIRST_SOURCE_TTL/, 'first-source TTL must be enforced');
assert.match(app, /VISITOR_PRESENCE_OPT_OUT_KEY[\s\S]*visitorPresenceAllowed\(\)/, 'booking page must honor visitor-presence opt-out');
assert.match(provider, /const organizationId = organizationController\?\.getActiveOrganization\?\.\(\)\?\.id \|\| ''[\s\S]*if \(!organizationId\) return \{ data:\[\], error:null \}[\s\S]*booking_page_visits'[\s\S]*query = query\.eq\('organization_id', organizationId\)[\s\S]*fallback = fallback\.eq\('organization_id', organizationId\)/i, 'provider presence feed must stay inside the active organization');
assert.match(provider, /onActiveOrganizationChange:[\s\S]*clientOrganizationChanged[\s\S]*void loadBookingSettings\(\)/i, 'presence feed must reload after the active organization changes');
assert.match(privacy, /идентификатор текущей вкладки отдельно для каждой организации[\s\S]*не дольше 90 дней[\s\S]*не дольше 7 дней[\s\S]*оба значения совпали[\s\S]*Отключить учёт посещений/i, 'privacy page must disclose scope, retention, identity matching and opt-out');

assert.equal((workflow.match(/-f minuta-online-booking\/supabase-migration-v105\.sql/g) || []).length, 3, 'workflow must apply v105 twice in test and once in production');
assert.match(workflow, /node --check minuta-online-booking\/visitor-presence-v105-static-test\.mjs[\s\S]*node minuta-online-booking\/visitor-presence-v105-static-test\.mjs/, 'workflow must syntax-check and run the v105 static test');
assert.match(workflow, /bash -n minuta-online-booking\/visitor-presence-v105-integration-test\.sh[\s\S]*bash minuta-online-booking\/visitor-presence-v105-integration-test\.sh/, 'workflow must syntax-check and run the v105 integration test');
assert.match(integration, /run_presence >"\$log_one"[\s\S]*run_presence >"\$log_two"[\s\S]*did not suppress the duplicate[\s\S]*generate_series\(1,70\)[\s\S]*count\(\*\)<=60/i, 'integration test must exercise concurrent dedupe and the server cap');
assert.match(workflow, /supabase-migration-v105-rollback\.sql[\s\S]*supabase-migration-v104-rollback\.sql/, 'test rollback must undo v105 before v104');
assert.match(workflow, /sed -E[^\n]+supabase-migration-v105\.sql[\s\S]*sed -E[^\n]+supabase-migration-v105-rollback\.sql/, 'production validation must transactionally apply and undo v105');
assert.match(workflow, /v105_before=.*v105-state-hash\.sql[\s\S]*v105_after=.*v105-state-hash\.sql[\s\S]*test "\$v105_before" = "\$v105_after"/, 'production validation must prove the v105 schema, ACL and policy state is unchanged');
assert.match(guard, /104, 105/, 'migration guard release tail must include v105');
assert.match(guard, /\[105, 2\]/, 'migration guard must require two v105 test applications');
assert.match(guard, /\[105, 1\]/, 'migration guard must require one v105 production application');

assert.match(worker, /const CACHE = `\$\{CACHE_PREFIX\}v396`;/, 'service-worker cache must be bumped atomically');
assert.match(worker, /'\.\/privacy\.js\?v=396'/, 'privacy opt-out code must be precached');
for (const name of ['index.html','provider.html','booking.html','my-bookings.html','waitlist.html','privacy.html','sw.js','site-update.js']) {
  assert.doesNotMatch(read(name), /v=(?:316|317)/, `${name} still references a stale mixed cache version`);
}

console.log('visitor presence v105 security and release checks passed');
