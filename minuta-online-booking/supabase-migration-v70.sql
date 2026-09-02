begin;

do $$
begin
  if to_regclass('public.performer_profiles') is null then
    raise exception using errcode = 'P0001', message = 'v70_requires_performer_profiles';
  end if;
end $$;

create table if not exists public.client_avatars (
  performer_id uuid not null references public.performer_profiles(id) on delete cascade,
  client_phone text not null check (client_phone ~ '^[0-9]{10,15}$'),
  storage_path text not null unique,
  width integer not null check (width > 0 and width <= 1024),
  height integer not null check (height > 0 and height <= 1024),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (performer_id, client_phone),
  constraint client_avatars_storage_path_scope_check
    check (storage_path = performer_id::text || '/' || client_phone || '/avatar.webp')
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.client_avatars'::regclass
      and conname = 'client_avatars_storage_path_scope_check'
  ) then
    alter table public.client_avatars
      add constraint client_avatars_storage_path_scope_check
      check (storage_path = performer_id::text || '/' || client_phone || '/avatar.webp');
  end if;
end $$;

drop trigger if exists client_avatars_touch_updated_at on public.client_avatars;
create trigger client_avatars_touch_updated_at before update on public.client_avatars
for each row execute function public.touch_minuta_updated_at();

alter table public.client_avatars enable row level security;

drop policy if exists client_avatars_owner_all on public.client_avatars;
create policy client_avatars_owner_all on public.client_avatars
  for all to authenticated
  using (performer_id = auth.uid())
  with check (performer_id = auth.uid());

revoke all on table public.client_avatars from anon;
grant select, insert, update, delete on table public.client_avatars to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-avatars',
  'client-avatars',
  false,
  2097152,
  array['image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists client_avatar_objects_owner_select on storage.objects;
create policy client_avatar_objects_owner_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'client-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists client_avatar_objects_owner_insert on storage.objects;
create policy client_avatar_objects_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'client-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists client_avatar_objects_owner_update on storage.objects;
create policy client_avatar_objects_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'client-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'client-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists client_avatar_objects_owner_delete on storage.objects;
create policy client_avatar_objects_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'client-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

do $$
begin
  alter publication supabase_realtime add table public.client_avatars;
exception when duplicate_object then null;
end $$;

commit;
