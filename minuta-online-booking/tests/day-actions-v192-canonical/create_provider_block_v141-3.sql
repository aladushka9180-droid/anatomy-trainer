CREATE OR REPLACE FUNCTION public.create_provider_block_v141(p_organization uuid, p_location uuid, p_date date, p_time time without time zone, p_duration integer, p_request_id uuid, p_title text DEFAULT 'Перерыв'::text, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid(); v_existing public.bookings%rowtype; v_service uuid; v_code text;
  v_previous_org text:=current_setting('minuta.booking_organization',true);
  v_previous_location text:=current_setting('minuta.booking_location',true);
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_request_id is null or p_organization is null or p_location is null or p_date is null or p_time is null
     or p_duration is null or p_duration not between 1 and 480
     or char_length(trim(coalesce(p_title,''))) not between 2 and 80 or char_length(coalesce(p_note,''))>1000 then
    raise exception using errcode='22023',message='invalid_block_payload';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,14102));
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text||p_date::text,0));
  if not pg_try_advisory_xact_lock(hashtextextended(p_organization::text,7100)) then
    raise exception using errcode='40001',message='block_schedule_changed';
  end if;
  select * into v_existing from public.bookings where id=p_request_id;
  if found then
    if v_existing.performer_id<>v_actor or v_existing.organization_id<>p_organization or v_existing.location_id<>p_location
       or v_existing.booking_date<>p_date or v_existing.booking_time<>p_time or v_existing.duration_minutes<>p_duration
       or v_existing.client_phone<>'0000000000' or v_existing.client_name<>trim(p_title)
       or coalesce(v_existing.provider_note,'')<>coalesce(p_note,'') or v_existing.status='cancelled' then
      raise exception using errcode='23505',message='block_request_conflict';
    end if;
    return jsonb_build_object('booking_id',v_existing.id,'booking_code',v_existing.booking_code,
      'duration_minutes',v_existing.duration_minutes,'replayed',true,'payment_required',false,'notifications_suppressed',true);
  end if;
  if not public.minuta_block_slot_valid_v141(p_organization,p_location,p_date,p_time,p_duration,null) then
    raise exception using errcode='23P01',message='block_slot_unavailable';
  end if;
  v_service:=public.ensure_minuta_block_service_v141();
  v_code:='MIN-'||upper(substr(encode(extensions.gen_random_bytes(6),'hex'),1,10));
  perform set_config('minuta.booking_organization',p_organization::text,true);
  perform set_config('minuta.booking_location',p_location::text,true);
  insert into public.bookings(id,booking_code,manage_token,performer_id,service_id,client_name,client_phone,
    booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,status,deposit_amount_rub,payment_status,payment_url,provider_note)
  values(p_request_id,v_code,extensions.gen_random_uuid(),v_actor,v_service,trim(p_title),'0000000000',
    p_date,p_time,p_duration,0,0,'new',0,'not_required','',p_note);
  update public.bookings set original_price_rub=0,total_price_rub=0,deposit_amount_rub=0,payment_status='not_required',
    payment_url='',payment_due_at=null,expired_unpaid_at=null,refund_status='not_required',
    booking_policy_snapshot=coalesce(booking_policy_snapshot,'{}'::jsonb)||jsonb_build_object('schedule_block',true,'payment_suppressed',true)
  where id=p_request_id;
  delete from public.notification_outbox where booking_id=p_request_id;
  perform set_config('minuta.booking_organization',coalesce(v_previous_org,''),true);
  perform set_config('minuta.booking_location',coalesce(v_previous_location,''),true);
  return jsonb_build_object('booking_id',p_request_id,'booking_code',v_code,'duration_minutes',p_duration,
    'payment_required',false,'notifications_suppressed',true);
exception when others then
  perform set_config('minuta.booking_organization',coalesce(v_previous_org,''),true);
  perform set_config('minuta.booking_location',coalesce(v_previous_location,''),true);
  raise;
end $function$
