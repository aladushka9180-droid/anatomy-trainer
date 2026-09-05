import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-reminder-secret, x-telegram-bot-api-secret-token",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

const MAX_JSON_BYTES = 32 * 1024;
const TELEGRAM_AUTH_MAX_AGE_SECONDS = 15 * 60;

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type BookingEvent = "confirmation" | "rescheduled" | "cancelled" | "reminder";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { ...corsHeaders, "cache-control": "no-store" } });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Buffer(value: string) {
  return await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
}

async function hmacSha256Hex(key: ArrayBuffer, value: string) {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function sameHash(actual: string, expected: string) {
  if (!actual || !expected || actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

async function sameSecret(actual: string, expected: string) {
  if (!actual || !expected) return false;
  return sameHash(await sha256Hex(actual), await sha256Hex(expected));
}

async function readJson(req: Request) {
  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) throw new Error("unsupported_media_type");
  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) throw new Error("payload_too_large");
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_JSON_BYTES) throw new Error("payload_too_large");
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("invalid_json");
  }
}

function normalizePhone(value: unknown) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("8") && digits.length === 11) digits = "7" + digits.slice(1);
  return digits;
}

function encodeStartToken(token: string) {
  return "b" + token.replaceAll("-", "");
}

function decodeStartToken(value: string) {
  const compact = value.startsWith("b") ? value.slice(1) : value;
  if (!/^[0-9a-f]{32}$/i.test(compact)) return "";
  return [compact.slice(0, 8), compact.slice(8, 12), compact.slice(12, 16), compact.slice(16, 20), compact.slice(20)].join("-");
}

function telegramAuthData(auth: unknown) {
  if (!auth || typeof auth !== "object" || Array.isArray(auth)) return null;
  const input = auth as Record<string, unknown>;
  const hash = String(input.hash || "").toLowerCase();
  const id = String(input.id || "");
  const authDate = Number(input.auth_date);
  if (!/^[0-9a-f]{64}$/.test(hash) || !/^\d{1,20}$/.test(id) || !Number.isSafeInteger(authDate)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (authDate > now + 60 || now - authDate > TELEGRAM_AUTH_MAX_AGE_SECONDS) return null;

  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(input)) {
    if (key === "hash") continue;
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || !["string", "number", "boolean"].includes(typeof value)) return null;
    entries.push([key, String(value)]);
  }
  entries.sort(([left], [right]) => left.localeCompare(right));
  return {
    hash,
    id,
    username: typeof input.username === "string" ? input.username.slice(0, 64) : null,
    dataCheckString: entries.map(([key, value]) => `${key}=${value}`).join("\n"),
  };
}

async function verifyTelegramAuth(auth: unknown) {
  const parsed = telegramAuthData(auth);
  if (!parsed) return null;
  const expected = await hmacSha256Hex(await sha256Buffer(botToken), parsed.dataCheckString);
  return sameHash(parsed.hash, expected) ? parsed : null;
}

async function telegramWebhookSecret() {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`minuta-client-webhook:${botToken}`));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function telegram(method: string, payload: Record<string, unknown>) {
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    const error = new Error(result.description || "Telegram request failed");
    (error as any).telegram = result;
    throw error;
  }
  return result.result;
}

async function bookingByToken(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const { data, error } = await admin.rpc("get_booking_telegram_context", {
    p_token: token,
    p_booking: null,
  })
    .maybeSingle();
  if (error) {
    console.error("Booking lookup by token failed", error);
    return null;
  }
  return data ? normalizeBookingContext(data) : null;
}

async function bookingById(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await admin.rpc("get_booking_telegram_context", {
    p_token: null,
    p_booking: id,
  })
    .maybeSingle();
  if (error) {
    console.error("Booking lookup by id failed", error);
    return null;
  }
  return data ? normalizeBookingContext(data) : null;
}

function normalizeBookingContext(booking: any) {
  return {
    ...booking,
    services: { name: booking.service_name, price_rub: booking.price_rub },
    performer_profiles: { display_name: booking.performer_name },
  };
}

