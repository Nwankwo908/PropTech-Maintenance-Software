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
    status: 'unknown',
    reason:
      'Flooding label + urgency unit coverage exists; durable alert delivery / idempotency connected-workflow not proven.',
    coreSafety: true,
  },
  {
    id: 'sms_identity_action',
    label: 'SMS identity → reply → action',
    status: 'unknown',
    reason: 'Handler registry + invoice mocks exist; live handset YES/NO binding not verified.',
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
      'Pest specialist + booking state gates unit-tested; full assign/outreach connected path not proven.',
    coreSafety: true,
  },
  {
    id: 'scheduling',
    label: 'Scheduling',
    status: 'verified',
    reason: 'Requester-timezone matrix (UTC/NY/LA/Tokyo) passed for Chrono offset fix.',
    coreSafety: false,
  },
  {
    id: 'approvals',
    label: 'Approvals',
    status: 'unknown',
    reason: 'Invoice YES router mocks passed; concurrent/stale approval connected path not proven.',
    coreSafety: true,
  },
  {
    id: 'job_completion',
    label: 'Job completion',
    status: 'unknown',
    reason: 'No durable completion + notify connected-workflow evidence on this checkout.',
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
