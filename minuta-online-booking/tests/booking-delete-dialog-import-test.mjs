import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {prepareCloneSchema,safeImportDiagnostic} from './booking-delete-dialog-import.mjs';
const {PGlite}=await import(process.env.MINUTA_PGLITE_MODULE
  ?pathToFileURL(process.env.MINUTA_PGLITE_MODULE).href:'@electric-sql/pglite');
const db=new PGlite();
try {
  await db.exec('create role authenticated; grant usage on schema public to authenticated; create table public.bootstrap_sentinel(id integer); insert into public.bootstrap_sentinel values(7)');
  await assert.rejects(db.exec('CREATE SCHEMA public;'),error=>error.code==='42P06');
  const body="CREATE FUNCTION public.literal() RETURNS text LANGUAGE sql AS $$ SELECT 'CREATE SCHEMA public;' $$;";
  const input=`-- pg_dump header\nCREATE SCHEMA public;\n${body}\nGRANT USAGE ON SCHEMA public TO authenticated;\n`;
  const prepared=prepareCloneSchema(input);
  assert.equal(prepared.publicSchemas,1); assert.ok(prepared.output.includes(body));
  await db.exec(prepared.output);
  assert.equal((await db.query('select public.literal() result')).rows[0].result,'CREATE SCHEMA public;');
  assert.equal((await db.query('select * from public.bootstrap_sentinel')).rows[0].id,7);
  assert.equal((await db.query("select has_schema_privilege('authenticated','public','usage') allowed")).rows[0].allowed,true);
  console.log('PASS: reproduces duplicate public schema; normalized import preserves existing schema, bootstrap grants, rows and literal/function bodies');

  const tricky=`-- CREATE SCHEMA public;\nCREATE FUNCTION public.tricky() RETURNS text LANGUAGE sql AS $tag$ SELECT 'CREATE SCHEMA public;' $tag$;\nCREATE SCHEMA private;\nCOMMENT ON SCHEMA public IS 'CREATE SCHEMA public;';`;
  const unchanged=prepareCloneSchema(tricky);
  assert.equal(unchanged.publicSchemas,0); assert.equal(unchanged.output,tricky);
  assert.equal(prepareCloneSchema('CREATE SCHEMA "public";').publicSchemas,1);
  assert.equal(prepareCloneSchema('CREATE SCHEMA "PUBLIC";').publicSchemas,0);
  for(const dml of ['INSERT INTO public.t VALUES(1);','TRUNCATE public.t;','DROP SCHEMA public CASCADE;', 'COPY public.t (id) FROM stdin;\n1\n\\.\n'])
    assert.throws(()=>prepareCloneSchema(dml));
  assert.throws(()=>prepareCloneSchema('CREATE SCHEMA public; CREATE SCHEMA public;'));
  const webhook="CREATE TRIGGER outbound AFTER INSERT ON public.t FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request('https://private.invalid','POST','secret');";
  const excluded=prepareCloneSchema(webhook);
  assert.equal(excluded.removedWebhooks,1); assert.ok(!excluded.output.includes('private.invalid'));
  assert.throws(()=>prepareCloneSchema('CREATE TRIGGER unknown AFTER INSERT ON public.t FOR EACH ROW EXECUTE FUNCTION other_schema.send();'));
  console.log('PASS: only exact top-level public creation changes; data commands rejected and existing strict webhook filter retained');

  const secret='NEVER_EXPOSE_PRIVATE_VALUE';
  const diagnostic=safeImportDiagnostic('schema-import',`notice: ${secret}\npsql:/tmp/schema.sql:22: ERROR:  42P06\nDETAIL: ${secret}\nSQL: SELECT '${secret}';`);
  assert.deepEqual(diagnostic,{diagnostic:'booking_delete_clone_import',stage:'schema-import',sqlstate:'42P06',reason:'duplicate_schema',source:'schema',line:22});
  assert.ok(!JSON.stringify(diagnostic).includes(secret));
  assert.equal(safeImportDiagnostic('bootstrap',`psql:/tmp/bootstrap.sql:1: ERROR:  99999\n${secret}`).reason,'private_error_withheld');
  assert.equal(safeImportDiagnostic('fixture-bootstrap',`psql:/tmp/schema.sql:22: ERROR:  ${secret}`).sqlstate,'unclassified');
  assert.throws(()=>safeImportDiagnostic(secret,'42P06'));
  console.log('PASS: diagnostics allow only fixed stage/source/line and known SQLSTATE classifications, no raw private text');
} finally {await db.close();}
