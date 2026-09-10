const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "vary": "Accept",
};

const MAX_BODY_BYTES = 32 * 1024;
const MAX_URL_LENGTH = 8 * 1024;
const MAX_RPC_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_SERVICE_IDS = 50;
const MAX_RESOURCE_FILTER_SERVICE_IDS = 20;
const MAX_DATE_RANGE_DAYS = 14;

type JsonRecord = Record<string, unknown>;
type BookingEnvironment = "testing" | "production";

export type YandexBookingDependencies = {
  env?: (name: string) => string | undefined;
  fetch?: typeof fetch;
  now?: () => number;
};

type RuntimeConfig = {
  environment: BookingEnvironment;
  partnerName: string;
  jwtKeys: Readonly<Record<string, string>>;
  expectedIssuer: string | null;
  expectedAudience: string | null;
  supabaseUrl: string;
  serviceKey: string;
};

type Route =
  | { kind: "feed" }
  | { kind: "services"; companyId: string }
  | { kind: "resources"; companyId: string }
  | { kind: "reviews"; companyId: string; resourceId: string }
  | { kind: "available_dates"; companyId: string }
  | { kind: "available_time_slots"; companyId: string }
  | { kind: "special_conditions"; companyId: string }
  | { kind: "bookings" }
  | { kind: "booking"; bookingId: string }
  | { kind: "prebookings" }
  | { kind: "prebooking"; prebookingId: string };

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: string,
    headers: Record<string, string> = {},
  ) {
    super(code);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
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
  const raw = requiredEnv(getEnv, "SUPABASE_SECRET_KEYS");
  try {
    const parsed = JSON.parse(raw) as unknown;
    const key = isRecord(parsed) && typeof parsed.default === "string"
      ? parsed.default.trim()
      : "";
    if (key) return key;
  } catch {
    // Return one public configuration error without exposing which secret failed.
  }
  throw new HttpError(503, "NOT_CONFIGURED");
}

function parseJwtKeys(raw: string): Readonly<Record<string, string>> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new HttpError(503, "NOT_CONFIGURED");
  }
  if (!isRecord(value)) throw new HttpError(503, "NOT_CONFIGURED");
  const entries = Object.entries(value);
  if (entries.length < 1 || entries.length > 8) throw new HttpError(503, "NOT_CONFIGURED");
  const keys: Record<string, string> = {};
  for (const [keyId, secret] of entries) {
    if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(keyId) || typeof secret !== "string") {
      throw new HttpError(503, "NOT_CONFIGURED");
    }
    const normalized = secret.trim();
    if (new TextEncoder().encode(normalized).byteLength < 32 || normalized.length > 4096) {
      throw new HttpError(503, "NOT_CONFIGURED");
    }
    keys[keyId] = normalized;
  }
  if (!keys.default) throw new HttpError(503, "NOT_CONFIGURED");
  return Object.freeze(keys);
}

function loadConfig(getEnv: (name: string) => string | undefined): RuntimeConfig {
  if (getEnv("YANDEX_BOOKING_ENABLED")?.trim().toLowerCase() !== "true") {
    throw new HttpError(503, "NOT_CONFIGURED");
  }
  const environment = requiredEnv(getEnv, "YANDEX_BOOKING_ENVIRONMENT");
  if (environment !== "testing" && environment !== "production") {
    throw new HttpError(503, "NOT_CONFIGURED");
  }
  const partnerName = requiredEnv(getEnv, "YANDEX_BOOKING_PARTNER_NAME");
  if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(partnerName)) {
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
  return {
    environment,
    partnerName,
    jwtKeys: parseJwtKeys(requiredEnv(getEnv, "YANDEX_BOOKING_JWT_KEYS")),
    expectedIssuer: getEnv("YANDEX_BOOKING_EXPECTED_ISSUER")?.trim() || null,
    expectedAudience: getEnv("YANDEX_BOOKING_EXPECTED_AUDIENCE")?.trim() || null,
    supabaseUrl,
    serviceKey: parseServiceKey(getEnv),
  };
}

function decodeBase64Url(value: string, maxBytes: number): Uint8Array {
  if (!value || value.length > maxBytes * 2 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new HttpError(401, "UNAUTHORIZED");
  }
  const padding = "=".repeat((4 - value.length % 4) % 4);
  let binary: string;
  try {
    binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
  } catch {
    throw new HttpError(401, "UNAUTHORIZED");
  }
  if (binary.length > maxBytes) throw new HttpError(401, "UNAUTHORIZED");
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJwtObject(segment: string, maxBytes: number): JsonRecord {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64Url(segment, maxBytes));
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) throw new Error("not_object");
    return parsed;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, "UNAUTHORIZED");
  }
}

function optionalNumericDate(claims: JsonRecord, name: "exp" | "nbf"): number | null {
  if (!(name in claims)) return null;
  const value = claims[name];
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new HttpError(401, "UNAUTHORIZED");
  }
  return Number(value);
}

function validateOptionalIdentityClaims(claims: JsonRecord, config: RuntimeConfig): void {
  if ("iat" in claims) throw new HttpError(401, "UNAUTHORIZED");
  if (config.expectedIssuer && !("iss" in claims)) throw new HttpError(401, "UNAUTHORIZED");
  if ("iss" in claims) {
    if (typeof claims.iss !== "string" || claims.iss.length > 500) {
      throw new HttpError(401, "UNAUTHORIZED");
    }
    if (config.expectedIssuer && claims.iss !== config.expectedIssuer) {
      throw new HttpError(401, "UNAUTHORIZED");
    }
  }
  if (config.expectedAudience && !("aud" in claims)) throw new HttpError(401, "UNAUTHORIZED");
  if ("aud" in claims) {
    const audiences = typeof claims.aud === "string"
      ? [claims.aud]
      : Array.isArray(claims.aud) && claims.aud.every((item) => typeof item === "string")
      ? claims.aud as string[]
      : null;
    if (!audiences || audiences.length > 20 || audiences.some((item) => item.length > 500)) {
      throw new HttpError(401, "UNAUTHORIZED");
    }
    if (config.expectedAudience && !audiences.includes(config.expectedAudience)) {
      throw new HttpError(401, "UNAUTHORIZED");
    }
  }
}

