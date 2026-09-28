/**
 * Guards for automated vendor reassignment / landlord-choice asks.
 *
 * Prevents the WO-5FA6 failure modes:
 * 1. SLA rematch reopening a choice right after a landlord choice + notify
 * 2. Permanent awaiting_landlord_choice short-circuit with no escalation
 * 3. Silent identical auto_reassign outcome loops
 */

export const PENDING_ACCEPT_STALE_MS = 48 * 60 * 60 * 1000

/** How long to wait for a landlord YES/1/2 before escalating the stuck flag. */
export const AWAITING_LANDLORD_CHOICE_DWELL_MS = 48 * 60 * 60 * 1000

/** How long an availability probe may run before SLA rematch escalates it. */
export const AWAITING_VENDOR_AVAILABILITY_PROBE_DWELL_MS = 48 * 60 * 60 * 1000

/**
 * Absolute cool-down after a landlord choice is resolved before automation may
 * raise a new choice ask on the same ticket.
 */
export const LANDLORD_CHOICE_COOLDOWN_MS = 4 * 60 * 60 * 1000

/** Identical auto_reassign (trigger+outcome) repetitions before loop alert. */
export const AUTO_REASSIGN_LOOP_COUNT_THRESHOLD = 25

/** Duration of identical outcomes before loop alert (even if count is lower). */
export const AUTO_REASSIGN_LOOP_DURATION_MS = 24 * 60 * 60 * 1000

export type VendorReassignGuardTrigger =
  | "sla_expired"
  | "pending_accept_stale"
  | "vendor_declined"
  | "noshow_rematch"

export type AutoReassignOutcomeKind =
  | "awaiting_landlord_choice"
  | "needs_admin_vendor"
  | "reassigned"
  | "skipped"

export function autoReassignOutcomeSignature(
  trigger: string,
  outcome: AutoReassignOutcomeKind | string,
): string {
  return `${String(outcome).trim()}|${String(trigger).trim()}`
}

