import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleProviderInboundRequest } from "./handler.ts";

Deno.serve(request => handleProviderInboundRequest(request));
