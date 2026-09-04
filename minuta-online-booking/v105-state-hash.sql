with state_parts(value) as (
  select 'function|'||proc.oid::regprocedure::text||'|'||pg_get_functiondef(proc.oid)||'|'||coalesce(proc.proacl::text,'')||'|'||proc.proowner::text
  from pg_proc proc
  join pg_namespace namespace on namespace.oid=proc.pronamespace
  where namespace.nspname='public' and proc.proname in ('register_public_booking_visit','upsert_public_booking_presence')
  union all
  select 'column|'||attribute.attname||'|'||format_type(attribute.atttypid,attribute.atttypmod)||'|'||attribute.attnotnull::text||'|'||coalesce(pg_get_expr(default_value.adbin,default_value.adrelid),'')
  from pg_attribute attribute
  left join pg_attrdef default_value on default_value.adrelid=attribute.attrelid and default_value.adnum=attribute.attnum
  where attribute.attrelid=to_regclass('public.booking_page_visits') and attribute.attnum>0 and not attribute.attisdropped
    and attribute.attname in ('session_id','client_name','client_phone','page_name','source_kind','source_label','first_source_label','last_seen_at')
  union all
  select 'index|'||class.relname||'|'||pg_get_indexdef(index_definition.indexrelid)
  from pg_index index_definition
  join pg_class class on class.oid=index_definition.indexrelid
  join pg_namespace namespace on namespace.oid=class.relnamespace
  where namespace.nspname='public' and class.relname in ('booking_page_visits_owner_session_idx','booking_page_visits_owner_presence_idx','bookings_organization_phone_v105_idx')
  union all
  select 'policy|'||policy.polname||'|'||policy.polcmd::text||'|'||policy.polroles::text||'|'||coalesce(pg_get_expr(policy.polqual,policy.polrelid),'')
  from pg_policy policy
  where policy.polrelid=to_regclass('public.booking_page_visits') and policy.polname='booking_page_visits_owner_read'
)
select coalesce(md5(string_agg(value,E'\n' order by value)),'absent') from state_parts;
