begin;

lock table public.commercial_sales,public.commercial_sale_lines,public.commercial_sale_refunds in share mode;
do $$ begin
  if exists(
    select 1 from public.commercial_sales s join public.commercial_sale_lines l on l.sale_id=s.id
    where s.organization_id=l.organization_id and (
      (s.refunded_minor=s.total_minor)<>(l.refunded_quantity=l.quantity)
      or s.refunded_minor>s.total_minor or l.refunded_quantity>l.quantity
    )
  ) then
    raise exception using errcode='55000',message='v148_legacy_refund_mismatch';
  end if;
end $$;

create or replace function public.refund_minuta_commercial_sale_v147(
  p_organization uuid,p_sale uuid,p_quantity numeric,p_amount_minor bigint,p_reason text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid; v_sale public.commercial_sales%rowtype; v_line public.commercial_sale_lines%rowtype;
  v_existing public.commercial_sale_refunds%rowtype; v_fingerprint text; v_refund uuid;
  v_revenue uuid; v_transaction uuid; v_movement jsonb; v_expected_amount bigint;
  v_remaining_amount bigint; v_remaining_quantity numeric;
begin
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  if p_request_id is null or coalesce(p_quantity,0)<=0 or coalesce(p_amount_minor,0)<=0
     or char_length(btrim(coalesce(p_reason,'')))<3 then
    raise exception using errcode='22023',message='invalid_commercial_refund';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':commerce-refund:'||p_request_id::text,148));
  select * into v_existing from public.commercial_sale_refunds
    where organization_id=p_organization and request_id=p_request_id for update;
  v_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    p_organization,p_sale,p_quantity,p_amount_minor,btrim(p_reason)));
  if v_existing.id is not null then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='commercial_refund_idempotency_conflict';
    end if;
    return jsonb_build_object('id',v_existing.id,'sale_id',p_sale,'amount_minor',v_existing.amount_minor,'replayed',true);
  end if;
  select * into v_sale from public.commercial_sales
    where id=p_sale and organization_id=p_organization for update;
  select * into v_line from public.commercial_sale_lines
    where sale_id=p_sale and organization_id=p_organization for update;
  if v_sale.id is null or v_line.id is null then
    raise exception using errcode='P0002',message='commercial_sale_not_found';
  end if;
  v_remaining_quantity:=v_line.quantity-v_line.refunded_quantity;
  v_remaining_amount:=v_sale.total_minor-v_sale.refunded_minor;
  if p_quantity>v_remaining_quantity or p_amount_minor>v_remaining_amount then
    raise exception using errcode='22023',message='commercial_refund_exceeds_remaining';
  end if;
  if p_quantity=v_remaining_quantity then
    v_expected_amount:=v_remaining_amount;
  else
    v_expected_amount:=round(
      v_sale.total_minor::numeric*(v_line.refunded_quantity+p_quantity)/v_line.quantity
    )::bigint-v_sale.refunded_minor;
    if v_expected_amount<=0 or v_expected_amount>=v_remaining_amount then
      raise exception using errcode='22023',message='commercial_refund_amount_unallocatable';
    end if;
  end if;
  if p_amount_minor<>v_expected_amount then
    raise exception using errcode='22023',message='commercial_refund_amount_mismatch';
  end if;
  if v_line.item_kind='benefit_product' then
    if p_quantity<>1 or v_line.refunded_quantity<>0
       or p_amount_minor<>v_sale.total_minor-v_sale.refunded_minor
       or exists(select 1 from public.benefit_redemptions
         where instrument_id=v_line.benefit_instrument_id and status in('reserved','redeemed')) then
      raise exception using errcode='55000',message='used_benefit_cannot_be_refunded';
    end if;
    perform public.set_minuta_benefit_status(p_organization,v_line.benefit_instrument_id,'cancelled');
  else
    v_movement:=public.apply_minuta_stock_movement(
      p_organization,v_line.warehouse_id,v_line.inventory_item_id,'receipt',p_quantity,null,
      'Возврат продажи '||p_sale::text,md5(p_request_id::text||':inventory-return')::uuid);
  end if;
  insert into public.commercial_sale_refunds(
    organization_id,sale_id,amount_minor,quantity,reason,request_id,request_fingerprint,created_by
  ) values(
    p_organization,p_sale,p_amount_minor,p_quantity,btrim(p_reason),p_request_id,v_fingerprint,v_actor
  ) returning id into v_refund;
  select id into v_revenue from public.financial_accounts
    where organization_id=p_organization and system_key='product_revenue' and active for update;
  insert into public.financial_transactions(
    organization_id,request_id,request_fingerprint,operation_type,source_type,source_id,
    source_fingerprint,occurred_at,explanation,created_by
  ) values(
    p_organization,md5(p_request_id::text||':finance')::uuid,v_fingerprint,'commercial_refund',
    'commercial_sale_refund',v_refund,v_fingerprint,now(),
    jsonb_build_object('schema','minuta-commerce-v1','sale_id',p_sale,'refund_id',v_refund,
      'quantity',p_quantity,'amount_minor',p_amount_minor,'reason',btrim(p_reason)),v_actor
  ) returning id into v_transaction;
  insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor) values
    (p_organization,v_transaction,v_revenue,'debit',p_amount_minor),
    (p_organization,v_transaction,v_sale.payment_account_id,'credit',p_amount_minor);
  update public.commercial_sale_lines
    set refunded_quantity=refunded_quantity+p_quantity where id=v_line.id;
  update public.commercial_sales
    set refunded_minor=refunded_minor+p_amount_minor,
      status=case when refunded_minor+p_amount_minor=total_minor
        and v_line.refunded_quantity+p_quantity=v_line.quantity then 'refunded' else 'partially_refunded' end
    where id=p_sale;
  insert into public.commercial_audit_log(organization_id,actor_id,action,subject_id,details) values(
    p_organization,v_actor,'commercial_sale_refunded',p_sale,
    jsonb_build_object('refund_id',v_refund,'amount_minor',p_amount_minor,'quantity',p_quantity,'transaction_id',v_transaction));
  return jsonb_build_object('id',v_refund,'sale_id',p_sale,'amount_minor',p_amount_minor,'transaction_id',v_transaction,'replayed',false);
end $$;

revoke all on function public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)
  to authenticated;
comment on function public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)
  is 'minuta_refund_safety_v148_proportional_rounding';

commit;
