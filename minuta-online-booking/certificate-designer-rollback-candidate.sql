-- Compatibility rollback: stop the new RPC surface while retaining every
-- template, uploaded font and issued snapshot. Never drop or truncate these tables.
begin;
revoke execute on function public.save_minuta_certificate_design(uuid,jsonb),public.get_minuta_certificate_design(uuid,uuid),
  public.get_minuta_certificate_design_workspace(uuid),public.record_minuta_certificate_issue(uuid,jsonb,uuid),
  public.get_minuta_certificate_issue_history(uuid,text,text,jsonb) from authenticated;
commit;
