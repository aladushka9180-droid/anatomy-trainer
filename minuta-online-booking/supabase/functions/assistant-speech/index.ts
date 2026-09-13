import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { assistantSpeechSsml, createSpeechHandler } from "./handler.ts";

const AZURE_TIMEOUT_MS = 8000;
const regionPattern = /^[a-z0-9-]{2,40}$/;

function speechConfiguration() {
  const key = Deno.env.get("AZURE_SPEECH_KEY")?.trim() || "";
  const region = Deno.env.get("AZURE_SPEECH_REGION")?.trim().toLowerCase() || "";
  return { key, region, configured:Boolean(key && regionPattern.test(region)) };
}

const handler = createSpeechHandler({
  configured:speechConfiguration().configured,
  allowedOrigins:(Deno.env.get("ASSISTANT_ALLOWED_ORIGINS") || "").split(",").map(value => value.trim()).filter(Boolean),
  timeoutMs:AZURE_TIMEOUT_MS,
  async authenticate(request) {
    const authorization = request.headers.get("authorization") || "";
    if (!authorization.startsWith("Bearer ")) return null;
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    if (!supabaseUrl || !anonKey) return null;
    const client = createClient(supabaseUrl, anonKey, {
      global:{ headers:{ Authorization:authorization } },
      auth:{ persistSession:false, autoRefreshToken:false },
    });
    const { data:{ user }, error } = await client.auth.getUser();
    return error || !user ? null : { id:user.id };
  },
  async synthesize({ text, voiceName, signal }) {
    const { key, region, configured } = speechConfiguration();
    if (!configured) return new Response(null, { status:503, headers:{ "x-speech-configuration":"missing" } });
    return fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method:"POST",
      headers:{
        "content-type":"application/ssml+xml",
        "ocp-apim-subscription-key":key,
        "user-agent":"PrimeTime-Pro-assistant-speech",
        "x-microsoft-outputformat":"audio-24khz-48kbitrate-mono-mp3",
      },
      body:assistantSpeechSsml(text, voiceName),
      signal,
    });
  },
});

Deno.serve(handler);
