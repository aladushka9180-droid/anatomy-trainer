import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleProviderInboundRequest } from "./handler.ts";

// This release installs the adapter for reachability checks only. Enabling real
// provider traffic requires a separate reviewed release with vendor credentials.
const DEPLOYMENT_STATE = "disabled";

Deno.serve((request) => DEPLOYMENT_STATE === "disabled"
  ? new Response(JSON.stringify({ code: "NOT_CONFIGURED" }), {
    status: 503,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  })
  : handleProviderInboundRequest(request));
