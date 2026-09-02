begin;

set local search_path = public, extensions, pg_catalog;

do $$
begin
  if to_regclass('public.notification_outbox') is null then
    raise exception using errcode='P0001',message='v88_rollback_requires_notification_outbox';
  end if;
  -- Removing sent history would hide delivery evidence. Rollback is therefore
  -- allowed only before the new center has created its first unified event.
  if exists (
    select 1 from public.notification_outbox
    where dispatcher='unified'
  ) then
    raise exception using errcode='P0001',message='v88_rollback_requires_empty_unified_outbox';
  end if;
end;
$$;

drop trigger if exists bookings_enqueue_change_notification_v88 on public.bookings;
drop trigger if exists organizations_notification_defaults on public.organizations;
drop trigger if exists organization_notification_settings_cancel_queue on public.organization_notification_settings;
drop trigger if exists organization_notification_channels_cancel_queue on public.organization_notification_channels;

-- Restore the original v46 enqueue behavior. Existing legacy rows and their
-- event keys are preserved.
create or replace function public.enqueue_booking_created_notification()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if regexp_replace(coalesce(new.client_phone, ''), '[^0-9]', '', 'g') = '0000000000' then
    return new;
  end if;
  insert into public.notification_outbox (
    performer_id, booking_id, event_key, kind, channel
  ) values (
    new.performer_id,
    new.id,
    'booking:' || new.id::text || ':created:telegram',
    'booking_created',
    'telegram'
  )
  on conflict (event_key) do nothing;
  return new;
end;
$$;

create or replace function public.claim_notification_outbox(
  p_performer uuid,
  p_limit integer default 10
)
returns table(
  outbox_id uuid,
  lock_token uuid,
  event_key text,
  performer_id uuid,
  booking_id uuid,
  kind text,
  channel text,
  attempt_no integer,
  booking_code text,
  client_name text,
  client_phone text,
  booking_date date,
  booking_time time without time zone,
  service_name text,
  performer_name text
)
language sql
security definer
set search_path to 'pg_catalog', 'extensions'
as $$
  with picked as (
    select queue.id
    from public.notification_outbox queue
    where queue.performer_id = p_performer
      and (
        (queue.status = 'pending' and queue.next_attempt_at <= now())
        or (queue.status = 'sending' and queue.locked_at < now() - interval '15 minutes')
      )
    order by queue.next_attempt_at, queue.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  ), claimed as (
    update public.notification_outbox queue
    set status = 'sending', attempts = queue.attempts + 1,
        locked_at = now(), lock_token = gen_random_uuid(),
        last_error_code = null, last_error = null
    from picked where queue.id = picked.id returning queue.*
  ), logged as (
    insert into public.notification_delivery_attempts (
      outbox_id, performer_id, attempt_no, outcome
    )
    select claimed.id, claimed.performer_id, claimed.attempts, 'sending'
    from claimed
    on conflict (outbox_id, attempt_no) do nothing
    returning outbox_id, attempt_no
  )
  select claimed.id, claimed.lock_token, claimed.event_key,
    claimed.performer_id, claimed.booking_id, claimed.kind,
    claimed.channel, claimed.attempts, booking.booking_code,
    booking.client_name, booking.client_phone, booking.booking_date,
    booking.booking_time, service.name, profile.display_name
  from claimed
  join logged on logged.outbox_id = claimed.id and logged.attempt_no = claimed.attempts
  join public.bookings booking on booking.id = claimed.booking_id
  join public.services service on service.id = booking.service_id
  join public.performer_profiles profile on profile.id = claimed.performer_id
  order by claimed.created_at;
$$;

create or replace function public.retry_notification_outbox(p_outbox uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $$
begin
  update public.notification_outbox queue
  set status = 'pending', next_attempt_at = now(), locked_at = null,
      lock_token = null, last_error_code = null, last_error = null
  where queue.id = p_outbox
    and queue.performer_id = auth.uid()
    and queue.status = 'failed';
  if not found then
    raise exception using errcode = 'P0001', message = 'notification_not_retryable';
  end if;
  return 'pending';
end;
$$;

revoke all on function public.claim_notification_outbox(uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.retry_notification_outbox(uuid) from public,anon,authenticated,service_role;
grant execute on function public.claim_notification_outbox(uuid,integer) to service_role;
grant execute on function public.retry_notification_outbox(uuid) to authenticated;

drop function if exists public.claim_minuta_notification_outbox(text[],integer);
drop function if exists public.enqueue_due_minuta_booking_reminders(integer);
drop function if exists public.get_minuta_notification_workspace(uuid);
drop function if exists public.set_minuta_notification_master(uuid,boolean);
drop function if exists public.set_minuta_notification_channel(uuid,text,text,boolean);
drop function if exists public.upsert_minuta_notification_endpoint(uuid,text,text,text,jsonb,text,boolean);
drop function if exists public.enqueue_minuta_booking_change_notification();
drop function if exists public.enqueue_minuta_booking_notification(uuid,text);
drop function if exists public.minuta_notification_event_enabled(public.organization_notification_settings,text);
drop function if exists public.cancel_disabled_minuta_notification_queue();
drop function if exists public.ensure_minuta_notification_defaults();

drop policy if exists notification_outbox_organization_read on public.notification_outbox;
drop policy if exists notification_outbox_owner_read on public.notification_outbox;
create policy notification_outbox_owner_read on public.notification_outbox
  for select to authenticated using (performer_id=(select auth.uid()));

drop policy if exists notification_delivery_attempts_organization_read on public.notification_delivery_attempts;
drop policy if exists notification_delivery_attempts_owner_read on public.notification_delivery_attempts;
create policy notification_delivery_attempts_owner_read on public.notification_delivery_attempts
  for select to authenticated using (performer_id=(select auth.uid()));

drop index if exists public.notification_outbox_unified_due_idx;
drop index if exists public.notification_outbox_organization_created_idx;

alter table public.notification_outbox
  drop constraint if exists notification_outbox_organization_id_fkey,
  drop constraint if exists notification_outbox_kind_check,
  drop constraint if exists notification_outbox_channel_check,
  drop constraint if exists notification_outbox_status_check,
  drop constraint if exists notification_outbox_audience_check,
  drop constraint if exists notification_outbox_recipient_key_check,
  drop constraint if exists notification_outbox_payload_check,
  drop constraint if exists notification_outbox_dispatcher_check;

alter table public.notification_outbox
  add constraint notification_outbox_kind_check check (kind in ('booking_created')),
  add constraint notification_outbox_channel_check check (channel in ('telegram')),
  add constraint notification_outbox_status_check check (status in ('pending','sending','sent','failed'));

alter table public.notification_outbox
  drop column if exists dispatcher,
  drop column if exists payload,
  drop column if exists recipient_key,
  drop column if exists audience,
  drop column if exists organization_id;

drop table if exists public.notification_recipient_endpoints;
drop table if exists public.organization_notification_channels;
drop table if exists public.organization_notification_settings;

commit;
