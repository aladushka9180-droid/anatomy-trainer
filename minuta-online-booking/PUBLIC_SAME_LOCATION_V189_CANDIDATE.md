# Same-location server entry point — candidate v189

This migration depends on the closed v188/v176 multi-resource route. It adds
`book_minuta_same_location_route_v189(uuid,text,text,jsonb)` for the trusted
client Worker. The wrapper accepts 2–6 items only when every item names the
same organization and location; it supplies an empty travel-transition list
to v176. The cross-location v176 RPC remains revoked for `service_role`,
`anon`, and `authenticated`. The new wrapper grants `EXECUTE` only to
`service_role`; browser roles cannot call it.

The client Worker must call the four-argument v189 wrapper and keep
`PRIMETIME_MULTI_RESOURCE_SAME_LOCATION_ENABLED` off until the production
contract, backup, rollback, access grant, and live validation are complete.
The Worker alone enforces public-session authorization and requires its
existing service-role credential. This migration does not send messages,
charge payments, create a route by itself, or configure cross-location travel.

The isolated PGlite test applies v188 and v189 twice, checks function
privileges, creates one synthetic two-performer route, rejects a cross-location
route with no rows, replays after a price change, revokes access without
removing bookings or journals, and reapplies the grant. It does not prove a
production booking or the client Worker integration.

A separate full-schema PostgreSQL 17 job now reads only the schema of the
guarded test project into a disposable localhost database. It checks v188/v189
apply twice, original RPC definitions and grants, browser/cross-location denial,
the real service-role wrapper through the existing booking function, concurrent
duplicate and competing calendar requests, and rollback/reapply with committed
bookings and journals preserved. The existing v153/v167 integration suites run
with both migrations installed. Native execution passed on 2026-10-02 at
`3bb6d45f` (Actions run `36921656346`); it is not a production backup or
restoration rehearsal.

The final contract check captures input and acknowledgements from the native
v189 wrapper, existing single-booking RPC and native booking rows for two
consecutive synthetic performers. The private client runs its actual adapter
against these captured responses and compares its emitted body to the body
executed by PostgreSQL. Exact replay must return the same bookings. The
artifact contains only disposable fixture data; client source and private
schema are not uploaded. No request reaches a public API, and the capture
transaction rolls back. Execution of this final contract check is pending.

Before production SQL: recheck the migration number against fresh `main` and
other release candidates; the sole Pro release owner must verify a fresh
closed backup, isolated restoration, apply/rollback/reapply and existing
booking paths on the target schema, then confirm the user's exact SQL
authorization. Apply v188 before v189. Keep the client flag off until both
servers and the final Worker release are checked. Operational rollback applies
`supabase-migration-v189-rollback.sql` to revoke new traffic while retaining
confirmed bookings and route journals.
