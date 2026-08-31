const MAX_CLOCK_SKEW_SECONDS = 300;

export class WebhookConfigurationError extends Error {}
export class WebhookAuthenticationError extends Error {}
export class WebhookPayloadError extends Error {}

export type PaymentWebhookEvent = {
  provider: string;
  providerEventId: string;
  providerOperationId: string;
  eventType: string;
  targetStatus: "pending" | "paid" | "failed" | "cancelled" | "refunded";
  amountMinor: number;
  currency: string;
  eventCreatedAt: string;
};

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new WebhookConfigurationError(`Missing ${name}`);
  return value;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left.toLowerCase());
  const rightBytes = new TextEncoder().encode(right.toLowerCase());
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requireText(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) {
    throw new WebhookPayloadError(`Invalid ${field}`);
  }
  return value;
}

function requireInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new WebhookPayloadError(`Invalid ${field}`);
  }
  return value;
}

// This generic adapter is safe for a gateway controlled by Minuta. A real
// payment provider normally defines its own canonical string and signature
// headers, so add a separate named adapter before selecting that provider.
export async function verifyAndMapPaymentWebhook(request: Request, rawBody: string): Promise<PaymentWebhookEvent> {
  const adapter = requiredEnv("PAYMENT_WEBHOOK_ADAPTER");
  if (adapter !== "generic-hmac-sha256-v1") {
    throw new WebhookConfigurationError("Unsupported payment webhook adapter");
  }

  const secret = requiredEnv("PAYMENT_WEBHOOK_SIGNING_SECRET");
  if (secret.length < 32) {
    throw new WebhookConfigurationError("Signing secret must contain at least 32 characters");
  }

  const timestampHeader = request.headers.get("x-minuta-timestamp")?.trim() ?? "";
  const signatureHeader = request.headers.get("x-minuta-signature")?.trim() ?? "";
  if (!/^\d{10}$/.test(timestampHeader) || !/^[0-9a-fA-F]{64}$/.test(signatureHeader)) {
    throw new WebhookAuthenticationError("Missing or malformed signature");
  }

  const timestamp = Number(timestampHeader);
  const currentSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(currentSeconds - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
    throw new WebhookAuthenticationError("Webhook timestamp is outside the replay window");
  }

  const expectedSignature = await hmacSha256Hex(secret, `${timestampHeader}.${rawBody}`);
  if (!constantTimeEqual(expectedSignature, signatureHeader)) {
    throw new WebhookAuthenticationError("Invalid signature");
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not_an_object");
    payload = parsed as Record<string, unknown>;
  } catch {
    throw new WebhookPayloadError("Invalid JSON");
  }

  const configuredProvider = requiredEnv("PAYMENT_PROVIDER_ID").toLowerCase();
  const provider = requireText(payload.provider, "provider", 63).toLowerCase();
  if (provider !== configuredProvider || !/^[a-z0-9][a-z0-9_-]{1,62}$/.test(provider)) {
    throw new WebhookPayloadError("Unexpected provider");
  }

  const targetStatus = requireText(payload.target_status, "target_status", 20);
  if (!["pending", "paid", "failed", "cancelled", "refunded"].includes(targetStatus)) {
    throw new WebhookPayloadError("Invalid target_status");
  }

  const currency = requireText(payload.currency, "currency", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new WebhookPayloadError("Invalid currency");

  const eventCreatedAt = requireText(payload.event_created_at, "event_created_at", 40);
  if (!Number.isFinite(Date.parse(eventCreatedAt))) {
    throw new WebhookPayloadError("Invalid event_created_at");
  }

  return {
    provider,
    providerEventId: requireText(payload.event_id, "event_id"),
    providerOperationId: requireText(payload.operation_id, "operation_id"),
    eventType: requireText(payload.event_type, "event_type", 100),
    targetStatus: targetStatus as PaymentWebhookEvent["targetStatus"],
    amountMinor: requireInteger(payload.amount_minor, "amount_minor"),
    currency,
    eventCreatedAt: new Date(eventCreatedAt).toISOString(),
  };
}
