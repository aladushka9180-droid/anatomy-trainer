begin;

drop trigger if exists benefit_redemptions_exclusivity_v84 on public.benefit_redemptions;
drop trigger if exists loyalty_redemptions_exclusivity_v84 on public.loyalty_redemptions;
drop trigger if exists loyalty_promo_redemptions_exclusivity_v84 on public.loyalty_promo_redemptions;
drop function if exists public.enforce_minuta_booking_benefit_exclusivity();

commit;
