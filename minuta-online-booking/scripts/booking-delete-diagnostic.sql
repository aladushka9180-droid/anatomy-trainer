-- Read-only, single-booking diagnostics. The caller must start a READ ONLY
-- transaction and set eldion.diagnostic_booking to the requested UUID.
-- No booking RPC is called; output contains counts/schema, never client data.
do $diagnostic$
declare
  v_booking uuid := nullif(current_setting('eldion.diagnostic_booking', true), '')::uuid;
  v_root record;
  v_fk record;
  v_trigger record;
  v_count bigint;
  v_join text;
begin
  if current_setting('transaction_read_only') <> 'on' then
    raise exception 'booking_delete_diagnostic_requires_read_only';
  end if;
  if v_booking is null then
    raise exception 'booking_delete_diagnostic_requires_booking';
  end if;
  select count(*) into v_count from public.bookings where id = v_booking;
  raise notice 'booking_delete_diagnostic %', jsonb_build_object('kind','target','matchingRows',v_count);
  if v_count <> 1 then return; end if;

  -- v64 explicitly deletes payments and their events before deleting bookings.
  -- Inspect both incoming booking links and links to those payments.
  for v_root in
    select * from (values
      (to_regclass('public.bookings'), 'parent.id = $1'),
      (to_regclass('public.payments'), 'parent.booking_id = $1')
    ) roots(relation, predicate) where relation is not null
  loop
    for v_fk in
      select constraint_row.*, namespace.nspname as child_schema,
             class.relname as child_table
      from pg_constraint constraint_row
      join pg_class class on class.oid = constraint_row.conrelid
      join pg_namespace namespace on namespace.oid = class.relnamespace
      where constraint_row.contype = 'f' and constraint_row.confrelid = v_root.relation
      order by namespace.nspname, class.relname, constraint_row.conname
    loop
      select string_agg(format('child.%I = parent.%I', child_column.attname, parent_column.attname), ' and ' order by keys.ordinality)
      into v_join
      from unnest(v_fk.conkey, v_fk.confkey) with ordinality keys(child_key, parent_key, ordinality)
      join pg_attribute child_column on child_column.attrelid = v_fk.conrelid and child_column.attnum = keys.child_key
      join pg_attribute parent_column on parent_column.attrelid = v_fk.confrelid and parent_column.attnum = keys.parent_key;
      execute format('select count(*) from %I.%I child join %s parent on %s where %s',
        v_fk.child_schema, v_fk.child_table, v_root.relation, v_join, v_root.predicate)
        into v_count using v_booking;
      raise notice 'booking_delete_diagnostic %', jsonb_build_object(
        'kind','foreign_key', 'parent',v_root.relation::text,
        'table',v_fk.child_schema || '.' || v_fk.child_table, 'constraint',v_fk.conname,
        'definition',pg_get_constraintdef(v_fk.oid), 'matchingRows',v_count);
      if v_count > 0 then
        for v_trigger in
          select tgname, pg_get_triggerdef(oid) as definition
          from pg_trigger where tgrelid = v_fk.conrelid and not tgisinternal
            and (tgtype & 24) <> 0
          order by tgname
        loop
          raise notice 'booking_delete_diagnostic %', jsonb_build_object(
            'kind','linked_table_trigger','table',v_fk.child_schema || '.' || v_fk.child_table,
            'name',v_trigger.tgname,'definition',v_trigger.definition);
        end loop;
      end if;
    end loop;
  end loop;
end
$diagnostic$;

select jsonb_build_object('kind','delete_rpc','definition',pg_get_functiondef(oid),
  'authenticatedCanExecute',has_function_privilege('authenticated',oid,'EXECUTE'),
  'owner',pg_get_userbyid(proowner),
  'ownerBypassRls',(select rolbypassrls from pg_roles where oid = proowner),
  'ownerSuperuser',(select rolsuper from pg_roles where oid = proowner))
from pg_proc where oid = to_regprocedure('public.provider_delete_booking(uuid)');

select jsonb_build_object('kind','table_security','table',oid::regclass::text,
  'rowSecurity',relrowsecurity,'forceRowSecurity',relforcerowsecurity,
  'owner',pg_get_userbyid(relowner))
from pg_class
where oid in (to_regclass('public.bookings'),to_regclass('public.payments'),to_regclass('public.payment_events'))
order by oid::regclass::text;

select jsonb_build_object('kind','delete_trigger','table',tgrelid::regclass::text,
  'definition',pg_get_triggerdef(oid),'enabled',tgenabled)
from pg_trigger
where tgrelid in (to_regclass('public.bookings'),to_regclass('public.payments'),to_regclass('public.payment_events'))
  and not tgisinternal and (tgtype & 8) <> 0
order by tgrelid::regclass::text,tgname;
