import assert from "node:assert/strict";
import { randomUUID as uuid } from "node:crypto";
import {
  withDb,
  install,
  forward,
  rollback,
} from "./helpers/benefit-correctness-db.mjs";
const results = [],
  observations = [];
const test = async (name, fn) => {
  const start = performance.now();
  try {
    const detail = await fn();
    results.push({
      name,
      status: "pass",
      ms: Math.round(performance.now() - start),
      detail,
    });
  } catch (e) {
    results.push({ name, status: "fail", error: e.message, code: e.code });
  }
  console.log(JSON.stringify(results.at(-1)));
};
await withDb(async (db, connect) => {
  await install(db);
  const legacyFixture = await fixture(),
    legacyInstrument = await instrument(legacyFixture, "certificate"),
    legacyBooking = await booking(legacyFixture),
    legacyRequest = uuid();
  await apply(
    legacyFixture,
    legacyInstrument.id,
    legacyBooking,
    "reserve",
    800,
    legacyRequest,
  );
  await test("00 baseline reproduces all three audited defects before migration", async () => {
    assert.equal(
      (await balance(legacyInstrument.id)).remaining_amount_rub,
      200,
    );
    const f = await fixture(),
      i = await instrument(f),
      b = await booking(f);
    await apply(f, i.id, b, "reserve");
    await db.query("insert into booking_outcomes values($1,'completed')", [b]);
    await apply(f, i.id, b, "redeem");
    await rpc(f, "set_minuta_benefit_status", [f.org, i.id, "cancelled"]);
    await apply(f, i.id, b, "release");
    assert.equal((await balance(i.id)).status, "active");
    await db.query(
      "update locations set timezone='Pacific/Kiritimati' where id=$1",
      [f.location],
    );
    await db.query("set timezone='Etc/GMT+12'");
    try {
      const expired = (
        await db.query(
          "select (timezone('Pacific/Kiritimati',clock_timestamp())::date-1)::text as expiry",
        )
      ).rows[0].expiry;
      await db.query(
        "update client_benefit_instruments set expires_on=$1 where id=$2",
        [expired, i.id],
      );
      const boundaryBooking = await booking(f, { date: expired });
      await apply(f, i.id, boundaryBooking, "reserve");
      assert.equal((await balance(i.id)).remaining_visits, 4);
    } finally {
      await db.query("set timezone='UTC'");
    }
  });
  const beforeMetadata = await metadata();
  await db.query(forward);
  await db.query(forward);
  async function fixture() {
    const f = Object.fromEntries(
      [
        "owner",
        "admin",
        "worker",
        "outsider",
        "org",
        "foreign",
        "client",
        "otherClient",
        "service",
        "secondService",
        "thirdService",
        "location",
      ].map((k) => [k, uuid()]),
    );
    await db.query("insert into auth.users(id) select unnest($1::uuid[])", [
      [f.owner, f.admin, f.worker, f.outsider],
    ]);
    await db.query(
      "insert into organizations(id,name,status) values($1,'Synthetic audit','active'),($2,'Foreign synthetic','active')",
      [f.org, f.foreign],
    );
    for (const [id, role] of [
      [f.owner, "owner"],
      [f.admin, "admin"],
      [f.worker, "performer"],
    ])
      await db.query(
        "insert into organization_memberships(organization_id,user_id,role)values($1,$2,$3)",
        [f.org, id, role],
      );
    await db.query(
      "insert into locations(id,organization_id,timezone)values($1,$2,'Europe/Samara')",
      [f.location, f.org],
    );
    await db.query("insert into client_accounts(id)values($1),($2)", [
      f.client,
      f.otherClient,
    ]);
    for (const [id, name] of [
      [f.service, "A"],
      [f.secondService, "B"],
      [f.thirdService, "C"],
    ])
      await db.query(
        "insert into services(id,performer_id,name)values($1,$2,$3)",
        [id, f.owner, name],
      );
    await db.query(
      "insert into organization_benefit_settings(organization_id,enabled)values($1,true)",
      [f.org],
    );
    await booking(f);
    return f;
  }
  async function booking(f, options = {}) {
    const id = uuid();
    await db.query(
      "insert into bookings(id,organization_id,location_id,performer_id,service_id,client_account_id,client_name,client_phone,total_price_rub,booking_date,status)values($1,$2,$3,$4,$5,$6,'Synthetic','00000000000',$7,coalesce($8::date,current_date),$9)",
      [
        id,
        f.org,
        f.location,
        f.owner,
        options.service || f.service,
        options.client || f.client,
        options.price ?? 300,
        options.date || null,
        options.status || "confirmed",
      ],
    );
    return id;
  }
  async function actor(client, user, sql, args = []) {
    await client.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user || "",
    ]);
    await client.query("set role authenticated");
    try {
      return (await client.query(sql, args)).rows[0]?.result;
    } finally {
      await client.query("reset role");
    }
  }
  async function rpc(f, name, args, who = f.owner, connection = db) {
    return actor(
      connection,
      who,
      "select public." +
        name +
        "(" +
        args.map((_, i) => "$" + (i + 1)).join(",") +
        ")result",
      args,
    );
  }
  async function product(f, kind = "visit_pass", extra = {}) {
    const services =
      extra.services ||
      (kind === "package"
        ? [
            { service_id: f.service, units: 2 },
            { service_id: f.secondService, units: 1 },
          ]
        : []);
    const visits =
      kind === "certificate"
        ? 0
        : (extra.visits ??
          (kind === "package" ? services.reduce((s, x) => s + x.units, 0) : 5));
    const r = await rpc(f, "upsert_minuta_benefit_product", [
      f.org,
      extra.id || null,
      extra.name || "Synthetic " + kind,
      kind,
      500,
      kind === "certificate" ? 1000 : 0,
      visits,
      90,
      JSON.stringify(services),
    ]);
    return r.id;
  }
  async function issue(f, p, request = uuid(), expires = null) {
    return rpc(f, "issue_minuta_benefit", [
      f.org,
      p,
      f.client,
      expires,
      request,
    ]);
  }
  async function instrument(f, kind = "visit_pass", extra = {}) {
    return issue(f, await product(f, kind, extra));
  }
  async function apply(
    f,
    i,
    b,
    action,
    amount = null,
    request = uuid(),
    who = f.owner,
    conn = db,
  ) {
    return rpc(
      f,
      "apply_minuta_benefit_v149",
      [f.org, i, b, action, amount, request],
      who,
      conn,
    );
  }
  async function balance(id) {
    return (
      await db.query(
        "select remaining_visits,remaining_amount_rub,status from client_benefit_instruments where id=$1",
        [id],
      )
    ).rows[0];
  }
  async function reject(fn, message) {
    await assert.rejects(
      fn,
      (e) => e.message === message,
      "Expected " + message,
    );
  }

  async function metadata() {
    return (
      await db.query(
        "select proname,pg_get_functiondef(oid) definition,proacl::text acl,proowner,prosecdef,proconfig,provolatile from pg_proc where pronamespace='public'::regnamespace order by oid",
      )
    ).rows;
  }
  await test("01 templates: three types, issue and snapshots", async () => {
    const f = await fixture();
    for (const kind of ["visit_pass", "package", "certificate"]) {
      const i = await instrument(f, kind);
      const b = await balance(i.id);
      assert.equal(
        b.remaining_visits,
        kind === "visit_pass" ? 5 : kind === "package" ? 3 : 0,
      );
      assert.equal(b.remaining_amount_rub, kind === "certificate" ? 1000 : 0);
    }
    return "5 visits; package A2+B1; certificate 1000";
  });
  await test("02 visit pass: 5 -> reserve 4 -> redeem 4 -> owner return 5; replay stable", async () => {
    const f = await fixture(),
      i = await instrument(f),
      b = await booking(f);
    await apply(f, i.id, b, "reserve");
    assert.equal((await balance(i.id)).remaining_visits, 4);
    await reject(
      () => apply(f, i.id, b, "redeem"),
      "complete_visit_before_redemption",
    );
    await db.query("insert into booking_outcomes values($1,'completed')", [b]);
    const r = uuid();
    await apply(f, i.id, b, "redeem", null, r);
    await apply(f, i.id, b, "redeem", null, r);
    assert.equal((await balance(i.id)).remaining_visits, 4);
    const request = uuid();
    await apply(f, i.id, b, "release", null, request);
    await apply(f, i.id, b, "release", null, request);
    assert.equal((await balance(i.id)).remaining_visits, 5);
  });
  await test("03 certificate: 1000 -> reserve 300 -> redeem 700 -> return 1000", async () => {
    const f = await fixture(),
      i = await instrument(f, "certificate"),
      b = await booking(f);
    await apply(f, i.id, b, "reserve", 300);
    assert.equal((await balance(i.id)).remaining_amount_rub, 700);
    await db.query("insert into booking_outcomes values($1,'completed')", [b]);
    await apply(f, i.id, b, "redeem");
    assert.equal((await balance(i.id)).remaining_amount_rub, 700);
    await apply(f, i.id, b, "release");
    assert.equal((await balance(i.id)).remaining_amount_rub, 1000);
  });
  await test("04 package: separate service balances and disallowed service", async () => {
    const f = await fixture(),
      i = await instrument(f, "package"),
      b = await booking(f),
      c = await booking(f, { service: f.thirdService });
    await apply(f, i.id, b, "reserve");
    assert.equal((await balance(i.id)).remaining_visits, 2);
    assert.equal(
      (
        await db.query(
          "select remaining_units from benefit_instrument_service_balances where instrument_id=$1 and service_id=$2",
          [i.id, f.service],
        )
      ).rows[0].remaining_units,
      1,
    );
    await reject(
      () => apply(f, i.id, c, "reserve"),
      "package_service_exhausted",
    );
    await apply(f, i.id, b, "release");
    assert.equal((await balance(i.id)).remaining_visits, 3);
  });
  await test("05 issuance retry: same request creates one instrument; conflict rejected", async () => {
    const f = await fixture(),
      p = await product(f),
      r = uuid();
    const a = await issue(f, p, r),
      b = await issue(f, p, r);
    assert.equal(a.id, b.id);
    const p2 = await product(f, "certificate");
    await reject(() => issue(f, p2, r), "benefit_request_conflict");
    assert.equal(
      Number(
        (
          await db.query(
            "select count(*) from client_benefit_instruments where organization_id=$1",
            [f.org],
          )
        ).rows[0].count,
      ),
      1,
    );
  });
  await test("06 issued terms survive template change", async () => {
    const f = await fixture(),
      p = await product(f),
      i = await issue(f, p);
    await product(f, "visit_pass", {
      id: p,
      visits: 9,
      name: "Changed template",
    });
    const row = (
      await db.query(
        "select product_snapshot,remaining_visits from client_benefit_instruments where id=$1",
        [i.id],
      )
    ).rows[0];
    assert.equal(row.product_snapshot.visits_count, 5);
    assert.equal(row.remaining_visits, 5);
  });
  await test("07 application replay and changed-parameter conflict", async () => {
    const f = await fixture(),
      i = await instrument(f, "certificate"),
      b = await booking(f),
      r = uuid();
    await apply(f, i.id, b, "reserve", 200, r);
    const replay = await apply(f, i.id, b, "reserve", 200, r);
    assert.equal(replay.replayed, true);
    await reject(
      () => apply(f, i.id, b, "reserve", 300, r),
      "benefit_application_idempotency_conflict",
    );
    assert.equal((await balance(i.id)).remaining_amount_rub, 800);
  });
  await test("08 reserve return after booking cancellation restores original balance", async () => {
    const f = await fixture(),
      i = await instrument(f),
      b = await booking(f);
    await apply(f, i.id, b, "reserve");
    await db.query("update bookings set status='cancelled' where id=$1", [b]);
    await apply(f, i.id, b, "release");
    assert.equal((await balance(i.id)).remaining_visits, 5);
    const cancelled = await booking(f, { status: "cancelled" });
    await reject(
      () => apply(f, i.id, cancelled, "reserve"),
      "benefit_not_available",
    );
  });
  await test("09 roles and foreign tenant; direct table writes rejected", async () => {
    const f = await fixture();
    for (const who of [f.worker, f.outsider])
      await reject(
        () => rpc(f, "get_minuta_benefit_workspace", [f.org], who),
        "benefit_management_denied",
      );
    await reject(
      () => rpc(f, "get_minuta_benefit_workspace", [f.foreign]),
      "benefit_management_denied",
    );
    assert.equal(
      (await rpc(f, "get_minuta_benefit_workspace", [f.org], f.admin))
        .organization_id,
      f.org,
    );
    await assert.rejects(
      actor(
        db,
        f.owner,
        "insert into benefit_products(organization_id,name,kind,sale_price_rub,face_value_rub,visits_count,validity_days)values($1,'Unauthorized','visit_pass',0,0,1,90)",
        [f.org],
      ),
      (e) => e.code === "42501",
    );
    await db.query("set role anon");
    try {
      await assert.rejects(
        db.query("select public.get_minuta_benefit_workspace($1)", [f.org]),
        (e) => e.code === "42501",
      );
    } finally {
      await db.query("reset role");
    }
  });
  await test("10 redeemed return is owner-only", async () => {
    const f = await fixture(),
      i = await instrument(f),
      b = await booking(f);
    await apply(f, i.id, b, "reserve");
    await db.query("insert into booking_outcomes values($1,'completed')", [b]);
    await apply(f, i.id, b, "redeem");
    await reject(
      () => apply(f, i.id, b, "release", null, uuid(), f.admin),
      "owner_required_to_release_redeemed_benefit",
    );
    assert.equal((await balance(i.id)).remaining_visits, 4);
    await apply(f, i.id, b, "release");
    assert.equal((await balance(i.id)).remaining_visits, 5);
  });
  await test("11 freeze blocks reservation; unfreeze and retry remain stable", async () => {
    const f = await fixture(),
      i = await instrument(f),
      b = await booking(f);
    const freeze = uuid();
    await rpc(f, "set_minuta_benefit_lifecycle_v150", [
      f.org,
      i.id,
      "freeze",
      "Synthetic test",
      freeze,
    ]);
    assert.equal((await balance(i.id)).status, "frozen");
    await reject(() => apply(f, i.id, b, "reserve"), "benefit_not_available");
    const thaw = uuid();
    await rpc(f, "set_minuta_benefit_lifecycle_v150", [
      f.org,
      i.id,
      "unfreeze",
      "",
      thaw,
    ]);
    assert.equal(
      (
        await rpc(f, "set_minuta_benefit_lifecycle_v150", [
          f.org,
          i.id,
          "unfreeze",
          "",
          thaw,
        ])
      ).replayed,
      true,
    );
    assert.equal((await balance(i.id)).status, "active");
  });
  await test("12 freeze with outstanding reservation is rejected", async () => {
    const f = await fixture(),
      i = await instrument(f),
      b = await booking(f);
    await apply(f, i.id, b, "reserve");
    await reject(
      () =>
        rpc(f, "set_minuta_benefit_lifecycle_v150", [
          f.org,
          i.id,
          "freeze",
          "",
          uuid(),
        ]),
      "release_reserved_benefits_before_freeze",
    );
  });
  await test("13 insufficient certificate and expired or wrong-client use rejected", async () => {
    const f = await fixture(),
      i = await instrument(f, "certificate"),
      b = await booking(f);
    await reject(
      () => apply(f, i.id, b, "reserve", 1001),
      "insufficient_certificate_balance",
    );
    const other = await booking(f, { client: f.otherClient });
    await reject(
      () => apply(f, i.id, other, "reserve", 100),
      "benefit_client_mismatch",
    );
    await db.query(
      "update client_benefit_instruments set expires_on=current_date-1 where id=$1",
      [i.id],
    );
    await reject(
      () => apply(f, i.id, b, "reserve", 100),
      "benefit_not_available",
    );
  });
  await test("14 other service and future booking beyond expiry rejected", async () => {
    const f = await fixture(),
      i = await instrument(f, "visit_pass", {
        services: [{ service_id: f.service, units: 1 }],
      }),
      other = await booking(f, { service: f.secondService });
    await reject(
      () => apply(f, i.id, other, "reserve"),
      "visit_pass_not_applicable",
    );
    const future = await booking(f, { date: "2040-01-01" });
    await reject(
      () => apply(f, i.id, future, "reserve"),
      "benefit_not_available",
    );
  });
  await test("15 last visit: real concurrent sessions serialize; only one succeeds", async () => {
    const f = await fixture(),
      i = await instrument(f, "visit_pass", { visits: 1 }),
      a = await booking(f),
      b = await booking(f),
      c1 = await connect(),
      c2 = await connect();
    try {
      await c1.query("begin");
      await apply(f, i.id, a, "reserve", null, uuid(), f.owner, c1);
      const second = apply(
        f,
        i.id,
        b,
        "reserve",
        null,
        uuid(),
        f.owner,
        c2,
      ).then(
        (v) => ({ v }),
        (e) => ({ error: e.message }),
      );
      let blocked = false;
      for (let n = 0; n < 40; n++) {
        const r = await db.query(
          "select wait_event_type from pg_stat_activity where pid=$1",
          [c2.processID],
        );
        if (r.rows[0]?.wait_event_type === "Lock") {
          blocked = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.equal(blocked, true);
      await c1.query("commit");
      assert.equal((await second).error, "benefit_not_available");
      assert.equal((await balance(i.id)).remaining_visits, 0);
      assert.equal(
        Number(
          (
            await db.query(
              "select count(*) from benefit_redemptions where instrument_id=$1 and status='reserved'",
              [i.id],
            )
          ).rows[0].count,
        ),
        1,
      );
      return { realLockObserved: blocked };
    } finally {
      await c1.query("rollback");
      await c1.end();
      await c2.end();
    }
  });
  await test("16 benefit and loyalty conflict rolls back balance changes", async () => {
    const f = await fixture(),
      i = await instrument(f),
      b = await booking(f);
    await db.query(
      "insert into loyalty_redemptions(organization_id,booking_id)values($1,$2)",
      [f.org, b],
    );
    await reject(
      () => apply(f, i.id, b, "reserve"),
      "booking_benefit_conflict",
    );
    assert.equal((await balance(i.id)).remaining_visits, 5);
  });
  await test("17 default certificate amount is capped at booking price and available balance", async () => {
    const f = await fixture(),
      i = await instrument(f, "certificate"),
      b = await booking(f, { price: 300 });
    await apply(f, i.id, b, "reserve");
    assert.equal((await balance(i.id)).remaining_amount_rub, 700);
  });
  await test("18 certificate explicit amount must not exceed booking price", async () => {
    const f = await fixture(),
      i = await instrument(f, "certificate"),
      b = await booking(f, { price: 300 });
    await reject(
      () => apply(f, i.id, b, "reserve", 800),
      "certificate_amount_exceeds_booking_price",
    );
    const r = "rejected";
    const actual = await balance(i.id);
    observations.push({
      id: "CERTIFICATE_OVERPAY",
      bookingPrice: 300,
      requested: 800,
      remaining: actual.remaining_amount_rub,
      result: r,
    });
    assert.equal(
      actual.remaining_amount_rub,
      1000,
      "Expected rejection without consuming certificate; actual accepted 800 for a 300 booking",
    );
  });
  await test("19 duplicate package service entries are rejected atomically", async () => {
    const f = await fixture();
    await assert.rejects(
      product(f, "package", {
        services: [
          { service_id: f.service, units: 2 },
          { service_id: f.service, units: 3 },
        ],
      }),
      (e) => e.code === "21000",
    );
    assert.equal(
      Number(
        (
          await db.query(
            "select count(*) from benefit_products where organization_id=$1",
            [f.org],
          )
        ).rows[0].count,
      ),
      0,
    );
  });
  await test("20 cancelled product cannot be reactivated by return of a redeemed visit", async () => {
    const f = await fixture(),
      i = await instrument(f),
      b = await booking(f);
    await apply(f, i.id, b, "reserve");
    await db.query("insert into booking_outcomes values($1,'completed')", [b]);
    await apply(f, i.id, b, "redeem");
    await rpc(f, "set_minuta_benefit_status", [f.org, i.id, "cancelled"]);
    assert.equal((await balance(i.id)).status, "cancelled");
    await apply(f, i.id, b, "release");
    const actual = await balance(i.id);
    observations.push({ id: "CANCELLED_PRODUCT_REVIVAL", ...actual });
    assert.equal(
      actual.status,
      "cancelled",
      "Returning used balance reactivated a cancelled instrument",
    );
  });
  await test("21 freeze duration extends expiry by local calendar days once", async () => {
    const f = await fixture(),
      i = await instrument(f);
    await rpc(f, "set_minuta_benefit_lifecycle_v150", [
      f.org,
      i.id,
      "freeze",
      "",
      uuid(),
    ]);
    await db.query(
      "update benefit_freeze_periods set frozen_at=now()-interval '3 days' where instrument_id=$1 and thawed_at is null",
      [i.id],
    );
    const r = await rpc(f, "set_minuta_benefit_lifecycle_v150", [
      f.org,
      i.id,
      "unfreeze",
      "",
      uuid(),
    ]);
    assert.equal(r.extended_days, 3);
  });
  await test("22 invalid amounts and template values are rejected", async () => {
    const f = await fixture();
    await assert.rejects(
      product(f, "visit_pass", { visits: 10001 }),
      (e) => e.code === "23514",
    );
    const i = await instrument(f, "certificate"),
      b = await booking(f);
    for (const amount of [0, -1])
      await reject(
        () => apply(f, i.id, b, "reserve", amount),
        "invalid_benefit_application",
      );
    assert.equal((await balance(i.id)).remaining_amount_rub, 1000);
  });
  await test("24 cancellation helper restores a package reservation exactly once", async () => {
    const f = await fixture(),
      i = await instrument(f, "package"),
      b = await booking(f);
    await apply(f, i.id, b, "reserve");
    const a = (
      await db.query(
        "select public.release_minuta_reserved_benefit_for_booking($1) result",
        [b],
      )
    ).rows[0].result;
    const again = (
      await db.query(
        "select public.release_minuta_reserved_benefit_for_booking($1) result",
        [b],
      )
    ).rows[0].result;
    assert.equal(a, true);
    assert.equal(again, false);
    assert.equal((await balance(i.id)).remaining_visits, 3);
  });
  await test("23 organization dates ignore the database session calendar", async () => {
    for (const zone of ["Europe/Samara", "Europe/Moscow", "Asia/Vladivostok"]) {
      const f = await fixture();
      await db.query("update locations set timezone=$1 where id=$2", [
        zone,
        f.location,
      ]);
      const day = (
        await db.query(
          "select timezone($1,clock_timestamp())::date::text as business_day",
          [zone],
        )
      ).rows[0].business_day;
      // Choose a contradictory session calendar at every wall-clock time.
      const opposite = (
        await db.query(
          "select name from (values('Pacific/Kiritimati'),('Etc/GMT+12')) zones(name) where timezone(name,clock_timestamp())::date<>$1::date limit 1",
          [day],
        )
      ).rows[0].name;
      await db.query("select set_config('TimeZone',$1,false)", [opposite]);
      try {
        const p = await product(f),
          i = await issue(f, p);
        assert.equal(
          i.expires_on,
          (await db.query("select ($1::date+90)::text as business_day", [day]))
            .rows[0].business_day,
        );
        const workspace = await rpc(f, "get_minuta_benefit_workspace", [f.org]);
        assert.equal(workspace.timezone, zone);
        assert.equal(workspace.business_date, day);
        const yesterday = (
          await db.query("select ($1::date-1)::text as business_day", [day])
        ).rows[0].business_day;
        await reject(
          () => issue(f, p, uuid(), yesterday),
          "invalid_benefit_expiry",
        );
        const b = await booking(f, { date: yesterday });
        await db.query(
          "update client_benefit_instruments set expires_on=$1 where id=$2",
          [yesterday, i.id],
        );
        await reject(
          () => apply(f, i.id, b, "reserve"),
          "benefit_not_available",
        );
        // Expiry remains inclusive for today's staff and public reservations.
        await db.query(
          "update client_benefit_instruments set expires_on=$1 where id=$2",
          [day, i.id],
        );
        await apply(f, i.id, b, "reserve");
        await apply(f, i.id, b, "release");
        assert.equal((await balance(i.id)).status, "active");
        const publicBooking = await booking(f, { date: yesterday }),
          request = uuid();
        await db.query("update bookings set request_id=$1 where id=$2", [
          request,
          publicBooking,
        ]);
        await db.query(
          "update client_benefit_instruments set expires_on=$1 where id=$2",
          [yesterday, i.id],
        );
        await assert.rejects(
          db.query(
            "select public.reserve_minuta_public_benefit_v115($1,$2,$3)",
            [f.org, request, i.public_code],
          ),
          (e) => e.message === "benefit_not_available",
        );
        await db.query(
          "update client_benefit_instruments set expires_on=$1 where id=$2",
          [day, i.id],
        );
        await db.query(
          "select public.reserve_minuta_public_benefit_v115($1,$2,$3)",
          [f.org, request, i.public_code],
        );
        // Cancellation release must use the same day as reservation/lifecycle.
        await db.query(
          "select public.release_minuta_reserved_benefit_for_booking($1)",
          [publicBooking],
        );
        assert.equal((await balance(i.id)).status, "active");
      } finally {
        await db.query("set timezone='UTC'");
      }
    }
  });
  await test("25 certificate ceiling covers partial, equal, automatic and free bookings", async () => {
    for (const [price, amount, remaining] of [
      [300, 100, 900],
      [300, 300, 700],
      [300, null, 700],
      [1500, null, 0],
    ]) {
      const f = await fixture(),
        i = await instrument(f, "certificate"),
        b = await booking(f, { price });
      await apply(f, i.id, b, "reserve", amount);
      assert.equal((await balance(i.id)).remaining_amount_rub, remaining);
    }
    const f = await fixture(),
      i = await instrument(f, "certificate"),
      b = await booking(f, { price: 0 });
    await reject(
      () => apply(f, i.id, b, "reserve", 1),
      "certificate_amount_exceeds_booking_price",
    );
    await reject(
      () => apply(f, i.id, b, "reserve"),
      "insufficient_certificate_balance",
    );
    assert.equal((await balance(i.id)).remaining_amount_rub, 1000);
    assert.equal(
      Number(
        (
          await db.query(
            "select count(*) from benefit_redemptions where instrument_id=$1",
            [i.id],
          )
        ).rows[0].count,
      ),
      0,
    );
  });
  await test("26 cancelled certificate and package retain cancellation and restore exact balances once", async () => {
    for (const kind of ["certificate", "package"]) {
      const f = await fixture(),
        i = await instrument(f, kind),
        b = await booking(f),
        request = uuid();
      await apply(f, i.id, b, "reserve");
      await db.query("insert into booking_outcomes values($1,'completed')", [
        b,
      ]);
      await apply(f, i.id, b, "redeem");
      await rpc(f, "set_minuta_benefit_status", [f.org, i.id, "cancelled"]);
      await apply(f, i.id, b, "release", null, request);
      await apply(f, i.id, b, "release", null, request);
      const actual = await balance(i.id);
      assert.equal(actual.status, "cancelled");
      assert.equal(
        actual.remaining_amount_rub,
        kind === "certificate" ? 1000 : 0,
      );
      assert.equal(actual.remaining_visits, kind === "package" ? 3 : 0);
      if (kind === "package")
        assert.equal(
          (
            await db.query(
              "select remaining_units from benefit_instrument_service_balances where instrument_id=$1 and service_id=$2",
              [i.id, f.service],
            )
          ).rows[0].remaining_units,
          2,
        );
    }
  });
  await test("29 pre-migration oversized reservation replay and return preserve historical amounts", async () => {
    const replay = await apply(
      legacyFixture,
      legacyInstrument.id,
      legacyBooking,
      "reserve",
      800,
      legacyRequest,
    );
    assert.equal(replay.replayed, true);
    assert.equal(
      (await balance(legacyInstrument.id)).remaining_amount_rub,
      200,
    );
    await apply(legacyFixture, legacyInstrument.id, legacyBooking, "release");
    assert.equal(
      (await balance(legacyInstrument.id)).remaining_amount_rub,
      1000,
    );
  });
  await test("27 migration round trip preserves data, privileges, owners and function properties", async () => {
    const tables = (
      await db.query(
        "select tablename from pg_tables where schemaname='public' order by tablename",
      )
    ).rows;
    async function data() {
      return Promise.all(
        tables.map(async ({ tablename }) => [
          tablename,
          (
            await db.query(
              "select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) rows from public.\"" +
                tablename.replaceAll('"', '""') +
                '" t',
            )
          ).rows[0].rows,
        ]),
      );
    }
    const savedData = await data(),
      patched = await metadata();
    const properties = (rows) => rows.map(({ definition, ...row }) => row);
    assert.deepEqual(properties(patched), properties(beforeMetadata));
    assert.equal(
      patched.filter(
        (r, index) => r.definition !== beforeMetadata[index].definition,
      ).length,
      5,
    );
    await db.query(rollback);
    await db.query(rollback);
    assert.deepEqual(await metadata(), beforeMetadata);
    assert.deepEqual(await data(), savedData);
    await db.query(forward);
    await db.query(forward);
    assert.deepEqual(await metadata(), patched);
    assert.deepEqual(await data(), savedData);
  });
  await test("28 newer definitions fail closed in both directions without partial changes", async () => {
    async function guardedFailure(sql) {
      const before = await metadata();
      await assert.rejects(db.query(sql), (e) =>
        e.message.startsWith("benefit_correctness_definition_changed"),
      );
      await db.query("rollback");
      assert.deepEqual(await metadata(), before);
    }
    const patched = await metadata(),
      last = patched.find(
        (r) => r.proname === "reserve_minuta_public_benefit_v115",
      );
    await db.query(
      last.definition.replace(
        "begin\n",
        "begin\n  -- Simulated newer owner change\n",
      ),
    );
    await guardedFailure(rollback);
    await db.query(last.definition);
    await db.query(rollback);
    const original = (await metadata()).find((r) => r.proname === last.proname);
    await db.query(
      original.definition.replace(
        "begin\n",
        "begin\n  -- Simulated newer owner change\n",
      ),
    );
    await guardedFailure(forward);
    await db.query(original.definition);
    await db.query(forward);
    assert.deepEqual(await metadata(), patched);
  });
});
if (results.some((r) => r.status !== "pass")) process.exitCode = 1;
console.log(
  JSON.stringify({
    passed: results.filter((r) => r.status === "pass").length,
    total: results.length,
    productionMutations: false,
  }),
);
