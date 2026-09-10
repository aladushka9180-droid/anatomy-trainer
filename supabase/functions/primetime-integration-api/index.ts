import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePrimeTimeIntegrationRequest } from "./handler.ts";

Deno.serve(handlePrimeTimeIntegrationRequest);
