import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const html = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const providerUrl =
  "https://aladushka9180-droid.github.io/anatomy-trainer/minuta-online-booking/provider.html";

export default {
  async fetch(req: Request) {
    if (req.method !== "POST") {
      return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
    }

    const expectedSecret = Deno.env.get("BOOKING_WEBHOOK_SECRET") || "";
    if (!expectedSecret || req.headers.get("x-booking-secret") !== expectedSecret) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const token = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
    const chatId = Deno.env.get("TELEGRAM_CHAT_ID") || "";
    if (!token || !chatId) {
      return Response.json({ ok: false, error: "Telegram is not configured" }, { status: 500 });
    }

    const payload = await req.json();
    const record = payload.record || payload;
    const isVisitor = payload.table === "booking_page_visits";
    let text: string;

    if (isVisitor) {
      if (!record.id || !record.created_at) {
        return Response.json({ ok: false, error: "Invalid visitor payload" }, { status: 400 });
      }
      text =
        "🟠 <b>Новый посетитель сайта</b>\n\n" +
        "Кто-то сейчас смотрит услуги и свободное время на странице онлайн-записи.\n" +
        "Имя, телефон и данные устройства не собираются.";
    } else {
      if (!record.client_name || !record.booking_date || !record.booking_time) {
        return Response.json({ ok: false, error: "Invalid booking payload" }, { status: 400 });
      }

      let serviceName = "Услуга";
      let servicePrice = null;
      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";

      if (supabaseUrl && anonKey && record.service_id) {
        const serviceUrl =
          supabaseUrl +
          "/rest/v1/services?id=eq." +
          encodeURIComponent(record.service_id) +
          "&select=name,price_rub&limit=1";
        const serviceResponse = await fetch(serviceUrl, {
          headers: { apikey: anonKey, Authorization: "Bearer " + anonKey },
        });
        if (serviceResponse.ok) {
          const services = await serviceResponse.json();
          const service = services[0];
          if (service?.name) serviceName = service.name;
          if (service && Number.isFinite(Number(service.price_rub))) {
            servicePrice = Number(service.price_rub);
          }
        }
      }

      const dateParts = String(record.booking_date).split("-");
      const dateText =
        dateParts.length === 3
          ? [dateParts[2], dateParts[1], dateParts[0]].join(".")
          : String(record.booking_date);
      const timeText = String(record.booking_time).slice(0, 5);
      const priceText =
        servicePrice === null
          ? ""
          : "\n<b>Стоимость:</b> " +
            new Intl.NumberFormat("ru-RU").format(servicePrice) +
            " ₽";

      text =
        "🟢 <b>Новая запись</b>\n\n" +
        "<b>Клиент:</b> " + html(record.client_name) + "\n" +
        "<b>Телефон:</b> " + html(record.client_phone) + "\n" +
        "<b>Услуга:</b> " + html(serviceName) + priceText + "\n" +
        "<b>Дата:</b> " + html(dateText) + "\n" +
        "<b>Время:</b> " + html(timeText) + "\n" +
        "<b>Код записи:</b> " + html(record.booking_code);
    }

    const telegramResponse = await fetch(
      "https://api.telegram.org/bot" + token + "/sendMessage",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [[{ text: "Открыть кабинет", url: providerUrl }]],
          },
        }),
      },
    );

    const telegramResult = await telegramResponse.json();
    if (!telegramResponse.ok || !telegramResult.ok) {
      console.error("Telegram delivery failed", telegramResult);
      return Response.json({ ok: false, error: "Telegram delivery failed" }, { status: 502 });
    }

    return Response.json({ ok: true });
  },
};
