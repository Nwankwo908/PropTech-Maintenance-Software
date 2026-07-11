import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { adminReassignSecretAuthorized } from "../_shared/admin_reassign_auth.ts"
import { triggerMoveOutFromLeaseRenewal } from "../_shared/move_out_from_lease_renewal.ts"
import { isUuidShape } from "../_shared/uuid_shape.ts"

const corsHeaders = adminEdgeCorsHeaders

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  if (!adminReassignSecretAuthorized(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const leaseRenewalRunId = readString(body.leaseRenewalRunId)
  if (!leaseRenewalRunId || !isUuidShape(leaseRenewalRunId)) {
    return jsonResponse({ error: "Missing or invalid leaseRenewalRunId" }, 400)
  }

  const landlordId = readString(body.landlordId) ??
    Deno.env.get("DEFAULT_LANDLORD_ID")?.trim()
  if (!landlordId || !isUuidShape(landlordId)) {
    return jsonResponse({ error: "Missing or invalid landlordId" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    const result = await triggerMoveOutFromLeaseRenewal(supabase, {
      landlordId,
      leaseRenewalRunId,
    })

    if (!result.ok) {
      return jsonResponse({ ok: false, error: result.error }, 400)
    }

    return jsonResponse({
      ok: true,
      lease_renewal_run_id: result.leaseRenewalRunId,
      move_out_run_id: result.moveOutRunId,
      conversation_id: result.conversationId,
    })
  } catch (err) {
    console.error("[trigger-move-out-from-lease-renewal]", err)
    const message = err instanceof Error ? err.message : String(err)
    return jsonResponse({ ok: false, error: message }, 500)
  }
})
