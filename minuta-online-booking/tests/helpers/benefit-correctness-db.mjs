import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const source = new URL("../../", import.meta.url);
const fixture = new URL("../fixtures/benefit-correctness/", import.meta.url);
const read = (url) => readFileSync(url, "utf8").replace(/\r\n/g, "\n");
export const forward = read(
  new URL(
    "../supabase/migrations/20261015000127_benefit_correctness.sql",
    source,
  ),
);
export const rollback = read(
  new URL("../../recovery/rollback-benefit-correctness.sql", import.meta.url),
);

// Never accepts a production URL or an existing application database. This
// harness creates its own empty database on an explicitly admitted local PG.
export async function withDb(action) {
  assert.equal(
    process.env.BENEFIT_TEST_LOCAL_POSTGRES,
    "1",
    "Explicit isolated local PostgreSQL opt-in required",
  );
  assert.ok(!process.env.PGHOST || process.env.PGHOST === "127.0.0.1");
  const port = Number(process.env.PGPORT);
  assert.ok(
    Number.isInteger(port) && port > 1024 && port < 65536,
    "Dedicated local test port required",
  );
  const module = process.env.MINUTA_PG_MODULE
    ? pathToFileURL(process.env.MINUTA_PG_MODULE).href
    : "pg";
  const imported = await import(module);
  const { Client } = imported.default || imported;
  const config = {
    host: "127.0.0.1",
    port,
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD,
  };
  const admin = new Client({ ...config, database: "postgres" });
  await admin.connect();
  const database = "benefit_correctness_" + randomUUID().replaceAll("-", "");
  let db;
  try {
    await admin.query("create database " + database);
    const connect = async () => {
      const client = new Client({ ...config, database });
      await client.connect();
      await client.query(
        "set timezone='UTC'; set statement_timeout='20s'; set lock_timeout='8s'",
      );
      return client;
    };
    db = await connect();
    assert.equal(
      Number(
        (
          await db.query(
            "select count(*) from pg_tables where schemaname='public'",
          )
        ).rows[0].count,
      ),
      0,
    );
    return await action(db, connect);
  } finally {
    await db?.end();
    await admin.end();
  }
}

export async function install(db) {
  await db.query(read(new URL("bootstrap.sql", fixture)));
  await db.query(read(new URL("dependencies.sql", fixture)));
  for (const name of [
    "supabase-migration-v73.sql",
    "supabase-migration-v84.sql",
    "supabase-migration-v149.sql",
    "supabase-migration-v150.sql",
  ]) {
    await db.query(read(new URL(name, source)));
  }
  await db.query(read(new URL("baseline.sql", fixture)));
}
