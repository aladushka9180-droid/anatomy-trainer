const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "vary": "Accept",
};

const MAX_BODY_BYTES = 24 * 1024;
const MAX_RPC_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_RANGE_DAYS = 90;

type JsonRecord = Record<string, unknown>;
type IntegrationEnvironment = "testing" | "production";

export type IntegrationApiDependencies = {
  env?: (name: string) => string | undefined;
  fetch?: typeof fetch;
};

type RuntimeConfig = {
  environment: IntegrationEnvironment;
  supabaseUrl: string;
  serviceKey: string;
};

type ApiIdentity = {
  keyId: string;
  secretSha256: string;
};

type Route =
  | { kind: "calendar" }
  | { kind: "calendar_event"; externalEventId: string };

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly headers: Record<string, string>;

  constructor(status: number, code: string, headers: Record<string, string> = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
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

function loadConfig(getEnv: (name: string) => string | undefined): RuntimeConfig {
  if (getEnv("PRIMETIME_INTEGRATION_ENABLED")?.trim().toLowerCase() !== "true") {
    throw new HttpError(503, "NOT_CONFIGURED");
  }
  const environment = requiredEnv(getEnv, "PRIMETIME_INTEGRATION_ENVIRONMENT");
  if (environment !== "testing" && environment !== "production") {
    throw new HttpError(503, "NOT_CONFIGURED");
  }
  const supabaseUrl = requiredEnv(getEnv, "SUPABASE_URL").replace(/\/$/, "");
  try {
    const parsed = new URL(supabaseUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/") {
      throw new Error("unsafe_url");
    }
  } catch {
    throw new HttpError(503, "NOT_CONFIGURED");
  }
  return { environment, supabaseUrl, serviceKey: parseServiceKey(getEnv) };
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
  timeoutMilliseconds = 5_000,
): Promise<JsonRecord> {
  let response: Response;
  try {
    response = await fetcher(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: rpcHeaders(config.serviceKey),
      body: JSON.stringify(parameters),
      signal: AbortSignal.timeout(timeoutMilliseconds),
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

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as JsonRecord).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

async function parseIdentity(request: Request): Promise<ApiIdentity> {
  const authorization = request.headers.get("authorization")?.trim() || "";
  const match = /^Bearer\s+ptk_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43,128})$/i.exec(authorization);
  if (!match) throw new HttpError(401, "UNAUTHORIZED");
  return { keyId: match[1].toLowerCase(), secretSha256: await sha256Hex(match[2]) };
}

function parseRoute(url: URL): Route {
  const path = url.pathname.replace(/^\/functions\/v1\/primetime-integration-api/, "").replace(/\/+$/, "") || "/";
  if (path === "/v1/calendar/events") return { kind: "calendar" };
  const match = /^\/v1\/calendar\/events\/([^/]+)$/.exec(path);
  if (match) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(match[1]);
    } catch {
      throw new HttpError(404, "NOT_FOUND");
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$/.test(decoded)) {
      throw new HttpError(422, "INVALID_REQUEST");
    }
    return { kind: "calendar_event", externalEventId: decoded };
  }
  throw new HttpError(404, "NOT_FOUND");
}

function assertAccept(request: Request): void {
  const accept = request.headers.get("accept") || "";
  if (!/(^|[,;\s])application\/json(?:$|[,;\s]|\*\+json)/i.test(accept) && !accept.includes("*/*")) {
    throw new HttpError(406, "JSON_REQUIRED");
  }
}

function assertQueryKeys(parameters: URLSearchParams, allowed: ReadonlySet<string>): void {
  for (const key of parameters.keys()) if (!allowed.has(key)) throw new HttpError(422, "INVALID_REQUEST");
}

function exactKeys(value: JsonRecord, allowed: ReadonlySet<string>, required: ReadonlySet<string>): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new HttpError(422, "INVALID_REQUEST");
  for (const key of required) if (!(key in value)) throw new HttpError(422, "INVALID_REQUEST");
}

function scalarQuery(parameters: URLSearchParams, name: string, required = false): string | null {
  const values = parameters.getAll(name);
  if (values.length > 1 || (required && values.length !== 1)) throw new HttpError(422, "INVALID_REQUEST");
  const value = values[0]?.trim() || null;
  if (required && !value) throw new HttpError(422, "INVALID_REQUEST");
  return value;
}

