begin;

do $$ begin
  if exists(select 1 from public.organization_benefit_settings where enabled) then
    raise exception using errcode='P0001',message='disable_benefits_before_rollback';
  end if;
  if exists(select 1 from public.benefit_products)
     or exists(select 1 from public.client_benefit_instruments)
     or exists(select 1 from public.benefit_redemptions)
     or exists(select 1 from public.benefit_ledger)
     or exists(select 1 from public.benefit_audit_log) then
    raise exception using errcode='P0001',message='export_and_remove_all_benefit_data_before_rollback';
  end if;
end $$;

drop function if exists public.get_minuta_benefit_workspace(uuid);
drop function if exists public.apply_minuta_benefit(uuid,uuid,uuid,text,integer);
drop function if exists public.set_minuta_benefit_status(uuid,uuid,text);
drop function if exists public.issue_minuta_benefit(uuid,uuid,uuid,date,uuid);
drop function if exists public.upsert_minuta_benefit_product(uuid,uuid,text,text,integer,integer,integer,integer,jsonb);
drop function if exists public.set_minuta_benefits_enabled(uuid,boolean);
drop function if exists public.write_minuta_benefit_audit(uuid,text,uuid,jsonb);

drop trigger if exists benefit_ledger_immutable on public.benefit_ledger;
drop function if exists public.protect_minuta_benefit_ledger();
drop trigger if exists benefit_redemptions_scope on public.benefit_redemptions;
drop trigger if exists client_benefit_instruments_scope on public.client_benefit_instruments;
drop trigger if exists benefit_instrument_service_balances_scope on public.benefit_instrument_service_balances;
drop trigger if exists benefit_product_services_scope on public.benefit_product_services;
drop function if exists public.enforce_minuta_benefit_scope();
drop trigger if exists benefit_redemptions_touch on public.benefit_redemptions;
drop trigger if exists client_benefit_instruments_touch on public.client_benefit_instruments;
drop trigger if exists benefit_products_touch on public.benefit_products;
drop trigger if exists organization_benefit_settings_touch on public.organization_benefit_settings;

drop table if exists public.benefit_audit_log;
drop table if exists public.benefit_ledger;
drop table if exists public.benefit_redemptions;
drop table if exists public.benefit_instrument_service_balances;
drop table if exists public.client_benefit_instruments;
drop table if exists public.benefit_product_services;
drop table if exists public.benefit_products;
drop table if exists public.organization_benefit_settings;

commit;
