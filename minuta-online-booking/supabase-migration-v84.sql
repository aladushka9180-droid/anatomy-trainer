begin;

set local search_path = public, extensions, pg_catalog;

do $$
declare
  v_conflict_count bigint;
  v_examples text;
begin
  if to_regclass('public.benefit_redemptions') is null
     or to_regclass('public.loyalty_redemptions') is null
     or to_regclass('public.loyalty_promo_redemptions') is null
     or to_regprocedure('public.apply_minuta_benefit(uuid,uuid,uuid,text,integer)') is null
     or to_regprocedure('public.redeem_minuta_loyalty(uuid,uuid,integer,uuid)') is null
     or to_regprocedure('public.redeem_minuta_promotion(uuid,text,uuid,uuid)') is null then
    raise exception using errcode='P0001',message='v84_requires_v73_and_v81_benefits';
  end if;

  -- Keep the conflict scan and trigger installation inside one write barrier.
  -- Without it, a concurrent redemption could commit after the scan but before
  -- the new triggers become visible at this transaction's commit.
  lock table public.benefit_redemptions,
    public.loyalty_redemptions,
    public.loyalty_promo_redemptions
    in share row exclusive mode;

  with benefit_sources as (
    select organization_id,booking_id,'benefit'::text as source
    from public.benefit_redemptions
    where status in ('reserved','redeemed')
    union all
    select organization_id,booking_id,'loyalty'::text
    from public.loyalty_redemptions
    union all
    select organization_id,booking_id,'promotion'::text
    from public.loyalty_promo_redemptions
  ), conflicts as (
    select organization_id,booking_id
    from benefit_sources
    group by organization_id,booking_id
    having count(distinct source)>1
  )
  select count(*),string_agg(booking_id::text,',' order by booking_id::text)
    into v_conflict_count,v_examples
  from (select booking_id from conflicts order by booking_id limit 10) sample;

  if v_conflict_count>0 then
    raise exception using
      errcode='23514',
      message='v84_existing_booking_benefit_conflict',
      detail='Resolve conflicting bookings before migration. Examples: '||coalesce(v_examples,'');
  end if;
end $$;

create or replace function public.enforce_minuta_booking_benefit_exclusivity()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_source text;
begin
  if tg_table_name='benefit_redemptions' then
    if new.status not in ('reserved','redeemed') then return new; end if;
    v_source:='benefit';
  elsif tg_table_name='loyalty_redemptions' then
    v_source:='loyalty';
  elsif tg_table_name='loyalty_promo_redemptions' then
    v_source:='promotion';
  else
    raise exception using errcode='55000',message='unsupported_booking_benefit_source';
  end if;

  -- Every source takes exactly the same transaction-scoped lock. This closes the
  -- race between independent RPCs without changing their idempotency contracts.
  perform pg_advisory_xact_lock(
    hashtextextended(new.organization_id::text||':'||new.booking_id::text,8400)
  );

  if v_source<>'benefit' and exists(
    select 1 from public.benefit_redemptions redemption
    where redemption.organization_id=new.organization_id
      and redemption.booking_id=new.booking_id
      and redemption.status in ('reserved','redeemed')
  ) then
    raise exception using errcode='23514',message='booking_benefit_conflict',
      detail='An active pass, certificate or package is already attached to this booking.';
  end if;

  if v_source<>'loyalty' and exists(
    select 1 from public.loyalty_redemptions redemption
    where redemption.organization_id=new.organization_id
      and redemption.booking_id=new.booking_id
  ) then
    raise exception using errcode='23514',message='booking_benefit_conflict',
      detail='Loyalty points are already redeemed for this booking.';
  end if;

  if v_source<>'promotion' and exists(
    select 1 from public.loyalty_promo_redemptions redemption
    where redemption.organization_id=new.organization_id
      and redemption.booking_id=new.booking_id
  ) then
    raise exception using errcode='23514',message='booking_benefit_conflict',
      detail='A promotion is already redeemed for this booking.';
  end if;

  return new;
end $$;

revoke all on function public.enforce_minuta_booking_benefit_exclusivity()
  from public,anon,authenticated,service_role;

drop trigger if exists benefit_redemptions_exclusivity_v84 on public.benefit_redemptions;
create trigger benefit_redemptions_exclusivity_v84
before insert or update of organization_id,booking_id,status on public.benefit_redemptions
for each row execute function public.enforce_minuta_booking_benefit_exclusivity();

drop trigger if exists loyalty_redemptions_exclusivity_v84 on public.loyalty_redemptions;
create trigger loyalty_redemptions_exclusivity_v84
before insert or update of organization_id,booking_id on public.loyalty_redemptions
for each row execute function public.enforce_minuta_booking_benefit_exclusivity();

drop trigger if exists loyalty_promo_redemptions_exclusivity_v84 on public.loyalty_promo_redemptions;
create trigger loyalty_promo_redemptions_exclusivity_v84
before insert or update of organization_id,booking_id on public.loyalty_promo_redemptions
for each row execute function public.enforce_minuta_booking_benefit_exclusivity();

commit;
