# Native team schedule: week copy candidate

User approved this separate feature after the UI1068 release: choose source and destination weeks, preview shifts, preserve existing shifts and prevent duplicate copies.

## Behavior

- Native drawer beside the existing filters. Scope is explicit: selected specialist/location or all permitted staff/locations; specialist copies only self.
- Seven days copied forward by whole-week offsets, up to366 days; target past dates are refused using each branch timezone. Maximum500 source shifts.
- Copy staff, branch, work hours and breaks. Do not copy notes, bookings or absences; do not change online-booking mode.
- Exact existing shifts are skipped. Overlap (including another organization), absence or inactive staff/branch blocks the entire batch.
- Preview is read-only. Commit recomputes rights, source and conflicts under native v71 organization lock7100 and requires the current preview stamp.
- Commit delegates each shift to the unchanged native writer in one transaction. Any later failure rolls back all created shifts, audits and receipt.
- UUID request receipt handles lost responses and concurrent retries. Receipt binds actor and request parameters. No raw table access for authenticated users.
- Unknown response freezes dates and repeats the same request. Logout/organization change clears private preview and scope. No new offline queue.

## Compatibility and migration

Migration195 is provisional until the sole release owner confirms the shared numbering. Additive table and3 functions; no replacement of existing v71 writers or data.

Operational rollback drops only the3 new RPC/helper functions. Receipts, created shifts and audit history remain. Reapply restores safe retry of existing requests. This avoids deleting someone's schedule during rollback.

Target public configuration is the existing Pro project cawexmmrqjvothcbgjxr. Do not copy credentials into this branch. Only the designated release owner may apply SQL or publish shared resources.

Production prerequisites: exact candidate review, current confirmed private backup and restoration/rehearsal according to the project's release gates; separate human confirmation for this concrete production migration. This document does not grant that confirmation.

Apply SQL before publishing the UI; otherwise missing RPC is explained in the drawer and existing schedule remains usable. Owner assigns the next resource generation for provider/HTML/SW and changed JS/CSS. Optional resource wiring already exists; startup assets/budget unchanged here.

## Evidence

- Real newly initialized task-owned PostgreSQL cluster:34 checks PASS; native v71 tables/constraints/writers,2 sessions, same and different concurrent requests, roles, absence/overlap, stale preview, later-insert rollback, migration rollback/reapply. Existing booking and absence retained; no production connection accepted.
- Browser transport fixture:54 checks PASS at390/760/1440, selected scope, full-width expanded mobile filters, preview, date invalidation, duplicate explanation, refusal, unknown response retry with same UUID, Escape/focus, logout cleanup. This proves the UI contract, not production persistence.
- Full current provider integration:103 assertions PASS at390/760/1440; existing forms, roles, refused writes, session/organization changes and31-day period preserved.
- Native controller/v71 static, syntax, migration-safety guard, diff and redirect PASS. Mandatory branch/main CI and target live screen are release-owner gates.
- Actual CUA click path on a local synthetic page: select Анна → open copy → preview4 shifts → confirm → calendar advances to copied week. No live records written. Screenshots are in task-owned outputs/copy-week-ui; review candidate visual quality9/10, live acceptance still pending.

No physical phone/ADB changes. No delivery, payments, SQL dispatch, credentials, production restore or real record mutation by this worker.
