import {
  authenticatedUserId,
  errorResponse,
  isUuid,
  json,
  jsonHeaders,
  minorToValue,
  normalizeReceiptPhone,
  PayloadError,
  ProviderError,
  readJsonObject,
  requiredString,
  safeDescription,
  serviceRpc,
  valueToMinor,
  yookassaCredentials,
  yookassaRequest,
  yookassaTaxSystemCode,
  type YooKassaEnvironment,
} from "../_shared/yookassa.ts";

type PreparedRefund = {
  refund_id?: string;
  organization_id?: string;
  attempt_id?: string;
  request_id?: string;
  status?: string;
  amount_minor?: number;
  currency?: string;
  provider_payment_id?: string;
  provider_refund_id?: string | null;
  environment?: YooKassaEnvironment;
  client_phone?: string;
  service_name?: string;
  fiscalization_enabled?: boolean;
  taxation?: string | null;
  vat_code?: number | null;
  payment_mode?: string | null;
};

type YooKassaRefund = {
  id?: unknown;
  status?: unknown;
  payment_id?: unknown;
  amount?: { value?: unknown; currency?: unknown };
  created_at?: unknown;
  metadata?: Record<string, unknown>;
};

function refundReceipt(prepared: PreparedRefund): Record<string, unknown> | undefined {
  if (!prepared.fiscalization_enabled) return undefined;
  if (!prepared.taxation || !prepared.vat_code || !prepared.payment_mode) {
    throw new PayloadError("fiscalization_settings_incomplete");
  }
  return {
    customer: { phone: normalizeReceiptPhone(prepared.client_phone) },
    items: [{
      description: safeDescription(prepared.service_name, "Услуга"),
      quantity: "1.00",
      amount: { value: minorToValue(Number(prepared.amount_minor)), currency: "RUB" },
      vat_code: prepared.vat_code,
      payment_mode: prepared.payment_mode,
      payment_subject: "service",
    }],
    tax_system_code: yookassaTaxSystemCode(prepared.taxation),
  };
}

