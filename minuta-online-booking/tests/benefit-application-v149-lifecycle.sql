\set ON_ERROR_STOP on

-- Run against the isolated Minuta test database after the deployed v148 schema.
\ir ../supabase-migration-v149.sql
\ir ../supabase-migration-v149.sql
\ir benefit-application-v149-integration.sql
\ir ../supabase-migration-v149-rollback.sql
\ir benefit-application-v149-rollback-check.sql
\ir ../supabase-migration-v149.sql
\ir ../supabase-migration-v149.sql
\ir benefit-application-v149-integration.sql
