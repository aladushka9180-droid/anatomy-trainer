import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = name => readFileSync(join(root,name),'utf8');
const migration = read('supabase-migration-v104.sql');
const rollback = read('supabase-migration-v104-rollback.sql');
const calendar = read('team-calendar.js');
const integration = read('team-calendar-concurrency-v104-integration-test.sh');
const migrationGuard = readFileSync(join(root,'scripts','migration-safety-guard.mjs'),'utf8');
const releaseWorkflow = readFileSync(join(root,'..','.github','workflows','minuta-safe-release.yml'),'utf8');

assert.match(migration,/^--[^\n]*\nbegin;[\s\S]*commit;\s*$/i,'v104 migration must be atomic');
assert.match(migration,/get_minuta_schedule_role\(p_organization\)[\s\S]*team_booking_move_denied[\s\S]*pg_advisory_xact_lock/i,'v104 must authorize before reading or locking a booking');
assert.match(migration,/pg_advisory_xact_lock\(hashtextextended\(p_booking::text,7302\)\)[\s\S]*for update[\s\S]*team_booking_changed/i,'v104 must lock before comparing the expected point');
assert.match(migration,/is distinct from p_expected_performer[\s\S]*is distinct from p_expected_location[\s\S]*is distinct from p_expected_service[\s\S]*is distinct from p_expected_date[\s\S]*is distinct from p_expected_time/i,'v104 must compare every scheduling coordinate and the service');
assert.match(migration,/revoke all[\s\S]*from public,anon,authenticated,service_role[\s\S]*grant execute[\s\S]*to authenticated/i,'v104 must expose only the protected authenticated RPC');
assert.match(rollback,/drop function if exists public\.move_minuta_team_booking_v104/i,'v104 must have a rollback');
assert.match(calendar,/move_minuta_team_booking_v104[\s\S]*p_expected_performer[\s\S]*p_expected_location[\s\S]*p_expected_service[\s\S]*p_expected_date[\s\S]*p_expected_time/i,'calendar moves must send the complete expected point');
assert.match(calendar,/expected:\{[\s\S]*service_id:current\.service_id[\s\S]*bookingMatchesPoint[\s\S]*item\.service_id === point\.service_id/i,'undo must compare the expected service locally');
assert.match(calendar,/targetServiceId:state\.previous\.service_id/i,'undo must restore the exact previous service');
assert.match(calendar,/requireAtomic[\s\S]*atomic_team_booking_move_unavailable/i,'undo must not fall back to a non-atomic RPC');
assert.match(integration,/run_move "\$first_target"[\s\S]*run_move "\$second_target"[\s\S]*expected exactly one successful move[\s\S]*team_booking_changed[\s\S]*team_booking_moved/i,'PostgreSQL integration must prove one concurrent winner, a stale loser and one audit event');
assert.match(releaseWorkflow,/team-calendar-concurrency-v104-integration-test\.sh/i,'isolated migration workflow must run the v104 concurrency integration');
assert.match(releaseWorkflow,/team_calendar_atomic_guard[\s\S]*not has_function_privilege\('service_role'/i,'production ACL guard must keep service_role blocked');
assert.match(releaseWorkflow,/supabase-migration-v104\.sql[\s\S]*move_minuta_team_booking_v104/i,'release workflow must apply and verify v104');
assert.match(releaseWorkflow,/supabase-migration-v104-rollback\.sql[\s\S]*supabase-migration-v103-rollback\.sql/i,'rollback validation must remove v104 before v103 and v102');
assert.match(releaseWorkflow,/supabase-migration-v104-rollback\.sql[\s\S]*to_regprocedure\('public\.move_minuta_team_booking_v104[\s\S]*is null/i,'rollback validation must prove that v104 was removed');
assert.match(releaseWorkflow,/team_calendar_atomic_guard[\s\S]*expected_migration_guard[\s\S]*team_calendar_atomic_guard=t/i,'production guard must retain v104 and its ACL');
assert.match(migrationGuard,/REQUIRED_RELEASE_TAIL\s*=\s*\[[^\]]*103\s*,\s*104\s*,\s*105\]/i,'migration guard must require v104 after v103 and before v105');
assert.match(migrationGuard,/\[104\s*,\s*2\][\s\S]*\[104\s*,\s*1\]/i,'migration guard must require two test applications and one production application of v104');

console.log('team calendar v104 concurrency static tests passed');
