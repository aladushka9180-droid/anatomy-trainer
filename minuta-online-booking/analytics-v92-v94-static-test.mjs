import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = name => readFileSync(join(root, name), 'utf8');
const v92 = read('supabase-migration-v92.sql');
const rollback92 = read('supabase-migration-v92-rollback.sql');
const v93 = read('supabase-migration-v93.sql');
const rollback93 = read('supabase-migration-v93-rollback.sql');
const v94 = read('supabase-migration-v94.sql');
const rollback94 = read('supabase-migration-v94-rollback.sql');
const v96 = read('supabase-migration-v96.sql');
const rollback96 = read('supabase-migration-v96-rollback.sql');
const integration96 = read('analytics-v92-v96-integration.sql');
const releaseWorkflow = readFileSync(join(root, '..', '.github', 'workflows', 'minuta-safe-release.yml'), 'utf8');
const provider = read('provider.js');
const validationBlock = /^  validate-production-rollback:\r?\n([\s\S]*?)(?=^  [a-zA-Z][a-zA-Z0-9-]*:)/m.exec(releaseWorkflow)?.[0] || '';

for (const [name, sql] of Object.entries({ rollback92, v93, rollback93, v94, rollback94 })) {
  assert.match(sql, /^begin;/i, `${name}: нет атомарного начала транзакции`);
  assert.match(sql, /commit;\s*$/i, `${name}: нет завершения транзакции`);
}

assert.match(v92, /v92_requires_v54_v65_v68_v72/, 'v92: нет проверки prerequisites');
assert.match(v92, /^\\set ON_ERROR_STOP on[\s\S]*?begin;[\s\S]*?commit;[\s\S]*?validate constraint bookings_creation_attribution_check/i, 'v92: DDL и валидация большой таблицы не разделены');
assert.match(v92, /foreign key \(created_by_user_id\) references auth\.users\(id\)[\s\S]*?on delete set null not valid/i, 'v92: FK автора не создаётся безопасно');
assert.match(v92, /create index concurrently if not exists bookings_source_organization_date_v92_idx/i, 'v92: индекс источника создаётся с блокировкой production-записей');
assert.match(v92, /v92_incompatible_existing_index/, 'v92: нет защиты от индекса с неверным определением');
assert.match(v92, /bookings_creation_attribution_check/, 'v92: нет ограничения источника записи');
assert.match(v92, /security definer[\s\S]*set search_path to ''/, 'v92: функции не закрепляют search_path');
assert.match(v92, /revoke all on function public\.get_minuta_team_analytics\(date,date\)[\s\S]*grant execute[\s\S]*to authenticated/, 'v92: неверные права аналитики');
assert.match(rollback92, /drop function if exists public\.get_minuta_team_analytics\(date,date\)/, 'rollback v92: аналитика не удаляется');
assert.match(rollback92, /drop column if exists booking_source/, 'rollback v92: служебные столбцы не откатываются');

assert.match(v93, /v93_(?:missing_prerequisites|requires_v92)/, 'v93: нет проверки prerequisites');
assert.match(v93, /alter table public\.booking_events enable row level security/, 'v93: журнал событий без RLS');
assert.match(v93, /create policy booking_events_member_read_v93[\s\S]*performer_id=auth\.uid\(\)/, 'v93: специалист не ограничен своими событиями');
assert.match(v93, /revoke all on table public\.booking_events from public,anon,authenticated,service_role/, 'v93: нет закрытого ACL по умолчанию');
assert.match(v93, /grant select on table public\.booking_events to authenticated/, 'v93: кабинет не может читать разрешённые события');
assert.match(rollback93, /drop trigger if exists booking_outcomes_capture_event_v93/, 'rollback v93: outcome-trigger не удаляется');
assert.match(rollback93, /drop table if exists public\.booking_events/, 'rollback v93: журнал не удаляется');