function isoDatetime(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length > 80 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new HttpError(422, "INVALID_REQUEST");
  }
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) throw new HttpError(422, "INVALID_REQUEST");
  return value;
}

function boundedId(value: unknown, maximum = 160): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:@/-]*$/.test(value) || value.length > maximum) {
    throw new HttpError(422, "INVALID_REQUEST");
  }
  return value;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(422, "INVALID_REQUEST");
  }
  return value.toLowerCase();
}

async function readJsonObject(request: Request): Promise<JsonRecord> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) {
    throw new HttpError(415, "JSON_REQUIRED");
  }
  const declared = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new HttpError(413, "PAYLOAD_TOO_LARGE");
  const text = await request.text();
  if (!text || new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new HttpError(text ? 413 : 422, text ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(422, "INVALID_REQUEST");
  }
  if (!isRecord(parsed)) throw new HttpError(422, "INVALID_REQUEST");
  return parsed;
}

function idempotencyKey(request: Request): string {
  const value = request.headers.get("idempotency-key")?.trim() || "";
  if (!/^[\x21-\x7e]{8,200}$/.test(value)) throw new HttpError(422, "IDEMPOTENCY_KEY_REQUIRED");
  return value;
}

function mapSemanticError(result: JsonRecord): never {
  const code = typeof result.error === "string" ? result.error : "";
  const mapped: Record<string, [number, string]> = {
    connection_not_found: [404, "CONNECTION_NOT_FOUND"],
    event_not_found: [404, "EVENT_NOT_FOUND"],
    performer_not_found: [422, "PERFORMER_NOT_FOUND"],
    location_not_found: [422, "LOCATION_NOT_FOUND"],
    slot_unavailable: [422, "SLOT_UNAVAILABLE"],
    request_conflict: [409, "REQUEST_CONFLICT"],
    revision_conflict: [409, "REVISION_CONFLICT"],
    rate_limited: [429, "RATE_LIMITED"],
  };
  const item = mapped[code];
  if (item) throw new HttpError(item[0], item[1], item[0] === 429 ? { "retry-after": "60" } : {});
  throw new HttpError(502, "UPSTREAM_INVALID_RESPONSE");
}

function success(result: JsonRecord): JsonRecord {
  if (result.ok !== true) mapSemanticError(result);
  return result;
}

