// Runs after the native v186 fixture, in a separate disposable local database.
// Never run this fixture/bootstrap on a restored CURRENT or production database.
import assert from 'node:assert/strict';
import { buildTransaction } from '../scripts/catalog-v186-v187-release-sql.mjs';

const url = new URL(process.env.MINUTA_V186_ISOLATED_DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/isolated_v186');
const { Client } = await import('pg');
const fixture = new Client({ connectionString: url.href });
await fixture.connect();
let admin;
let created = false;
try {
  // Confirm the preceding synthetic fixture, rather than merely a local port.
  const { rows } = await fixture.query(`select count(*)::int n from public.inventory_catalog_requests_v186
    where organization_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'`);
  assert.equal(rows[0].n, 2);
  await fixture.query('create database isolated_catalog_release');
  created = true;
  url.pathname = '/isolated_catalog_release';
  admin = new Client({ connectionString: url.href });
  await admin.connect();
  await admin.query(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create table auth.users(id uuid primary key);
    create table public.organizations(id uuid primary key,status text);
    create table public.organization_memberships(organization_id uuid,user_id uuid,active boolean);
    create table public.inventory_items(id uuid primary key,organization_id uuid,name text,sku text,
      unit text,low_stock_threshold numeric,active boolean,updated_at timestamptz);
    create function public.get_minuta_inventory_workspace_v130(uuid) returns jsonb
      language sql as $$ select '{}'::jsonb $$;
    create function public.upsert_minuta_inventory_item(uuid,uuid,text,text,text,numeric,boolean)
      returns jsonb language sql as $$ select '{}'::jsonb $$;
    create table public.services(id uuid primary key,performer_id uuid,name text,
      duration_minutes integer,price_rub integer,active boolean);
    insert into public.organizations values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','active');
    insert into public.inventory_items values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc','Preserve material','SKU','piece',2,true,'2026-01-01T00:00:00Z');
    insert into public.services values('ffffffff-ffff-4fff-8fff-ffffffffffff',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Preserve service',60,1000,true);
  `);
  const snapshot = async () => (await admin.query(`select
    (select jsonb_agg(to_jsonb(t) order by id) from public.inventory_items t) inventory,
    (select jsonb_agg(to_jsonb(t) order by id) from public.services t) services`)).rows;
  const before = await snapshot();
  const presence = async () => (await admin.query(`select
    to_regclass('public.inventory_catalog_requests_v186') is not null inventory,
    to_regclass('public.service_catalog_requests_v187') is not null services`)).rows[0];
  const attempt = async (phase, code, message) => {
    await assert.rejects(admin.query(buildTransaction(phase)), error =>
      error.code === code && error.message === message);
    await admin.query('rollback');
  };
  // v186 succeeds inside the transaction, then v187 refuses its missing dependency.
  await attempt('apply', 'P0001', 'v187_requires_service_and_organization_schema');
  assert.deepEqual(await presence(), { inventory: false, services: false });
  assert.deepEqual(await snapshot(), before);
  await admin.query(`create table public.service_public_details_v159(service_id uuid primary key,
    short_description text,highlights text[],important_note text,photo_storage_path text,
    photo_alt text,photo_width integer,photo_height integer)`);
  await admin.query(buildTransaction('apply'));
  assert.deepEqual(await presence(), { inventory: true, services: true });
  assert.deepEqual(await snapshot(), before);
  // v187 is dropped first, then v186 refuses rollback of an accepted request.
  await admin.query(`insert into public.inventory_catalog_requests_v186
    (organization_id,request_id,payload_hash,result) values
    ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111','fixture','{}')`);
  await attempt('rollback', '55000', 'v186_catalog_requests_must_be_preserved');
  assert.deepEqual(await presence(), { inventory: true, services: true });
  assert.equal((await admin.query('select count(*)::int n from public.inventory_catalog_requests_v186')).rows[0].n, 1);
  // Remove only the known synthetic request in this disposable fixture.
  await admin.query(`delete from public.inventory_catalog_requests_v186
    where request_id='11111111-1111-4111-8111-111111111111' and payload_hash='fixture'`);
  await admin.query(buildTransaction('rollback'));
  assert.deepEqual(await presence(), { inventory: false, services: false });
  await admin.query(buildTransaction('apply'));
  assert.deepEqual(await presence(), { inventory: true, services: true });
  assert.deepEqual(await snapshot(), before);
  console.log('v186/v187 atomic PostgreSQL: second apply failure, accepted-ledger rollback refusal, rollback/reapply and fixture rows preserved');
} finally {
  if (admin) await admin.end();
  if (created) await fixture.query('drop database isolated_catalog_release');
  await fixture.end();
}
