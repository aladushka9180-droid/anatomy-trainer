import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  configuredChannels,
  deliverNotification,
  loadAdapterConfiguration,
  notificationChannels,
  type NotificationChannel,
  type NotificationJob,
} from "./adapters.ts";

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function supabaseSecretKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (legacy) return legacy;
  const keys = JSON.parse(requiredEnv("SUPABASE_SECRET_KEYS")) as Record<string, string>;
  const key = keys.default?.trim();
  if (!key) throw new Error("missing_supabase_secret_key");
  return key;
}

async function sameSecret(actual: string, expected: string): Promise<boolean> {
  if (!actual || !expected) return false;
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(leftHash);
  const right = new Uint8Array(rightHash);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0;
}

function restHeaders(secretKey: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: secretKey, "content-type": "application/json" };
  if (secretKey.split(".").length === 3) headers.authorization = `Bearer ${secretKey}`;
  return headers;
}

async function rpc<T>(name: string, body: Record<string, unknown>, secretKey: string): Promise<T> {
  const baseUrl = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: "POST", headers: restHeaders(secretKey), body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`rpc_${name}_${response.status}:${text.slice(0, 240)}`);
  return (text ? JSON.parse(text) : null) as T;
}

function requestedChannels(value: unknown, available: NotificationChannel[]): NotificationChannel[] {
  if (!Array.isArray(value)) return available;
  const requested = new Set(value.map(String));
  return available.filter(channel => requested.has(channel));
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok");
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const workerSecret = Deno.env.get("NOTIFICATION_DISPATCHER_SECRET")?.trim() || "";
  if (!workerSecret) return json({ ok: false, error: "not_configured", component: "dispatcher_secret" }, 503);
  if (!await sameSecret(request.headers.get("x-worker-secret") || "", workerSecret)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let secretKey: string;
  try { secretKey = supabaseSecretKey(); }
  catch { return json({ ok: false, error: "not_configured", component: "supabase" }, 503); }

  const configuration = loadAdapterConfiguration();
  const available = configuredChannels(configuration);
  if (!available.length) return json({
    ok: false, error: "not_configured", component: "delivery_channels",
    missing_channels: notificationChannels,
  }, 503);

  let body: { limit?: unknown; channels?: unknown } = {};
  try { body = await request.json(); } catch { /* safe defaults */ }
  const channels = requestedChannels(body.channels, available);
  if (!channels.length) return json({
    ok: false, error: "not_configured", component: "requested_channels",
    configured_channels: available,
  }, 503);
  const parsedLimit = Number(body.limit);
  const limit = Number.isInteger(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 100)) : 20;

  let remindersQueued = 0;
  try {
    remindersQueued = Number(await rpc<number>("enqueue_due_minuta_booking_reminders", { p_limit: 500 }, secretKey) || 0);
  } catch {
    return json({ ok: false, error: "reminder_enqueue_failed" }, 502);
  }

  let jobs: NotificationJob[];
  try {
    jobs = await rpc<NotificationJob[]>("claim_minuta_notification_outbox", {
      p_channels: channels, p_limit: limit,
    }, secretKey);
    if (!Array.isArray(jobs) || jobs.some(job => !channels.includes(job.channel))) throw new Error("invalid_claim_scope");
  } catch {
    return json({ ok: false, error: "claim_failed" }, 502);
  }

  let sent = 0;
  let retried = 0;
  let failed = 0;
  for (const job of jobs) {
    const result = await deliverNotification(job, configuration);
    if (result.ok) {
      try {
        await rpc("ack_notification_outbox", {
          p_outbox: job.outbox_id,
          p_lock_token: job.lock_token,
          p_provider_message_id: result.providerMessageId || null,
        }, secretKey);
        sent += 1;
      } catch {
        // The provider may already have accepted the message. Leave the lease
        // intact; stale-lease recovery keeps at-least-once semantics explicit.
        failed += 1;
      }
      continue;
    }
    try {
      const state = await rpc<string>("fail_notification_outbox", {
        p_outbox: job.outbox_id,
        p_lock_token: job.lock_token,
        p_error_code: result.errorCode || "delivery_failed",
        p_error: result.errorMessage || "Ошибка доставки",
        p_retryable: result.retryable === true,
        p_retry_after_seconds: result.retryAfterSeconds || null,
      }, secretKey);
      if (state === "pending") retried += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }

  return json({
    ok: failed === 0,
    configured_channels: available,
    reminders_queued: remindersQueued,
    claimed: jobs.length,
    sent, retried, failed,
  }, failed ? 207 : 200);
});