function validateRefund(response: YooKassaRefund, prepared: PreparedRefund): {
  id: string;
  status: string;
  paymentId: string;
  amountMinor: number;
  currency: string;
  createdAt: string | null;
} {
  const id = requiredString(response.id, "invalid_provider_refund_id", 200);
  const status = requiredString(response.status, "invalid_provider_refund_status", 40);
  if (!["pending", "succeeded", "canceled"].includes(status)) throw new PayloadError("unsupported_provider_refund_status");
  const paymentId = requiredString(response.payment_id, "invalid_provider_payment_id", 200);
  const amountMinor = valueToMinor(response.amount?.value);
  const currency = requiredString(response.amount?.currency, "invalid_provider_currency", 3).toUpperCase();
  if (paymentId !== prepared.provider_payment_id || amountMinor !== prepared.amount_minor || currency !== prepared.currency) {
    throw new PayloadError("provider_refund_mismatch");
  }
  const metadata = response.metadata ?? {};
  if (metadata.minuta_refund_id !== prepared.refund_id
      || metadata.minuta_attempt_id !== prepared.attempt_id
      || metadata.minuta_organization_id !== prepared.organization_id
      || metadata.minuta_environment !== prepared.environment) {
    throw new PayloadError("provider_refund_metadata_mismatch");
  }
  const createdAt = typeof response.created_at === "string" && Number.isFinite(Date.parse(response.created_at))
    ? new Date(response.created_at).toISOString()
    : null;
  return { id, status, paymentId, amountMinor, currency, createdAt };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: jsonHeaders });
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let refundId: string | null = null;
  try {
    const actorId = await authenticatedUserId(request);
    const body = await readJsonObject(request);
    if (!isUuid(body.organization_id) || !isUuid(body.attempt_id) || !isUuid(body.request_id)
        || !Number.isSafeInteger(body.amount_minor) || Number(body.amount_minor) < 100
        || typeof body.reason !== "string" || body.reason.trim().length < 8 || body.reason.trim().length > 500) {
      throw new PayloadError("invalid_refund_request");
    }
    const prepared = await serviceRpc<PreparedRefund>("prepare_yookassa_refund", {
      p_organization: body.organization_id,
      p_attempt: body.attempt_id,
      p_amount_minor: body.amount_minor,
      p_request_id: body.request_id,
      p_reason: body.reason.trim(),
      p_actor: actorId,
    });
    if (!isUuid(prepared.refund_id) || !isUuid(prepared.organization_id) || !isUuid(prepared.attempt_id)
        || !isUuid(prepared.request_id)
        || !prepared.environment || !prepared.provider_payment_id
        || !Number.isSafeInteger(prepared.amount_minor) || prepared.currency !== "RUB") {
      throw new PayloadError("invalid_refund_preparation");
    }
    refundId = prepared.refund_id;
    const amountMinor = Number(prepared.amount_minor);
    if (prepared.provider_refund_id && prepared.status === "succeeded") {
      return json({ ok: true, refund_id: refundId, status: prepared.status, amount_minor: prepared.amount_minor });
    }
    if (prepared.provider_refund_id && prepared.status === "pending") {
      const canonicalResponse = await yookassaRequest<YooKassaRefund>(
        `/refunds/${encodeURIComponent(prepared.provider_refund_id)}`,
        yookassaCredentials(prepared.organization_id, prepared.environment),
      );
      const canonical = validateRefund(canonicalResponse, prepared);
      await serviceRpc("complete_yookassa_refund", {
        p_refund: refundId,
        p_provider_refund_id: canonical.id,
        p_provider_status: canonical.status,
        p_amount_minor: canonical.amountMinor,
        p_currency: canonical.currency,
        p_provider_payment_id: canonical.paymentId,
        p_provider_created_at: canonical.createdAt,
      });
      await serviceRpc("record_yookassa_reconciliation", {
        p_request_id: prepared.request_id,
        p_object_kind: "refund",
        p_local_id: refundId,
        p_provider_object_id: canonical.id,
        p_provider_status: canonical.status,
        p_amount_minor: canonical.amountMinor,
        p_currency: canonical.currency,
        p_source: "manual",
        p_outcome: "updated",
        p_payload_sha256: null,
        p_error_code: null,
      });
      return json({ ok: true, refund_id: refundId, status: canonical.status, amount_minor: canonical.amountMinor });
    }
    if (prepared.status !== "creating") throw new PayloadError("refund_not_retryable");

    const providerBody: Record<string, unknown> = {
      payment_id: prepared.provider_payment_id,
      amount: { value: minorToValue(amountMinor), currency: prepared.currency },
      description: safeDescription(`Возврат: ${prepared.service_name ?? "услуга"}`, "Возврат оплаты"),
      metadata: {
        minuta_refund_id: prepared.refund_id,
        minuta_attempt_id: prepared.attempt_id,
        minuta_organization_id: prepared.organization_id,
        minuta_environment: prepared.environment,
      },
    };
    const fiscalReceipt = refundReceipt(prepared);
    if (fiscalReceipt) providerBody.receipt = fiscalReceipt;
    const providerResponse = await yookassaRequest<YooKassaRefund>(
      "/refunds",
      yookassaCredentials(prepared.organization_id, prepared.environment),
      { method: "POST", idempotenceKey: prepared.request_id, body: providerBody },
    );
    const refund = validateRefund(providerResponse, prepared);
    await serviceRpc("complete_yookassa_refund", {
      p_refund: refundId,
      p_provider_refund_id: refund.id,
      p_provider_status: refund.status,
      p_amount_minor: refund.amountMinor,
      p_currency: refund.currency,
      p_provider_payment_id: refund.paymentId,
      p_provider_created_at: refund.createdAt,
    });
    await serviceRpc("record_yookassa_reconciliation", {
      p_request_id: prepared.request_id,
      p_object_kind: "refund",
      p_local_id: refundId,
      p_provider_object_id: refund.id,
      p_provider_status: refund.status,
      p_amount_minor: refund.amountMinor,
      p_currency: refund.currency,
      p_source: "refund",
      p_outcome: "matched",
      p_payload_sha256: null,
      p_error_code: null,
    });
    return json({ ok: true, refund_id: refundId, status: refund.status, amount_minor: refund.amountMinor });
  } catch (error) {
    if (refundId) {
      const providerError = error instanceof ProviderError ? error : null;
      try {
        await serviceRpc("fail_yookassa_refund", {
          p_refund: refundId,
          p_error_code: providerError?.code ?? "refund_creation_incomplete",
          p_definitive: Boolean(providerError?.definitive),
        });
      } catch {
        // Keep the creating reservation after an uncertain result. Retrying the
        // same request id reuses the provider idempotence key.
      }
    }
    return errorResponse(error);
  }
});
