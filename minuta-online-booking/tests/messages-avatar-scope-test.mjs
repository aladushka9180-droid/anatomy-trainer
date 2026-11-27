import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const provider=readFileSync(new URL('../provider.js',import.meta.url),'utf8');
const start=provider.indexOf('function resetProviderMessagesCenter()');
const end=provider.indexOf('async function openProviderMessageForBooking(',start);
assert.ok(start>=0&&end>start);
const source=provider.slice(start,end);

async function fixture(bookings){
 let options;
 const context={currentUser:{id:'owner'},providerMessagesController:null,providerMessagesOrganizationId:'',
  organizationController:{getActiveOrganization:()=>({id:'own-org',current_role:'owner'})},
  $:()=>({}),db:{},allBookings:bookings,
  clientFramedAvatarMarkup:(phone,name)=>`frame:${phone}:${name}`,
  window:{MinutaProviderMessages:{mount:async value=>{options=value;return {};}}}};
 vm.createContext(context);vm.runInContext(source,context);await context.loadProviderMessagesCenter();
 return options.renderClientAvatar;
}
test('actual provider hook renders a matching booking without a client-list-local helper',async()=>{
 const render=await fixture([{id:'booking',organization_id:'own-org',client_phone:'test-phone',client_name:'Test'}]);
 assert.equal(render({kind:'client',booking:{booking_id:'booking'}}),'frame:test-phone:Test');
});
test('foreign, missing-scope and unavailable bookings keep the safe initials fallback',async()=>{
 for(const booking of [{id:'booking',organization_id:'other-org'},{id:'booking'},{id:'different',organization_id:'own-org'}]){
  const render=await fixture([booking]);assert.equal(render({kind:'client',booking:{booking_id:'booking'}}),'');
 }
 const render=await fixture([{id:'booking',organization_id:'own-org'}]);
 assert.equal(render({kind:'support',booking:{booking_id:'booking'}}),'');
 assert.equal(render({kind:'client'}),'');
});