export async function handlePrimeTimeIntegrationRequest(
  request: Request,
  dependencies: IntegrationApiDependencies = {},
): Promise<Response> {
  try {
    assertAccept(request);
    if (request.url.length > 8 * 1024) throw new HttpError(414, "URI_TOO_LONG");
    const getEnv = dependencies.env ?? runtimeEnv;
    const fetcher = dependencies.fetch ?? fetch;
    const config = loadConfig(getEnv);
    const url = new URL(request.url);
    const route = parseRoute(url);
    const scope = request.method === "GET" ? "calendar:read" : "calendar:write";
    if ((route.kind === "calendar" && request.method !== "GET") ||
      (route.kind === "calendar_event" && !["PUT", "DELETE"].includes(request.method))) {
      throw new HttpError(405, "METHOD_NOT_ALLOWED", { allow: route.kind === "calendar" ? "GET" : "PUT, DELETE" });
    }

    const identity = await parseIdentity(request);
    const auth = await callRpc(fetcher, config, "authenticate_minuta_integration_key_v142", {
      p_key_id: identity.keyId,
      p_secret_sha256: identity.secretSha256,
      p_environment: config.environment,
      p_required_scope: scope,
    });
    if (auth.ok !== true || typeof auth.connection_id !== "string") throw new HttpError(401, "UNAUTHORIZED");
    const connectionId = uuid(auth.connection_id);
    const limited = await callRpc(fetcher, config, "consume_minuta_integration_rate_limit_v142", {
      p_connection: connectionId,
      p_key_id: identity.keyId,
      p_operation_class: request.method === "GET" ? "read" : "mutation",
    });
    if (limited.ok !== true || limited.allowed !== true) mapSemanticError({ error: "rate_limited" });

    if (route.kind === "calendar") {
      assertQueryKeys(url.searchParams, new Set(["from", "to", "limit", "afterUpdatedAt", "afterId"]));
      const from = isoDatetime(scalarQuery(url.searchParams, "from", true), "from");
      const to = isoDatetime(scalarQuery(url.searchParams, "to", true), "to");
      if (Date.parse(to) <= Date.parse(from) || Date.parse(to) - Date.parse(from) > MAX_RANGE_DAYS * 86_400_000) {
        throw new HttpError(422, "INVALID_REQUEST");
      }
      const rawLimit = scalarQuery(url.searchParams, "limit");
      const limit = rawLimit === null ? 200 : Number(rawLimit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new HttpError(422, "INVALID_REQUEST");
      const afterUpdatedAtRaw = scalarQuery(url.searchParams, "afterUpdatedAt");
      const afterIdRaw = scalarQuery(url.searchParams, "afterId");
      if ((afterUpdatedAtRaw === null) !== (afterIdRaw === null)) throw new HttpError(422, "INVALID_REQUEST");
      const result = success(await callRpc(fetcher, config, "get_minuta_integration_calendar_v142", {
        p_connection: connectionId,
        p_from: from,
        p_to: to,
        p_count: limit,
        p_after_updated_at: afterUpdatedAtRaw === null ? null : isoDatetime(afterUpdatedAtRaw, "afterUpdatedAt"),
        p_after_id: afterIdRaw === null ? null : uuid(afterIdRaw),
      }));
      if (!Array.isArray(result.events) || result.events.length > limit) throw new HttpError(502, "UPSTREAM_INVALID_RESPONSE");
      return json({ events: result.events, nextCursor: result.next_cursor ?? null });
    }

    assertQueryKeys(url.searchParams, new Set());
    const requestId = await sha256Hex(`${config.environment}|${request.method}|${route.externalEventId}|${idempotencyKey(request)}`);
    if (request.method === "PUT") {
      const body = await readJsonObject(request);
      exactKeys(body,
        new Set(["performerId", "locationId", "startsAt", "endsAt", "revision", "expectedRevision"]),
        new Set(["performerId", "locationId", "startsAt", "endsAt", "revision"]));
      const startsAt = isoDatetime(body.startsAt, "startsAt");
      const endsAt = isoDatetime(body.endsAt, "endsAt");
      if (Date.parse(endsAt) <= Date.parse(startsAt) || Date.parse(endsAt) - Date.parse(startsAt) > 8 * 60 * 60 * 1000) {
        throw new HttpError(422, "INVALID_REQUEST");
      }
      const revision = boundedId(body.revision, 120);
      const expectedRevision = body.expectedRevision === null || body.expectedRevision === undefined
        ? null
        : boundedId(body.expectedRevision, 120);
      const normalized = {
        performerId: uuid(body.performerId),
        locationId: uuid(body.locationId),
        startsAt,
        endsAt,
        revision,
        expectedRevision,
      };
      const result = success(await callRpc(fetcher, config, "upsert_minuta_integration_calendar_event_v142", {
        p_connection: connectionId,
        p_request_key: requestId,
        p_payload_sha256: await sha256Hex(canonicalJson(normalized)),
        p_external_event_id: route.externalEventId,
        p_performer: normalized.performerId,
        p_location: normalized.locationId,
        p_starts_at: normalized.startsAt,
        p_ends_at: normalized.endsAt,
        p_revision: normalized.revision,
        p_expected_revision: normalized.expectedRevision,
      }));
      if (!isRecord(result.event)) throw new HttpError(502, "UPSTREAM_INVALID_RESPONSE");
      return json({ event: result.event, replayed: result.replayed === true });
    }

    const expectedRevision = request.headers.get("if-match")?.replace(/^W\//, "").replace(/^"|"$/g, "").trim() || "";
    if (!expectedRevision) throw new HttpError(428, "REVISION_REQUIRED");
    boundedId(expectedRevision, 120);
    const payloadSha256 = await sha256Hex(canonicalJson({ expectedRevision }));
    const result = success(await callRpc(fetcher, config, "delete_minuta_integration_calendar_event_v142", {
      p_connection: connectionId,
      p_request_key: requestId,
      p_payload_sha256: payloadSha256,
      p_external_event_id: route.externalEventId,
      p_expected_revision: expectedRevision,
    }));
    return json({ deleted: true, replayed: result.replayed === true });
  } catch (error) {
    if (error instanceof HttpError) return json({ code: error.code }, error.status, error.headers);
    return json({ code: "INTERNAL_ERROR" }, 500);
  }
}
