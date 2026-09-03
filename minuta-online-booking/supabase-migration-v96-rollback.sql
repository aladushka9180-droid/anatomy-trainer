\set ON_ERROR_STOP on

-- Только для изолированной тестовой базы и только как второй шаг полного
-- обратного стека v95 -> v96 -> v94 -> v93 -> v92. Самостоятельным production-откатом не
-- является: production восстанавливается из проверенной резервной копии.
drop index concurrently if exists public.booking_events_scope_previous_date_v96_idx;
drop index concurrently if exists public.bookings_performer_date_time_v94_idx;

begin;
drop function if exists public.get_minuta_team_analytics(uuid,date,date);
commit;
