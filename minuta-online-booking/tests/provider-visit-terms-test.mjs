import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { calculateVisitTerms, captureVisitTerms, withVisitTermsDraft, restoreVisitTermsDraft,
  visitTermsFingerprintCanonical, sameVisitTerms } from '../provider-visit-terms.mjs';

const service = { id:'service-a', duration_minutes:1, price_rub:20 };
const scope = { actorId:'actor-a', organizationId:'org-a', serviceId:service.id };
const capture = (options = {}) => captureVisitTerms({ ...scope, service, minuteRateRub:23, durationMinutes:36, ...options });
const hash = value => createHash('sha256').update(value).digest('hex');

test('whole-ruble rate and planned duration have one exact primary-item calculation', () => {
  assert.deepEqual(calculateVisitTerms(23, 36), { minuteRateRub:23, durationMinutes:36, primaryAmountRub:828 });
  assert.equal(calculateVisitTerms(25, 36).primaryAmountRub, 900);
  assert.equal(calculateVisitTerms('23', '36').primaryAmountRub, 828);
  assert.equal(calculateVisitTerms(0, 1).primaryAmountRub, 0);
  assert.equal(calculateVisitTerms(0, 480).durationMinutes, 480);
  assert.equal(calculateVisitTerms(1000000, 1).primaryAmountRub, 1000000);
  assert.equal(calculateVisitTerms(2083, 480).primaryAmountRub, 999840);
  assert.throws(() => calculateVisitTerms(2084, 480), /primary_amount_out_of_range/);
  assert.throws(() => calculateVisitTerms(1000000, 2), /primary_amount_out_of_range/);
});

test('blank, fractional and coercible non-numbers cannot become a free visit or a rounded tariff', () => {
  for (const rate of ['', ' ', null, undefined, false, true, [], {}, NaN, Infinity, -1, 1.2, '1.2', '1e2', '0x10', 1000001]) {
    assert.throws(() => calculateVisitTerms(rate, 1), /invalid_minute_rate/, String(rate));
  }
  for (const duration of ['', null, undefined, false, [], NaN, Infinity, 0, -1, 1.2, '1.2', 481]) {
    assert.throws(() => calculateVisitTerms(23, duration), /invalid_duration/, String(duration));
  }
});

test('capture owns the chosen tariff and meaning across awaits and catalog changes', async () => {
  const catalog = { ...service };
  const chosen = capture({ service:catalog });
  const fromCatalog = capture({ service:catalog, minuteRateRub:undefined });
  const zero = capture({ service:catalog, minuteRateRub:0 });
  catalog.price_rub = 99;
  catalog.duration_minutes = 60;
  catalog.id = 'service-b';
  await Promise.resolve();
  assert.equal(chosen.minuteRateRub, 23);
  assert.equal(chosen.primaryAmountRub, 828);
  assert.equal(chosen.serviceId, 'service-a');
  assert.equal(chosen.pricingMode, 'per_minute');
  assert.equal(fromCatalog.minuteRateRub, 20);
  assert.equal(zero.minuteRateRub, 0);
  assert.equal(Object.isFrozen(chosen), true);
  assert.throws(() => { chosen.minuteRateRub = 99; }, TypeError);
  assert.throws(() => capture({ service:{ ...service, duration_minutes:60 } }), /per_minute_service_required/);
  assert.throws(() => capture({ service:{ ...service, price_rub:null }, minuteRateRub:undefined }), /invalid_minute_rate/);
  for (const key of ['actorId', 'organizationId']) assert.throws(() => capture({ [key]:'' }), /invalid_/);
});

test('draft round trip preserves price, one minute and zero without changing catalog or other draft fields', () => {
  const original = { serviceId:'service-a', durationMinutes:1, note:'synthetic', blockDurationMinutes:60 };
  const terms = capture({ minuteRateRub:0, durationMinutes:1 });
  const saved = withVisitTermsDraft(original, terms);
  const restored = restoreVisitTermsDraft(JSON.parse(JSON.stringify(saved)), scope);
  assert.equal(restored.status, 'restored');
  assert.deepEqual(restored.terms, terms);
  assert.equal(restored.terms.minuteRateRub, 0);
  assert.equal(restored.terms.durationMinutes, 1);
  assert.equal(saved.note, original.note);
  assert.equal(saved.blockDurationMinutes, 60);
  assert.equal(Object.hasOwn(original, 'visitTerms'), false);
  assert.equal(service.price_rub, 20);
});

