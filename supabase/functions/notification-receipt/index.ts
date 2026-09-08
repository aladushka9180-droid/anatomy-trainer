import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const encoder = new TextEncoder();
const channels = new Set(["telegram", "email", "sms", "max", "push"]);

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
  const keys = JSON.parse(requiredEnv("SUPABASE_SECRET_KEYS")) as Record<
    string,
    string
  >;
  const key = keys.default?.trim();
  if (!key) throw new Error("missing_supabase_secret_key");
  return key;
}

function restHeaders(secretKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: secretKey,
    "content-type": "application/json",
  };
  if (secretKey.split(".").length === 3) {
    headers.authorization = `Bearer ${secretKey}`;
  }
  return headers;
}

function bytesToHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function constantTimeHexEqual(actual: string, expected: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(actual) || !/^[0-9a-f]{64}$/i.test(expected)) {
    return false;
  }
  let difference = actual.length ^ expected.length;
  for (
    let index = 0;
    index < Math.max(actual.length, expected.length);
    index += 1
  ) {
    difference |= (actual.charCodeAt(index) || 0) ^
      (expected.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function validSignature(
  rawBody: string,
  timestamp: string,
  keyId: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const normalized = signature.toLowerCase().startsWith("sha256=")
    ? signature.slice(7).toLowerCase()
    : "";
  if (!normalized) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${keyId}.${rawBody}`),
  );
  return constantTimeHexEqual(normalized, bytesToHex(digest));
}

type ReceiptBody = {
  channel?: unknown;
  event_key?: unknown;
  organization_id?: unknown;
  outbox_id?: unknown;
  provider_message_id?: unknown;
  delivered_at?: unknown;
  receipt_source?: unknown;
  status?: unknown;
};

function receiptSecret(channel: string, keyId: string): string | null {
  const variable = `NOTIFICATION_RECEIPT_${channel.toUpperCase()}_KEYS`;
  const raw = Deno.env.get(variable)?.trim();
  if (!raw) throw new Error("missing_notification_receipt_channel_keys");
  let keys: unknown;
  try {
    keys = JSON.parse(raw);
  } catch {
    throw new Error("invalid_notification_receipt_channel_keys");
  }
  if (!keys || typeof keys !== "object" || Array.isArray(keys)) {
    throw new Error("invalid_notification_receipt_channel_keys");
  }
  const secret = (keys as Record<string, unknown>)[keyId];
  if (typeof secret !== "string") return null;
  const normalized = secret.trim();
  if (normalized.length < 32) {
    throw new Error("invalid_notification_receipt_channel_secret");
  }
  return normalized;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  let secretKey: string;
  try {
    secretKey = supabaseSecretKey();
  } catch {
    return json({ ok: false, error: "not_configured" }, 503);
  }

  const declaredLength = Number(request.headers.get("content-length") || "");
  if (Number.isFinite(declaredLength) && declaredLength > 16 * 1024) {
    return json({ ok: false, error: "payload_too_large" }, 413);
  }
  const rawBody = await request.text();
  if (encoder.encode(rawBody).byteLength > 16 * 1024) {
    return json({ ok: false, error: "payload_too_large" }, 413);
  }

  let body: ReceiptBody;
  try {
    body = JSON.parse(rawBody) as ReceiptBody;
  } catch {
    return json({ ok: false, error: "invalid_payload" }, 400);
  }
  const channel = String(body.channel || "").trim().toLowerCase();
  const keyId = request.headers.get("x-receipt-key-id")?.trim() || "";
  if (!channels.has(channel) || !/^[a-z0-9_.:-]{1,80}$/i.test(keyId)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  let channelSecret: string | null;
  try {
    channelSecret = receiptSecret(channel, keyId);
  } catch {
    return json({ ok: false, error: "not_configured" }, 503);
  }
  if (!channelSecret) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const timestamp = request.headers.get("x-receipt-timestamp")?.trim() || "";
  const signature = request.headers.get("x-receipt-signature")?.trim() || "";
  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    !/^\d{10}$/.test(timestamp) || !Number.isSafeInteger(timestampSeconds) ||
    timestampSeconds < nowSeconds - 300 || timestampSeconds > nowSeconds + 60 ||
    !await validSignature(rawBody, timestamp, keyId, signature, channelSecret)
  ) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const outboxId = String(body.outbox_id || "").trim().toLowerCase();
  const eventKey = String(body.event_key || "").trim();
  const organizationId = String(body.organization_id || "").trim()
    .toLowerCase();
  const messageId = String(body.provider_message_id || "").trim();
  const source = String(body.receipt_source || "").trim();
  const deliveredAt = new Date(String(body.delivered_at || ""));
  if (
    body.status !== "delivered" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(outboxId) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(organizationId) ||
    eventKey.length < 1 || eventKey.length > 240 ||
    messageId.length < 1 || messageId.length > 240 ||
    source.length < 1 || source.length > 120 ||
    !/^[a-z0-9_.:-]+$/i.test(source) ||
    Number.isNaN(deliveredAt.getTime()) ||
    deliveredAt.getTime() > Date.now() + 5 * 60 * 1000 ||
    deliveredAt.getTime() < Date.now() - 90 * 24 * 60 * 60 * 1000
  ) {
    return json({ ok: false, error: "invalid_payload" }, 400);
  }

  const baseUrl = Deno.env.get("SUPABASE_URL")?.trim().replace(/\/$/, "") || "";
  try {
    if (new URL(baseUrl).protocol !== "https:") {
      throw new Error("invalid_protocol");
    }
  } catch {
    return json({ ok: false, error: "not_configured" }, 503);
  }
  let response: Response;
  try {
    response = await fetch(
      `${baseUrl}/rest/v1/rpc/confirm_minuta_notification_delivery_v126`,
      {
        method: "POST",
        headers: restHeaders(secretKey),
        body: JSON.stringify({
          p_outbox: outboxId,
          p_event_key: eventKey,
          p_organization: organizationId,
          p_channel: channel,
          p_provider_message_id: messageId,
          p_delivered_at: deliveredAt.toISOString(),
          p_receipt_source: source,
        }),
      },
    );
  } catch {
    return json({ ok: false, error: "receipt_store_unavailable" }, 502);
  }
  if (!response.ok) {
    return json({ ok: false, error: "receipt_store_rejected" }, 502);
  }
  let state: unknown;
  try {
    state = JSON.parse(await response.text());
  } catch {
    return json({ ok: false, error: "receipt_store_invalid_response" }, 502);
  }
  if (state === "not_found") {
    return json({ ok: false, error: "receipt_target_not_found" }, 404);
  }
  if (state !== "delivered") {
    return json({ ok: false, error: "receipt_store_rejected" }, 502);
  }
  return json({ ok: true, state: "delivered" });
});
