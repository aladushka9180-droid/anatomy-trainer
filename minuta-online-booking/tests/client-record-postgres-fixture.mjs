// Reuse the exact synthetic bootstrap from the in-memory SQL suite.
// This prints only synthetic fixture SQL, never database contents or credentials.
import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
const fixture = read('tests/client-records-pglite-runtime-test.mjs').match(/await db\.exec\(`([\s\S]*?)`\);/);
const normalize = read('supabase-migration-v54.sql').match(/create or replace function public\.normalize_client_phone[\s\S]*?\$\$;/);
const role = read('supabase-migration-v89.sql').match(/create or replace function public\.get_minuta_client_field_role[\s\S]*?\$\$;/);
if (!fixture || !normalize || !role || fixture[1].includes('${')) throw new Error('Synthetic fixture contract changed');
process.stdout.write(fixture[1] + '\n' + normalize[0] + '\n' + role[0] + '\n');