test('capture rejects malformed catalog classification and missing service identity', () => {
  assert.equal(capture({ service:{ ...service, duration_minutes:'1' } }).pricingMode, 'per_minute');
  for (const value of [true, false, [1], new Number(1), {}, null, undefined, '1.0', '1e0']) {
    assert.throws(() => capture({ service:{ ...service, duration_minutes:value } }), /per_minute_service_required/);
  }
  for (const value of ['', ' service-a', null, undefined, true, {}]) {
    assert.throws(() => capture({ service:{ ...service, id:value } }), /invalid_service/);
  }
});

test('legacy, malformed and foreign-scope drafts stay explicit instead of reattaching a tariff', () => {
  assert.deepEqual(restoreVisitTermsDraft({ serviceId:'service-a' }, scope), { status:'legacy', terms:null });
  const saved = withVisitTermsDraft({}, capture());
  for (const key of ['actorId', 'organizationId', 'serviceId']) {
    assert.deepEqual(restoreVisitTermsDraft(saved, { ...scope, [key]:'different' }), { status:'scope_mismatch', terms:null });
  }
  for (const value of [null, {}, { ...saved.visitTerms, version:2 }, { ...saved.visitTerms, version:'1' },
    { ...saved.visitTerms, pricingMode:'fixed' }, { ...saved.visitTerms, pricingMode:null }, { ...saved.visitTerms, minuteRateRub:null },
    { ...saved.visitTerms, primaryAmountRub:829 }, { ...saved.visitTerms, sessionTotalRub:900 }]) {
    assert.deepEqual(restoreVisitTermsDraft({ visitTerms:value }, scope), { status:'invalid', terms:null });
  }
  assert.throws(() => withVisitTermsDraft({}, null), /invalid_visit_terms/);
});

test('legacy fingerprint bytes remain identical while changed visit terms change the same-attempt identity', () => {
  const legacy = ['normal', 'service-a', '2099-10-28', '12:30', 'Synthetic', '70000000000', 36, '', 'default', '', '', 0, ''];
  const before = JSON.stringify(legacy);
  assert.equal(visitTermsFingerprintCanonical(legacy), before);
  assert.equal(hash(visitTermsFingerprintCanonical(legacy)), hash(before));
  const frozen = capture();
  const canonical = visitTermsFingerprintCanonical(legacy, frozen);
  const storedAttempt = { requestId:'synthetic-request', fingerprint:hash(canonical) };
  assert.equal(hash(visitTermsFingerprintCanonical(legacy, JSON.parse(JSON.stringify(frozen)))), storedAttempt.fingerprint);
  for (const changed of [capture({ minuteRateRub:25 }), capture({ durationMinutes:1 }), capture({ minuteRateRub:0 }),
    capture({ actorId:'actor-b' }), capture({ organizationId:'org-b' }), capture({ service:{ ...service, id:'service-b' } })]) {
    assert.notEqual(hash(visitTermsFingerprintCanonical(legacy, changed)), storedAttempt.fingerprint);
  }
  assert.equal(storedAttempt.requestId, 'synthetic-request');
  assert.deepEqual(legacy, JSON.parse(before));
  assert.throws(() => visitTermsFingerprintCanonical(legacy, null), /invalid_visit_terms/);
});

test('queue JSON and exact local comparison reject missing or inconsistent receipt data', () => {
  const expected = capture();
  const queued = JSON.parse(JSON.stringify({ requestId:'synthetic-request', visitTerms:expected }));
  assert.equal(sameVisitTerms(expected, queued.visitTerms), true);
  for (const key of ['actorId', 'organizationId', 'serviceId', 'minuteRateRub', 'durationMinutes', 'primaryAmountRub']) {
    const incomplete = { ...expected };
    delete incomplete[key];
    assert.equal(sameVisitTerms(expected, incomplete), false, key);
  }
  assert.equal(sameVisitTerms(expected, { ...expected, primaryAmountRub:900 }), false);
  assert.equal(sameVisitTerms(expected, { ...expected, minuteRateRub:25, primaryAmountRub:900 }), false);
  assert.equal(sameVisitTerms(expected, { ...expected, minuteRateRub:'23' }), false);
  assert.equal(sameVisitTerms(expected, { ...expected, sessionTotalRub:900 }), false);
  assert.equal(sameVisitTerms(expected, null), false);
});
