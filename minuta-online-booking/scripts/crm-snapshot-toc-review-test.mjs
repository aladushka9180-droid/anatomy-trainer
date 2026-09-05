import test from 'node:test';
import assert from 'node:assert/strict';
import {filterToc,authPlaceholders} from './crm-snapshot-toc.mjs';

const validFk='ALTER TABLE ONLY public.organizations ADD CONSTRAINT organizations_actor_fk FOREIGN KEY (created_by) REFERENCES auth.users(id);';
const baseline='1; 1 1 TABLE public bookings postgres\n2; 1 1 TABLE DATA public bookings postgres\n';

test('TOC excludes live control schemas and executable archive metadata',()=>{
  const extra=[
    '3; 1 1 TABLE DATA cron job postgres',
    '4; 1 1 TABLE DATA net http_request_queue postgres',
    '5; 1 1 TABLE DATA vault secrets postgres',
    '6; 1 1 TABLE DATA auth users postgres',
    '7; 1 1 TABLE DATA storage objects postgres',
    '8; 1 1 PUBLICATION - public_pub postgres',
    '9; 1 1 EVENT TRIGGER - public_event postgres',
    '10; 1 1 FOREIGN TABLE public foreign_bookings postgres',
    '11; 1 1 FUNCTION public_lookalike unsafe() postgres',
    '12; 1 1 EXTENSION - http postgres',
    '13; 1 1 ACL public FUNCTION privileged() postgres',
  ].join('\n');
  assert.equal(filterToc(baseline+extra),baseline);
});

test('auth placeholders use only supplied FK IDs, no production auth payload',()=>{
  const result=authPlaceholders(validFk);
  assert.equal(result,'insert into auth.users(id) select distinct created_by from public.organizations where created_by is not null on conflict do nothing;\n');
  assert.doesNotMatch(result,/email|password|raw_user_meta_data|identities|sessions/i);
});

test('external FK audit rejects unsupported external schema despite whitespace',()=>{
  const external='ALTER TABLE ONLY public.bookings ADD CONSTRAINT bad FOREIGN KEY (id) REFERENCES\n storage.objects(id);';
  assert.throws(()=>authPlaceholders(validFk+external),/Unsupported external foreign key/);
});

test('external FK audit does not silently ignore lowercase SQL',()=>{
  const external='alter table only public.bookings add constraint bad foreign key (id) references storage.objects(id);';
  assert.throws(()=>authPlaceholders(validFk+external),/Unsupported external foreign key/);
});

test('external FK audit rejects comments between REFERENCES and external name',()=>{
  const external='ALTER TABLE ONLY public.bookings ADD CONSTRAINT bad FOREIGN KEY (id) REFERENCES/* external */storage.objects(id);';
  assert.throws(()=>authPlaceholders(validFk+external),/Unsupported external foreign key/);
});
