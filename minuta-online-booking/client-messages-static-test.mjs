import assert from 'node:assert/strict';import fs from 'node:fs';
const js=fs.readFileSync(new URL('./client-messages.js',import.meta.url),'utf8');const html=fs.readFileSync(new URL('./messages.html',import.meta.url),'utf8');const bookingsHtml=fs.readFileSync(new URL('./my-bookings.html',import.meta.url),'utf8');const bookingsJs=fs.readFileSync(new URL('./my-bookings.js',import.meta.url),'utf8');
for(const rpc of ['get_minuta_client_message_capability_v161','open_minuta_client_conversation_v161','list_minuta_client_conversations_v161','get_minuta_client_message_timeline_v161','send_minuta_client_message_v161','mark_minuta_client_message_read_v161','prepare_minuta_message_action_v161','apply_minuta_message_action_v161','open_minuta_client_support_v161'])assert.ok(js.includes(rpc),rpc);
assert.ok(js.includes('p_booking_code'));assert.ok(js.includes("sessionStorage"));assert.ok(!/manage_token|p_booking:|recipient_id/.test(js));assert.ok(!/localStorage\.getItem\(SESSION_KEY/.test(js));
assert.ok(!/sessionToken\.slice|scope:`client:\$\{/.test(js));
for(const asset of ['messages-center.css?v=789','messages-core.js?v=789','provider-messages-center.js?v=789','client-messages.js?v=789'])assert.ok(html.includes(asset),asset);
assert.ok(html.includes('Content-Security-Policy'));assert.ok(html.includes('my-bookings.html'));
assert.ok(bookingsHtml.includes('href="messages.html"'));assert.ok(bookingsJs.includes('bookingMessagesUrl(item.booking_code)'));assert.ok(!/messages\.html[^\n]*manage_token/.test(bookingsJs));
console.log('client-messages-static-test: ok');
