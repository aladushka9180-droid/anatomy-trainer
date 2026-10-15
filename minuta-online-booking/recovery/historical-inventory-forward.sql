-- Candidate only. The release owner must qualify a fresh protected full backup,
-- isolated restore, rollback, target and current definitions before production.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare
  r record;
  v_oid oid;
  v_body text;
  v_original text;
  v_new text;
  v_definition text;
  v_handler text:=$handler$
-- historical-inventory-v1:handler:start
exception when sqlstate '55000' then
  -- This outer exception block rolls back ALL attempted stock deductions first.
  if sqlerrm<>'insufficient_inventory_stock_for_completed_visit'
     or v_booking.id is null or auth.uid() is null
     or coalesce(v_booking.booking_policy_snapshot->>'historical','')<>'true'
     or not exists(
       select 1 from public.organization_memberships member
       join public.organizations organization on organization.id=member.organization_id and organization.status='active'
       join public.locations location on location.id=v_booking.location_id and location.organization_id=member.organization_id and location.active
       where member.organization_id=v_booking.organization_id and member.user_id=auth.uid() and member.active
         and (member.role in ('owner','admin') or (member.role='specialist' and v_booking.performer_id=auth.uid()))
         and v_booking.duration_minutes between 1 and 480
         and v_booking.booking_date+v_booking.booking_time+make_interval(mins=>v_booking.duration_minutes)<=timezone(location.timezone,now())
     ) then raise; end if;
  update public.bookings set booking_policy_snapshot=coalesce(booking_policy_snapshot,'{}'::jsonb)
    ||jsonb_build_object('historical_inventory_unconsumed',true) where id=p_booking;
  perform public.write_minuta_inventory_audit(v_booking.organization_id,'inventory_historical_not_deducted',p_booking,
    jsonb_build_object('reason','insufficient_stock'));
-- historical-inventory-v1:handler:end
$handler$;
  v_clear text:=$clear$  -- historical-inventory-v1:clear:start
  update public.bookings set booking_policy_snapshot=booking_policy_snapshot-'historical_inventory_unconsumed'
    where id=p_booking and booking_policy_snapshot->'historical_inventory_unconsumed'='true'::jsonb;
  -- historical-inventory-v1:clear:end
$clear$;
  v_ack text:=$ack$
    /*historical-inventory-v1:ack*/ , 'materials_not_deducted',coalesce((select booking_policy_snapshot->'historical_inventory_unconsumed'='true'::jsonb from public.bookings where id=v_booking),false) /*historical-inventory-v1:ack:end*/$ack$;
  v_anchor text:='''calculated_amount_rub'',(v_outcome->>''calculated_amount_rub'')::integer';
begin
  perform pg_advisory_xact_lock(98014516);
  for r in select * from (values
    ('public.consume_minuta_inventory_for_booking(uuid)','4ce8a73e07e108bcd45db5a4f7b993b3'),
    ('public.create_minuta_historical_booking(uuid,uuid,date,time without time zone,text,text,integer,text,integer)','1dd789f8679b772cc5df5c2049eab05e')
  ) as expected(signature,body_md5) loop
    v_oid:=to_regprocedure(r.signature)::oid;
    if v_oid is null then raise exception 'historical_inventory_prerequisite_missing'; end if;
    select prosrc,pg_get_functiondef(oid) into v_body,v_definition from pg_catalog.pg_proc where oid=v_oid;
    v_original:=regexp_replace(v_body,'(?s)\n-- historical-inventory-v1:handler:start\n.*?-- historical-inventory-v1:handler:end\n',E'\n');
    v_original:=regexp_replace(v_original,'(?s)  -- historical-inventory-v1:clear:start\n.*?  -- historical-inventory-v1:clear:end\n','');
    v_original:=regexp_replace(v_original,'(?s)\n    /\*historical-inventory-v1:ack\*/.*?/\*historical-inventory-v1:ack:end\*/','');
    if md5(v_original)<>r.body_md5 then raise exception 'historical_inventory_unknown_definition'; end if;
    if r.signature like '%consume_minuta_inventory%' then
      v_new:=regexp_replace(v_original,E'\nend[[:space:]]*$',v_handler||E'end ');
      v_new:=replace(v_new,'  perform public.write_minuta_inventory_audit(v_booking.organization_id,''inventory_booking_consumed'',p_booking,',
        v_clear||'  perform public.write_minuta_inventory_audit(v_booking.organization_id,''inventory_booking_consumed'',p_booking,');
    else
      v_new:=replace(v_original,v_anchor,v_anchor||v_ack);
    end if;
    if v_new=v_original then raise exception 'historical_inventory_patch_not_applied'; end if;
    if v_body=v_new then continue; end if;
    if v_body<>v_original then raise exception 'historical_inventory_partial_patch'; end if;
    -- Replace only the guarded body; CREATE OR REPLACE retains owner and ACL.
    execute replace(v_definition,v_body,v_new);
  end loop;
end;
$patch$;
notify pgrst,'reload schema';
commit;
