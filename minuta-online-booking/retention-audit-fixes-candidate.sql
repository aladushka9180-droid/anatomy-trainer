-- Forward SOURCE candidate: full message validation, active draft visibility and one calendar timezone.
-- ROOT assigns the migration number and admits execution only after protected restore/apply/read/rollback/reapply.
-- This file is not a deployment entry point. Unknown function drift fails closed.
begin;

do $retention_patch_preflight$
declare v_pin record; v_actual text;
begin
  for v_pin in select * from (values
      ('public.render_minuta_retention_message(text,text,text,text)','cba64f08e5ef80cbb6fb10caec384a10','e8e551321c36d9bab6d7d7df449415cd'),
      ('public.get_minuta_retention_workspace(uuid)','44519c92f1c6c206fd50b66601b82620','c51c0abd73a050dfabcdcc1a314b5e49'),
      ('public.save_minuta_retention_settings(uuid,boolean,integer,integer,text)','65d628a07630fa5b01e43d02b0762946','f57bf3972ed7ea69eedbbe3e3d320154'),
      ('public.prepare_minuta_retention_delivery(uuid,uuid,text)','0d00f9e22e8f95c96221b4ffc688f05a','becba5f1ff2ebada3d830005a3d133c8')
  ) pins(signature,previous_body_md5,candidate_body_md5) loop
    select pg_catalog.md5(pg_catalog.regexp_replace(proc.prosrc,'[[:space:]]','','g')) into v_actual
    from pg_catalog.pg_proc proc where proc.oid=pg_catalog.to_regprocedure(v_pin.signature);
    if v_actual is null or v_actual not in (v_pin.previous_body_md5,v_pin.candidate_body_md5) then
      raise exception using errcode='P0001',message='retention_patch_source_drift',detail=v_pin.signature;
    end if;
  end loop;
  select pg_catalog.md5(pg_catalog.regexp_replace(proc.prosrc,'[[:space:]]','','g')) into v_actual
  from pg_catalog.pg_proc proc where proc.oid=pg_catalog.to_regprocedure('public.require_minuta_retention_manager(uuid)');
  if v_actual is distinct from 'a0ac685e4fbcb5f3450e7925ce2cd9f6' then
    raise exception using errcode='P0001',message='retention_patch_requires_reviewed_v100_guard';
  end if;
end $retention_patch_preflight$;

create or replace function public.render_minuta_retention_message(
  p_template text,p_client_name text,p_organization_name text,p_slug text
) returns text language plpgsql immutable set search_path to '' as $$
declare v_message text;
begin
  v_message:=replace(replace(replace(replace(
    p_template,
    '{имя}',coalesce(nullif(btrim(p_client_name),''),'клиент')),
    '{организация}',coalesce(nullif(btrim(p_organization_name),''),'нашей студии')),
    '{ссылка}','https://aladushka9180-droid.github.io/anatomy-trainer/minuta-online-booking/index.html?org='||coalesce(p_slug,'')),
    '{дней}','');
  if char_length(v_message)>1000 then
    raise exception using errcode='22023',message='retention_message_too_long';
  end if;
  return v_message;
end $$;

