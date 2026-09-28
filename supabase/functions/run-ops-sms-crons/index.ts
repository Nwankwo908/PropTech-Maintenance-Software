/**
 * Shared ops cron: tenant onboarding silence/delivery retries + rent reminders.
 *
 * Schedule hourly (pg_cron → this function). Safe to call with `{}` for every
 * landlord, or pass `landlord_id` to scope one account.
 *
 *   curl -X POST ".../functions/v1/run-ops-sms-crons" \
 *     -H "Authorization: Bearer $ULO_OPS_CRON_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{}'
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { authorizedCronBearer } from "../_shared/admin_edge_auth.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { listLandlordIdsForCron } from "../_shared/cronLandlords.ts"
import { checkRentCollection } from "../_shared/engine/checkRentCollection.ts"
import { reportMissingRequiredCronJobs } from "../_shared/missingRequiredCrons.ts"
import { processTenantActivationRetries } from "../_shared/sms/tenantActivation.ts"
import { sendNeedsAdminVendorDigest } from "../_shared/needsAdminVendorDigest.ts"

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
      "CHECK_TENANT_ACTIVATION_SECRET",
      "CHECK_RENT_COLLECTION_SECRET",
      "ADMIN_REASSIGN_SECRET",
      "RUN_WORKFLOW_TRIGGERS_SECRET",
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

  const scopedLandlordId = typeof body.landlord_id === "string"
    ? body.landlord_id.trim()
    : ""
  const dryRun = body.dry_run === true || body.dryRun === true
  const digestOnly =
    body.needs_admin_digest_only === true ||
    body.needsAdminDigestOnly === true
  const digestForce =
    body.needs_admin_digest_force === true ||
    body.needsAdminDigestForce === true

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const missingCrons = await reportMissingRequiredCronJobs(supabase, {
      landlordId: scopedLandlordId || null,
    })

    if (digestOnly) {
      const needsAdminDigest = await sendNeedsAdminVendorDigest(supabase, {
        force: digestForce,
        dryRun,
      })
      return jsonResponse({
        ok: true,
        needs_admin_digest_only: true,
        needs_admin_vendor_digest: needsAdminDigest,
        missing_required_crons: missingCrons.map((j) => ({
          jobname: j.jobname,
          edge_function: j.edgeFunction,
        })),
      })
    }

    if (dryRun) {
      const landlordIds = scopedLandlordId
        ? [scopedLandlordId]
        : await listLandlordIdsForCron(supabase)
      return jsonResponse({
        ok: true,
        dry_run: true,
        missing_required_crons: missingCrons.map((j) => ({
          jobname: j.jobname,
          edge_function: j.edgeFunction,
        })),
        would_process: {
          tenant_activation: true,
          rent_collection_landlords: landlordIds,
        },
        message:
          "Dry-run: would run tenant activation retries + rent collection for listed landlords; no SMS or writes.",
      })
    }

    const activation = await processTenantActivationRetries(
      supabase,
      scopedLandlordId || null,
    )

    const landlordIds = scopedLandlordId
      ? [scopedLandlordId]
      : await listLandlordIdsForCron(supabase)

    const rentResults: Array<Record<string, unknown>> = []
    let rentRemindersSent = 0
    let rentStarted = 0
    let rentErrors = 0

    for (const landlordId of landlordIds) {
      try {
        const result = await checkRentCollection(supabase, { landlordId })
        rentRemindersSent += result.reminders_sent
        rentStarted += result.started
        rentErrors += result.errors.length
        rentResults.push({
          landlord_id: landlordId,
          rent_due_window: result.rent_due_window,
          reminders_sent: result.reminders_sent,
          started: result.started,
          skipped: result.skipped,
          errors: result.errors.length,
        })
      } catch (err) {
        rentErrors += 1
        rentResults.push({
          landlord_id: landlordId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    let needsAdminDigest: Record<string, unknown> = {}
    try {
      needsAdminDigest = await sendNeedsAdminVendorDigest(supabase)
    } catch (err) {
      console.error("[run-ops-sms-crons] needs_admin digest", err)
      needsAdminDigest = {
        sent: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }

    return jsonResponse({
      ok: true,
      missing_required_crons: missingCrons.map((j) => ({
        jobname: j.jobname,
        edge_function: j.edgeFunction,
      })),
      tenant_activation: activation,
      rent_collection: {
        landlords: landlordIds.length,
        reminders_sent: rentRemindersSent,
        started: rentStarted,
        errors: rentErrors,
        results: rentResults,
      },
      needs_admin_vendor_digest: needsAdminDigest,
    })
  } catch (err) {
    console.error("[run-ops-sms-crons]", err)
    return jsonResponse(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    )
  }
})
