export const notificationChannels = ["telegram", "email", "sms", "max", "push"] as const;
export type NotificationChannel = typeof notificationChannels[number];

export type NotificationJob = {
  outbox_id: string;
  lock_token: string;
  event_key: string;
  organization_id: string;
  performer_id: string;
  booking_id: string;
  kind: "booking_created" | "booking_confirmed" | "booking_rescheduled" | "booking_cancelled" | "booking_reminder";
  channel: NotificationChannel;
  audience: "provider" | "client";
  attempt_no: number;
  destination: Record<string, unknown> | null;
  message_payload: Record<string, unknown>;
};

export type DeliveryResult = {
  ok: boolean;
  providerMessageId?: string;
  deliveryState?: "sent" | "delivered";
  deliveredAt?: string;
  receiptSource?: string;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
  retryAfterSeconds?: number;
};

type GatewayConfiguration = { url: string; token: string; sender?: string };
export type AdapterConfiguration = {
  telegram?: { token: string; fallbackChatId?: string; fallbackPerformerId?: string };
  email?: GatewayConfiguration;
  sms?: GatewayConfiguration;
  max?: GatewayConfiguration;
  push?: GatewayConfiguration;
};

function env(name: string): string {
  return Deno.env.get(name)?.trim() || "";
}

function gateway(prefix: string): GatewayConfiguration | undefined {
  const url = env(`${prefix}_PROVIDER_URL`);
  const token = env(`${prefix}_PROVIDER_TOKEN`);
  if (!url || !token) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return undefined;
  } catch {
    return undefined;
  }
  return { url, token, sender: env(`${prefix}_SENDER`) || undefined };
}

export function loadAdapterConfiguration(): AdapterConfiguration {
  const telegramToken = env("TELEGRAM_BOT_TOKEN");
  return {
    telegram: telegramToken ? {
      token: telegramToken,
      fallbackChatId: env("TELEGRAM_CHAT_ID") || undefined,
      fallbackPerformerId: env("TELEGRAM_PERFORMER_ID") || undefined,
    } : undefined,
    email: gateway("EMAIL"),
    sms: gateway("SMS"),
    max: gateway("MAX"),
    push: gateway("PUSH"),
  };
}

export function configuredChannels(configuration: AdapterConfiguration): NotificationChannel[] {
  return notificationChannels.filter(channel => Boolean(configuration[channel]));
}

function escapeTelegramHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>]/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
  })[character] || character);
}

function dateText(value: unknown): string {
  const source = String(value || "");
  const parts = source.split("-");
  return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : source;
}

function eventTitle(job: NotificationJob): string {
  if (job.audience === "provider" && job.kind === "booking_created") return "Новая запись";
  return ({
    booking_created: "Запись создана",
    booking_confirmed: "Запись подтверждена",
    booking_rescheduled: "Запись перенесена",
    booking_cancelled: "Запись отменена",
    booking_reminder: "Напоминание о записи",
  } as const)[job.kind];
}

function plainMessage(job: NotificationJob): { subject: string; text: string } {
  const payload = job.message_payload || {};
  const subject = eventTitle(job);
  const lines = [subject, ""];
  if (job.audience === "provider") {
    lines.push(`Клиент: ${String(payload.client_name || "Клиент")}`);
    if (payload.client_phone) lines.push(`Телефон: ${String(payload.client_phone)}`);
  }
  lines.push(`Услуга: ${String(payload.service_name || "Услуга")}`);
  lines.push(`Дата: ${dateText(payload.booking_date)}`);
  lines.push(`Время: ${String(payload.booking_time || "").slice(0, 5)}`);
  lines.push(`Исполнитель: ${String(payload.performer_name || "Специалист")}`);
  if (payload.booking_code) lines.push(`Код: ${String(payload.booking_code)}`);
  return { subject, text: lines.join("\n") };
}

