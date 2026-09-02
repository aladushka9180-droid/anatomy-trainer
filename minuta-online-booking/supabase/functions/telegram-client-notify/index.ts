import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-reminder-secret, x-telegram-bot-api-secret-token",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

const MAX_JSON_BYTES = 32 * 1024;
const REMINDER_SECRET_HASH_TTL = 5 * 60 * 1000;
let cachedReminderSecretHash = "";
let cachedReminderSecretHashExpiresAt = 0;

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type BookingEvent = "confirmation" | "rescheduled" | "cancelled" | "reminder";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
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

async function reminderSecretHash() {
  if (cachedReminderSecretHash && cachedReminderSecretHashExpiresAt > Date.now()) return cachedReminderSecretHash;
  const { data, error } = await admin.rpc("get_telegram_reminder_secret_hash");
  const value = String(data || "");
  if (error || !/^[0-9a-f]{64}$/i.test(value)) return "";
  cachedReminderSecretHash = value.toLowerCase();
  cachedReminderSecretHashExpiresAt = Date.now() + REMINDER_SECRET_HASH_TTL;
  return cachedReminderSecretHash;
}

function html(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function normalizePhone(value: unknown) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("8") && digits.length === 11) digits = "7" + digits.slice(1);
  return digits;
}

function relation(value: unknown) {
  return Array.isArray(value) ? value[0] || {} : value || {};
}

function encodeStartToken(token: string) {
  return "b" + token.replaceAll("-", "");
}

function decodeStartToken(value: string) {
  const compact = value.startsWith("b") ? value.slice(1) : value;
  if (!/^[0-9a-f]{32}$/i.test(compact)) return "";
  return [compact.slice(0, 8), compact.slice(8, 12), compact.slice(12, 16), compact.slice(16, 20), compact.slice(20)].join("-");
}

async function telegramWebhookSecret() {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`minuta-client-webhook:${botToken}`));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function bookingDateText(value: string) {
  const parts = String(value).split("-");
  return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : value;
}

function bookingMessage(booking: any, event: BookingEvent) {
  const service = relation(booking.services) as any;
  const performer = relation(booking.performer_profiles) as any;
  const date = bookingDateText(booking.booking_date);
  const time = String(booking.booking_time).slice(0, 5);
  const title = {
    confirmation: "✅ <b>Запись подтверждена</b>",
    rescheduled: "🔄 <b>Запись перенесена</b>",
    cancelled: "❌ <b>Запись отменена</b>",
    reminder: "⏰ <b>Напоминание о записи</b>",
  }[event];
  const managementUrl = `https://aladushka9180-droid.github.io/anatomy-trainer/minuta-online-booking/booking.html#token=${encodeURIComponent(booking.manage_token)}`;
  const lines = [
    title,
    "",
    `<b>Услуга:</b> ${html(service.name || "Массаж")}`,
    `<b>Дата:</b> ${html(date)}`,
    `<b>Время:</b> ${html(time)}`,
    `<b>Исполнитель:</b> ${html(performer.display_name || "Рамиль")}`,
    `<b>Адрес:</b> Ижевск, ул. Карла Маркса, 304б`,
  ];
  if (event === "reminder") lines.push("", "Ждём вас завтра. Если планы изменились, перенесите или отмените запись заранее.");
  if (event === "cancelled") lines.push("", "Вы можете выбрать другое свободное время на сайте.");
  return { text: lines.join("\n"), managementUrl };
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
  const phone = normalizePhone(booking.client_phone);
  const { data: subscription } = await admin.from("client_telegram_subscriptions")
    .select("id,chat_id")
    .eq("performer_id", booking.performer_id)
    .eq("client_phone", phone)
    .eq("active", true)
    .maybeSingle();
  if (!subscription) return { delivered: false, reason: "not_connected" };

  const { data: duplicate } = await admin.from("telegram_notification_log")
    .select("id")
    .eq("booking_id", booking.id)
    .eq("event_type", event)
    .eq("booking_date", booking.booking_date)
    .eq("booking_time", booking.booking_time)
    .maybeSingle();
  if (duplicate) return { delivered: false, reason: "already_sent" };

  const message = bookingMessage(booking, event);
  try {
    await telegram("sendMessage", {
      chat_id: subscription.chat_id,
      text: message.text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: event === "cancelled" ? "Выбрать другое время" : "Управлять записью", url: message.managementUrl }]],
      },
    });
  } catch (error) {
    if ((error as any).telegram?.error_code === 403) {
      await admin.from("client_telegram_subscriptions").update({ active: false, updated_at: new Date().toISOString() }).eq("id", subscription.id);
    }
    throw error;
  }

  await admin.from("telegram_notification_log").insert({
    booking_id: booking.id,
    event_type: event,
    booking_date: booking.booking_date,
    booking_time: booking.booking_time,
  });
  return { delivered: true };
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
  await admin.from("client_telegram_subscriptions").upsert({
    performer_id: booking.performer_id,
    client_phone: phone,
    chat_id: message.chat.id,
    telegram_user_id: message.from?.id || null,
    telegram_username: message.from?.username || null,
    active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: "performer_id,client_phone" });

  const event: BookingEvent = booking.status === "cancelled" ? "cancelled" : "confirmation";
  const result = await sendBookingEvent(booking, event);
  if (!result.delivered && result.reason === "already_sent") {
    await telegram("sendMessage", { chat_id: message.chat.id, text: "✅ Уведомления уже подключены. Следующее напоминание придёт сюда автоматически." });
  }
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
  const expectedHash = await reminderSecretHash();
  const actualHash = await sha256Hex(req.headers.get("x-reminder-secret") || "");
  if (!sameHash(actualHash, expectedHash)) return json({ ok: false }, 401);
  const now = Date.now();
  const local = new Date(now + 4 * 60 * 60 * 1000);
  const today = local.toISOString().slice(0, 10);
  const afterTomorrow = new Date(local.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: bookings, error } = await admin.rpc("get_telegram_reminder_candidates", {
    p_from: today,
    p_to: afterTomorrow,
  });
  if (error) return json({ ok: false, error: "booking_query_failed" }, 500);

  let delivered = 0;
  for (const item of bookings || []) {
    const booking = normalizeBookingContext(item);
    const start = new Date(`${booking.booking_date}T${String(booking.booking_time).slice(0, 8)}+04:00`).getTime();
    const hours = (start - now) / 3600000;
    if (hours < 23 || hours > 25) continue;
    try {
      const result = await sendBookingEvent(booking, "reminder");
      if (result.delivered) delivered += 1;
    } catch (error) {
      console.error("Reminder delivery failed", booking.id, error);
    }
  }
  return json({ ok: true, delivered });
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (!supabaseUrl || !serviceRoleKey || !botToken) return json({ ok: false, error: "not_configured" }, 503);
    const path = new URL(req.url).pathname.replace(/\/+$/, "");
    try {
      if (req.method === "GET" && path.endsWith("/connect")) return await connectRedirect(req);
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
