import {
  verifyAndMapPaymentWebhook,
  WebhookAuthenticationError,
  WebhookConfigurationError,
  WebhookPayloadError,
} from "./provider-adapter.ts";
import {
  ConfigurationError,
  isUuid,
  PayloadError,
  ProviderError,
  requiredString,
  serviceRpc,
  sha256Hex,
  valueToMinor,
  yookassaCredentials,
  yookassaRequest,
  type YooKassaEnvironment,
} from "../_shared/yookassa.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
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
      if (typeof secretKeys.default === "string" && secretKeys.default) return { key: secretKeys.default, legacyJwt: false };
    } catch {
      throw new WebhookConfigurationError("Invalid SUPABASE_SECRET_KEYS");
    }
  }
  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (legacyKey) return { key: legacyKey, legacyJwt: true };
  throw new WebhookConfigurationError("Missing Supabase server credential");
}

type ProviderObject = {
  id?: unknown;
  status?: unknown;
  payment_id?: unknown;
  amount?: { value?: unknown; currency?: unknown };
  created_at?: unknown;
  test?: unknown;
  metadata?: Record<string, unknown>;
};

function notificationObject(payload: Record<string, unknown>): { event: string; object: ProviderObject } {
  if (payload.type !== "notification" || typeof payload.event !== "string"
      || !payload.object || typeof payload.object !== "object" || Array.isArray(payload.object)) {
    throw new PayloadError("invalid_yookassa_notification");
  }
  if (!["payment.waiting_for_capture", "payment.succeeded", "payment.canceled", "refund.succeeded"].includes(payload.event)) {
    throw new PayloadError("unsupported_yookassa_event");
  }
  return { event: payload.event, object: payload.object as ProviderObject };
}

function looksLikeYooKassaNotification(rawBody: string): boolean {
  try {
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    return payload?.type === "notification"
      && typeof payload.event === "string"
      && ["payment.waiting_for_capture", "payment.succeeded", "payment.canceled", "refund.succeeded"].includes(payload.event)
      && Boolean(payload.object)
      && typeof payload.object === "object"
      && !Array.isArray(payload.object);
  } catch {
    return false;
  }
}

function metadataScope(object: ProviderObject): {
  organizationId: string;
  environment: YooKassaEnvironment;
  attemptId: string;
  refundId: string | null;
} {
  const metadata = object.metadata ?? {};
  if (!isUuid(metadata.minuta_organization_id) || !isUuid(metadata.minuta_attempt_id)
      || !["test", "production"].includes(String(metadata.minuta_environment))) {
    throw new PayloadError("invalid_yookassa_metadata");
  }
  const refundId = metadata.minuta_refund_id == null ? null : metadata.minuta_refund_id;
  if (refundId !== null && !isUuid(refundId)) throw new PayloadError("invalid_yookassa_refund_metadata");
  return {
    organizationId: metadata.minuta_organization_id,
    environment: metadata.minuta_environment as YooKassaEnvironment,
    attemptId: metadata.minuta_attempt_id,
    refundId,
  };
}

function createdAt(object: ProviderObject): string | null {
  return typeof object.created_at === "string" && Number.isFinite(Date.parse(object.created_at))
    ? new Date(object.created_at).toISOString()
    : null;
}

