-- Included twice by report-export-owner-scope-full-schema.sql.
do $owner_checks$
declare all_rows jsonb; branch_rows jsonb; other_branch_rows jsonb; imported jsonb; none_rows jsonb;
  old_report jsonb; team jsonb; events jsonb; baseline record; matched_key text;
begin
  perform set_config('request.jwt.claim.sub',current_setting('export_probe.owner'),true);
  select * into baseline from pg_temp.export_probe_baseline;
  all_rows:=public.get_minuta_report_export_bookings(current_setting('export_probe.org')::uuid,
    current_setting('export_probe.date')::date,current_setting('export_probe.date')::date,null,null,'full',100,0);
  imported:=public.get_minuta_report_export_imported_history(current_setting('export_probe.org')::uuid,
    current_setting('export_probe.date')::date,current_setting('export_probe.date')::date,null,null,'full',100,0);
  branch_rows:=public.get_minuta_report_export_bookings(current_setting('export_probe.org')::uuid,
    current_setting('export_probe.date')::date,current_setting('export_probe.date')::date,null,
    current_setting('export_probe.loc_a')::uuid,'masked',100,0);
  other_branch_rows:=public.get_minuta_report_export_bookings(current_setting('export_probe.org')::uuid,
    current_setting('export_probe.date')::date,current_setting('export_probe.date')::date,null,
    current_setting('export_probe.loc_b')::uuid,'masked',100,0);
  none_rows:=public.get_minuta_report_export_bookings(current_setting('export_probe.org')::uuid,
    current_setting('export_probe.date')::date,current_setting('export_probe.date')::date,null,null,'none',100,0);
  if all_rows->>'organization_id'<>current_setting('export_probe.org')
    or all_rows->>'phone_mode'<>'full' or jsonb_array_length(all_rows->'bookings')<>2
    or jsonb_array_length(imported->'bookings')<>1
    or jsonb_array_length(branch_rows->'bookings')<>1
    or jsonb_array_length(other_branch_rows->'bookings')<>1
    or branch_rows->>'location_id'<>current_setting('export_probe.loc_a')
    or other_branch_rows->>'location_id'<>current_setting('export_probe.loc_b')
    or exists(select 1 from jsonb_array_elements(none_rows->'bookings') booking where booking->>'client_phone'<>'') then
    raise exception 'export_owner_scope_or_phone_payload_failed';
  end if;
  select booking->>'client_export_key' into matched_key from jsonb_array_elements(all_rows->'bookings') booking
  where booking->>'id'=current_setting('export_probe.booking_a');
  if matched_key is null or matched_key not like 'record:%'
    or (select booking->>'client_export_key' from jsonb_array_elements(imported->'bookings') booking limit 1)<>matched_key
    or not exists(select 1 from jsonb_array_elements(all_rows->'bookings') booking
      where booking->>'id'=current_setting('export_probe.booking_a')
        and booking->>'client_phone'='79990000001' and (booking->>'client_had_previous')::boolean
        and jsonb_array_length(booking->'export_session_items')=1)
    or not exists(select 1 from jsonb_array_elements(all_rows->'bookings') booking
      where booking->>'id'=current_setting('export_probe.booking_b')
        and not (booking->>'client_had_previous')::boolean) then
    raise exception 'export_client_history_or_session_payload_failed';
  end if;
  old_report:=public.get_minuta_staff_report_bookings_v97(current_setting('export_probe.org')::uuid,
    current_setting('export_probe.date')::date,current_setting('export_probe.date')::date,null,100,0);
  team:=public.get_minuta_team_analytics(current_setting('export_probe.org')::uuid,
    current_setting('export_probe.date')::date,current_setting('export_probe.date')::date);
  events:=public.get_minuta_booking_events_v97(current_setting('export_probe.org')::uuid,
    current_setting('export_probe.date')::date,current_setting('export_probe.date')::date,100,0);
  if old_report is distinct from baseline.legacy_bookings or team is distinct from baseline.legacy_team
    or events is distinct from baseline.legacy_events
    or (select array_agg(md5(pg_get_functiondef(oid)) order by oid) from pg_proc
      where oid in ('public.get_minuta_team_analytics(uuid,date,date)'::regprocedure,
        'public.get_minuta_booking_events_v97(uuid,date,date,integer,integer)'::regprocedure,
        'public.get_minuta_staff_report_bookings_v97(uuid,date,date,uuid,integer,integer)'::regprocedure))
      is distinct from baseline.legacy_definitions
    or (select array_agg(coalesce(proacl::text,'') order by oid) from pg_proc
      where oid in ('public.get_minuta_team_analytics(uuid,date,date)'::regprocedure,
        'public.get_minuta_booking_events_v97(uuid,date,date,integer,integer)'::regprocedure,
        'public.get_minuta_staff_report_bookings_v97(uuid,date,date,uuid,integer,integer)'::regprocedure))
      is distinct from baseline.legacy_acls
    or (select md5(jsonb_agg(to_jsonb(booking) order by booking.id)::text) from public.bookings booking
      where booking.organization_id=current_setting('export_probe.org')::uuid) is distinct from baseline.booking_fingerprint
    or (select md5(jsonb_agg(to_jsonb(history) order by history.id)::text) from public.organization_imported_booking_history history
      where history.organization_id=current_setting('export_probe.org')::uuid) is distinct from baseline.history_fingerprint
    or (select md5(jsonb_agg(to_jsonb(period) order by period.id)::text) from public.payroll_periods period
      where period.organization_id=current_setting('export_probe.org')::uuid) is distinct from baseline.payroll_fingerprint then
    raise exception 'export_legacy_or_business_rows_changed';
  end if;
