/**
 * Shared vendor reassignment — find replacement, execute notify + audit, escalate when none.
 * Triggers (decline, SLA, stale pending_accept, no-show) stay separate; logic lives here.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { runMaintenanceRequestViaEngine } from "./engine/maintenanceRequestEngine.ts"
import {
  escalateMaintenanceNeedsVendor,
  resumeMaintenanceWorkflowAfterAutoReassign,
  type MaintenanceTicketScope,
} from "./maintenance_admin_escalation.ts"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import {
  loadAlternativeVendorCandidates,
  recommendAlternativeVendorsForTicket,
  type AlternativeVendor,
} from "./recommend_vendor_alternatives.ts"
import {
  loadDeclinedVendorIdsForTicket,
  loadMostRecentlyAssignedVendorId,
  pickVendorForAssignment,
} from "./vendor_assignment.ts"
import { reassignVendorByIdAndNotify } from "../submit-maintenance-request/vendor_notify.ts"

export type ReplacementVendor = AlternativeVendor

export type FindReplacementStrategy =
  /** Ranked alternatives (OpenAI when configured), then roster pick. */
  | "alternatives_then_pick"
  /** Roster pick only — excludes declined + caller exclusions. */
  | "pick_only"
  /** Full recommendAlternativeVendorsForTicket (validates ticket eligibility). */
  | "recommend_ranked"

export type FindReplacementVendorInput = {
  ticketId: string
  assignedVendorId?: string | null
  issueCategory?: string | null
  landlordId?: string | null
  excludeVendorIds?: string[]
  strategy?: FindReplacementStrategy
  /** pick_only — deprioritize the globally most recently assigned vendor. */
  preferNotRecentlyAssigned?: boolean
  /** pick_only — deprioritize a specific vendor id (e.g. no-show vendor). */
  preferNotVendorId?: string | null
}

export type FindReplacementVendorResult =
  | { ok: true; vendor: ReplacementVendor | null }
  | { ok: false; error: string }

export async function findReplacementVendorForTicket(
  supabase: SupabaseClient,
  input: FindReplacementVendorInput,
): Promise<FindReplacementVendorResult> {
  const ticketId = input.ticketId.trim()
  const strategy = input.strategy ?? "alternatives_then_pick"
  const assignedId = input.assignedVendorId ?? null
  const issueCategory = input.issueCategory ?? null
  const landlordId = input.landlordId ?? null

  const extraExclude = new Set(input.excludeVendorIds ?? [])
  if (assignedId) extraExclude.add(assignedId)

  if (strategy === "recommend_ranked") {
    const rec = await recommendAlternativeVendorsForTicket(supabase, ticketId, {
      limit: 3,
    })
    if ("error" in rec) return { ok: false, error: rec.error }
    const pick =
      rec.alternatives.find((a) => !extraExclude.has(a.id)) ??
      rec.alternatives[0] ??
      null
    return { ok: true, vendor: pick }
  }

  if (strategy === "alternatives_then_pick") {
    const fromAlternatives = await loadAlternativeVendorCandidates(supabase, {
      assigned_vendor_id: assignedId,
      issue_category: issueCategory,
      landlord_id: landlordId,
    })
    const alt = fromAlternatives.find((a) => !extraExclude.has(a.id))
    if (alt) return { ok: true, vendor: alt }
  }

  const declined = await loadDeclinedVendorIdsForTicket(supabase, ticketId)
  const exclude = new Set([...declined, ...extraExclude])

  let preferNot: string | null = input.preferNotVendorId?.trim() || null
  if (!preferNot && input.preferNotRecentlyAssigned) {
    const recent = await loadMostRecentlyAssignedVendorId(supabase)
    if (recent && !exclude.has(recent)) preferNot = recent
  } else if (preferNot && exclude.has(preferNot)) {
    preferNot = null
  }

  const picked = await pickVendorForAssignment(supabase, {
    issueCategory,
    excludeVendorIds: [...exclude],
    preferNotVendorId: preferNot,
    landlordId,
  })
  if (!picked) return { ok: true, vendor: null }
  return { ok: true, vendor: { id: picked.id, name: picked.name } }
}

export type VendorReassignTrigger =
  | "vendor_declined"
  | "sla_expired"
  | "pending_accept_stale"
  | "noshow_rematch"

