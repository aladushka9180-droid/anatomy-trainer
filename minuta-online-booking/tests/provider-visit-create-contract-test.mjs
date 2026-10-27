import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureVisitTerms } from '../provider-visit-terms.mjs';
import { captureVisitCreationEnvelope, restoreVisitCreationEnvelope,
  visitCreationFingerprintCanonical, visitCreationReceiptMatches } from '../provider-visit-create-contract.mjs';

const id = number => `00000000-0000-4000-8000-${String(number).padStart(12,'0')}`;
const catalog = { id:id(10),duration_minutes:1,price_rub:20 };
const chosen = (rate=0,minutes=1) => captureVisitTerms({ actorId:id(11),organizationId:id(12),service:catalog,minuteRateRub:rate,durationMinutes:minutes });
const parts = (minutes=1) => ['new-booking',catalog.id,'2028-02-29','12:30','Synthetic Client','70000000000',minutes,'note','default','','',0,''];
const primary = terms => ({ kind:'primary',service_id:terms.serviceId,title:'Synthetic service',duration_minutes:terms.durationMinutes,price_rub:terms.primaryAmountRub,extends_duration:true });
function capture(options={}) {
  const terms=options.terms??chosen();
  return captureVisitCreationEnvelope({ requestId:id(1),locationId:id(2),legacyParts:parts(terms.durationMinutes),
    terms,items:[primary(terms)],...options });
}
const clone = value => JSON.parse(JSON.stringify(value));
function receipt(envelope) {
  return { version:1,requestId:envelope.requestId,actorId:envelope.terms.actorId,
    organizationId:envelope.terms.organizationId,locationId:envelope.locationId,
    requestCanonical:visitCreationFingerprintCanonical(envelope),
    occurrences:envelope.occurrences.map((occurrence,index) => ({ ...occurrence,bookingId:id(100+index),
      terms:clone(envelope.terms),session:clone(envelope.session),
      revision:{ id:id(200+index),bookingId:id(100+index),actorId:envelope.terms.actorId,
        items:clone(envelope.session.items),totalAmountRub:envelope.session.totalAmountRub,totalDurationMinutes:envelope.session.totalDurationMinutes } })) };
}

test('zero and exact one-minute creation are frozen across JSON without a five-minute revision', () => {
  const e=capture(),stored=clone(e),restored=restoreVisitCreationEnvelope(stored);
  assert.equal(restored.terms.minuteRateRub,0);assert.equal(restored.session.totalAmountRub,0);
  assert.equal(restored.session.totalDurationMinutes,1);assert.equal(restored.session.items[0].duration_minutes,1);
  assert.equal(visitCreationFingerprintCanonical(restored),visitCreationFingerprintCanonical(e));
  assert.equal(visitCreationReceiptMatches(e,receipt(e)),true);
  const wrong=receipt(e);wrong.occurrences[0].revision.totalDurationMinutes=5;
  assert.equal(visitCreationReceiptMatches(e,wrong),false);
});

test('capture owns all input primitives and nested arrays before an await', async () => {
  const terms=chosen(23,36),legacy=parts(36),items=[primary(terms)],requestIds=[id(1)];
  const e=capture({terms,legacyParts:legacy,items,occurrenceRequestIds:requestIds});
  const canonical=visitCreationFingerprintCanonical(e);
  legacy[4]='changed';items[0].price_rub=99;requestIds[0]=id(9);
  const old=catalog.price_rub;catalog.price_rub=99;
  try {
    await Promise.resolve();
    assert.equal(visitCreationFingerprintCanonical(e),canonical);
    assert.equal(e.session.totalAmountRub,828);
    for(const value of [e,e.legacyParts,e.terms,e.session,e.session.items,e.session.items[0],e.occurrences,e.occurrences[0]])assert.equal(Object.isFrozen(value),true);
    assert.throws(()=>{e.session.items[0].price_rub=900;},TypeError);
  } finally { catalog.price_rub=old; }
});

