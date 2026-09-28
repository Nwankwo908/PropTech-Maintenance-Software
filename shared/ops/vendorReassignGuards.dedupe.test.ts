import { describe, expect, it } from 'vitest'
import {
  AWAITING_VENDOR_AVAILABILITY_PROBE_DWELL_MS,
  awaitingLandlordChoiceDwellExceeded,
  awaitingVendorAvailabilityProbeDwellExceeded,
  decideAutoReassignGuard,
  nextAutoReassignRepeatState,
} from './vendorReassignGuards.ts'

const HOUR = 60 * 60 * 1000

describe('repeat outcome counters', () => {
  it('ten identical passes produce count 10', () => {
    let state = {
      signature: '',
      count: 0,
      sinceMs: 0,
      isLoop: false,
    }
    const nowMs = Date.parse('2026-03-10T12:00:00.000Z')
    for (let i = 0; i < 10; i++) {
      state = nextAutoReassignRepeatState({
        lastOutcomeSignature: state.signature || null,
        sameOutcomeCount: state.count || null,
        sameOutcomeSince: state.sinceMs
          ? new Date(state.sinceMs).toISOString()
          : null,
        proposedSignature: 'awaiting_landlord_choice|sla_expired',
        nowMs: nowMs + i * 60_000,
      })
    }
    expect(state.count).toBe(10)
    expect(state.signature).toBe('awaiting_landlord_choice|sla_expired')
  })
})

describe('probe dwell vs null timestamp', () => {
  it('null probe timestamp does not exceed dwell', () => {
    expect(
      awaitingVendorAvailabilityProbeDwellExceeded({
        nowMs: Date.now(),
        awaitingVendorAvailabilityProbe: true,
        awaitingVendorAvailabilityAt: null,
      }),
    ).toBe(false)
  })

  it('stamped probe exceeds dwell after threshold', () => {
    const setAt = '2026-03-01T00:00:00.000Z'
    expect(
      awaitingVendorAvailabilityProbeDwellExceeded({
        nowMs: Date.parse(setAt) + AWAITING_VENDOR_AVAILABILITY_PROBE_DWELL_MS,
        awaitingVendorAvailabilityProbe: true,
        awaitingVendorAvailabilityAt: setAt,
      }),
    ).toBe(true)
  })

  it('null landlord-choice timestamp does not exceed dwell', () => {
    expect(
      awaitingLandlordChoiceDwellExceeded({
        nowMs: Date.now(),
        awaitingLandlordChoice: true,
        awaitingLandlordChoiceAt: null,
      }),
    ).toBe(false)
  })

  it('guard prefers probe short-circuit over proceed', () => {
    const setAt = '2026-03-10T10:00:00.000Z'
    const decision = decideAutoReassignGuard({
      trigger: 'sla_expired',
      nowMs: Date.parse(setAt) + 2 * HOUR,
      awaitingLandlordChoice: false,
      awaitingVendorAvailabilityProbe: true,
      awaitingVendorAvailabilityAt: setAt,
    })
    expect(decision.action).toBe('short_circuit_awaiting')
  })
})
