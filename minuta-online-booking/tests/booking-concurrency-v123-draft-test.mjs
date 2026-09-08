import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const sql=readFileSync(new URL('../supabase-migration-v123.sql',import.meta.url),'utf8');
const rollback=readFileSync(new URL('../supabase-migration-v123-rollback.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const old=readFileSync(new URL('../supabase-migration-v79.sql',import.meta.url),'utf8');

test('production baseline is pinned before any DDL; no unconditional draft bypass',()=>{
 assert.ok(sql.indexOf('v123_schema_drift:')<sql.indexOf('create or replace function'));
 assert.doesNotMatch(sql,/raise exception 'v123_draft/);
 for(const term of ['source_hash','v123_series_baseline_drift','v123_unknown_booking_trigger','v123_overlap_constraints_required','v123_webhook_condition_drift'])assert.ok(sql.includes(term));
 assert.match(sql,/begin;[\s\S]*commit;\s*$/);
});
test('duration-aware block availability is independent of technical service duration',()=>{
 const validation=sql.slice(sql.indexOf('create or replace function public.minuta_block_slot_valid_v123'),sql.indexOf('create or replace function public.create_provider_block_v123'));
 assert.doesNotMatch(validation,/service\.duration_minutes|get_available_slots\(/);
 for(const term of ['provider_schedule','provider_days_off','break_start','break_end','tsrange','minuta_slot_respects_booking_buffer','p_duration','location.timezone','minuta_booking_fits_active_shift','group_booking_events','service_resource_requirements','booking_resource_allocations'])assert.ok(validation.includes(term),term);
 assert.match(validation,/returns boolean language plpgsql volatile/,'post-lock validation must obtain a fresh snapshot');
});
test('HTTP hook keeps opaque arguments and only excludes sentinel blocks; rollback removes exact added condition',()=>{
 for(const source of [sql,rollback])assert.match(source,/pg_get_triggerdef\(t\.oid\)/);
 assert.match(sql,/WHEN \(new\.client_phone <> ''0000000000''\)/);
 assert.match(rollback,/WHEN \(\(new\.client_phone <> ''0000000000''::text\)\)/);
 for(const source of [sql,rollback])assert.doesNotMatch(source,/replace\(definition/,'opaque argument bytes must not be globally replaced');
 assert.doesNotMatch(sql,/disable trigger|session_replication_role|net\.http/i);
});
test('create uses request/date locks, exact replay identity and one full-duration insert',()=>{
 const create=sql.slice(sql.indexOf('create or replace function public.create_provider_block_v123'),sql.indexOf('create or replace function public.manage_minuta_booking_series_v123_core'));
 assert.ok(create.indexOf('pg_advisory_xact_lock')<create.indexOf('insert into public.bookings'));
 assert.match(create,/where id=p_request_id[\s\S]*block_request_conflict/);
 assert.match(create,/values\(p_request_id,[\s\S]*p_date,p_time,p_duration,0,0,'new',0,'not_required'/);
 assert.doesNotMatch(create,/(provider_book_appointment|book_appointment)\s*\(/);
 assert.match(create,/delete from public.notification_outbox where booking_id=v_id/);
 assert.match(create,/refund_status='not_required'/);
});
test('core retains ordered locking and reads anchor again before delta and expected check',()=>{
 const core=sql.slice(sql.indexOf('create or replace function public.manage_minuta_booking_series_v123_core'));
 const fresh=core.indexOf('select booking.* into v_anchor from public.bookings booking where booking.id=p_booking;');
 assert.ok(fresh>core.indexOf('for update;'));
 assert.ok(fresh<core.indexOf('v_delta :='));
 assert.ok(core.indexOf('message=\'series_anchor_changed\'')<core.indexOf('v_delta :='));
 assert.match(core,/v_anchor\.booking_date is distinct from p_expected_date/);
 assert.match(core,/v_anchor\.booking_time is distinct from p_expected_time/);
 assert.match(core,/v_anchor\.series_id is distinct from v_locked_series/);
});
test('only authenticated wrappers exposed; internal validator/core remain private',()=>{
 for(const name of ['minuta_block_slot_valid_v123','manage_minuta_booking_series_v123_core']){
  assert.match(sql,new RegExp('revoke all on function public\\.'+name+'[^;]*from public,anon,authenticated,service_role'));
  assert.doesNotMatch(sql,new RegExp('grant execute on function public\\.'+name));
 }
 assert.doesNotMatch(sql,/grant execute[^;]*to (anon|service_role)/);
});
test('rollback preserves exact v79 implementation and never deletes booking rows',()=>{
 const original=old.slice(old.indexOf('create or replace function public.manage_minuta_booking_series('),old.indexOf('revoke all on function public.create_minuta_recurring_bookings(')).trim().replace(/\r\n/g,'\n');
 assert.ok(rollback.includes(original));assert.doesNotMatch(rollback,/delete from|drop table/i);
});

// Explicit reference-policy unit tests, NOT a PostgreSQL concurrency rehearsal.
const overlap=(a,b)=>a[0]<b[1]&&a[1]>b[0];
const fits=(start,duration,{window=[600,620],breaks=[],occupied=[],buffer=0}={})=>duration>=1&&duration<=480
 &&start>=window[0]&&start+duration<=window[1]
 &&!breaks.some(b=>overlap([start,start+duration],b))
 &&!occupied.some(b=>overlap([start,start+duration],[b[0]-buffer,b[1]+buffer]));
test('reference policy admits 15-minute block in a 20-minute window regardless of service duration',()=>assert.equal(fits(600,15),true));
test('reference policy rejects overrun, day off, break, collision and buffer',()=>{
 for(const [start,duration,options] of [[600,21,{}],[600,15,{window:[0,0]}],[600,15,{breaks:[[610,615]]}],[600,15,{occupied:[[605,610]]}],[600,15,{occupied:[[620,630]],buffer:10}]])assert.equal(fits(start,duration,options),false);
});
test('reference stale series move rejects instead of compounding delta',()=>{
 let anchor=10;const move=(target,expected)=>{if(expected!==null&&anchor!==expected)throw Error('series_anchor_changed');anchor+=target-anchor;};
 move(11,10);assert.throws(()=>move(12,10),/series_anchor_changed/);assert.equal(anchor,11);move(12,null);assert.equal(anchor,12);
});
