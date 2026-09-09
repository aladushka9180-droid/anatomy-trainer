import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('./supabase-migration-v139.sql', import.meta.url),
  'utf8',
);
const rollback = fs.readFileSync(
  new URL('./supabase-migration-v139-rollback.sql', import.meta.url),
  'utf8',
);
const integration = fs.readFileSync(
  new URL('./tests/primetime-schedule-v139-integration.sql', import.meta.url),
  'utf8',
);
const workflow = fs.readFileSync(
  new URL('../.github/workflows/minuta-v139-safe-release.yml', import.meta.url),
  'utf8',
);

for (const required of [
  "credential.credential_key='schedule_v138'",
  "item->>'mode'='slots'",
  'get_primetime_slot_step_v139',
  'slot_interval_minutes between 5 and 240',
  'booking_time=previous_time+make_interval(mins=>step_minutes)',
  'limit 24',
  'limit 96',
  "v_count<>1",
]) {
  if (!migration.includes(required))
    throw new Error(`missing migration guard: ${required}`);
}
for (const required of [
  'drop function if exists public.get_primetime_schedule_v139',
  'drop function if exists public.get_primetime_slot_ranges_v139',
]) {
  if (!rollback.includes(required))
    throw new Error(`missing rollback step: ${required}`);
}
for (const required of [
  'range_grouping_failed',
  'exact_slot_bound_failed',
  'unauthorized_request_was_accepted',
  'v139_acl_failed',
]) {
  if (!integration.includes(required))
    throw new Error(`missing integration assertion: ${required}`);
}
for (const required of [
  "when credentials and not batch and not ranges then 'ready'",
  '(.mode=="ready" or .mode=="full")',
  '(.state.mode=="ready" or .state.mode=="full")',
  'rm -f /etc/apt/sources.list.d/google-chrome.list',
]) {
  if (!workflow.includes(required))
    throw new Error(`missing workflow state guard: ${required}`);
}

console.log('PrimeTime schedule v139 static checks passed.');