test('series IDs survive reload and weekly date arithmetic while incomplete coverage remains unconfirmed', () => {
  const e=capture({ occurrenceRequestIds:[id(3),id(4),id(5)],intervalWeeks:1 });
  assert.deepEqual(e.occurrences.map(x=>x.date),['2028-02-29','2028-03-07','2028-03-14']);
  const restored=restoreVisitCreationEnvelope(clone(e));
  assert.deepEqual(restored,e);assert.equal(restored.requestId,id(1));
  assert.equal(visitCreationReceiptMatches(e,receipt(restored)),true);
  const partial=receipt(e);partial.occurrences.pop();assert.equal(visitCreationReceiptMatches(e,partial),false);
  const duplicate=receipt(e);duplicate.occurrences[1].bookingId=duplicate.occurrences[0].bookingId;
  duplicate.occurrences[1].revision.bookingId=duplicate.occurrences[0].bookingId;
  assert.equal(visitCreationReceiptMatches(e,duplicate),false);
  const duplicateRevision=receipt(e);duplicateRevision.occurrences[1].revision.id=duplicateRevision.occurrences[0].revision.id;
  assert.equal(visitCreationReceiptMatches(e,duplicateRevision),false);
});

test('existing repeat signature and primary rate stay separate from add-ons and the whole session', () => {
  const terms=chosen(23,36),legacy=parts(41);
  legacy[0]='repeat-booking';legacy[9]=id(90);legacy[10]='source-signature';legacy[11]=928;
  const addon={kind:'addon',service_id:null,title:'Synthetic addon',duration_minutes:5,price_rub:100,extends_duration:true};
  const e=capture({terms,legacyParts:legacy,items:[primary(terms),addon]});
  assert.equal(e.terms.minuteRateRub,23);assert.equal(e.session.items[0].price_rub,828);
  assert.equal(e.session.totalAmountRub,928);assert.equal(e.session.totalDurationMinutes,41);
  assert.equal(visitCreationReceiptMatches(e,receipt(e)),true);
  assert.throws(()=>capture({terms,legacyParts:legacy,items:[{...primary(terms),price_rub:928},addon]}),/inconsistent_create_primary/);
});

test('any changed terms, body, scope or occurrence identity has a different frozen canonical', () => {
  const e=capture(),original=visitCreationFingerprintCanonical(e);
  const changedClient=parts();changedClient[4]='Different Client';
  const changedSource=parts();changedSource[0]='repeat-booking';changedSource[9]=id(90);changedSource[10]='signature';
  for(const changed of [capture({terms:chosen(25,1)}),capture({terms:chosen(0,2)}),capture({legacyParts:changedClient}),
    capture({locationId:id(99)}),capture({requestId:id(88)}),capture({legacyParts:changedSource}),
    capture({occurrenceRequestIds:[id(3),id(4)],intervalWeeks:1}),capture({occurrenceRequestIds:[id(3),id(4)],intervalWeeks:2})]) {
    assert.notEqual(visitCreationFingerprintCanonical(changed),original);
  }
  const wrongBody=receipt(e);wrongBody.requestCanonical=visitCreationFingerprintCanonical(capture({legacyParts:changedClient}));
  assert.equal(visitCreationReceiptMatches(e,wrongBody),false);
});

test('malformed items, dates, intervals and duplicate requests fail before a transport could run', () => {
  const e=capture(),legacy=parts();
  for(const badDate of ['2027-02-29','2028-02-30','2028-13-01','2028-2-01']) {
    const p=[...legacy];p[2]=badDate;assert.throws(()=>capture({legacyParts:p}),/invalid_create_date/);
  }
  for(const ids of [[],[id(1),id(1)],[id(9)],Array.from({length:25},(_,i)=>id(i+30)),['not-an-id']]) {
    assert.throws(()=>capture({occurrenceRequestIds:ids}),/invalid_create_|duplicate_create_/);
  }
  for(const interval of [0,13,1.5,'1',null])assert.throws(()=>capture({occurrenceRequestIds:[id(3),id(4)],intervalWeeks:interval}),/invalid_create_interval/);
  for(const item of [{...e.session.items[0],price_rub:1},{...e.session.items[0],duration_minutes:5},
    {...e.session.items[0],kind:'addon'},{...e.session.items[0],extends_duration:false},
    {...e.session.items[0],title:' '},{...e.session.items[0],extra:'dropped'}])assert.throws(()=>capture({items:[item]}),/create_/);
});

