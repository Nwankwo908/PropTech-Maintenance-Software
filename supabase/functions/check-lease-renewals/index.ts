/**
 * Scheduled POST: find residents with leases expiring within the notice window (default 60 days),
 * start lease_renewal workflow runs via invokeWorkflowEngine, skip duplicates per lease end date.
 *
 * Schedule daily (pg_cron → empty body runs every landlord):
 *   curl -X POST ".../functions/v1/check-lease-renewals" \
 *     -H "Authorization: Bearer $ULO_OPS_CRON_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{}'
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { authorizedCronBearer } from "../_shared/admin_edge_auth.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { listLandlordIdsForCron } from "../_shared/cronLandlords.ts"
import { checkLeaseRenewals } from "../_shared/engine/checkLeaseRenewals.ts"

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

  if (!authorizedCronBearer(req, ["ULO_OPS_CRON_SECRET","CHECK_LEASE_RENEWALS_SECRET","RUN_WORKFLOW_ENGINE_SECRET","RUN_WORKFLOW_TRIGGERS_SECRET","ADMIN_REASSIGN_SECRET"])) {
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

  const noticeDays = typeof body.notice_days === "number"
    ? body.notice_days
    : undefined
  const noResponseDays = typeof body.no_response_days === "number"
    ? body.no_response_days
    : undefined
  const dryRun = body.dry_run === true || body.dryRun === true

  const supabase = createClient(supabaseUrl, serviceKey)
  const scoped = resolveLandlordId(body)

  try {
    const landlordIds = scoped
      ? [scoped]
      : await listLandlordIdsForCron(supabase)

    const results: Array<Record<string, unknown>> = []
    let candidates = 0
    let started = 0
    let skipped = 0
    let errors = 0
    const wouldStart: Array<Record<string, unknown>> = []

    for (const landlordId of landlordIds) {
      try {
        const result = await checkLeaseRenewals(supabase, {
          landlordId,
          noticeDays,
          noResponseDays,
          dryRun,
        })
        candidates += result.candidates
        started += result.started
        skipped += result.skipped
        errors += result.errors.length
        if (result.would_start?.length) {
          wouldStart.push(
            ...result.would_start.map((r) => ({
              landlord_id: landlordId,
              ...r,
            })),
          )
        }
        results.push({
          landlord_id: result.landlord_id,
          candidates: result.candidates,
          started: result.started,
          skipped: result.skipped,
          errors: result.errors.length,
          dry_run: result.dry_run ?? false,
          would_start: result.would_start ?? [],
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
      timing: {
        notice_days: noticeDays ?? null,
        no_response_days: noResponseDays ?? null,
      },
      summary: { candidates, started, skipped, errors },
      would_start: dryRun ? wouldStart : undefined,
      results,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[check-lease-renewals]", message)
    return jsonResponse({ ok: false, error: message }, 500)
  }
})
