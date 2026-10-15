-- Benefit correctness: certificate ceiling, cancelled state, organization calendar.
-- Exact definition guards preserve concurrent/newer work; no data writes or ACL changes.
-- Apply only through the release owner after protected restore/apply/read/rollback/reapply qualification.
-- Requires the existing v150 organization timezone helper.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('minuta:benefit_correctness:20261015000127',0));
do $benefit_correctness$
declare
  v_plan jsonb; v_edit jsonb; v_oid oid; v_definition text; v_hash text;
  v_definitions text[]:=array[]::text[]; v_signatures text[]:=array[]::text[]; v_expected text[]:=array[]::text[];
  v_index integer;
begin
  if pg_catalog.to_regprocedure('public.get_minuta_benefit_timezone_v150(uuid)') is null then
    raise exception 'benefit_correctness_requires_v150';
  end if;
  -- Validate every function before executing any replacement.
  for v_plan in select value from pg_catalog.jsonb_array_elements($plans$[
  {
    "signature": "public.apply_minuta_benefit(uuid,uuid,uuid,text,integer)",
    "before_md5": "3d25c197cb4765cc36b87157f8b35ac0",
    "after_md5": "9c11741233223cdc930778c85ba33bdb",
    "edits": [
      {
        "old": "v_service_remaining integer;",
        "new": "v_service_remaining integer; v_today date;",
        "occurrences": 1
      },
      {
        "old": "  v_role:=public.get_minuta_benefit_role(p_organization);",
        "new": "  v_role:=public.get_minuta_benefit_role(p_organization);\n  v_today:=pg_catalog.timezone(public.get_minuta_benefit_timezone_v150(p_organization),clock_timestamp())::date;",
        "occurrences": 1
      },
      {
        "old": "or current_date>v_instrument.expires_on",
        "new": "or v_today>v_instrument.expires_on",
        "occurrences": 1
      },
      {
        "old": "expires_on<current_date",
        "new": "expires_on<v_today",
        "occurrences": 1
      },
      {
        "old": "      update public.client_benefit_instruments set remaining_amount_rub=remaining_amount_rub-v_amount where id=p_instrument;",
        "new": "      if v_amount>coalesce(v_booking.total_price_rub,0) then raise exception using errcode='22023',message='certificate_amount_exceeds_booking_price'; end if;\n      update public.client_benefit_instruments set remaining_amount_rub=remaining_amount_rub-v_amount where id=p_instrument;",
        "occurrences": 1
      },
      {
        "old": "status=case when expires_on<v_today then",
        "new": "status=case when status='cancelled' then 'cancelled' when expires_on<v_today then",
        "occurrences": 1
      }
    ]
  },
  {
    "signature": "public.get_minuta_benefit_workspace(uuid)",
    "before_md5": "75efd1d6477d59cafc7f2a0a990726e6",
    "after_md5": "849de2ff853abce9e8e675a595d87eb1",
    "edits": [
      {
        "old": "declare v_role text;",
        "new": "declare v_role text; v_timezone text; v_today date;",
        "occurrences": 1
      },
      {
        "old": "  v_role:=public.get_minuta_benefit_role(p_organization);",
        "new": "  v_role:=public.get_minuta_benefit_role(p_organization);\n  v_timezone:=public.get_minuta_benefit_timezone_v150(p_organization);\n  v_today:=pg_catalog.timezone(v_timezone,clock_timestamp())::date;",
        "occurrences": 1
      },
      {
        "old": "'organization_id',p_organization,'current_role',v_role,",
        "new": "'organization_id',p_organization,'current_role',v_role,\n    'timezone',v_timezone,'business_date',v_today,",
        "occurrences": 1
      },
      {
        "old": "booking.booking_date>=current_date-90",
        "new": "booking.booking_date>=v_today-90",
        "occurrences": 1
      }
    ]
  },
  {
    "signature": "public.issue_minuta_benefit(uuid,uuid,uuid,date,uuid)",
    "before_md5": "9ccab4f7f1562bf3a06fba54d1e0b903",
    "after_md5": "83d7bdf40f068a05437c4384581b8385",
    "edits": [
      {
        "old": "v_expiry date;",
        "new": "v_expiry date; v_today date;",
        "occurrences": 1
      },
      {
        "old": "  v_role:=public.get_minuta_benefit_role(p_organization);",
        "new": "  v_role:=public.get_minuta_benefit_role(p_organization);\n  v_today:=pg_catalog.timezone(public.get_minuta_benefit_timezone_v150(p_organization),clock_timestamp())::date;",
        "occurrences": 1
      },
      {
        "old": "coalesce(p_expires_on,current_date+v_product.validity_days)",
        "new": "coalesce(p_expires_on,v_today+v_product.validity_days)",
        "occurrences": 1
      },
      {
        "old": "v_expiry<current_date or v_expiry>current_date+3650",
        "new": "v_expiry<v_today or v_expiry>v_today+3650",
        "occurrences": 1
      }
    ]
  },
  {
    "signature": "public.release_minuta_reserved_benefit_for_booking(uuid)",
    "before_md5": "7d220cd6122aca1034f4c02f8c0be4f4",
    "after_md5": "dc99d5e291a63e12c0197f7646efdb5b",
    "edits": [
      {
        "old": "v_kind text;",
        "new": "v_kind text; v_today date;",
        "occurrences": 1
      },
      {
        "old": "  if v_redemption is null then return false; end if;",
        "new": "  if v_redemption is null then return false; end if;\n  v_today:=pg_catalog.timezone(public.get_minuta_benefit_timezone_v150(v_organization),clock_timestamp())::date;",
        "occurrences": 1
      },
      {
        "old": "expires_on<current_date",
        "new": "expires_on<v_today",
        "occurrences": 1
      },
      {
        "old": "status=case when expires_on<v_today then",
        "new": "status=case when status='cancelled' then 'cancelled' when expires_on<v_today then",
        "occurrences": 1
      }
    ]
  },
  {
    "signature": "public.reserve_minuta_public_benefit_v115(uuid,uuid,text)",
    "before_md5": "0090e43291f02fd38cb4c2fa736dbbf8",
    "after_md5": "251f05092e5ab6d630f7a6abb6132fc1",
    "edits": [
      {
        "old": "v_today date:=timezone('Europe/Samara',now())::date;",
        "new": "v_today date:=pg_catalog.timezone(public.get_minuta_benefit_timezone_v150(p_organization),clock_timestamp())::date;",
        "occurrences": 1
      }
    ]
  }
]$plans$::jsonb) loop
    v_oid:=pg_catalog.to_regprocedure(v_plan->>'signature');
    if v_oid is null then raise exception 'benefit_correctness_missing_function: %',v_plan->>'signature'; end if;
    v_definition:=pg_catalog.replace(pg_catalog.pg_get_functiondef(v_oid),E'\r\n',E'\n');
    v_hash:=pg_catalog.md5(v_definition);
    if v_hash=v_plan->>'after_md5' then continue; end if;
    if v_hash<>v_plan->>'before_md5' then
      raise exception 'benefit_correctness_definition_changed: %',v_plan->>'signature';
    end if;
    for v_edit in select value from pg_catalog.jsonb_array_elements(v_plan->'edits') loop
      if (pg_catalog.length(v_definition)-pg_catalog.length(pg_catalog.replace(v_definition,v_edit->>'old',''))) / pg_catalog.length(v_edit->>'old') <> (v_edit->>'occurrences')::integer then
        raise exception 'benefit_correctness_fragment_changed: %',v_plan->>'signature';
      end if;
      v_definition:=pg_catalog.replace(v_definition,v_edit->>'old',v_edit->>'new');
    end loop;
    if pg_catalog.md5(v_definition)<>v_plan->>'after_md5' then raise exception 'benefit_correctness_result_mismatch'; end if;
    v_definitions:=pg_catalog.array_append(v_definitions,v_definition);
    v_signatures:=pg_catalog.array_append(v_signatures,v_plan->>'signature');
    v_expected:=pg_catalog.array_append(v_expected,v_plan->>'after_md5');
  end loop;
  for v_index in 1..coalesce(pg_catalog.array_length(v_definitions,1),0) loop
    execute v_definitions[v_index];
    if pg_catalog.md5(pg_catalog.replace(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(v_signatures[v_index])),E'\r\n',E'\n'))<>v_expected[v_index] then
      raise exception 'benefit_correctness_installed_mismatch: %',v_signatures[v_index];
    end if;
  end loop;
end $benefit_correctness$;
commit;