async function sendBookingEvent(booking: any, event: BookingEvent) {
  // v88/v114 booking triggers own event creation. This endpoint reports the
  // durable queue state and must never perform a second direct delivery.
  const { data, error } = await admin.rpc("get_minuta_client_notification_state_v114", {
    p_booking: booking.id,
  });
  if (error) {
    console.error("Notification state lookup failed", event, error.code || error.message);
    return { delivered:false, sent:false, queued:false, connected:false, reason:"notification_state_unavailable" };
  }
  const state = String(data?.state || "connected");
  return {
    delivered: state === "delivered",
    sent: state === "sent" || state === "delivered",
    queued: state === "queued" || state === "sending",
    connected: data?.connected === true,
    reason: state,
  };
}

async function telegramAuthConfig(req: Request) {
  const token = new URL(req.url).searchParams.get("token") || "";
  const booking = await bookingByToken(token);
  if (!booking) return json({ ok: false, error: "booking_not_found" }, 404);
  const bot = await telegram("getMe", {});
  if (!bot?.id || !bot?.username) return json({ ok: false, error: "bot_not_configured" }, 503);
  const phone = normalizePhone(booking.client_phone);
  const { data: subscription } = await admin.from("client_telegram_subscriptions")
    .select("id")
    .eq("performer_id", booking.performer_id)
    .eq("client_phone", phone)
    .eq("active", true)
    .maybeSingle();
  return json({
    ok: true,
    bot_id: String(bot.id),
    bot_username: String(bot.username),
    connected: Boolean(subscription),
  });
}

async function authorizeTelegram(req: Request) {
  const body = await readJson(req);
  const token = String(body.manage_token || "");
  const booking = await bookingByToken(token);
  if (!booking) return json({ ok: false, error: "booking_not_found" }, 404);
  const auth = await verifyTelegramAuth(body.telegram_auth);
  if (!auth) return json({ ok: false, error: "invalid_telegram_auth" }, 401);

  // Telegram Login proves identity, but not that the bot may write to the chat.
  // Confirm access before persisting an active endpoint.
  try {
    await telegram("sendMessage", {
      chat_id: auth.id,
      text: "Проверка доступа к уведомлениям Minuta.",
    });
  } catch (error) {
    if ((error as any).telegram?.error_code === 403) {
      return json({ ok:false, connected:false, error:"telegram_write_access_required" }, 403);
    }
    return json({ ok:false, connected:false, error:"telegram_access_check_failed" }, 502);
  }

  const phone = normalizePhone(booking.client_phone);
  const { error } = await admin.from("client_telegram_subscriptions").upsert({
    performer_id: booking.performer_id,
    client_phone: phone,
    chat_id: auth.id,
    telegram_user_id: auth.id,
    telegram_username: auth.username,
    active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: "performer_id,client_phone" });
  if (error) {
    console.error("Telegram web authorization save failed", error);
    return json({ ok: false, error: "subscription_save_failed" }, 500);
  }

  const event: BookingEvent = booking.status === "cancelled" ? "cancelled" : "confirmation";
  const delivery = await sendBookingEvent(booking, event);
  return json({ ok:true, ...delivery, connected:true, connection_status:"sent" });
}

async function connectRedirect(req: Request) {
  const token = new URL(req.url).searchParams.get("token") || "";
  const booking = await bookingByToken(token);
  if (!booking) return new Response("Запись не найдена", { status: 404, headers: corsHeaders });
  const bot = await telegram("getMe", {});
  if (!bot?.username) return new Response("Бот не настроен", { status: 503, headers: corsHeaders });
  await telegram("setWebhook", {
    url: `${supabaseUrl}/functions/v1/telegram-client-notify`,
    secret_token: await telegramWebhookSecret(),
    allowed_updates: ["message"],
  });
  const target = `https://t.me/${bot.username}?start=${encodeURIComponent(encodeStartToken(token))}`;
  return Response.redirect(target, 302);
}

