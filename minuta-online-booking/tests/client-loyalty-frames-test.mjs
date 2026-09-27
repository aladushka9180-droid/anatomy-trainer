import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const window={addEventListener(){}};
vm.runInNewContext(readFileSync(new URL('../client-loyalty-frames.js',import.meta.url),'utf8'),{window});
const api=window.PrimeTimeLoyaltyFrames;
const thresholds=[0,3,6,9,10,20,30,40,50,60,70,80,90,100];
for(let visits=0;visits<=150;visits++){
  const expected=thresholds.filter(x=>x<=visits).at(-1), rank=api.level(visits);
  assert.equal(rank.threshold,expected); assert.equal(rank.total,visits);
  assert.equal(rank.next,thresholds.find(x=>x>visits)??null);
}
const done=(id,extra={})=>({id,status:'confirmed',outcome:{visit_status:'completed'},...extra});
const result=item=>item.outcome;
const bookings=[done('one',{services:[1,2,3]}),done('one'),done('cancelled',{status:'cancelled'}),done('no-show',{outcome:{visit_status:'no_show'}}),done('scheduled',{booking_date:'2020-01-01',outcome:{visit_status:'scheduled'}}),done('history:1',{is_imported_history:true}),done('history:1',{is_imported_history:true})];
assert.equal(api.count({bookings,imported:{visit_count:7}},result).total,8,'One session regardless of service count; imported total and rows overlap');
assert.equal(api.count({bookings,imported:{visit_count:0}},result).total,2);
assert.equal(api.count({bookings:[done('corrected'),done('corrected',{outcome:{visit_status:'scheduled'}})]},result).total,0,'Latest corrected row wins');
assert.equal(api.count({bookings:[done('one',{outcome:{visit_status:'completed',_sync_pending:true}})]},result).pending,true);
assert.equal(api.level(Infinity).threshold,0);assert.equal(api.level(-5).total,0);
console.log('Loyalty levels: all boundaries 0–150, deduplication, cancellations, no-shows, corrections, imports and pending status PASS');
