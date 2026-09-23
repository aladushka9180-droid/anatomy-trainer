import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const [v118, v174, rollback] = await Promise.all([
  'supabase-migration-v118.sql', 'supabase-migration-v174.sql', 'supabase-migration-v174-rollback.sql'
].map(name => readFile(new URL(name, root), 'utf8')));
const moduleName = process.env.MINUTA_PGLITE_MODULE || '@electric-sql/pglite';
const { PGlite } = await import(/^[A-Za-z]:[\\/]/.test(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const owner = '10000000-0000-0000-0000-000000000001';
const outsider = '10000000-0000-0000-0000-000000000002';
const organization = '20000000-0000-0000-0000-000000000001';
const db = new PGlite();
const scalar = async (connection, sql) => Object.values((await connection.query(sql)).rows[0] || {})[0];
const expectError = async (connection, sql, fragment) => {
  await assert.rejects(() => connection.exec(sql), error => String(error?.message || error).includes(fragment));
};

try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table auth.users(id uuid primary key);
    create table public.organizations(
      id uuid primary key,name text not null,public_slug text unique,status text not null,
      public_booking_enabled boolean not null default false
    );
    create table public.organization_memberships(
      organization_id uuid not null references public.organizations(id),user_id uuid not null references auth.users(id),
      role text not null,active boolean not null default true,primary key(organization_id,user_id)
    );
    create function public.is_organization_member(p_organization uuid) returns boolean
      language sql stable security definer set search_path to '' as $$
        select exists(select 1 from public.organization_memberships where organization_id=p_organization and user_id=auth.uid() and active)
      $$;
    create function public.has_organization_role(p_organization uuid,p_roles text[]) returns boolean
      language sql stable security definer set search_path to '' as $$
        select exists(select 1 from public.organization_memberships where organization_id=p_organization and user_id=auth.uid() and active and role=any(p_roles))
      $$;
    create function public.get_public_minuta_catalog_v4(p_slug text) returns jsonb
      language sql stable security definer set search_path to '' as $$
        select jsonb_build_object('organization',jsonb_build_object('id',id,'slug',public_slug),'services','[]'::jsonb,'locations','[]'::jsonb)
        from public.organizations where public_slug=lower(trim(coalesce(p_slug,''))) and status='active' and public_booking_enabled
      $$;
    insert into auth.users values('${owner}'),('${outsider}');
    insert into public.organizations values('${organization}','Tenant A','tenant-a','active',true);
    insert into public.organization_memberships values('${organization}','${owner}','owner',true);
  `);
  await db.exec(v118);
  await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false); set role authenticated;`);
  await scalar(db, `select public.set_minuta_client_page_settings_v118('${organization}','warm','care')`);
  await db.exec('reset role;');
  const backup = await db.dumpDataDir();
  assert.ok(backup.size > 0, 'isolated pre-migration backup must be nonempty');

  await db.exec(v174);
  await db.exec('set role authenticated;');
  const saved = await scalar(db, `select public.set_minuta_client_page_settings_v174('${organization}','pink-porcelain','beauty','petal-pink','silk')`);
  assert.deepEqual(saved.porcelain, { shade:'petal-pink', character:'silk' });
  const read = await scalar(db, `select public.get_minuta_client_page_settings_v174('${organization}')`);
  assert.deepEqual(read.porcelain, saved.porcelain);
  await expectError(db, `select public.set_minuta_client_page_settings_v174('${organization}','pink-porcelain','beauty','invalid','silk')`, 'client_page_porcelain_options_invalid');
  await expectError(db, `select public.set_minuta_client_page_settings_v118('${organization}','sage','care')`, 'organization_client_page_porcelain_options_check');
  await db.exec('reset role; set role anon;');
  const published = await scalar(db, "select public.get_public_minuta_catalog_v5('tenant-a')");
  assert.deepEqual(published.client_page, { theme_key:'pink-porcelain', headline_key:'beauty', porcelain:{ shade:'petal-pink', character:'silk' } });
  await expectError(db, `select public.set_minuta_client_page_settings_v174('${organization}','sage','care')`, 'permission denied');
  await db.exec('reset role;');
  await db.exec(`select set_config('request.jwt.claim.sub','${outsider}',false); set role authenticated;`);
  await expectError(db, `select public.get_minuta_client_page_settings_v174('${organization}')`, 'organization_read_denied');
  await expectError(db, `select public.set_minuta_client_page_settings_v174('${organization}','sage','care')`, 'organization_owner_required');
  await db.exec('reset role;');

  await db.exec(rollback);
  assert.equal(await scalar(db, "select to_regprocedure('public.set_minuta_client_page_settings_v174(uuid,text,text,text,text)') is null"), true);
  const retained = (await db.query(`select theme_key,porcelain_shade,porcelain_character from public.organization_client_page_settings where organization_id='${organization}'`)).rows[0];
  assert.deepEqual(retained, { theme_key:'pink-porcelain', porcelain_shade:'petal-pink', porcelain_character:'silk' });
  const rolledBackCatalog = await scalar(db, "select public.get_public_minuta_catalog_v5('tenant-a')");
  assert.deepEqual(rolledBackCatalog.client_page, { theme_key:'pink-porcelain', headline_key:'beauty' });
  await db.exec(v174);
  assert.deepEqual((await scalar(db, "select public.get_public_minuta_catalog_v5('tenant-a')")).client_page.porcelain, retained && { shade:'petal-pink', character:'silk' });

  const restored = new PGlite({ loadDataDir:backup });
  try {
    const original = (await restored.query(`select theme_key,headline_key from public.organization_client_page_settings where organization_id='${organization}'`)).rows[0];
    assert.deepEqual(original, { theme_key:'warm', headline_key:'care' });
    assert.equal(await scalar(restored, "select to_regprocedure('public.set_minuta_client_page_settings_v174(uuid,text,text,text,text)') is null"), true);
    await restored.exec(v174);
    assert.equal(await scalar(restored, "select to_regprocedure('public.set_minuta_client_page_settings_v174(uuid,text,text,text,text)') is not null"), true);
  } finally { await restored.close(); }
  console.log('Pink Porcelain v174 PGlite: tenant and role scope, validation, stale client safety, public shape, backup restore, rollback and reapply PASS');
} finally { await db.close(); }
