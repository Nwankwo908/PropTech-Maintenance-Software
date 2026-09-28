import { describe, expect, it } from 'vitest'
import {
  AWAITING_LANDLORD_CHOICE_DWELL_MS,
  AUTO_REASSIGN_LOOP_COUNT_THRESHOLD,
  LANDLORD_CHOICE_COOLDOWN_MS,
  autoReassignOutcomeSignature,
  decideAutoReassignGuard,
  nextAutoReassignRepeatState,
  shouldSkipReopenAfterRecentLandlordChoice,
  simulateWo5fa6GuardSequence,
  awaitingLandlordChoiceDwellExceeded,
} from './vendorReassignGuards.ts'

const HOUR = 60 * 60 * 1000

describe('shouldSkipReopenAfterRecentLandlordChoice', () => {
  it('suppresses a second automated choice within the cool-down after resolve+notify', () => {
    const dueAt = '2026-03-10T10:00:00.000Z'
    const choiceResolvedAt = '2026-03-10T12:16:00.000Z'
    const vendorNotifiedAt = '2026-03-10T12:16:30.000Z'
    const slaPassAt = new Date('2026-03-10T13:11:00.000Z').getTime()

    expect(
      shouldSkipReopenAfterRecentLandlordChoice({
        trigger: 'sla_expired',
        nowMs: slaPassAt,
        dueAt,
        landlordVendorChoiceResolvedAt: choiceResolvedAt,
        vendorNotifiedAt,
        assignedVendorId: 'chesapeake',
      }),
    ).toBe(true)

    const decision = decideAutoReassignGuard({
      trigger: 'sla_expired',
      nowMs: slaPassAt,
      dueAt,
      awaitingLandlordChoice: false,
      landlordVendorChoiceResolvedAt: choiceResolvedAt,
      vendorNotifiedAt,
      assignedVendorId: 'chesapeake',
    })
    expect(decision.action).toBe('skip')
    expect(decision).toMatchObject({ reason: 'landlord_choice_cooldown' })
  })

  it('still suppresses after cool-down when choice+notify happened after trigger first met', () => {
    const dueAt = '2026-03-10T10:00:00.000Z'
    const choiceResolvedAt = '2026-03-10T12:16:00.000Z'
    const vendorNotifiedAt = '2026-03-10T12:16:30.000Z'
    // 5h after resolve — past absolute cool-down, still after due_at
    const later = new Date(choiceResolvedAt).getTime() + 5 * HOUR

    expect(
      shouldSkipReopenAfterRecentLandlordChoice({
        trigger: 'sla_expired',
        nowMs: later,
        dueAt,
        landlordVendorChoiceResolvedAt: choiceResolvedAt,
        vendorNotifiedAt,
        assignedVendorId: 'chesapeake',
        cooldownMs: LANDLORD_CHOICE_COOLDOWN_MS,
      }),
    ).toBe(true)

    const decision = decideAutoReassignGuard({
      trigger: 'sla_expired',
      nowMs: later,
      dueAt,
      awaitingLandlordChoice: false,
      landlordVendorChoiceResolvedAt: choiceResolvedAt,
      vendorNotifiedAt,
      assignedVendorId: 'chesapeake',
    })
    expect(decision.action).toBe('skip')
    expect(decision).toMatchObject({ reason: 'recent_choice_after_trigger' })
  })

  it('allows a new pass when there was no recent resolved choice', () => {
    const decision = decideAutoReassignGuard({
      trigger: 'sla_expired',
      nowMs: Date.parse('2026-03-10T13:11:00.000Z'),
      dueAt: '2026-03-10T10:00:00.000Z',
      awaitingLandlordChoice: false,
      landlordVendorChoiceResolvedAt: null,
      vendorNotifiedAt: null,
      assignedVendorId: null,
    })
    expect(decision).toEqual({ action: 'proceed' })
  })
})

