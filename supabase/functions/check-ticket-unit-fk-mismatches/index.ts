/**
 * Scheduled POST: audit ticket/conversation unit_id vs resident occupancy.
 * Report-only standing check against silent write-time FK corruption.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { authorizedCronBearer } from "../_shared/admin_edge_auth.ts"
import { processTicketUnitFkAudits } from "../_shared/ticketUnitFkAuditProcess.ts"

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }
  if (
    !authorizedCronBearer(req, [
      "ULO_OPS_CRON_SECRET",
      "CHECK_TICKET_UNIT_FK_AUDIT_SECRET",
      "ADMIN_REASSIGN_SECRET",
    ])
  ) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  const landlordId = typeof body.landlord_id === "string"
    ? body.landlord_id.trim()
    : typeof body.landlordId === "string"
    ? body.landlordId.trim()
    : null
  const dryRun = body.dry_run === true || body.dryRun === true

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const summary = await processTicketUnitFkAudits(supabase, {
      landlordId,
      dryRun,
    })
    return jsonResponse({ ok: true, ...summary })
  } catch (err) {
    console.error("[check-ticket-unit-fk-mismatches]", err)
    return jsonResponse(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    )
  }
})