async function verifyJwt(
  request: Request,
  config: RuntimeConfig,
  nowMilliseconds: number,
): Promise<JsonRecord> {
  const authorization = request.headers.get("authorization")?.trim() || "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  if (!match || match[1].length > 16 * 1024) throw new HttpError(401, "UNAUTHORIZED");
  const segments = match[1].split(".");
  if (segments.length !== 3) throw new HttpError(401, "UNAUTHORIZED");
  const header = decodeJwtObject(segments[0], 2048);
  const allowedHeaderKeys = new Set(["alg", "typ", "kid"]);
  if (
    header.alg !== "HS256" || header.typ !== "JWT" ||
    Object.keys(header).some((key) => !allowedHeaderKeys.has(key)) ||
    ("kid" in header && (typeof header.kid !== "string" || !/^[A-Za-z0-9_.:-]{1,80}$/.test(header.kid)))
  ) {
    throw new HttpError(401, "UNAUTHORIZED");
  }
  const claims = decodeJwtObject(segments[1], 12 * 1024);
  if (claims.sub !== config.partnerName) throw new HttpError(401, "UNAUTHORIZED");
  validateOptionalIdentityClaims(claims, config);

  const nowSeconds = Math.floor(nowMilliseconds / 1000);
  const exp = optionalNumericDate(claims, "exp");
  const nbf = optionalNumericDate(claims, "nbf");
  if (exp !== null && exp <= nowSeconds) {
    throw new HttpError(401, "UNAUTHORIZED");
  }
  if (nbf !== null && nbf > nowSeconds) {
    throw new HttpError(401, "UNAUTHORIZED");
  }

  const keyId = typeof header.kid === "string" ? header.kid : null;
  const candidateSecrets = keyId
    ? [config.jwtKeys[keyId]].filter((value): value is string => Boolean(value))
    : [config.jwtKeys.default, config.jwtKeys.previous].filter((value, index, values): value is string =>
      Boolean(value) && values.indexOf(value) === index
    );
  if (!candidateSecrets.length) throw new HttpError(401, "UNAUTHORIZED");
  const signedData = new TextEncoder().encode(`${segments[0]}.${segments[1]}`);
  const signature = decodeBase64Url(segments[2], 128);
  const signedBytes = Uint8Array.from(signedData);
  const signatureBytes = Uint8Array.from(signature);
  let valid = false;
  for (const secret of candidateSecrets) {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    // WebCrypto performs the HMAC comparison in constantTime; never compare a
    // caller-provided signature as a string.
    valid = await crypto.subtle.verify("HMAC", key, signatureBytes, signedBytes) || valid;
  }
  if (!valid) throw new HttpError(401, "UNAUTHORIZED");
  return claims;
}

function externalId(value: string, code = "INVALID_REQUEST"): string {
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(value)) throw new HttpError(422, code);
  return value;
}

function parseRoute(url: URL): Route {
  // Official paths: /v1/companies/feed, /services, /resources,
  // /available_dates, /available_time_slots, /special_conditions and
  // /v1/bookings. Supabase prepends the function name before /v1.
  if (url.href.length > MAX_URL_LENGTH) throw new HttpError(414, "URI_TOO_LONG");
  const path = url.pathname.replace(/\/+$/, "");
  const marker = path.lastIndexOf("/v1");
  if (marker < 0 || (path[marker + 3] && path[marker + 3] !== "/")) {
    throw new HttpError(404, "NOT_FOUND");
  }
  let segments: string[];
  try {
    segments = path.slice(marker + 3).split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  } catch {
    throw new HttpError(400, "INVALID_REQUEST");
  }
  if (segments.some((segment) => segment.includes("/") || segment.includes("\\"))) {
    throw new HttpError(400, "INVALID_REQUEST");
  }
  if (segments.length === 2 && segments[0] === "companies" && segments[1] === "feed") return { kind: "feed" };
  if (segments.length === 3 && segments[0] === "companies") {
    const companyId = externalId(segments[1]);
    if (segments[2] === "services") return { kind: "services", companyId };
    if (segments[2] === "resources") return { kind: "resources", companyId };
    if (segments[2] === "available_dates") return { kind: "available_dates", companyId };
    if (segments[2] === "available_time_slots") return { kind: "available_time_slots", companyId };
    if (segments[2] === "special_conditions") return { kind: "special_conditions", companyId };
  }
  if (
    segments.length === 5 && segments[0] === "companies" && segments[2] === "resources" &&
    segments[4] === "reviews"
  ) {
    return { kind: "reviews", companyId: externalId(segments[1]), resourceId: externalId(segments[3]) };
  }
  if (segments.length === 1 && segments[0] === "bookings") return { kind: "bookings" };
  if (segments.length === 2 && segments[0] === "bookings") {
    return { kind: "booking", bookingId: externalId(segments[1]) };
  }
  if (segments.length === 1 && segments[0] === "prebookings") return { kind: "prebookings" };
  if (segments.length === 2 && segments[0] === "prebookings") {
    return { kind: "prebooking", prebookingId: externalId(segments[1]) };
  }
  throw new HttpError(404, "NOT_FOUND");
}

