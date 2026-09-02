export const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

export class ConfigurationError extends Error {}
export class PayloadError extends Error {}
export class ProviderError extends Error {
  status: number;
  code: string;
  definitive: boolean;

  constructor(status: number, code: string, definitive: boolean) {
    super(code);
    this.status = status;
    this.code = code;
    this.definitive = definitive;
  }
}

export type YooKassaEnvironment = "test" | "production";
export type YooKassaCredentials = { shopId: string; secretKey: string };

const taxSystemCodes: Readonly<Record<string, number>> = Object.freeze({
  osn: 1,
  usn_income: 2,
  usn_income_outcome: 3,
  esn: 5,
  patent: 6,
});

export function yookassaTaxSystemCode(taxation: string | null | undefined): number {
  const code = taxation ? taxSystemCodes[taxation] : undefined;
  if (!Number.isInteger(code) || Number(code) < 1 || Number(code) > 6) {
    throw new PayloadError("invalid_tax_system_code");
  }
  return Number(code);
}

type StoredCredential = { shop_id?: unknown; secret_key?: unknown };
type StoredEnvironmentCredentials = {
  test?: StoredCredential;
  production?: StoredCredential;
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

export function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new ConfigurationError(`missing_${name.toLowerCase()}`);
  return value;
}

export function serverCredential(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (legacy) return legacy;
  const raw = requiredEnv("SUPABASE_SECRET_KEYS");
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const key = typeof parsed.default === "string" ? parsed.default.trim() : "";
    if (key) return key;
  } catch {
    throw new ConfigurationError("invalid_supabase_secret_keys");
  }
  throw new ConfigurationError("missing_supabase_secret_key");
}

function rpcHeaders(key: string, authorization?: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: key, "content-type": "application/json" };
  if (authorization) headers.authorization = authorization;
  else if (key.split(".").length === 3) headers.authorization = `Bearer ${key}`;
  return headers;
}

export async function serviceRpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${requiredEnv("SUPABASE_URL").replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: rpcHeaders(serverCredential()),
    body: JSON.stringify(body),
  });
  const responseText = await response.text();
  if (!response.ok) {
    const error = new Error(`rpc_${name}_${response.status}`) as Error & { status?: number; detail?: string };
    error.status = response.status;
    error.detail = responseText.slice(0, 500);
    throw error;
  }
  return (responseText ? JSON.parse(responseText) : null) as T;
}

export async function authenticatedUserId(request: Request): Promise<string> {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) throw new PayloadError("authentication_required");
  const response = await fetch(`${requiredEnv("SUPABASE_URL").replace(/\/$/, "")}/auth/v1/user`, {
    headers: { apikey: requiredEnv("SUPABASE_ANON_KEY"), authorization },
  });
  if (!response.ok) throw new PayloadError("authentication_required");
  const account = await response.json() as { id?: unknown };
  if (typeof account.id !== "string" || !isUuid(account.id)) throw new PayloadError("authentication_required");
  return account.id;
}

function parseCredential(value: StoredCredential | undefined): YooKassaCredentials | null {
  const shopId = typeof value?.shop_id === "string" ? value.shop_id.trim() : "";
  const secretKey = typeof value?.secret_key === "string" ? value.secret_key.trim() : "";
  if (!shopId || !secretKey) return null;
  return { shopId, secretKey };
}

export function yookassaCredentials(organizationId: string, environment: YooKassaEnvironment): YooKassaCredentials {
  if (!isUuid(organizationId) || !["test", "production"].includes(environment)) {
    throw new ConfigurationError("invalid_yookassa_credential_scope");
  }

  const accountsJson = Deno.env.get("YOOKASSA_ACCOUNTS_JSON")?.trim();
  if (accountsJson) {
    try {
      const accounts = JSON.parse(accountsJson) as Record<string, StoredEnvironmentCredentials>;
      const credential = parseCredential(accounts[organizationId]?.[environment]);
      if (credential) return credential;
    } catch {
      throw new ConfigurationError("invalid_yookassa_accounts_json");
    }
    throw new ConfigurationError("missing_yookassa_organization_credentials");
  }

  // Single-merchant deployments must bind global credentials to one exact tenant.
  if (requiredEnv("YOOKASSA_ORGANIZATION_ID").toLowerCase() !== organizationId.toLowerCase()) {
    throw new ConfigurationError("yookassa_organization_scope_mismatch");
  }
  const shopIdName = environment === "test" ? "YOOKASSA_TEST_SHOP_ID" : "YOOKASSA_SHOP_ID";
  const secretName = environment === "test" ? "YOOKASSA_TEST_SECRET_KEY" : "YOOKASSA_SECRET_KEY";
  return { shopId: requiredEnv(shopIdName), secretKey: requiredEnv(secretName) };
}

