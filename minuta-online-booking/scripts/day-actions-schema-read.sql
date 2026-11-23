-- Metadata only: never invokes application routines or reads customer rows.
begin read only;
select jsonb_build_object(
  'version', 1,
  'functions', (select jsonb_agg(jsonb_build_object('name', p.proname, 'identity', p.oid::regprocedure::text,
    'definition', pg_get_functiondef(p.oid)) order by p.oid::regprocedure::text)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('get_available_slots','get_available_slots_v101','book_appointment')),
  'tables', (select jsonb_agg(jsonb_build_object('name', c.relname,
    'columns', (select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) order by a.attnum)
      from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
    'constraints', (select jsonb_agg(pg_get_constraintdef(k.oid) order by k.conname) from pg_constraint k where k.conrelid=c.oid),
    'triggers', (select jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)) order by c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
      and c.relname in ('bookings','provider_schedule','provider_days_off','services'))
);
rollback;
