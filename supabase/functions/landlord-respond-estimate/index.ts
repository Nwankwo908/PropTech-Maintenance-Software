/**
 * Landlord approve/reject for maintenance estimates (Phase 3 / 4.3).
 * GET  ?action=approve|reject&estimateId=&token=  (1-tap SMS/email links)
 * POST { action, estimateId, token }              (admin thread / SPA)
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { decideMaintenanceEstimate } from "../_shared/maintenanceEstimates.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function htmlResponse(
  title: string,
  message: string,
  status = 200,
): Response {
  const body = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(title)}</title>
</head>
<body style="font-family:system-ui,sans-serif;padding:24px;line-height:1.5;color:#101828;max-width:32rem;margin:0 auto;">
  <h1 style="font-size:1.25rem;margin:0 0 12px;">${escapeHtml(title)}</h1>
  <p style="margin:0;color:#364153;">${escapeHtml(message)}</p>
</body>
</html>`
  return new Response(body, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
  })
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
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
        : htmlResponse("Method not allowed", "Use the link from your text or email.", 405)
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
      : htmlResponse(
        "Invalid link",
        "This approval link is missing information. Ask for a new estimate notification.",
        400,
      )
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return parsed.asJson
      ? jsonResponse({ ok: false, error: "Server misconfiguration." }, 500)
      : htmlResponse("Server error", "Misconfiguration.", 500)
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
      : htmlResponse(
        "Could not update estimate",
        result.error,
        result.status ?? 500,
      )
  }

  if (parsed.asJson) {
    return jsonResponse({
      ok: true,
      status: result.status,
      already: result.already ?? false,
    })
  }

  if (result.already) {
    return htmlResponse(
      result.status === "approved" ? "Already approved" : "Already declined",
      result.status === "approved"
        ? "This estimate was already approved. The vendor was notified."
        : "This estimate was already declined. The vendor was notified.",
    )
  }

  return htmlResponse(
    result.status === "approved" ? "Estimate approved" : "Estimate declined",
    result.status === "approved"
      ? "Thanks — the vendor has been notified that they can proceed."
      : "Got it — the vendor has been notified that this estimate was not approved.",
  )
})