create or replace function public.get_minuta_retention_workspace(p_organization uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_role text; v_settings public.organization_retention_settings%rowtype;
begin
  v_role:=public.require_minuta_retention_manager(p_organization);
  select * into v_settings from public.organization_retention_settings where organization_id=p_organization;
  return jsonb_build_object(
    'organization_id',p_organization,'current_role',v_role,
    'enabled',coalesce(v_settings.enabled,false),
    'inactivity_days',coalesce(v_settings.inactivity_days,45),
    'cooldown_days',coalesce(v_settings.cooldown_days,90),
    'message_template',coalesce(v_settings.message_template,'Здравствуйте, {имя}! Давно вас не было в {организация}. Будем рады видеть снова: {ссылка}'),
    'clients',coalesce((
      with stats as (
        select booking.client_account_id,
          max(booking.booking_date) filter (where outcome.visit_status='completed') last_visit_on,
          count(*) filter (where outcome.visit_status='completed') completed_visits,
          bool_or(booking.status<>'cancelled' and booking.booking_date+booking.booking_time>=timezone('Europe/Samara',now())) has_upcoming
        from public.bookings booking
        left join public.booking_outcomes outcome on outcome.booking_id=booking.id
        where booking.organization_id=p_organization and booking.client_account_id is not null
        group by booking.client_account_id
      )
      select jsonb_agg(jsonb_build_object(
        'client_account_id',stats.client_account_id,
        'client_name',latest.client_name,'client_phone',latest.client_phone,
        'last_visit_on',stats.last_visit_on,'completed_visits',stats.completed_visits,
        'performer_id',latest.performer_id,'last_booking_id',latest.id,
        'consent_status',coalesce(consent.status,'unknown'),
        'last_sent_at',sent.last_sent_at,
        'eligible',coalesce(v_settings.enabled,false)
          and consent.status='granted'
          and stats.last_visit_on is not null and not stats.has_upcoming
          and stats.last_visit_on <= timezone('Europe/Samara',now())::date-coalesce(v_settings.inactivity_days,45)
          and (sent.last_sent_at is null or sent.last_sent_at <= now()-make_interval(days=>coalesce(v_settings.cooldown_days,90)))
      ) order by stats.last_visit_on nulls first,latest.client_name)
      from stats
      join lateral (
        select booking.id,booking.client_name,booking.client_phone,booking.performer_id
        from public.bookings booking
        where booking.organization_id=p_organization and booking.client_account_id=stats.client_account_id
        order by booking.booking_date desc,booking.booking_time desc,booking.created_at desc limit 1
      ) latest on true
      left join public.client_marketing_consents consent on consent.organization_id=p_organization and consent.client_account_id=stats.client_account_id
      left join lateral (
        select max(delivery.sent_at) last_sent_at from public.retention_deliveries delivery
        where delivery.organization_id=p_organization and delivery.client_account_id=stats.client_account_id and delivery.status='sent'
      ) sent on true
    ),'[]'::jsonb),
    'deliveries',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',delivery.id,'client_account_id',delivery.client_account_id,'channel',delivery.channel,
        'status',delivery.status,'message_snapshot',delivery.message_snapshot,
        'prepared_at',delivery.prepared_at,'sent_at',delivery.sent_at
      ) order by delivery.prepared_at desc)
      from (
        select * from public.retention_deliveries
        where organization_id=p_organization and status='prepared'
        union all
        (select * from public.retention_deliveries
         where organization_id=p_organization and status<>'prepared'
         order by prepared_at desc,id desc limit 100)
      ) delivery
    ),'[]'::jsonb),
    'audit',coalesce((
      select jsonb_agg(jsonb_build_object('id',entry.id,'action',entry.action,'subject_id',entry.subject_id,'created_at',entry.created_at) order by entry.created_at desc,entry.id desc)
      from (select * from public.retention_audit_log where organization_id=p_organization order by created_at desc,id desc limit 100) entry
    ),'[]'::jsonb)
  );
end $$;

