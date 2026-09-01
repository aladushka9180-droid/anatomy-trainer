begin;

create table if not exists public.client_labels (
  performer_id uuid not null references auth.users(id) on delete cascade,
  client_phone text not null,
  favorite boolean not null default false,
  vip boolean not null default false,
  attention boolean not null default false,
  attention_reason text not null default '',
  updated_at timestamptz not null default now(),
  primary key (performer_id, client_phone),
  constraint client_labels_phone_check check (client_phone ~ '^[0-9]{10,15}$'),
  constraint client_labels_reason_length_check check (char_length(attention_reason) <= 500),
  constraint client_labels_attention_reason_check check (not attention or char_length(btrim(attention_reason)) >= 3)
);

alter table public.client_labels enable row level security;

drop policy if exists client_labels_owner_all on public.client_labels;
create policy client_labels_owner_all on public.client_labels
for all to authenticated
using (performer_id = (select auth.uid()))
with check (performer_id = (select auth.uid()));

revoke all on table public.client_labels from anon;
grant select, insert, update, delete on table public.client_labels to authenticated;

commit;
