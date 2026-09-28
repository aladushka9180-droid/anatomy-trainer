import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../provider.js', import.meta.url), 'utf8');
const start = source.indexOf('function serviceCreateErrorMessage(');
const end = source.indexOf('async function addService(', start);
assert.ok(start >= 0 && end > start);
const messageFor = vm.runInNewContext(`${source.slice(start, end)}\nserviceCreateErrorMessage`);

assert.match(messageFor({ code:'23505', message:'duplicate_service_name' }), /уже есть.*скрыта/i);
assert.match(messageFor({ code:'23514', message:'new row violates check constraint "services_duration_minutes_check"' }), /не принимает выбранную длительность/i);
assert.match(messageFor({ code:'PGRST301', message:'connection failed' }), /код PGRST301/);
assert.doesNotMatch(messageFor({ code:'XX000', message:'private server detail' }), /private server detail/);
assert.match(source.slice(end, source.indexOf('async function changePassword(', end)), /showFormError\('#serviceError', serviceCreateErrorMessage\(error\)\)/);
console.log('Service creation error guidance passed');
