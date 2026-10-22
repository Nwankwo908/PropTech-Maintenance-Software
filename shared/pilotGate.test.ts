import { describe, expect, it } from 'vitest'
import {
  assertPilotAllows,
  evaluatePilotReadiness,
  isPilotWorkflowAllowed,
  pilotStrictModeEnabled,
  pilotWorkflowGate,
} from './pilotGate.ts'

describe('pilotGate', () => {
  it('keeps overall pilot not ready while core safety is unverified', () => {
    const result = evaluatePilotReadiness()
    expect(result.ready).toBe(false)
    expect(result.blockedBy.some((g) => g.id === 'sms_identity_action')).toBe(false)
    expect(result.blockedBy.some((g) => g.id === 'vendor_assignment')).toBe(false)
    // Rent is hard-excluded from this pilot (not a core blocker once scoped out).
    expect(result.blockedBy.some((g) => g.id === 'rent_payment_ledger')).toBe(false)
    expect(result.blockedBy.some((g) => g.id === 'approvals')).toBe(true)
    expect(isPilotWorkflowAllowed('onboarding')).toBe(true)
    expect(isPilotWorkflowAllowed('scheduling')).toBe(true)
    // Unknown ≠ hard-disabled: soft mode still allows; not verified for pilot claim.
    expect(isPilotWorkflowAllowed('home_checks')).toBe(false)
    expect(assertPilotAllows('home_checks', { PILOT_STRICT: '0' }).ok).toBe(true)
    expect(isPilotWorkflowAllowed('rent_payment_ledger')).toBe(false)
  })

  it('hard-disables rent/payments even when PILOT_STRICT is off', () => {
    const soft = assertPilotAllows('rent_payment_ledger', { PILOT_STRICT: '0' })
    expect(soft.ok).toBe(false)
    if (!soft.ok) {
      expect(soft.status).toBe('excluded')
      expect(soft.reason.toLowerCase()).toContain('excluded')
    }
    expect(assertPilotAllows('rent_payment_ledger', { PILOT_STRICT: '1' }).ok).toBe(false)
  })

  it('fail-closes unknown/excluded workflows only when PILOT_STRICT is on', () => {
    expect(pilotStrictModeEnabled({ PILOT_STRICT: '1' })).toBe(true)
    expect(assertPilotAllows('home_checks', { PILOT_STRICT: '0' }).ok).toBe(true)
    const blocked = assertPilotAllows('home_checks', { PILOT_STRICT: '1' })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) {
      expect(blocked.status).toBe('unknown')
      expect(blocked.reason.length).toBeGreaterThan(0)
    }
  })

  it('documents flooding emergency as verified after LA2 live alert proof', () => {
    const gate = pilotWorkflowGate('emergency_alert')
    expect(gate.coreSafety).toBe(true)
    expect(gate.status).toBe('verified')
  })

  it('marks SMS identity verified after fresh LA2 handset YES proof', () => {
    const gate = pilotWorkflowGate('sms_identity_action')
    expect(gate.coreSafety).toBe(true)
    expect(gate.status).toBe('verified')
    expect(isPilotWorkflowAllowed('sms_identity_action')).toBe(true)
  })

  it('marks vendor assignment verified after real-handset accept', () => {
    const gate = pilotWorkflowGate('vendor_assignment')
    expect(gate.coreSafety).toBe(true)
    expect(gate.status).toBe('verified')
    expect(isPilotWorkflowAllowed('vendor_assignment')).toBe(true)
  })
})
