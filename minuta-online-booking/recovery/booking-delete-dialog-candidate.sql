-- CANDIDATE ONLY: final migration number is assigned by the release owner.
-- Existing booking-linked client conversations become read-only history.
-- No message, participant, financial-history row or booking is deleted on apply.
begin;
set local lock_timeout='5s';
set local statement_timeout='5min';
set local search_path=pg_catalog,public;

do $guard$
declare v_table regclass; v_constraint text;
begin
  if to_regclass('public.message_conversations_v162') is null
     or to_regclass('public.message_participants_v162') is null
     or to_regprocedure('public.provider_delete_booking(uuid)') is null then
    raise exception 'booking_delete_dialog_prerequisites_missing';
  end if;
  if not exists(select 1 from pg_proc where oid='public.provider_delete_booking(uuid)'::regprocedure
    and md5(regexp_replace(prosrc,'[[:space:]]','','g')) in ('a253f555e7ddfa9ac60ce2f629c43865','71c0034ac328ad54c677cce8483ccc05')) then
    raise exception 'booking_delete_dialog_unexpected_rpc';
  end if;
  for v_table,v_constraint in select * from (values
    ('public.message_conversations_v162'::regclass,'message_conversations_booking_archive_check'),
    ('public.message_participants_v162'::regclass,'message_participants_booking_archive_check')
  ) config(tab,check_name) loop
    if exists(select 1 from pg_attribute where attrelid=v_table and attname='deleted_booking_id' and not attisdropped)
      and not exists(select 1 from pg_constraint where conrelid=v_table and conname=v_constraint
        and obj_description(oid,'pg_constraint')='eldion:booking-delete-dialog:1') then
      raise exception 'booking_delete_dialog_unowned_archive_column';
    end if;
  end loop;
end
$guard$;

alter table public.message_conversations_v162 add column if not exists deleted_booking_id uuid;
alter table public.message_participants_v162 add column if not exists deleted_booking_id uuid;

-- Replace only each original identity CHECK. FK RESTRICT, RLS, grants,
-- immutable-history triggers, and all unrelated checks remain in force.
do $checks$
declare v_table regclass; v_columns text[]; v_keys smallint[]; v_names text[];
  v_original text; v_new text;
begin
  for v_table,v_columns,v_new in select * from (values
    ('public.message_conversations_v162'::regclass,
      array['conversation_kind','organization_id','primary_booking_id','client_account_id'],
      'message_conversations_booking_archive_check'),
    ('public.message_participants_v162'::regclass,
      array['participant_kind','user_id','client_account_id','booking_id'],
      'message_participants_booking_archive_check')
  ) config(tab,cols,new_name) loop
    if not exists(select 1 from pg_attribute where attrelid=v_table and attname='deleted_booking_id'
      and atttypid='uuid'::regtype and not attnotnull and not attisdropped) then
      raise exception 'booking_delete_dialog_unexpected_archive_column';
    end if;
    if exists(select 1 from pg_constraint where conrelid=v_table and conname=v_new) then
      if (select obj_description(oid,'pg_constraint') from pg_constraint
          where conrelid=v_table and conname=v_new) is distinct from 'eldion:booking-delete-dialog:1' then
        raise exception 'booking_delete_dialog_unknown_archive_check';
      end if;
      continue;
    end if;
    select array_agg(attnum order by attnum) into v_keys from pg_attribute
      where attrelid=v_table and attname=any(v_columns) and not attisdropped;
    select array_agg(conname::text) into v_names from pg_constraint
      where conrelid=v_table and contype='c' and conkey @> v_keys and conkey <@ v_keys;
    if cardinality(v_keys)<>4 or coalesce(cardinality(v_names),0)<>1 then
      raise exception 'booking_delete_dialog_unexpected_identity_check';
    end if;
    execute format('alter table %s drop constraint %I',v_table,v_names[1]);
    if v_table='public.message_conversations_v162'::regclass then
      execute format($ddl$alter table %s add constraint %I check (
        ((conversation_kind='client' and organization_id is not null
          and (primary_booking_id is not null or deleted_booking_id is not null))
          or (conversation_kind='support' and (organization_id is not null or client_account_id is not null)))
        and (deleted_booking_id is null or (primary_booking_id is null
          and (conversation_kind='support' or (state='closed' and closed_at is not null))))
      )$ddl$,v_table,v_new);
    else
      execute format($ddl$alter table %s add constraint %I check (
        (participant_kind in('organization_user','support_user') and user_id is not null
          and client_account_id is null and booking_id is null and deleted_booking_id is null)
        or (participant_kind='client_account' and user_id is null and client_account_id is not null
          and booking_id is null and deleted_booking_id is null)
        or (participant_kind='booking_client' and user_id is null and client_account_id is null and (
          (booking_id is not null and deleted_booking_id is null)
          or (booking_id is null and deleted_booking_id is not null and not active and left_at is not null)))
      )$ddl$,v_table,v_new);
    end if;
    execute format('comment on constraint %I on %s is %L',v_new,v_table,'eldion:booking-delete-dialog:1');
  end loop;
end
$checks$;

create or replace function public.provider_delete_booking(p_booking uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := auth.uid();
  v_performer uuid;
  v_has_review boolean := false;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select booking.performer_id
  into v_performer
  from public.bookings booking
  where booking.id = p_booking
  for update;

  if not found then
    return 'not_found';
  end if;

  if v_performer is distinct from v_actor then
    raise exception using errcode = '42501', message = 'booking_access_denied';
  end if;

  if to_regclass('public.booking_reviews') is not null then
    execute $sql$
      select exists (
        select 1
        from public.booking_reviews review
        where review.booking_id = $1
      )
    $sql$
    into v_has_review
    using p_booking;
  end if;

  if v_has_review then
    return 'review_protected';
  end if;

  -- The booking row is locked and ownership/review checks have already passed.
  -- Retain immutable messages and participants; detach only this booking.
  update public.message_conversations_v162
  set deleted_booking_id = primary_booking_id,
      primary_booking_id = null,
      state = case when conversation_kind = 'client' then 'closed' else state end,
      closed_at = case when conversation_kind = 'client' then coalesce(closed_at, now()) else closed_at end
  where primary_booking_id = p_booking;

  update public.message_participants_v162
  set deleted_booking_id = booking_id, booking_id = null,
      active = false, left_at = coalesce(left_at, now())
  where booking_id = p_booking;

  if to_regclass('public.payments') is not null then
    if to_regclass('public.payment_events') is not null then
      execute $sql$
        delete from public.payment_events event
        where event.payment_id in (
          select payment.id
          from public.payments payment
          where payment.booking_id = $1
        )
      $sql$
      using p_booking;
    end if;

    execute $sql$
      delete from public.payments payment
      where payment.booking_id = $1
    $sql$
    using p_booking;
  end if;

  delete from public.bookings booking
  where booking.id = p_booking
    and booking.performer_id = v_actor;

  if not found then
    raise exception using errcode = 'P0001', message = 'booking_delete_failed';
  end if;

  return 'deleted';
end;
$$;

revoke all on function public.provider_delete_booking(uuid) from public, anon, authenticated, service_role;
grant execute on function public.provider_delete_booking(uuid) to authenticated;

comment on function public.provider_delete_booking(uuid) is 'eldion:booking-delete-dialog:1';
commit;
