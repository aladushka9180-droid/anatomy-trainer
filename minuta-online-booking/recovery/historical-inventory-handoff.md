# Historical visits with insufficient stock

User decision: save past visits with an explicit “Материалы не списаны” marker;
never create negative balances. No blanket bypass for ordinary/future visits.

## Candidate and boundaries

- Guarded forward/rollback payloads change only the existing inventory consumer.
  Expected source MD5 values were verified read-only against the current target:
  consumer `4ce8a73e07e108bcd45db5a4f7b993b3`. The existing historical RPC
  and its response contract are unchanged. Unknown definitions refuse modification.
- Only exact SQLSTATE 55000 / insufficient_inventory_stock_for_completed_visit
  in an authenticated authorized historical completed visit enters the exception.
  PostgreSQL rolls back the entire attempted consumption subtransaction before
  retaining the booking/payment and persisting the marker plus an inventory audit.
- No table, account, role, grant or inventory balance migration. Existing ACL,
  owner and function configuration are retained. No negative or partial deduction.
- Marker lives in booking_policy_snapshot.stock_skipped.
  The existing outcome hint renders “Материалы не списаны” from the saved snapshot
  in record details after reloading; no new response field or toast contract.
- A later successful consumption clears the marker; no automatic retry job or
  new “deduct later” control is introduced. Existing idempotency remains.
- Rollback restores exact original bodies, not stock or business rows; truthful
  saved markers/audit records survive. Roll back SQL before removing marker UI.

## Verification

- Causal baseline: the new UI regression fails on main (unknown state instead of
  an editable stock refusal); actual historical function chain and stock error
  were observed read-only in production logs. No booking was created by testing.
- Embedded PostgreSQL executes the actual v164 consumer and v145 wrapper with
  the actual outcome trigger and explicit synthetic legacy-create/outcome/audit
  dependencies: 16/16 checks. It tests full
  multi-material rollback, preserved visit/payment, durable marker, ordinary/
  future/invalid-actor refusal, hard unrelated errors, normal success, no duplicate
  consumption, exact rollback/reapply, owner/ACL/config preservation and drift.
- Actual createNewBooking VM tests (48/48) retain unknown-response latch, session/form
  ownership, existing error classification and stored outcome-hint rendering.
- Native browser scenarios (48/48) are isolated, network-blocked, synthetic fixtures.
  The actual outcome-summary fragment and hint/label helpers are rendered with
  the saved marker at 390/760/1440 using existing sage styles. This isolated
  fragment is NOT the full live booking renderer, authenticated creation or Android.
- Both organization-aware loader projections include booking_policy_snapshot;
  the cache signature includes stock_skipped, so a marker-only network change
  invalidates an older cached rendering. The two legacy organization-less read
  fallbacks stay unchanged. Projection and actual signature are regression-tested.

## Release gates / ownership

The sole Pro release owner integrates only this candidate, allocates any real
migration number using the current queue, and updates the shared PWA versions.
Do not cherry-pick this worktree's MILESTONE over the coordinator's milestone.
Fresh protected full backup, isolated restore and exact same-copy apply/read/
rollback/reapply remain mandatory BEFORE production SQL. Embedded fixtures do not
satisfy those gates. No production SQL was applied by this task.

The final startup core budget passes at 3799093/3799094 bytes (63 files).
The earlier failing revision added a redundant block/API response and legacy
error mapping. These were removed in favor of the existing outcome hint; only
its related comment was shortened. No cap increase or unrelated compression.
Recheck the budget in the owner's final combined tree.
Run combined CI, publish SQL then compatible UI, verify actual bytes/cache and
the allowed test-account past visit, payment, persisted marker after reload,
unchanged stock and ordinary/future refusal. Browser access stopped on Windows
URL-confidence policy; do not bypass it or claim a live visual pass.

Qualify historical-notification suppression before releasing the new successful
past-visit path; no real Telegram/client messages are part of these tests.
Separate operational security work is not implemented or proven by this candidate.
