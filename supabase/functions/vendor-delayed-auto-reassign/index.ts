/**
 * Scheduled job:
 * 1. Tickets past due_at → auto-reassign to next roster vendor (or escalate if none).
 * 2. pending_accept 48h+ with no response → reassign via alternatives (legacy path).
 *
 * Body `{ "dryRun": true }` runs the same selection + decision path as live with
 * `dryRun` set so sends and writes are suppressed. Do not resume this cron until
 * dry-run review is clean.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { authorizedCronBearer } from "../_shared/admin_edge_auth.ts"
import { processSlaExpiredAutoReassign } from "../_shared/sla_expired_auto_reassign.ts"
import { runMaintenanceRequestViaEngine } from "../_shared/engine/maintenanceRequestEngine.ts"
import {
  reportMissingRequiredCronJobs,
  reportPausedRequiredCronJobs,
} from "../_shared/missingRequiredCrons.ts"
import { warnSharedListOverlapAtStartup } from "../_shared/smsRecipients.ts"
import { PENDING_ACCEPT_STALE_MS } from "../../../shared/ops/vendorReassignGuards.ts"

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

async function landlordIsDemo(
  supabase: ReturnType<typeof createClient>,
  landlordId: string | null,
): Promise<boolean> {
  const id = landlordId?.trim()
  if (!id) return false
  const { data } = await supabase
    .from("landlords")
    .select("is_demo")
    .eq("id", id)
    .maybeSingle()
  return data?.is_demo === true
}

export type PendingAcceptStaleResult = {
  ticketId: string
  outcome: string
  reason?: string
  ok?: boolean
  error?: string
}

/**
 * Same pending_accept_stale decision path as the live pass.
 * When `dryRun` is true, the engine suppresses SMS and ticket writes.
 */
