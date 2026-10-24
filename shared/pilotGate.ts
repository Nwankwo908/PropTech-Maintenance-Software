/**
 * Pilot exclusion controls — which connected workflows are allowed in a
 * limited pilot. A hidden button alone is not exclusion; callers must check
 * these gates before booking, charging, or sending live outreach.
 *
 * Status values:
 * - verified: isolated/mocked success+failure+recovery coverage exists for the
 *   workflow on this checkout (see scripts/integration-verification reports).
 * - excluded: must not be offered / committed in pilot until verified (or
 *   deliberately scoped out of this pilot).
 * - unknown: no durable connected-workflow proof — treat as blocked for pilot
 *   readiness claims (do not silently pass).
 *
 * Overall pilot readiness stays blocked while any *core* row is unknown/excluded.
 * Hard-disabled rows always fail closed at entry points (even without PILOT_STRICT).
 */

export type PilotWorkflowId =
  | 'emergency_alert'
  | 'sms_identity_action'
  | 'rent_payment_ledger'
  | 'onboarding'
  | 'lease_imports'
  | 'home_checks'
  | 'vendor_assignment'
  | 'scheduling'
  | 'approvals'
  | 'job_completion'
  | 'ask_ulo_priorities'

export type PilotWorkflowStatus = 'verified' | 'excluded' | 'unknown'

export type PilotWorkflowGate = {
  id: PilotWorkflowId
  label: string
  status: PilotWorkflowStatus
  /** When excluded/unknown, human-readable reason shown in ops/admin surfaces. */
  reason: string
  /** Core safety: if any of these are not verified, overall pilot is blocked. */
  coreSafety: boolean
  /**
   * When true, entry points must refuse even if PILOT_STRICT is off.
   * Use for features deliberately disabled for this pilot (e.g. rent/payments).
   */
  hardDisable?: boolean
}

/**
 * Honest inventory for the current coding checkout. Update only when the
 * matching connected-workflow evidence is re-run and attached.
 */
export const PILOT_WORKFLOW_GATES: readonly PilotWorkflowGate[] = [
  {
    id: 'emergency_alert',
    label: 'Emergency report → human alert',
    status: 'verified',
    reason:
      'LA2 live flooding ticket + attention SMS delivered (Twilio SID) with idempotent re-notify; see readiness-final-b5f8087.md.',
    coreSafety: true,
  },
  {
    id: 'sms_identity_action',
    label: 'SMS identity → reply → action',
    status: 'verified',
    reason:
      'Fresh LA2 handset YES (Twilio SM…) on …3069 routed to LA2 resident conversation with sms_clarify action; Demo reply-cap no longer drops non-Demo traffic. Evidence: .readiness/integration/sms-identity-routing-tenant-fresh-ai.json.',
    coreSafety: true,
  },
  {
    id: 'rent_payment_ledger',
    label: 'Rent & payments (Stripe / ledger)',
    status: 'excluded',
    reason:
      'Explicitly excluded from Limited Alpha pilot. Rent Checkout, invoice pay, and money-movement entry points are hard-disabled.',
    coreSafety: false,
    hardDisable: true,
  },
  {
    id: 'onboarding',
    label: 'Onboarding',
    status: 'verified',
    reason: 'Isolated Postgres inventory/rollback suite passed (readiness connected-workflows).',
    coreSafety: false,
  },
  {
    id: 'lease_imports',
    label: 'Lease imports',
    status: 'verified',
    reason:
      'Disposable accounts only. Multi-lease, scanned lease, rent-roll conflict, extension, partial-page disclosure, and saved corrections passed on Gemini 3.8 Flash with no fallback. LA1 and LA2 were not modified.',
    coreSafety: false,
  },
  {
    id: 'home_checks',
    label: 'Home Checks',
    status: 'unknown',
    reason:
      'Isolated SQL passed, and a disposable live upload showed 2 of 4 distinct photos, one observation ticket, and no text. The original Property Intelligence screen is still unresolved, so this stays unverified.',
    coreSafety: true,
  },
  {
    id: 'vendor_assignment',
    label: 'Vendor assignment',
    status: 'verified',
    reason:
      'LA2 real-handset assign→YES accept→schedule reply (…0274) with ticket accepted; evidence .readiness/integration/sms-identity-routing-handset.json.',
    coreSafety: true,
  },
  {
    id: 'scheduling',
    label: 'Scheduling',
    status: 'verified',
    reason: 'Requester-timezone matrix (UTC/NY/LA/Tokyo) passed; LA2 visit window set in maintenance workflow DB path.',
    coreSafety: false,
  },
  {
    id: 'approvals',
    label: 'Approvals',
    status: 'verified',
    reason:
      'Real-phone APPROVE and DECLINE on LA2 passed 2026-10-22 (inbound SM059a977… and SM6741188…, vendor notified, LA1 unchanged; .readiness/integration/landlord-estimate-approval-handset.json). Current sms-inbound includes the later thread-binding change. Binding, repeat-approve, and disambiguation tests passed on that code. A second text was not sent because the designated phone is the existing LA2 ops number.',
    coreSafety: true,
  },
  {
    id: 'job_completion',
    label: 'Job completion',
    status: 'verified',
    reason: 'LA2 maintenance workflow completed ticket + landlord visibility (DB); carrier notify not claimed.',
    coreSafety: false,
  },
  {
    id: 'ask_ulo_priorities',
    label: 'Ask ULO priorities',
    status: 'verified',
    reason:
      'Disposable live list ranked emergency, deadline, approval, then visit, and omitted the other account. A reply selects that item only. It does not assign a vendor or approve an estimate. Duplicate replies do not select again.',
    coreSafety: false,
  },
] as const

