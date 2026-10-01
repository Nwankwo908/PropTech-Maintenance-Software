/**
 * Close conversation-level pending asks when a ticket has moved past them.
 * Ticket status and SMS intake/FSM are separate tracks — this is the bridge.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import {
  createIdleScheduleState,
  persistVendorScheduleFsm,
  readVendorScheduleFsm,
  VENDOR_SCHEDULE_KEY,
  type VendorScheduleStep,
} from "./vendor_schedule_fsm.ts"
import {
  AWAITING_LANDLORD_VENDOR_CHOICE,
  abandonStaleLandlordVendorChoiceAsk,
  ticketIsAwaitingLandlordVendorChoice,
} from "./vendorLandlordChoice.ts"
import { AWAITING_SCHEDULE_CONFIRM_KEY } from "./sms/tenantScheduleConfirm.ts"

/** Keep in sync with vendorAvailabilityProbe.AWAITING_VENDOR_AVAILABILITY_PROBE */
const AWAITING_VENDOR_AVAILABILITY_PROBE =
  "Awaiting vendor availability before landlord choice"

export const ASK_CLOSING_WORK_STATUSES = new Set([
  "in_progress",
  "completed",
  "cancelled",
  "archived",
])

const PRE_SCHEDULED = new Set<string>([
  "awaiting_availability",
  "awaiting_confirmation",
  "awaiting_tenant_confirmation",
])

export type CloseOpenAsksResult = {
  ticketId: string
  reason: string
  closed: string[]
}

function conversationTouchesTicket(
  row: {
    maintenance_request_id?: string | null
    intake_state?: Record<string, unknown> | null
  },
  ticketId: string,
): boolean {
  if (row.maintenance_request_id === ticketId) return true
  const intake = row.intake_state ?? {}
  const schedule = intake[VENDOR_SCHEDULE_KEY] as { ticketId?: string } | undefined
  if (schedule?.ticketId === ticketId) return true
  const awaitingSched = intake[AWAITING_SCHEDULE_CONFIRM_KEY] as
    | { ticket_id?: string }
    | undefined
  if (awaitingSched?.ticket_id === ticketId) return true
  const choice = intake.awaiting_vendor_choice as { ticket_id?: string } | undefined
  if (choice?.ticket_id === ticketId) return true
  const estimate = intake.awaiting_estimate_decision as
    | { ticket_id?: string }
    | undefined
  if (estimate?.ticket_id === ticketId) return true
  return false
}

function notifyHasAvailabilityProbe(
  vendorNotifyError: string | null | undefined,
): boolean {
  return (vendorNotifyError ?? "").includes(AWAITING_VENDOR_AVAILABILITY_PROBE)
}

function clearStaleProbeNotifyError(
  vendorNotifyError: string | null | undefined,
): string | null {
  const raw = typeof vendorNotifyError === "string" ? vendorNotifyError : ""
  if (!notifyHasAvailabilityProbe(raw)) return raw || null
  const next = raw
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !part.includes(AWAITING_VENDOR_AVAILABILITY_PROBE))
    .join("; ")
  return next || null
}

/**
 * Close open schedule / confirmation asks for a ticket that has moved on.
 * Idempotent: safe to call repeatedly.
 */
