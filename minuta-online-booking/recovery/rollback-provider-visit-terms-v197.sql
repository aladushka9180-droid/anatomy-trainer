-- Source-only rollback BEFORE the first v197 mutation. Not production admission.
-- Refuses to discard receipts or one-minute history. Never delete data to force it.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
-- Do not wait in a lock cycle with active readers/writers. A busy target must retry
-- only after the release owner has established the normal quiescence gate.
lock table public.booking_session_revisions,public.provider_visit_terms_edits_v197
  in access exclusive mode nowait;

do $rollback_guard$
declare
  f record;
  p record;
  t record;
begin
  for f in select * from (values
    ('public.minuta_visit_terms_snapshot_v197(public.bookings)','23ce854e0d7b4f349219c801612dfb135666b62a0796c7308cd57f06b0405808',false,'s'),
    ('public.get_minuta_visit_terms_v197(uuid)','db1529cd77eb68d8b57435a99418d3471559c7772d5ec544312a5693d1b7d2ac',true,'s'),
    ('public.save_minuta_visit_terms_v197(uuid,uuid,jsonb,numeric,numeric)','81ee43060aae99d81b7dd001846853c14c8a844b185a3a62e72a2fe8f38b026a',true,'v')
  ) as expected(signature,body_hash,security_definer,volatility) loop
    select q.*,pg_catalog.pg_get_userbyid(q.proowner) as owner_name,
      pg_catalog.obj_description(q.oid,'pg_proc') as source_stamp
      into p from pg_catalog.pg_proc q where q.oid=to_regprocedure(f.signature);
    if not found or p.owner_name<>'postgres' or p.prosecdef<>f.security_definer
      or p.provolatile::text<>f.volatility or p.prokind<>'f' or p.proretset
      or p.prorettype<>'jsonb'::regtype or p.prolang not in
        (select oid from pg_catalog.pg_language where lanname in ('sql','plpgsql'))
      or p.proconfig is distinct from array['search_path=""']::text[]
      or encode(pg_catalog.sha256(convert_to(replace(p.prosrc,E'\r',''),'UTF8')),'hex')<>f.body_hash
      or p.source_stamp is distinct from 'minuta_visit_terms_v197:sha256='||f.body_hash then
      raise exception using errcode='55000',message='v197_rollback_function_drift';
    end if;
    if exists(select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      where a.grantee<>p.proowner and not
        (f.security_definer and a.grantee='authenticated'::regrole and a.privilege_type='EXECUTE' and not a.is_grantable))
      or (select count(*) from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        where a.grantee='authenticated'::regrole and a.privilege_type='EXECUTE' and not a.is_grantable)
        <>(case when f.security_definer then 1 else 0 end) then
      raise exception using errcode='55000',message='v197_rollback_function_acl_drift';
    end if;
  end loop;
  select c.*,pg_catalog.pg_get_userbyid(c.relowner) as owner_name into t
    from pg_catalog.pg_class c where c.oid='public.provider_visit_terms_edits_v197'::regclass;
  if t.owner_name<>'postgres' or t.relkind<>'r' or t.relpersistence<>'p'
    or not t.relrowsecurity or not t.relforcerowsecurity or t.relispartition
    or exists(select 1 from pg_catalog.aclexplode(coalesce(t.relacl,pg_catalog.acldefault('r',t.relowner))) a where a.grantee<>t.relowner)
    or exists(select 1 from pg_catalog.pg_attribute a where a.attrelid=t.oid and a.attnum>0 and a.attacl is not null)
    or exists(select 1 from pg_catalog.pg_policy q where q.polrelid=t.oid)
    or exists(select 1 from pg_catalog.pg_trigger q where q.tgrelid=t.oid and not q.tgisinternal)
    or (select jsonb_agg(jsonb_build_array(a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,
        a.attidentity,a.attgenerated,pg_catalog.pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
      from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=t.oid and a.attnum>0 and not a.attisdropped)
      is distinct from '[
        ["request_id","uuid",true,"","",null],["performer_id","uuid",true,"","",null],
        ["organization_id","uuid",true,"","",null],["booking_id","uuid",true,"","",null],
        ["request_fingerprint","text",true,"","",null],["result","jsonb",true,"","",null],
        ["created_at","timestamp with time zone",true,"","","clock_timestamp()"]]'::jsonb
    or (select jsonb_agg(jsonb_build_array(c.conname,c.contype,pg_catalog.pg_get_constraintdef(c.oid),
        c.convalidated,c.condeferrable,c.condeferred) order by c.conname)
      from pg_catalog.pg_constraint c where c.conrelid=t.oid)
      is distinct from $constraints$[
        ["provider_visit_terms_edits_v197_pkey","p","PRIMARY KEY (request_id)",true,false,false],
        ["provider_visit_terms_edits_v197_request_fingerprint_check","c","CHECK ((length(request_fingerprint) = 64))",true,false,false],
        ["provider_visit_terms_edits_v197_result_check","c","CHECK ((jsonb_typeof(result) = 'object'::text))",true,false,false]
      ]$constraints$::jsonb
    or (select jsonb_agg(jsonb_build_array(pg_catalog.pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready,i.indislive,i.indisprimary) order by i.indexrelid)
      from pg_catalog.pg_index i where i.indrelid=t.oid)
      is distinct from '[["CREATE UNIQUE INDEX provider_visit_terms_edits_v197_pkey ON public.provider_visit_terms_edits_v197 USING btree (request_id)",true,true,true,true]]'::jsonb then
    raise exception using errcode='55000',message='v197_rollback_receipt_table_drift';
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint c
    where c.conrelid='public.booking_session_revisions'::regclass
      and c.conname='booking_session_revisions_total_duration_minutes_check'
      and pg_catalog.pg_get_constraintdef(c.oid)='CHECK (((total_duration_minutes >= 1) AND (total_duration_minutes <= 480)))') then
    raise exception using errcode='55000',message='v197_rollback_revision_contract_drift';
  end if;
  if exists(select 1 from public.provider_visit_terms_edits_v197)
    or exists(select 1 from public.booking_session_revisions where total_duration_minutes<5) then
    raise exception using errcode='55000',message='v197_rollback_data_retention_hold';
  end if;
end
$rollback_guard$;

-- No CASCADE: unexpected dependent objects also stop the transaction.
drop function public.save_minuta_visit_terms_v197(uuid,uuid,jsonb,numeric,numeric);
drop function public.get_minuta_visit_terms_v197(uuid);
drop function public.minuta_visit_terms_snapshot_v197(public.bookings);
drop table public.provider_visit_terms_edits_v197;
alter table public.booking_session_revisions
  drop constraint booking_session_revisions_total_duration_minutes_check;
alter table public.booking_session_revisions
  add constraint booking_session_revisions_total_duration_minutes_check
  check(total_duration_minutes between 5 and 480);
notify pgrst,'reload schema';
commit;