export async function yookassaRequest<T>(
  path: string,
  credentials: YooKassaCredentials,
  options: { method?: "GET" | "POST"; idempotenceKey?: string; body?: Record<string, unknown> } = {},
): Promise<T> {
  if (!/^\/(payments|refunds)(?:\/[-a-zA-Z0-9]+)?$/.test(path)) throw new PayloadError("invalid_provider_path");
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {
    authorization: `Basic ${btoa(`${credentials.shopId}:${credentials.secretKey}`)}`,
    accept: "application/json",
  };
  if (options.body) headers["content-type"] = "application/json";
  if (options.idempotenceKey) headers["idempotence-key"] = options.idempotenceKey;

  let response: Response;
  try {
    response = await fetch(`https://api.yookassa.ru/v3${path}`, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ProviderError(503, "yookassa_network_error", false);
  }

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new ProviderError(response.status || 502, "yookassa_invalid_response", false);
  }
  if (!response.ok) {
    const candidate = payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).code
      : null;
    const safeCode = typeof candidate === "string" && /^[a-z0-9_.-]{1,80}$/i.test(candidate)
      ? `yookassa_${candidate.toLowerCase()}`
      : `yookassa_http_${response.status}`;
    const definitive = response.status >= 400 && response.status < 500 && ![408, 409, 429].includes(response.status);
    throw new ProviderError(response.status, safeCode, definitive);
  }
  return payload as T;
}

export async function readJsonObject(request: Request, maxBytes = 32768): Promise<Record<string, unknown>> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    throw new PayloadError("unsupported_media_type");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new PayloadError("payload_too_large");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) throw new PayloadError("payload_too_large");
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not_object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new PayloadError("invalid_json");
  }
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function requiredString(value: unknown, code: string, maxLength = 300): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) throw new PayloadError(code);
  return value;
}

export function minorToValue(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new PayloadError("invalid_amount");
  return `${Math.floor(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`;
}

export function valueToMinor(value: unknown): number {
  if (typeof value !== "string" || !/^\d{1,12}\.\d{2}$/.test(value)) throw new PayloadError("invalid_provider_amount");
  const [rubles, kopecks] = value.split(".");
  const amount = Number(rubles) * 100 + Number(kopecks);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new PayloadError("invalid_provider_amount");
  return amount;
}

export function normalizeReceiptPhone(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("9")) return `+7${digits}`;
  if (digits.length === 11 && digits.startsWith("8")) return `+7${digits.slice(1)}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  throw new PayloadError("receipt_contact_unavailable");
}

export function safeDescription(value: unknown, fallback: string): string {
  const normalized = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return (normalized || fallback).slice(0, 128);
}

export function requireHttpsUrl(value: unknown, code: string): string {
  const text = requiredString(value, code, 1000);
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("unsafe_url");
    return parsed.toString();
  } catch {
    throw new PayloadError(code);
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function errorResponse(error: unknown): Response {
  if (error instanceof PayloadError) return json({ ok: false, error: error.message }, error.message === "authentication_required" ? 401 : 400);
  if (error instanceof ConfigurationError) return json({ ok: false, error: "payment_not_configured" }, 503);
  if (error instanceof ProviderError) return json({ ok: false, error: error.code, retryable: !error.definitive }, error.status >= 500 ? 502 : 409);
  return json({ ok: false, error: "payment_processing_unavailable" }, 503);
}