type TriggerConfig = {
  notifyResident: boolean
  resumeWorkflow: boolean
  logActivity: boolean
  eventType: string
  activityMessage: (vendorName: string) => string
  workflowMessage: (vendorName: string) => string
  logLabel: string
}

const TRIGGER_CONFIG: Record<VendorReassignTrigger, TriggerConfig> = {
  vendor_declined: {
    notifyResident: false,
    resumeWorkflow: true,
    logActivity: true,
    eventType: "maintenance.vendor_declined_auto_reassigned",
    activityMessage: (name) => `Vendor declined — auto-reassigned to ${name}.`,
    workflowMessage: (name) => `Auto-reassigned to ${name} after vendor decline`,
    logLabel: "vendor-reassignment",
  },
  sla_expired: {
    notifyResident: false,
    resumeWorkflow: true,
    logActivity: true,
    eventType: "maintenance.sla_auto_reassigned",
    activityMessage: (name) => `Response time expired — auto-reassigned to ${name}.`,
    workflowMessage: (name) => `Auto-reassigned to ${name} after response time expired`,
    logLabel: "vendor-reassignment",
  },
  pending_accept_stale: {
    notifyResident: true,
    resumeWorkflow: false,
    logActivity: false,
    eventType: "maintenance.pending_accept_auto_reassigned",
    activityMessage: (name) => `No vendor response — auto-reassigned to ${name}.`,
    workflowMessage: (name) => `Auto-reassigned to ${name} after no response`,
    logLabel: "vendor-delayed-auto-reassign",
  },
  noshow_rematch: {
    notifyResident: true,
    resumeWorkflow: false,
    logActivity: true,
    eventType: "vendor.noshow_rematched",
    activityMessage: (name) => `No-show rematch: reassigned to ${name}.`,
    workflowMessage: (name) => `No-show rematch to ${name}`,
    logLabel: "vendor-noshow-rematch",
  },
}

export type ExecuteAutoVendorReassignmentInput = {
  ticketId: string
  newVendor: ReplacementVendor
  trigger: VendorReassignTrigger
  previousVendorId?: string | null
  landlordId?: string | null
  notifyResident?: boolean
  activityMetadataExtra?: Record<string, unknown>
  /** When true, caller advances the maintenance_request run via the engine. */
  skipWorkflowAdvance?: boolean
}

export type ExecuteAutoVendorReassignmentResult =
  | { outcome: "reassigned"; newVendorId: string }
  | { outcome: "failed"; reason: string }

export async function executeAutoVendorReassignment(
  supabase: SupabaseClient,
  input: ExecuteAutoVendorReassignmentInput,
): Promise<ExecuteAutoVendorReassignmentResult> {
  const cfg = TRIGGER_CONFIG[input.trigger]
  const notifyResident = input.notifyResident ?? cfg.notifyResident
  const { ticketId, newVendor, trigger } = input
  const previousVendorId = input.previousVendorId ?? null

  const r = await reassignVendorByIdAndNotify(supabase, ticketId, newVendor.id, {
    eventSource: "auto_reassign",
    notifyResident,
  })

  if ("error" in r) {
    console.error(`[${cfg.logLabel}] reassign failed`, ticketId, r.error)
    return { outcome: "failed", reason: r.error }
  }

  if (cfg.resumeWorkflow && !input.skipWorkflowAdvance) {
    try {
      await resumeMaintenanceWorkflowAfterAutoReassign(
        supabase,
        ticketId,
        cfg.workflowMessage(newVendor.name),
      )
    } catch (e) {
      console.error(`[${cfg.logLabel}] resume workflow`, e)
    }
  }

  const landlordId = input.landlordId?.trim() || null
  if (cfg.logActivity && landlordId) {
    try {
      const metadata: Record<string, unknown> = {
        message: cfg.activityMessage(newVendor.name),
        previous_vendor_id: previousVendorId,
        trigger,
        ...input.activityMetadataExtra,
      }
      if (input.trigger === "noshow_rematch") {
        metadata.rematch_vendor_id = newVendor.id
      }
      await recordActivityLog(supabase, {
        landlordId,
        eventType: cfg.eventType,
        source: "automation",
        actorType: "system",
        maintenanceRequestId: ticketId,
        vendorId: newVendor.id,
        metadata,
      })
    } catch (e) {
      console.error(`[${cfg.logLabel}] activity log`, e)
    }
  }

  console.log(
    JSON.stringify({
      event: "vendor_auto_reassigned",
      trigger,
      ticketId,
      previousVendorId,
      newVendorId: newVendor.id,
      at: new Date().toISOString(),
    }),
  )

  return { outcome: "reassigned", newVendorId: newVendor.id }
}

