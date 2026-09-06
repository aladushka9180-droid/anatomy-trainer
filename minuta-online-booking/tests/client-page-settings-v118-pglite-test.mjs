import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const [migration, rollback] = await Promise.all([
  readFile(new URL('supabase-migration-v118.sql', root), 'utf8'),
  readFile(new URL('supabase-migration-v118-rollback.sql', root), 'utf8'),
]);
const moduleName = process.env.MINUTA_PGLITE_MODULE || '@electric-sql/pglite';
const moduleSpecifier = /^[A-Za-z]:[\\/]/.test(moduleName) ? pathToFileURL(moduleName).href : moduleName;
const { PGlite } = await import(moduleSpecifier);
const db = new PGlite();
const owner = '10000000-0000-0000-0000-000000000001';
const outsider = '10000000-0000-0000-0000-000000000002';
const organization = '20000000-0000-0000-0000-000000000001';

const scalar = async sql => {
  const result = await db.query(sql);
  return Object.values(result.rows[0] || {})[0];
};
const expectError = async (sql, message) => {
  await assert.rejects(() => db.exec(sql), error => String(error?.message || error).includes(message));
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
  await db.exec(migration);

  await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false); set role authenticated;`);
  const saved = await scalar(`select public.set_minuta_client_page_settings_v118('${organization}','noir-safari','care')`);
  assert.equal(saved.theme_key, 'noir-safari');
  const memberRead = await scalar(`select public.get_minuta_client_page_settings_v118('${organization}')`);
  assert.equal(memberRead.headline_key, 'care');
  await db.exec('reset role;');

  await db.exec(`update public.organization_memberships set role='admin' where organization_id='${organization}'; set role authenticated;`);
  await expectError(`select public.set_minuta_client_page_settings_v118('${organization}','sage','booking')`, 'organization_owner_required');
  await db.exec('reset role;');

  await db.exec(`select set_config('request.jwt.claim.sub','${outsider}',false); set role authenticated;`);
  await expectError(`select public.get_minuta_client_page_settings_v118('${organization}')`, 'organization_read_denied');
  await expectError(`select public.set_minuta_client_page_settings_v118('${organization}','sage','booking')`, 'organization_owner_required');
  await db.exec('reset role;');

  await db.exec('set role anon;');
  const publicCatalog = await scalar("select public.get_public_minuta_catalog_v5('tenant-a')");
  assert.deepEqual(publicCatalog.client_page, { theme_key:'noir-safari', headline_key:'care' });
  assert.deepEqual(Object.keys(publicCatalog.client_page).sort(), ['headline_key','theme_key']);
  await expectError('select * from public.organization_client_page_settings', 'permission denied');
  await db.exec('reset role;');

  await db.exec(rollback);
  assert.equal(await scalar("select to_regprocedure('public.get_public_minuta_catalog_v5(text)') is null"), true);
  assert.equal(await scalar(`select theme_key from public.organization_client_page_settings where organization_id='${organization}'`), 'noir-safari');
  await db.exec(migration);
  const reapplied = await scalar("select public.get_public_minuta_catalog_v5('tenant-a')");
  assert.equal(reapplied.client_page.theme_key, 'noir-safari');
  console.log('Client page v118 PGlite checks passed: tenant scope, grants, public shape, rollback and reapply.');
} finally {
  await db.close();
}
