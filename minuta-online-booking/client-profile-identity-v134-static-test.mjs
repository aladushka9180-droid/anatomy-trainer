import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('./provider.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('./client-records.css', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('./supabase-migration-v134.sql', import.meta.url), 'utf8');
const rollback = fs.readFileSync(new URL('./supabase-migration-v134-rollback.sql', import.meta.url), 'utf8');

assert.match(html, /id="clientIdentityAction"[^>]*>[\s\S]*?Имя и телефон/);
assert.match(html, /id="clientIdentityDialog"[\s\S]*?id="clientIdentityForm"[\s\S]*?id="clientIdentityName"[\s\S]*?id="clientIdentityPhone"/);
assert.match(html, /id="clientIdentityName"[^>]*minlength="2"[^>]*maxlength="80"/);
assert.match(html, /id="clientIdentityPhone"[^>]*type="tel"[^>]*inputmode="tel"/);
assert.match(css, /\.client-identity-dialog input/);
assert.match(css, /@media \(max-width:760px\)[\s\S]*?\.client-profile-dialog/);

assert.match(js, /function openClientIdentityDialog\(/);
assert.match(js, /function saveClientIdentity\(/);
assert.match(js, /db\.rpc\('save_minuta_client_identity_v134'/);
assert.match(js, /client_phone_conflict/);
assert.match(js, /client_metadata_conflict/);
assert.match(js, /applyClientIdentityLocally\(oldPhone, savedPhone, savedName\)/);
assert.match(js, /\$\('#clientIdentityForm'\)\.addEventListener\('submit', saveClientIdentity\)/);

assert.match(migration, /create or replace function public\.save_minuta_client_identity_v134/);
assert.match(migration, /public\.is_organization_member\(p_organization\)/);
assert.match(migration, /client_phone_conflict/);
assert.match(migration, /update public\.bookings/);
assert.match(migration, /update public\.organization_imported_clients/);
assert.match(migration, /update public\.organization_imported_booking_history/);
assert.match(migration, /update public\.client_record_entries/);
assert.match(migration, /update public\.client_result_series/);
assert.match(migration, /grant execute on function public\.save_minuta_client_identity_v134\(uuid,text,text,text\)/);
assert.match(rollback, /drop function if exists public\.save_minuta_client_identity_v134/);

console.log('Client profile identity v134 static checks: PASS');
