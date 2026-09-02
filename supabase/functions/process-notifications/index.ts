type OutboxJob = {
  outbox_id: string;
  lock_token: string;
  event_key: string;
  performer_id: string;
  booking_id: string;
  kind: "booking_created";
  channel: "telegram";
  attempt_no: number;
  booking_code: string;
  client_name: string;
  client_phone: string;
  booking_date: string;
  booking_time: string;
  service_name: string;
  performer_name: string;
};

type TelegramResult = {
  ok?: boolean;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
  result?: { message_id?: number };
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

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
  const raw = requiredEnv("SUPABASE_SECRET_KEYS");
  const keys = JSON.parse(raw) as Record<string, string>;
  const key = keys.default?.trim();
  if (!key) throw new Error("missing_supabase_secret_key");
  return key;
}

async function sameSecret(actual: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(actualHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function restHeaders(secretKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: secretKey,
    "content-type": "application/json",
  };
  // Legacy service-role keys are JWTs. New sb_secret keys must be sent only as apikey.
  if (secretKey.split(".").length === 3) headers.authorization = `Bearer ${secretKey}`;
  return headers;
}

async function rpc<T>(name: string, body: Record<string, unknown>, secretKey: string): Promise<T> {
  const baseUrl = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: restHeaders(secretKey),
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`rpc_${name}_${response.status}:${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

function escapeTelegramHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
  })[character] ?? character);
}

function formatBookingDate(value: string): string {
  const date = new Date(`${value}T12:00:00+04:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Samara",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function telegramMessage(job: OutboxJob): string {
  const time = String(job.booking_time || "").slice(0, 5);
  return [
    "<b>Новая запись</b>",
    "",
    `<b>Клиент:</b> ${escapeTelegramHtml(job.client_name)}`,
    `<b>Телефон:</b> ${escapeTelegramHtml(job.client_phone)}`,
    `<b>Услуга:</b> ${escapeTelegramHtml(job.service_name)}`,
    `<b>Дата:</b> ${escapeTelegramHtml(formatBookingDate(job.booking_date))}`,
    `<b>Время:</b> ${escapeTelegramHtml(time)}`,
    `<b>Код:</b> ${escapeTelegramHtml(job.booking_code)}`,
  ].join("\n");
}

async function sendTelegram(job: OutboxJob, token: string, chatId: string): Promise<TelegramResult> {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: telegramMessage(job),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  let result: TelegramResult;
  try {
    result = await response.json() as TelegramResult;
  } catch {
    result = { ok: false, error_code: response.status, description: "Некорректный ответ Telegram" };
  }
  if (!response.ok || !result.ok) {
    const error = new Error(result.description || `Telegram HTTP ${response.status}`) as Error & {
      status?: number;
      retryAfter?: number;
    };
    error.status = result.error_code || response.status;
    error.retryAfter = result.parameters?.retry_after;
    throw error;
  }
  return result;
}

function isRetryableTelegramStatus(status?: number): boolean {
  return !status || status === 408 || status === 409 || status === 429 || status >= 500;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok");
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let workerSecret: string;
  try {
    workerSecret = requiredEnv("NOTIFICATION_WORKER_SECRET");
  } catch {
    return json({ ok: false, error: "worker_not_configured" }, 503);
  }
  if (!await sameSecret(request.headers.get("x-worker-secret") || "", workerSecret)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  // Refuse to claim work until every delivery dependency is present. This keeps
  // configuration errors from consuming retry attempts.
  let botToken: string;
  let chatId: string;
  let performerId: string;
  let secretKey: string;
  try {
    botToken = requiredEnv("TELEGRAM_BOT_TOKEN");
    chatId = requiredEnv("TELEGRAM_CHAT_ID");
    performerId = requiredEnv("TELEGRAM_PERFORMER_ID");
    secretKey = supabaseSecretKey();
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "configuration_error" }, 503);
  }

  let requestedLimit = 10;
  try {
    const body = await request.json() as { limit?: unknown };
    const parsed = Number(body?.limit);
    if (Number.isInteger(parsed)) requestedLimit = Math.max(1, Math.min(parsed, 20));
  } catch {
    // An empty or invalid body uses the safe default batch size.
  }

  // v74 uses the already scheduled worker tick to release slots whose required
  // prepayment expired. Older schemas do not expose the RPC, so rollout remains
  // backward-compatible while the migration is being applied.
  let expiredUnpaid = 0;
  try {
    expiredUnpaid = Number(await rpc<number>("expire_minuta_unpaid_bookings", { p_limit: 500 }, secretKey) || 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/PGRST202|42883|expire_minuta_unpaid_bookings.*does not exist/i.test(message)) {
      return json({ ok: false, error: "unpaid_expiry_failed" }, 502);
    }
  }

  let jobs: OutboxJob[];
  try {
    jobs = await rpc<OutboxJob[]>("claim_notification_outbox", { p_performer: performerId, p_limit: requestedLimit }, secretKey);
    if (!Array.isArray(jobs)) throw new Error("invalid_claim_response");
    if (jobs.some((job) => job.performer_id !== performerId)) throw new Error("performer_scope_violation");
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "claim_failed" }, 502);
  }

  let sent = 0;
  let retried = 0;
  let failed = 0;
  for (const job of jobs) {
    let result: TelegramResult;
    try {
      result = await sendTelegram(job, botToken, chatId);
    } catch (error) {
      const telegramError = error as Error & { status?: number; retryAfter?: number };
      const retryable = isRetryableTelegramStatus(telegramError.status);
      const safeError = telegramError.status
        ? String(telegramError.message || `Telegram HTTP ${telegramError.status}`).replaceAll(botToken, "[redacted]").slice(0, 1000)
        : "Сетевая ошибка при обращении к Telegram";
      try {
        const state = await rpc<string>("fail_notification_outbox", {
          p_outbox: job.outbox_id,
          p_lock_token: job.lock_token,
          p_error_code: telegramError.status ? `telegram_${telegramError.status}` : "telegram_network_error",
          p_error: safeError,
          p_retryable: retryable,
          p_retry_after_seconds: telegramError.retryAfter ?? null,
        }, secretKey);
        if (state === "pending") retried += 1;
        else failed += 1;
      } catch {
        // The lease will expire and be reclaimed; never log booking or token data.
        failed += 1;
      }
      continue;
    }

    try {
      await rpc("ack_notification_outbox", {
        p_outbox: job.outbox_id,
        p_lock_token: job.lock_token,
        p_provider_message_id: result.result?.message_id == null ? null : String(result.result.message_id),
      }, secretKey);
      sent += 1;
    } catch {
      // Telegram already accepted the message. Keep the lease instead of recording a
      // false delivery failure; the stale lease recovery is the last-resort path.
      failed += 1;
    }
  }

  return json({ ok: failed === 0, expired_unpaid: expiredUnpaid, claimed: jobs.length, sent, retried, failed }, failed ? 207 : 200);
});
