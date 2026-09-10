const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "vary": "Accept",
};

const MAX_RPC_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_DELIVERIES = 20;
const DELIVERY_TIMEOUT_MS = 5_000;

type JsonRecord = Record<string, unknown>;

type RuntimeDestination = {
  organizationId: string;
  connectionId: string;
  targetUrl: string;
  secretRef: string;
  secret: string;
};

export type PrimeTimeWebhookDependencies = {
  env?: (name: string) => string | undefined;
  fetch?: typeof fetch;
  now?: () => number;
  randomUUID?: () => string;
};

type RuntimeConfig = {
  supabaseUrl: string;
  serviceKey: string;
  dispatchToken: string;
  destinations: Readonly<Record<string, RuntimeDestination>>;
  batchSize: number;
};

type Delivery = {
  id: string;
  subscriptionId: string;
  organizationId: string;
  connectionId: string;
  targetUrl: string;
  secretRef: string;
  eventType: string;
  attempt: number;
  payload: JsonRecord;
};

class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function runtimeEnv(name: string): string | undefined {
  const deno = (globalThis as unknown as {
    Deno?: { env?: { get?: (key: string) => string | undefined } };
  }).Deno;
  return deno?.env?.get?.(name);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredEnv(getEnv: (name: string) => string | undefined, name: string): string {
  const value = getEnv(name)?.trim();
  if (!value) throw new HttpError(503, "NOT_CONFIGURED");
  return value;
}

function parseServiceKey(getEnv: (name: string) => string | undefined): string {
  const legacy = getEnv("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (legacy) return legacy;
  try {
    const parsed = JSON.parse(requiredEnv(getEnv, "SUPABASE_SECRET_KEYS")) as unknown;
    if (isRecord(parsed) && typeof parsed.default === "string" && parsed.default.trim()) {
      return parsed.default.trim();
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
  }
  throw new HttpError(503, "NOT_CONFIGURED");
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeExternalTarget(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const literalIp = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
  const dnsHostname = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname);
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
    (url.port && url.port !== "443") || literalIp || !dnsHostname || hostname === "localhost" ||
    hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    return null;
  }
  return url.toString();
}

function parseDestinations(raw: string): Readonly<Record<string, RuntimeDestination>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(503, "NOT_CONFIGURED");
  }
  if (!isRecord(parsed) || Object.keys(parsed).length < 1 || Object.keys(parsed).length > 100) {
    throw new HttpError(503, "NOT_CONFIGURED");
  }
  const destinations: Record<string, RuntimeDestination> = {};
  for (const [subscriptionId, value] of Object.entries(parsed)) {
    if (!validUuid(subscriptionId) || !isRecord(value) || Object.keys(value).length !== 5 ||
      !validUuid(value.organizationId) || !validUuid(value.connectionId) ||
      typeof value.secretRef !== "string" || !/^[A-Za-z][A-Za-z0-9_.:-]{1,79}$/.test(value.secretRef) ||
      typeof value.secret !== "string") {
      throw new HttpError(503, "NOT_CONFIGURED");
    }
    const targetUrl = normalizeExternalTarget(value.targetUrl);
    const secret = value.secret.trim();
    if (!targetUrl || !Object.keys(value).every(key =>
      ["organizationId", "connectionId", "targetUrl", "secretRef", "secret"].includes(key))) {
      throw new HttpError(503, "NOT_CONFIGURED");
    }
    if (new TextEncoder().encode(secret).byteLength < 32 || secret.length > 4096) {
      throw new HttpError(503, "NOT_CONFIGURED");
    }
    const normalizedSubscriptionId = subscriptionId.toLowerCase();
    if (Object.hasOwn(destinations, normalizedSubscriptionId)) throw new HttpError(503, "NOT_CONFIGURED");
    destinations[normalizedSubscriptionId] = Object.freeze({
      organizationId: value.organizationId.toLowerCase(),
      connectionId: value.connectionId.toLowerCase(),
      targetUrl,
      secretRef: value.secretRef,
      secret,
    });
  }
  return Object.freeze(destinations);
}

