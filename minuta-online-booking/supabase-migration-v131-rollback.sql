-- v131 rollback: remove only the additive idempotent provider overload.
-- The legacy five-argument API and every booking/request identity remain intact.
begin;

do $guard$
begin
  if to_regprocedure(
    'public.provider_book_appointment(uuid,date,time without time zone,text,text)'
  ) is null then
    raise exception using errcode = '55000', message = 'v131_rollback_legacy_provider_api_missing';
  end if;
end
$guard$;

drop function if exists public.provider_book_appointment(
  uuid, uuid, date, time without time zone, text, text
);

notify pgrst, 'reload schema';
commit;
