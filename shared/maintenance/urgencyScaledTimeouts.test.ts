import { describe, expect, it } from 'vitest'
import { URGENCY_SLA_MINUTES } from './urgencyPolicy.ts'
import {
  isLifeSafetyTicket,
  isUrgentTicket,
  landlordChoiceDwellMsForTicket,
  probeDwellMsForTicket,
  ROUTINE_LANDLORD_CHOICE_DWELL_MS,
  ROUTINE_PROBE_DWELL_MS,
  ROUTINE_SCHEDULE_TTL_MS,
  tenantConfirmTtlMsForTicket,
  vendorAvailabilityTtlMsForTicket,
} from './urgencyScaledTimeouts.ts'
import {
  AWAITING_LANDLORD_CHOICE_DWELL_MS,
  AWAITING_VENDOR_AVAILABILITY_PROBE_DWELL_MS,
  PENDING_ACCEPT_STALE_MS,
} from '../ops/vendorReassignGuards.ts'
import { NO_VENDOR_RESPONSE_FOLLOW_UP_MS } from '../ops/maintenanceStallFollowUp.ts'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

describe('urgencyScaledTimeouts', () => {
  it('treats emergency urgency and same-day due_at windows as urgent', () => {
    expect(isUrgentTicket({ urgency: 'emergency' })).toBe(true)
    expect(isUrgentTicket({ urgency: 'urgent' })).toBe(true)
    expect(isUrgentTicket({ urgency: 'normal' })).toBe(false)
    expect(
      isUrgentTicket({
        createdAt: '2026-10-01T12:00:00.000Z',
        dueAt: '2026-10-01T14:00:00.000Z',
      }),
    ).toBe(true)
    expect(
      isUrgentTicket({
        createdAt: '2026-10-01T12:00:00.000Z',
        dueAt: '2026-10-03T12:00:00.000Z',
      }),
    ).toBe(false)
  })

  it('landlord-choice dwell: 1h urgent, 48h routine', () => {
    expect(landlordChoiceDwellMsForTicket({ urgency: 'emergency' })).toBe(
      URGENCY_SLA_MINUTES.emergencyLifeSafety * MINUTE,
    )
    expect(landlordChoiceDwellMsForTicket({ urgency: 'normal' })).toBe(
      ROUTINE_LANDLORD_CHOICE_DWELL_MS,
    )
    expect(ROUTINE_LANDLORD_CHOICE_DWELL_MS).toBe(
      AWAITING_LANDLORD_CHOICE_DWELL_MS,
    )
    expect(ROUTINE_LANDLORD_CHOICE_DWELL_MS).toBe(48 * HOUR)
  })

  it('probe dwell: 2h urgent, 48h routine', () => {
    expect(probeDwellMsForTicket({ urgency: 'emergency' })).toBe(
      URGENCY_SLA_MINUTES.emergencyWater * MINUTE,
    )
    expect(probeDwellMsForTicket({ urgency: 'normal' })).toBe(
      ROUTINE_PROBE_DWELL_MS,
    )
    expect(ROUTINE_PROBE_DWELL_MS).toBe(
      AWAITING_VENDOR_AVAILABILITY_PROBE_DWELL_MS,
    )
  })

  it('tenant-confirm TTL: 60m life-safety, 120m other urgent, 24h routine', () => {
    expect(
      tenantConfirmTtlMsForTicket({
        urgency: 'emergency',
        severity: 'critical',
      }),
    ).toBe(URGENCY_SLA_MINUTES.emergencyLifeSafety * MINUTE)
    expect(isLifeSafetyTicket({ severity: 'critical' })).toBe(true)
    expect(tenantConfirmTtlMsForTicket({ urgency: 'emergency' })).toBe(
      URGENCY_SLA_MINUTES.emergencyWater * MINUTE,
    )
    expect(tenantConfirmTtlMsForTicket({ urgency: 'normal' })).toBe(
      ROUTINE_SCHEDULE_TTL_MS,
    )
  })

  it('vendor availability ask TTL stays flat at 24h regardless of urgency', () => {
    expect(vendorAvailabilityTtlMsForTicket({ urgency: 'emergency' })).toBe(
      ROUTINE_SCHEDULE_TTL_MS,
    )
    expect(vendorAvailabilityTtlMsForTicket({ urgency: 'normal' })).toBe(
      ROUTINE_SCHEDULE_TTL_MS,
    )
    expect(ROUTINE_SCHEDULE_TTL_MS).toBe(24 * HOUR)
  })

  it('pending_accept rematch / stall defaults stay flat (48h / 24h) — not urgency-scaled', () => {
    expect(PENDING_ACCEPT_STALE_MS).toBe(48 * HOUR)
    expect(NO_VENDOR_RESPONSE_FOLLOW_UP_MS).toBe(
      Math.floor(PENDING_ACCEPT_STALE_MS / 2),
    )
    expect(NO_VENDOR_RESPONSE_FOLLOW_UP_MS).toBe(24 * HOUR)
  })
})