async function telegramWebhook(req: Request) {
  const expectedSecret = await telegramWebhookSecret();
  if (!await sameSecret(req.headers.get("x-telegram-bot-api-secret-token") || "", expectedSecret)) return json({ ok: false }, 401);
  const update = await readJson(req);
  const message = update.message;
  const text = String(message?.text || "");
  const match = text.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]+)$/);
  if (!message?.chat?.id || !match) return json({ ok: true });
  const token = decodeStartToken(match[1]);
  const booking = await bookingByToken(token);
  if (!booking) {
    await telegram("sendMessage", { chat_id: message.chat.id, text: "Не удалось найти запись. Вернитесь на сайт и откройте Telegram по новой ссылке." });
    return json({ ok: true });
  }

  const phone = normalizePhone(booking.client_phone);
  const { error: subscriptionError } = await admin.from("client_telegram_subscriptions").upsert({
    performer_id: booking.performer_id,
    client_phone: phone,
    chat_id: message.chat.id,
    telegram_user_id: message.from?.id || null,
    telegram_username: message.from?.username || null,
    active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: "performer_id,client_phone" });
  if (subscriptionError) {
    console.error("Telegram webhook subscription save failed", subscriptionError.code || subscriptionError.message);
    await telegram("sendMessage", { chat_id:message.chat.id, text:"Не удалось сохранить подключение. Вернитесь на сайт и повторите позже." });
    return json({ ok:false, error:"subscription_save_failed" }, 500);
  }

  const event: BookingEvent = booking.status === "cancelled" ? "cancelled" : "confirmation";
  const result = await sendBookingEvent(booking, event);
  const connectionText = result.reason === "connected_disabled"
    ? "✅ Telegram подключён. Автоматические сообщения пока выключены мастером."
    : result.queued
      ? "✅ Telegram подключён. Статус сообщения: в очереди."
      : result.sent
        ? "✅ Telegram подключён. Последнее сообщение отправлено."
        : "✅ Telegram подключён. Статус автоматических сообщений можно уточнить у мастера.";
  await telegram("sendMessage", { chat_id:message.chat.id, text:connectionText });
  return json({ ok: true });
}

async function eventRequest(req: Request) {
  const body = await readJson(req);
  const event = String(body.event || "") as BookingEvent;
  if (!["confirmation", "rescheduled", "cancelled"].includes(event)) return json({ ok: false, error: "invalid_event" }, 400);

  let booking = body.manage_token ? await bookingByToken(String(body.manage_token)) : null;
  if (!booking && body.booking_id) {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data } = await admin.auth.getUser(jwt);
    if (!data.user) return json({ ok: false }, 401);
    booking = await bookingById(String(body.booking_id));
    if (!booking || booking.performer_id !== data.user.id) return json({ ok: false }, 403);
  }
  if (!booking) return json({ ok: false, error: "booking_not_found" }, 404);
  try {
    return json({ ok: true, ...(await sendBookingEvent(booking, event)) });
  } catch (error) {
    console.error("Client Telegram delivery failed", error);
    return json({ ok: false, error: "delivery_failed" }, 502);
  }
}

async function remindersRequest(req: Request) {
  void req;
  return json({ ok:false, error:"retired_use_notification_dispatcher" }, 410);
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (!supabaseUrl || !serviceRoleKey || !botToken) return json({ ok: false, error: "not_configured" }, 503);
    const path = new URL(req.url).pathname.replace(/\/+$/, "");
    try {
      if (req.method === "GET" && path.endsWith("/connect")) return await connectRedirect(req);
      if (req.method === "GET" && path.endsWith("/auth-config")) return await telegramAuthConfig(req);
      if (req.method === "POST" && path.endsWith("/authorize")) return await authorizeTelegram(req);
      if (req.method === "POST" && path.endsWith("/event")) return await eventRequest(req);
      if (req.method === "POST" && path.endsWith("/reminders")) return await remindersRequest(req);
      if (req.method === "POST") return await telegramWebhook(req);
      return json({ ok: false, error: "not_found" }, 404);
    } catch (error) {
      console.error("Telegram client notification error", error);
      if ((error as Error).message === "payload_too_large") return json({ ok: false, error: "payload_too_large" }, 413);
      if ((error as Error).message === "unsupported_media_type") return json({ ok: false, error: "unsupported_media_type" }, 415);
      if ((error as Error).message === "invalid_json") return json({ ok: false, error: "invalid_json" }, 400);
      return json({ ok: false, error: "internal_error" }, 500);
    }
});
