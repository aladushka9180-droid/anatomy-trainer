import {
  errorResponse,
  isUuid,
  json,
  jsonHeaders,
  minorToValue,
  normalizeReceiptPhone,
  PayloadError,
  ProviderError,
  readJsonObject,
  requireHttpsUrl,
  requiredEnv,
  requiredString,
  safeDescription,
  serviceRpc,
  valueToMinor,
  yookassaCredentials,
  yookassaRequest,
  yookassaTaxSystemCode,
  type YooKassaEnvironment,
} from "../_shared/yookassa.ts";

type PreparedPayment = {
  mode: "legacy_link" | "yookassa";
  enabled: boolean;
  fallback_url?: string | null;
  attempt_id?: string;
  organization_id?: string;
  booking_id?: string;
  booking_code?: string;
  environment?: YooKassaEnvironment;
  idempotency_key?: string;
  amount_minor?: number;
  currency?: string;
  status?: string;
  provider_payment_id?: string | null;
  confirmation_url?: string | null;
  client_phone?: string;
  service_name?: string;
  fiscalization_enabled?: boolean;
  taxation?: string | null;
  vat_code?: number | null;
  payment_mode?: string | null;
};

type YooKassaPayment = {
  id?: unknown;
  status?: unknown;
  amount?: { value?: unknown; currency?: unknown };
  confirmation?: { confirmation_url?: unknown };
  created_at?: unknown;
  expires_at?: unknown;
  test?: unknown;
  metadata?: Record<string, unknown>;
};

