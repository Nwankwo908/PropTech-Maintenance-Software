import { describe, expect, it } from 'vitest'
import {
  extractTenantInspectionNotice,
  hasStrongRepairAsk,
  looksLikeTenantInspectionNotice,
  mentionsUpcomingInspectionDeadline,
} from './tenantInspectionNotice.ts'

describe('tenantInspectionNotice', () => {
  it('classifies Takeira-style HABC reschedule as a notice', () => {
    const body =
      'My annual inspection being switched to 10/08/2026 — HABC emailed me the notice'
    expect(looksLikeTenantInspectionNotice(body)).toBe(true)
    const extracted = extractTenantInspectionNotice(body)
    expect(extracted.isNotice).toBe(true)
    expect(extracted.inspectionDate).toBe('2026-10-08')
  })

  it('does not treat a bare paint ask as an inspection notice', () => {
    const body =
      "The wall and the ceiling needs to be painted. The door isn't on properly."
    expect(looksLikeTenantInspectionNotice(body)).toBe(false)
  })

  it('detects repair+deadline compound without calling it a notice alone', () => {
    const body =
      'These need to be done before the inspection. The wall and the ceiling needs to be painted.'
    expect(mentionsUpcomingInspectionDeadline(body)).toBe(true)
    expect(hasStrongRepairAsk(body)).toBe(true)
    // No authority/schedule notice language → not the notice itself
    expect(looksLikeTenantInspectionNotice(body)).toBe(false)
  })

  it('notice + repair compound still looks like a notice', () => {
    const body =
      'HABC inspection scheduled for 10/08/2026. The wall needs to be painted and the door is not on properly.'
    expect(looksLikeTenantInspectionNotice(body)).toBe(true)
    expect(hasStrongRepairAsk(body)).toBe(true)
  })
})