export async function processPendingAcceptStaleForTicket(
  supabase: ReturnType<typeof createClient>,
  ticketId: string,
  opts?: { dryRun?: boolean },
): Promise<PendingAcceptStaleResult> {
  const dryRun = opts?.dryRun === true
  const { data: ticketRow, error } = await supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, assigned_vendor_id, issue_category, vendor_work_status, assigned_at",
    )
    .eq("id", ticketId)
    .maybeSingle()

  if (error) {
    throw new Error(
      `dry_run_ticket_select_failed:${ticketId}:${error.message}`,
    )
  }
  if (!ticketRow) {
    return { ticketId, outcome: "skipped", reason: "not_found", error: "not_found" }
  }

  const landlordId = ticketRow.landlord_id == null
    ? null
    : String(ticketRow.landlord_id).trim()
  if (!landlordId) {
    return {
      ticketId,
      outcome: "skipped",
      reason: "missing_landlord",
      error: "Missing landlord",
    }
  }
  if (await landlordIsDemo(supabase, landlordId)) {
    return {
      ticketId,
      outcome: "skipped",
      reason: "demo_landlord",
      error: "Skipped — demo landlord excluded",
    }
  }

  const workStatus = String(ticketRow.vendor_work_status ?? "")
    .trim()
    .toLowerCase()
  if (workStatus === "accepted" || workStatus === "in_progress") {
    return {
      ticketId,
      outcome: "skipped",
      reason: "vendor_active_on_job",
      error: "Skipped — vendor already accepted or in progress",
    }
  }
  if (workStatus === "completed" || workStatus === "cancelled") {
    return {
      ticketId,
      outcome: "skipped",
      reason: `terminal_${workStatus}`,
      error: `Skipped — terminal ${workStatus}`,
    }
  }

  const engineResult = await runMaintenanceRequestViaEngine(supabase, {
    landlordId,
    trigger: "automation",
    maintenanceRequest: {
      action: "auto_reassign",
      autoReassign: {
        ticketId,
        trigger: "pending_accept_stale",
        landlordId,
        assignedVendorId: ticketRow.assigned_vendor_id == null
          ? null
          : String(ticketRow.assigned_vendor_id),
        issueCategory: ticketRow.issue_category == null
          ? null
          : String(ticketRow.issue_category),
        previousVendorId: ticketRow.assigned_vendor_id == null
          ? null
          : String(ticketRow.assigned_vendor_id),
        findStrategy: "recommend_ranked",
        dryRun,
      },
    },
  })

  const meta = engineResult?.metadata ?? {}
  const outcome = String(meta.outcome ?? "skipped")
  const reason =
    typeof meta.reason === "string" ? meta.reason : undefined

  if (outcome === "reassigned") {
    return { ticketId, outcome, ok: true }
  }
  if (outcome === "needs_admin_vendor") {
    return {
      ticketId,
      outcome,
      reason,
      error: dryRun
        ? undefined
        : "No alternative vendors — escalated for admin",
    }
  }
  return {
    ticketId,
    outcome: outcome === "skipped" ? "skipped" : outcome,
    reason: reason ?? String(meta.reason ?? "Auto-reassign skipped"),
    error: dryRun
      ? undefined
      : String(meta.reason ?? "Auto-reassign skipped"),
  }
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
      "VENDOR_DELAY_CRON_SECRET",
      "ADMIN_REASSIGN_SECRET",
      "RUN_WORKFLOW_TRIGGERS_SECRET",
    ])
  ) {
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

  const supabase = createClient(supabaseUrl, serviceKey)

  let dryRun = false
  try {
    const body = await req.json().catch(() => ({}))
    dryRun = body?.dryRun === true || body?.dry_run === true
  } catch {
    dryRun = false
  }

  const missingCrons = await reportMissingRequiredCronJobs(supabase)
  const pausedCrons = await reportPausedRequiredCronJobs(supabase)
  await warnSharedListOverlapAtStartup(supabase)

  // Shared selection + decision for dry-run and live (dryRun only suppresses writes/SMS).
  const slaResults = await processSlaExpiredAutoReassign(supabase, {
    dryRun,
    limit: dryRun ? 200 : 50,
  })

  const slaHandledIds = new Set(
    slaResults
      .filter((row) =>
        row.outcome === "needs_admin_vendor" ||
        row.outcome === "awaiting_landlord_choice" ||
        row.outcome === "awaiting_vendor_availability_probe" ||
        row.outcome === "reassigned" ||
        (row.outcome === "skipped" &&
          (row.reason === "landlord_choice_cooldown" ||
            row.reason === "recent_choice_after_trigger" ||
            row.reason === "recently_escalated_needs_admin" ||
            row.reason === "needs_admin_vendor_sticky" ||
            row.reason === "recent_stall_follow_up" ||
            row.reason === "awaiting_choice_dwell_exceeded" ||
            row.reason === "awaiting_probe_dwell_exceeded" ||
            row.reason === "identical_outcome_loop"))
      )
      .map((row) => row.ticketId)
      .filter(Boolean),
  )

  const cutoff = new Date(Date.now() - PENDING_ACCEPT_STALE_MS).toISOString()
  const { data: stale, error: qErr } = await supabase
    .from("maintenance_requests")
    .select("id")
    .eq("vendor_work_status", "pending_accept")
    .not("assigned_vendor_id", "is", null)
    .not("assigned_at", "is", null)
    .lt("assigned_at", cutoff)
    .limit(dryRun ? 200 : 50)

  if (qErr) {
    console.error("[vendor-delayed-auto-reassign] query", qErr)
    return jsonResponse(
      {
        ok: false,
        dryRun,
        error: "Query failed",
        detail: qErr.message,
        failedSelect: "pending_accept_stale_ids",
      },
      500,
    )
  }

  const delayedResults: PendingAcceptStaleResult[] = []

  try {
    for (const row of stale ?? []) {
      const ticketId = String(row.id ?? "")
      if (!ticketId) continue
      if (slaHandledIds.has(ticketId)) {
        delayedResults.push({
          ticketId,
          outcome: "skipped",
          reason: "already_handled_sla_expired",
          error: "Skipped — already handled in sla_expired pass",
        })
        continue
      }
      delayedResults.push(
        await processPendingAcceptStaleForTicket(supabase, ticketId, { dryRun }),
      )
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[vendor-delayed-auto-reassign] pending_accept plan", message)
    return jsonResponse(
      {
        ok: false,
        dryRun,
        error: "Query failed",
        detail: message,
      },
      500,
    )
  }

  if (dryRun) {
    return jsonResponse({
      ok: true,
      dryRun: true,
      missingRequiredCrons: missingCrons.map((j) => j.jobname),
      pausedRequiredCrons: pausedCrons,
      ticketCount: slaResults.length + delayedResults.length,
      slaExpired: slaResults,
      delayedPendingAccept: {
        cutoff,
        processed: delayedResults.length,
        results: delayedResults,
      },
      plans: [
        ...slaResults.map((r) => ({
          ticketId: r.ticketId,
          pass: "sla_expired" as const,
          plannedOutcome: r.outcome === "skipped"
            ? `skipped:${r.reason ?? "unknown"}`
            : r.outcome,
        })),
        ...delayedResults.map((r) => ({
          ticketId: r.ticketId,
          pass: "pending_accept_stale" as const,
          plannedOutcome: r.outcome === "skipped"
            ? `skipped:${r.reason ?? "unknown"}`
            : r.outcome,
        })),
      ],
    })
  }

  return jsonResponse({
    ok: true,
    dryRun: false,
    missingRequiredCrons: missingCrons.map((j) => j.jobname),
    pausedRequiredCrons: pausedCrons,
    slaExpired: slaResults,
    delayedPendingAccept: {
      cutoff,
      processed: delayedResults.length,
      results: delayedResults,
    },
  })
})
