import {
  verifyAndMapPaymentWebhook,
  WebhookAuthenticationError,
  WebhookConfigurationError,
  WebhookPayloadError,
} from "./provider-adapter.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function requiredServerEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new WebhookConfigurationError(`Missing ${name}`);
  return value;
}

function serverCredential(): { key: string; legacyJwt: boolean } {
  const secretKeysJson = Deno.env.get("SUPABASE_SECRET_KEYS")?.trim();
  if (secretKeysJson) {
    try {
      const secretKeys = JSON.parse(secretKeysJson);
      if (typeof secretKeys.default === "string" && secretKeys.default) {
        return { key: secretKeys.default, legacyJwt: false };
      }
    } catch {
      throw new WebhookConfigurationError("Invalid SUPABASE_SECRET_KEYS");
    }
  }

  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (legacyKey) return { key: legacyKey, legacyJwt: true };
  throw new WebhookConfigurationError("Missing Supabase server credential");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  try {
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > 131072) {
      return jsonResponse(413, { error: "payload_too_large" });
    }
    const rawBody = await request.text();
    if (!rawBody || rawBody.length > 131072) {
      return jsonResponse(413, { error: "payload_too_large" });
    }

    // Verification always happens over the untouched body before parsing or RPC.
    const event = await verifyAndMapPaymentWebhook(request, rawBody);
    const supabaseUrl = requiredServerEnv("SUPABASE_URL").replace(/\/$/, "");
    const credential = serverCredential();
    const rpcHeaders = {
      apikey: credential.key,
      "content-type": "application/json",
      ...(credential.legacyJwt ? { authorization: `Bearer ${credential.key}` } : {}),
    };

    const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/process_payment_webhook`, {
      method: "POST",
      headers: rpcHeaders,
      body: JSON.stringify({
        p_provider: event.provider,
        p_provider_event_id: event.providerEventId,
        p_provider_operation_id: event.providerOperationId,
        p_event_type: event.eventType,
        p_target_status: event.targetStatus,
        p_amount_minor: event.amountMinor,
        p_currency: event.currency,
        p_event_created_at: event.eventCreatedAt,
        p_payload_sha256: await sha256Hex(rawBody),
      }),
    });

    if (!rpcResponse.ok) {
      // Do not expose PostgREST details or provider payloads to the caller.
      return jsonResponse(503, { error: "payment_processing_unavailable" });
    }

    const result = await rpcResponse.json();
    if (!result?.accepted) {
      return jsonResponse(409, {
        error: result?.error_code ?? "payment_event_rejected",
        retryable: result?.error_code === "unknown_payment_operation",
      });
    }

    return jsonResponse(200, { accepted: true, duplicate: Boolean(result.duplicate) });
  } catch (error) {
    if (error instanceof WebhookAuthenticationError) {
      return jsonResponse(401, { error: "invalid_signature" });
    }
    if (error instanceof WebhookPayloadError) {
      return jsonResponse(400, { error: "invalid_payload" });
    }
    if (error instanceof WebhookConfigurationError) {
      return jsonResponse(503, { error: "webhook_not_configured" });
    }
    return jsonResponse(503, { error: "payment_processing_unavailable" });
  }
});