export function parseIsoMs(value: string | null | undefined): number | null {
  if (value == null || !String(value).trim()) return null
  const ms = new Date(String(value).trim()).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * When this automated pass's trigger condition was first satisfied.
 * Used to detect "choice + notify happened after the trigger was already true".
 */
export function triggerConditionFirstMetMs(input: {
  trigger: VendorReassignGuardTrigger
  dueAt?: string | null
  assignedAt?: string | null
  nowMs: number
}): number | null {
  switch (input.trigger) {
    case "sla_expired":
      return parseIsoMs(input.dueAt ?? null)
    case "pending_accept_stale": {
      const assigned = parseIsoMs(input.assignedAt ?? null)
      if (assigned == null) return null
      return assigned + PENDING_ACCEPT_STALE_MS
    }
    case "vendor_declined":
    case "noshow_rematch":
      // Event-driven — no durable "first met" before this pass.
      return null
    default:
      return null
  }
}

/**
 * True when a landlord choice was resolved and a vendor was notified after the
 * automation trigger was already satisfied — do not reopen a choice.
 */
export function shouldSkipReopenAfterRecentLandlordChoice(input: {
  trigger: VendorReassignGuardTrigger
  nowMs: number
  dueAt?: string | null
  assignedAt?: string | null
  landlordVendorChoiceResolvedAt?: string | null
  vendorNotifiedAt?: string | null
  assignedVendorId?: string | null
  cooldownMs?: number
}): boolean {
  const resolvedAt = parseIsoMs(input.landlordVendorChoiceResolvedAt ?? null)
  if (resolvedAt == null) return false

  const cooldownMs = input.cooldownMs ?? LANDLORD_CHOICE_COOLDOWN_MS
  if (input.nowMs - resolvedAt < cooldownMs) return true

  const notifiedAt = parseIsoMs(input.vendorNotifiedAt ?? null)
  const hasAssigned = Boolean(input.assignedVendorId?.trim())
  if (!hasAssigned || notifiedAt == null) return false
  // Vendor notify must be at/after the choice resolution (same decision path).
  if (notifiedAt + 1000 < resolvedAt) return false

  const triggerMet = triggerConditionFirstMetMs({
    trigger: input.trigger,
    dueAt: input.dueAt,
    assignedAt: input.assignedAt,
    nowMs: input.nowMs,
  })
  if (triggerMet == null) return false

  return resolvedAt >= triggerMet && notifiedAt >= triggerMet
}

export function awaitingLandlordChoiceDwellExceeded(input: {
  nowMs: number
  awaitingLandlordChoice: boolean
  awaitingLandlordChoiceAt?: string | null
  dwellMs?: number
}): boolean {
  if (!input.awaitingLandlordChoice) return false
  const setAt = parseIsoMs(input.awaitingLandlordChoiceAt ?? null)
  if (setAt == null) {
    // Null clock: caller must stamp awaiting_landlord_choice_at (= start the dwell).
    // Do not escalate on this pass; escalate only after dwell from the stamp.
    return false
  }
  const dwellMs = input.dwellMs ?? AWAITING_LANDLORD_CHOICE_DWELL_MS
  return input.nowMs - setAt >= dwellMs
}

export function awaitingVendorAvailabilityProbeDwellExceeded(input: {
  nowMs: number
  awaitingVendorAvailabilityProbe: boolean
  awaitingVendorAvailabilityAt?: string | null
  dwellMs?: number
}): boolean {
  if (!input.awaitingVendorAvailabilityProbe) return false
  const setAt = parseIsoMs(input.awaitingVendorAvailabilityAt ?? null)
  if (setAt == null) {
    // Probe without a clock — do not escalate (would kill a healthy probe).
    return false
  }
  const dwellMs = input.dwellMs ?? AWAITING_VENDOR_AVAILABILITY_PROBE_DWELL_MS
  return input.nowMs - setAt >= dwellMs
}

export function nextAutoReassignRepeatState(input: {
  lastOutcomeSignature?: string | null
  sameOutcomeCount?: number | null
  sameOutcomeSince?: string | null
  proposedSignature: string
  nowMs: number
}): {
  signature: string
  count: number
  sinceMs: number
  isLoop: boolean
} {
  const proposed = input.proposedSignature.trim()
  const prev = (input.lastOutcomeSignature ?? "").trim()
  const prevCount =
    typeof input.sameOutcomeCount === "number" &&
    Number.isFinite(input.sameOutcomeCount)
      ? Math.max(0, Math.floor(input.sameOutcomeCount))
      : 0
  const prevSince = parseIsoMs(input.sameOutcomeSince ?? null)

  if (proposed && proposed === prev) {
    const count = prevCount + 1
    const sinceMs = prevSince ?? input.nowMs
    const durationHit = input.nowMs - sinceMs >= AUTO_REASSIGN_LOOP_DURATION_MS
    const countHit = count >= AUTO_REASSIGN_LOOP_COUNT_THRESHOLD
    return {
      signature: proposed,
      count,
      sinceMs,
      isLoop: countHit || durationHit,
    }
  }

  return {
    signature: proposed,
    count: 1,
    sinceMs: input.nowMs,
    isLoop: false,
  }
}

/** After needs_admin escalate, do not reopen a landlord choice on the next pass. */
export const NEEDS_ADMIN_ESCALATION_COOLDOWN_MS = AWAITING_LANDLORD_CHOICE_DWELL_MS

/** True while auto_reassign_last_outcome is needs_admin_vendor|* (sticky until cleared). */
export function isStickyNeedsAdminVendor(
  lastOutcomeSignature?: string | null,
): boolean {
  return (lastOutcomeSignature ?? "").trim().startsWith("needs_admin_vendor|")
}

/**
 * @deprecated Prefer isStickyNeedsAdminVendor — cool-down alone reopened choice
 * after 48h on WO-5FA6. Kept for tests that assert the old window semantics.
 */
export function recentlyEscalatedNeedsAdmin(input: {
  nowMs: number
  lastOutcomeSignature?: string | null
  sameOutcomeSince?: string | null
  cooldownMs?: number
}): boolean {
  if (!isStickyNeedsAdminVendor(input.lastOutcomeSignature)) return false
  const since = parseIsoMs(input.sameOutcomeSince ?? null)
  if (since == null) return true
  const cooldownMs = input.cooldownMs ?? NEEDS_ADMIN_ESCALATION_COOLDOWN_MS
  return input.nowMs - since < cooldownMs
}

/**
 * Detect a second entry into needs_admin_vendor, or choice↔admin oscillation.
 * priorNeedsAdminEntries counts how many times this ticket has entered needs_admin.
 */
export function detectNeedsAdminCycle(input: {
  lastOutcomeSignature?: string | null
  priorNeedsAdminEntries?: number | null
  enteringNeedsAdmin: boolean
}): {
  alert: boolean
  nextEntryCount: number
  reason: "second_needs_admin_entry" | "alternating_choice_and_admin" | null
} {
  if (!input.enteringNeedsAdmin) {
    return {
      alert: false,
      nextEntryCount: Math.max(0, Math.floor(input.priorNeedsAdminEntries ?? 0)),
      reason: null,
    }
  }
  const prior = Math.max(0, Math.floor(input.priorNeedsAdminEntries ?? 0))
  const nextEntryCount = prior + 1
  const last = (input.lastOutcomeSignature ?? "").trim()
  if (nextEntryCount >= 2) {
    return {
      alert: true,
      nextEntryCount,
      reason: "second_needs_admin_entry",
    }
  }
  if (last.startsWith("awaiting_landlord_choice|") && prior >= 1) {
    return {
      alert: true,
      nextEntryCount,
      reason: "alternating_choice_and_admin",
    }
  }
  return { alert: false, nextEntryCount, reason: null }
}

export type AutoReassignGuardDecision =
  | { action: "proceed" }
  | {
      action: "skip"
      reason:
        | "landlord_choice_cooldown"
        | "recent_choice_after_trigger"
        | "recently_escalated_needs_admin"
        | "needs_admin_vendor_sticky"
    }
  | {
      action: "short_circuit_awaiting"
      reason: "awaiting_landlord_choice" | "awaiting_vendor_availability_probe"
      repeat: { signature: string; count: number; sinceMs: number }
      /** Stamp awaiting_landlord_choice_at = now when the flag has no clock. */
      stampLandlordChoiceAt?: boolean
    }
  | {
      action: "escalate_awaiting_stale"
      reason:
        | "awaiting_choice_dwell_exceeded"
        | "awaiting_probe_dwell_exceeded"
    }
  | {
      action: "escalate_loop"
      reason: "identical_outcome_loop"
      count: number
      signature: string
      sinceMs: number
    }

/**
 * Decide whether an automated auto_reassign pass may ask for a landlord choice
 * / reassign, must wait, or must escalate out of a stuck state.
 */
export function decideAutoReassignGuard(input: {
  trigger: VendorReassignGuardTrigger
  nowMs: number
  dueAt?: string | null
  assignedAt?: string | null
  awaitingLandlordChoice: boolean
  awaitingLandlordChoiceAt?: string | null
  awaitingVendorAvailabilityProbe?: boolean
  awaitingVendorAvailabilityAt?: string | null
  landlordVendorChoiceResolvedAt?: string | null
  vendorNotifiedAt?: string | null
  assignedVendorId?: string | null
  lastOutcomeSignature?: string | null
  sameOutcomeCount?: number | null
  sameOutcomeSince?: string | null
  dwellMs?: number
  probeDwellMs?: number
  cooldownMs?: number
}): AutoReassignGuardDecision {
  if (input.awaitingVendorAvailabilityProbe) {
    if (
      awaitingVendorAvailabilityProbeDwellExceeded({
        nowMs: input.nowMs,
        awaitingVendorAvailabilityProbe: true,
        awaitingVendorAvailabilityAt: input.awaitingVendorAvailabilityAt,
        dwellMs: input.probeDwellMs,
      })
    ) {
      return {
        action: "escalate_awaiting_stale",
        reason: "awaiting_probe_dwell_exceeded",
      }
    }
    const signature = autoReassignOutcomeSignature(
      input.trigger,
      "awaiting_vendor_availability_probe",
    )
    const repeat = nextAutoReassignRepeatState({
      lastOutcomeSignature: input.lastOutcomeSignature,
      sameOutcomeCount: input.sameOutcomeCount,
      sameOutcomeSince: input.sameOutcomeSince,
      proposedSignature: signature,
      nowMs: input.nowMs,
    })
    if (repeat.isLoop) {
      return {
        action: "escalate_loop",
        reason: "identical_outcome_loop",
        count: repeat.count,
        signature: repeat.signature,
        sinceMs: repeat.sinceMs,
      }
    }
    return {
      action: "short_circuit_awaiting",
      reason: "awaiting_vendor_availability_probe",
      repeat: {
        signature: repeat.signature,
        count: repeat.count,
        sinceMs: repeat.sinceMs,
      },
    }
  }

  if (input.awaitingLandlordChoice) {
    const needsStamp =
      parseIsoMs(input.awaitingLandlordChoiceAt ?? null) == null
    if (
      !needsStamp &&
      awaitingLandlordChoiceDwellExceeded({
        nowMs: input.nowMs,
        awaitingLandlordChoice: true,
        awaitingLandlordChoiceAt: input.awaitingLandlordChoiceAt,
        dwellMs: input.dwellMs,
      })
    ) {
      return {
        action: "escalate_awaiting_stale",
        reason: "awaiting_choice_dwell_exceeded",
      }
    }

    const signature = autoReassignOutcomeSignature(
      input.trigger,
      "awaiting_landlord_choice",
    )
    const repeat = nextAutoReassignRepeatState({
      lastOutcomeSignature: input.lastOutcomeSignature,
      sameOutcomeCount: input.sameOutcomeCount,
      sameOutcomeSince: input.sameOutcomeSince,
      proposedSignature: signature,
      nowMs: input.nowMs,
    })
    if (!needsStamp && repeat.isLoop) {
      return {
        action: "escalate_loop",
        reason: "identical_outcome_loop",
        count: repeat.count,
        signature: repeat.signature,
        sinceMs: repeat.sinceMs,
      }
    }
    return {
      action: "short_circuit_awaiting",
      reason: "awaiting_landlord_choice",
      stampLandlordChoiceAt: needsStamp || undefined,
      repeat: {
        signature: repeat.signature,
        count: repeat.count,
        sinceMs: repeat.sinceMs,
      },
    }
  }

  // Sticky: once automation escalated to needs_admin_vendor, do not re-ask,
  // rematch, or change state until a person assigns a vendor or releases the hold.
  if (isStickyNeedsAdminVendor(input.lastOutcomeSignature)) {
    return { action: "skip", reason: "needs_admin_vendor_sticky" }
  }

  // Legacy cool-down path (same-cron double pass). Sticky covers the durable case.
  if (
    recentlyEscalatedNeedsAdmin({
      nowMs: input.nowMs,
      lastOutcomeSignature: input.lastOutcomeSignature,
      sameOutcomeSince: input.sameOutcomeSince,
      cooldownMs: input.cooldownMs ?? NEEDS_ADMIN_ESCALATION_COOLDOWN_MS,
    })
  ) {
    return { action: "skip", reason: "recently_escalated_needs_admin" }
  }

  if (
    shouldSkipReopenAfterRecentLandlordChoice({
      trigger: input.trigger,
      nowMs: input.nowMs,
      dueAt: input.dueAt,
      assignedAt: input.assignedAt,
      landlordVendorChoiceResolvedAt: input.landlordVendorChoiceResolvedAt,
      vendorNotifiedAt: input.vendorNotifiedAt,
      assignedVendorId: input.assignedVendorId,
      cooldownMs: input.cooldownMs,
    })
  ) {
    const resolvedAt = parseIsoMs(input.landlordVendorChoiceResolvedAt ?? null)
    const cooldownMs = input.cooldownMs ?? LANDLORD_CHOICE_COOLDOWN_MS
    const inAbsoluteCooldown =
      resolvedAt != null && input.nowMs - resolvedAt < cooldownMs
    return {
      action: "skip",
      reason: inAbsoluteCooldown
        ? "landlord_choice_cooldown"
        : "recent_choice_after_trigger",
    }
  }

  return { action: "proceed" }
}

/**
 * Simulate the WO-5FA6 timeline decisions (pure, for tests).
 * Returns the sequence of guard actions for each automation pass.
 */
export function simulateWo5fa6GuardSequence(times: {
  dueAt: string
  choiceResolvedAt: string
  vendorNotifiedAt: string
  slaPassAt: string
  laterPassAt: string
  assignedVendorId?: string
}): AutoReassignGuardDecision[] {
  const assignedVendorId = times.assignedVendorId ?? "vendor-chesapeake"
  const afterChoice = {
    trigger: "sla_expired" as const,
    dueAt: times.dueAt,
    assignedAt: times.choiceResolvedAt,
    awaitingLandlordChoice: false,
    landlordVendorChoiceResolvedAt: times.choiceResolvedAt,
    vendorNotifiedAt: times.vendorNotifiedAt,
    assignedVendorId,
    lastOutcomeSignature: null,
    sameOutcomeCount: 0,
    sameOutcomeSince: null,
  }

  const pass2 = decideAutoReassignGuard({
    ...afterChoice,
    nowMs: parseIsoMs(times.slaPassAt)!,
  })

  // Stuck path if a second choice were somehow raised (legacy): dwell then escalate.
  const stuckAwaitingAt = times.slaPassAt
  const later = decideAutoReassignGuard({
    trigger: "sla_expired",
    nowMs: parseIsoMs(times.laterPassAt)!,
    dueAt: times.dueAt,
    assignedAt: times.choiceResolvedAt,
    awaitingLandlordChoice: true,
    awaitingLandlordChoiceAt: stuckAwaitingAt,
    landlordVendorChoiceResolvedAt: times.choiceResolvedAt,
    vendorNotifiedAt: times.vendorNotifiedAt,
    assignedVendorId,
    lastOutcomeSignature: autoReassignOutcomeSignature(
      "sla_expired",
      "awaiting_landlord_choice",
    ),
    sameOutcomeCount: AUTO_REASSIGN_LOOP_COUNT_THRESHOLD - 1,
    sameOutcomeSince: stuckAwaitingAt,
  })

  return [pass2, later]
}