function telegramMessage(job: NotificationJob): string {
  const message = plainMessage(job);
  const [title, ...lines] = message.text.split("\n");
  return [`<b>${escapeTelegramHtml(title)}</b>`, ...lines.map(escapeTelegramHtml)].join("\n");
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function retryAfter(response: Response): number | undefined {
  const parsed = Number(response.headers.get("retry-after") || "");
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(Math.round(parsed), 86400) : undefined;
}

function destinationString(destination: Record<string, unknown> | null, key: string): string {
  return String(destination?.[key] ?? "").trim();
}

async function telegram(job: NotificationJob, configuration: NonNullable<AdapterConfiguration["telegram"]>): Promise<DeliveryResult> {
  let chatId = destinationString(job.destination, "chat_id");
  if (!chatId && job.audience === "provider"
      && configuration.fallbackPerformerId === job.performer_id) {
    chatId = configuration.fallbackChatId || "";
  }
  if (!chatId) return {
    ok: false, errorCode: "recipient_not_configured",
    errorMessage: "Получатель Telegram не подключён", retryable: false,
  };
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${configuration.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: telegramMessage(job),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch {
    return { ok: false, errorCode: "telegram_network_error", errorMessage: "Сетевая ошибка Telegram", retryable: true };
  }
  let body: Record<string, unknown> = {};
  try { body = await response.json(); } catch { /* status is enough */ }
  if (!response.ok || body.ok !== true) return {
    ok: false,
    errorCode: `telegram_${Number(body.error_code || response.status)}`,
    errorMessage: `Telegram отклонил отправку (${response.status})`,
    retryable: retryableStatus(Number(body.error_code || response.status)),
    retryAfterSeconds: Number((body.parameters as Record<string, unknown> | undefined)?.retry_after || retryAfter(response)) || undefined,
  };
  const result = body.result as Record<string, unknown> | undefined;
  // Telegram Bot API confirms that sendMessage was accepted, not that the
  // recipient opened or even received it. Keep the state explicitly "sent".
  return {
    ok: true,
    deliveryState: "sent",
    providerMessageId: result?.message_id == null ? undefined : String(result.message_id),
  };
}

function confirmedDelivery(body: Record<string, unknown>): { deliveredAt: string; receiptSource: string } | null {
  const state = String(body.delivery_status ?? body.status ?? "").trim().toLowerCase();
  if (state !== "delivered") return null;
  const source = String(body.receipt_source ?? body.provider ?? "provider_response").trim().slice(0, 120);
  const candidate = String(body.delivered_at ?? "").trim();
  const instant = candidate ? new Date(candidate) : null;
  if (!instant || Number.isNaN(instant.getTime()) || !source) return null;
  return { deliveredAt: instant.toISOString(), receiptSource: source };
}

async function gatewayDelivery(job: NotificationJob, configuration: GatewayConfiguration): Promise<DeliveryResult> {
  if (!job.destination || Object.keys(job.destination).length === 0) return {
    ok: false, errorCode: "recipient_not_configured",
    errorMessage: "Получатель канала не подключён", retryable: false,
  };
  const message = plainMessage(job);
  let response: Response;
  try {
    response = await fetch(configuration.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${configuration.token}`,
        "content-type": "application/json",
        "idempotency-key": job.event_key,
      },
      body: JSON.stringify({
        idempotency_key: job.event_key,
        channel: job.channel,
        audience: job.audience,
        recipient: job.destination,
        sender: configuration.sender,
        subject: message.subject,
        text: message.text,
        event: job.kind,
        metadata: {
          organization_id: job.organization_id,
          booking_id: job.booking_id,
        },
      }),
    });
  } catch {
    return {
      ok: false, errorCode: `${job.channel}_network_error`,
      errorMessage: `Сетевая ошибка канала ${job.channel}`, retryable: true,
    };
  }
  let body: Record<string, unknown> = {};
  try { body = await response.json(); } catch { /* status is enough */ }
  if (!response.ok) return {
    ok: false, errorCode: `${job.channel}_${response.status}`,
    errorMessage: `Провайдер ${job.channel} отклонил отправку (${response.status})`,
    retryable: retryableStatus(response.status), retryAfterSeconds: retryAfter(response),
  };
  const messageId = body.message_id ?? body.id ?? response.headers.get("x-message-id");
  const receipt = confirmedDelivery(body);
  return {
    ok: true,
    providerMessageId: messageId == null ? undefined : String(messageId),
    deliveryState: receipt ? "delivered" : "sent",
    deliveredAt: receipt?.deliveredAt,
    receiptSource: receipt?.receiptSource,
  };
}

export async function deliverNotification(job: NotificationJob, configuration: AdapterConfiguration): Promise<DeliveryResult> {
  const adapter = configuration[job.channel];
  if (!adapter) return {
    ok: false, errorCode: `${job.channel}_not_configured`,
    errorMessage: `Канал ${job.channel} не настроен`, retryable: false,
  };
  return job.channel === "telegram"
    ? telegram(job, adapter as NonNullable<AdapterConfiguration["telegram"]>)
    : gatewayDelivery(job, adapter as GatewayConfiguration);
}
