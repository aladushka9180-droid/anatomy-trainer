\set ON_ERROR_STOP on

begin;
select pg_advisory_xact_lock(hashtextextended('minuta-demo-statistics', 0));

do $$
declare
  v_org constant uuid := 'd3500000-0000-4000-8000-000000000001';
  v_row record;
begin
  if exists (
    select 1
    from public.organizations
    where id = v_org
      and (name <> 'Minuta Demo — статистика [demo_statistics]'
        or public_slug <> 'minuta-demo-statistics')
  ) then
    raise exception using errcode = 'P0001', message = 'demo_organization_id_collision';
  end if;

  if exists (
    select 1
    from auth.users
    where id::text like 'd3500000-0000-4000-8000-0000000001__'
      and email not like 'demo.statistics.%@example.invalid'
  ) then
    raise exception using errcode = 'P0001', message = 'demo_user_id_collision';
  end if;

  set local session_replication_role = replica;

  for v_row in
    select quote_ident(table_schema) || '.' || quote_ident(table_name) as relation_name
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.column_name = 'booking_id'
      and column_row.table_name <> 'bookings'
      and exists (
        select 1 from information_schema.tables table_row
        where table_row.table_schema = column_row.table_schema
          and table_row.table_name = column_row.table_name
          and table_row.table_type = 'BASE TABLE'
      )
  loop
    execute format(
      'delete from %s where booking_id in (select id from public.bookings where organization_id = %L::uuid)',
      v_row.relation_name, v_org
    );
  end loop;

  for v_row in
    select quote_ident(table_schema) || '.' || quote_ident(table_name) as relation_name
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.column_name = 'service_id'
      and column_row.table_name <> 'services'
      and exists (
        select 1 from information_schema.tables table_row
        where table_row.table_schema = column_row.table_schema
          and table_row.table_name = column_row.table_name
          and table_row.table_type = 'BASE TABLE'
      )
  loop
    execute format(
      'delete from %s where service_id in (select id from public.services where performer_id::text like %L)',
      v_row.relation_name, 'd3500000-0000-4000-8000-0000000001__'
    );
  end loop;

  for v_row in
    select quote_ident(table_schema) || '.' || quote_ident(table_name) as relation_name
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.column_name = 'performer_id'
      and exists (
        select 1 from information_schema.tables table_row
        where table_row.table_schema = column_row.table_schema
          and table_row.table_name = column_row.table_name
          and table_row.table_type = 'BASE TABLE'
      )
  loop
    execute format(
      'delete from %s where performer_id::text like %L',
      v_row.relation_name, 'd3500000-0000-4000-8000-0000000001__'
    );
  end loop;

  for v_row in
    select quote_ident(table_schema) || '.' || quote_ident(table_name) as relation_name
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.column_name = 'organization_id'
      and exists (
        select 1 from information_schema.tables table_row
        where table_row.table_schema = column_row.table_schema
          and table_row.table_name = column_row.table_name
          and table_row.table_type = 'BASE TABLE'
      )
  loop
    execute format('delete from %s where organization_id = %L::uuid', v_row.relation_name, v_org);
  end loop;

  delete from public.organizations where id = v_org;
  delete from public.performer_profiles
  where id::text like 'd3500000-0000-4000-8000-0000000001__';
  delete from auth.users
  where id::text like 'd3500000-0000-4000-8000-0000000001__'
    and email like 'demo.statistics.%@example.invalid';

  set local session_replication_role = origin;
end $$;

commit;
