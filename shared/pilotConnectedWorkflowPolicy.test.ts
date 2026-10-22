/**
 * Policy-level connected-workflow guards that run without a live database.
 * These are supporting evidence only — they do NOT mark emergency/SMS/payment
 * rows as connected-workflow verified.
 */
import { describe, expect, it } from 'vitest'
import { matchDeterministicRules } from './maintenance/deterministicRules.ts'
import { vendorTradeMatchesForDispatch } from '../src/lib/vendorTrades.ts'
import { evaluatePilotReadiness, assertPilotAllows } from './pilotGate.ts'

describe('pilot connected-workflow policy (unit-level supporting evidence)', () => {
  it('keeps flooding as flooding + flood emergency (not plumbing leak)', () => {
    const hits = matchDeterministicRules('There is flooding in the basement from a burst pipe')
    const flooding = hits.find((h) => h.issueType === 'flooding')
    expect(flooding).toBeTruthy()
    expect(flooding?.emergency).toBe('flood')
    expect(flooding?.issueType).not.toBe('leak')
  })

  it('never matches pest jobs to general / handyman', () => {
    expect(vendorTradeMatchesForDispatch('general', 'pest_control')).toBe(false)
    expect(vendorTradeMatchesForDispatch('handyman', 'pest')).toBe(false)
    expect(vendorTradeMatchesForDispatch('pest_control', 'pest_control')).toBe(true)
  })

  it('blocks overall pilot readiness while core safety is unverified', () => {
    const readiness = evaluatePilotReadiness()
    expect(readiness.ready).toBe(false)
    expect(readiness.blockedBy.some((g) => g.id === 'approvals')).toBe(true)
    // Rent/payments hard-disabled for pilot regardless of PILOT_STRICT.
    expect(assertPilotAllows('rent_payment_ledger', { PILOT_STRICT: '0' }).ok).toBe(false)
    expect(assertPilotAllows('rent_payment_ledger', { PILOT_STRICT: '1' }).ok).toBe(false)
    // Home Checks stays in verification backlog (unknown) — not hard-disabled.
    expect(assertPilotAllows('home_checks', { PILOT_STRICT: '0' }).ok).toBe(true)
    expect(assertPilotAllows('home_checks', { PILOT_STRICT: '1' }).ok).toBe(false)
  })
})
