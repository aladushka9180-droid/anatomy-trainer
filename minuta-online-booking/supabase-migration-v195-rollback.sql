begin;
-- Operational rollback removes the additive RPCs only. Preserve receipts,
-- created shifts and audit history; never delete somebody's live schedule.
drop function if exists public.copy_minuta_staff_shift_week(uuid,date,date,uuid,uuid,text,uuid);
drop function if exists public.preview_minuta_staff_shift_week_copy(uuid,date,date,uuid,uuid);
drop function if exists public.minuta_shift_week_copy_plan_v195(uuid,date,date,uuid,uuid);
notify pgrst,'reload schema';
commit;