function assertMethod(request: Request, route: Route): void {
  const allowed = route.kind === "feed" || route.kind === "services" || route.kind === "resources" ||
      route.kind === "reviews" || route.kind === "available_dates" || route.kind === "available_time_slots" ||
      route.kind === "special_conditions"
    ? ["GET"]
    : route.kind === "bookings"
    ? ["POST"]
    : route.kind === "booking"
    ? ["GET", "PUT", "DELETE"]
    : route.kind === "prebookings"
    ? ["POST"]
    : ["DELETE"];
  if (!allowed.includes(request.method)) {
    throw new HttpError(405, "METHOD_NOT_ALLOWED", { allow: allowed.join(", ") });
  }
}

function requireJsonAccept(request: Request): void {
  const accept = request.headers.get("accept") || "";
  if (!accept.split(",").some((part) => /^\s*application\/json(?:\s*;|\s*$)/i.test(part))) {
    throw new HttpError(406, "NOT_ACCEPTABLE");
  }
}

function scalarQuery(params: URLSearchParams, name: string, required = false, maxLength = 500): string | null {
  const values = params.getAll(name);
  if (values.length > 1) throw new HttpError(422, "INVALID_REQUEST");
  const value = values[0] ?? "";
  if (!value) {
    if (required) throw new HttpError(422, "INVALID_REQUEST");
    return null;
  }
  if (value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new HttpError(422, "INVALID_REQUEST");
  }
  return value;
}

function serviceIdsQuery(
  params: URLSearchParams,
  required: boolean,
  maxItems = MAX_SERVICE_IDS,
  tooManyCode = "INVALID_REQUEST",
): string[] {
  const values = params.getAll("serviceIds[]");
  if (required && !values.length) throw new HttpError(422, "SERVICE_NOT_FOUND");
  if (values.length > maxItems) throw new HttpError(422, tooManyCode);
  const ids = values.map((value) => externalId(value, "SERVICE_NOT_FOUND"));
  if (new Set(ids).size !== ids.length) throw new HttpError(422, "INVALID_REQUEST");
  return ids;
}

function assertQueryKeys(params: URLSearchParams, allowed: ReadonlySet<string>): void {
  for (const key of params.keys()) {
    if (!allowed.has(key)) throw new HttpError(422, "INVALID_REQUEST");
  }
}

function parseDate(value: string, code = "INVALID_DATE"): { value: string; epochDay: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new HttpError(422, code);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const canonical = new Date(timestamp).toISOString().slice(0, 10);
  if (canonical !== value || year < 2000 || year > 2200) throw new HttpError(422, code);
  return { value, epochDay: Math.floor(timestamp / 86_400_000) };
}

function parseDatetime(value: unknown): string {
  if (typeof value !== "string" || !isIsoDatetime(value)) {
    throw new HttpError(422, "INVALID_DATETIME");
  }
  return value;
}

function boundedString(value: unknown, code: string, maxLength: number, required = false): string | null {
  if (value === undefined) {
    if (required) throw new HttpError(422, code);
    return null;
  }
  if (typeof value !== "string" || (required && !value.trim()) || value.length > maxLength || /[\u0000\u007f]/.test(value)) {
    throw new HttpError(422, code);
  }
  return value;
}

async function readJsonObject(request: Request): Promise<JsonRecord> {
  if (!/^\s*application\/json(?:\s*;|\s*$)/i.test(request.headers.get("content-type") || "")) {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE");
  }
  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE");
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) throw new HttpError(400, "INVALID_JSON");
  if (bytes.byteLength > MAX_BODY_BYTES) throw new HttpError(413, "PAYLOAD_TOO_LARGE");
  try {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    if (!isRecord(parsed)) throw new Error("not_object");
    return parsed;
  } catch {
    throw new HttpError(400, "INVALID_JSON");
  }
}

function assertObjectKeys(value: JsonRecord, allowed: ReadonlySet<string>, required: ReadonlySet<string> = new Set()): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new HttpError(422, "INVALID_REQUEST");
  for (const key of required) if (!(key in value)) throw new HttpError(422, "INVALID_REQUEST");
}

function requiredStringArray(value: unknown, code: string, maxItems = MAX_SERVICE_IDS): string[] {
  if (!Array.isArray(value) || !value.length || value.length > maxItems) throw new HttpError(422, code);
  const result = value.map((item) => typeof item === "string" ? externalId(item, code) : (() => {
    throw new HttpError(422, code);
  })());
  if (new Set(result).size !== result.length) throw new HttpError(422, "INVALID_REQUEST");
  return result;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new HttpError(422, "INVALID_REQUEST");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new HttpError(422, "INVALID_REQUEST");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function mutationIdentity(
  request: Request,
  environment: BookingEnvironment,
  operation: string,
  entityId: string,
  payload: JsonRecord,
): Promise<{ requestKey: string; payloadSha256: string }> {
  const payloadSha256 = await sha256Hex(canonicalJson(payload));
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() || "";
  if (idempotencyKey && (!/^[\x21-\x7e]{1,200}$/.test(idempotencyKey))) {
    throw new HttpError(422, "INVALID_REQUEST");
  }
  const identity = idempotencyKey ? `header:${idempotencyKey}` : `payload:${payloadSha256}`;
  const requestKey = await sha256Hex(`yandex|${environment}|${operation}|${entityId}|${identity}`);
  return { requestKey, payloadSha256 };
}

function rpcHeaders(serviceKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: serviceKey,
    "content-type": "application/json",
    accept: "application/json",
  };
  if (serviceKey.split(".").length === 3) headers.authorization = `Bearer ${serviceKey}`;
  return headers;
}