export async function closeOpenAsksForTicket(
  supabase: SupabaseClient,
  ticketId: string,
  reason: string,
): Promise<CloseOpenAsksResult> {
  const id = ticketId.trim()
  const closed: string[] = []
  if (!id) return { ticketId: id, reason, closed }

  const { data: ticket } = await supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, vendor_work_status, vendor_notify_error, assigned_vendor_id, awaiting_vendor_availability_at",
    )
    .eq("id", id)
    .maybeSingle()

  const landlordId =
    typeof ticket?.landlord_id === "string" ? ticket.landlord_id.trim() : ""
  const workStatus = String(ticket?.vendor_work_status ?? "").toLowerCase()
  const assignedVendorId =
    typeof ticket?.assigned_vendor_id === "string"
      ? ticket.assigned_vendor_id.trim()
      : ""
  const closeEstimates = workStatus === "completed" ||
    workStatus === "cancelled" ||
    workStatus === "archived"
  // Soft-probe clock is moot once a vendor is bound or work has advanced past
  // availability matching (see stale assigned+flagged HQS / WO-C2FF orphans).
  const clearAvailabilityProbe =
    Boolean(assignedVendorId) || ASK_CLOSING_WORK_STATUSES.has(workStatus)

  const { data: convos } = await supabase
    .from("sms_conversations")
    .select("id, conversation_type, maintenance_request_id, intake_state")
    .or(
      `maintenance_request_id.eq.${id}`,
    )
    .limit(80)

  // Also scan recent vendor_alert / landlord / resident threads that may only
  // reference the ticket inside intake (not maintenance_request_id).
  const { data: intakeHits } = await supabase
    .from("sms_conversations")
    .select("id, conversation_type, maintenance_request_id, intake_state")
    .in("conversation_type", [
      "vendor_alert",
      "resident_intake",
      "landlord_update",
    ])
    .order("updated_at", { ascending: false })
    .limit(200)

  const byId = new Map<string, {
    id: string
    conversation_type: string | null
    maintenance_request_id: string | null
    intake_state: Record<string, unknown> | null
  }>()
  for (const row of [...(convos ?? []), ...(intakeHits ?? [])]) {
    if (!row?.id) continue
    const intake =
      row.intake_state && typeof row.intake_state === "object"
        ? (row.intake_state as Record<string, unknown>)
        : null
    const normalized = {
      id: String(row.id),
      conversation_type:
        typeof row.conversation_type === "string" ? row.conversation_type : null,
      maintenance_request_id:
        typeof row.maintenance_request_id === "string"
          ? row.maintenance_request_id
          : null,
      intake_state: intake,
    }
    if (!conversationTouchesTicket(normalized, id)) continue
    byId.set(normalized.id, normalized)
  }

  const now = new Date().toISOString()

  for (const row of byId.values()) {
    const intake = { ...(row.intake_state ?? {}) }
    let dirty = false

    const fsm = readVendorScheduleFsm(intake)
    if (
      fsm &&
      fsm.ticketId === id &&
      PRE_SCHEDULED.has(fsm.step)
    ) {
      const cleared = createIdleScheduleState(id)
      cleared.revision = fsm.revision + 1
      cleared.enteredAt = now
      cleared.expiresAt = now
      await persistVendorScheduleFsm(supabase, {
        conversationId: row.id,
        ticketId: id,
        next: cleared,
        expectedRevision: fsm.revision,
      })
      closed.push(`vendor_schedule:${fsm.step}`)
      // Fall through — same conversation may also hold resident awaiting flags.
    }

    const awaitingSched = intake[AWAITING_SCHEDULE_CONFIRM_KEY] as
      | { ticket_id?: string }
      | undefined
    if (
      awaitingSched &&
      typeof awaitingSched === "object" &&
      awaitingSched.ticket_id === id
    ) {
      delete intake[AWAITING_SCHEDULE_CONFIRM_KEY]
      dirty = true
      closed.push("awaiting_schedule_confirmation")
    }

    const estimate = intake.awaiting_estimate_decision as
      | { ticket_id?: string }
      | undefined
    if (
      closeEstimates &&
      estimate &&
      typeof estimate === "object" &&
      estimate.ticket_id === id
    ) {
      delete intake.awaiting_estimate_decision
      dirty = true
      closed.push("awaiting_estimate_decision")
    }

    if (dirty) {
      await supabase
        .from("sms_conversations")
        .update({ intake_state: intake, updated_at: now })
        .eq("id", row.id)
    }
  }

  if (
    ticketIsAwaitingLandlordVendorChoice(
      typeof ticket?.vendor_notify_error === "string"
        ? ticket.vendor_notify_error
        : null,
    )
  ) {
    await abandonStaleLandlordVendorChoiceAsk(supabase, id)
    closed.push("awaiting_vendor_choice")
  } else if (
    typeof ticket?.vendor_notify_error === "string" &&
    ticket.vendor_notify_error.includes(AWAITING_LANDLORD_VENDOR_CHOICE)
  ) {
    closed.push("awaiting_vendor_choice")
  }

  if (clearAvailabilityProbe) {
    const hasProbeClock =
      typeof ticket?.awaiting_vendor_availability_at === "string" &&
      Boolean(ticket.awaiting_vendor_availability_at.trim())
    const notifyRaw =
      typeof ticket?.vendor_notify_error === "string"
        ? ticket.vendor_notify_error
        : null
    const hasProbeNotify = notifyHasAvailabilityProbe(notifyRaw)
    if (hasProbeClock || hasProbeNotify) {
      const patch: Record<string, unknown> = {}
      if (hasProbeClock) patch.awaiting_vendor_availability_at = null
      if (hasProbeNotify) {
        patch.vendor_notify_error = clearStaleProbeNotifyError(notifyRaw)
      }
      // Flag-only cleanup — never touch vendor_work_status / assigned_vendor_id.
      const { error: probeClearErr } = await supabase
        .from("maintenance_requests")
        .update(patch)
        .eq("id", id)
      if (probeClearErr) {
        console.error("[closeOpenAsks] clear availability probe flag", probeClearErr)
      } else {
        closed.push("awaiting_vendor_availability")
      }
    }
  }

  if (closed.length > 0 && landlordId) {
    try {
      await recordActivityLog(supabase, {
        landlordId,
        eventType: "maintenance.open_asks_closed",
        source: "automation",
        actorType: "system",
        maintenanceRequestId: id,
        metadata: {
          message: `Closed open scheduling/confirmation asks (${closed.join(", ")}) because ${reason}.`,
          reason,
          closed,
        },
      })
    } catch (e) {
      console.error("[closeOpenAsks] activity log", e)
    }
  }

  return { ticketId: id, reason, closed }
}

