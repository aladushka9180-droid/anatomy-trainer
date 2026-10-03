# Universal sales catalog: reviewable candidate

## Scope and readiness

Six agreed points: profession-neutral catalog; atomic multi-item cart and physical
bundles; selected-client repeat; actor/organization draft and unknown-result
recovery; confirmed Excel/CSV catalog import; soft minimal responsive UI.
Live acceptance remains **0/6**. No production SQL, migration number or PWA
version is assigned by this branch. Existing benefits and client-return flows
keep their respective owners.

## Common controller ownership

The author of this sales task is the sole writer of the catalog hook in
`commerce-management.js` on PR70's isolated branch; no other active controller
writer was found. The reviewed `commerce-catalog-controller.patch` is now
applied to that branch. It must not be applied a second time. The publisher
still owns final common-file composition, main, PWA versions and release.
`commerce-catalog-controller-hook.mjs` uses the actual integrated controller
when present, or the unique-anchor transformation in the baseline fixture.
Changed baseline anchors are reviewed instead of guessing a replacement.

The hook loads the adapter on demand after an authorized v151 workspace read;
context/reset/startSale operations invalidate the old scope. Modern inventory
goods never fall through to the old single-sale RPC. Only a missing catalog RPC
(PGRST202/42883 read response) allows the unchanged legacy single-item UI.
Permission/network/malformed responses do not allow legacy writes. Benefits,
sale-claim access, refund controls and account creation retain existing handlers.

The original controller startup budget is fully occupied. New modules remain
lazy; their URLs inherit the controller's release query. The render/load/submit/
lifecycle blocks lose only indentation, offsetting the hook (-9 UTF-8 bytes
against normalized LF baseline). No unrelated assets are packed, no budget is
raised. Publisher must remeasure its final PWA tree and coordinate versioning.

## New files and adapter

`commerce-catalog.js` mounts the view; data/draft/import modules hold exact
rules, persistent state and import parsing. CSS is scoped to the new view and
dialogs. `commerce-catalog-adapter.js` is the only new RPC bridge.

`createCatalogRpcAdapter(options,getContext)` checks the current actor, organization,
role and session generation both before RPC and after await. Its immutable scope
is `{orgId,actorId,sessionKey}`. Batch import commit is owner-only; a single
catalog item may be saved by owner/admin. A disabled write gate sends no POST.

The DOM bridge mounts **outside** the legacy sale form but inside its existing
creator. It hides the older product picker, keeps benefit controls available,
and moves the original account controls into the modern sale's details without
duplicating IDs or handlers. A scope reset restores their original positions.
The existing mobile focus mode hides bottom navigation while the sticky total
is open. Grouped history uses authoritative count/totals, cursor paging and the
old sale IDs for each refundable item. A failed read displays unknown totals
rather than counting cart components as separate purchases.

After an attested paid cart or confirmed receipt recovery, the bridge reuses
the existing v155 client-access code handler, anchored to the first component
sale. Only the same current actor/organization/session can issue it; a new
client or operation invalidates delayed issuance. A code-only retry uses the
original claim request and never repeats the cart sale. Unknown receipts
cannot issue a code. Tokens are not stored in the cart draft or its intent.

## Write contracts

The view receives `state`: org/actor/session/revision, capabilities, role,
items/bundles/warehouses/balances, current sale context and validated select
options. `update` rejects another scope or an older revision. Refreshing prices
and stock preserves the user's current client and editable cart.

- `onSubmit({scope,intent})`: one atomic cart RPC with original complete params.
- `onResolvePending({scope,kind,intent,requestId,mode})`: status read for sales,
  or the identical idempotent retry; metadata status mode performs no write.
- `onSaveCatalog`, `onSaveBundle`, `onPreviewImport`, `onCommitImport`,
  `onFavoriteChange` and `onRepeat`: candidate server contracts in the SQL doc.

