const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "vary": "Accept",
};

const MAX_BODY_BYTES = 64 * 1024;
const MAX_RPC_RESPONSE_BYTES = 1024 * 1024;
const MAX_CLOCK_SKEW_SECONDS = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$/;
const QUALIFIED_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})$/;

type JsonRecord = Record<string, unknown>;
type ConnectorProvider = "dikidi" | "yclients";

type ConnectorConfig = {
  connectionId: string;
  organizationId: string;
  provider: ConnectorProvider;
  externalLocationId: string;
  secret: string;
};

type RuntimeConfig = {
  supabaseUrl: string;
  serviceKey: string;
  connections: Readonly<Record<string, ConnectorConfig>>;
};

type NormalizedProviderEvent = {
  eventType: "booking.created" | "booking.updated" | "booking.cancelled";
  command: JsonRecord;
};

export type ProviderInboundDependencies = {
  env?: (name: string) => string | undefined;
  fetch?: typeof fetch;
  now?: () => number;
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

async function readBoundedBody(request: Request): Promise<string> {
  const contentLength = request.headers.get("content-length")?.trim();
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(413, "PAYLOAD_TOO_LARGE");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // The size verdict does not depend on transport cancellation support.
      }
      throw new HttpError(413, "PAYLOAD_TOO_LARGE");
    }
    chunks.push(value);
  }
  if (total < 2) throw new HttpError(413, "PAYLOAD_TOO_LARGE");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new HttpError(422, "INVALID_REQUEST");
  }
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
    const value = JSON.parse(requiredEnv(getEnv, "SUPABASE_SECRET_KEYS")) as unknown;
    if (isRecord(value) && typeof value.default === "string" && value.default.trim()) {
      return value.default.trim();
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
  }
  throw new HttpError(503, "NOT_CONFIGURED");
}

function boundedIdentifier(value: unknown, code = "INVALID_REQUEST", status = 422): string {
  const normalized = typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : typeof value === "string"
    ? value.trim()
    : "";
  if (!IDENTIFIER.test(normalized)) throw new HttpError(status, code);
  return normalized;
}

function parseConnections(raw: string): Readonly<Record<string, ConnectorConfig>> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new HttpError(503, "NOT_CONFIGURED");
  }
  if (!isRecord(value) || Object.keys(value).length < 1 || Object.keys(value).length > 100) {
    throw new HttpError(503, "NOT_CONFIGURED");
  }
  const connections: Record<string, ConnectorConfig> = {};
  for (const [rawConnectionId, rawEntry] of Object.entries(value)) {
    if (!UUID.test(rawConnectionId) || !isRecord(rawEntry)
      || !Object.keys(rawEntry).every((key) => ["organizationId", "provider", "externalLocationId", "secret"].includes(key))
      || Object.keys(rawEntry).length !== 4 || !UUID.test(String(rawEntry.organizationId || ""))
      || !["dikidi", "yclients"].includes(String(rawEntry.provider || ""))) {
      throw new HttpError(503, "NOT_CONFIGURED");
    }
    const externalLocationId = boundedIdentifier(rawEntry.externalLocationId, "NOT_CONFIGURED", 503);
    const secret = typeof rawEntry.secret === "string" ? rawEntry.secret.trim() : "";
    if (new TextEncoder().encode(secret).byteLength < 32 || secret.length > 4096) {
      throw new HttpError(503, "NOT_CONFIGURED");
    }
    const connectionId = rawConnectionId.toLowerCase();
    if (Object.hasOwn(connections, connectionId)) throw new HttpError(503, "NOT_CONFIGURED");
    connections[connectionId] = Object.freeze({
      connectionId,
      organizationId: String(rawEntry.organizationId).toLowerCase(),
      provider: rawEntry.provider as ConnectorProvider,
      externalLocationId,
      secret,
    });
  }
  return Object.freeze(connections);
}

function loadConfig(getEnv: (name: string) => string | undefined): RuntimeConfig {
  if (getEnv("PRIMETIME_PROVIDER_INBOUND_V144_ENABLED")?.trim().toLowerCase() !== "true"
    || getEnv("PRIMETIME_PROVIDER_INBOUND_V144_ENVIRONMENT")?.trim().toLowerCase() !== "testing") {
    throw new HttpError(503, "NOT_CONFIGURED");
  }
  const supabaseUrl = requiredEnv(getEnv, "SUPABASE_URL").replace(/\/$/, "");
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/") throw new Error();
  } catch {
    throw new HttpError(503, "NOT_CONFIGURED");
  }
  return {
    supabaseUrl,
    serviceKey: parseServiceKey(getEnv),
    connections: parseConnections(requiredEnv(getEnv, "PRIMETIME_PROVIDER_INBOUND_V144_CONNECTIONS")),
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
  if (!isRecord(payload) || payload.ok !== true || typeof payload.eventId !== "string"
    || !["accepted", "processed", "failed"].includes(String(payload.state))) {
    throw new HttpError(502, "UPSTREAM_INVALID_RESPONSE");
  }
  return payload;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([sha256Hex(left), sha256Hex(right)]);
  let difference = left.length ^ right.length;
  for (let index = 0; index < leftDigest.length; index += 1) {
    difference |= leftDigest.charCodeAt(index) ^ rightDigest.charCodeAt(index);
  }
  return difference === 0;
}

function parseInstant(value: unknown): string {
  if (typeof value !== "string" || !QUALIFIED_INSTANT.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new HttpError(422, "INVALID_REQUEST");
  }
  return new Date(value).toISOString();
}

function serviceIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
    throw new HttpError(422, "INVALID_REQUEST");
  }
  const result = value.map((entry) => boundedIdentifier(
    isRecord(entry) ? entry.id : entry,
  ));
  if (new Set(result).size !== result.length) throw new HttpError(422, "INVALID_REQUEST");
  return result.sort((left, right) => left.localeCompare(right));
}