function loadConfig(getEnv: (name: string) => string | undefined): RuntimeConfig {
  if (getEnv("PRIMETIME_WEBHOOK_DISPATCH_ENABLED")?.trim().toLowerCase() !== "true") {
    throw new HttpError(503, "NOT_CONFIGURED");
  }
  const supabaseUrl = requiredEnv(getEnv, "SUPABASE_URL").replace(/\/$/, "");
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/") throw new Error();
  } catch {
    throw new HttpError(503, "NOT_CONFIGURED");
  }
  const dispatchToken = requiredEnv(getEnv, "PRIMETIME_WEBHOOK_DISPATCH_TOKEN");
  if (new TextEncoder().encode(dispatchToken).byteLength < 32 || dispatchToken.length > 4096) {
    throw new HttpError(503, "NOT_CONFIGURED");
  }
  const rawBatchSize = getEnv("PRIMETIME_WEBHOOK_BATCH_SIZE")?.trim() || "10";
  const batchSize = Number(rawBatchSize);
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > MAX_DELIVERIES) {
    throw new HttpError(503, "NOT_CONFIGURED");
  }
  return {
    supabaseUrl,
    serviceKey: parseServiceKey(getEnv),
    dispatchToken,
    destinations: parseDestinations(requiredEnv(getEnv, "PRIMETIME_WEBHOOK_DESTINATIONS")),
    batchSize,
  };
}

function rpcHeaders(serviceKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: serviceKey,
    accept: "application/json",
    "content-type": "application/json",
  };
  if (serviceKey.split(".").length === 3) headers.authorization = `Bearer ${serviceKey}`;
  return headers;
}

async function callRpc(
  fetcher: typeof fetch,
  config: RuntimeConfig,
  name: string,
  parameters: JsonRecord,
): Promise<JsonRecord> {
  let response: Response;
  try {
    response = await fetcher(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: rpcHeaders(config.serviceKey),
      body: JSON.stringify(parameters),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new HttpError(502, "UPSTREAM_UNAVAILABLE");
  }
  const declaredLength = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RPC_RESPONSE_BYTES) {
    throw new HttpError(502, "UPSTREAM_INVALID_RESPONSE");
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RPC_RESPONSE_BYTES) {
    throw new HttpError(502, "UPSTREAM_INVALID_RESPONSE");
  }
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new HttpError(502, "UPSTREAM_INVALID_RESPONSE");
  }
  if (!response.ok) throw new HttpError(502, "UPSTREAM_UNAVAILABLE");
  if (!isRecord(payload)) throw new HttpError(502, "UPSTREAM_INVALID_RESPONSE");
  return payload;
}

function parseDeliveries(result: JsonRecord, maximum: number): Delivery[] {
  if (result.ok !== true || !Array.isArray(result.deliveries) || result.deliveries.length > maximum) {
    throw new HttpError(502, "UPSTREAM_INVALID_RESPONSE");
  }
  return result.deliveries.map(value => {
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.subscriptionId !== "string" ||
      typeof value.organizationId !== "string" || typeof value.connectionId !== "string" || typeof value.secretRef !== "string" ||
      typeof value.eventType !== "string" || typeof value.targetUrl !== "string" || value.targetUrl.length > 2048 ||
      !Number.isSafeInteger(value.attempt) || !isRecord(value.payload)) {
      throw new HttpError(502, "UPSTREAM_INVALID_RESPONSE");
    }
    if (!validUuid(value.id) || !validUuid(value.subscriptionId) || !validUuid(value.organizationId) ||
      !validUuid(value.connectionId) ||
      !/^(booking\.created|booking\.updated|booking\.cancelled)$/.test(value.eventType) ||
      !/^[A-Za-z][A-Za-z0-9_.:-]{1,79}$/.test(value.secretRef) ||
      (value.attempt as number) < 1 || (value.attempt as number) > 8) {
      throw new HttpError(502, "UPSTREAM_INVALID_RESPONSE");
    }
    return {
      id: value.id.toLowerCase(),
      subscriptionId: value.subscriptionId.toLowerCase(),
      organizationId: value.organizationId.toLowerCase(),
      connectionId: value.connectionId.toLowerCase(),
      targetUrl: value.targetUrl,
      secretRef: value.secretRef,
      eventType: value.eventType,
      attempt: value.attempt as number,
      payload: value.payload,
    };
  });
}

