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
- Rollback first admits only the exact original, exact current owned patch, or
  the explicitly known handler-only partial body. Unknown edits inside either
  tagged region and all other partial forms are refused before stripping tags.

## Verification

- Causal baseline: the original PostgreSQL chain rolls the entire historical
  booking/payment back on insufficient stock. The new persisted-marker checks
  fail against the original hint/cache/reader, which have no marker support.
  The same function chain and stock error were observed read-only in production
  logs. No real booking was created by testing; the old unknown-result UI latch
  is deliberately unchanged, including when connected to the old server.
- Embedded PostgreSQL executes the actual v164 consumer and v145 wrapper with
  the actual outcome trigger and explicit synthetic legacy-create/outcome/audit
  dependencies: 21/21 checks. It tests full
  multi-material rollback, preserved visit/payment, durable marker, ordinary/
  future/invalid-actor refusal, hard unrelated errors, normal success, no duplicate
  consumption, exact rollback/reapply, owner/ACL/config preservation and drift.
  Five new tagged-region/partial drift cases reproduce the old rollback failure
  (missing expected refusal) and pass with the peer's exact closed-set guard.
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

The candidate at e3ccf44f passes its local startup core budget at
3799093/3799094 bytes (63 files), based on a5a842a5. CI checks the merge with
new main 1929921f, which alone uses all 3799094 bytes: the combined tree is
3799139 bytes, an exact 45-byte overrun. This is a real shared-budget HOLD,
not an EOL discrepancy. The owner must qualify this exact measured increment
or a compatible in-scope reduction; no cap increase is hidden in this candidate.
The earlier redundant block/API response and legacy error mapping are removed.
PG CI on e3ccf44f and docs-only 97d436fb passed at 16 cases; the newer rollback
guard and 21-case engine suite require their own final-head CI. Shared smoke
and service-delete jobs fail at this
same CORE gate (their actual service tests pass). A separate card CI stopped
while installing Chrome, before running its browser tests. Those failures are
not waived. Recheck the owner's final combined tree and its CI.
Run combined CI, publish SQL then compatible UI, verify actual bytes/cache and
the allowed test-account past visit, payment, persisted marker after reload,
unchanged stock and ordinary/future refusal. Browser access stopped on Windows
URL-confidence policy; do not bypass it or claim a live visual pass.

Qualify historical-notification suppression before releasing the new successful
past-visit path; no real Telegram/client messages are part of these tests.
Separate operational security work is not implemented or proven by this candidate.