async function callRpc(
  fetcher: typeof fetch,
  config: RuntimeConfig,
  name: string,
  parameters: JsonRecord,
  timeoutMilliseconds: number,
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
  if (!response.ok) {
    const errorPayload = isRecord(payload) ? payload : {};
    if (response.status === 400 && errorPayload.code === "22023") {
      throw new HttpError(422, "INVALID_REQUEST");
    }
    throw new HttpError(502, "UPSTREAM_UNAVAILABLE");
  }
  if (!isRecord(payload)) throw new HttpError(502, "UPSTREAM_INVALID_RESPONSE");
  return payload;
}

function semanticError(result: JsonRecord): never {
  const error = typeof result.error === "string" ? result.error : "";
  const mapping: Record<string, [number, string]> = {
    company_not_found: [404, "COMPANY_NOT_FOUND"],
    booking_not_found: [404, "BOOKING_NOT_FOUND"],
    service_not_found: [422, "SERVICE_NOT_FOUND"],
    resource_not_found: [422, "RESOURCE_NOT_FOUND"],
    slot_unavailable: [422, "SLOT_UNAVAILABLE"],
    unsupported_service_combination: [422, "SERVICE_NOT_FOUND"],
    create_forbidden: [422, "CREATE_FORBIDDEN"],
    update_forbidden: [422, "UPDATE_FORBIDDEN"],
    reschedule_too_late: [422, "UPDATE_FORBIDDEN"],
    reschedule_limit_reached: [422, "UPDATE_FORBIDDEN"],
    cancel_forbidden: [422, "CANCEL_FORBIDDEN"],
    cancel_too_late: [422, "CANCEL_FORBIDDEN"],
    booking_unavailable: [422, "CANCEL_FORBIDDEN"],
    request_conflict: [409, "REQUEST_CONFLICT"],
  };
  const mapped = mapping[error];
  if (mapped) throw new HttpError(mapped[0], mapped[1]);
  throw new HttpError(502, "UPSTREAM_INVALID_RESPONSE");
}

function successResult(result: JsonRecord): JsonRecord {
  if (result.ok !== true) semanticError(result);
  return result;
}

function nonNullEntries(entries: Array<[string, unknown]>): JsonRecord {
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined && value !== null));
}

function upstreamInvalid(): never {
  throw new HttpError(502, "UPSTREAM_INVALID_RESPONSE");
}

function officialString(value: unknown, required = false, maxLength = 2_000): string | undefined {
  if (value === undefined || value === null) {
    if (required) upstreamInvalid();
    return undefined;
  }
  if (
    typeof value !== "string" || value.length > maxLength ||
    (required && !value.trim()) || /[\u0000-\u001f\u007f]/.test(value)
  ) upstreamInvalid();
  return value;
}

function officialText(value: unknown, required = false): string | JsonRecord | undefined {
  if (typeof value === "string" || value === undefined || value === null) {
    return officialString(value, required);
  }
  if (!isRecord(value)) upstreamInvalid();
  const text = officialString(value.text, true)!;
  let localizedText: JsonRecord[] | undefined;
  if (value.localizedText !== undefined && value.localizedText !== null) {
    if (!Array.isArray(value.localizedText) || value.localizedText.length > 50) upstreamInvalid();
    localizedText = value.localizedText.map((item) => {
      if (!isRecord(item)) upstreamInvalid();
      const lang = officialString(item.lang, true, 16)!;
      if (!/^[A-Za-z]{2}(?:-[A-Za-z0-9]{2,8})?$/.test(lang)) upstreamInvalid();
      return { lang, text: officialString(item.text, true)! };
    });
  }
  return nonNullEntries([["text", text], ["localizedText", localizedText]]);
}

function officialNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  integer = false,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum ||
    (integer && !Number.isInteger(value))
  ) upstreamInvalid();
  return value;
}

function officialUrl(value: unknown): string | undefined {
  const text = officialString(value, false, 2_048);
  if (text === undefined) return undefined;
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) upstreamInvalid();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    upstreamInvalid();
  }
  return text;
}

function officialStringArray(value: unknown, maxItems: number): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > maxItems) upstreamInvalid();
  return value.map((item) => officialString(item, true, 2_000)!);
}

function officialPrice(value: unknown): JsonRecord | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value) || !Array.isArray(value.range) || value.range.length < 1 || value.range.length > 2) {
    upstreamInvalid();
  }
  const currencyCode = officialString(value.currencyCode, true, 3)!;
  if (!/^[A-Z]{3}$/.test(currencyCode)) upstreamInvalid();
  const range = value.range.map((amount) => officialNumber(amount, 0, 1_000_000_000)!);
  return { currencyCode, range };
}

function officialServiceResource(value: unknown): JsonRecord {
  if (!isRecord(value)) upstreamInvalid();
  const id = officialString(value.id, true, 200)!;
  return nonNullEntries([
    ["id", id],
    ["durationSeconds", officialNumber(value.durationSeconds ?? value.duration_seconds, 1, 31_536_000, true)],
  ]);
}

function officialCondition(value: unknown): JsonRecord {
  if (!isRecord(value)) upstreamInvalid();
  return nonNullEntries([
    ["title", officialString(value.title, true)!],
    ["value", officialString(value.value)],
  ]);
}

function isCanonicalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function isIsoDatetime(value: string): boolean {
  if (value.length > 80) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const year = Number(match[1]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] === "Z" ? 0 : Number(match[8]);
  const offsetMinute = match[7] === "Z" ? 0 : Number(match[9]);
  return year >= 2000 && year <= 2200 && isCanonicalDate(date) &&
    hour <= 23 && minute <= 59 && second <= 59 &&
    offsetHour <= 23 && offsetMinute <= 59 && Number.isFinite(Date.parse(value));
}

