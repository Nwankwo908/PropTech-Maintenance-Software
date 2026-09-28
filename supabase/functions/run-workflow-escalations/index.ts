/**
 * Scheduled POST: escalate workflow_runs waiting on tenant/vendor/admin past
 * workflow_templates.escalation_config thresholds (due_at or no_response_days).
 *
 * Schedule hourly (pg_cron → empty body runs every landlord):
 *   curl -X POST ".../functions/v1/run-workflow-escalations" \
 *     -H "Authorization: Bearer $ULO_OPS_CRON_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{}'
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { authorizedCronBearer } from "../_shared/admin_edge_auth.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { listLandlordIdsForCron } from "../_shared/cronLandlords.ts"
import { runWorkflowEscalations } from "../_shared/engine/runWorkflowEscalations.ts"

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

function resolveLandlordId(body: Record<string, unknown>): string | null {
  const fromBody = typeof body.landlord_id === "string"
    ? body.landlord_id.trim()
    : ""
  if (fromBody) return fromBody
  // Empty body → all landlords via listLandlordIdsForCron (do not pin DEFAULT).
  return null
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  if (!authorizedCronBearer(req, ["ULO_OPS_CRON_SECRET","RUN_WORKFLOW_ESCALATIONS_SECRET","CHECK_LEASE_RENEWALS_SECRET","RUN_WORKFLOW_ENGINE_SECRET","RUN_WORKFLOW_TRIGGERS_SECRET","ADMIN_REASSIGN_SECRET"])) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(
      { error: "Server misconfiguration: missing Supabase credentials" },
      500,
    )
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  const supabase = createClient(supabaseUrl, serviceKey)
  const scoped = resolveLandlordId(body)
  const dryRun = body.dry_run === true || body.dryRun === true

  try {
    const landlordIds = scoped
      ? [scoped]
      : await listLandlordIdsForCron(supabase)

    const results: Array<Record<string, unknown>> = []
    let candidates = 0
    let escalated = 0
    let skipped = 0
    let errors = 0
    const wouldEscalate: Array<Record<string, unknown>> = []

    for (const landlordId of landlordIds) {
      try {
        const result = await runWorkflowEscalations(supabase, {
          landlordId,
          dryRun,
        })
        candidates += result.candidates
        escalated += result.escalated
        skipped += result.skipped
        errors += result.errors.length
        if (result.would_escalate?.length) {
          wouldEscalate.push(
            ...result.would_escalate.map((e) => ({
              landlord_id: landlordId,
              ...e,
            })),
          )
        }
        results.push({
          landlord_id: result.landlord_id,
          candidates: result.candidates,
          escalated: result.escalated,
          skipped: result.skipped,
          errors: result.errors.length,
          dry_run: result.dry_run ?? false,
          would_escalate: result.would_escalate ?? [],
        })
      } catch (err) {
        errors += 1
        results.push({
          landlord_id: landlordId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return jsonResponse({
      ok: true,
      dry_run: dryRun,
      landlords: landlordIds.length,
      summary: { candidates, escalated, skipped, errors },
      would_escalate: dryRun ? wouldEscalate : undefined,
      results,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[run-workflow-escalations]", message)
    return jsonResponse({ ok: false, error: message }, 500)
  }
})
