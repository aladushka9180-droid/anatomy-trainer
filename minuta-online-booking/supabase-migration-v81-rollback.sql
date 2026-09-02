begin;

drop trigger if exists booking_outcomes_loyalty_reconcile on public.booking_outcomes;
drop function if exists public.get_minuta_loyalty_workspace(uuid);
drop function if exists public.redeem_minuta_promotion(uuid,text,uuid,uuid);
drop function if exists public.set_minuta_promotion_active(uuid,uuid,boolean);
drop function if exists public.upsert_minuta_promotion(uuid,text,text,integer,date,date,integer,integer);
drop function if exists public.redeem_minuta_loyalty(uuid,uuid,integer,uuid);
drop function if exists public.adjust_minuta_loyalty_balance(uuid,uuid,integer,text,uuid);
drop function if exists public.reconcile_minuta_loyalty_visit();
drop function if exists public.upsert_minuta_loyalty_rule(uuid,text,integer,integer,integer);
drop function if exists public.set_minuta_loyalty_enabled(uuid,boolean);

drop table if exists public.loyalty_promo_redemptions;
drop table if exists public.loyalty_promotions;
drop table if exists public.loyalty_redemptions;
drop table if exists public.loyalty_ledger;
drop table if exists public.loyalty_visit_awards;
drop table if exists public.client_loyalty_accounts;
drop table if exists public.loyalty_rules;
drop table if exists public.organization_loyalty_settings;

drop function if exists public.protect_minuta_loyalty_history();
drop function if exists public.get_minuta_loyalty_role(uuid);

commit;
