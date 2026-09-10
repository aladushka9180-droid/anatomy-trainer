import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleYandexBookingRequest } from "./handler.ts";

Deno.serve(handleYandexBookingRequest);
