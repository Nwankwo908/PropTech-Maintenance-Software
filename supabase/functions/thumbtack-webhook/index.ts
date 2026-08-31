import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  applyThumbtackInboundMessage,
  isThumbtackMessageCreatedEvent,
  parseThumbtackWebhookInbound,
} from "../_shared/external_vendor/thumbtackMessages.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-thumbtack-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function webhookAuthorized(req: Request): boolean {
  const secret = Deno.env.get("THUMBTACK_WEBHOOK_SECRET")?.trim() ?? ""
  const user = Deno.env.get("THUMBTACK_WEBHOOK_USER")?.trim() ?? ""
  const pass = Deno.env.get("THUMBTACK_WEBHOOK_PASSWORD")?.trim() ?? ""
  const headerSecret = req.headers.get("x-thumbtack-webhook-secret")?.trim() ?? ""
  const auth = req.headers.get("authorization") ?? ""
  if (secret && (headerSecret === secret || auth === `Bearer ${secret}`)) return true
  if (user && pass && auth.startsWith("Basic ")) {
    try {
      const decoded = atob(auth.slice(6).trim())
      return decoded === `${user}:${pass}`
    } catch {
      return false
    }
  }
  return false
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const secretConfigured = Boolean(
    Deno.env.get("THUMBTACK_WEBHOOK_SECRET")?.trim() ||
      (Deno.env.get("THUMBTACK_WEBHOOK_USER")?.trim() &&
        Deno.env.get("THUMBTACK_WEBHOOK_PASSWORD")?.trim()),
  )
  if (!secretConfigured) {
    console.warn("[thumbtack-webhook] missing webhook secrets")
    return jsonResponse({ error: "Webhook is not configured" }, 503)
  }
  if (!webhookAuthorized(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfigured" }, 500)
  }

  let parsed: unknown
  try {
    parsed = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const inbound = parseThumbtackWebhookInbound(parsed)
  if (!isThumbtackMessageCreatedEvent(inbound.eventType)) {
    return jsonResponse({ ok: true, ignored: true, reason: "event_type" })
  }

  const supabase = createClient(supabaseUrl, serviceKey)
  const result = await applyThumbtackInboundMessage(supabase, inbound)
  return jsonResponse({ ok: true, ...result })
})