end $owner_checks$;

set local role authenticated;
do $admin_checks$
declare masked jsonb; imported jsonb;
begin
  perform set_config('request.jwt.claim.sub',current_setting('export_probe.admin'),true);
  masked:=public.get_minuta_report_export_bookings(current_setting('export_probe.org')::uuid,
    current_setting('export_probe.date')::date,current_setting('export_probe.date')::date,null,null,'masked',100,0);
  imported:=public.get_minuta_report_export_imported_history(current_setting('export_probe.org')::uuid,
    current_setting('export_probe.date')::date,current_setting('export_probe.date')::date,null,null,'masked',100,0);
  if jsonb_array_length(masked->'bookings')<>2 or jsonb_array_length(imported->'bookings')<>1
    or exists(select 1 from jsonb_array_elements(masked->'bookings') booking
      where booking->>'client_phone' !~ '^\+7 \*\*\* \*\*\*-[0-9]{2}-[0-9]{2}$')
    or exists(select 1 from jsonb_array_elements(imported->'bookings') booking
      where booking->>'client_phone' !~ '^\+7 \*\*\* \*\*\*-[0-9]{2}-[0-9]{2}$') then
    raise exception 'export_admin_mask_failed';
  end if;
  begin
    perform public.get_minuta_report_export_bookings(current_setting('export_probe.org')::uuid,
      current_setting('export_probe.date')::date,current_setting('export_probe.date')::date,null,null,'full',100,0);
    raise exception 'export_admin_full_was_allowed';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.get_minuta_report_export_imported_history(current_setting('export_probe.org')::uuid,
      current_setting('export_probe.date')::date,current_setting('export_probe.date')::date,null,null,'full',100,0);
    raise exception 'export_admin_import_full_was_allowed';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.get_minuta_report_export_imported_history(current_setting('export_probe.org')::uuid,
      current_setting('export_probe.date')::date,current_setting('export_probe.date')::date,null,
      current_setting('export_probe.loc_a')::uuid,'masked',100,0);
    raise exception 'export_import_branch_was_allowed';
  exception when sqlstate '22023' then null; end;
end $admin_checks$;

do $staff_checks$
declare own_rows jsonb; old_report jsonb;
begin
  perform set_config('request.jwt.claim.sub',current_setting('export_probe.staff'),true);
  own_rows:=public.get_minuta_report_export_bookings(current_setting('export_probe.org')::uuid,
    current_setting('export_probe.date')::date,current_setting('export_probe.date')::date,null,null,'masked',100,0);
  old_report:=public.get_minuta_staff_report_bookings_v97(current_setting('export_probe.org')::uuid,
    current_setting('export_probe.date')::date,current_setting('export_probe.date')::date,null,100,0);
  if own_rows->>'performer_id'<>current_setting('export_probe.staff')
    or jsonb_array_length(own_rows->'bookings')<>2
    or not exists(select 1 from jsonb_array_elements(old_report->'bookings') booking
      where booking->>'client_phone'='79990000001') then
    raise exception 'export_staff_scope_or_legacy_contact_failed';
  end if;
  begin
    perform public.get_minuta_report_export_bookings(current_setting('export_probe.org')::uuid,
      current_setting('export_probe.date')::date,current_setting('export_probe.date')::date,
      current_setting('export_probe.owner')::uuid,null,'masked',100,0);
    raise exception 'export_staff_other_performer_was_allowed';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.get_minuta_report_export_bookings(current_setting('export_probe.org')::uuid,
      current_setting('export_probe.date')::date,current_setting('export_probe.date')::date,null,null,'full',100,0);
    raise exception 'export_staff_full_was_allowed';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.get_minuta_report_export_bookings(gen_random_uuid(),
      current_setting('export_probe.date')::date,current_setting('export_probe.date')::date,null,null,'masked',100,0);
    raise exception 'export_foreign_org_was_allowed';
  exception when sqlstate '42501' then null; end;
end $staff_checks$;
reset role;
