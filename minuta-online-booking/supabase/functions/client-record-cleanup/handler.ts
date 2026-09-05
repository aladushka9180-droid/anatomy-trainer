export const CLIENT_RECORD_BUCKET = "minuta-client-records";

export type CleanupJob = { id: string; object_path: string };

export type CleanupDependencies = {
  workerSecret: string;
  timeoutMs?: number;
  claim: (limit: number, execute: boolean, signal: AbortSignal) => Promise<unknown>;
  remove: (bucket: string, paths: string[], signal: AbortSignal) => Promise<void>;
  finish: (id: string, signal: AbortSignal) => Promise<void>;
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const uuid = new RegExp(`^${uuidPattern}$`);
const objectPath = new RegExp(`^(${uuidPattern})/(${uuidPattern})\\.(pdf|jpg|png|webp)$`);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

async function sameSecret(actual: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(actualHash);
  const right = new Uint8Array(expectedHash);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0;
}

async function bounded<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new DOMException("Timed out", "TimeoutError");
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function safeJobs(value: unknown): CleanupJob[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const ids = new Set<string>();
  const paths = new Set<string>();
  const jobs: CleanupJob[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const id = String((entry as Record<string, unknown>).id || "");
    const path = String((entry as Record<string, unknown>).object_path || "");
    const match = objectPath.exec(path);
    if (!uuid.test(id) || !match || match[2] !== id || ids.has(id) || paths.has(path)) return null;
    ids.add(id); paths.add(path); jobs.push({ id, object_path:path });
  }
  return jobs;
}

function requestOptions(value: unknown): { limit: number; execute: boolean } | null {
  if (value == null) return { limit:100,execute:false };
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !["limit", "execute"].includes(key))) return null;
  if (body.execute != null && typeof body.execute !== "boolean") return null;
  const requested = body.limit == null ? 100 : Number(body.limit);
  if (!Number.isInteger(requested)) return null;
  return { limit:Math.max(1,Math.min(requested,100)),execute:body.execute === true };
}

function timedOut(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError";
}

export function createCleanupHandler(dependencies: CleanupDependencies) {
  const timeoutMs = Math.max(50, Math.min(dependencies.timeoutMs ?? 10_000, 30_000));
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return json({ ok:false,error:"method_not_allowed" },405);
    if (!dependencies.workerSecret) return json({ ok:false,error:"not_configured" },503);
    if (!await sameSecret(request.headers.get("x-worker-secret") || "", dependencies.workerSecret)) {
      return json({ ok:false,error:"unauthorized" },401);
    }

    let rawBody: unknown = {};
    try {
      const declaredLength = Number(request.headers.get("content-length") || 0);
      if (declaredLength > 1024) return json({ ok:false,error:"invalid_request" },400);
      const text = await request.text();
      if (text.length > 1024) return json({ ok:false,error:"invalid_request" },400);
      rawBody = text ? JSON.parse(text) : {};
    } catch {
      return json({ ok:false,error:"invalid_request" },400);
    }
    const options = requestOptions(rawBody);
    if (!options) return json({ ok:false,error:"invalid_request" },400);

    let claimed: unknown;
    try {
      claimed = await bounded(timeoutMs, signal => dependencies.claim(options.limit,options.execute,signal));
    } catch (error) {
      return json({ ok:false,error:timedOut(error) ? "claim_timeout" : "claim_failed" },timedOut(error) ? 504 : 502);
    }
    const jobs = safeJobs(claimed);
    if (!jobs) return json({ ok:false,error:"invalid_claim_response" },502);
    if (!options.execute) return json({ ok:true,dry_run:true,count:jobs.length });
    if (!jobs.length) return json({ ok:true,dry_run:false,claimed:0,removed:0,finished:0,failed:0 });

    try {
      await bounded(timeoutMs, signal => dependencies.remove(CLIENT_RECORD_BUCKET,jobs.map(job => job.object_path),signal));
    } catch (error) {
      return json({
        ok:false,error:timedOut(error) ? "storage_timeout" : "storage_remove_failed",
        claimed:jobs.length,removed:0,finished:0,failed:jobs.length,
      },timedOut(error) ? 504 : 502);
    }

    const results = await Promise.allSettled(jobs.map(job =>
      bounded(timeoutMs, signal => dependencies.finish(job.id,signal))
    ));
    const finished = results.filter(result => result.status === "fulfilled").length;
    const failed = jobs.length - finished;
    return json({
      ok:failed === 0,dry_run:false,claimed:jobs.length,removed:jobs.length,finished,failed,
    },failed ? 207 : 200);
  };
}
