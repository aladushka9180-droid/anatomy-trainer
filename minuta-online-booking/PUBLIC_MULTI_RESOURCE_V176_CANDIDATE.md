# Multi-resource public booking RPC v176 — isolated candidate

Scope: provider-owned PostgreSQL expansion for an ordered route of 2–6 ordinary
bookings. No client UI, traffic switch, production SQL, or live travel adapter is
included. The existing v167 route and single-booking RPC are unchanged.

## Contract and launch gate

`book_minuta_multi_resource_route_v176(uuid,text,text,jsonb,jsonb)` accepts one
route UUID, client name and phone, ordered items with distinct request UUIDs,
organization slug, location, concrete performer, service, local date/time and
expected price/duration. Each change of location requires a route-bound,
directional evidence UUID with a matching departure instant and unexpired
travel duration. Browser roles cannot write evidence. The RPC rechecks the
current organization, membership, catalog, location, price, duration and
available slot, then calls the existing atomic single-booking function for
each item in one transaction. It verifies each authoritative booking row and
records route links in that same transaction. An error rolls back all items.
An exact replay returns the same bookings; altered content conflicts.

The migration intentionally leaves `EXECUTE` revoked for `public`, `anon`,
`authenticated`, and `service_role`. There is no trusted production travel-time
producer. A free-form `provider_reference` is storage for a future server
adapter, not proof that a provider is configured. The synthetic evidence in
the PGlite test is test-only. Locations outside `Europe/Samara` fail closed
until time-zone conversion and its tests are explicitly added. Do not grant
browser execution or connect the client route on the strength of this candidate.

## Verified locally

- v176 PGlite: two organizations and performers, same-organization route,
  replay and changed-payload conflict, wrong scope, overlap, missing/stale/slow
  travel, changed terms, time-zone rejection, second-insert failure with zero
  new bookings, disabled RPC/RLS, rollback and reapply.
- v167 static contract: 4/4 pass. The v176 PGlite test checks that v167 and
  the single-booking function definitions are untouched and calls both legacy
  stubs after migration. Stubs are not a full-schema compatibility test.
- v152/v153 single-booking static release check and source-contract script:
  pass. These checks verify the baseline files, not v176 behavior on a restored
  full schema.

## Full-schema rehearsal — required before integration

Run only in an isolated PostgreSQL 17 database restored from a verified
schema-only snapshot of the dedicated test project. Check that the test
project ref and database identity differ from production and disable external
webhooks/delivery. Do not copy production data into this rehearsal.

1. Record the exact candidate SHA, current `origin/main`, migration-number
   uniqueness and test DB identity. Take a fresh test-schema backup, verify the
   archive integrity, restore it to a disposable database, and verify required
   tables, functions, constraints, RLS and role grants before applying v176.
2. Apply `supabase-migration-v176.sql` twice. Confirm old v167 and single RPC
   definitions and grants are byte-identical to the pre-apply snapshot; the new
   route tables are private and the new RPC is not executable by browser roles.
3. In the disposable database, use synthetic roles, organizations, locations,
   two performers, services and schedules. Temporarily grant v176 execution
   **only there**. Run a two-organization create, same-organization create,
   replay/conflicting replay, item-UUID reuse, rights and price drift, slot
   conflict, missing/stale/insufficient travel, and a forced failure on the
   second insert. Verify zero route, item and booking rows after each failed
   request. Run the existing v167 integration/concurrency and v153 single
   booking tests against the same final schema.
4. Use separate PostgreSQL connections to race identical and conflicting
   route UUIDs, a booking on the second calendar, and a changed travel
   attestation. Assert one complete route or a clean failure, never a partial
   route or duplicate booking. Repeat with ordinary single/v167 calls.
5. Apply `supabase-migration-v176-rollback.sql`. Verify browser execution is
   still denied and existing route journals/bookings remain. Reapply v176,
   verify the same state and legacy paths. Destroy the disposable database.

The operational rollback revokes traffic only. It deliberately preserves
bookings, route journals and evidence for audit and replay recovery. Dropping
those tables would be a separate, destructive migration and is not authorized.

## Current verification limit

The present Windows workspace has no `psql`, `pg_dump`, `pg_restore`, Docker,
PostgreSQL server or `MINUTA_TEST_DATABASE_URL`. No PostgreSQL/ Docker Windows
service or listener on localhost ports 5432/5433/6543 is present; WSL has no
installed distribution. `gh auth status` reports an invalid token, and remote
branch/CI writes are outside this task's authorization. The existing test CI
cannot be dispatched from this task.
The full-schema restore, concurrency and legacy integration gates remain open.
Production application also requires the separate release owner's fresh
backup/restore/rollback proof and explicit SQL authorization.
