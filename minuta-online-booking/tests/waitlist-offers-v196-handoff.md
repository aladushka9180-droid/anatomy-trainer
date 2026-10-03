# X07 server candidate — no production apply

ROOT owns this additive candidate from main e3d8a25e. Migration196 is reserved in the coordinator's shared register; recheck uniqueness before integration. Existing v111 requests/RPC/RLS, v153 booking writer, availability and client UI remain unchanged.

## Behavior and acceptance

- Authenticated owner/admin or the request's active specialist creates one exact, expiring offer. Creation does not reserve a slot, book or send a message.
- A request-bound client capability reads four states: offered, accepted, expired, busy. No phone, other request token or internal row data is returned.
- Deadline is absolute, at most24 hours and before the offered slot. The existing availability horizon is14 days; the legacy180-day waitlist cannot bypass it.
- Acceptance locks request then offer, delegates to v153 with a stable separate booking UUID, validates one exact acknowledgement plus the actual booking row, then commits offer/request status atomically.
- Changed service terms expire the offer. Known slot conflicts become busy; unrelated errors roll back and keep the same offer retryable. A repeated accepted offer returns the same booking capability, including after a legitimate later reschedule/discount.
- Forward/reapply refuse unrelated preexisting objects. Rollback revokes only the three new RPCs, preserves requests/offers/bookings, and refuses foreign function identities.

## Evidence and limits

Embedded SQL semantic suite:35/35 PASS, including privacy/roles, expiry/cancellation, terms, occupied slots, invalid/multiple/empty acknowledgement, rollback/reapply and foreign-object preservation. Explicit test-only PGlite0.5.8; each case creates a fresh synthetic database.

Native runner creates a new task-owned loopback cluster and verifies its exact data directory, empty start and NOSUPER/NOBYPASSRLS RPC owner. Two connections prove same-offer serialization and competing-offer exclusion; the booking dependency is explicitly synthetic. Native result is pending mandatory PR CI. The CI PostgreSQL16 runtime is general candidate qualification, not compatibility proof for the actual PG170006 source.

No source connection, protected capture, actual restore, credential read, production SQL, real booking, delivery or frontend publication occurred. SQL is outside public app wiring and a draft review candidate only.

Before any production apply: exact review of native original v111/v153/v168 dependencies and compatibility with pending catalog deletion/SQL, fresh closed backup, full original isolated restore including Auth/Storage/nonpublic/roles/ACL, candidate rollback/reapply, and a concrete SQL196 approval. Then implement/integrate the agreed UI with the sole shared-file owner, publish aligned resources after final checks/CI, and verify the four states in an explicitly allowed live test scenario. Client recipient/messages and working records retain their own gates. X07 remains unaccepted until that live cycle.
