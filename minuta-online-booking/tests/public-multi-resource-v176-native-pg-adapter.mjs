// The v176 synthetic fixture can also run on a disposable native PostgreSQL.
// Its connection string is accepted only for the local CI service database.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const endpoint = new URL(process.env.MINUTA_V176_EPHEMERAL_DATABASE_URL || '');
assert.equal(process.env.MINUTA_V176_EPHEMERAL_CONFIRM, 'EMPTY_LOCAL_POSTGRES');
assert.ok(['127.0.0.1', 'localhost'].includes(endpoint.hostname));
assert.equal(endpoint.pathname, '/minuta-v176-fixture');
const pg = await import(pathToFileURL(process.env.MINUTA_PG_MODULE).href);
const Client = pg.Client || pg.default?.Client;

export class PGlite {
  constructor() {
    this.client = new Client({ connectionString: endpoint.href, application_name: 'v176-ephemeral-fixture' });
    this.connection = this.client.connect();
  }
  async query(sql, params = []) {
    await this.connection;
    return this.client.query(sql, params);
  }
  async exec(sql) {
    return this.query(sql);
  }
  async close() {
    await this.connection;
    await this.client.end();
  }
}
