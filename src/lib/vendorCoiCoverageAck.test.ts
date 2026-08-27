import { describe, expect, it } from 'vitest'
import {
  VENDOR_COI_COVERAGE_ACK_TEXT,
  vendorCoiCoverageAckFromProgress,
} from './vendorCoiCoverageAck'

describe('vendorCoiCoverageAckFromProgress', () => {
  it('is false until the vendor accepts', () => {
    expect(vendorCoiCoverageAckFromProgress(null)).toBe(false)
    expect(vendorCoiCoverageAckFromProgress({})).toBe(false)
  })

  it('is true after an accepted attestation', () => {
    expect(
      vendorCoiCoverageAckFromProgress({
        coi_coverage_attestation: { accepted: true },
      }),
    ).toBe(true)
  })

  it('keeps the disclosed coverage copy', () => {
    expect(VENDOR_COI_COVERAGE_ACK_TEXT).toBe(
      'I confirm I hold general liability insurance meeting or exceeding the minimum required for my trade category as disclosed during registration. I agree to maintain this coverage for the duration of my activity on Ulo.',
    )
  })
})