export type NoVendorEscalationTrigger =
  | "vendor_declined"
  | "sla_expired"
  | "pending_accept_stale"

const NO_VENDOR_ESCALATION: Record<
  NoVendorEscalationTrigger,
  {
    escalationReason: "vendor_declined_no_vendor" | "sla_expired_no_vendor"
    eventMessage: string
    graphEventType: string
    graphMessage: string
  }
> = {
  vendor_declined: {
    escalationReason: "vendor_declined_no_vendor",
    eventMessage:
      "Vendor declined — no roster vendor available for reassignment",
    graphEventType: "maintenance.vendor_declined_needs_vendor",
    graphMessage:
      "Vendor declined with no vendor in roster — admin must assign or onboard a vendor.",
  },
  sla_expired: {
    escalationReason: "sla_expired_no_vendor",
    eventMessage: "Response time expired — no roster vendor available for reassignment",
    graphEventType: "maintenance.sla_expired_needs_vendor",
    graphMessage:
      "Response time expired with no vendor in roster — admin must assign or onboard a vendor.",
  },
  pending_accept_stale: {
    escalationReason: "sla_expired_no_vendor",
    eventMessage: "Response time expired — no roster vendor available for reassignment",
    graphEventType: "maintenance.sla_expired_needs_vendor",
    graphMessage:
      "Response time expired with no vendor in roster — admin must assign or onboard a vendor.",
  },
}

export async function escalateWhenNoReplacementVendor(
  supabase: SupabaseClient,
  ticket: MaintenanceTicketScope,
  trigger: NoVendorEscalationTrigger,
): Promise<void> {
  await escalateMaintenanceNeedsVendor(supabase, ticket, NO_VENDOR_ESCALATION[trigger])
}

export type NoShowRematchInput = {
  ticketId: string
  landlordId: string
  noShowVendorId: string
  noShowVendorName: string
  issueCategory: string | null
}

export type NoShowRematchResult =
  | { outcome: "reassigned"; newVendorId: string; newVendorName: string }
  | { outcome: "no_vendor" }
  | { outcome: "failed"; reason: string }

/** No-show T+125 rematch — clears schedule, reassigns, logs activity. */
export async function tryNoShowVendorRematch(
  supabase: SupabaseClient,
  input: NoShowRematchInput,
): Promise<NoShowRematchResult> {
  const engineResult = await runMaintenanceRequestViaEngine(supabase, {
    landlordId: input.landlordId,
    trigger: "automation",
    maintenanceRequest: {
      action: "auto_reassign",
      autoReassign: {
        ticketId: input.ticketId,
        trigger: "noshow_rematch",
        landlordId: input.landlordId,
        assignedVendorId: input.noShowVendorId,
        issueCategory: input.issueCategory,
        previousVendorId: input.noShowVendorId,
        excludeVendorIds: [input.noShowVendorId],
        preferNotVendorId: input.noShowVendorId,
        findStrategy: "pick_only",
        clearSchedule: true,
      },
    },
  })

  const meta = engineResult?.metadata ?? {}
  const outcome = meta.outcome as string | undefined

  if (outcome === "reassigned" && typeof meta.new_vendor_id === "string") {
    const { data: vendor } = await supabase
      .from("vendors")
      .select("name")
      .eq("id", meta.new_vendor_id)
      .maybeSingle()
    const newVendorName = typeof vendor?.name === "string"
      ? vendor.name
      : "Vendor"
    return {
      outcome: "reassigned",
      newVendorId: meta.new_vendor_id,
      newVendorName,
    }
  }
  if (outcome === "needs_admin_vendor") {
    return { outcome: "no_vendor" }
  }
  if (outcome === "failed") {
    return { outcome: "failed", reason: String(meta.reason ?? "reassign_failed") }
  }

  return { outcome: "failed", reason: String(meta.reason ?? "engine_skipped") }
}
