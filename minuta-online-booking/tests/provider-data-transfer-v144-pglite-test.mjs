import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const [v95Source, v99Source, migrationSource, rollbackSource] = await Promise.all([
  readFile(new URL('supabase-migration-v95.sql', root), 'utf8'),
  readFile(new URL('supabase-migration-v99.sql', root), 'utf8'),
  readFile(new URL('supabase-migration-v144.sql', root), 'utf8'),
  readFile(new URL('supabase-migration-v144-rollback.sql', root), 'utf8'),
]);
const withoutPsqlMeta = source => source.split(/\r?\n/).filter(line => !line.trimStart().startsWith('\\')).join('\n');
const firstV95Commit = v95Source.indexOf('\ncommit;');
assert.ok(firstV95Commit > 0, 'v95 fixture boundary is missing');
const v95 = withoutPsqlMeta(v95Source.slice(0, firstV95Commit + '\ncommit;'.length));
const v99 = withoutPsqlMeta(v99Source);
const migration = withoutPsqlMeta(migrationSource);
const rollback = withoutPsqlMeta(rollbackSource);

const moduleName = process.env.MINUTA_PGLITE_MODULE || '@electric-sql/pglite';
const localModule = /^[A-Za-z]:[\\/]/.test(moduleName);
const moduleSpecifier = localModule ? pathToFileURL(moduleName).href : moduleName;
const pgcryptoSpecifier = localModule
  ? new URL('./contrib/pgcrypto.js', pathToFileURL(moduleName)).href
  : '@electric-sql/pglite/contrib/pgcrypto';
const { PGlite } = await import(moduleSpecifier);
const { pgcrypto } = await import(pgcryptoSpecifier);
const db = new PGlite({ extensions:{ pgcrypto } });

const owner = '10000000-0000-0000-0000-000000000001';
const admin = '10000000-0000-0000-0000-000000000002';
const outsider = '10000000-0000-0000-0000-000000000003';
const organization = '20000000-0000-0000-0000-000000000001';
const ids = {
  oldClient:'30000000-0000-0000-0000-000000000001',
  clientTransfer:'30000000-0000-0000-0000-000000000002',
  conflict:'30000000-0000-0000-0000-000000000003',
  history1:'30000000-0000-0000-0000-000000000004',
  history2:'30000000-0000-0000-0000-000000000005',
  recordBlock:'30000000-0000-0000-0000-000000000006',
  casBlock:'30000000-0000-0000-0000-000000000007',
  expiry:'30000000-0000-0000-0000-000000000008',
  expiryPurge:'30000000-0000-0000-0000-000000000009',
  retained:'30000000-0000-0000-0000-000000000010',
  stale:'30000000-0000-0000-0000-000000000011',
  actorBind:'30000000-0000-0000-0000-000000000012',
};

const json = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const scalar = async sql => {
  const result = await db.query(sql);
  return Object.values(result.rows[0] || {})[0];
};
const expectError = async (sql, message) => {
  await assert.rejects(() => db.exec(sql), error => String(error?.message || error).includes(message));
};
const become = async (user, role = 'authenticated') => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${user || ''}',false); set role ${role};`);
};
const resetRole = () => db.exec('reset role;');

const client = (phone, name, externalId, overrides = {}) => ({
  phone,display_phone:`+${phone}`,name,email:'',birthday:'',note:'',external_id:externalId,
  visit_count:1,total_spent_rub:100,last_visit_on:'2026-01-01',
  marketing_consent:null,personal_data_consent:null,...overrides
});
const history = (phone, name) => ({
  booking_date:'2026-01-15',booking_time:'10:00:00',duration_minutes:60,
  client_name:name,phone,display_phone:`+${phone}`,service_name:'Массаж',source_note:'',
  source_provider_name:'Мастер',price_rub:3000,source_sheet:'15.01.2026'
});

