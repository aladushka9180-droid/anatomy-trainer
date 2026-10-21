# Manual expense business date

The manual expense RPC already receives the selected date and saves it in the
expense metadata and accrual. Its previous four-argument supplier-payment call
uses `now()` for the cash posting, so a historical expense falls in today's cash
period. The browser report reproduced this with August expenses appearing in October.

Apply `scripts/manual-expense-business-date-forward.sql` after the existing v163
schema. It adds an internal, non-RPC payment helper with an explicit timestamp
and switches only the manual expense writer to it. Date validation, timezone
conversion at local noon, actor/organization checks, locks, balanced postings,
request IDs and existing replay/conflict rules are preserved. The original
four-argument supplier-payment API is unchanged. The new helper is an invoker
with no PUBLIC/anon/authenticated/service_role execute grant; only the existing
postgres-owned writer calls it. All application JavaScript and styles are unchanged.

The forward patch does not rewrite or replay historical operations. Existing
request IDs still return their original records. The rollback script restores
the original v163 writer and removes only the internal helper, preserving rows.
Production remains subject to the separate protected full-copy restore and
release-owner gate. An isolated QA installation is not a production release.

`tests/manual-expense-business-date-test.mjs` reproduces the original mismatch
with the actual ledger and writer SQL, then checks date/balance, staff/shared
assignment, exact retry, changed-date conflict, authorization, timezone/DST and
populated rollback/reapply. Its Auth and digest are explicitly local fixtures;
it does not replace genuine Supabase Auth or browser acceptance.

For native QA retesting, retain the two R13 expenses as immutable defect evidence.
Use fresh clearly marked UI examples with different amounts (121 and 81 rubles)
dated 14 August. Do not reverse, delete or silently move old operations, and do not
create the old 120/80-ruble expenses again. Once the new examples are posted,
August should show 377/202/175 rubles for the team, 377/0/377 for finance-qa,
and 0/121/-121 for finance-qa-2. The old 200 rubles remain in October, whose
current expected cash totals are 2000/1100/900 until a separate correction decision.
