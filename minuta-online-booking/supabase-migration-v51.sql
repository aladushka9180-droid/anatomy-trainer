begin;

alter table public.client_labels
  add column if not exists favorite_note text not null default '',
  add column if not exists vip_note text not null default '';

alter table public.client_labels
  drop constraint if exists client_labels_favorite_note_length_check;
alter table public.client_labels
  add constraint client_labels_favorite_note_length_check
  check (char_length(favorite_note) <= 500);

alter table public.client_labels
  drop constraint if exists client_labels_vip_note_length_check;
alter table public.client_labels
  add constraint client_labels_vip_note_length_check
  check (char_length(vip_note) <= 500);

commit;