export function pilotWorkflowGate(id: PilotWorkflowId): PilotWorkflowGate {
  const row = PILOT_WORKFLOW_GATES.find((g) => g.id === id)
  if (!row) {
    return {
      id,
      label: id,
      status: 'unknown',
      reason: 'No gate row registered.',
      coreSafety: true,
    }
  }
  return row
}

/** True when the workflow may be offered / committed in pilot. */
export function isPilotWorkflowAllowed(id: PilotWorkflowId): boolean {
  const gate = pilotWorkflowGate(id)
  if (gate.hardDisable) return false
  return gate.status === 'verified'
}

/**
 * Overall pilot claim. Blocked while any core-safety workflow is not verified.
 * Cosmetic UI flags must not override this.
 */
export function evaluatePilotReadiness(): {
  ready: boolean
  blockedBy: PilotWorkflowGate[]
  allowed: PilotWorkflowId[]
  excludedOrUnknown: PilotWorkflowId[]
} {
  const blockedBy = PILOT_WORKFLOW_GATES.filter(
    (g) => g.coreSafety && g.status !== 'verified',
  )
  return {
    ready: blockedBy.length === 0,
    blockedBy,
    allowed: PILOT_WORKFLOW_GATES.filter((g) => isPilotWorkflowAllowed(g.id)).map((g) => g.id),
    excludedOrUnknown: PILOT_WORKFLOW_GATES.filter((g) => g.status !== 'verified').map(
      (g) => g.id,
    ),
  }
}

/** Env override: when PILOT_STRICT=1, excluded/unknown workflows fail closed. */
export function pilotStrictModeEnabled(
  env: { get?: (key: string) => string | undefined } | Record<string, string | undefined> = {},
): boolean {
  const read =
    typeof (env as { get?: (k: string) => string | undefined }).get === 'function'
      ? (env as { get: (k: string) => string | undefined }).get
      : (k: string) => (env as Record<string, string | undefined>)[k]
  const raw = (read('PILOT_STRICT') ?? read('VITE_PILOT_STRICT') ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

export function assertPilotAllows(
  id: PilotWorkflowId,
  env?: { get?: (key: string) => string | undefined } | Record<string, string | undefined>,
): { ok: true } | { ok: false; status: PilotWorkflowStatus; reason: string } {
  const gate = pilotWorkflowGate(id)
  if (gate.status === 'verified' && !gate.hardDisable) return { ok: true }
  // Hard-disabled workflows always fail closed (pilot product exclusion).
  if (gate.hardDisable) {
    return { ok: false, status: gate.status, reason: gate.reason }
  }
  if (!pilotStrictModeEnabled(env ?? {})) {
    // Soft mode: allow code paths to run in Limited Alpha, but readiness stays blocked.
    return { ok: true }
  }
  return { ok: false, status: gate.status, reason: gate.reason }
}
