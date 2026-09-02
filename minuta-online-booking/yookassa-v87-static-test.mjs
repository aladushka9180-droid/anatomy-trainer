import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(root, "..");
const read = (relative) => readFile(path.join(repositoryRoot, relative), "utf8");

const [migration, rollback, shared, createPayment, webhook, refund, config, documentation, app, booking, paymentManagement, providerHtml, providerJs] = await Promise.all([
  read("minuta-online-booking/supabase-migration-v87.sql"),
  read("minuta-online-booking/supabase-migration-v87-rollback.sql"),
  read("supabase/functions/_shared/yookassa.ts"),
  read("supabase/functions/yookassa-create-payment/index.ts"),
  read("supabase/functions/payment-webhook/index.ts"),
  read("supabase/functions/yookassa-refund/index.ts"),
  read("supabase/config.toml"),
  read("minuta-online-booking/PAYMENT_FOUNDATION.md"),
  read("minuta-online-booking/app.js"),
  read("minuta-online-booking/booking.js"),
  read("minuta-online-booking/payment-management.js"),
  read("minuta-online-booking/provider.html"),
  read("minuta-online-booking/provider.js"),
]);

for (const required of [
  "create table if not exists public.organization_payment_provider_settings",
  "enabled boolean not null default false",
  "create table if not exists public.payment_provider_attempts",
  "create table if not exists public.payment_provider_refunds",
  "create table if not exists public.payment_provider_events",
  "create table if not exists public.payment_provider_reconciliations",
  "unique(organization_id,idempotency_key)",
  "unique(organization_id,request_id)",
  "payment_provider_attempts_one_open_booking_idx",
  "'idempotency_key',v_attempt.idempotency_key",
  "create or replace function public.get_yookassa_payment_capability",
  "'can_create',v_eligible and v_enabled",
  "create or replace function public.prepare_yookassa_payment",
  "create or replace function public.prepare_yookassa_refund",
  "create or replace function public.process_yookassa_payment_event",
  "create or replace function public.process_yookassa_refund_event",
  "create or replace function public.record_yookassa_reconciliation",
  "grant execute on function %s to service_role",
  "mode','legacy_link'",
  "fallback_url",
]) assert.ok(migration.includes(required), `Не найден обязательный контракт v87: ${required}`);

assert.match(migration, /revoke all on table[\s\S]+from public,anon,authenticated,service_role/);
assert.match(migration, /has_organization_role\(organization_id,array\['owner','admin'\]\)/);
assert.match(migration, /v_role:=public\.require_minuta_payment_role\(p_organization,p_actor,array\['owner','admin'\]\)/);
assert.match(migration, /v_attempt\.captured_amount_minor-\(v_reserved\+p_amount_minor\) between 1 and 99/);
assert.match(migration, /v_booking\.payment_status is distinct from 'pending'/);
assert.ok(
  migration.indexOf("v_booking.payment_status is distinct from 'pending'") < migration.indexOf("'mode','legacy_link'"),
  "Прямой вызов Edge не должен возвращать legacy-ссылку для уже оплаченной или возвращённой записи",
);
assert.match(rollback, /drop table if exists public\.payment_provider_attempts/);
assert.match(rollback, /drop function if exists public\.process_yookassa_payment_event/);
assert.match(rollback, /drop function if exists public\.get_yookassa_payment_capability/);
assert.match(rollback, /v87_rollback_blocked_payment_data_exists/);

