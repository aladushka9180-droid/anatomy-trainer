\set ON_ERROR_STOP on
begin;
set local lock_timeout='5s';
do $$ begin
  if exists(select 1 from public.product_feedback where client_request_id is not null)
     or exists(select 1 from public.product_feedback_attachments)
     or exists(select 1 from public.product_feedback_replies)
     or exists(select 1 from storage.objects where bucket_id='product-feedback-media') then
    raise exception 'v111_rollback_blocked_preserve_feedback_and_files';
  end if;
end $$;
drop function if exists public.list_my_minuta_feedback();
drop function if exists public.create_minuta_feedback_media(uuid,text,text,text,text,text,text,uuid,jsonb);
drop function if exists public.get_my_minuta_feedback_request(uuid);
drop function if exists public.get_minuta_feedback_media_capability();
drop policy if exists product_feedback_media_insert on storage.objects;
drop policy if exists product_feedback_media_select on storage.objects;
drop function if exists public.can_upload_minuta_feedback_media();
drop table if exists public.product_feedback_replies;
drop table if exists public.product_feedback_attachments;
drop index if exists public.product_feedback_actor_request_idx;
alter table public.product_feedback drop column if exists client_request_id;
-- Empty private bucket is intentionally retained: do not delete Storage rows via SQL.
notify pgrst,'reload schema';
commit;