test('stored corruption cannot silently drop a field or acquire a new ID during restore', () => {
  const e=capture();
  for(const mutate of [x=>{delete x.terms;},x=>{x.version=2;},x=>{x.extra=true;},x=>{x.session.totalDurationMinutes=5;},
    x=>{x.occurrences[0].date='2028-03-01';},x=>{x.occurrences[0].requestId=id(99);},x=>{x.terms.minuteRateRub='0';}]) {
    const bad=clone(e);mutate(bad);assert.throws(()=>restoreVisitCreationEnvelope(bad));
  }
  const legacyUnknown={requestId:id(1),fingerprint:'a'.repeat(64),surface:'new-booking',legacyUncertain:true};
  const before=clone(legacyUnknown);assert.throws(()=>restoreVisitCreationEnvelope(legacyUnknown));
  assert.deepEqual(legacyUnknown,before);
});

test('receipt requires exact primary, session, revision, identity and scope for every occurrence', () => {
  const e=capture();
  for(const mutate of [x=>{delete x.requestCanonical;},x=>{x.actorId=id(98);},x=>{x.organizationId=id(98);},x=>{x.locationId=id(98);},
    x=>{x.occurrences[0].requestId=id(98);},x=>{x.occurrences[0].terms.minuteRateRub=1;},
    x=>{x.occurrences[0].session.items=[];},x=>{x.occurrences[0].session.totalAmountRub=1;},
    x=>{x.occurrences[0].revision.items=[];},x=>{x.occurrences[0].revision.actorId=id(98);},
    x=>{x.occurrences[0].revision.bookingId=id(98);},x=>{delete x.occurrences[0].revision.id;}]) {
    const bad=receipt(e);mutate(bad);assert.equal(visitCreationReceiptMatches(e,bad),false);
  }
  assert.equal(visitCreationReceiptMatches(e,null),false);
});

test('historical DTO qualification uses saved terms after a catalog change without admitting a past write', () => {
  const legacy=parts();legacy[2]='2020-02-29';const e=capture({legacyParts:legacy});
  const saved=clone(e),old=catalog.price_rub;catalog.price_rub=999;
  try {
    assert.equal(visitCreationReceiptMatches(restoreVisitCreationEnvelope(saved),receipt(e)),true);
    assert.equal(saved.terms.minuteRateRub,0);assert.equal(saved.occurrences[0].date,'2020-02-29');
  } finally { catalog.price_rub=old; }
});

test('UNKNOWN fields and inherited, missing or accessor DTO facts never qualify a successful receipt', () => {
  const e=capture(),valid=receipt(e);
  assert.equal(visitCreationReceiptMatches(e,Object.create(valid)),false);
  const levels=[x=>x,x=>x.occurrences[0],x=>x.occurrences[0].session,x=>x.occurrences[0].revision];
  for(const level of levels) {
    const extra=receipt(e);level(extra).status='unknown';assert.equal(visitCreationReceiptMatches(e,extra),false);
    const missing=receipt(e);delete level(missing)[Object.keys(level(missing))[0]];assert.equal(visitCreationReceiptMatches(e,missing),false);
  }
  const inheritedRow=receipt(e);inheritedRow.occurrences[0]=Object.create(inheritedRow.occurrences[0]);
  assert.equal(visitCreationReceiptMatches(e,inheritedRow),false);
  const accessor=receipt(e);Object.defineProperty(accessor.occurrences[0].revision,'totalAmountRub',{enumerable:true,get:()=>0});
  assert.equal(visitCreationReceiptMatches(e,accessor),false);
});

test('sparse, accessor or decorated arrays are rejected at capture and cannot become UNKNOWN JSON', () => {
  const legacy=parts();delete legacy[4];assert.throws(()=>capture({legacyParts:legacy}),/create_/);
  const items=[primary(chosen())];items.length=2;assert.throws(()=>capture({items}),/create_/);
  const occurrences=[id(3),id(4)];delete occurrences[1];
  assert.throws(()=>capture({occurrenceRequestIds:occurrences,intervalWeeks:1}),/create_/);
  const accessor=parts();Object.defineProperty(accessor,4,{enumerable:true,get:()=> 'Synthetic'});
  assert.throws(()=>capture({legacyParts:accessor}),/create_/);
  const decorated=parts();decorated.status='unknown';assert.throws(()=>capture({legacyParts:decorated}),/create_/);
});