create or replace function public.save_minuta_retention_settings(
  p_organization uuid,p_enabled boolean,p_inactivity_days integer,p_cooldown_days integer,p_message_template text
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_role text; v_org public.organizations%rowtype;
begin
  v_role:=public.require_minuta_retention_manager(p_organization);
  if p_enabled and v_role<>'owner' then raise exception using errcode='42501',message='owner_required'; end if;
  if p_inactivity_days not between 7 and 730 or p_cooldown_days not between 7 and 730
     or char_length(btrim(coalesce(p_message_template,''))) not between 20 and 1000
     or position('{ссылка}' in p_message_template)=0 then
    raise exception using errcode='22023',message='invalid_retention_settings';
  end if;
  select * into v_org from public.organizations where id=p_organization;
  -- Reject an unusable template before saving; actual client substitution is
  -- checked again by render_minuta_retention_message during preparation.
  perform public.render_minuta_retention_message(btrim(p_message_template),'клиент',v_org.name,v_org.public_slug);
  insert into public.organization_retention_settings(organization_id,enabled,inactivity_days,cooldown_days,message_template,enabled_at,enabled_by,updated_at)
  values(p_organization,p_enabled,p_inactivity_days,p_cooldown_days,btrim(p_message_template),case when p_enabled then now() end,case when p_enabled then auth.uid() end,now())
  on conflict(organization_id) do update set enabled=excluded.enabled,inactivity_days=excluded.inactivity_days,cooldown_days=excluded.cooldown_days,
    message_template=excluded.message_template,enabled_at=case when excluded.enabled and not organization_retention_settings.enabled then now() else organization_retention_settings.enabled_at end,
    enabled_by=case when excluded.enabled and not organization_retention_settings.enabled then auth.uid() else organization_retention_settings.enabled_by end,updated_at=now();
  perform public.write_minuta_retention_audit(p_organization,'retention_settings_saved',null,jsonb_build_object('enabled',p_enabled));
  return jsonb_build_object('organization_id',p_organization,'enabled',p_enabled);
end $$;

create or replace function public.prepare_minuta_retention_delivery(
  p_organization uuid,p_client_account uuid,p_channel text default 'whatsapp'
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_settings public.organization_retention_settings%rowtype; v_org public.organizations%rowtype;
  v_client record; v_last_sent timestamptz; v_id uuid; v_message text;
begin
  perform public.require_minuta_retention_manager(p_organization);
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_client_account::text,83));
  select * into v_settings from public.organization_retention_settings where organization_id=p_organization;
  if not coalesce(v_settings.enabled,false) then raise exception using errcode='P0001',message='retention_disabled'; end if;
  if p_channel not in ('whatsapp','telegram','other') then raise exception using errcode='22023',message='invalid_retention_channel'; end if;
  if not exists(select 1 from public.client_marketing_consents where organization_id=p_organization and client_account_id=p_client_account and status='granted') then
    raise exception using errcode='P0001',message='marketing_consent_required';
  end if;
  select booking.id,booking.client_name,booking.client_phone,booking.performer_id,booking.booking_date last_visit_on into v_client
  from public.bookings booking
  join public.booking_outcomes outcome on outcome.booking_id=booking.id and outcome.visit_status='completed'
  where booking.organization_id=p_organization and booking.client_account_id=p_client_account
  order by booking.booking_date desc,booking.booking_time desc limit 1;
  if v_client.id is null or v_client.last_visit_on>timezone('Europe/Samara',now())::date-v_settings.inactivity_days
     or exists(select 1 from public.bookings booking where booking.organization_id=p_organization and booking.client_account_id=p_client_account
       and booking.status<>'cancelled' and booking.booking_date+booking.booking_time>=timezone('Europe/Samara',now())) then
    raise exception using errcode='P0001',message='client_not_inactive';
  end if;
  select max(sent_at) into v_last_sent from public.retention_deliveries where organization_id=p_organization and client_account_id=p_client_account and status='sent';
  if v_last_sent>now()-make_interval(days=>v_settings.cooldown_days) then raise exception using errcode='P0001',message='retention_cooldown_active'; end if;
  if exists(select 1 from public.retention_deliveries where organization_id=p_organization and client_account_id=p_client_account and status='prepared') then
    raise exception using errcode='P0001',message='retention_already_prepared';
  end if;
  select * into v_org from public.organizations where id=p_organization;
  v_message:=public.render_minuta_retention_message(v_settings.message_template,v_client.client_name,v_org.name,v_org.public_slug);
  insert into public.retention_deliveries(organization_id,client_account_id,performer_id,last_booking_id,channel,message_snapshot,prepared_by)
  values(p_organization,p_client_account,v_client.performer_id,v_client.id,p_channel,v_message,auth.uid()) returning id into v_id;
  perform public.write_minuta_retention_audit(p_organization,'retention_delivery_prepared',v_id,jsonb_build_object('client_account_id',p_client_account,'channel',p_channel));
  return jsonb_build_object('id',v_id,'organization_id',p_organization,'client_phone',v_client.client_phone,'message',v_message,'status','prepared');
end $$;

commit;
