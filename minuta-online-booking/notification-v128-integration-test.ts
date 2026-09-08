import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  database,
  organization,
  performer,
  service,
} from "./notification-v126-integration-test.ts";

const psqlBody = (source: string) =>
  source.replace(/^\\set ON_ERROR_STOP on\s*/i, "");
const migration = psqlBody(
  await Deno.readTextFile(
    new URL("./supabase-migration-v128.sql", import.meta.url),
  ),
);
const rollback = psqlBody(
  await Deno.readTextFile(
    new URL("./supabase-migration-v128-rollback.sql", import.meta.url),
  ),
);
const booking = "20000000-0000-4000-8000-000000000001";
const targetOutbox = "30000000-0000-4000-8000-000000000001";
const otherOutbox = "30000000-0000-4000-8000-000000000002";
const targetEvent = "v128:controlled:target";
const otherEvent = "v128:controlled:other";

await database.exec(migration);
await database.exec(migration);

Deno.test("v128 controlled mode claims one exact event and rolls back fail-closed", async () => {
  await database.exec(`
    delete from public.notification_delivery_attempts;
    delete from public.notification_outbox;
    delete from public.bookings;
    select set_config('request.jwt.claim.role','service_role',false);
    update public.organization_notification_settings
      set enabled=true,quiet_hours_enabled=false where organization_id='${organization}';
    insert into public.bookings(
      id,booking_code,manage_token,performer_id,service_id,client_name,client_phone,
      booking_date,booking_time,status,organization_id
    ) values(
      '${booking}','V128',gen_random_uuid(),'${performer}','${service}','Клиент','79990000001',
      '2099-09-09','14:00','confirmed','${organization}'
    );
    insert into public.notification_recipient_endpoints(
      organization_id,audience,subject_key,channel,destination,consent_source,consent_at,active
    ) values(
      '${organization}','client','79990000001','telegram','{"chat_id":"fixture"}',
      'test',now(),true
    ) on conflict(organization_id,audience,subject_key,channel) do update
      set destination=excluded.destination,active=true,updated_at=now();
    insert into public.notification_outbox(
      id,performer_id,booking_id,organization_id,event_key,kind,channel,status,attempts,
      next_attempt_at,audience,recipient_key,payload,dispatcher
    ) values
      ('${targetOutbox}','${performer}','${booking}','${organization}','${targetEvent}',
        'booking_confirmed','telegram','pending',0,now(),'client','79990000001',
        '{"booking_date":"2099-09-09","booking_time":"14:00:00"}','unified'),
      ('${otherOutbox}','${performer}','${booking}','${organization}','${otherEvent}',
        'booking_confirmed','telegram','pending',0,now(),'client','79990000001',
        '{"booking_date":"2099-09-09","booking_time":"14:00:00"}','unified');
  `);

  const claimed = await database.query<{
    outbox_id: string;
    event_key: string;
    organization_id: string;
    channel: string;
    lock_token: string;
  }>(`select outbox_id,event_key,organization_id,channel,lock_token
    from public.claim_minuta_notification_test_outbox_v128(
      '${organization}','${targetEvent}','telegram')`);
  assertEquals(claimed.rows.length, 1);
  assertEquals(claimed.rows[0].outbox_id, targetOutbox);
  assertEquals(claimed.rows[0].event_key, targetEvent);
  assertEquals(claimed.rows[0].organization_id, organization);
  assertEquals(claimed.rows[0].channel, "telegram");

  const isolation = await database.query<{
    event_key: string;
    status: string;
    attempts: number;
  }>(`select event_key,status,attempts from public.notification_outbox
    order by event_key`);
  assertEquals(isolation.rows, [
    { event_key: otherEvent, status: "pending", attempts: 0 },
    { event_key: targetEvent, status: "sending", attempts: 1 },
  ]);
  const attempts = await database.query<{ count: number }>(
    `select count(*)::integer count from public.notification_delivery_attempts`,
  );
  assertEquals(attempts.rows, [{ count: 1 }]);

  await assertRejects(() =>
    database.exec(
      `select * from public.claim_minuta_notification_test_outbox_v128(
      '90000000-0000-4000-8000-000000000009','${otherEvent}','telegram')`,
    )
  );
  await assertRejects(() =>
    database.exec(
      `select * from public.claim_minuta_notification_test_outbox_v128(
      '${organization}','missing-event','telegram')`,
    )
  );
  await database.exec(
    `select set_config('request.jwt.claim.role','authenticated',false)`,
  );
  await assertRejects(() =>
    database.exec(
      `select * from public.claim_minuta_notification_test_outbox_v128(
      '${organization}','${otherEvent}','telegram')`,
    )
  );
  await database.exec(
    `select set_config('request.jwt.claim.role','service_role',false)`,
  );

  const second = await database.query<{ lock_token: string }>(
    `select lock_token from public.claim_minuta_notification_test_outbox_v128(
      '${organization}','${otherEvent}','telegram')`,
  );
  assertEquals(second.rows.length, 1);
  const terminal = await database.query<{ state: string }>(`select
    public.fail_minuta_notification_test_outbox_v128(
      '${otherOutbox}','${second.rows[0].lock_token}','${otherEvent}',
      '${organization}','telegram','fixture_failure','fixture') state`);
  assertEquals(terminal.rows, [{ state: "failed" }]);
  const afterFailure = await database.query<{
    count: number;
    failed: number;
    failed_attempts: number;
  }>(`select count(*)::integer count,
      count(*) filter(where status='failed')::integer failed,
      (select count(*)::integer from public.notification_delivery_attempts
        where outcome='failed') failed_attempts
    from public.notification_outbox`);
  assertEquals(afterFailure.rows, [{
    count: 2,
    failed: 1,
    failed_attempts: 1,
  }]);

  await database.exec(rollback);
  await assertRejects(() =>
    database.exec(
      `select * from public.claim_minuta_notification_test_outbox_v128(
      '${organization}','${otherEvent}','telegram')`,
    )
  );
  await database.exec(migration);
  await database.exec(`update public.notification_outbox
    set status='pending',attempts=0,locked_at=null,lock_token=null,next_attempt_at=now()
    where id='${otherOutbox}';
    delete from public.notification_delivery_attempts where outbox_id='${otherOutbox}';`);
  const reapplied = await database.query<{ outbox_id: string }>(
    `select outbox_id from public.claim_minuta_notification_test_outbox_v128(
      '${organization}','${otherEvent}','telegram')`,
  );
  assertEquals(reapplied.rows, [{ outbox_id: otherOutbox }]);
});