async function handleYooKassaWebhook(rawBody: string): Promise<Response> {
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not_object");
    payload = parsed as Record<string, unknown>;
  } catch {
    throw new PayloadError("invalid_yookassa_json");
  }
  const notification = notificationObject(payload);
  const incomingId = requiredString(notification.object.id, "invalid_yookassa_object_id", 200);
  const incomingScope = metadataScope(notification.object);
  const credentials = yookassaCredentials(incomingScope.organizationId, incomingScope.environment);
  const objectKind = notification.event.startsWith("refund.") ? "refunds" : "payments";

  // YooKassa does not sign notifications with a merchant HMAC. A successful
  // authenticated GET is mandatory before any provider state is committed.
  const canonical = await yookassaRequest<ProviderObject>(`/${objectKind}/${encodeURIComponent(incomingId)}`, credentials);
  const canonicalId = requiredString(canonical.id, "invalid_yookassa_object_id", 200);
  if (canonicalId !== incomingId) throw new PayloadError("yookassa_object_id_mismatch");
  const scope = metadataScope(canonical);
  if (scope.organizationId !== incomingScope.organizationId || scope.environment !== incomingScope.environment
      || scope.attemptId !== incomingScope.attemptId || scope.refundId !== incomingScope.refundId) {
    throw new PayloadError("yookassa_metadata_mismatch");
  }
  const providerStatus = requiredString(canonical.status, "invalid_yookassa_status", 40);
  const amountMinor = valueToMinor(canonical.amount?.value);
  const currency = requiredString(canonical.amount?.currency, "invalid_yookassa_currency", 3).toUpperCase();
  if (currency !== "RUB") throw new PayloadError("unsupported_yookassa_currency");
  const payloadHash = await sha256Hex(rawBody);

  if (objectKind === "payments") {
    if (!["waiting_for_capture", "succeeded", "canceled"].includes(providerStatus)
        || typeof canonical.test !== "boolean"
        || canonical.test !== (scope.environment === "test")) {
      throw new PayloadError("yookassa_payment_state_mismatch");
    }
    const result = await serviceRpc<{ accepted?: boolean; duplicate?: boolean }>("process_yookassa_payment_event", {
      p_attempt: scope.attemptId,
      p_event_key: `${notification.event}:${canonicalId}`,
      p_event_type: notification.event,
      p_provider_payment_id: canonicalId,
      p_provider_status: providerStatus,
      p_amount_minor: amountMinor,
      p_currency: currency,
      p_payload_sha256: payloadHash,
      p_provider_created_at: createdAt(canonical),
      p_provider_test: canonical.test,
    });
    if (!result?.accepted) throw new Error("payment_event_rejected");
    return jsonResponse(200, { accepted: true, duplicate: Boolean(result.duplicate) });
  }

  if (!scope.refundId || providerStatus !== "succeeded") throw new PayloadError("yookassa_refund_state_mismatch");
  const providerPaymentId = requiredString(canonical.payment_id, "invalid_yookassa_payment_id", 200);
  const result = await serviceRpc<{ accepted?: boolean; duplicate?: boolean }>("process_yookassa_refund_event", {
    p_refund: scope.refundId,
    p_event_key: `${notification.event}:${canonicalId}`,
    p_event_type: notification.event,
    p_provider_refund_id: canonicalId,
    p_provider_payment_id: providerPaymentId,
    p_provider_status: providerStatus,
    p_amount_minor: amountMinor,
    p_currency: currency,
    p_payload_sha256: payloadHash,
    p_provider_created_at: createdAt(canonical),
  });
  if (!result?.accepted) throw new Error("refund_event_rejected");
  return jsonResponse(200, { accepted: true, duplicate: Boolean(result.duplicate) });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse(405, { error: "method_not_allowed" });
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > 131072) return jsonResponse(413, { error: "payload_too_large" });
    const rawBody = await request.text();
    if (!rawBody || rawBody.length > 131072) return jsonResponse(413, { error: "payload_too_large" });

    const configuredAdapter = Deno.env.get("PAYMENT_WEBHOOK_ADAPTER")?.trim();
    const yookassaEnabled = configuredAdapter === "yookassa-v1" || configuredAdapter === "hybrid-v1";
    if (yookassaEnabled && looksLikeYooKassaNotification(rawBody)) return await handleYooKassaWebhook(rawBody);

    // yookassa-v1 remains backwards compatible with the original signed
    // gateway. Routing by the provider's notification envelope never replaces
    // YooKassa's mandatory authenticated canonical GET above.
    const event = yookassaEnabled
      ? await verifyAndMapPaymentWebhook(request, rawBody, "generic-hmac-sha256-v1")
      : await verifyAndMapPaymentWebhook(request, rawBody);
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
    if (!rpcResponse.ok) return jsonResponse(503, { error: "payment_processing_unavailable" });
    const result = await rpcResponse.json();
    if (!result?.accepted) {
      return jsonResponse(409, {
        error: result?.error_code ?? "payment_event_rejected",
        retryable: result?.error_code === "unknown_payment_operation",
      });
    }
    return jsonResponse(200, { accepted: true, duplicate: Boolean(result.duplicate) });
  } catch (error) {
    if (error instanceof WebhookAuthenticationError) return jsonResponse(401, { error: "invalid_signature" });
    if (error instanceof WebhookPayloadError || error instanceof PayloadError) return jsonResponse(400, { error: "invalid_payload" });
    if (error instanceof WebhookConfigurationError || error instanceof ConfigurationError) return jsonResponse(503, { error: "webhook_not_configured" });
    if (error instanceof ProviderError) return jsonResponse(503, { error: "provider_verification_unavailable" });
    return jsonResponse(503, { error: "payment_processing_unavailable" });
  }
});
