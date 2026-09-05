import assert from 'node:assert/strict';
import {safeDiagnostics} from './crm-snapshot-diagnostics.mjs';
const result=safeDiagnostics(`psql:/tmp/anonymize.sql:355: ERROR:  P0001: crm_snapshot_guard_failed
DETAIL: {"code":"unknown_sensitive_columns","objects":["bookings.extra_note","https://secret.invalid","+79501234567"]}
DETAIL: Failing row contains (PII SECRET 123456789).
CONTEXT: SQL statement UPDATE PII
DETAIL: {"code":"untrusted_personal_text","objects":["should_not_print"]}`);
assert(result.includes('SQLSTATE=P0001'));
assert(result.includes('object=bookings.extra_note'));
assert(!/secret|7950|PII|should_not_print/i.test(result));
console.log('Private snapshot diagnostic redaction: PASS');