function officialService(value: unknown): JsonRecord {
  if (!isRecord(value)) upstreamInvalid();
  const id = officialString(value.id, true, 200)!;
  const title = value.title ?? value.name;
  let price = value.price;
  if (typeof price === "number" && Number.isFinite(price)) {
    price = { currencyCode: value.currency ?? "RUB", range: [price, price] };
  }
  const resourceIds = Array.isArray(value.resourceIds) ? value.resourceIds : value.resource_ids;
  const resources = Array.isArray(value.resources)
    ? value.resources.map(officialServiceResource)
    : Array.isArray(resourceIds)
    ? resourceIds.map((resourceId) => officialServiceResource({ id: resourceId }))
    : undefined;
  return nonNullEntries([
    ["id", id],
    ["title", officialText(title, true)],
    ["description", officialText(value.description)],
    ["category", officialText(value.category)],
    ["image", officialUrl(value.image)],
    ["price", officialPrice(price)],
    ["durationSeconds", officialNumber(value.durationSeconds ?? value.duration_seconds ?? value.duration, 1, 31_536_000, true)],
    ["resources", resources],
  ]);
}

function officialResource(value: unknown): JsonRecord {
  if (!isRecord(value)) upstreamInvalid();
  const id = officialString(value.id, true, 200)!;
  const title = value.title ?? value.name;
  return nonNullEntries([
    ["id", id],
    ["title", officialText(title, true)],
    ["description", officialText(value.description)],
    ["information", officialText(value.information)],
    ["rating", officialNumber(value.rating, 0, 5)],
    ["image", officialUrl(value.image)],
    ["reviewsCount", officialNumber(value.reviewsCount ?? value.reviews_count, 0, 1_000_000_000, true)],
  ]);
}

function officialCompany(value: unknown): JsonRecord {
  if (!isRecord(value)) upstreamInvalid();
  const id = officialString(value.id, true, 200)!;
  const name = officialText(value.name, true)!;
  const address = officialString(value.address, true)!;
  const services = Array.isArray(value.services) ? value.services.map(officialService) : null;
  const rubrics = officialStringArray(value.rubrics, 100) ?? null;
  if (!services?.length || !rubrics?.length) throw new HttpError(502, "UPSTREAM_INVALID_RESPONSE");
  let coordinates: JsonRecord | undefined;
  if (value.coordinates !== undefined && value.coordinates !== null) {
    if (!isRecord(value.coordinates)) upstreamInvalid();
    coordinates = {
      lat: officialNumber(value.coordinates.lat, -90, 90)!,
      lon: officialNumber(value.coordinates.lon, -180, 180)!,
    };
    if (coordinates.lat === undefined || coordinates.lon === undefined) upstreamInvalid();
  }
  let photos: string[] | undefined;
  if (value.photos !== undefined && value.photos !== null) {
    if (!Array.isArray(value.photos) || value.photos.length > 100) upstreamInvalid();
    photos = value.photos.map((photo) => officialUrl(photo)!);
  }
  let urls: string[] | undefined;
  if (value.urls !== undefined && value.urls !== null) {
    if (!Array.isArray(value.urls) || value.urls.length > 100) upstreamInvalid();
    urls = value.urls.map((url) => officialUrl(url)!);
  }
  return nonNullEntries([
    ["id", id],
    ["permalink", officialString(value.permalink, false, 200)],
    ["name", name],
    ["address", address],
    ["coordinates", coordinates],
    ["photos", photos],
    ["phones", officialStringArray(value.phones, 100)],
    ["urls", urls],
    ["bookingUrl", officialUrl(value.bookingUrl ?? value.booking_url)],
    ["services", services],
    ["resources", Array.isArray(value.resources) ? value.resources.map(officialResource) : undefined],
    ["rubrics", rubrics],
    ["isPaymentSupported", typeof (value.isPaymentSupported ?? value.is_payment_supported) === "boolean"
      ? value.isPaymentSupported ?? value.is_payment_supported
      : undefined],
  ]);
}

function officialStatus(value: unknown): string {
  const status = typeof value === "string" ? value.toLowerCase() : "";
  const mapping: Record<string, string> = {
    created: "created",
    new: "created",
    pending: "created",
    active: "confirmed",
    confirmed: "confirmed",
    visited: "visited",
    completed: "visited",
    "not visited": "not visited",
    not_visited: "not visited",
    no_show: "not visited",
    cancelled: "cancelled",
    canceled: "cancelled",
  };
  const mapped = mapping[status];
  if (!mapped) throw new HttpError(502, "UPSTREAM_INVALID_RESPONSE");
  return mapped;
}

function officialBooking(value: unknown): JsonRecord {
  if (!isRecord(value)) upstreamInvalid();
  const id = officialString(value.id, true, 200)!;
  const serviceIds = value.serviceIds ?? value.service_ids;
  const datetime = officialString(value.datetime, true, 80)!;
  if (
    !Array.isArray(serviceIds) || !serviceIds.length || serviceIds.length > MAX_SERVICE_IDS ||
    !isIsoDatetime(datetime)
  ) {
    upstreamInvalid();
  }
  const normalizedServiceIds = serviceIds.map((item) => officialString(item, true, 200)!);
  if (new Set(normalizedServiceIds).size !== normalizedServiceIds.length) upstreamInvalid();
  const resourceId = officialString(value.resourceId ?? value.resource_id, false, 200);
  const comment = officialString(value.comment, false, 1_000) ?? "";
  return nonNullEntries([
    ["id", id],
    ["status", officialStatus(value.status)],
    ["serviceIds", normalizedServiceIds],
    ["resourceId", resourceId],
    ["datetime", datetime],
    ["comment", comment],
    ["paidAmount", officialNumber(value.paidAmount ?? value.paid_amount, 0, 1_000_000_000)],
  ]);
}

function assertClaim(claims: JsonRecord, name: string, expected: string): void {
  if (claims[name] !== expected) throw new HttpError(401, "UNAUTHORIZED");
}

function routeCompanyId(route: Route): string | null {
  return "companyId" in route ? route.companyId : null;
}

