-- Reverts only the direct authenticated EXECUTE grant from the 42501 repair.
begin;

revoke execute on function public.minuta_normalize_service_name_v160(text) from authenticated;

commit;
