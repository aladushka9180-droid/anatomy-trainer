\set ON_ERROR_STOP on

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.payroll_adjustments') is null
    or not exists(select 1 from pg_attribute where attrelid='public.payroll_adjustments'::regclass
      and attname='request_id' and not attisdropped) then
    raise exception 'v121_rollback_prerequisites_missing';
  end if;
  if exists(select 1 from public.payroll_adjustments where request_id is not null) then
    raise exception 'v121_rollback_blocked_request_ids_exist';
  end if;
end;
$$;

revoke all on function public.add_minuta_payroll_adjustment(uuid,uuid,uuid,integer,text,uuid)
  from public,anon,authenticated,service_role;
drop function public.add_minuta_payroll_adjustment(uuid,uuid,uuid,integer,text,uuid);

create or replace function public.get_minuta_payroll_workspace(
  p_organization uuid,p_start date,p_end date
) returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_role text; v_user uuid:=auth.uid();
begin
  v_role:=public.get_minuta_payroll_role(p_organization);
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>366 then
    raise exception using errcode='22023',message='invalid_payroll_range';
  end if;
  return jsonb_build_object(
    'organization_id',p_organization,'current_role',v_role,'can_manage',v_role in ('owner','admin'),
    'enabled',coalesce((select enabled from public.organization_payroll_settings where organization_id=p_organization),false),
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',membership.user_id,'display_name',profile.display_name,
      'role',membership.role,'is_bookable',membership.is_bookable) order by profile.display_name,membership.user_id)
      from public.organization_memberships membership join public.performer_profiles profile on profile.id=membership.user_id
      where membership.organization_id=p_organization and membership.active
        and (v_role in ('owner','admin') or membership.user_id=v_user)),'[]'::jsonb),
    'locations',coalesce((select jsonb_agg(jsonb_build_object('id',location.id,'name',location.name,'active',location.active)
      order by location.is_primary desc,location.name,location.id) from public.locations location
      where location.organization_id=p_organization),'[]'::jsonb),
    'plans',coalesce((select jsonb_agg(jsonb_build_object('id',plan.id,'performer_id',plan.performer_id,'name',plan.name,
      'effective_from',plan.effective_from,'effective_to',plan.effective_to,'base_rate_bps',plan.base_rate_bps,
      'active',plan.active,'tiers',coalesce((select jsonb_agg(jsonb_build_object('threshold_rub',tier.threshold_rub,
        'rate_bps',tier.rate_bps) order by tier.threshold_rub) from public.payroll_plan_tiers tier where tier.plan_id=plan.id),'[]'::jsonb))
      order by plan.performer_id,plan.effective_from desc,plan.id)
      from public.payroll_plans plan where plan.organization_id=p_organization
        and (v_role in ('owner','admin') or plan.performer_id=v_user)),'[]'::jsonb),
    'periods',coalesce((select jsonb_agg(jsonb_build_object('id',period.id,'name',period.name,'location_id',period.location_id,
      'starts_on',period.starts_on,'ends_on',period.ends_on,'status',period.status,'total_revenue_rub',period.total_revenue_rub,
      'total_payroll_rub',period.total_payroll_rub,'source_fingerprint',period.source_fingerprint,
      'calculated_at',period.calculated_at,'approved_at',period.approved_at,'paid_at',period.paid_at)
      order by period.starts_on desc,period.id)
      from public.payroll_periods period where period.organization_id=p_organization
        and period.starts_on<=p_end and period.ends_on>=p_start
        and (v_role in ('owner','admin') or exists(select 1 from public.payroll_items own_item
          where own_item.period_id=period.id and own_item.performer_id=v_user))),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',item.id,'period_id',item.period_id,
      'performer_id',item.performer_id,'booking_id',item.booking_id,'amount_rub',item.amount_rub,
      'rate_bps',item.rate_bps,'payroll_rub',item.payroll_rub,'service_name',item.service_name,'booking_date',item.booking_date)
      order by item.booking_date,item.booking_id)
      from public.payroll_items item join public.payroll_periods period on period.id=item.period_id
      where item.organization_id=p_organization and period.starts_on<=p_end and period.ends_on>=p_start
        and (v_role in ('owner','admin') or item.performer_id=v_user))),'[]'::jsonb),
    'adjustments',coalesce((select jsonb_agg(jsonb_build_object('id',adjustment.id,'period_id',adjustment.period_id,
      'performer_id',adjustment.performer_id,'amount_rub',adjustment.amount_rub,'reason',adjustment.reason,
      'created_at',adjustment.created_at) order by adjustment.created_at,adjustment.id)
      from public.payroll_adjustments adjustment join public.payroll_periods period on period.id=adjustment.period_id
      where adjustment.organization_id=p_organization and period.starts_on<=p_end and period.ends_on>=p_start
        and (v_role in ('owner','admin') or adjustment.performer_id=v_user))),'[]'::jsonb),
    'audit',case when v_role in ('owner','admin') then coalesce((select jsonb_agg(jsonb_build_object('id',entry.id,
      'actor_id',entry.actor_id,'action',entry.action,'subject_id',entry.subject_id,'details',entry.details,
      'created_at',entry.created_at) order by entry.created_at desc,entry.id desc)
      from (select * from public.payroll_audit_log where organization_id=p_organization
        order by created_at desc,id desc limit 100) entry),'[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;
revoke all on function public.get_minuta_payroll_workspace(uuid,date,date)
  from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_payroll_workspace(uuid,date,date) to authenticated;

create or replace function public.get_minuta_loyalty_workspace(p_organization uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  v_role:=public.get_minuta_loyalty_role(p_organization);
  return jsonb_build_object(
    'organization_id',p_organization,'current_role',v_role,
    'enabled',coalesce((select enabled from public.organization_loyalty_settings where organization_id=p_organization),false),
    'max_redeem_percent_bps',coalesce((select max_redeem_percent_bps from public.organization_loyalty_settings where organization_id=p_organization),3000),
    'rule',coalesce((select jsonb_build_object('id',rule.id,'name',rule.name,'earn_rate_bps',rule.earn_rate_bps,'min_paid_amount_rub',rule.min_paid_amount_rub) from public.loyalty_rules rule where rule.organization_id=p_organization and rule.active),'{}'::jsonb),
    'clients',coalesce((select jsonb_agg(jsonb_build_object('id',client.id,'client_name',client.client_name,'client_phone',client.client_phone) order by client.client_name,client.id)
      from (select distinct on (booking.client_account_id) booking.client_account_id id,booking.client_name,booking.client_phone from public.bookings booking
        where booking.organization_id=p_organization and booking.client_account_id is not null order by booking.client_account_id,booking.created_at desc) client),'[]'::jsonb),
    'bookings',coalesce((select jsonb_agg(jsonb_build_object('id',booking.id,'client_account_id',booking.client_account_id,'client_name',booking.client_name,'service_name',service.name,
      'booking_date',booking.booking_date,'booking_time',booking.booking_time,'visit_status',coalesce(outcome.visit_status,'scheduled'),'payment_method',coalesce(outcome.payment_method,'unpaid'),'amount_rub',coalesce(outcome.amount_rub,booking.total_price_rub,service.price_rub)) order by booking.booking_date desc,booking.booking_time desc)
      from public.bookings booking join public.services service on service.id=booking.service_id left join public.booking_outcomes outcome on outcome.booking_id=booking.id
      where booking.organization_id=p_organization and booking.client_account_id is not null and booking.status<>'cancelled' and booking.booking_date>=current_date-180),'[]'::jsonb),
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',account.id,'client_account_id',account.client_account_id,'balance_points',account.balance_points,'lifetime_earned',account.lifetime_earned,'lifetime_spent',account.lifetime_spent) order by account.updated_at desc,account.id)
      from public.client_loyalty_accounts account where account.organization_id=p_organization),'[]'::jsonb),
    'promotions',coalesce((select jsonb_agg(jsonb_build_object('id',promo.id,'code',promo.code,'kind',promo.kind,'value',promo.value,'valid_from',promo.valid_from,'valid_until',promo.valid_until,
      'total_limit',promo.total_limit,'per_client_limit',promo.per_client_limit,'active',promo.active,'usage_count',(select count(*) from public.loyalty_promo_redemptions redemption where redemption.promotion_id=promo.id)) order by promo.created_at desc)
      from public.loyalty_promotions promo where promo.organization_id=p_organization),'[]'::jsonb),
    'promo_redemptions',coalesce((select jsonb_agg(jsonb_build_object('id',redemption.id,'promotion_id',redemption.promotion_id,'booking_id',redemption.booking_id,'client_account_id',redemption.client_account_id,'discount_rub',redemption.discount_rub,'final_amount_rub',redemption.final_amount_rub,'created_at',redemption.created_at) order by redemption.created_at desc)
      from public.loyalty_promo_redemptions redemption where redemption.organization_id=p_organization),'[]'::jsonb),
    'ledger',coalesce((select jsonb_agg(jsonb_build_object('id',entry.id,'client_account_id',entry.client_account_id,'event_type',entry.event_type,'points_delta',entry.points_delta,'balance_after',entry.balance_after,'booking_id',entry.booking_id,'reason',entry.reason,'created_at',entry.created_at) order by entry.id desc)
      from (select * from public.loyalty_ledger where organization_id=p_organization order by id desc limit 100) entry),'[]'::jsonb)
  );
end $$;

drop index public.payroll_adjustments_organization_request_uidx;
alter table public.payroll_adjustments drop column request_id;

notify pgrst,'reload schema';
commit;