Sale success returns `{confirmed:true,receipt}` only after receipt attestation.
The server receipt must include its stored original `intent_lines`; the adapter
compares that complete payload with the immutable request, including bundle count
and component fields, while ignoring JSON object key order. Missing/NULL snapshots
from earlier candidate rows remain unknown and are never silently backfilled.
Metadata success includes matching request/org and verified item/version or
bundle ID/version. A known first SQL rollback returns `{rolledBack:true,...}`.
Lost replies, request conflicts, invalid receipts and all failed retries after
an earlier unknown result preserve recovery. A rejected retry cannot disprove
an earlier commit. Pending data never expires with the editable-draft TTL and
contains no client name, phone, credential or claim code. Failed storage blocks
submission before POST.

Prices are integer minor units and quantities exact to three decimal places.
One 500ml pack at 89900 minor units keeps quantity=1 and consumes exactly500ml.
Repeat uses today's price, readiness and selected warehouse balance. Changed
units require explicit quantity confirmation; 500 legacy ml cannot become500
packs. Item+bundle demand is aggregated before submission and validated again
under database locks. Modified bundle components become ordinary item lines.

## Import and examples

Excel uses the existing pinned vendor decoder through the established loader;
CSV accepts quoted delimiters/newlines. File-size/type/formula checks precede
preview. Source row numbers survive blank lines and map server errors back to
the file. Stock/quantity/receipt columns are refused even if not mapped. The
commit requires a fresh preview hash, owner role and explicit confirmation.
Examples for professions only prefill an unsaved card; they never invent real
prices, quantities or balances. Custom categories, real variants, contour icons
and optional HTTPS photos are supported.

## Verified locally, 2026-10-03

- Native PostgreSQL17:15 groups including apply/reapply, exact legacy ACL/body
  preservation, RLS, permissions, atomic rollback, real two-session races,
  idempotency, grouping, conversion, refunds and both rollback modes.
  This uses an owned empty synthetic loopback DB, not full CURRENT restore.
-24 exact data/draft/import tests;13 adapter tests; scoped SQL static test.
- Standalone UI browser scenarios at390/760/1440, including XLSX loading,
  bundles/repeat, corruption/storage failure, roles, XSS and unknown-result retry.
- Actual provider panel/controller/soft styles at390/760/1440: atomic two-item
  sale and grouped count, legacy benefits, refund readiness, account creation,
  receipt recovery, context refresh, client-access issuance/retry, unknown
  receipt denial, permission/missing-RPC fallback and reset. Lazy-import failure
  after reset causes no unhandled rejection or late mount.
  All RPCs are synthetic; external network and service workers are blocked.
- Existing v151 sales and v155 client-access browser suites pass at390/760/1440.
  The v147 legacy-commerce fixture also passes with `--commerce-only`; its
  unrelated analytics block is excluded explicitly. That historical analytics
  assertion fails on fetched main's unchanged controller as well. The original
  full v147 command retains that assertion; it is not silently weakened.
- Existing soft UI5 tests, current URL/version consistency and startup:
  63 core files,3799085 bytes, within the unchanged3799094-byte cap.

The added isolated CI workflow runs those candidate checks without production
credentials or deployment actions. Remote results are separate from local PASS.
All23 prior-head checks passed on7422ea64; they do not prove a later hook commit.

## Release owner gates

1. Accept candidate and common-file hook; integrate with freshly fetched main.
2. Reserve the migration number/version; test against isolated **full CURRENT**
   restore and verify compatibility with real surrounding auth/benefits schema.
3. Confirm exact SQL package, fresh backup and operational/schema rollback;
   obtain required explicit production SQL approval before applying it.
4. Update the versioned lazy resources through the normal single-owner PWA
   release, rerun final budget/version/tests/CI, publish only accepted files.
5. On the actual site, verify all six requested scenarios, role/session changes,
   cache version and desktop/mobile dialogs. Use test fixtures for writes.

The unchanged PrimeTime client v155 purchase reader sees component rows rather
than the new grouped purchase; money remains correct. Its redesign belongs to
a separate client owner and is not silently included here. Physical-device and
full CURRENT/server release acceptance remain unverified.