try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create schema extensions;
    create extension if not exists pgcrypto with schema extensions;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table auth.users(id uuid primary key);
    create table public.organizations(id uuid primary key,status text not null);
    create table public.organization_memberships(
      organization_id uuid not null references public.organizations(id),
      user_id uuid not null references auth.users(id),role text not null,active boolean not null default true,
      primary key(organization_id,user_id)
    );
    create table public.bookings(id uuid primary key,performer_id uuid,booking_date date,start_time time);
    create index bookings_performer_date_time_v94_idx on public.bookings(performer_id,booking_date,start_time);
    create function public.normalize_client_phone(p_value text) returns text language sql immutable set search_path='' as $$
      select case
        when regexp_replace(coalesce(p_value,''),'[^0-9]','','g') ~ '^8[0-9]{10}$'
          then '7'||substr(regexp_replace(p_value,'[^0-9]','','g'),2)
        when regexp_replace(coalesce(p_value,''),'[^0-9]','','g') ~ '^[0-9]{10}$'
          then '7'||regexp_replace(p_value,'[^0-9]','','g')
        when regexp_replace(coalesce(p_value,''),'[^0-9]','','g') ~ '^7[0-9]{10}$'
          then regexp_replace(p_value,'[^0-9]','','g')
        else null end
    $$;
    create function public.has_organization_role(p_organization uuid,p_roles text[]) returns boolean
      language sql stable security definer set search_path='' as $$
        select exists(select 1 from public.organization_memberships
          where organization_id=p_organization and user_id=auth.uid() and active and role=any(p_roles))
      $$;
    insert into auth.users values('${owner}'),('${admin}'),('${outsider}');
    insert into public.organizations values('${organization}','active');
    insert into public.organization_memberships values
      ('${organization}','${owner}','owner',true),('${organization}','${admin}','admin',true);
  `);
  await db.exec(v95);
  await db.exec(v99);
  await db.exec(`
    create table public.client_record_entries(
      id uuid primary key,organization_id uuid not null,client_phone text not null,archived boolean not null default false
    );
    create table public.minuta_personal_data_access_log(
      id bigint generated always as identity primary key,organization_id uuid not null,
      actor_user_id uuid,action text not null,subject_type text not null,subject_id text,
      details jsonb not null default '{}'::jsonb,created_at timestamptz not null default now()
    );
  `);
  await db.exec(migration);
  await db.exec(migration);

  await become(owner);
  await expectError(`select public.preview_minuta_provider_transfer_v144(
    '${organization}','clients','other',null::jsonb,'40000000-0000-0000-0000-000000000010',null)`,
    'invalid_provider_transfer_payload');
  await expectError(`select public.preview_minuta_provider_transfer_v144(
    '${organization}','clients','other',${json([client('79991112230','Ошибка','bad-date',{ birthday:'2999-01-01' })])},
    '40000000-0000-0000-0000-000000000011',null)`, 'invalid_provider_transfer_client');
  await expectError(`select public.preview_minuta_provider_transfer_v144(
    '${organization}','history','other',${json([history('79991112231','Ошибка')])},
    '40000000-0000-0000-0000-000000000012','bad\nname.xlsx')`, 'invalid_provider_transfer_source_file');
  const alice = client('79991112233','Анна','alice-1');
  await scalar(`select public.import_minuta_clients('${organization}','other',${json([alice])},'${ids.oldClient}')`);
  const bob = client('79992223344','Борис','bob-1');
  const preview = await scalar(`select public.preview_minuta_provider_transfer_v144(
    '${organization}','clients','other',${json([alice,bob])},'${ids.clientTransfer}',null)`);
  assert.equal(preview.status, 'previewed');
  assert.equal(preview.create_count, 1);
  assert.equal(preview.update_count, 0);
  assert.equal(preview.unchanged_count, 1);
  assert.equal(preview.conflict_count, 0);
  const applied = await scalar(`select public.apply_minuta_provider_transfer_v144('${organization}','${preview.batch_id}')`);
  assert.equal(applied.created_count, 1);
  assert.equal(applied.updated_count, 0);
  assert.equal(applied.unchanged_count, 1);
  const replay = await scalar(`select public.apply_minuta_provider_transfer_v144('${organization}','${preview.batch_id}')`);
  assert.equal(replay.idempotent, true);
  await resetRole();
  assert.equal(await scalar(`select count(*) from public.organization_imported_clients where organization_id='${organization}'`), 2);
  assert.equal(await scalar(`select count(*) from public.provider_data_transfer_changes where batch_id='${preview.batch_id}'`), 2);
  assert.equal(await scalar(`select staged_payload is null from public.provider_data_transfer_batches where id='${preview.batch_id}'`), true);
  await become(owner);
  const rolledBack = await scalar(`select public.rollback_minuta_provider_transfer_v144('${organization}','${preview.batch_id}')`);
  assert.equal(rolledBack.status, 'rolled_back');
  assert.equal((await scalar(`select public.rollback_minuta_provider_transfer_v144('${organization}','${preview.batch_id}')`)).idempotent, true);
  await resetRole();
  assert.equal(await scalar(`select count(*) from public.organization_imported_clients where normalized_phone='${bob.phone}'`), 0);
  assert.equal(await scalar(`select client_name from public.organization_imported_clients where normalized_phone='${alice.phone}'`), 'Анна');

  await become(owner);
  await expectError(`select public.preview_minuta_provider_transfer_v144(
    '${organization}','clients','other',${json([client(alice.phone,'Другая','alice-1')])},'${ids.clientTransfer}',null)`,
    'provider_transfer_request_conflict');
  const carol = client('79993334455','Карина','shared');
  await scalar(`select public.import_minuta_clients('${organization}','dikidi',${json([carol])},'40000000-0000-0000-0000-000000000001')`);
  const conflict = await scalar(`select public.preview_minuta_provider_transfer_v144(
    '${organization}','clients','dikidi',${json([client('79994445566','Дарья','shared')])},'${ids.conflict}',null)`);
  assert.equal(conflict.conflict_count, 1);
  await expectError(`select public.apply_minuta_provider_transfer_v144('${organization}','${conflict.batch_id}')`, 'provider_transfer_conflict');
  assert.equal((await scalar(`select public.rollback_minuta_provider_transfer_v144('${organization}','${conflict.batch_id}')`)).status, 'expired');

  const stalePhone = '79994445567';
  const stalePreview = await scalar(`select public.preview_minuta_provider_transfer_v144(
    '${organization}','clients','other',${json([client(stalePhone,'Из файла','stale-1')])},'${ids.stale}',null)`);
  await scalar(`select public.import_minuta_clients('${organization}','other',
    ${json([client(stalePhone,'Локальное изменение','stale-1')])},'40000000-0000-0000-0000-000000000003')`);
  const staleApply = await scalar(`select public.apply_minuta_provider_transfer_v144('${organization}','${stalePreview.batch_id}')`);
  assert.equal(staleApply.status, 'expired');
  assert.equal(staleApply.reason, 'target_changed');
  await resetRole();
  assert.equal(await scalar(`select client_name from public.organization_imported_clients where normalized_phone='${stalePhone}'`), 'Локальное изменение');

  await become(outsider);
  await expectError(`select public.preview_minuta_provider_transfer_v144(
    '${organization}','clients','other',${json([client('79995556677','Елена','e-1')])},
    '40000000-0000-0000-0000-000000000002',null)`, 'provider_transfer_manager_required');
  await expectError('select * from public.provider_data_transfer_batches', 'permission denied');

  await become(owner);
  const actorPreview = await scalar(`select public.preview_minuta_provider_transfer_v144(
    '${organization}','clients','other',${json([client('79995556678','Ёлка','actor-1')])},'${ids.actorBind}',null)`);
  await become(admin);
  await expectError(`select public.apply_minuta_provider_transfer_v144('${organization}','${actorPreview.batch_id}')`,
    'provider_transfer_batch_denied');
  await become(owner);
  await scalar(`select public.apply_minuta_provider_transfer_v144('${organization}','${actorPreview.batch_id}')`);
  await become(admin);
  assert.equal((await scalar(`select public.rollback_minuta_provider_transfer_v144('${organization}','${actorPreview.batch_id}')`)).status, 'rolled_back');
  await resetRole();
  assert.equal(await scalar(`select rolled_back_by='${admin}'::uuid from public.provider_data_transfer_batches where id='${actorPreview.batch_id}'`), true);

  await become(owner);
  const exportedPage = await scalar(`select public.export_minuta_provider_transfer_data_v144('${organization}','clients',1,0)`);
  assert.equal(exportedPage.rows.length, 1);
  assert.equal(exportedPage.has_more, true);
  assert.match(exportedPage.dataset_revision, /^[0-9a-f]{64}$/);
  await expectError(`select public.export_minuta_provider_transfer_data_v144('${organization}','clients',2,99999)`, 'invalid_provider_transfer_export_page');
  await resetRole();
  assert.equal(await scalar(`select count(*) from public.minuta_personal_data_access_log where action='export'`), 1);
  await become(admin);
  await expectError(`select public.export_minuta_provider_transfer_data_v144('${organization}','clients',10,0)`, 'provider_transfer_owner_required');

  await become(owner);
  const firstHistoryPreview = await scalar(`select public.preview_minuta_provider_transfer_v144(
    '${organization}','history','other',${json([history('79996667788','Ева')])},'${ids.history1}','journal.xlsx')`);
  assert.equal(firstHistoryPreview.create_count, 1);
  const firstHistoryApply = await scalar(`select public.apply_minuta_provider_transfer_v144('${organization}','${firstHistoryPreview.batch_id}')`);
  assert.equal(firstHistoryApply.created_count, 1);
  const secondHistoryPreview = await scalar(`select public.preview_minuta_provider_transfer_v144(
    '${organization}','history','other',${json([history('79996667788','Ева')])},'${ids.history2}','journal.xlsx')`);
  assert.equal(secondHistoryPreview.create_count, 0);
  assert.equal(secondHistoryPreview.unchanged_count, 1);
  const secondHistoryApply = await scalar(`select public.apply_minuta_provider_transfer_v144('${organization}','${secondHistoryPreview.batch_id}')`);
  assert.equal(secondHistoryApply.duplicate_count, 1);
  assert.equal((await scalar(`select public.rollback_minuta_provider_transfer_v144('${organization}','${secondHistoryPreview.batch_id}')`)).status, 'rolled_back');
  assert.equal((await scalar(`select public.rollback_minuta_provider_transfer_v144('${organization}','${firstHistoryPreview.batch_id}')`)).status, 'rolled_back');
  await resetRole();
  assert.equal(await scalar(`select count(*) from public.organization_imported_booking_history where normalized_phone='79996667788'`), 0);
  assert.equal(await scalar(`select count(*) from public.organization_imported_clients where normalized_phone='79996667788'`), 0);

  await become(owner);
  const recordPreview = await scalar(`select public.preview_minuta_provider_transfer_v144(
    '${organization}','clients','other',${json([client('79997778899','Фёдор','f-1')])},'${ids.recordBlock}',null)`);
  await scalar(`select public.apply_minuta_provider_transfer_v144('${organization}','${recordPreview.batch_id}')`);
  await resetRole();
  await db.exec(`insert into public.client_record_entries values(
    '50000000-0000-0000-0000-000000000001','${organization}','79997778899',true)`);
  await become(owner);
  await expectError(`select public.rollback_minuta_provider_transfer_v144('${organization}','${recordPreview.batch_id}')`,
    'provider_transfer_rollback_client_records_exist');
  await resetRole();
  await db.exec(`delete from public.client_record_entries where client_phone='79997778899'`);
  await become(owner);
  await scalar(`select public.rollback_minuta_provider_transfer_v144('${organization}','${recordPreview.batch_id}')`);

  const casPreview = await scalar(`select public.preview_minuta_provider_transfer_v144(
    '${organization}','clients','other',${json([client('79998889900','Галина','g-1',{ note:'исходно' })])},'${ids.casBlock}',null)`);
  await scalar(`select public.apply_minuta_provider_transfer_v144('${organization}','${casPreview.batch_id}')`);
  await resetRole();
  await db.exec(`update public.organization_imported_clients set note='изменено' where normalized_phone='79998889900'`);
  await become(owner);
  await expectError(`select public.rollback_minuta_provider_transfer_v144('${organization}','${casPreview.batch_id}')`,
    'provider_transfer_rollback_conflict');
  await resetRole();
  await db.exec(`update public.organization_imported_clients set note='исходно' where normalized_phone='79998889900'`);
  await become(owner);
  await scalar(`select public.rollback_minuta_provider_transfer_v144('${organization}','${casPreview.batch_id}')`);

  const expiryPreview = await scalar(`select public.preview_minuta_provider_transfer_v144(
    '${organization}','clients','other',${json([client('79990001122','Жанна','j-1')])},'${ids.expiry}',null)`);
  await resetRole();
  await db.exec(`update public.provider_data_transfer_batches set expires_at=now()-interval '1 second' where id='${expiryPreview.batch_id}'`);
  await become(owner);
  const expiredApply = await scalar(`select public.apply_minuta_provider_transfer_v144('${organization}','${expiryPreview.batch_id}')`);
  assert.equal(expiredApply.status, 'expired');
  await resetRole();
  assert.equal(await scalar(`select staged_payload is null from public.provider_data_transfer_batches where id='${expiryPreview.batch_id}'`), true);

  await become(owner);
  const purgePreview = await scalar(`select public.preview_minuta_provider_transfer_v144(
    '${organization}','clients','other',${json([client('79990001123','Жанна 2','j-2')])},'${ids.expiryPurge}',null)`);
  await resetRole();
  await db.exec(`update public.provider_data_transfer_batches set expires_at=now()-interval '1 second' where id='${purgePreview.batch_id}'`);
  await become('', 'service_role');
  assert.equal(await scalar('select public.purge_expired_minuta_provider_transfer_previews_v144(10)'), 1);
  await resetRole();
  assert.equal(await scalar(`select status from public.provider_data_transfer_batches where id='${purgePreview.batch_id}'`), 'expired');
  assert.equal(await scalar(`select staged_payload is null from public.provider_data_transfer_batches where id='${purgePreview.batch_id}'`), true);

  await become(owner);
  const retainedPreview = await scalar(`select public.preview_minuta_provider_transfer_v144(
    '${organization}','clients','other',${json([client('79990002233','Зоя','z-1')])},'${ids.retained}',null)`);
  await scalar(`select public.apply_minuta_provider_transfer_v144('${organization}','${retainedPreview.batch_id}')`);
  await resetRole();
  await db.exec(rollback);
  assert.equal(await scalar("select to_regprocedure('public.preview_minuta_provider_transfer_v144(uuid,text,text,jsonb,uuid,text)') is null"), true);
  assert.equal(await scalar(`select count(*) from public.provider_data_transfer_batches where id='${retainedPreview.batch_id}'`), 1);
  assert.equal(await scalar(`select count(*) from public.organization_imported_clients where normalized_phone='79990002233'`), 1);
  await db.exec(migration);
  await become(owner);
  const retainedJournal = await scalar(`select public.get_minuta_provider_transfer_journal_v144('${organization}',50)`);
  assert.ok(retainedJournal.batches.some(batch => batch.id === retainedPreview.batch_id && batch.status === 'applied'));

  console.log('Provider data transfer v144 PGlite checks passed: preview, apply, replay, journal, exact rollback, conflicts, export, expiry and reapply.');
} finally {
  await db.close();
}