/** Find open schedule FSMs / resident asks on tickets that already moved on. */
export async function findZombieScheduleAsks(
  supabase: SupabaseClient,
  opts?: { limit?: number },
): Promise<
  Array<{
    ticketId: string
    kind: "vendor_schedule" | "awaiting_schedule_confirmation"
    step?: string
    conversationId: string
    vendorWorkStatus: string
  }>
> {
  const limit = opts?.limit ?? 100
  const out: Array<{
    ticketId: string
    kind: "vendor_schedule" | "awaiting_schedule_confirmation"
    step?: string
    conversationId: string
    vendorWorkStatus: string
  }> = []

  const { data: vendorRows } = await supabase
    .from("sms_conversations")
    .select("id, maintenance_request_id, intake_state")
    .eq("conversation_type", "vendor_alert")
    .order("updated_at", { ascending: false })
    .limit(300)

  for (const row of vendorRows ?? []) {
    if (out.length >= limit) break
    const fsm = readVendorScheduleFsm(
      row.intake_state as Record<string, unknown> | null,
    )
    if (!fsm || !PRE_SCHEDULED.has(fsm.step)) continue
    const ticketId = fsm.ticketId ||
      (typeof row.maintenance_request_id === "string"
        ? row.maintenance_request_id
        : "")
    if (!ticketId) continue
    const { data: ticket } = await supabase
      .from("maintenance_requests")
      .select("vendor_work_status")
      .eq("id", ticketId)
      .maybeSingle()
    const status = String(ticket?.vendor_work_status ?? "").toLowerCase()
    if (!ASK_CLOSING_WORK_STATUSES.has(status)) continue
    out.push({
      ticketId,
      kind: "vendor_schedule",
      step: fsm.step,
      conversationId: String(row.id),
      vendorWorkStatus: status,
    })
  }

  const { data: residentRows } = await supabase
    .from("sms_conversations")
    .select("id, maintenance_request_id, intake_state")
    .not("intake_state", "is", null)
    .order("updated_at", { ascending: false })
    .limit(300)

  for (const row of residentRows ?? []) {
    if (out.length >= limit) break
    const intake =
      row.intake_state && typeof row.intake_state === "object"
        ? (row.intake_state as Record<string, unknown>)
        : null
    const awaiting = intake?.[AWAITING_SCHEDULE_CONFIRM_KEY] as
      | { ticket_id?: string }
      | undefined
    if (!awaiting?.ticket_id) continue
    const ticketId = awaiting.ticket_id.trim()
    const { data: ticket } = await supabase
      .from("maintenance_requests")
      .select("vendor_work_status")
      .eq("id", ticketId)
      .maybeSingle()
    const status = String(ticket?.vendor_work_status ?? "").toLowerCase()
    if (!ASK_CLOSING_WORK_STATUSES.has(status)) continue
    out.push({
      ticketId,
      kind: "awaiting_schedule_confirmation",
      conversationId: String(row.id),
      vendorWorkStatus: status,
    })
  }

  return out
}

