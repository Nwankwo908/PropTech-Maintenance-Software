/**
 * Scheduled POST: find residents with leases expiring within the notice window (default 60 days),
 * start lease_renewal workflow runs via invokeWorkflowEngine, skip duplicates per lease end date.
 *
 * Schedule daily, e.g. Supabase cron:
 *   curl -X POST ".../functions/v1/check-lease-renewals" \
 *     -H "Authorization: Bearer $CHECK_LEASE_RENEWALS_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"landlord_id":"YOUR_LANDLORD_UUID"}'
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
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

function authorized(req: Request): boolean {
  const secret = Deno.env.get("CHECK_LEASE_RENEWALS_SECRET")?.trim() ??
    Deno.env.get("RUN_WORKFLOW_ENGINE_SECRET")?.trim() ??
    Deno.env.get("RUN_WORKFLOW_TRIGGERS_SECRET")?.trim()
  if (!secret) return true
  const h = req.headers.get("Authorization")?.trim()
  if (!h?.toLowerCase().startsWith("bearer ")) return false
  return h.slice(7).trim() === secret
}

function resolveLandlordId(body: Record<string, unknown>): string | null {
  const fromBody = typeof body.landlord_id === "string"
    ? body.landlord_id.trim()
    : ""
  if (fromBody) return fromBody

  return Deno.env.get("DEFAULT_LANDLORD_ID")?.trim() ?? null
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  if (!authorized(req)) {
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

  const landlordId = resolveLandlordId(body)
  if (!landlordId) {
    return jsonResponse({ error: "landlord_id required" }, 400)
  }

  const noticeDays = typeof body.notice_days === "number"
    ? body.notice_days
    : undefined
  const noResponseDays = typeof body.no_response_days === "number"
    ? body.no_response_days
    : undefined

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    const result = await checkLeaseRenewals(supabase, {
      landlordId,
      noticeDays,
      noResponseDays,
    })

    return jsonResponse({
      ok: true,
      landlord_id: result.landlord_id,
      timing: {
        notice_days: result.notice_days,
        no_response_days: result.no_response_days,
      },
      summary: {
        candidates: result.candidates,
        started: result.started,
        skipped: result.skipped,
        errors: result.errors.length,
      },
      started_runs: result.started_runs.map((run) => ({
        resident_id: run.resident_id,
        lease_end_date: run.lease_end_date,
        workflow_run_id: run.workflow_run_id,
        next_action: run.next_action,
      })),
      errors: result.errors,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[check-lease-renewals]", message)
    return jsonResponse({ ok: false, error: message }, 500)
  }
})
