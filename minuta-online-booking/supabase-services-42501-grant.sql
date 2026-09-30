-- A services expression index invokes this pure normalization function for each INSERT.
-- v160 revoked its EXECUTE privilege from authenticated, yielding SQLSTATE 42501.
begin;

do $guard$
begin
  if to_regclass('public.services_normalized_name_v160_idx') is null
     or to_regprocedure('public.minuta_normalize_service_name_v160(text)') is null then
    raise exception using errcode = '55000', message = 'services_42501_contract_missing';
  end if;
end;
$guard$;

grant execute on function public.minuta_normalize_service_name_v160(text) to authenticated;

commit;