export async function reconcileZombieScheduleAsks(
  supabase: SupabaseClient,
  opts?: { limit?: number; dryRun?: boolean },
): Promise<{ scanned: number; closed: number; dryRun: boolean; samples: string[] }> {
  const zombies = await findZombieScheduleAsks(supabase, {
    limit: opts?.limit ?? 50,
  })
  const samples: string[] = []
  let closed = 0
  for (const z of zombies) {
    samples.push(`${z.ticketId.slice(0, 8)}:${z.kind}:${z.vendorWorkStatus}`)
    if (opts?.dryRun) continue
    const result = await closeOpenAsksForTicket(
      supabase,
      z.ticketId,
      `reconciliation: ticket already ${z.vendorWorkStatus}`,
    )
    if (result.closed.length > 0) closed += 1
  }
  return {
    scanned: zombies.length,
    closed,
    dryRun: opts?.dryRun === true,
    samples: samples.slice(0, 20),
  }
}

/** Open tickets still carrying the soft-probe clock after a vendor is already bound. */
export async function findZombieVendorAvailabilityAsks(
  supabase: SupabaseClient,
  opts?: { limit?: number },
): Promise<
  Array<{
    ticketId: string
    kind: "awaiting_vendor_availability"
    vendorWorkStatus: string
    assignedVendorId: string
  }>
> {
  const limit = opts?.limit ?? 100
  const { data: rows } = await supabase
    .from("maintenance_requests")
    .select(
      "id, vendor_work_status, assigned_vendor_id, awaiting_vendor_availability_at",
    )
    .not("awaiting_vendor_availability_at", "is", null)
    .not("assigned_vendor_id", "is", null)
    .order("awaiting_vendor_availability_at", { ascending: true })
    .limit(Math.max(limit * 3, 100))

  const out: Array<{
    ticketId: string
    kind: "awaiting_vendor_availability"
    vendorWorkStatus: string
    assignedVendorId: string
  }> = []

  for (const row of rows ?? []) {
    if (out.length >= limit) break
    const ticketId = typeof row?.id === "string" ? row.id.trim() : ""
    const assignedVendorId =
      typeof row?.assigned_vendor_id === "string"
        ? row.assigned_vendor_id.trim()
        : ""
    if (!ticketId || !assignedVendorId) continue
    const status = String(row?.vendor_work_status ?? "").toLowerCase()
    if (status === "completed" || status === "cancelled" || status === "archived") {
      // Still clear via closeOpenAsks — include them.
    }
    out.push({
      ticketId,
      kind: "awaiting_vendor_availability",
      vendorWorkStatus: status || "unknown",
      assignedVendorId,
    })
  }
  return out
}

export async function reconcileZombieVendorAvailabilityAsks(
  supabase: SupabaseClient,
  opts?: { limit?: number; dryRun?: boolean },
): Promise<{ scanned: number; closed: number; dryRun: boolean; samples: string[] }> {
  const zombies = await findZombieVendorAvailabilityAsks(supabase, {
    limit: opts?.limit ?? 50,
  })
  const samples: string[] = []
  let closed = 0
  for (const z of zombies) {
    samples.push(
      `${z.ticketId.slice(0, 8)}:${z.kind}:${z.vendorWorkStatus}`,
    )
    if (opts?.dryRun) continue
    const result = await closeOpenAsksForTicket(
      supabase,
      z.ticketId,
      `reconciliation: vendor already assigned (${z.vendorWorkStatus})`,
    )
    if (result.closed.includes("awaiting_vendor_availability")) closed += 1
  }
  return {
    scanned: zombies.length,
    closed,
    dryRun: opts?.dryRun === true,
    samples: samples.slice(0, 20),
  }
}

export function isPreScheduledStep(
  step: string | null | undefined,
): step is VendorScheduleStep {
  return Boolean(step && PRE_SCHEDULED.has(step))
}
