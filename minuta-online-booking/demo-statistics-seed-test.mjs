import fs from 'node:fs';
import assert from 'node:assert/strict';

const seed = fs.readFileSync(new URL('./demo-statistics-seed.sql', import.meta.url), 'utf8');
const cleanup = fs.readFileSync(new URL('./demo-statistics-cleanup.sql', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../.github/workflows/minuta-demo-statistics.yml', import.meta.url), 'utf8');

assert.match(seed, /\\ir demo-statistics-cleanup\.sql/, 'seed must replace only its previous fixture');
assert.match(seed, /public_booking_enabled[\s\S]*false/, 'demo organization must not be public');
assert.match(seed, /generate_series\(1, 300\)/, 'fixture must contain a meaningful 90-day history');
assert.match(seed, /generate_series\(1, 7\) staff_no/, 'fixture must contain seven specialists');
assert.match(seed, /select count\(\*\) from public\.locations[\s\S]*<> 3/, 'three branches must be verified');
assert.match(seed, /select count\(\*\) from public\.bookings[\s\S]*<> 312/, 'booking count must be verified');
assert.match(seed, /inventory_items/, 'inventory fixture must be present');
assert.match(seed, /booking_source/, 'booking attribution must be varied');
assert.match(seed, /visit_status/, 'visit outcomes must be present');
assert.match(seed, /payment_method/, 'payment methods must be present');

assert.match(cleanup, /demo_organization_id_collision/, 'cleanup must refuse an organization ID collision');
assert.match(cleanup, /demo_user_id_collision/, 'cleanup must refuse a user ID collision');
assert.match(cleanup, /session_replication_role = replica/, 'cleanup must remove the complete isolated graph');
assert.doesNotMatch(cleanup, /truncate\s/i, 'cleanup must never truncate shared tables');

assert.match(workflow, /workflow_dispatch:/, 'fixture must only run manually');
assert.match(workflow, /SEED_DEMO_STATISTICS/, 'seed requires explicit confirmation');
assert.match(workflow, /CLEANUP_DEMO_STATISTICS/, 'cleanup requires explicit confirmation');
assert.match(workflow, /cawexmmrqjvothcbgjxr/, 'workflow must guard the exact production project');
assert.match(workflow, /minuta-production/, 'workflow must use the protected production environment');

console.log('demo statistics seed static checks passed');
