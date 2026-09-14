-- Roll back v159 only while no service details or media exist.
begin;
do $$ begin
  if to_regclass('public.service_public_details_v159') is null then
    raise exception using errcode='55000',message='v159_rollback_requires_exact_schema';
  end if;
  if exists(select 1 from public.service_public_details_v159) or exists(select 1 from storage.objects where bucket_id='service-images') then
    raise exception using errcode='55000',message='v159_rollback_blocked_service_content_exists';
  end if;
end $$;
drop policy if exists service_images_read_v159 on storage.objects;
drop policy if exists service_images_delete_v159 on storage.objects;
drop policy if exists service_images_update_v159 on storage.objects;
drop policy if exists service_images_insert_v159 on storage.objects;
delete from storage.buckets where id='service-images';
drop function public.get_public_service_reviews_v159(uuid);
drop function public.get_public_service_cards_v159(uuid[]);
drop function public.save_minuta_service_v159(uuid,text,integer,integer,boolean,text,text[],text,text,text,integer,integer);
drop function public.get_minuta_service_public_details_v159(uuid);
drop function public.minuta_service_image_is_public_v159(text);
drop table public.service_public_details_v159;
drop function public.minuta_service_highlights_valid_v159(text[]);
commit;