async function hmacHex(secret: string, input: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const encode = (value: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [leftDigest, rightDigest] = await Promise.all([encode(left), encode(right)]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = left.length ^ right.length;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

function outcomeFor(status: number | null, networkFailure: boolean): "delivered" | "retry" | "failed" {
  if (networkFailure || status === null || status === 408 || status === 425 || status === 429 || status >= 500) return "retry";
  if (status >= 200 && status < 300) return "delivered";
  return "failed";
}

export async function handlePrimeTimeWebhookDispatch(
  request: Request,
  dependencies: PrimeTimeWebhookDependencies = {},
): Promise<Response> {
  try {
    if (request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);
    if (request.body !== null || (request.headers.get("content-length") || "0") !== "0") {
      return json({ code: "INVALID_REQUEST" }, 422);
    }
    const getEnv = dependencies.env ?? runtimeEnv;
    const fetcher = dependencies.fetch ?? fetch;
    const config = loadConfig(getEnv);
    const authorization = request.headers.get("authorization")?.trim() || "";
    if (!await constantTimeEqual(authorization, `Bearer ${config.dispatchToken}`)) {
      throw new HttpError(401, "UNAUTHORIZED");
    }
    const lease = (dependencies.randomUUID ?? crypto.randomUUID)();
    const leased = await callRpc(fetcher, config, "lease_minuta_integration_webhooks_v142", {
      p_limit: config.batchSize,
      p_lease: lease,
    });
    const deliveries = parseDeliveries(leased, config.batchSize);
    let delivered = 0;
    let retried = 0;
    let failed = 0;

    for (const delivery of deliveries) {
      const destination = config.destinations[delivery.subscriptionId];
      let status: number | null = null;
      let networkFailure = false;
      let errorCode: string | null = null;
      if (!destination || destination.organizationId !== delivery.organizationId ||
        destination.connectionId !== delivery.connectionId || destination.secretRef !== delivery.secretRef ||
        destination.targetUrl !== normalizeExternalTarget(delivery.targetUrl)) {
        errorCode = "destination_not_configured";
      } else {
        const body = JSON.stringify(delivery.payload);
        const timestamp = Math.floor((dependencies.now ?? Date.now)() / 1000).toString();
        const signature = await hmacHex(destination.secret, `${timestamp}.${body}`);
        try {
          const response = await fetcher(destination.targetUrl, {
            method: "POST",
            redirect: "error",
            headers: {
              "content-type": "application/json",
              "user-agent": "PrimeTime-Webhook/1.0",
              "x-primetime-event-id": delivery.id,
              "x-primetime-event-type": delivery.eventType,
              "x-primetime-timestamp": timestamp,
              "x-primetime-signature": `v1=${signature}`,
            },
            body,
            signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
          });
          status = response.status;
          try {
            await response.body?.cancel();
          } catch {
            // Response bodies are intentionally ignored and never logged.
          }
        } catch {
          networkFailure = true;
          errorCode = "network_error";
        }
      }

      const outcome = errorCode === "destination_not_configured"
        ? "failed"
        : outcomeFor(status, networkFailure);
      if (outcome === "delivered") delivered += 1;
      else if (outcome === "retry") retried += 1;
      else failed += 1;
      const settled = await callRpc(fetcher, config, "settle_minuta_integration_webhook_v142", {
        p_id: delivery.id,
        p_lease: lease,
        p_outcome: outcome,
        p_status: status,
        p_error_code: outcome === "delivered" ? null : (errorCode ?? `http_${status}`),
      });
      if (settled.ok !== true) throw new HttpError(502, "UPSTREAM_INVALID_RESPONSE");
    }
    return json({ leased: deliveries.length, delivered, retried, failed });
  } catch (error) {
    if (error instanceof HttpError) return json({ code: error.code }, error.status);
    return json({ code: "INTERNAL_ERROR" }, 500);
  }
}
