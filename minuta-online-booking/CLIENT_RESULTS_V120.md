# Private client results v120

Migration v120 is an additive extension of the private v112 client-record subsystem. It keeps one result series per booking, four private text fields (`before_session`, `work_done`, `after_session`, `recommendations`), up to one `before` and one `after` image, and an append-only consent ledger. It reuses the private `minuta-client-records` bucket; phone numbers are not placed in object paths.

## Access and consent

- The three v120 tables have RLS enabled, no direct `anon` or `authenticated` table privileges, and no permissive policies. Application access is only through `SECURITY DEFINER` RPCs.
- The v112 organization/booking access boundary is preserved. A specialist sees only results linked to their visits; owners and admins retain organization-wide access.
- Result writes and media reservation require the v112 client-record setting to be enabled and active private-storage consent.
- Every save writes idempotent `private_storage` and `external_share` consent events keyed by authenticated actor plus `p_request`. Reusing a request UUID with a different payload fails closed.
- External sharing consent is recorded but v120 creates no public URL and grants no public Storage access.

## UI RPC contract

- `get_minuta_client_results_v120(p_organization,p_phone,p_offset)` returns top-level `enabled`, `can_enable`, `entries`, and `media` arrays. Media is limited to the returned page of entries.
- `get_minuta_client_result_v120(p_organization,p_booking)` returns top-level `enabled`, `can_enable`, `entry`, and `media` for the booking editor.
- `save_minuta_client_result_v120(p_organization,p_phone,p_booking,p_id,p_before_session,p_work_done,p_after_session,p_recommendations,p_private_storage_consent,p_external_share_consent,p_request)` creates or updates the one series linked to the booking.
- `create_minuta_client_result_media_v120(p_organization,p_phone,p_result,p_id,p_purpose,p_mime_type,p_byte_size)` intentionally has no `p_booking`; the result row already binds and verifies the booking. It reserves an opaque v112 upload and returns its upload contract.
- `complete_minuta_client_result_media_v120(p_id)` finalizes a reserved object after Storage metadata validation.
- `archive_minuta_client_result_media_v120(p_id)` hides media but retains bytes for recovery. It is not physical deletion and not replacement; a retained slot remains occupied.

The generic `get_minuta_client_records` RPC excludes entries linked to result media, preventing the same photo from appearing twice.

## Release and rollback

Use `.github/workflows/minuta-v120-safe-release.yml` in order: isolated `test-v120`, read-only `validate-production-v120`, encrypted-backup/test/validation-gated `apply-production-v120`, then read-only `observe-production-v120`. Production apply requires the exact main commit and the explicit confirmation phrase.

The rollback drops application RPCs but never drops v120 tables or objects. Retained result objects fail closed in Storage and stay hidden from the generic v112 list. Reapplying v120 restores access without losing series, media links, text, or consent events. A future consent-withdrawal/erasure feature must use a separate service-role deletion workflow with verified Storage absence before metadata removal.