assert.match(shared, /YOOKASSA_ACCOUNTS_JSON/);
assert.match(shared, /YOOKASSA_ORGANIZATION_ID/);
assert.match(shared, /YOOKASSA_TEST_SECRET_KEY/);
assert.match(shared, /YOOKASSA_SECRET_KEY/);
assert.match(shared, /https:\/\/api\.yookassa\.ru\/v3/);
assert.match(shared, /idempotence-key/);
assert.match(shared, /osn: 1/);
assert.match(shared, /usn_income: 2/);
assert.match(shared, /usn_income_outcome: 3/);
assert.match(shared, /esn: 5/);
assert.match(shared, /patent: 6/);
assert.doesNotMatch(shared, /esn: 4|patent: 5|ausn:/);
assert.match(shared, /function yookassaTaxSystemCode/);
assert.doesNotMatch(shared, /console\.(?:log|error|warn)\(/);

assert.match(createPayment, /prepare_yookassa_payment/);
assert.match(createPayment, /idempotenceKey: prepared\.idempotency_key/);
assert.match(createPayment, /capture: true/);
assert.match(createPayment, /tax_system_code: yookassaTaxSystemCode\(prepared\.taxation\)/);
assert.match(createPayment, /metadata:[\s\S]+minuta_attempt_id/);
assert.match(createPayment, /mode: "legacy_link"/);
assert.doesNotMatch(createPayment, /body\.amount_minor/);
assert.doesNotMatch(createPayment, /console\.(?:log|error|warn)\(/);

assert.match(webhook, /PAYMENT_WEBHOOK_ADAPTER/);
assert.match(webhook, /=== "yookassa-v1"/);
assert.match(webhook, /=== "hybrid-v1"/);
assert.match(webhook, /looksLikeYooKassaNotification\(rawBody\)/);
assert.match(webhook, /verifyAndMapPaymentWebhook\(request, rawBody, "generic-hmac-sha256-v1"\)/);
assert.match(webhook, /YooKassa does not sign notifications/);
assert.ok(
  webhook.indexOf("yookassaRequest<ProviderObject>") < webhook.indexOf("process_yookassa_payment_event"),
  "Контрольный GET ЮKassa должен выполняться до фиксации webhook",
);
assert.match(webhook, /metadataScope\(canonical\)/);
assert.match(webhook, /canonical\.test !== \(scope\.environment === "test"\)/);

assert.match(refund, /authenticatedUserId\(request\)/);
assert.match(refund, /prepare_yookassa_refund/);
assert.match(refund, /idempotenceKey: prepared\.request_id/);
assert.match(refund, /complete_yookassa_refund/);
assert.match(refund, /minuta_refund_id/);
assert.match(refund, /tax_system_code: yookassaTaxSystemCode\(prepared\.taxation\)/);
assert.doesNotMatch(refund, /console\.(?:log|error|warn)\(/);

assert.match(config, /\[functions\.payment-webhook\]\s+verify_jwt = false/);
assert.match(config, /\[functions\.yookassa-create-payment\]\s+verify_jwt = false/);
assert.match(config, /\[functions\.yookassa-refund\]\s+verify_jwt = false/);
assert.match(documentation, /YOOKASSA_ACCOUNTS_JSON/);

for (const source of [app, booking]) {
  assert.match(source, /get_yookassa_payment_capability/);
  assert.match(source, /yookassa-create-payment/);
  assert.match(source, /request_id:paymentRequestId\(/);
  assert.doesNotMatch(source, /amount_minor\s*:/);
}

assert.match(paymentManagement, /function owner\(\) \{ return currentRole\(\) === 'owner'; \}/);
assert.match(paymentManagement, /\$\('#paymentProviderSettingsForm'\)\.hidden = !owner\(\)/);
assert.match(paymentManagement, /\$\('#paymentRefundForm'\)\.hidden = !manager\(\)/);
assert.match(paymentManagement, /refreshNavigation\(\)/);
assert.match(paymentManagement, /isCheckoutEnabled:[\s\S]+payload\?\.settings\?\.enabled/);
assert.match(providerJs, /refreshNavigation:refreshSectionNavigation/);
assert.match(providerJs, /!managedCheckoutEnabled/);
assert.match(providerHtml, /option value="esn"/);
assert.doesNotMatch(providerHtml, /option value="ausn"/);
for (let vat = 1; vat <= 12; vat += 1) assert.match(providerHtml, new RegExp(`option value="${vat}"`));

for (const source of [migration, shared, createPayment, webhook, refund, documentation]) {
  assert.doesNotMatch(source, /(?:secret_key|shop_id)\s*[:=]\s*["'][^<\s$][^"']{8,}["']/i);
}

console.log("YooKassa v87 static test: OK");
