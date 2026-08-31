begin;

-- Portfolio metadata stays in Postgres; image bytes stay in a private Storage bucket.
create table if not exists public.portfolio_items (
  id uuid primary key default gen_random_uuid(),
  performer_id uuid not null references public.performer_profiles(id) on delete cascade,
  procedure_name text not null check (char_length(trim(procedure_name)) between 2 and 120),
  body_area text not null default '' check (char_length(body_area) <= 120),
  session_count integer check (session_count between 1 and 999),
  description text not null default '' check (char_length(description) <= 1200),
  sort_order integer not null default 0,
  published boolean not null default false,
  consent_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, performer_id),
  constraint portfolio_publication_requires_consent
    check (not published or consent_confirmed_at is not null)
);

create table if not exists public.portfolio_photos (
  id uuid primary key default gen_random_uuid(),
  portfolio_item_id uuid not null,
  performer_id uuid not null references public.performer_profiles(id) on delete cascade,
  photo_type text not null check (photo_type in ('before', 'after')),
  storage_path text not null unique,
  alt_text text not null default '' check (char_length(alt_text) <= 240),
  width integer check (width > 0 and width <= 12000),
  height integer check (height > 0 and height <= 12000),
  created_at timestamptz not null default now(),
  unique (portfolio_item_id, photo_type),
  foreign key (portfolio_item_id, performer_id)
    references public.portfolio_items(id, performer_id) on delete cascade
);

create index if not exists idx_portfolio_items_public
  on public.portfolio_items (published, sort_order, created_at);
create index if not exists idx_portfolio_items_owner
  on public.portfolio_items (performer_id, sort_order, created_at);
create index if not exists idx_portfolio_photos_item
  on public.portfolio_photos (portfolio_item_id, photo_type);

drop trigger if exists portfolio_items_touch_updated_at on public.portfolio_items;
create trigger portfolio_items_touch_updated_at before update on public.portfolio_items
for each row execute function public.touch_minuta_updated_at();

alter table public.portfolio_items enable row level security;
alter table public.portfolio_photos enable row level security;

drop policy if exists portfolio_items_owner_all on public.portfolio_items;
create policy portfolio_items_owner_all on public.portfolio_items
  for all to authenticated
  using (performer_id = auth.uid())
  with check (performer_id = auth.uid());

drop policy if exists portfolio_items_public_read on public.portfolio_items;
create policy portfolio_items_public_read on public.portfolio_items
  for select to anon, authenticated
  using (published and consent_confirmed_at is not null);

drop policy if exists portfolio_photos_owner_all on public.portfolio_photos;
create policy portfolio_photos_owner_all on public.portfolio_photos
  for all to authenticated
  using (performer_id = auth.uid())
  with check (
    performer_id = auth.uid()
    and exists (
      select 1 from public.portfolio_items item
      where item.id = portfolio_item_id and item.performer_id = auth.uid()
    )
  );

drop policy if exists portfolio_photos_public_read on public.portfolio_photos;
create policy portfolio_photos_public_read on public.portfolio_photos
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.portfolio_items item
      where item.id = portfolio_item_id
        and item.published
        and item.consent_confirmed_at is not null
    )
  );

grant select on public.portfolio_items, public.portfolio_photos to anon;
grant select, insert, update, delete on public.portfolio_items, public.portfolio_photos to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'portfolio-images',
  'portfolio-images',
  false,
  8388608,
  array['image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists portfolio_objects_owner_select on storage.objects;
create policy portfolio_objects_owner_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'portfolio-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists portfolio_objects_owner_insert on storage.objects;
create policy portfolio_objects_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'portfolio-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists portfolio_objects_owner_update on storage.objects;
create policy portfolio_objects_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'portfolio-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'portfolio-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists portfolio_objects_owner_delete on storage.objects;
create policy portfolio_objects_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'portfolio-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists portfolio_objects_public_select on storage.objects;
create policy portfolio_objects_public_select on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'portfolio-images'
    and exists (
      select 1
      from public.portfolio_photos photo
      join public.portfolio_items item on item.id = photo.portfolio_item_id
      where photo.storage_path = name
        and item.published
        and item.consent_confirmed_at is not null
    )
  );

create or replace function public.reorder_portfolio_items(p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path to 'public', 'pg_catalog'
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  if coalesce(cardinality(p_ids), 0) = 0 then return; end if;

  if cardinality(p_ids) <> (select count(distinct value) from unnest(p_ids) as value) then
    raise exception using errcode = 'P0001', message = 'duplicate_portfolio_id';
  end if;

  if exists (
    select 1 from unnest(p_ids) as requested(id)
    left join public.portfolio_items item
      on item.id = requested.id and item.performer_id = auth.uid()
    where item.id is null
  ) then
    raise exception using errcode = '42501', message = 'portfolio_item_forbidden';
  end if;

  update public.portfolio_items item
  set sort_order = ordered.position * 10,
      updated_at = now()
  from unnest(p_ids) with ordinality as ordered(id, position)
  where item.id = ordered.id and item.performer_id = auth.uid();
end;
$$;

revoke all on function public.reorder_portfolio_items(uuid[]) from public;
grant execute on function public.reorder_portfolio_items(uuid[]) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.portfolio_items;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.portfolio_photos;
exception when duplicate_object then null;
end $$;

commit;
