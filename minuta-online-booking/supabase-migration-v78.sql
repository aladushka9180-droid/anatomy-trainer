begin;

do $$
begin
  if to_regclass('public.services') is null then
    raise exception using errcode = 'P0001', message = 'v77_requires_services';
  end if;
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception using errcode = 'P0001', message = 'v77_requires_supabase_realtime';
  end if;
end;
$$;

alter table public.services replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'services'
  ) then
    execute 'alter publication supabase_realtime add table public.services';
  end if;
end;
$$;

commit;
