import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const html = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const providerUrl = "https://aladushka9180-droid.github.io/anatomy-trainer/minuta-online-booking/provider.html";
const MAX_JSON_BYTES = 32 * 1024;

async function sameSecret(actual: string, expected: string) {
  if (!actual || !expected) return false;
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(actualHash);
  const right = new Uint8Array(expectedHash);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) difference |= (left[index] || 0) ^ (right[index] || 0);
  return difference === 0;
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok");
    if (req.method !== "POST") return Response.json({ ok:false, error:"Method not allowed" }, { status:405 });
    const expectedSecret = Deno.env.get("BOOKING_WEBHOOK_SECRET") || "";
    if (!await sameSecret(req.headers.get("x-booking-secret") || "", expectedSecret)) return Response.json({ ok:false, error:"Unauthorized" }, { status:401 });
    if (!(req.headers.get("content-type") || "").toLowerCase().includes("application/json")) return Response.json({ ok:false, error:"Unsupported media type" }, { status:415 });
    const declaredLength = Number(req.headers.get("content-length") || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) return Response.json({ ok:false, error:"Payload too large" }, { status:413 });
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
    const chatId = Deno.env.get("TELEGRAM_CHAT_ID") || "";
    if (!token || !chatId) return Response.json({ ok:false, error:"Telegram is not configured" }, { status:500 });
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.byteLength > MAX_JSON_BYTES) return Response.json({ ok:false, error:"Payload too large" }, { status:413 });
    let payload: any;
    try { payload = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { return Response.json({ ok:false, error:"Invalid JSON" }, { status:400 }); }
    const record = payload.record || payload;
    let text: string;
    if (payload.table === "booking_page_visits") {
      if (!record.id || !record.created_at) return Response.json({ ok:false, error:"Invalid visitor payload" }, { status:400 });
      text = "🟠 <b>Новый посетитель сайта</b>\n\nКто-то сейчас смотрит услуги и свободное время на странице онлайн-записи.\nИмя, телефон и данные устройства не собираются.";
    } else {
      if (!record.client_name || !record.booking_date || !record.booking_time) return Response.json({ ok:false, error:"Invalid booking payload" }, { status:400 });
      const dateParts = String(record.booking_date).split("-");
      const dateText = dateParts.length === 3 ? [dateParts[2], dateParts[1], dateParts[0]].join(".") : String(record.booking_date);
      text = "🟢 <b>Новая запись</b>\n\n<b>Клиент:</b> " + html(record.client_name) + "\n<b>Телефон:</b> " + html(record.client_phone) + "\n<b>Дата:</b> " + html(dateText) + "\n<b>Время:</b> " + html(String(record.booking_time).slice(0, 5)) + "\n<b>Код записи:</b> " + html(record.booking_code);
    }
    const response = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", { method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify({ chat_id:chatId, text, parse_mode:"HTML", disable_web_page_preview:true, reply_markup:{ inline_keyboard:[[{ text:"Открыть кабинет", url:providerUrl }]] } }) });
    const result = await response.json();
    if (!response.ok || !result.ok) return Response.json({ ok:false, error:"Telegram delivery failed" }, { status:502 });
    return Response.json({ ok:true });
});
