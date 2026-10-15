-- Removes only this function patch. Existing truthful unconsumed markers and
-- their audit entries are deliberately retained; rollback does not deduct stock.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare r record; v_oid oid; v_body text; v_original text; v_definition text;
begin
  perform pg_advisory_xact_lock(98014516);
  for r in select * from (values
    ('public.consume_minuta_inventory_for_booking(uuid)','4ce8a73e07e108bcd45db5a4f7b993b3')
  ) as expected(signature,body_md5) loop
    v_oid:=to_regprocedure(r.signature)::oid;
    if v_oid is null then raise exception 'historical_inventory_prerequisite_missing'; end if;
    select prosrc,pg_get_functiondef(oid) into v_body,v_definition from pg_catalog.pg_proc where oid=v_oid;
    v_original:=regexp_replace(v_body,'(?s)\n-- historical-inventory-v1:handler:start\n.*?-- historical-inventory-v1:handler:end\n',E'\n');
    v_original:=regexp_replace(v_original,'(?s)  -- historical-inventory-v1:clear:start\n.*?  -- historical-inventory-v1:clear:end\n','');
    if md5(v_original)<>r.body_md5 then raise exception 'historical_inventory_unknown_definition'; end if;
    if v_original<>v_body then execute replace(v_definition,v_body,v_original); end if;
  end loop;
end;
$patch$;
notify pgrst,'reload schema';
commit;
