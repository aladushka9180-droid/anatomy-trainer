import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../payment-management.js', import.meta.url), 'utf8');
const context = vm.createContext({
  window: {},
  document: {},
  TextEncoder,
  URL,
  console
});
vm.runInContext(source, context, { filename: 'payment-management.js' });

const { createSandboxPaymentState, applySandboxPaymentCommand } = context.window.MinutaPayments;
const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const hash = value => String(value).padStart(64, '0');
const at = minute => `2026-09-11T09:${String(minute).padStart(2, '0')}:00.000Z`;

function created() {
  return createSandboxPaymentState({
    ledgerId: id(1),
    organizationId: id(2),
    bookingId: id(3),
    purpose: 'booking_prepayment',
    currency: 'RUB',
    amountMinor: 250000,
    idempotencyKey: 'sandbox:create:booking-3',
    payloadSha256: hash(1),
    occurredAt: at(0)
  });
}

test('sandbox state machine authorizes, captures and refunds without card or provider I/O', () => {
  const initial = created();
  const authorized = applySandboxPaymentCommand(initial, {
    action: 'authorize', idempotencyKey: 'sandbox:authorize:booking-3', payloadSha256: hash(2),
    expectedVersion: 1, occurredAt: at(1)
  }).state;
  const captured = applySandboxPaymentCommand(authorized, {
    action: 'capture', idempotencyKey: 'sandbox:capture:booking-3', payloadSha256: hash(3),
    expectedVersion: 2, occurredAt: at(2)
  }).state;
  const partial = applySandboxPaymentCommand(captured, {
    action: 'refund', amountMinor: 100000, idempotencyKey: 'sandbox:refund:booking-3:1',
    payloadSha256: hash(4), expectedVersion: 3, occurredAt: at(3)
  }).state;
  const refunded = applySandboxPaymentCommand(partial, {
    action: 'refund', amountMinor: 150000, idempotencyKey: 'sandbox:refund:booking-3:2',
    payloadSha256: hash(5), expectedVersion: 4, occurredAt: at(4)
  }).state;

  assert.equal(initial.status, 'created');
  assert.equal(authorized.status, 'authorized');
  assert.equal(captured.status, 'captured');
  assert.equal(partial.status, 'partially_refunded');
  assert.equal(refunded.status, 'refunded');
  assert.equal(refunded.refundedMinor, 250000);
  assert.equal(refunded.journal.length, 5);
  assert.ok(Object.isFrozen(refunded));
  assert.ok(Object.isFrozen(refunded.journal));
  assert.doesNotMatch(JSON.stringify(refunded), /card|pan|cvv|cvc|expiry/i);
});

test('exact retries replay while key reuse with another payload fails closed', () => {
  const state = applySandboxPaymentCommand(created(), {
    action: 'authorize', idempotencyKey: 'sandbox:authorize:replay', payloadSha256: hash(20),
    expectedVersion: 1, occurredAt: at(1)
  }).state;
  const replay = applySandboxPaymentCommand(state, {
    action: 'authorize', idempotencyKey: 'sandbox:authorize:replay', payloadSha256: hash(20),
    expectedVersion: 1, occurredAt: at(9)
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.state, state);
  assert.throws(() => applySandboxPaymentCommand(state, {
    action: 'authorize', idempotencyKey: 'sandbox:authorize:replay', payloadSha256: hash(20),
    expectedVersion: 2, occurredAt: at(9)
  }), error => error?.code === 'sandbox_idempotency_conflict');
  assert.throws(() => applySandboxPaymentCommand(state, {
    action: 'authorize', idempotencyKey: 'sandbox:authorize:replay', payloadSha256: hash(21),
    expectedVersion: 1, occurredAt: at(9)
  }), error => error?.code === 'sandbox_idempotency_conflict');
});

test('stale versions, second capture and over-refunds are rejected', () => {
  const initial = created();
  assert.throws(() => applySandboxPaymentCommand(initial, {
    action: 'capture', idempotencyKey: 'sandbox:capture:too-early', payloadSha256: hash(30),
    expectedVersion: 1, occurredAt: at(1)
  }), error => error?.code === 'sandbox_invalid_transition');
  assert.throws(() => applySandboxPaymentCommand(initial, {
    action: 'authorize', idempotencyKey: 'sandbox:authorize:stale', payloadSha256: hash(31),
    expectedVersion: 2, occurredAt: at(1)
  }), error => error?.code === 'sandbox_stale_version');

  const authorized = applySandboxPaymentCommand(initial, {
    action: 'authorize', idempotencyKey: 'sandbox:authorize:valid', payloadSha256: hash(32),
    expectedVersion: 1, occurredAt: at(1)
  }).state;
  const captured = applySandboxPaymentCommand(authorized, {
    action: 'capture', idempotencyKey: 'sandbox:capture:valid', payloadSha256: hash(33),
    expectedVersion: 2, occurredAt: at(2)
  }).state;
  assert.throws(() => applySandboxPaymentCommand(captured, {
    action: 'capture', idempotencyKey: 'sandbox:capture:again', payloadSha256: hash(34),
    expectedVersion: 3, occurredAt: at(3)
  }), error => error?.code === 'sandbox_invalid_transition');
  assert.throws(() => applySandboxPaymentCommand(captured, {
    action: 'refund', amountMinor: 250001, idempotencyKey: 'sandbox:refund:too-much',
    payloadSha256: hash(35), expectedVersion: 3, occurredAt: at(3)
  }), error => error?.code === 'sandbox_invalid_transition');
});

test('cancel is terminal and unexpected payment material is rejected', () => {
  const initial = created();
  const cancelled = applySandboxPaymentCommand(initial, {
    action: 'cancel', idempotencyKey: 'sandbox:cancel:booking-3', payloadSha256: hash(40),
    expectedVersion: 1, occurredAt: at(1)
  }).state;
  assert.equal(cancelled.status, 'cancelled');
  assert.throws(() => createSandboxPaymentState({
    ledgerId: id(5), organizationId: id(2), bookingId: id(3), purpose: 'tip', currency: 'RUB',
    amountMinor: 1000, idempotencyKey: 'sandbox:create:with-card', payloadSha256: hash(41),
    occurredAt: at(0), cardNumber: '4111111111111111'
  }), error => error?.code === 'sandbox_invalid_create');
});

test('forged or internally inconsistent journals fail closed', () => {
  const state = applySandboxPaymentCommand(created(), {
    action: 'authorize', idempotencyKey: 'sandbox:authorize:integrity', payloadSha256: hash(50),
    expectedVersion: 1, occurredAt: at(1)
  }).state;
  const forged = structuredClone(state);
  forged.status = 'created';
  forged.authorizedMinor = 0;
  assert.throws(() => applySandboxPaymentCommand(forged, {
    action: 'authorize', idempotencyKey: 'sandbox:authorize:after-forgery', payloadSha256: hash(51),
    expectedVersion: 2, occurredAt: at(2)
  }), error => error?.code === 'sandbox_invalid_journal');
});

console.log('PrimeTime provider sandbox payment v144 tests: PASS');
