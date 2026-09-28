/**
 * Scheduled job:
 * 1. Tickets past due_at → auto-reassign to next roster vendor (or escalate if none).
 * 2. pending_accept 48h+ with no response → reassign via alternatives (legacy path).
 *
 * Body `{ "dryRun": true }` reports every ticket / contact / state change without
 * mutating or sending SMS. Do not resume this cron until dry-run review is clean.
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
import {
  decideAutoReassignGuard,
  isStickyNeedsAdminVendor,
  PENDING_ACCEPT_STALE_MS,
  type VendorReassignGuardTrigger,
} from "../../../shared/ops/vendorReassignGuards.ts"
import { ticketIsAwaitingLandlordVendorChoice } from "../_shared/vendorLandlordChoice.ts"
import { ticketIsAwaitingVendorAvailabilityProbe } from "../_shared/vendorAvailabilityProbe.ts"
import { resolveReplacementVendorChoiceForTicket } from "../_shared/vendor_reassignment.ts"

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

type DryRunContact = {
  vendorId: string | null
  name: string | null
  phone: string | null
  email: string | null
  role: string
}

type DryRunTicketPlan = {
  ticketId: string
  landlordId: string | null
  vendorWorkStatus: string | null
  assignedVendorId: string | null
  assignedAt: string | null
  dueAt: string | null
  vendorNotifyError: string | null
  awaitingLandlordChoiceAt: string | null
  awaitingVendorAvailabilityAt: string | null
  building: string | null
  unit: string | null
  pass: "sla_expired" | "pending_accept_stale"
  guardAction: string
  guardReason: string | null
  plannedOutcome: string
  plannedStateChanges: string[]
  wouldContact: DryRunContact[]
}

async function loadVendorContact(
  supabase: ReturnType<typeof createClient>,
  vendorId: string | null,
): Promise<DryRunContact | null> {
  if (!vendorId) return null
  const { data } = await supabase
    .from("vendors")
    .select("id, name, phone, email")
    .eq("id", vendorId)
    .maybeSingle()
  if (!data) {
    return {
      vendorId,
      name: null,
      phone: null,
      email: null,
      role: "unknown",
    }
  }
  return {
    vendorId: String(data.id),
    name: typeof data.name === "string" ? data.name : null,
    phone: typeof data.phone === "string" ? data.phone : null,
    email: typeof data.email === "string" ? data.email : null,
    role: "vendor",
  }
}

const TERMINAL_VENDOR_WORK_STATUSES = new Set([
  "completed",
  "cancelled",
])

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

async function dryRunPlanForTicket(
  supabase: ReturnType<typeof createClient>,
  ticketId: string,
  pass: "sla_expired" | "pending_accept_stale",
): Promise<DryRunTicketPlan | null> {
  const { data: raw, error } = await supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, assigned_vendor_id, assigned_at, due_at, issue_category, vendor_work_status, vendor_notify_error, awaiting_landlord_choice_at, awaiting_vendor_availability_at, vendor_notified_at, landlord_vendor_choice_resolved_at, auto_reassign_last_outcome, auto_reassign_same_outcome_count, auto_reassign_same_outcome_since, unit",
    )
    .eq("id", ticketId)
    .maybeSingle()
  if (error) {
    throw new Error(
      `dry_run_ticket_select_failed:${ticketId}:${error.message}`,
    )
  }
  if (!raw) return null

  const landlordId =
    raw.landlord_id == null ? null : String(raw.landlord_id).trim()
  const vendorWorkStatus =
    typeof raw.vendor_work_status === "string"
      ? raw.vendor_work_status.toLowerCase()
      : null

  const planBase = async (
    outcome: string,
    changes: string[] = [],
  ): Promise<DryRunTicketPlan> => ({
    ticketId,
    landlordId,
    vendorWorkStatus,
    assignedVendorId:
      raw.assigned_vendor_id == null ? null : String(raw.assigned_vendor_id),
    assignedAt: typeof raw.assigned_at === "string" ? raw.assigned_at : null,
    dueAt: typeof raw.due_at === "string" ? raw.due_at : null,
    vendorNotifyError:
      typeof raw.vendor_notify_error === "string"
        ? raw.vendor_notify_error
        : null,
    awaitingLandlordChoiceAt:
      typeof raw.awaiting_landlord_choice_at === "string"
        ? raw.awaiting_landlord_choice_at
        : null,
    awaitingVendorAvailabilityAt:
      typeof raw.awaiting_vendor_availability_at === "string"
        ? raw.awaiting_vendor_availability_at
        : null,
    building: null,
    unit: typeof raw.unit === "string" ? raw.unit : null,
    pass,
    guardAction: "skip",
    guardReason: outcome.replace(/^skipped:/, ""),
    plannedOutcome: outcome.startsWith("skipped:") ? outcome : `skipped:${outcome}`,
    plannedStateChanges: changes,
    wouldContact: [],
  })

  if (
    vendorWorkStatus &&
    TERMINAL_VENDOR_WORK_STATUSES.has(vendorWorkStatus)
  ) {
    return planBase(`skipped:terminal_${vendorWorkStatus}`, [
      "no state change — terminal ticket",
    ])
  }

  // Vendor already accepted or on site — never rematch / landlord-choice / dwell
  // from this job. Evaluate before awaiting_* flags so stale choice stamps cannot
  // escalate an active job.
  if (vendorWorkStatus === "accepted" || vendorWorkStatus === "in_progress") {
    return planBase("skipped:vendor_active_on_job", [
      "no state change — vendor already accepted or in progress",
    ])
  }

  if (await landlordIsDemo(supabase, landlordId)) {
    return planBase("skipped:demo_landlord", [
      "Demo landlord excluded from vendor-delayed auto-reassign",
    ])
  }

  const assignedVendorId =
    raw.assigned_vendor_id == null ? null : String(raw.assigned_vendor_id)
  const vendorNotifyError =
    typeof raw.vendor_notify_error === "string" ? raw.vendor_notify_error : null
  const trigger: VendorReassignGuardTrigger =
    pass === "sla_expired" ? "sla_expired" : "pending_accept_stale"

  const guard = decideAutoReassignGuard({
    trigger,
    nowMs: Date.now(),
    dueAt: typeof raw.due_at === "string" ? raw.due_at : null,
    assignedAt: typeof raw.assigned_at === "string" ? raw.assigned_at : null,
    awaitingLandlordChoice: ticketIsAwaitingLandlordVendorChoice(vendorNotifyError),
    awaitingLandlordChoiceAt:
      typeof raw.awaiting_landlord_choice_at === "string"
        ? raw.awaiting_landlord_choice_at
        : null,
    awaitingVendorAvailabilityProbe:
      ticketIsAwaitingVendorAvailabilityProbe(vendorNotifyError),
    awaitingVendorAvailabilityAt:
      typeof raw.awaiting_vendor_availability_at === "string"
        ? raw.awaiting_vendor_availability_at
        : null,
    landlordVendorChoiceResolvedAt:
      typeof raw.landlord_vendor_choice_resolved_at === "string"
        ? raw.landlord_vendor_choice_resolved_at
        : null,
    vendorNotifiedAt:
      typeof raw.vendor_notified_at === "string" ? raw.vendor_notified_at : null,
    assignedVendorId,
    lastOutcomeSignature:
      typeof raw.auto_reassign_last_outcome === "string"
        ? raw.auto_reassign_last_outcome
        : null,
    sameOutcomeCount:
      typeof raw.auto_reassign_same_outcome_count === "number"
        ? raw.auto_reassign_same_outcome_count
        : 0,
    sameOutcomeSince:
      typeof raw.auto_reassign_same_outcome_since === "string"
        ? raw.auto_reassign_same_outcome_since
        : null,
  })

  const plan: DryRunTicketPlan = {
    ticketId,
    landlordId,
    vendorWorkStatus,
    assignedVendorId,
    assignedAt: typeof raw.assigned_at === "string" ? raw.assigned_at : null,
    dueAt: typeof raw.due_at === "string" ? raw.due_at : null,
    vendorNotifyError,
    awaitingLandlordChoiceAt:
      typeof raw.awaiting_landlord_choice_at === "string"
        ? raw.awaiting_landlord_choice_at
        : null,
    awaitingVendorAvailabilityAt:
      typeof raw.awaiting_vendor_availability_at === "string"
        ? raw.awaiting_vendor_availability_at
        : null,
    building: null,
    unit: typeof raw.unit === "string" ? raw.unit : null,
    pass,
    guardAction: guard.action,
    guardReason: "reason" in guard ? String(guard.reason) : null,
    plannedOutcome: guard.action,
    plannedStateChanges: [],
    wouldContact: [],
  }

  if (guard.action === "short_circuit_awaiting") {
    plan.plannedOutcome = guard.reason
    plan.plannedStateChanges.push(
      `persist auto_reassign repeat counters for ${guard.reason}`,
    )
    return plan
  }
  if (guard.action === "skip" || guard.action === "escalate_loop") {
    plan.plannedOutcome = guard.action === "skip"
      ? `skipped:${guard.reason}`
      : "escalate_identical_outcome_loop"
    if (guard.action === "escalate_loop") {
      plan.plannedStateChanges.push(
        "escalate workflow to needs_admin_vendor (identical outcome loop)",
      )
    }
    return plan
  }
  if (guard.action === "escalate_awaiting_stale") {
    plan.plannedOutcome = guard.reason
    plan.plannedStateChanges.push(
      `clear awaiting flag + escalate needs_admin_vendor (${guard.reason})`,
    )
    return plan
  }

  if (!landlordId) {
    plan.plannedOutcome = "skipped:missing_landlord"
    return plan
  }

  const decision = await resolveReplacementVendorChoiceForTicket(supabase, {
    ticketId,
    assignedVendorId,
    issueCategory:
      typeof raw.issue_category === "string" ? raw.issue_category : null,
    landlordId,
  })

  if (decision.kind === "landlord_choice" && decision.options.length > 0) {
    plan.plannedOutcome = "awaiting_landlord_choice"
    plan.plannedStateChanges.push(
      "set vendor_notify_error=Awaiting landlord vendor choice",
      "set awaiting_landlord_choice_at=now",
      "SMS landlord numbered choice (YES / 1 / 2 / 3)",
    )
    decision.options.forEach((opt, i) => {
      plan.wouldContact.push({
        vendorId: opt.vendor.id,
        name: opt.vendor.name ?? null,
        phone: opt.vendor.phone ?? null,
        email: opt.vendor.email ?? null,
        role: `choice_option_${i + 1}`,
      })
    })
    const { data: landlord } = await supabase
      .from("landlords")
      .select("id, phone, email, name")
      .eq("id", landlordId)
      .maybeSingle()
    plan.wouldContact.push({
      vendorId: null,
      name: typeof landlord?.name === "string" ? landlord.name : "landlord",
      phone: typeof landlord?.phone === "string" ? landlord.phone : null,
      email: typeof landlord?.email === "string" ? landlord.email : null,
      role: "landlord_choice_sms",
    })
    return plan
  }

  plan.plannedOutcome = "needs_admin_vendor"
  plan.plannedStateChanges.push(
    "escalate maintenance.sla_expired_needs_vendor / needs_admin_vendor",
    "SMS landlord Needs Attention (assign vendor)",
  )
  return plan
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

  if (dryRun) {
    const nowIso = new Date().toISOString()
    const cutoff = new Date(Date.now() - PENDING_ACCEPT_STALE_MS).toISOString()

    const { data: slaRows, error: slaErr } = await supabase
      .from("maintenance_requests")
      .select("id")
      .not("due_at", "is", null)
      .lt("due_at", nowIso)
      .limit(200)

    if (slaErr) {
      console.error("[vendor-delayed-auto-reassign] dry-run sla select", slaErr)
      try {
        await reportMissingRequiredCronJobs(supabase) // keep monitor warm
      } catch {
        /* ignore */
      }
      return jsonResponse(
        {
          ok: false,
          dryRun: true,
          error: "Query failed",
          detail: slaErr.message,
          failedSelect: "sla_expired_ids",
        },
        500,
      )
    }

    const { data: staleRows, error: staleErr } = await supabase
      .from("maintenance_requests")
      .select("id")
      .eq("vendor_work_status", "pending_accept")
      .not("assigned_vendor_id", "is", null)
      .not("assigned_at", "is", null)
      .lt("assigned_at", cutoff)
      .limit(200)

    if (staleErr) {
      console.error(
        "[vendor-delayed-auto-reassign] dry-run stale select",
        staleErr,
      )
      return jsonResponse(
        {
          ok: false,
          dryRun: true,
          error: "Query failed",
          detail: staleErr.message,
          failedSelect: "pending_accept_stale_ids",
        },
        500,
      )
    }

    try {
      const plans: DryRunTicketPlan[] = []
      const seen = new Set<string>()
      for (const row of slaRows ?? []) {
        const id = String(row.id ?? "")
        if (!id || seen.has(id)) continue
        seen.add(id)
        const plan = await dryRunPlanForTicket(supabase, id, "sla_expired")
        if (plan) plans.push(plan)
      }
      for (const row of staleRows ?? []) {
        const id = String(row.id ?? "")
        if (!id) continue
        if (seen.has(id)) {
          const existing = plans.find((p) => p.ticketId === id)
          if (existing) {
            existing.plannedStateChanges.push(
              "also eligible for pending_accept_stale (would be skipped after sla pass)",
            )
          }
          continue
        }
        seen.add(id)
        const plan = await dryRunPlanForTicket(
          supabase,
          id,
          "pending_accept_stale",
        )
        if (plan) plans.push(plan)
      }

      return jsonResponse({
        ok: true,
        dryRun: true,
        missingRequiredCrons: missingCrons.map((j) => j.jobname),
        pausedRequiredCrons: pausedCrons,
        ticketCount: plans.length,
        plans,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error("[vendor-delayed-auto-reassign] dry-run plan", message)
      return jsonResponse(
        {
          ok: false,
          dryRun: true,
          error: "Query failed",
          detail: message,
        },
        500,
      )
    }
  }

  const slaResults = await processSlaExpiredAutoReassign(supabase)

  const slaHandledIds = new Set(
    slaResults
      .filter((row) =>
        row.outcome === "needs_admin_vendor" ||
        row.outcome === "awaiting_landlord_choice" ||
        row.outcome === "awaiting_vendor_availability_probe" ||
        row.outcome === "reassigned" ||
        (        row.outcome === "skipped" &&
          (row.reason === "landlord_choice_cooldown" ||
            row.reason === "recent_choice_after_trigger" ||
            row.reason === "recently_escalated_needs_admin" ||
            row.reason === "needs_admin_vendor_sticky" ||
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
    .limit(50)

  if (qErr) {
    console.error("[vendor-delayed-auto-reassign] query", qErr)
    return jsonResponse({ error: "Query failed" }, 500)
  }

  const delayedResults: { ticketId: string; ok?: boolean; error?: string }[] = []

  for (const row of stale ?? []) {
    const ticketId = String(row.id ?? "")
    if (!ticketId) continue
    if (slaHandledIds.has(ticketId)) {
      delayedResults.push({
        ticketId,
        error: "Skipped — already handled in sla_expired pass",
      })
      continue
    }

    const { data: ticketRow } = await supabase
      .from("maintenance_requests")
      .select("landlord_id, assigned_vendor_id, issue_category")
      .eq("id", ticketId)
      .maybeSingle()

    const landlordId = ticketRow?.landlord_id == null
      ? null
      : String(ticketRow.landlord_id).trim()

    if (!landlordId) {
      delayedResults.push({ ticketId, error: "Missing landlord" })
      continue
    }

    if (await landlordIsDemo(supabase, landlordId)) {
      delayedResults.push({
        ticketId,
        error: "Skipped — demo landlord excluded",
      })
      continue
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
          assignedVendorId: ticketRow?.assigned_vendor_id == null
            ? null
            : String(ticketRow.assigned_vendor_id),
          issueCategory: ticketRow?.issue_category == null
            ? null
            : String(ticketRow.issue_category),
          previousVendorId: ticketRow?.assigned_vendor_id == null
            ? null
            : String(ticketRow.assigned_vendor_id),
          findStrategy: "recommend_ranked",
        },
      },
    })

    const meta = engineResult?.metadata ?? {}
    const outcome = meta.outcome as string | undefined

    if (outcome === "reassigned") {
      delayedResults.push({ ticketId, ok: true })
    } else if (outcome === "needs_admin_vendor") {
      delayedResults.push({
        ticketId,
        error: "No alternative vendors — escalated for admin",
      })
    } else {
      delayedResults.push({
        ticketId,
        error: String(meta.reason ?? "Auto-reassign skipped"),
      })
    }
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
