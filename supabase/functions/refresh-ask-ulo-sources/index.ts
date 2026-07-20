/**
 * Cron or manual POST: probe due Ask Ulo official source feeds on cadence.
 *
 * Schedule daily, e.g. Supabase cron:
 *   curl -X POST ".../functions/v1/refresh-ask-ulo-sources" \
 *     -H "Authorization: Bearer $REFRESH_ASK_ULO_SOURCES_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"limit":25}'
 *
 * Prefer official .gov / HUD APIs. Aggregator URLs are refused.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { refreshAskUloSources } from "../_shared/ask_ulo/runAskUloSourceRefresh.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function authorized(req: Request): boolean {
  const secret =
    Deno.env.get("REFRESH_ASK_ULO_SOURCES_SECRET")?.trim() ??
    Deno.env.get("ADMIN_REASSIGN_SECRET")?.trim() ??
    Deno.env.get("RUN_WORKFLOW_ENGINE_SECRET")?.trim()
  if (!secret) return true
  const h = req.headers.get("Authorization")?.trim()
  if (!h?.toLowerCase().startsWith("bearer ")) return false
  return h.slice(7).trim() === secret
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405)
  }
  if (!authorized(req)) {
    return jsonResponse({ error: "unauthorized" }, 401)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "missing_supabase_env" }, 500)
  }

  let limit = 25
  try {
    const body = (await req.json()) as { limit?: unknown }
    if (typeof body.limit === "number" && Number.isFinite(body.limit)) {
      limit = Math.max(1, Math.min(100, Math.floor(body.limit)))
    }
  } catch {
    // empty body ok
  }

  const supabase = createClient(supabaseUrl, serviceKey)
  try {
    const result = await refreshAskUloSources(supabase, { limit })
    return jsonResponse({ ok: true, ...result })
  } catch (err) {
    console.error("[refresh-ask-ulo-sources]", err)
    return jsonResponse(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      500,
    )
  }
})