function normalizeYclients(payload: JsonRecord, config: ConnectorConfig): NormalizedProviderEvent {
  const companyId = boundedIdentifier(payload.company_id);
  if (companyId !== config.externalLocationId || payload.resource !== "record"
    || !["create", "update", "delete"].includes(String(payload.status))) {
    throw new HttpError(422, "INVALID_REQUEST");
  }
  const externalBookingId = boundedIdentifier(payload.resource_id);
  if (!isRecord(payload.data)) throw new HttpError(422, "INVALID_REQUEST");
  const data = payload.data;
  if (data.id !== undefined && boundedIdentifier(data.id) !== externalBookingId) {
    throw new HttpError(422, "INVALID_REQUEST");
  }
  if (data.company_id !== undefined && boundedIdentifier(data.company_id) !== companyId) {
    throw new HttpError(422, "INVALID_REQUEST");
  }
  if (payload.status === "delete" || data.deleted === true) {
    return {
      eventType: "booking.cancelled",
      command: { action: "cancel_booking", externalLocationId: companyId, externalBookingId },
    };
  }
  return {
    eventType: payload.status === "create" ? "booking.created" : "booking.updated",
    command: {
      action: "refresh_booking", externalLocationId: companyId,
      externalBookingId, reason: "partial_webhook",
    },
  };
}

function normalizeDikidi(
  payload: JsonRecord,
  config: ConnectorConfig,
  eventId: string,
): NormalizedProviderEvent {
  if (payload.schema !== "primetime.dikidi.booking.v1"
    || boundedIdentifier(payload.event_id) !== eventId
    || !["booking.created", "booking.updated", "booking.cancelled"].includes(String(payload.event))
    || boundedIdentifier(payload.organization_id) !== config.externalLocationId
    || !isRecord(payload.booking)) {
    throw new HttpError(422, "INVALID_REQUEST");
  }
  const booking = payload.booking;
  const externalBookingId = boundedIdentifier(booking.id);
  if (payload.event === "booking.cancelled" || booking.status === "cancelled") {
    return {
      eventType: "booking.cancelled",
      command: {
        action: "cancel_booking", externalLocationId: config.externalLocationId, externalBookingId,
      },
    };
  }
  const startsAt = parseInstant(booking.starts_at);
  const endsAt = parseInstant(booking.ends_at);
  if (Date.parse(endsAt) <= Date.parse(startsAt) || Date.parse(endsAt) - Date.parse(startsAt) > 86400000) {
    throw new HttpError(422, "INVALID_REQUEST");
  }
  return {
    eventType: payload.event as "booking.created" | "booking.updated",
    command: {
      action: "upsert_booking",
      externalLocationId: config.externalLocationId,
      externalBookingId,
      staffExternalId: boundedIdentifier(booking.staff_id),
      serviceExternalIds: serviceIds(booking.service_ids),
      startsAt,
      endsAt,
    },
  };
}

function route(request: Request): { provider: ConnectorProvider; connectionId: string } {
  const match = /\/v1\/events\/(dikidi|yclients)\/([0-9a-f-]{36})\/?$/i.exec(new URL(request.url).pathname);
  if (!match || !UUID.test(match[2])) throw new HttpError(404, "NOT_FOUND");
  return { provider: match[1].toLowerCase() as ConnectorProvider, connectionId: match[2].toLowerCase() };
}

export async function handleProviderInboundRequest(
  request: Request,
  dependencies: ProviderInboundDependencies = {},
): Promise<Response> {
  try {
    if (request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);
    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE");
    }
    const getEnv = dependencies.env ?? runtimeEnv;
    const config = loadConfig(getEnv);
    const target = route(request);
    const connection = config.connections[target.connectionId];
    if (!connection || connection.provider !== target.provider) throw new HttpError(401, "UNAUTHORIZED");

    const rawBody = await readBoundedBody(request);
    const eventId = boundedIdentifier(request.headers.get("x-primetime-provider-event-id"));
    const timestamp = request.headers.get("x-primetime-provider-timestamp")?.trim() || "";
    if (!/^\d{10}$/.test(timestamp)
      || Math.abs(Math.floor((dependencies.now ?? Date.now)() / 1000) - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) {
      throw new HttpError(401, "INVALID_SIGNATURE");
    }
    const suppliedSignature = request.headers.get("x-primetime-provider-signature")?.trim().toLowerCase() || "";
    const expectedSignature = `v1=${await hmacHex(connection.secret, `${timestamp}.${rawBody}`)}`;
    if (!/^v1=[0-9a-f]{64}$/.test(suppliedSignature)
      || !await constantTimeEqual(suppliedSignature, expectedSignature)) {
      throw new HttpError(401, "INVALID_SIGNATURE");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new HttpError(422, "INVALID_REQUEST");
    }
    if (!isRecord(payload)) throw new HttpError(422, "INVALID_REQUEST");
    const normalized = target.provider === "yclients"
      ? normalizeYclients(payload, connection)
      : normalizeDikidi(payload, connection, eventId);
    const result = await callRpc(dependencies.fetch ?? fetch, config, "record_minuta_provider_event_v144", {
      p_connection: connection.connectionId,
      p_organization: connection.organizationId,
      p_provider_event_id: eventId,
      p_payload_sha256: await sha256Hex(rawBody),
      p_event_type: normalized.eventType,
      p_command: normalized.command,
    });
    return json({
      ok: true,
      eventId: result.eventId,
      state: result.state,
      replayed: result.replayed === true,
    });
  } catch (error) {
    if (error instanceof HttpError) return json({ code: error.code }, error.status);
    return json({ code: "INTERNAL_ERROR" }, 500);
  }
}
