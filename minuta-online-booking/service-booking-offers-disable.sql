-- Non-destructive rollback: disable new offers and creates, retain settings,
-- snapshots and the resource trigger needed by already accepted visits.
begin;
revoke execute on function public.get_public_minuta_service_offers(text,uuid,uuid),
  public.get_public_minuta_offer_slots(text,uuid,uuid,date,date,jsonb),
  public.book_minuta_service_offers(uuid,text,uuid,uuid,date,time,text,text,integer,integer,text,jsonb),
  public.save_minuta_service_offer(uuid,jsonb) from anon,authenticated;
notify pgrst,'reload schema';
commit;
