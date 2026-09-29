import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.MINUTA_PGLITE_MODULE;
if (!modulePath) throw new Error('Set MINUTA_PGLITE_MODULE to an isolated @electric-sql/pglite dist/index.js');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const db = new PGlite();
const id = {
  orgA:'10000000-0000-4000-8000-000000000175', orgB:'20000000-0000-4000-8000-000000000175',
  locA:'30000000-0000-4000-8000-000000000175', locB:'40000000-0000-4000-8000-000000000175',
  masterA:'50000000-0000-4000-8000-000000000175', masterB:'60000000-0000-4000-8000-000000000175',
  serviceA:'70000000-0000-4000-8000-000000000175', serviceB:'80000000-0000-4000-8000-000000000175',
  serviceC:'90000000-0000-4000-8000-000000000175',
};
const uid = n => `a0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scalar = async (sql, params=[]) => Object.values((await db.query(sql, params)).rows[0])[0];
const count = async (table, route) => Number(await scalar(`select count(*) from public.${table} where request_id=$1`, [route]));
const call = (route, items, transitions=[]) => db.query(
  'select public.book_minuta_multi_resource_route_v176($1::uuid,$2,$3,$4::jsonb,$5::jsonb) as result',
  [route,'V176 client','+79990001750',JSON.stringify(items),JSON.stringify(transitions)],
);
const expectFailure = async (action, message) => {
  await assert.rejects(action, new RegExp(message));
};
let requestIndex = 100;
const next = () => uid(requestIndex++);
const makeItems = (routeDate, first, second, options={}) => [
  {request_id:next(),organization_slug:'v176-a',location_id:id.locA,performer_id:id.masterA,
    service_id:id.serviceA,booking_date:routeDate,booking_time:first,expected_price_rub:1750,expected_duration_minutes:30},
  {request_id:next(),organization_slug:options.sameOrg?'v176-a':'v176-b',
    location_id:options.sameOrg?id.locA:id.locB,performer_id:id.masterB,
    service_id:options.sameOrg?id.serviceC:id.serviceB,booking_date:routeDate,booking_time:second,
    expected_price_rub:options.sameOrg?1950:1850,expected_duration_minutes:30},
];
const evidence = async (route, evidenceId, departure, minutes=20, stale=false) => {
  await db.query(`insert into public.public_route_travel_evidence_v176(
    id,route_request_id,from_location_id,to_location_id,departure_at,travel_minutes,
    route_mode,provider_reference,measured_at,expires_at
  ) values($1,$2,$3,$4,$5,$6,'driving','isolated-test-provider-v1',
    now() - interval '2 minutes',now() + interval '${stale ? '-1' : '10'} minutes')`,
    [evidenceId,route,id.locA,id.locB,departure,minutes]);
};

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema extensions;
    create function extensions.digest(data bytea,algorithm text)
      returns bytea language sql immutable as 'select pg_catalog.sha256($1)';
    create table public.organizations(id uuid primary key,public_slug text unique,status text,
      public_booking_enabled boolean);
    create table public.locations(id uuid primary key,organization_id uuid references public.organizations(id),
      timezone text,active boolean,unique(id,organization_id));
    create table public.performer_profiles(id uuid primary key);
    create table public.services(id uuid primary key,performer_id uuid references public.performer_profiles(id),
      name text,price_rub integer,duration_minutes integer,active boolean);
    create table public.organization_memberships(organization_id uuid,user_id uuid,active boolean,is_bookable boolean);
    create table public.bookings(
      id uuid primary key default gen_random_uuid(),request_id uuid unique,
      organization_id uuid,location_id uuid,performer_id uuid,service_id uuid,
      booking_date date,booking_time time,duration_minutes integer,
      original_price_rub integer,total_price_rub integer,
      booking_code text,manage_token uuid,status text
    );
    create table public.public_multi_service_routes_v167(request_id uuid primary key);
    create function public.book_minuta_multi_service_route_v167(uuid,text,uuid,text,text,jsonb)
      returns jsonb language sql as 'select jsonb_build_object(''result_code'',''stub'')';
    create function public.get_public_minuta_catalog_v5(slug text) returns jsonb language sql stable as $catalog$
      select jsonb_build_object('services',coalesce(jsonb_agg(jsonb_build_object(
        'id',service.id,'performer_id',service.performer_id,
        'location_ids',jsonb_build_array(location.id)
      )),'[]'::jsonb))
      from public.organizations organization
      join public.organization_memberships membership on membership.organization_id=organization.id
        and membership.active and membership.is_bookable
      join public.services service on service.performer_id=membership.user_id and service.active
      join public.locations location on location.organization_id=organization.id and location.active
      where organization.public_slug=slug
    $catalog$;
    create function public.get_available_slots(service_id uuid,start_date date,end_date date,
      ignore_booking_id uuid default null)
      returns table(booking_date date,booking_time time) language sql stable as $slots$
      select start_date,t.slot_time from (values(time '09:00'),(time '10:00'),
        (time '11:00'),(time '12:00'),(time '13:00'),(time '14:00'),
        (time '15:00'),(time '16:00')) t(slot_time)
      where not exists(select 1 from public.bookings booking
        where booking.service_id=service_id and booking.booking_date=start_date
          and booking.booking_time=t.slot_time)
    $slots$;
    create function public.book_minuta_appointment_v2(
      p_request_id uuid,p_slug text,p_location uuid,p_service uuid,p_date date,p_time time,
      p_client_name text,p_client_phone text,p_expected_price_rub integer,p_expected_duration_minutes integer
    ) returns table(
      result_code text,booking_code text,manage_token uuid,request_id uuid,service_id uuid,
      booking_date date,booking_time time,duration_minutes integer,original_price_rub integer,
      total_price_rub integer,status text,current_price_rub integer,current_duration_minutes integer
    ) language plpgsql security definer set search_path to '' as $stub$
    declare v_org uuid; v_performer uuid; v_name text; v_code text; v_token uuid;
    begin
      select organization.id into v_org from public.organizations organization
        where organization.public_slug=p_slug;
      select service.performer_id,service.name into v_performer,v_name from public.services service
        where service.id=p_service;
      if v_name='FAIL' then raise exception 'synthetic_second_insert_failure'; end if;
      v_code:='V176-'||left(p_request_id::text,8); v_token:=gen_random_uuid();
      insert into public.bookings(request_id,organization_id,location_id,performer_id,service_id,
        booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,
        booking_code,manage_token,status)
      values(p_request_id,v_org,p_location,v_performer,p_service,p_date,p_time,
        p_expected_duration_minutes,p_expected_price_rub,p_expected_price_rub,v_code,v_token,'confirmed');
      return query select 'ok'::text,v_code,v_token,p_request_id,p_service,p_date,p_time,
        p_expected_duration_minutes,p_expected_price_rub,p_expected_price_rub,'confirmed'::text,
        p_expected_price_rub,p_expected_duration_minutes;
    end
    $stub$;
    comment on function public.book_minuta_appointment_v2(
      uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer
    ) is 'minuta_atomic_create_v153:sha256=isolated-test-stub';
  `);
  await db.query(`insert into public.organizations values
    ($1,'v176-a','active',true),($2,'v176-b','active',true)`,[id.orgA,id.orgB]);
  await db.query(`insert into public.locations values
    ($1,$2,'Europe/Samara',true),($3,$4,'Europe/Samara',true)`,
    [id.locA,id.orgA,id.locB,id.orgB]);
  await db.query('insert into public.performer_profiles values($1),($2)',[id.masterA,id.masterB]);
  await db.query(`insert into public.organization_memberships values
    ($1,$2,true,true),($3,$4,true,true),($1,$4,true,true)`,
    [id.orgA,id.masterA,id.orgB,id.masterB]);
  await db.query(`insert into public.services values
    ($1,$2,'A',1750,30,true),($3,$4,'B',1850,30,true),($5,$4,'C',1950,30,true)`,
    [id.serviceA,id.masterA,id.serviceB,id.masterB,id.serviceC]);
  const legacyDefinitions = (await db.query(`select
    pg_get_functiondef('public.book_minuta_multi_service_route_v167(uuid,text,uuid,text,text,jsonb)'::regprocedure) as route,
    pg_get_functiondef('public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)'::regprocedure) as single`)).rows[0];
  await db.exec(read('supabase-migration-v176.sql'));
  assert.deepEqual((await db.query(`select
    pg_get_functiondef('public.book_minuta_multi_service_route_v167(uuid,text,uuid,text,text,jsonb)'::regprocedure) as route,
    pg_get_functiondef('public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)'::regprocedure) as single`)).rows[0], legacyDefinitions);
  assert.equal(await scalar(`select has_function_privilege('anon',
    'public.book_minuta_multi_resource_route_v176(uuid,text,text,jsonb,jsonb)','execute')`),false);
  assert.equal(await scalar(`select has_table_privilege('anon',
    'public.public_route_travel_evidence_v176','select')`),false);
  // The launch migration is closed; enable only this in-memory test role.
  await db.exec(`grant execute on function public.book_minuta_multi_resource_route_v176(uuid,text,text,jsonb,jsonb) to anon`);

  const routeDate = await scalar('select (current_date+1)::text');
  const legacy = await scalar(`select public.book_minuta_multi_service_route_v167($1::uuid,'v176-a',$2::uuid,
    'Legacy client','+79990001760','[]'::jsonb)`,[next(),id.locA]);
  assert.equal(legacy.result_code,'stub');
  const singleRequest = next();
  const single = (await db.query(`select * from public.book_minuta_appointment_v2(
    $1::uuid,'v176-a',$2::uuid,$3::uuid,$4::date,time '17:00',
    'Single client','+79990001761',1750,30)`,
    [singleRequest,id.locA,id.serviceA,routeDate])).rows[0];
  assert.equal(single.result_code,'ok');
  assert.equal(Number(await scalar('select count(*) from public.bookings where request_id=$1',[singleRequest])),1);
  const oldRouteId = next();
  await db.query('insert into public.public_multi_service_routes_v167(request_id) values($1)',[oldRouteId]);
  const oldRouteItems = makeItems(routeDate,'11:00','12:00');
  await db.exec('set role anon');
  await expectFailure(() => call(oldRouteId,oldRouteItems),'multi_resource_item_request_conflict');
  await db.exec('reset role');
  assert.equal(await count('public_multi_resource_routes_v176',oldRouteId),0);
  const reusedRequestRoute = next();
  const reusedRequestItems = makeItems(routeDate,'11:00','12:00');
  reusedRequestItems[0].request_id = singleRequest;
  await db.exec('set role anon');
  await expectFailure(() => call(reusedRequestRoute,reusedRequestItems),'multi_resource_item_request_conflict');
  await db.exec('reset role');
  assert.equal(await count('public_multi_resource_routes_v176',reusedRequestRoute),0);
  const route = next(); const items = makeItems(routeDate,'09:00','10:00');
  const travel = next();
  const departure = await scalar(`select (($1::date+time '09:30') at time zone 'Europe/Samara')::text`,[routeDate]);
  await evidence(route,travel,departure);
  await db.exec('set role anon');
  const created = (await call(route,items,[{position:1,evidence_id:travel}])).rows[0].result;
  assert.equal(created.result_code,'ok');
  assert.equal(created.idempotent,false);
  assert.equal(created.bookings.length,2);
  assert.deepEqual(created.bookings.map(b=>b.organization_id),[id.orgA,id.orgB]);
  const replayed = (await call(route,items,[{position:1,evidence_id:travel}])).rows[0].result;
  assert.equal(replayed.idempotent,true);
  assert.deepEqual(replayed.bookings,created.bookings);
  await expectFailure(() => call(route,[{...items[0],expected_price_rub:1},items[1]],
    [{position:1,evidence_id:travel}]),'multi_resource_request_conflict');
  await db.exec('reset role');

  const noTravelRoute=next(); const noTravelItems=makeItems(routeDate,'11:00','12:00');
  await db.exec('set role anon');
  await expectFailure(() => call(noTravelRoute,noTravelItems),'trusted_travel_evidence_required');
  await db.exec('reset role');
  assert.equal(await count('public_multi_resource_routes_v176',noTravelRoute),0);

  const wrongScopeRoute=next(); const wrongScopeItems=makeItems(routeDate,'13:00','14:00');
  wrongScopeItems[1].location_id=id.locA;
  await db.exec('set role anon');
  await expectFailure(() => call(wrongScopeRoute,wrongScopeItems),'location_unavailable');
  await db.exec('reset role');

  const sameOrgRoute=next(); const sameOrgItems=makeItems(routeDate,'11:00','12:00',{sameOrg:true});
  await db.exec('set role anon');
  const sameOrg=(await call(sameOrgRoute,sameOrgItems)).rows[0].result;
  assert.deepEqual(sameOrg.bookings.map(b=>b.performer_id),[id.masterA,id.masterB]);
  await db.exec('reset role');

  const overlapRoute=next(); const overlapItems=makeItems(routeDate,'15:00','15:00',{sameOrg:true});
  await db.exec('set role anon');
  await expectFailure(() => call(overlapRoute,overlapItems),'multi_resource_route_overlap');
  await db.exec('reset role');
  assert.equal(await count('public_multi_resource_routes_v176',overlapRoute),0);

  const departure15 = await scalar(`select (($1::date+time '15:30') at time zone 'Europe/Samara')::text`,[routeDate]);
  const slowRoute=next(); const slowItems=makeItems(routeDate,'15:00','16:00');
  const slowEvidence=next();
  await evidence(slowRoute,slowEvidence,departure15,45);
  await db.exec('set role anon');
  await expectFailure(() => call(slowRoute,slowItems,[{position:1,evidence_id:slowEvidence}]),
    'trusted_travel_evidence_required');
  await db.exec('reset role');

  const staleRoute=next(); const staleItems=makeItems(routeDate,'15:00','16:00');
  const staleEvidence=next();
  await evidence(staleRoute,staleEvidence,departure15,20,true);
  await db.exec('set role anon');
  await expectFailure(() => call(staleRoute,staleItems,[{position:1,evidence_id:staleEvidence}]),
    'trusted_travel_evidence_required');
  await db.exec('reset role');

  const timezoneRoute=next(); const timezoneItems=makeItems(routeDate,'15:00','16:00');
  await db.query(`update public.locations set timezone='Europe/Moscow' where id=$1`,[id.locB]);
  await db.exec('set role anon');
  await expectFailure(() => call(timezoneRoute,timezoneItems),'location_unavailable');
  await db.exec('reset role');
  await db.query(`update public.locations set timezone='Europe/Samara' where id=$1`,[id.locB]);

  const driftRoute=next(); const driftItems=makeItems(routeDate,'15:00','16:00');
  driftItems[1].expected_price_rub=1800;
  await db.exec('set role anon');
  await expectFailure(() => call(driftRoute,driftItems),'multi_resource_terms_changed');
  await db.exec('reset role');

  const failureRoute=next(); const failureItems=makeItems(routeDate,'13:00','14:00');
  const failureEvidence=next();
  const failureDeparture = await scalar(`select (($1::date+time '13:30') at time zone 'Europe/Samara')::text`,[routeDate]);
  await evidence(failureRoute,failureEvidence,failureDeparture);
  await db.query(`update public.services set name='FAIL' where id=$1`,[id.serviceB]);
  await db.exec('set role anon');
  await expectFailure(() => call(failureRoute,failureItems,[{position:1,evidence_id:failureEvidence}]),
    'synthetic_second_insert_failure');
  await db.exec('reset role');
  assert.equal(await count('public_multi_resource_routes_v176',failureRoute),0);
  assert.equal(Number(await scalar('select count(*) from public.bookings where request_id=$1 or request_id=$2',
    [failureItems[0].request_id,failureItems[1].request_id])),0);

  if (process.env.MINUTA_V176_NATIVE_CONCURRENCY === '1') {
    const second = new PGlite();
    const observer = new PGlite();
    const raceRoute = next();
    const raceItems = makeItems(routeDate,'13:00','14:00',{sameOrg:true});
    const raceSql = 'select public.book_minuta_multi_resource_route_v176($1::uuid,$2,$3,$4::jsonb,$5::jsonb) as result';
    try {
      await second.exec('set role anon');
      const secondPid = (await second.query('select pg_backend_pid() as pid')).rows[0].pid;
      await db.exec('begin; set role anon');
      const firstResult = (await call(raceRoute,raceItems)).rows[0].result;
      const waiting = second.query(raceSql,
        [raceRoute,'V176 client','+79990001750',JSON.stringify(raceItems),'[]']);
      let locked = false;
      for (let attempt=0; attempt<30; attempt++) {
        locked = (await observer.query(`select wait_event_type='Lock' as locked
          from pg_stat_activity where pid=$1`,[secondPid])).rows[0]?.locked === true;
        if (locked) break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      assert.equal(locked,true,'duplicate route must wait for first transaction lock');
      await db.exec('commit; reset role');
      const secondResult = (await waiting).rows[0].result;
      assert.equal(firstResult.idempotent,false);
      assert.equal(secondResult.idempotent,true);
      assert.deepEqual(secondResult.bookings,firstResult.bookings);
      assert.equal(await count('public_multi_resource_routes_v176',raceRoute),1);
      console.log('v176 native PostgreSQL: concurrent duplicate waits and replays one complete route PASS');
    } finally {
      await db.exec('rollback; reset role');
      await second.close();
      await observer.close();
    }
  }

  await db.exec(read('supabase-migration-v176-rollback.sql'));
  assert.equal(await scalar(`select has_function_privilege('anon',
    'public.book_minuta_multi_resource_route_v176(uuid,text,text,jsonb,jsonb)','execute')`),false);
  assert.equal(await count('public_multi_resource_routes_v176',route),1);
  await db.exec(read('supabase-migration-v176.sql'));
  assert.equal(await scalar(`select has_function_privilege('anon',
    'public.book_minuta_multi_resource_route_v176(uuid,text,text,jsonb,jsonb)','execute')`),false);
  assert.equal(await count('public_multi_resource_routes_v176',route),1);
  console.log('v176 PGlite: cross-org, multi-performer, replay, rights, stale/slow/no travel, overlap, timezone/terms, atomic rollback, reapply PASS');
} finally {
  await db.close();
}
