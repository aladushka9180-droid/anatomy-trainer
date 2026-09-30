import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { PGlite } = process.env.MINUTA_PGLITE_PACKAGE
  ? require(path.join(process.env.MINUTA_PGLITE_PACKAGE, 'dist/index.cjs'))
  : require('@electric-sql/pglite');

const migration = readFileSync(new URL('../supabase-services-42501-grant.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase-services-42501-grant-rollback.sql', import.meta.url), 'utf8');
const db = new PGlite();

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select current_setting('app.uid')::uuid
    $$;
    create table public.services (
      id uuid primary key,
      performer_id uuid not null,
      name text not null,
      active boolean not null default true
    );
    create function public.minuta_normalize_service_name_v160(value text)
    returns text language sql immutable set search_path to '' as $$
      select lower(regexp_replace(
        btrim(translate(normalize(coalesce(value,''),NFKC),chr(160),' ')),
        '[[:space:]]+',' ','g'
      ));
    $$;
    create index services_normalized_name_v160_idx
      on public.services(performer_id, public.minuta_normalize_service_name_v160(name));
    create function public.prevent_duplicate_service_name_v160()
    returns trigger language plpgsql security definer set search_path to '' as $$
    declare v_name text := public.minuta_normalize_service_name_v160(new.name);
    begin
      if tg_op = 'UPDATE'
         and new.performer_id is not distinct from old.performer_id
         and v_name = public.minuta_normalize_service_name_v160(old.name) then
        return new;
      end if;
      perform pg_advisory_xact_lock(hashtextextended(new.performer_id::text||':service-name:'||v_name,160));
      if exists (
        select 1 from public.services service
        where service.performer_id = new.performer_id and service.id is distinct from new.id
          and public.minuta_normalize_service_name_v160(service.name) = v_name
      ) then
        raise exception using errcode = '23505', message = 'duplicate_service_name';
      end if;
      return new;
    end;
    $$;
    create trigger services_prevent_duplicate_name_v160
      before insert or update of performer_id, name on public.services
      for each row execute function public.prevent_duplicate_service_name_v160();
    revoke all on function public.minuta_normalize_service_name_v160(text) from public, anon, authenticated;
    revoke all on function public.prevent_duplicate_service_name_v160() from public, anon, authenticated;
    grant usage on schema public, auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    grant insert, select on public.services to authenticated;
    alter table public.services enable row level security;
    create policy services_owner_insert on public.services for insert to authenticated
      with check (performer_id = auth.uid());
    create policy services_public_read on public.services for select to authenticated
      using (active or performer_id = auth.uid());
    set role authenticated;
    select set_config('app.uid','11111111-1111-4111-8111-111111111111',false);
  `);

  const insert = (id, name) => db.query(
    `insert into public.services(id,performer_id,name) values ($1,$2,$3) returning id`,
    [id, '11111111-1111-4111-8111-111111111111', name]
  );
  const denied = error => {
    assert.equal(error.code, '42501');
    assert.match(error.message, /permission denied for function minuta_normalize_service_name_v160/);
    return true;
  };

  await assert.rejects(insert('22222222-2222-4222-8222-222222222222', 'Synthetic before'), denied);
  await db.exec('reset role');
  await db.exec(migration);
  const grants = await db.query(`select
    has_function_privilege('authenticated','public.minuta_normalize_service_name_v160(text)','EXECUTE') as authenticated,
    has_function_privilege('anon','public.minuta_normalize_service_name_v160(text)','EXECUTE') as anon`);
  assert.deepEqual(grants.rows[0], { authenticated: true, anon: false });
  await db.exec('set role authenticated');
  const created = await insert('33333333-3333-4333-8333-333333333333', 'Synthetic after');
  assert.equal(created.rows.length, 1);
  await db.exec('reset role');
  await db.exec(rollback);
  await db.exec('set role authenticated');
  await assert.rejects(insert('44444444-4444-4444-8444-444444444444', 'Synthetic rollback'), denied);
  console.log('services 42501 isolated grant/rollback: PASS');
} finally {
  await db.close();
}
