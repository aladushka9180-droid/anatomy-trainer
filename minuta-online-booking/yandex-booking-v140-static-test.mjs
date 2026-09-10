import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const migration = read('./supabase-migration-v140.sql');
const rollback = read('./supabase-migration-v140-rollback.sql');
const edgeIndex = read('../supabase/functions/yandex-booking-api/index.ts');
const edgeHandler = read('../supabase/functions/yandex-booking-api/handler.ts');
const edge = `${edgeIndex}\n${edgeHandler}`;
const config = read('../supabase/config.toml');

assert.match(config, /\[functions\.yandex-booking-api\][\s\S]*?verify_jwt\s*=\s*false/i,
  'Yandex uses its own HS256 JWT contract, so the Edge handler must authenticate every request itself');
assert.match(edgeIndex, /Deno\.serve\s*\(/, 'Edge entry must register the reviewed handler');

for (const name of [
  'YANDEX_BOOKING_ENABLED',
  'YANDEX_BOOKING_ENVIRONMENT',
  'YANDEX_BOOKING_PARTNER_NAME',
  'YANDEX_BOOKING_JWT_KEYS',
  'SUPABASE_URL'
]) assert.match(edge, new RegExp(name), `Edge configuration must require ${name}`);
assert.match(edge, /SUPABASE_(?:SERVICE_ROLE_KEY|SECRET_KEYS)/,
  'Database credential must come from server environment');
assert.match(edge, /HS256/, 'JWT algorithm must be pinned to HS256');
assert.match(edge, /\btyp\b[\s\S]{0,180}JWT/i, 'JWT typ must be pinned to JWT');
assert.match(edge, /\bsub\b/, 'JWT partner subject must be checked');
assert.match(edge, /\biat\b/, 'Official no-iat contract must be explicitly enforced');
assert.match(edge, /timingSafe|constantTime|difference\s*\|=|crypto\.subtle\.verify/i,
  'JWT signature comparison must not use an ordinary string equality');
assert.match(edge, /exp[\s\S]{0,500}(?:Date\.now|now)/i,
  'Optional exp must be rejected when expired');
assert.match(edge, /nbf[\s\S]{0,500}(?:Date\.now|now)/i,
  'Optional nbf must be rejected before activation');

for (const route of [
  '/v1/companies/feed',
  '/services',
  '/resources',
  '/available_dates',
  '/available_time_slots',
  '/special_conditions',
  '/v1/bookings'
]) assert.ok(edge.includes(route), `Missing Yandex route ${route}`);
assert.match(edge, /application\/json/i, 'Yandex requests and responses must use JSON');
assert.match(edge, /NOT_CONFIGURED/, 'Missing configuration must fail closed');
assert.match(edge, /UNAUTHORIZED/, 'Authentication failures need one generic response');
assert.match(edge, /PAYLOAD_TOO_LARGE|payload_too_large/i, 'Request bodies need a hard byte limit');
assert.match(edge, /count[\s\S]{0,300}500/i, 'Feed count must be bounded to the official maximum');
assert.match(edge, /cache-control["']?\s*[:,][\s\S]{0,80}no-store/i,
  'Partner responses must not be cached with client data');
assert.doesNotMatch(edge, /redirect\s*\(/i, 'Partner API must not redirect');
assert.doesNotMatch(edge, /\/rest\/v1\/(?!rpc\/)/i,
  'Edge may call only narrow RPCs, never tables through generic PostgREST');

const rpcNames = [
  'consume_yandex_booking_rate_limit_v140',
  'get_yandex_booking_feed_v140',
  'get_yandex_booking_services_v140',
  'get_yandex_booking_resources_v140',
  'get_yandex_booking_available_dates_v140',
  'get_yandex_booking_available_time_slots_v140',
  'get_yandex_booking_special_conditions_v140',
  'create_yandex_booking_v140',
  'get_yandex_booking_v140',
  'update_yandex_booking_v140',
  'cancel_yandex_booking_v140'
];

for (const name of rpcNames) {
  assert.ok(edge.includes(name), `Edge must call narrow RPC ${name}`);
  const start = migration.toLowerCase().indexOf(`create or replace function public.${name}`);
  assert.ok(start >= 0, `Migration must create ${name}`);
  const next = migration.toLowerCase().indexOf('create or replace function public.', start + 1);
  const definition = migration.slice(start, next < 0 ? migration.length : next);
  assert.match(definition, /security definer\s+set search_path\s+to\s+''/i,
    `${name} must pin an empty search_path`);
  assert.match(migration, new RegExp(`revoke all on function public\\.${name}`, 'i'),
    `${name} must revoke default execution`);
  assert.match(migration, new RegExp(`grant execute on function public\\.${name}[\\s\\S]{0,500}to service_role`, 'i'),
    `${name} must be callable only through the service Edge boundary`);
  assert.match(rollback, new RegExp(`drop function if exists public\\.${name}`, 'i'),
    `Rollback must remove ${name}`);
}

assert.match(migration, /partner_name|provider/i, 'Every external object must be scoped to a partner/provider');
assert.match(migration, /environment/i, 'Testing and production identities must be separate');
assert.match(migration, /check\s*\(\s*environment\s+in\s*\(\s*'testing'\s*,\s*'production'\s*\)\s*\)/i,
  'Database environment values must match the Edge testing|production contract');
assert.doesNotMatch(migration, /environment\s+in\s*\(\s*'test'/i,
  'The unsupported test spelling would make Edge testing traffic miss every connection');
assert.match(migration, /external_company_id/i, 'External company IDs need an explicit tenant mapping');
assert.match(migration, /organization_id/i, 'External companies must map to internal organizations');
assert.match(migration,
  /foreign\s+key\s*\(\s*location_id\s*,\s*organization_id\s*\)\s*references\s+public\.locations\s*\(\s*id\s*,\s*organization_id\s*\)/i,
  'Connection location must be constrained to the mapped organization');
assert.match(migration, /yandex_booking_mappings_v140/i, 'External bookings need a scoped mapping');
assert.match(migration, /request_id|request_key|idempotency_key/i, 'Mutations require a stable idempotency identity');
assert.match(migration, /payload_(?:sha256|hash)/i, 'Changed replays must be distinguishable from exact replays');
assert.match(migration, /unique\s*\([^)]*(?:partner_name|provider)[^)]*environment[^)]*(?:external_)?company_id/is,
  'Company identity must be unique inside partner and environment scope');
assert.match(migration, /unique\s*\([^)]*connection_id[^)]*local_booking_id/is,
  'Booking identity must be unique inside a tenant connection');
const receiptTable = migration.slice(
  migration.indexOf('create table if not exists public.yandex_booking_receipts_v140'),
  migration.indexOf('create table if not exists public.yandex_booking_rate_limits_v140')
);
assert.match(receiptTable, /connection_id|external_company_id/i,
  'Mutation receipts must include tenant scope; provider + environment + request key alone is insufficient');

const createdTables = [...migration.matchAll(/create table if not exists public\.((?:yandex_booking|primetime_partner)_[a-z0-9_]+)/gi)]
  .map(match => match[1]);
assert.ok(createdTables.length >= 2, 'Separate connection and booking/request state tables are expected');
for (const table of new Set(createdTables)) {
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'),
    `${table} must enable RLS`);
  assert.match(migration, new RegExp(`revoke all on (?:table )?public\\.${table}[\\s\\S]{0,300}service_role`, 'i'),
    `${table} must not be directly accessible, including to service_role`);
  assert.match(rollback, new RegExp(`drop table if exists public\\.${table}(?![^;]*cascade)`, 'i'),
    `Rollback must remove ${table} without CASCADE`);
}
assert.doesNotMatch(migration, /grant\s+(?:select|insert|update|delete)[^;]*(?:yandex_booking|primetime_partner)_[^;]*to\s+service_role/i,
  'The service Edge credential must use narrow RPCs, not direct partner-table privileges');

