/**
 * Pilot exclusion controls — which connected workflows are allowed in a
 * limited pilot. A hidden button alone is not exclusion; callers must check
 * these gates before booking, charging, or sending live outreach.
 *
 * Status values:
 * - verified: isolated/mocked success+failure+recovery coverage exists for the
 *   workflow on this checkout (see scripts/integration-verification reports).
 * - excluded: must not be offered / committed in pilot until verified.
 * - unknown: no durable connected-workflow proof — treat as blocked for pilot
 *   readiness claims (do not silently pass).
 *
 * Overall pilot readiness stays blocked while any *core* row is unknown/excluded.
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
    label: 'Rent/payment → ledger → balance',
    status: 'excluded',
    reason:
      'Stripe Checkout / webhook ledger reconciliation not verified in an isolated sandbox on this checkout.',
    coreSafety: true,
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
    status: 'unknown',
    reason: 'Unit/fixture extraction coverage incomplete; live Gemini extract not run.',
    coreSafety: false,
  },
  {
    id: 'home_checks',
    label: 'Home Checks',
    status: 'excluded',
    reason: 'Requires READINESS_HOME_CHECK_DATABASE_URL + upload fixtures; SQL/browser gates blocked.',
    coreSafety: false,
  },
  {
    id: 'vendor_assignment',
    label: 'Vendor assignment',
    status: 'unknown',
    reason:
      'LA2 DB assign→accept→schedule→complete passed on non-routable phones; carrier handset accept still unverified.',
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
    status: 'unknown',
    reason: 'Handset/late approval not proven; DB status progression is not SMS approval proof.',
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
    status: 'unknown',
    reason:
      'Routing to executive_briefing unit-covered; cross-system retrieval + action binding not proven.',
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
  return pilotWorkflowGate(id).status === 'verified'
}

/**
 * Overall pilot claim. Blocked while any core-safety workflow is not verified.
 * Cosmetic UI flags must not override this.
 */
export function evaluatePilotReadiness(): {
  ready: false
  blockedBy: PilotWorkflowGate[]
  allowed: PilotWorkflowId[]
  excludedOrUnknown: PilotWorkflowId[]
} {
  const blockedBy = PILOT_WORKFLOW_GATES.filter(
    (g) => g.coreSafety && g.status !== 'verified',
  )
  return {
    ready: false,
    blockedBy,
    allowed: PILOT_WORKFLOW_GATES.filter((g) => g.status === 'verified').map((g) => g.id),
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
  if (gate.status === 'verified') return { ok: true }
  if (!pilotStrictModeEnabled(env ?? {})) {
    // Soft mode: allow code paths to run in Limited Alpha, but readiness stays blocked.
    return { ok: true }
  }
  return { ok: false, status: gate.status, reason: gate.reason }
}