describe('awaiting landlord choice dwell + escalate', () => {
  it('short-circuits while dwell window is open', () => {
    const setAt = '2026-03-10T13:11:00.000Z'
    const nowMs = Date.parse(setAt) + 2 * HOUR
    const decision = decideAutoReassignGuard({
      trigger: 'sla_expired',
      nowMs,
      awaitingLandlordChoice: true,
      awaitingLandlordChoiceAt: setAt,
      lastOutcomeSignature: null,
      sameOutcomeCount: 0,
    })
    expect(decision.action).toBe('short_circuit_awaiting')
  })

  it('escalates when vendor_notify_error awaiting flag is still set at T+48h', () => {
    const setAt = '2026-03-10T13:11:00.000Z'
    const nowMs = Date.parse(setAt) + AWAITING_LANDLORD_CHOICE_DWELL_MS
    expect(
      awaitingLandlordChoiceDwellExceeded({
        nowMs,
        awaitingLandlordChoice: true,
        awaitingLandlordChoiceAt: setAt,
      }),
    ).toBe(true)

    const decision = decideAutoReassignGuard({
      trigger: 'pending_accept_stale',
      nowMs,
      awaitingLandlordChoice: true,
      awaitingLandlordChoiceAt: setAt,
      assignedAt: '2026-03-08T12:00:00.000Z',
    })
    expect(decision).toEqual({
      action: 'escalate_awaiting_stale',
      reason: 'awaiting_choice_dwell_exceeded',
    })
  })

  it('stamps a clock when landlord-choice flag has null timestamp (does not wait forever)', () => {
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
  })

  it('short-circuits an in-progress availability probe with a fresh timestamp', () => {
    const setAt = '2026-03-10T13:11:00.000Z'
    const nowMs = Date.parse(setAt) + 2 * HOUR
    const decision = decideAutoReassignGuard({
      trigger: 'sla_expired',
      nowMs,
      awaitingLandlordChoice: false,
      awaitingVendorAvailabilityProbe: true,
      awaitingVendorAvailabilityAt: setAt,
    })
    expect(decision.action).toBe('short_circuit_awaiting')
    expect(decision).toMatchObject({
      reason: 'awaiting_vendor_availability_probe',
    })
  })

  it('does not escalate a probe with null timestamp (healthy probe has no clock until stamped)', () => {
    const decision = decideAutoReassignGuard({
      trigger: 'sla_expired',
      nowMs: Date.now(),
      awaitingLandlordChoice: false,
      awaitingVendorAvailabilityProbe: true,
      awaitingVendorAvailabilityAt: null,
    })
    expect(decision.action).toBe('short_circuit_awaiting')
  })
})

describe('identical auto_reassign loop monitoring', () => {
  it('marks a loop after repeated identical outcomes', () => {
    const signature = autoReassignOutcomeSignature(
      'sla_expired',
      'awaiting_landlord_choice',
    )
    const since = '2026-03-10T13:11:00.000Z'
    const next = nextAutoReassignRepeatState({
      lastOutcomeSignature: signature,
      sameOutcomeCount: AUTO_REASSIGN_LOOP_COUNT_THRESHOLD - 1,
      sameOutcomeSince: since,
      proposedSignature: signature,
      nowMs: Date.parse(since) + HOUR,
    })
    expect(next.isLoop).toBe(true)
    expect(next.count).toBe(AUTO_REASSIGN_LOOP_COUNT_THRESHOLD)

    const decision = decideAutoReassignGuard({
      trigger: 'sla_expired',
      nowMs: Date.parse(since) + HOUR,
      awaitingLandlordChoice: true,
      awaitingLandlordChoiceAt: since,
      lastOutcomeSignature: signature,
      sameOutcomeCount: AUTO_REASSIGN_LOOP_COUNT_THRESHOLD - 1,
      sameOutcomeSince: since,
      dwellMs: 7 * 24 * HOUR,
    })
    expect(decision.action).toBe('escalate_loop')
  })
})

describe('recently escalated needs_admin cool-down', () => {
  it('suppresses pending_accept_stale reopen after awaiting escalate on the same ticket', () => {
    const since = '2026-03-10T13:11:00.000Z'
    const decision = decideAutoReassignGuard({
      trigger: 'pending_accept_stale',
      nowMs: Date.parse(since) + HOUR,
      dueAt: '2026-03-10T10:00:00.000Z',
      assignedAt: '2026-03-08T12:00:00.000Z',
      awaitingLandlordChoice: false,
      landlordVendorChoiceResolvedAt: null,
      vendorNotifiedAt: '2026-03-10T12:16:30.000Z',
      assignedVendorId: 'chesapeake',
      lastOutcomeSignature: autoReassignOutcomeSignature(
        'sla_expired',
        'needs_admin_vendor',
      ),
      sameOutcomeCount: 1,
      sameOutcomeSince: since,
    })
    expect(decision).toEqual({
      action: 'skip',
      reason: 'needs_admin_vendor_sticky',
    })
  })
})

describe('WO-5FA6 end-to-end guard sequence', () => {
  it('does not leave the ticket stuck: suppresses reopen, then escalates silence', () => {
    const [passWithinHour, passAfterSilence] = simulateWo5fa6GuardSequence({
      dueAt: '2026-03-10T10:00:00.000Z',
      choiceResolvedAt: '2026-03-10T12:16:00.000Z',
      vendorNotifiedAt: '2026-03-10T12:16:30.000Z',
      slaPassAt: '2026-03-10T13:11:00.000Z',
      laterPassAt: '2026-03-12T14:00:00.000Z',
    })

    expect(passWithinHour.action).toBe('skip')
    expect(passAfterSilence.action).toMatch(/escalate_/)
  })
})
