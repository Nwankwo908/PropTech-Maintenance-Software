/**
 * Public tokenized estimate submit (Phase 3 / 4.3).
 * Auth: maintenance_requests.vendor_action_token (same as /w/:token).
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  loadEstimateContextForJobToken,
  submitMaintenanceEstimate,
} from "../_shared/maintenanceEstimates.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  let body: {
    token?: string
    action?: string
    partsCost?: number
    laborCost?: number
    totalCost?: number
    notes?: string
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const token = typeof body.token === "string" ? body.token.trim() : ""
  if (!token || !uuidRe.test(token)) {
    return jsonResponse({ error: "Invalid job token" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const action = (body.action ?? "submit").trim().toLowerCase()

  if (action === "resolve") {
    const ctx = await loadEstimateContextForJobToken(supabase, token)
    if (!ctx.ok) {
      return jsonResponse({ error: ctx.error }, ctx.status)
    }
    return jsonResponse({
      ok: true,
      ticketId: ctx.ticketId,
      workOrderRef: ctx.workOrderRef,
      unit: ctx.unit,
      description: ctx.description,
      pendingEstimate: ctx.pendingEstimate,
    })
  }

  if (action !== "submit") {
    return jsonResponse({ error: "Unknown action" }, 400)
  }

  const ctx = await loadEstimateContextForJobToken(supabase, token)
  if (!ctx.ok) {
    return jsonResponse({ error: ctx.error }, ctx.status)
  }

  const result = await submitMaintenanceEstimate(supabase, {
    ticketId: ctx.ticketId,
    vendorId: ctx.vendorId,
    money: {
      partsCost: Number(body.partsCost),
      laborCost: Number(body.laborCost),
      totalCost: body.totalCost == null ? null : Number(body.totalCost),
      notes: typeof body.notes === "string" ? body.notes : null,
    },
  })

  if (!result.ok) {
    return jsonResponse({ error: result.error }, result.status ?? 500)
  }

  return jsonResponse({
    ok: true,
    estimateId: result.estimateId,
    status: result.status,
    message:
      "Estimate sent to the property team for approval. You'll get a text when they decide.",
  })
})