assert.match(v94, /v94_requires_v93/, 'v94: нет проверки prerequisites');
assert.match(v94, /get_minuta_staff_report_bookings\([\s\S]*p_limit integer[\s\S]*p_offset integer/, 'v94: нет постраничной RPC отчёта сотрудников');
assert.match(v94, /limit p_limit\+1 offset p_offset/, 'v94: длинная история не загружается страницами');
assert.doesNotMatch(v94, /to_jsonb\(booking\)/, 'v94: отчёт раскрывает весь row записи, включая внутренние поля');
assert.match(rollback94, /drop function if exists public\.get_minuta_staff_report_bookings\(uuid,date,date,uuid,integer,integer\)/, 'rollback v94: RPC отчёта не удаляется');

assert.match(v96, /on delete cascade/, 'v96: удаление записи всё ещё блокируется журналом событий');
assert.match(v96, /p_row \? 'total_price_rub'/, 'v96: составная стоимость не считается по total_price_rub');
assert.match(v96, /get_minuta_team_analytics\(uuid,date,date\)/, 'v96: нет явного контекста организации для аналитики');
assert.match(v96, /v_role is null or v_role not in \('owner','admin'\)/, 'v96: отсутствующий membership может обойти tenant-проверку');
assert.match(v96, /not exists\(select 1 from auth\.users where id=old\.created_by_user_id\)/, 'v96: авторство можно стереть до удаления auth-пользователя');
assert.match(v96, /MINUTA_CONCURRENT_INDEXES_BEGIN[\s\S]*create index concurrently if not exists bookings_performer_date_time_v94_idx/, 'v96: индекс истории создаётся с блокировкой production-записей');
assert.match(v96, /booking_events_scope_previous_date_v96_idx/, 'v96: нет индекса предыдущей даты события');
assert.match(rollback96, /Только для изолированной тестовой базы/, 'rollback v96: нет предупреждения о test-only назначении');
assert.match(integration96, /provider_delete_booking[\s\S]*v96_booking_event_cascade_failed/, 'integration v96: не проверяется удаление записи с событием');
assert.match(integration96, /v96_attribution_set_null_failed/, 'integration v96: не проверяется удаление автора');
assert.match(integration96, /v96_attribution_tamper_was_allowed/, 'integration v96: не проверяется запрет ручного стирания автора');
assert.match(integration96, /v96_explicit_organization_analytics_failed/, 'integration v96: не проверяется multi-org аналитика');
assert.match(integration96, /v96_cross_tenant_analytics_leak/, 'integration v96: не проверяется запрет cross-tenant аналитики');
assert.match(provider, /p_organization:organizationId, p_start:range\.start, p_end:range\.end/, 'provider: аналитика не передаёт активную организацию');
assert.match(provider, /response\.error\.code === 'PGRST202'[\s\S]*p_start:range\.start, p_end:range\.end/, 'provider: нет совместимого fallback до установки v96');
assert.match(provider, /payment_url,booking_source,created_by_user_id,created_by_role,services/, 'provider: загрузка записей не получает атрибуцию');

for (const version of ['92', '93', '94', '96']) {
  assert.match(releaseWorkflow, new RegExp(`supabase-migration-v${version}\\.sql`), `release: v${version} не применяется`);
  assert.match(releaseWorkflow, new RegExp(`supabase-migration-v${version}-rollback\\.sql`), `release: rollback v${version} не проверяется`);
}
assert.match(releaseWorkflow, /supabase-migration-v95\.sql/, 'release: v95 импорта не применяется');
assert.match(releaseWorkflow, /recovery\/rollback-client-import-v95\.sql/, 'release: rollback v95 импорта не проверяется');
assert.match(releaseWorkflow, /supabase-migration-v94\.sql[\s\S]*supabase-migration-v96\.sql[\s\S]*supabase-migration-v95\.sql/, 'release: порядок должен быть v94 → v96 → v95');
assert.doesNotMatch(validationBlock, /supabase-migration-v9[23456]\.sql/, 'release: v92–v96 нельзя репетировать на живой production в длинной транзакции');
assert.match(releaseWorkflow, /MINUTA_TEST_RUN_ID[\s\S]*"test-migration" 21600 test/, 'release: production не требует успешный test-migration');

console.log('analytics v92-v94 static test: OK');
