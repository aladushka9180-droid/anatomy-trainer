import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(root, "..");
const migration = await readFile(path.join(root, "supabase-migration-v47.sql"), "utf8");
const webhook = await readFile(
  path.join(repositoryRoot, "supabase/functions/payment-webhook/index.ts"),
  "utf8",
);
const adapter = await readFile(
  path.join(repositoryRoot, "supabase/functions/payment-webhook/provider-adapter.ts"),
  "utf8",
);
const supabaseConfig = await readFile(
  path.join(repositoryRoot, "supabase/config.toml"),
  "utf8",
);
const safeRelease = await readFile(
  path.join(repositoryRoot, ".github/workflows/minuta-safe-release.yml"),
  "utf8",
);

for (const required of [
  "create table if not exists public.payments",
  "create table if not exists public.payment_events",
  "unique (provider, provider_operation_id)",
  "unique (provider, provider_event_id)",
  "create or replace function public.register_payment_operation",
  "create or replace function public.process_payment_webhook",
  "create or replace function public.adjust_booking_payment_status",
  "create or replace function public.set_booking_payment_status",
  "grant execute on function public.process_payment_webhook",
  "payment_amount_mismatch",
  "webhook_event_conflict",
]) {
  assert.match(migration, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

assert.match(webhook, /verifyAndMapPaymentWebhook\(request, rawBody\)/);
assert.match(webhook, /SUPABASE_SECRET_KEYS/);
assert.match(webhook, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(webhook, /sha256Hex\(rawBody\)/);
assert.doesNotMatch(webhook, /console\.(?:log|error|warn)\(/);
assert.match(adapter, /PAYMENT_WEBHOOK_SIGNING_SECRET/);
assert.match(adapter, /MAX_CLOCK_SKEW_SECONDS = 300/);
assert.match(adapter, /constantTimeEqual/);
assert.match(adapter, /Unsupported payment webhook adapter/);
assert.match(supabaseConfig, /\[functions\.payment-webhook\]\s+verify_jwt = false/);
assert.match(safeRelease, /migration-config-guard\.mjs/);
assert.match(safeRelease, /minuta_migration_guard\.target/);
assert.ok(
  safeRelease.indexOf("minuta_migration_guard.target") < safeRelease.indexOf("supabase-migration-v46.sql"),
  "Защитный маркер тестовой БД должен проверяться до миграций",
);
assert.match(safeRelease, /deno check supabase\/functions\/process-notifications\/index\.ts/);

console.log("Payment foundation static test: OK");