function receipt(prepared: PreparedPayment): Record<string, unknown> | undefined {
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

function validatePayment(response: YooKassaPayment, prepared: PreparedPayment): {
  id: string;
  status: string;
  amountMinor: number;
  currency: string;
  confirmationUrl: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  test: boolean;
} {
  const id = requiredString(response.id, "invalid_provider_payment_id", 200);
  const status = requiredString(response.status, "invalid_provider_status", 40);
  if (!['pending', 'waiting_for_capture', 'succeeded', 'canceled'].includes(status)) {
    throw new PayloadError("unsupported_provider_status");
  }
  const amountMinor = valueToMinor(response.amount?.value);
  const currency = requiredString(response.amount?.currency, "invalid_provider_currency", 3).toUpperCase();
  if (amountMinor !== prepared.amount_minor || currency !== prepared.currency) throw new PayloadError("provider_amount_mismatch");
  if (typeof response.test !== "boolean" || response.test !== (prepared.environment === "test")) {
    throw new PayloadError("provider_environment_mismatch");
  }
  const metadata = response.metadata ?? {};
  if (metadata.minuta_attempt_id !== prepared.attempt_id
      || metadata.minuta_booking_id !== prepared.booking_id
      || metadata.minuta_organization_id !== prepared.organization_id
      || metadata.minuta_environment !== prepared.environment) {
    throw new PayloadError("provider_metadata_mismatch");
  }
  const confirmationUrl = response.confirmation?.confirmation_url == null
    ? null
    : requireHttpsUrl(response.confirmation.confirmation_url, "invalid_confirmation_url");
  if (status === "pending" && !confirmationUrl) throw new PayloadError("missing_confirmation_url");
  const createdAt = typeof response.created_at === "string" && Number.isFinite(Date.parse(response.created_at))
    ? new Date(response.created_at).toISOString()
    : null;
  const expiresAt = typeof response.expires_at === "string" && Number.isFinite(Date.parse(response.expires_at))
    ? new Date(response.expires_at).toISOString()
    : null;
  return { id, status, amountMinor, currency, confirmationUrl, createdAt, expiresAt, test: response.test };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: jsonHeaders });
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let attemptId: string | null = null;
  try {
    const body = await readJsonObject(request);
    if (!isUuid(body.manage_token) || !isUuid(body.request_id)) throw new PayloadError("invalid_payment_request");
    const prepared = await serviceRpc<PreparedPayment>("prepare_yookassa_payment", {
      p_manage_token: body.manage_token,
      p_idempotency_key: body.request_id,
    });

    if (prepared.mode === "legacy_link") {
      return json({ ok: true, mode: "legacy_link", payment_url: prepared.fallback_url ?? null });
    }
    if (!prepared.enabled || !isUuid(prepared.attempt_id) || !isUuid(prepared.organization_id)
        || !isUuid(prepared.booking_id) || !isUuid(prepared.idempotency_key) || !prepared.environment
        || !Number.isSafeInteger(prepared.amount_minor) || Number(prepared.amount_minor) <= 0
        || prepared.currency !== "RUB") {
      throw new PayloadError("invalid_payment_preparation");
    }
    attemptId = prepared.attempt_id;
    const amountMinor = Number(prepared.amount_minor);
    if (prepared.provider_payment_id && prepared.confirmation_url && prepared.status === "pending") {
      return json({ ok: true, mode: "yookassa", attempt_id: attemptId, status: prepared.status, payment_url: prepared.confirmation_url });
    }
    if (prepared.status === "succeeded") {
      return json({ ok: true, mode: "yookassa", attempt_id: attemptId, status: "succeeded", payment_url: null });
    }
    if (prepared.provider_payment_id && prepared.status === "pending") {
      const canonicalResponse = await yookassaRequest<YooKassaPayment>(
        `/payments/${encodeURIComponent(prepared.provider_payment_id)}`,
        yookassaCredentials(prepared.organization_id, prepared.environment),
      );
      const canonical = validatePayment(canonicalResponse, prepared);
      await serviceRpc("complete_yookassa_payment_creation", {
        p_attempt: attemptId,
        p_provider_payment_id: canonical.id,
        p_provider_status: canonical.status,
        p_amount_minor: canonical.amountMinor,
        p_currency: canonical.currency,
        p_confirmation_url: canonical.confirmationUrl,
        p_provider_created_at: canonical.createdAt,
        p_expires_at: canonical.expiresAt,
        p_provider_test: canonical.test,
      });
      await serviceRpc("record_yookassa_reconciliation", {
        p_request_id: prepared.idempotency_key,
        p_object_kind: "payment",
        p_local_id: attemptId,
        p_provider_object_id: canonical.id,
        p_provider_status: canonical.status,
        p_amount_minor: canonical.amountMinor,
        p_currency: canonical.currency,
        p_source: "manual",
        p_outcome: "updated",
        p_payload_sha256: null,
        p_error_code: null,
      });
      return json({ ok: true, mode: "yookassa", attempt_id: attemptId, status: canonical.status, payment_url: canonical.confirmationUrl });
    }
    if (prepared.status !== "creating") throw new PayloadError("payment_attempt_not_retryable");

    const returnUrl = requireHttpsUrl(requiredEnv("YOOKASSA_RETURN_URL"), "invalid_return_url");
    const providerBody: Record<string, unknown> = {
      amount: { value: minorToValue(amountMinor), currency: prepared.currency },
      capture: true,
      confirmation: { type: "redirect", return_url: returnUrl },
      description: safeDescription(`Предоплата: ${prepared.service_name ?? "услуга"} · ${prepared.booking_code ?? "запись"}`, "Предоплата записи"),
      metadata: {
        minuta_attempt_id: prepared.attempt_id,
        minuta_booking_id: prepared.booking_id,
        minuta_organization_id: prepared.organization_id,
        minuta_environment: prepared.environment,
      },
    };
    const fiscalReceipt = receipt(prepared);
    if (fiscalReceipt) providerBody.receipt = fiscalReceipt;

    const providerResponse = await yookassaRequest<YooKassaPayment>(
      "/payments",
      yookassaCredentials(prepared.organization_id, prepared.environment),
      { method: "POST", idempotenceKey: prepared.idempotency_key, body: providerBody },
    );
    const payment = validatePayment(providerResponse, prepared);
    await serviceRpc("complete_yookassa_payment_creation", {
      p_attempt: attemptId,
      p_provider_payment_id: payment.id,
      p_provider_status: payment.status,
      p_amount_minor: payment.amountMinor,
      p_currency: payment.currency,
      p_confirmation_url: payment.confirmationUrl,
      p_provider_created_at: payment.createdAt,
      p_expires_at: payment.expiresAt,
      p_provider_test: payment.test,
    });
    await serviceRpc("record_yookassa_reconciliation", {
      p_request_id: prepared.idempotency_key,
      p_object_kind: "payment",
      p_local_id: attemptId,
      p_provider_object_id: payment.id,
      p_provider_status: payment.status,
      p_amount_minor: payment.amountMinor,
      p_currency: payment.currency,
      p_source: "create",
      p_outcome: "matched",
      p_payload_sha256: null,
      p_error_code: null,
    });
    return json({ ok: true, mode: "yookassa", attempt_id: attemptId, status: payment.status, payment_url: payment.confirmationUrl });
  } catch (error) {
    if (attemptId) {
      const providerError = error instanceof ProviderError ? error : null;
      try {
        await serviceRpc("fail_yookassa_payment_attempt", {
          p_attempt: attemptId,
          p_error_code: providerError?.code ?? "payment_creation_incomplete",
          p_definitive: Boolean(providerError?.definitive),
        });
      } catch {
        // Preserve the original error. A creating attempt is intentionally retried
        // with the same provider idempotence key after an uncertain result.
      }
    }
    return errorResponse(error);
  }
});
