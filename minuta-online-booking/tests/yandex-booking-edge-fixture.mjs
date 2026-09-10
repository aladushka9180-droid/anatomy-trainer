// Executes the repository Edge module without network or database access.
// The production handler must keep local dependencies self-contained so the
// fixture exercises the same authentication and request parsing code.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const functionsRoot = path.resolve(fileURLToPath(new URL('../../supabase/functions/', import.meta.url)));

export const uuid = suffix => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;

export function jsonReply(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });
}

function decodedBody(body) {
  if (body == null || body === '') return null;
  try { return JSON.parse(body); } catch { return body; }
}

export function yandexBookingEdgeFixture({ env = {}, fetch: transport } = {}) {
  let handler;
  const requests = [];
  const logs = [];
  const fixtureConsole = Object.fromEntries(
    ['debug', 'info', 'log', 'warn', 'error'].map(level => [level, (...values) => logs.push({ level, values })])
  );
  const context = vm.createContext({
    URL,
    URLSearchParams,
    Request,
    Response,
    Headers,
    TextEncoder,
    TextDecoder,
    AbortController,
    AbortSignal,
    Uint8Array,
    crypto: webcrypto,
    btoa,
    atob,
    Date,
    console: fixtureConsole,
    Deno: {
      env: { get: key => env[key] },
      serve: callback => { handler = callback; }
    },
    fetch: async (url, init = {}) => {
      const request = {
        url: String(url),
        method: init.method || 'GET',
        headers: new Headers(init.headers),
        rawBody: init.body == null ? null : String(init.body),
        body: decodedBody(init.body == null ? null : String(init.body))
      };
      requests.push(request);
      assert.equal(typeof transport, 'function', 'No real network is allowed by the Edge fixture');
      return transport(request);
    }
  });

  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename);
    assert.ok(filename.startsWith(functionsRoot + path.sep), 'Only repository Edge modules may be loaded');
    // Node's built-in stripper deliberately rejects parameter properties. Keep
    // the fixture dependency-free by lowering the one Error class used by the
    // Edge module before erasing the remaining TypeScript annotations.
    let source = readFileSync(filename, 'utf8').replace(
      /class HttpError extends Error \{\s*constructor\(\s*readonly status: number,\s*readonly code: string,\s*readonly headers: Record<string, string> = \{\},\s*\) \{/,
      `class HttpError extends Error {
  status: number;
  code: string;
  headers: Record<string, string>;
  constructor(status: number, code: string, headers: Record<string, string> = {}) {
    this.status = status;
    this.code = code;
    this.headers = headers;`,
    );
    source = stripTypeScriptTypes(source, { mode: 'strip' });
    const dependencies = [];
    source = source
      .replace(/import\s+\{([\s\S]*?)\}\s+from\s+["']([^"']+)["'];?/g, (_all, names, relative) => {
        assert.ok(relative.startsWith('.'), `External runtime dependency is not supported by the fixture: ${relative}`);
        const dependency = load(path.resolve(path.dirname(filename), relative));
        const index = dependencies.push(dependency) - 1;
        return `const {${names.replace(/\bas\b/g, ':')}}=__dependencies[${index}];`;
      })
      .replace(/import\s+["']jsr:@supabase\/functions-js\/edge-runtime\.d\.ts["'];?/g, '');
    const exports = [...source.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let)\s+(\w+)/g)]
      .map(match => match[1]);
    source = source.replace(/\bexport\s+(?=(?:async\s+)?(?:function|class|const|let))/g, '');
    const factory = vm.runInContext(
      `(function(__dependencies){${source}\nreturn {${exports.join(',')}};})`,
      context,
      { filename }
    );
    const loaded = factory(dependencies);
    modules.set(filename, loaded);
    return loaded;
  }

  const exported = load(path.resolve(functionsRoot, 'yandex-booking-api/index.ts'));
  assert.equal(typeof handler, 'function', 'yandex-booking-api must register a Deno.serve handler');

  return {
    exported,
    requests,
    logs,
    call: async ({
      path: requestPath = '/v1/companies/feed',
      method = 'GET',
      headers = {},
      body,
      rawBody
    } = {}) => {
      const init = { method, headers: { accept: 'application/json', ...headers } };
      if (!['GET', 'HEAD'].includes(method)) {
        init.headers = { 'content-type': 'application/json', ...init.headers };
        if (rawBody !== undefined || body !== undefined) {
          init.body = rawBody ?? JSON.stringify(body);
        }
      }
      return handler(new Request(`https://edge.fixture.invalid${requestPath}`, init));
    }
  };
}
