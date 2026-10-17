# Financial result and visit payments

This candidate implements the approved Statistics scope. It is separate from
the frozen expense-edit PR78 and does not deploy or post historical payments.

## Acceptance defined before final verification

| Scenario | Expected result |
| --- | --- |
| Received 2,000, expenses 900 | “Осталось после расходов” 1,100; no claim of full net profit |
| Verified empty period | Zero, with a complete/partial status based on source evidence |
| Receipt amount unavailable, expense 900 known | Receipt/result unknown; expense stays visible |
| Old manual mark, no ledger entry | Review notice; no credit to received until explicit confirmation |
| Automatic outcome with a price | Excluded from the review and automatic cash posting |
| Payment date and visit date differ | Cash charts use confirmed payment date; visits retain their dates |
| New manual payment | Outcome and balanced ledger postings commit together or neither commits |
| Partial payment | Received money and the remaining receivable remain distinct |
| Lost response and retry | Same request replays the same transaction, no second income |
| Changed source/account/amount or revoked role | Explicit refusal; no partial write or cross-organization effect |
| Historical mark changes while being reviewed | Refreshed amount and a new date confirmation; no automatic retry against changed evidence |
| Historical review cancelled | No write; original scope/focus retained |
| Populated inverse migration | Original outcomes, transactions, postings, grants and functions retained |

## Compatibility and ownership

The migration is additive and CLI-generated. It preserves v106/v129 functions.
`save_minuta_visit_payment_v1` wraps the genuine v106 outcome writer and a
private posting helper in one transaction. The helper preserves the v129
ledger guards, locking, balanced postings, source identity and one-live-entry
rule, adding an explicit confirmed payment date. Date precision is recorded as
`day`; the UI does not invent a displayed payment time.

Review only includes eligible manual cash/transfer marks; card/provider cases
keep their existing guarded path. Existing background completion and
old-backend behavior remain compatible and do not invent a payment. A backend
capability check gates the new atomic path. After an attempted write, the
client never falls back to a second writer. Stored retry metadata binds the
original request, date and destination account.

The existing startup cache limit remains unchanged. New payment logic stays
in the lazily loaded finance adapter. Only the two already-modified outcome
functions in the cached provider file use compact formatting; their local
formatting proof compares normalized syntax trees without compression or
renaming. No neighboring functions or cache limits are changed.

The inverse removes only the five new functions. It never deletes business
rows or rewrites previous function definitions. Already-created ledger rows
remain visible to the old ledger reader after inverse deployment.

ROOT “КААРДИНАТОР для мастеров” owns integration, public asset versions,
production SQL and release. Main68feda8c is the source base; the independent
38-fix candidate3b22f140 (including ledger pagination37) must be retained in the
ROOT union. No versions or existing numbered migrations are reassigned here.

## Evidence boundaries

Source and network-blocked browser fixtures are generated tests. PGlite uses
fixture identities and a substituted digest; it proves transaction behavior
in that model, not real Auth/crypto/ACL/source compatibility. These tests do
not qualify a native financial profile, full DB/Auth/Storage restore, actual
rollback, real historical payment posting, production deployment or live save.
QA37/60089 is read-only and must never receive payment writes.

The supported Browser currently exposes no working application tab. The
user-provided screenshot is the before reference; candidate screenshots are
synthetic render evidence. Genuine before/after, 390/760/1440 live acceptance
and the approved complete restore/rollback gates remain for the release owner.
