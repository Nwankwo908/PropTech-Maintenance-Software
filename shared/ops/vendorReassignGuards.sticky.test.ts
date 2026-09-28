import { describe, expect, it } from 'vitest'
import {
  AWAITING_LANDLORD_CHOICE_DWELL_MS,
  AWAITING_VENDOR_AVAILABILITY_PROBE_DWELL_MS,
  awaitingLandlordChoiceDwellExceeded,
  awaitingVendorAvailabilityProbeDwellExceeded,
  decideAutoReassignGuard,
  detectNeedsAdminCycle,
  isStickyNeedsAdminVendor,
} from './vendorReassignGuards.ts'

const HOUR = 60 * 60 * 1000

describe('sticky needs_admin_vendor', () => {
  it('skips forever while last outcome is needs_admin_vendor (past any cool-down)', () => {
    const since = '2026-03-01T00:00:00.000Z'
    const nowMs = Date.parse(since) + 10 * 24 * HOUR
    expect(
      isStickyNeedsAdminVendor('needs_admin_vendor|sla_expired'),
    ).toBe(true)

    const decision = decideAutoReassignGuard({
      trigger: 'sla_expired',
      nowMs,
      dueAt: '2026-02-28T00:00:00.000Z',
      awaitingLandlordChoice: false,
      lastOutcomeSignature: 'needs_admin_vendor|sla_expired',
      sameOutcomeSince: since,
      sameOutcomeCount: 1,
    })
    expect(decision).toEqual({
      action: 'skip',
      reason: 'needs_admin_vendor_sticky',
    })
  })

  it('proceeds after sticky is cleared (person assigned / release)', () => {
    const decision = decideAutoReassignGuard({
      trigger: 'sla_expired',
      nowMs: Date.now(),
      dueAt: '2026-02-28T00:00:00.000Z',
      awaitingLandlordChoice: false,
      lastOutcomeSignature: null,
    })
    expect(decision).toEqual({ action: 'proceed' })
  })
})

describe('needs_admin cycle detection', () => {
  it('alerts on second entry into needs_admin_vendor', () => {
    const result = detectNeedsAdminCycle({
      lastOutcomeSignature: 'reassigned|sla_expired',
      priorNeedsAdminEntries: 1,
      enteringNeedsAdmin: true,
    })
    expect(result.alert).toBe(true)
    expect(result.nextEntryCount).toBe(2)
    expect(result.reason).toBe('second_needs_admin_entry')
  })

  it('does not alert on first entry', () => {
    const result = detectNeedsAdminCycle({
      lastOutcomeSignature: 'awaiting_landlord_choice|sla_expired',
      priorNeedsAdminEntries: 0,
      enteringNeedsAdmin: true,
    })
    expect(result.alert).toBe(false)
    expect(result.nextEntryCount).toBe(1)
  })
})

describe('landlord-choice null timestamp stamps a clock; probe is unaffected', () => {
  it('short-circuits with stampLandlordChoiceAt when choice flag has null timestamp', () => {
    const decision = decideAutoReassignGuard({
      trigger: 'sla_expired',
      nowMs: Date.now(),
      awaitingLandlordChoice: true,
      awaitingLandlordChoiceAt: null,
    })
    expect(decision.action).toBe('short_circuit_awaiting')
    expect(decision).toMatchObject({
      reason: 'awaiting_landlord_choice',
      stampLandlordChoiceAt: true,
    })
    expect(
      awaitingLandlordChoiceDwellExceeded({
        nowMs: Date.now(),
        awaitingLandlordChoice: true,
        awaitingLandlordChoiceAt: null,
      }),
    ).toBe(false)
  })

  it('escalates landlord-choice after dwell from stamped clock', () => {
    const setAt = '2026-03-10T12:00:00.000Z'
    const nowMs = Date.parse(setAt) + AWAITING_LANDLORD_CHOICE_DWELL_MS
    const decision = decideAutoReassignGuard({
      trigger: 'sla_expired',
      nowMs,
      awaitingLandlordChoice: true,
      awaitingLandlordChoiceAt: setAt,
    })
    expect(decision).toEqual({
      action: 'escalate_awaiting_stale',
      reason: 'awaiting_choice_dwell_exceeded',
    })
  })

  it('probe null timestamp still does not escalate (unaffected)', () => {
    expect(
      awaitingVendorAvailabilityProbeDwellExceeded({
        nowMs: Date.now(),
        awaitingVendorAvailabilityProbe: true,
        awaitingVendorAvailabilityAt: null,
      }),
    ).toBe(false)
    const decision = decideAutoReassignGuard({
      trigger: 'sla_expired',
      nowMs: Date.now(),
      awaitingLandlordChoice: false,
      awaitingVendorAvailabilityProbe: true,
      awaitingVendorAvailabilityAt: null,
    })
    expect(decision.action).toBe('short_circuit_awaiting')
    expect(decision).toMatchObject({
      reason: 'awaiting_vendor_availability_probe',
    })
  })

  it('probe escalates after its own dwell when stamped', () => {
    const setAt = '2026-03-01T00:00:00.000Z'
    const nowMs = Date.parse(setAt) + AWAITING_VENDOR_AVAILABILITY_PROBE_DWELL_MS
    const decision = decideAutoReassignGuard({
      trigger: 'sla_expired',
      nowMs,
      awaitingLandlordChoice: false,
      awaitingVendorAvailabilityProbe: true,
      awaitingVendorAvailabilityAt: setAt,
    })
    expect(decision).toEqual({
      action: 'escalate_awaiting_stale',
      reason: 'awaiting_probe_dwell_exceeded',
    })
  })
})
