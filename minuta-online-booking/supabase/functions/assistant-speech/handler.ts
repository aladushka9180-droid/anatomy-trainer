export const ASSISTANT_SPEECH_VOICES = Object.freeze({
  dmitry: "ru-RU-DmitryNeural",
  svetlana: "ru-RU-SvetlanaNeural",
} as const);

const DEFAULT_ORIGINS = ["https://aladushka9180-droid.github.io"];
const MAX_BODY_BYTES = 4 * 1024;
const MAX_TEXT_CHARACTERS = 1200;
const MAX_TEXT_BYTES = 2400;
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const CACHE_TEXT_CHARACTERS = 240;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_ENTRIES = 48;
const REQUESTS_PER_MINUTE = 10;

type VoiceId = keyof typeof ASSISTANT_SPEECH_VOICES;
type AuthenticatedUser = { id: string };
type CachedAudio = { bytes: Uint8Array; expiresAt: number };

export type SpeechHandlerDependencies = {
  authenticate: (request: Request) => Promise<AuthenticatedUser | null>;
  synthesize: (input: { text: string; voiceName: string; signal: AbortSignal }) => Promise<Response>;
  configured?: boolean;
  allowedOrigins?: string[];
  timeoutMs?: number;
  now?: () => number;
};

function compactText(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsHiddenIdentifier(text: string): boolean {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)
    || /(?:\+?7|8)[\s()\-]*\d{3}[\s()\-]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/.test(text)
    || /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(text);
}

function jsonHeaders(origin: string) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, apikey, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-expose-headers": "content-type, content-length",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "vary": "Origin",
    "x-content-type-options": "nosniff",
  };
}

function json(origin: string, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders(origin) });
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function readRequest(request: Request): Promise<{ text: string; voice: VoiceId } | null> {
  if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) return null;
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return null;
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const body = parsed as Record<string, unknown>;
  if (Object.keys(body).some(key => key !== "text" && key !== "voice")) return null;
  const text = compactText(body.text);
  const voice = String(body.voice || "") as VoiceId;
  if (!text || Array.from(text).length > MAX_TEXT_CHARACTERS || new TextEncoder().encode(text).byteLength > MAX_TEXT_BYTES) return null;
  if (!(voice in ASSISTANT_SPEECH_VOICES) || containsHiddenIdentifier(text)) return null;
  return { text, voice };
}

export function escapeSpeechXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function assistantSpeechSsml(text: string, voiceName: string): string {
  if (!Object.values(ASSISTANT_SPEECH_VOICES).includes(voiceName as typeof ASSISTANT_SPEECH_VOICES[VoiceId])) throw new Error("unsupported_voice");
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ru-RU"><voice name="${voiceName}">${escapeSpeechXml(text)}</voice></speak>`;
}

export function createSpeechHandler(dependencies: SpeechHandlerDependencies) {
  const allowedOrigins = new Set([...DEFAULT_ORIGINS, ...(dependencies.allowedOrigins || [])]);
  const fallbackOrigin = DEFAULT_ORIGINS[0];
  const now = dependencies.now || Date.now;
  const timeoutMs = Math.max(50, Math.min(dependencies.timeoutMs ?? 8000, 15000));
  const recentRequests = new Map<string, number[]>();
  const cache = new Map<string, CachedAudio>();

  function responseOrigin(request: Request): string {
    const origin = request.headers.get("origin") || "";
    return allowedOrigins.has(origin) ? origin : fallbackOrigin;
  }

  function requestAllowed(userId: string): boolean {
    const timestamp = now();
    const recent = (recentRequests.get(userId) || []).filter(item => timestamp - item < 60_000);
    if (recent.length >= REQUESTS_PER_MINUTE) {
      recentRequests.set(userId, recent);
      return false;
    }
    recent.push(timestamp);
    recentRequests.set(userId, recent);
    if (recentRequests.size > 1000) {
      for (const [key, values] of recentRequests) if (!values.some(item => timestamp - item < 60_000)) recentRequests.delete(key);
    }
    return true;
  }

  function pruneCache(): void {
    const timestamp = now();
    for (const [key, item] of cache) if (item.expiresAt <= timestamp) cache.delete(key);
    while (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
  }

  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin") || "";
    const allowedOrigin = responseOrigin(request);
    if (origin && !allowedOrigins.has(origin)) return json(allowedOrigin, { ok:false, error:"origin_not_allowed" }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status:204, headers:jsonHeaders(allowedOrigin) });
    if (request.method !== "POST") return json(allowedOrigin, { ok:false, error:"method_not_allowed" }, 405);

    let user: AuthenticatedUser | null = null;
    try { user = await dependencies.authenticate(request); }
    catch { user = null; }
    if (!user?.id) return json(allowedOrigin, { ok:false, error:"auth_required" }, 401);
    if (dependencies.configured === false) return json(allowedOrigin, { ok:false, error:"not_configured" }, 503);

    const body = await readRequest(request);
    if (!body) return json(allowedOrigin, { ok:false, error:"invalid_request" }, 400);
    if (!requestAllowed(user.id)) return json(allowedOrigin, { ok:false, error:"rate_limited" }, 429);
    const cacheable = Array.from(body.text).length <= CACHE_TEXT_CHARACTERS;
    const cacheKey = cacheable ? await sha256(`${user.id}\n${body.voice}\n${body.text}`) : "";
    pruneCache();
    const cached = cacheKey ? cache.get(cacheKey) : null;
    if (cached && cached.expiresAt > now()) {
      return new Response(cached.bytes.slice(), { status:200, headers:{
        "access-control-allow-origin":allowedOrigin, "cache-control":"no-store", "content-type":"audio/mpeg",
        "vary":"Origin", "x-content-type-options":"nosniff", "x-speech-cache":"hit",
      } });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), timeoutMs);
    let upstream: Response;
    try {
      upstream = await dependencies.synthesize({
        text:body.text,
        voiceName:ASSISTANT_SPEECH_VOICES[body.voice],
        signal:controller.signal,
      });
    } catch (error) {
      const timeout = controller.signal.aborted || (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name));
      return json(allowedOrigin, { ok:false, error:timeout ? "upstream_timeout" : "upstream_unavailable" }, timeout ? 504 : 503);
    } finally {
      clearTimeout(timeoutId);
    }
    if (!upstream.ok) {
      const notConfigured = upstream.status === 503 && upstream.headers.get("x-speech-configuration") === "missing";
      return json(allowedOrigin, { ok:false, error:notConfigured ? "not_configured" : "upstream_rejected" }, notConfigured ? 503 : upstream.status === 429 ? 429 : 502);
    }
    const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
    const audio = new Uint8Array(await upstream.arrayBuffer());
    if (!contentType.startsWith("audio/") || !audio.byteLength || audio.byteLength > MAX_AUDIO_BYTES) {
      return json(allowedOrigin, { ok:false, error:"invalid_upstream_response" }, 502);
    }
    if (cacheKey) {
      cache.set(cacheKey, { bytes:audio.slice(), expiresAt:now() + CACHE_TTL_MS });
      pruneCache();
    }
    return new Response(audio, { status:200, headers:{
      "access-control-allow-origin":allowedOrigin, "cache-control":"no-store", "content-type":"audio/mpeg",
      "vary":"Origin", "x-content-type-options":"nosniff", "x-speech-cache":"miss",
    } });
  };
}
