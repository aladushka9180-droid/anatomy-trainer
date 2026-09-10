import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePrimeTimeWebhookDispatch } from "./handler.ts";

Deno.serve((request) => handlePrimeTimeWebhookDispatch(request));
