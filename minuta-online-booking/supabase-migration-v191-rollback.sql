-- Use only for the isolated candidate rehearsal. Assign release-specific recovery
-- after the migration number and production dependency graph are confirmed.
drop function if exists public.get_minuta_report_export_imported_history(uuid,date,date,uuid,uuid,text,integer,integer);
drop function if exists public.get_minuta_report_export_bookings(uuid,date,date,uuid,uuid,text,integer,integer);
drop function if exists public.minuta_report_export_client_key(uuid,text);
