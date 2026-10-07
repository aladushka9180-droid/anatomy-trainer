import { pathToFileURL } from 'node:url';
export function validateSyntheticConnection(env) {
  if (env.ADDON_OFFERS_SQL_CONFIRM !== 'LOCAL_SYNTHETIC_DB_ONLY') throw new Error('Native fixture requires ADDON_OFFERS_SQL_CONFIRM=LOCAL_SYNTHETIC_DB_ONLY');
  const url = new URL(env.ADDON_OFFERS_SQL_DATABASE_URL || '');
  if (!['postgres:','postgresql:'].includes(url.protocol) || !['127.0.0.1','localhost','[::1]'].includes(url.hostname)
    || url.pathname !== '/addon-offers-fixture' || url.search || url.hash) throw new Error('Native fixture requires loopback host, /addon-offers-fixture database, no URL options');
  return url;
}
export async function createNativeFixture(env = process.env) {
  const url = validateSyntheticConnection(env);
  if (!env.MINUTA_PG_MODULE) throw new Error('Set MINUTA_PG_MODULE to separately installed pg/lib/index.js');
  const packageExports = await import(pathToFileURL(env.MINUTA_PG_MODULE).href);
  const Client = packageExports.Client || packageExports.default?.Client;
  const config={ host:url.hostname === '[::1]' ? '::1' : url.hostname, port:Number(url.port || 5432), database:'addon-offers-fixture',
    user:decodeURIComponent(url.username), password:decodeURIComponent(url.password), ssl:false, connectionTimeoutMillis:5000 };
  const client = new Client(config);
  await client.connect();
  try {
    const result = await client.query("select (select count(*) from pg_namespace where nspname not in('public','information_schema') and nspname not like 'pg_%')::integer as schemas,(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public')::integer as objects,current_database() as database");
    if (result.rows[0]?.database !== 'addon-offers-fixture' || result.rows[0].schemas !== 0 || result.rows[0].objects !== 0) throw new Error('Native fixture refuses a non-empty database');
  } catch (error) { await client.end(); throw error; }
  const wrap=connection=>({exec:sql=>connection.query(sql),query:(sql,values=[])=>connection.query(sql,values),close:()=>connection.end()});
  return { ...wrap(client), async connectPeer() {
    // This factory exists only after the initial guarded empty-target check.
    const peer=new Client(config);await peer.connect();return wrap(peer);
  } };
}
