import fs from 'node:fs';
import assert from 'node:assert/strict';
const read = name => fs.readFileSync(new URL(name, import.meta.url), 'utf8');
const migration = read('./supabase-migration-v110.sql');
const rollback = read('./supabase-migration-v110-rollback.sql');
const provider = read('./provider.html');
const controller = read('./data-governance.js');
const booking = read('./booking.html');
const terms = read('./terms.html');
for (const name of ['organization_data_governance', 'booking_legal_acceptances', 'minuta_data_subject_requests', 'minuta_personal_data_access_log']) { assert.match(migration, new RegExp(`create table if not exists public\\.${name}`)); assert.match(migration, new RegExp(`alter table public\\.${name} enable row level security`)); }
for (const fn of ['record_minuta_booking_legal_acceptance_v110', 'submit_minuta_client_data_request_v110', 'export_minuta_organization_data_v110', 'run_minuta_privacy_cleanup_v110']) { assert.match(migration, new RegExp(`function public\\.${fn}`)); assert.match(rollback, new RegExp(`drop function if exists public\\.${fn}`)); }
assert.match(provider, /id="dataGovernanceCard" data-owner="false"/);
assert.match(provider, /id="exportBookingsExcelBtn"/);
assert.match(provider, /id="fullDataExportDialog"/);
assert.match(provider, /id="fullDataExportConfirm"/);
assert.match(provider, /data-governance\.js\?v=624/);
assert.match(controller, /MAX_REPORT_DAYS = 31/);
assert.match(controller, /application\/zip/);
assert.match(controller, /requireOwner/);
assert.match(controller, /export_minuta_organization_data_v110/);
assert.match(migration, /require_minuta_governance_role_v110\(p_organization,true\)/);
assert.match(migration, /minuta_personal_data_access_log/);
assert.match(booking, /id="clientDataRights"/);
assert.match(terms, /Условия использования/);
console.log('data governance v110 static test: ok');
