# Service deletion history fallback — v1066 integration

Deleting a service referenced outside the waitlist can return PostgreSQL 23503. The previous handler reported failure for these dependencies. The integrated handler hides the owned service while retaining its history, photo and short name. This is an independently reproduced general FK defect; the cause of the earlier real service 3333 attempt remains unknown, and that action is not repeated.

The fallback accepts only the existing waitlist case or a 23503 message identifying an update/delete on the `services` table. Unrelated FK, permission, RPC, uniqueness and transport errors remain failures. The update filters both service ID and current performer ID; success requires the returned same ID and `active=false`. Ordinary successful deletion keeps its existing cleanup.

Integration base: main `594a2fca4aa7a7fe41d258decc07aab1f80be110`. Candidate: PR55 `6544eb9865d98bf9f8ecc18bb1c4ba40daf40bd2`, current public metadata OPEN/DRAFT/mergeable and 14/14 exact checks successful. Only its scoped patch, tests and focused workflow are transferred. Existing unrelated worktrees and their changes are preserved.

ROOT validation on the integrated tree:

- Nine PGlite regression groups pass before and after integration, with actual FK definitions from migrations v61/v69/v73/v111. Six dependency cases retain the service, photo and referenced rows; owner, returned-row and failure guards pass.
- Existing waitlist test, syntax and provider UX/connection/write-ownership regressions pass (28 tests); handoff static contract and five handoff target tests pass.
- Final HTML provider and handoff references, provider precache and service-worker cache generation are 1066. Client URL redirect contract passes after the final version change.
- Startup/core gate passes: 63 files, 3,799,092 bytes within the unchanged 3,799,094 limit.

An attempted extra check referenced a nonexistent `provider-write-failure-guard-test.mjs`; it was not executed, does not constitute a product failure and is not reported as a pass. The existing provider UX suite already exercises failed writes and session ownership. No assertions or budgets were relaxed.

Still required: exact final-head CI, ROOT normal integration and Pages deployment, exact live resource verification, and separately permitted target-screen acceptance. Available ROOT Pro tabs require sign-in; the human has confirmed both entrances work, but ROOT has not yet accepted a freshly loaded Pro schedule. Do not log in with saved credentials, delete a real service, run production SQL or alter secrets to manufacture proof. SQL or schema changes are neither included nor required.
