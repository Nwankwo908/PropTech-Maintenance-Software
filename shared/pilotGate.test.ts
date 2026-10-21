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
    expect(result.blockedBy.some((g) => g.id === 'emergency_alert')).toBe(true)
    expect(result.blockedBy.some((g) => g.id === 'rent_payment_ledger')).toBe(true)
    expect(isPilotWorkflowAllowed('onboarding')).toBe(true)
    expect(isPilotWorkflowAllowed('scheduling')).toBe(true)
    expect(isPilotWorkflowAllowed('home_checks')).toBe(false)
  })

  it('fail-closes excluded workflows only when PILOT_STRICT is on', () => {
    expect(pilotStrictModeEnabled({ PILOT_STRICT: '1' })).toBe(true)
    expect(assertPilotAllows('home_checks', { PILOT_STRICT: '0' }).ok).toBe(true)
    const blocked = assertPilotAllows('home_checks', { PILOT_STRICT: '1' })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) {
      expect(blocked.status).toBe('excluded')
      expect(blocked.reason.length).toBeGreaterThan(0)
    }
  })

  it('documents flooding emergency as core unknown until connected proof exists', () => {
    const gate = pilotWorkflowGate('emergency_alert')
    expect(gate.coreSafety).toBe(true)
    expect(gate.status).toBe('unknown')
  })
})
