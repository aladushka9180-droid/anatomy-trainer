\set ON_ERROR_STOP on
begin;
set local lock_timeout='5s';
-- Operational rollback only. Preserve requests, payloads and linked media.
-- Retain the shared legacy/media daily-cap trigger and cleanup/replay/release APIs.
-- This flag is NOT cancellation of an in-flight transaction or Storage transfer.
-- Release owner must drain and reconcile those operations before declaring rollback complete.
update public.product_feedback_media_settings set enabled=false where singleton;
notify pgrst,'reload schema';
commit;
