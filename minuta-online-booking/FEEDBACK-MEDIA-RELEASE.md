# Feedback media v111: release handoff

## State

Implementation only. No tests, browser validation, production migration or Pages publication were performed in this task. Do not describe video uploads as live until the database gate and a real private upload have passed.

The frontend adds one description field, image/video previews, removal before submission, a per-file upload indicator, a same-tab text draft, request history and support reply rendering. This is not an in-browser screen recorder. Progress is per file/stage, not a byte percentage.

Drafts use sessionStorage scoped to user and organization, expire after 24 hours on opening, and contain text and an idempotent request envelope, not file blobs. A reload requires reselecting files not yet uploaded. Closing the dialog without reloading retains selected files. If the server result is uncertain, the payload stays frozen for an idempotent retry.

## Files

- provider-feedback.js: delegate to the new controller, retain legacy implementation.
- provider-feedback-media.js: new controller with v109 capability fallback.
- feedback-media.css: scoped responsive styling.
- provider.html: feedback dialog and new asset references only.
- supabase-migration-v111.sql: additive layer requiring v109, independent of the reserved legal v110.
- supabase-migration-v111-rollback.sql: fail closed if new requests, replies or Storage objects exist.

## Required release gates

1. Coordinate the release owner, update from current origin/main and preserve unrelated layout and voice changes.
2. Add the two assets to sw.js ASSETS. Assign the next resource version and synchronize all resource queries, registration/cache and version contracts. The working patch still references base v417 intentionally, pending release ownership.
3. With user authorization, validate frontend syntax, old/new capability states, keyboard/mobile layout, uploads, failure/retry, reload, account switch, history and support replies. No tests were added or modified in this task.
4. Extend the safe-release workflow to include v111 and guarded rollback. Do not require absent v110. Preserve the established test-baseline rollback order.
5. Obtain a fresh encrypted backup and test/transaction rollback gates on the exact release SHA. Old backup run 33953603446 is not sufficient. Only then apply the production migration.
6. Confirm the project's global Storage file limit permits 100 MiB as well as the bucket limit. Otherwise lower both advertised/client and backend limits before enabling video. Check MP4, MOV and WebM on real target phones: preview codec support differs.
7. Confirm owner-only access, signed URL expiry, denial for another user/anonymous access, MIME/size metadata validation, five-file and 200 MiB total limit, duplicate request retry and concurrent requests.
8. Publish Pages and confirm deployed asset/cache version; independently confirm one synthetic private-media request through the production flow before claiming the feature works end to end.

## Support operations

Replies can be inserted only by trusted service_role tooling into product_feedback_replies. The frontend displays those replies; this patch does not add a staff inbox or an operator reply editor. Existing service_role status updates to product_feedback remain supported. Never ship service credentials to the browser.

Authenticated users cannot modify/delete committed media objects. There is a 50-upload/24-hour count gate and a 20-request/24-hour gate. Abandoned unlinked uploads must be cleaned with the Storage API, after a retention grace period and an attachment-link check; an automatic cleanup worker is not included in this patch. Do not delete Storage catalog rows with SQL. Choose a retention policy before enabling broad production use.

The private bucket is intentionally retained during empty rollback. If users have submitted data, rollback stops rather than silently deleting their requests or media.
