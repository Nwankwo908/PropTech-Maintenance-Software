/**
 * Scheduled POST: find active residents with rent due today or overdue,
 * start rent_collection workflow runs, log rent.due_detected, send reminders, set stage routed.
 *
 * Schedule daily, e.g. Supabase cron:
 *   curl -X POST ".../functions/v1/check-rent-collection" \
 *     -H "Authorization: Bearer $CHECK_RENT_COLLECTION_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"landlord_id":"YOUR_LANDLORD_UUID"}'
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { checkRentCollection } from "../_shared/engine/checkRentCollection.ts"

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
  const secret = Deno.env.get("CHECK_RENT_COLLECTION_SECRET")?.trim() ??
    Deno.env.get("CHECK_LEASE_RENEWALS_SECRET")?.trim() ??
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

  const rentDueDay = typeof body.rent_due_day === "number"
    ? body.rent_due_day
    : undefined
  const latePaymentGraceDays = typeof body.late_payment_grace_days === "number"
    ? body.late_payment_grace_days
    : undefined

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    const result = await checkRentCollection(supabase, {
      landlordId,
      rentDueDay,
      latePaymentGraceDays,
    })

    return jsonResponse({
      ok: true,
      landlord_id: result.landlord_id,
      billing_period: result.billing_period,
      rent_due_date: result.rent_due_date,
      rent_due_window: result.rent_due_window,
      timing: {
        rent_due_day: result.rent_due_day,
        late_payment_grace_days: result.late_payment_grace_days,
      },
      summary: {
        candidates: result.candidates,
        started: result.started,
        skipped: result.skipped,
        reminders_sent: result.reminders_sent,
        late_payment_escalated: result.late_payment_escalated,
        errors: result.errors.length,
      },
      started_runs: result.started_runs.map((run) => ({
        resident_id: run.resident_id,
        billing_period: run.billing_period,
        amount_due: run.amount_due,
        workflow_run_id: run.workflow_run_id,
        workflow_type: run.workflow_type,
        rent_classification: run.rent_classification,
        stage: run.stage,
        sms_sent: run.sms_sent,
        email_sent: run.email_sent,
        route_channels: run.route_channels,
        payment_link: run.payment_link,
        payment_requested: run.payment_requested,
      })),
      errors: result.errors,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[check-rent-collection]", message)
    return jsonResponse({ ok: false, error: message }, 500)
  }
})