function rateLimitScope(route: Route, claims: JsonRecord): string {
  if (route.kind === "feed") return "feed";
  if ("companyId" in route) return route.companyId;
  if ("bookingId" in route) return route.bookingId;
  if ("prebookingId" in route) return route.prebookingId;
  if (route.kind === "bookings" || route.kind === "prebookings") {
    return typeof claims.companyId === "string" ? externalId(claims.companyId) : (() => {
      throw new HttpError(401, "UNAUTHORIZED");
    })();
  }
  throw new HttpError(401, "UNAUTHORIZED");
}

async function enforceRateLimit(
  request: Request,
  route: Route,
  claims: JsonRecord,
  config: RuntimeConfig,
  fetcher: typeof fetch,
): Promise<void> {
  const credentialHash = await sha256Hex(config.partnerName);
  const result = await callRpc(fetcher, config, "consume_yandex_booking_rate_limit_v140", {
    p_environment: config.environment,
    p_credential_hash: credentialHash,
    p_scope_key: rateLimitScope(route, claims),
    p_operation: `${request.method.toLowerCase()}:${route.kind}`,
  }, 1_500);
  if (result.ok === true && result.allowed === true) return;
  if (result.allowed === false || result.error === "rate_limited") {
    const seconds = Number(result.retry_after_seconds ?? result.retry_after);
    const retryAfter = Number.isInteger(seconds) && seconds >= 1 && seconds <= 3600 ? seconds : 60;
    throw new HttpError(429, "RATE_LIMITED", { "retry-after": String(retryAfter) });
  }
  throw new HttpError(502, "UPSTREAM_INVALID_RESPONSE");
}

async function bindRequestClaims(
  request: Request,
  route: Route,
  claims: JsonRecord,
): Promise<JsonRecord | null> {
  const companyId = routeCompanyId(route);
  if (companyId) assertClaim(claims, "companyId", companyId);

  if (route.kind === "booking") {
    assertClaim(claims, "bookingId", route.bookingId);
    return null;
  }
  if (route.kind === "prebooking") {
    assertClaim(claims, "prebookingId", route.prebookingId);
    return null;
  }
  if (route.kind === "bookings") {
    const body = await readJsonObject(request);
    const booking = isRecord(body.booking) ? body.booking : null;
    const user = booking && isRecord(booking.user) ? booking.user : null;
    if (!booking || typeof booking.companyId !== "string" || !user || typeof user.phone !== "string") {
      throw new HttpError(422, "INVALID_REQUEST");
    }
    assertClaim(claims, "companyId", booking.companyId);
    assertClaim(claims, "userPhone", user.phone);
    return body;
  }
  if (route.kind === "prebookings") {
    const body = await readJsonObject(request);
    if (typeof body.companyId !== "string") throw new HttpError(422, "INVALID_REQUEST");
    assertClaim(claims, "companyId", body.companyId);
    return body;
  }
  return null;
}