assert.match(migration, /pg_advisory_xact_lock/i, 'Concurrent mutation attempts must serialize');
assert.match(migration, /for update/i, 'Booking state must be re-read while locked');
assert.match(migration, /request_conflict|idempotency_conflict|payload_conflict/i,
  'A changed replay must fail rather than reuse or overwrite an earlier receipt');
assert.match(migration, /book_minuta_appointment/i,
  'Creation must reuse the established tenant and slot-safe booking core');
assert.match(migration, /reschedule_booking_v2/i,
  'Rescheduling must reuse the established idempotent booking core');
assert.match(migration, /cancel_minuta_booking_core|cancel_booking_v2/i,
  'Cancellation must reuse the established locked cancellation core');
assert.doesNotMatch(migration, /insert\s+into\s+public\.bookings/i,
  'The partner adapter must not bypass booking invariants with a direct insert');
assert.doesNotMatch(migration, /set_config\s*\(\s*'request\.jwt\.claim\.sub'/i,
  'The partner boundary must never impersonate a Supabase user');
assert.doesNotMatch(migration, /session_replication_role|disable\s+trigger/i,
  'The migration must not bypass production constraints or triggers');
assert.doesNotMatch(migration, /primetime_partner_/i,
  'The Yandex migration must not reference an obsolete table family that it does not create');
assert.match(migration, /to_regclass\s*\(\s*'public\.organization_client_profiles'\s*\)/i,
  'Migration must require the canonical blocked-client profile table');
assert.match(migration, /to_regprocedure\s*\(\s*'public\.normalize_client_phone\(text\)'\s*\)/i,
  'Migration must require canonical phone normalization');

const createStart = migration.toLowerCase().indexOf('create or replace function public.create_yandex_booking_v140');
const createEnd = migration.toLowerCase().indexOf('create or replace function public.', createStart + 1);
const createDefinition = migration.slice(createStart, createEnd);
const blockedCheck = createDefinition.indexOf('public.organization_client_profiles');
const paymentRecheck = createDefinition.indexOf('public.minuta_yandex_service_payment_free_v140');
const canonicalCreate = createDefinition.indexOf('public.book_minuta_appointment');
assert.ok(
  createDefinition.includes('public.normalize_client_phone') && blockedCheck >= 0 &&
  createDefinition.includes('online_booking_blocked') && createDefinition.includes('create_forbidden') &&
  blockedCheck < canonicalCreate,
  'Canonical blocked clients must be rejected before the service-role booking core',
);
assert.ok(paymentRecheck >= 0 && paymentRecheck < canonicalCreate,
  'Deposit policy must be rechecked immediately before the canonical booking core');

const paymentHelperStart = migration.toLowerCase().indexOf(
  'create or replace function public.minuta_yandex_service_payment_free_v140',
);
const paymentHelperEnd = migration.toLowerCase().indexOf('create or replace function public.', paymentHelperStart + 1);
const paymentHelper = migration.slice(paymentHelperStart, paymentHelperEnd);
assert.match(paymentHelper, /organization_booking_policy_settings[\s\S]*?resolve_minuta_booking_policy[\s\S]*?deposit_mode/is,
  'Enabled organization policy must resolve to deposit_mode none');
assert.match(paymentHelper, /booking_policies[\s\S]*?deposit_enabled[\s\S]*?deposit_amount_rub/is,
  'Legacy performer deposits must be excluded while organization policies are disabled');
const servicesHelperStart = migration.toLowerCase().indexOf(
  'create or replace function public.minuta_yandex_services_v140',
);
const servicesHelperEnd = migration.toLowerCase().indexOf('create or replace function public.', servicesHelperStart + 1);
assert.match(migration.slice(servicesHelperStart, servicesHelperEnd), /minuta_yandex_service_payment_free_v140/i,
  'Deposit-requiring services must not be advertised by feed or service listing');

const exactPriceRanges = migration.match(
  /jsonb_build_array\s*\(\s*service\.price_rub\s*,\s*service\.price_rub\s*\)/gi,
) ?? [];
assert.ok(exactPriceRanges.length >= 2,
  'Feed and services responses must express an exact price as range [price, price]');

const cancelStart = migration.toLowerCase().indexOf('create or replace function public.cancel_yandex_booking_v140');
const cancelDefinition = migration.slice(cancelStart);
assert.match(cancelDefinition, /p_booking_id\s+text\s*,\s*p_company_id\s+text/i,
  'Cancellation RPC must accept the PUT company scope');
assert.match(cancelDefinition,
  /p_company_id\s+is\s+not\s+null[\s\S]{0,200}external_company_id\s*<>\s*p_company_id[\s\S]{0,200}company_not_found/i,
  'PUT cancellation must reject a booking mapped to another company before mutation');
assert.match(rollback,
  /drop function if exists public\.cancel_yandex_booking_v140\s*\(\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*text\s*\)/i,
  'Rollback must remove the company-scoped cancellation signature');

for (const name of ['update_yandex_booking_v140', 'cancel_yandex_booking_v140']) {
  const start = migration.toLowerCase().indexOf(`create or replace function public.${name}`);
  const next = migration.toLowerCase().indexOf('create or replace function public.', start + 1);
  const definition = migration.slice(start, next < 0 ? migration.length : next).toLowerCase();
  const bookingLockMatch = /pg_advisory_xact_lock\s*\(\s*hashtextextended\s*\([^;]*?,\s*7302\s*\)\s*\)/i.exec(definition);
  const bookingLock = bookingLockMatch?.index ?? -1;
  const rowLock = definition.indexOf('for update');
  assert.ok(bookingLock >= 0 && rowLock >= 0 && bookingLock < rowLock,
    `${name} must take the shared booking advisory lock before a booking row lock`);
  assert.match(definition,
    /pg_advisory_xact_lock\s*\(\s*hashtextextended\s*\(\s*v_partner\.local_booking_id::text\s*,\s*7302\s*\)\s*\)/i,
    `${name} must derive the lock key from the mapped booking before reading its row`);
}

for (const name of [
  'get_yandex_booking_available_dates_v140',
  'get_yandex_booking_available_time_slots_v140',
  'get_yandex_booking_special_conditions_v140',
  'create_yandex_booking_v140',
  'update_yandex_booking_v140',
]) {
  const start = migration.toLowerCase().indexOf(`create or replace function public.${name}`);
  const next = migration.toLowerCase().indexOf('create or replace function public.', start + 1);
  const definition = migration.slice(start, next < 0 ? migration.length : next);
  assert.match(definition,
    /clock_timestamp\s*\(\s*\)\s+at\s+time\s+zone\s+v_connection\.timezone/i,
    `${name} must derive today from the mapped location timezone`);
  assert.doesNotMatch(definition, /\bcurrent_date\b/i,
    `${name} must not use the database session date for location-local bounds`);
}

assert.match(migration, /export_minuta_organization_data_v110|run_minuta_privacy_cleanup_v110|partner_booking.*retention/is,
  'Partner comments/email must participate in organization export and retention, or must not be stored separately');

assert.match(rollback, /v140_rollback_blocked|raise exception/i,
  'Rollback must refuse to orphan live external mappings');
assert.doesNotMatch(rollback, /\bcascade\b/i, 'Rollback must not use CASCADE');

console.log('Yandex booking v140 static security contract: PASS');
