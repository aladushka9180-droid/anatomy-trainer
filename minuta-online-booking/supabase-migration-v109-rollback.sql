\set ON_ERROR_STOP on

begin;

do $$ begin
  if to_regclass('public.product_feedback') is not null
     and exists(select 1 from public.product_feedback limit 1) then
    raise exception using errcode='P0001',message='v109_rollback_blocked_feedback_exists';
  end if;
  if exists(select 1 from storage.objects where bucket_id='product-feedback' limit 1) then
    raise exception using errcode='P0001',message='v109_rollback_blocked_screenshots_exist';
  end if;
end $$;

drop function if exists public.create_minuta_feedback(uuid,text,text,text,text,text,text,text);
drop function if exists public.get_minuta_feedback_capability();

drop policy if exists product_feedback_objects_owner_delete on storage.objects;
drop policy if exists product_feedback_objects_owner_select on storage.objects;
drop policy if exists product_feedback_objects_owner_insert on storage.objects;
delete from storage.buckets where id='product-feedback';
drop table if exists public.product_feedback;

notify pgrst,'reload schema';
commit;