async function dispatch(
  request: Request,
  url: URL,
  route: Route,
  claims: JsonRecord,
  config: RuntimeConfig,
  fetcher: typeof fetch,
  preparedBody: JsonRecord | null,
): Promise<Response> {
  const enforceRouteRateLimit = () => enforceRateLimit(request, route, claims, config, fetcher);

  if (route.kind === "feed") {
    assertQueryKeys(url.searchParams, new Set(["cursor", "count"]));
    const cursor = scalarQuery(url.searchParams, "cursor");
    const countText = scalarQuery(url.searchParams, "count");
    const count = countText === null ? 100 : Number(countText);
    if (!Number.isInteger(count) || count < 1 || count > 500 || (countText !== null && String(count) !== countText)) {
      throw new HttpError(422, "INVALID_REQUEST");
    }
    await enforceRouteRateLimit();
    const result = successResult(await callRpc(fetcher, config, "get_yandex_booking_feed_v140", {
      p_environment: config.environment,
      p_cursor: cursor,
      p_count: count,
    }, 55_000));
    if (!Array.isArray(result.companies) || (result.next_cursor !== null && typeof result.next_cursor !== "string")) {
      throw new HttpError(502, "UPSTREAM_INVALID_RESPONSE");
    }
    return json({
      companies: result.companies.map(officialCompany),
      pagination: { cursor: result.next_cursor ?? "", hasMore: Boolean(result.next_cursor) },
    });
  }

  if (route.kind === "reviews") {
    // Reviews are conditional in the official API. v140 intentionally does not expose
    // client review text, so advertise no reviews in resource payloads and fail closed.
    assertQueryKeys(url.searchParams, new Set());
    return json({ code: "NOT_FOUND" }, 404);
  }

  if (route.kind === "services") {
    assertQueryKeys(url.searchParams, new Set(["resourceId"]));
    const resourceId = scalarQuery(url.searchParams, "resourceId");
    if (resourceId) externalId(resourceId, "RESOURCE_NOT_FOUND");
    await enforceRouteRateLimit();
    const result = successResult(await callRpc(fetcher, config, "get_yandex_booking_services_v140", {
      p_environment: config.environment,
      p_company_id: route.companyId,
      p_resource_id: resourceId,
    }, 4_500));
    if (!Array.isArray(result.services)) throw new HttpError(502, "UPSTREAM_INVALID_RESPONSE");
    return json({ services: result.services.map(officialService) });
  }

  if (route.kind === "resources") {
    assertQueryKeys(url.searchParams, new Set(["serviceIds[]"]));
    const serviceIds = serviceIdsQuery(url.searchParams, false, MAX_RESOURCE_FILTER_SERVICE_IDS);
    await enforceRouteRateLimit();
    const result = successResult(await callRpc(fetcher, config, "get_yandex_booking_resources_v140", {
      p_environment: config.environment,
      p_company_id: route.companyId,
      p_service_ids: serviceIds,
    }, 4_500));
    if (!Array.isArray(result.resources)) throw new HttpError(502, "UPSTREAM_INVALID_RESPONSE");
    return json({ resources: result.resources.map(officialResource) });
  }

  if (route.kind === "available_dates") {
    assertQueryKeys(url.searchParams, new Set(["serviceIds[]", "resourceId", "from", "to"]));
    const serviceIds = serviceIdsQuery(url.searchParams, true, 1, "SERVICE_NOT_FOUND");
    const resourceId = scalarQuery(url.searchParams, "resourceId");
    if (resourceId) externalId(resourceId, "RESOURCE_NOT_FOUND");
    const from = parseDate(scalarQuery(url.searchParams, "from", true, 10)!);
    const to = parseDate(scalarQuery(url.searchParams, "to", true, 10)!);
    if (to.epochDay < from.epochDay || to.epochDay - from.epochDay > MAX_DATE_RANGE_DAYS) {
      throw new HttpError(422, "INVALID_DATE");
    }
    await enforceRouteRateLimit();
    const result = successResult(await callRpc(fetcher, config, "get_yandex_booking_available_dates_v140", {
      p_environment: config.environment,
      p_company_id: route.companyId,
      p_service_ids: serviceIds,
      p_resource_id: resourceId,
      p_from: from.value,
      p_to: to.value,
    }, 4_500));
    if (!Array.isArray(result.dates) || result.dates.length > 1_000 || result.dates.some((date) =>
      typeof date !== "string" || !isCanonicalDate(date)
    )) {
      throw new HttpError(502, "UPSTREAM_INVALID_RESPONSE");
    }
    return json({ availableDates: result.dates.map((date) => ({ date })) });
  }

  if (route.kind === "available_time_slots") {
    assertQueryKeys(url.searchParams, new Set(["serviceIds[]", "resourceId", "date"]));
    const serviceIds = serviceIdsQuery(url.searchParams, true, 1, "SERVICE_NOT_FOUND");
    const resourceId = scalarQuery(url.searchParams, "resourceId");
    if (resourceId) externalId(resourceId, "RESOURCE_NOT_FOUND");
    const date = parseDate(scalarQuery(url.searchParams, "date", true, 10)!).value;
    await enforceRouteRateLimit();
    const result = successResult(await callRpc(fetcher, config, "get_yandex_booking_available_time_slots_v140", {
      p_environment: config.environment,
      p_company_id: route.companyId,
      p_service_ids: serviceIds,
      p_resource_id: resourceId,
      p_date: date,
    }, 4_500));
    if (!Array.isArray(result.slots) || result.slots.length > 10_000 || result.slots.some((slot) =>
      typeof slot !== "string" || !isIsoDatetime(slot)
    )) {
      throw new HttpError(502, "UPSTREAM_INVALID_RESPONSE");
    }
    return json({ availableTimeSlots: result.slots.map((datetime) => ({ datetime })) });
  }

  if (route.kind === "special_conditions") {
    assertQueryKeys(url.searchParams, new Set(["serviceIds[]", "resourceId", "datetime"]));
    const serviceIds = serviceIdsQuery(url.searchParams, true, 1, "SERVICE_NOT_FOUND");
    const resourceId = scalarQuery(url.searchParams, "resourceId");
    if (resourceId) externalId(resourceId, "RESOURCE_NOT_FOUND");
    const datetime = parseDatetime(scalarQuery(url.searchParams, "datetime", true, 80));
    await enforceRouteRateLimit();
    const result = successResult(await callRpc(fetcher, config, "get_yandex_booking_special_conditions_v140", {
      p_environment: config.environment,
      p_company_id: route.companyId,
      p_service_ids: serviceIds,
      p_resource_id: resourceId,
      p_datetime: datetime,
    }, 4_500));
    if (!Array.isArray(result.conditions) || result.conditions.length > 100) {
      throw new HttpError(502, "UPSTREAM_INVALID_RESPONSE");
    }
    return json({ specialConditions: result.conditions.map(officialCondition) });
  }

  if (route.kind === "prebookings" || route.kind === "prebooking") {
    // The beauty specification explicitly permits omitting prebooking support.
    return json({ code: "NOT_FOUND" }, 404);
  }

  if (route.kind === "bookings") {
    const body = preparedBody ?? await readJsonObject(request);
    assertObjectKeys(body, new Set(["booking"]), new Set(["booking"]));
    if (!isRecord(body.booking)) throw new HttpError(422, "INVALID_REQUEST");
    const booking = body.booking;
    assertObjectKeys(
      booking,
      new Set(["companyId", "user", "comment", "additionalFields", "appointment", "prebookingId"]),
      new Set(["companyId", "user", "appointment"]),
    );
    const requestCompanyId = typeof booking.companyId === "string" ? externalId(booking.companyId) : "";
    if (!requestCompanyId) throw new HttpError(422, "COMPANY_NOT_FOUND");
    assertClaim(claims, "companyId", requestCompanyId);
    if (!isRecord(booking.user) || !isRecord(booking.appointment)) throw new HttpError(422, "INVALID_REQUEST");
    assertObjectKeys(booking.user, new Set(["name", "lastName", "phone", "email"]), new Set(["name", "phone"]));
    assertObjectKeys(booking.appointment, new Set(["serviceIds", "resourceId", "datetime"]), new Set(["serviceIds", "datetime"]));
    const firstName = boundedString(booking.user.name, "INVALID_REQUEST", 80, true)!;
    const lastName = boundedString(booking.user.lastName, "INVALID_REQUEST", 80);
    const fullName = `${firstName.trim()}${lastName?.trim() ? ` ${lastName.trim()}` : ""}`;
    if (fullName.length > 80) throw new HttpError(422, "INVALID_REQUEST");
    const phone = boundedString(booking.user.phone, "INVALID_REQUEST", 64, true)!;
    const phoneDigits = phone.replace(/\D/g, "");
    if (phoneDigits.length < 10 || phoneDigits.length > 15) throw new HttpError(422, "INVALID_REQUEST");
    const email = boundedString(booking.user.email, "INVALID_REQUEST", 254);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(422, "INVALID_REQUEST");
    assertClaim(claims, "userPhone", phone);
    const serviceIds = requiredStringArray(booking.appointment.serviceIds, "SERVICE_NOT_FOUND", 1);
    const resourceId = booking.appointment.resourceId === undefined
      ? null
      : typeof booking.appointment.resourceId === "string"
      ? externalId(booking.appointment.resourceId, "RESOURCE_NOT_FOUND")
      : (() => {
        throw new HttpError(422, "RESOURCE_NOT_FOUND");
      })();
    const datetime = parseDatetime(booking.appointment.datetime);
    const comment = boundedString(booking.comment, "INVALID_REQUEST", 1000);
    if (booking.prebookingId !== undefined) throw new HttpError(422, "PREBOOKING_NOT_SUPPORTED");
    if (booking.additionalFields !== undefined && (!isRecord(booking.additionalFields) || Object.keys(booking.additionalFields).length)) {
      throw new HttpError(422, "INVALID_REQUEST");
    }
    const identity = await mutationIdentity(request, config.environment, "create", requestCompanyId, body);
    await enforceRouteRateLimit();
    const result = successResult(await callRpc(fetcher, config, "create_yandex_booking_v140", {
      p_environment: config.environment,
      p_request_key: identity.requestKey,
      p_payload_sha256: identity.payloadSha256,
      p_company_id: requestCompanyId,
      p_service_ids: serviceIds,
      p_resource_id: resourceId,
      p_datetime: datetime,
      p_first_name: firstName,
      p_last_name: lastName,
      p_phone: phone,
      p_email: email,
      p_comment: comment,
      p_prebooking: false,
    }, 4_500));
    return json({ booking: officialBooking(result.booking) });
  }

  assertQueryKeys(url.searchParams, new Set());
  if (request.method === "GET") {
    await enforceRouteRateLimit();
    const result = successResult(await callRpc(fetcher, config, "get_yandex_booking_v140", {
      p_environment: config.environment,
      p_booking_id: route.bookingId,
    }, 4_500));
    return json({ booking: officialBooking(result.booking) });
  }

  if (request.method === "DELETE") {
    const payload = { bookingId: route.bookingId };
    const identity = await mutationIdentity(request, config.environment, "cancel", route.bookingId, payload);
    await enforceRouteRateLimit();
    successResult(await callRpc(fetcher, config, "cancel_yandex_booking_v140", {
      p_environment: config.environment,
      p_request_key: identity.requestKey,
      p_payload_sha256: identity.payloadSha256,
      p_booking_id: route.bookingId,
      p_company_id: null,
    }, 4_500));
    return json({});
  }

  const body = await readJsonObject(request);
  assertObjectKeys(body, new Set(["companyId", "comment", "datetime", "status"]), new Set(["companyId"]));
  const company = typeof body.companyId === "string" ? externalId(body.companyId) : "";
  if (!company) throw new HttpError(422, "COMPANY_NOT_FOUND");
  const hasComment = Object.hasOwn(body, "comment");
  const comment = boundedString(body.comment, "INVALID_REQUEST", 1000);
  const datetime = body.datetime === undefined ? null : parseDatetime(body.datetime);
  const status = body.status === undefined ? null : boundedString(body.status, "INVALID_REQUEST", 40, true);
  if (!hasComment && !datetime && !status) throw new HttpError(422, "INVALID_REQUEST");
  if (status && status !== "cancelled") throw new HttpError(422, "INVALID_REQUEST");
  if (status === "cancelled") {
    const identity = await mutationIdentity(request, config.environment, "cancel", route.bookingId, body);
    await enforceRouteRateLimit();
    const result = successResult(await callRpc(fetcher, config, "cancel_yandex_booking_v140", {
      p_environment: config.environment,
      p_request_key: identity.requestKey,
      p_payload_sha256: identity.payloadSha256,
      p_booking_id: route.bookingId,
      p_company_id: company,
    }, 4_500));
    return json({ booking: officialBooking(result.booking) });
  }
  const identity = await mutationIdentity(request, config.environment, "update", route.bookingId, body);
  await enforceRouteRateLimit();
  const result = successResult(await callRpc(fetcher, config, "update_yandex_booking_v140", {
    p_environment: config.environment,
    p_request_key: identity.requestKey,
    p_payload_sha256: identity.payloadSha256,
    p_booking_id: route.bookingId,
    p_company_id: company,
    p_datetime: datetime,
    p_comment: comment,
  }, 4_500));
  return json({ booking: officialBooking(result.booking) });
}

export function createYandexBookingHandler(dependencies: YandexBookingDependencies = {}) {
  const getEnv = dependencies.env ?? runtimeEnv;
  const fetcher = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? Date.now;
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const route = parseRoute(url);
      assertMethod(request, route);
      requireJsonAccept(request);
      const config = loadConfig(getEnv);
      const claims = await verifyJwt(request, config, now());
      const preparedBody = await bindRequestClaims(request, route, claims);
      return await dispatch(request, url, route, claims, config, fetcher, preparedBody);
    } catch (error) {
      if (error instanceof HttpError) return json({ code: error.code }, error.status, error.headers);
      return json({ code: "INTERNAL_ERROR" }, 500);
    }
  };
}

export const handleYandexBookingRequest = createYandexBookingHandler();
