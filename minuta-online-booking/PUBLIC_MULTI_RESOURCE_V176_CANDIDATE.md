# Multi-resource public booking RPC v176 — isolated candidate

Migration file number: v188. Current `origin/main` already contains v184, and
another open package uses v186/v187. The RPC/table contract retains v176;
the migration number is independent. Recheck uniqueness before integration.

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
- PostgreSQL 17 CI with an empty synthetic schema: the v176 contract above and
  a real concurrent duplicate-route lock/replay pass. This exposed and fixed
  an incorrect three-argument prerequisite check for the live four-argument
  `get_available_slots` function.
- PostgreSQL 17 CI with a schema-only clone of the isolated test project:
  migration apply twice, legacy v167/single definitions and `anon` grants,
  private tables/RLS, closed v176 RPC, rollback and reapply pass. On that clone,
  the existing v153 and v167 integration suites, a two-performer route through
  the real v153 booking RPC, and separate-connection duplicate/calendar races
  pass. The losing calendar route leaves no partial bookings. No source rows or
  production data are copied to the disposable server.

## Full-schema rehearsal — required before integration

Run only in an isolated PostgreSQL 17 database restored from a verified
schema-only snapshot of the dedicated test project. Check that the test
project ref and database identity differ from production and disable external
webhooks/delivery. Do not copy production data into this rehearsal.

1. Record the exact candidate SHA, current `origin/main`, migration-number
   uniqueness and test DB identity. Take a fresh test-schema backup, verify the
   archive integrity, restore it to a disposable database, and verify required
   tables, functions, constraints, RLS and role grants before applying v176.
2. Apply `supabase-migration-v188.sql` twice. Confirm old v167 and single RPC
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
5. Apply `supabase-migration-v188-rollback.sql`. Verify browser execution is
   still denied and existing route journals/bookings remain. Reapply v176,
   verify the same state and legacy paths. Destroy the disposable database.

The operational rollback revokes traffic only. It deliberately preserves
bookings, route journals and evidence for audit and replay recovery. Dropping
those tables would be a separate, destructive migration and is not authorized.

## Current verification limit

The full-schema checks use a schema-only clone with synthetic rows. They do
not prove production behavior, external travel-time evidence, or an actual
client booking. Cross-location production traffic needs a trusted server
travel-time source; none is configured. The candidate remains closed to all
browser roles. Production application requires the release owner's fresh
backup/restore/rollback proof, current migration-number check, and explicit
SQL authorization. Client multi-performer integration needs its own gated
release and live validation after the server contract is installed.
