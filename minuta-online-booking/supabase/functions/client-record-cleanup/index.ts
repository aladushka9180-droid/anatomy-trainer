import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.115.0";
import { createCleanupHandler } from "./handler.ts";

const API_TIMEOUT_MS = 10_000;

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (legacy) return legacy;
  const keys = JSON.parse(requiredEnv("SUPABASE_SECRET_KEYS")) as Record<string,string>;
  const key = keys.default?.trim();
  if (!key) throw new Error("missing_supabase_secret_key");
  return key;
}

function boundedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const timeout = AbortSignal.timeout(API_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal,timeout]) : timeout;
  return fetch(input,{ ...init,signal });
}

async function serve(request: Request): Promise<Response> {
  let url: string;
  let key: string;
  let workerSecret: string;
  try {
    url = requiredEnv("SUPABASE_URL");
    key = serviceKey();
    workerSecret = requiredEnv("CLIENT_RECORD_CLEANUP_SECRET");
  } catch {
    return new Response(JSON.stringify({ ok:false,error:"not_configured" }),{
      status:503,headers:{ "content-type":"application/json; charset=utf-8","cache-control":"no-store" },
    });
  }

  const admin = createClient(url,key,{
    auth:{ persistSession:false,autoRefreshToken:false },
    global:{ fetch:boundedFetch },
  });
  const handler = createCleanupHandler({
    workerSecret,
    timeoutMs:API_TIMEOUT_MS,
    claim:async (limit,execute) => {
      const { data,error } = await admin.rpc("claim_expired_minuta_client_records",{ p_limit:limit,p_execute:execute });
      if (error) throw new Error("claim_failed");
      return data;
    },
    remove:async (bucket,paths) => {
      const { error } = await admin.storage.from(bucket).remove(paths);
      if (error) throw new Error("storage_remove_failed");
    },
    finish:async id => {
      const { error } = await admin.rpc("finish_expired_minuta_client_record",{ p_id:id });
      if (error) throw new Error("finish_failed");
    },
  });
  return handler(request);
}

Deno.serve(serve);
