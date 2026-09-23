/**
 * Landlord approve/reject for maintenance estimates (Phase 3 / 4.3).
 * GET  ?action=approve|reject&estimateId=&token=  (1-tap SMS/email links)
 * POST { action, estimateId, token }              (admin thread / SPA)
 *
 * GET always 302s to the SPA result page. Supabase rewrites text/html → text/plain
 * on *.supabase.co, so HTML cannot be rendered from this function URL.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { decideMaintenanceEstimate } from "../_shared/maintenanceEstimates.ts"
import { uloAppUrl } from "../_shared/uloAppUrl.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  })
}

function redirectToResult(params: {
  status: "approved" | "rejected" | "error"
  already?: boolean
  message?: string | null
}): Response {
  const location = uloAppUrl.estimateDecisionResult({
    status: params.status,
    already: params.already,
    message: params.message,
  })
  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      Location: location,
      "Cache-Control": "no-store",
    },
  })
}

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type ParsedAction = {
  action: "approve" | "reject"
  estimateId: string
  token: string
  asJson: boolean
}

async function parseRequest(req: Request): Promise<ParsedAction | { error: string; asJson: boolean }> {
  if (req.method === "GET") {
    const url = new URL(req.url)
    const actionRaw = (url.searchParams.get("action") ?? "").trim().toLowerCase()
    const action = actionRaw === "approve" || actionRaw === "reject" ? actionRaw : null
    const estimateId = (url.searchParams.get("estimateId") ?? "").trim()
    const token = (url.searchParams.get("token") ?? "").trim()
    if (!action || !uuidRe.test(estimateId) || !uuidRe.test(token)) {
      return { error: "invalid_link", asJson: false }
    }
    return { action, estimateId, token, asJson: false }
  }

  if (req.method === "POST") {
    let body: Record<string, unknown> = {}
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return { error: "invalid_json", asJson: true }
    }
    const actionRaw = String(body.action ?? "").trim().toLowerCase()
    const action = actionRaw === "approve" || actionRaw === "reject" ? actionRaw : null
    const estimateId = String(body.estimateId ?? "").trim()
    const token = String(body.token ?? "").trim()
    if (!action || !uuidRe.test(estimateId) || !uuidRe.test(token)) {
      return { error: "invalid_body", asJson: true }
    }
    return { action, estimateId, token, asJson: true }
  }

  return { error: "method", asJson: true }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const parsed = await parseRequest(req)
  if ("error" in parsed) {
    if (parsed.error === "method") {
      return parsed.asJson
        ? jsonResponse({ ok: false, error: "Method not allowed" }, 405)
        : redirectToResult({
          status: "error",
          message: "Use the link from your text or email.",
        })
    }
    return parsed.asJson
      ? jsonResponse(
        {
          ok: false,
          error:
            "Missing or invalid estimate details. Refresh the thread and try again.",
        },
        400,
      )
      : redirectToResult({
        status: "error",
        message:
          "This approval link is missing information. Ask for a new estimate notification.",
      })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return parsed.asJson
      ? jsonResponse({ ok: false, error: "Server misconfiguration." }, 500)
      : redirectToResult({
        status: "error",
        message: "Server misconfiguration.",
      })
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const result = await decideMaintenanceEstimate(supabase, {
    estimateId: parsed.estimateId,
    actionToken: parsed.token,
    action: parsed.action,
    source: parsed.asJson ? "admin" : "sms",
  })

  if (!result.ok) {
    return parsed.asJson
      ? jsonResponse(
        { ok: false, error: result.error },
        result.status ?? 500,
      )
      : redirectToResult({
        status: "error",
        message: result.error,
      })
  }

  if (parsed.asJson) {
    return jsonResponse({
      ok: true,
      status: result.status,
      already: result.already ?? false,
    })
  }

  return redirectToResult({
    status: result.status,
    already: result.already ?? false,
  })
})
