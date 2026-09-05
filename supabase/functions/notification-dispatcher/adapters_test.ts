import { assertEquals } from "jsr:@std/assert@1";
import { deliverNotification, type AdapterConfiguration, type NotificationJob } from "./adapters.ts";

const job: NotificationJob = {
  outbox_id: "00000000-0000-4000-8000-000000000001",
  lock_token: "00000000-0000-4000-8000-000000000002",
  event_key: "booking:test:booking_confirmed:client:telegram",
  organization_id: "00000000-0000-4000-8000-000000000003",
  performer_id: "00000000-0000-4000-8000-000000000004",
  booking_id: "00000000-0000-4000-8000-000000000005",
  kind: "booking_confirmed",
  channel: "telegram",
  audience: "client",
  attempt_no: 1,
  destination: { chat_id:"12345" },
  message_payload: {
    client_name:"Тест", service_name:"Массаж",
    booking_date:"2026-09-10", booking_time:"14:00:00", performer_name:"Мастер",
  },
};

Deno.test("Telegram acceptance is sent, never delivered", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({ ok:true, result:{ message_id:42 } }), {
    status:200, headers:{ "content-type":"application/json" },
  }));
  try {
    const result = await deliverNotification(job, { telegram:{ token:"test-token" } });
    assertEquals(result, { ok:true, deliveryState:"sent", providerMessageId:"42" });
  } finally { globalThis.fetch = originalFetch; }
});

Deno.test("Gateway marks delivered only with explicit receipt evidence", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response(JSON.stringify({
    id:"mail-42", delivery_status:"delivered", delivered_at:"2026-09-05T10:00:00Z", receipt_source:"gateway_webhook",
  }), { status:200, headers:{ "content-type":"application/json" } }));
  const emailJob = { ...job, channel:"email", destination:{ email:"test@example.invalid" } } as NotificationJob;
  const configuration: AdapterConfiguration = { email:{ url:"https://gateway.example.invalid/send", token:"test-token" } };
  try {
    const result = await deliverNotification(emailJob, configuration);
    assertEquals(result, {
      ok:true, providerMessageId:"mail-42", deliveryState:"delivered",
      deliveredAt:"2026-09-05T10:00:00.000Z", receiptSource:"gateway_webhook",
    });
  } finally { globalThis.fetch = originalFetch; }
});

Deno.test("Missing client endpoint fails without contacting a gateway", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls += 1; return Promise.reject(new Error("must not fetch")); };
  try {
    const result = await deliverNotification({ ...job, destination:null }, { telegram:{ token:"test-token" } });
    assertEquals(result.errorCode, "recipient_not_configured");
    assertEquals(result.retryable, false);
    assertEquals(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});
