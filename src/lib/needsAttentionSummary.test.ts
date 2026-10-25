import { describe, expect, it } from 'vitest'
import {
  attentionSummarySentenceCount,
  attentionSummaryWordCount,
  inspectionItemAttentionSummary,
  invoiceAttentionSummary,
  lateRentAttentionSummary,
  leaseInfoAttentionSummary,
  leaseRenewalAttentionSummary,
  responseTimeNoVendorSummary,
  rosterGapAttentionSummary,
  smsDeliveryAttentionSummary,
  staleVendorAttentionSummary,
  vendorDeclinedAttentionSummary,
  waitingAttentionSummary,
} from './needsAttentionSummary'

const summaries = [
  leaseInfoAttentionSummary(),
  smsDeliveryAttentionSummary(),
  responseTimeNoVendorSummary('plumbing'),
  responseTimeNoVendorSummary(null),
  rosterGapAttentionSummary('plumbing'),
  rosterGapAttentionSummary(null),
  vendorDeclinedAttentionSummary(),
  staleVendorAttentionSummary(),
  leaseRenewalAttentionSummary('3 days ago'),
  leaseRenewalAttentionSummary(null),
  waitingAttentionSummary('yesterday'),
  waitingAttentionSummary(null),
  lateRentAttentionSummary('Oct 1'),
  lateRentAttentionSummary(null),
  invoiceAttentionSummary({
    vendorName: 'Apex Plumbing',
    amountLabel: '$240',
  }),
  inspectionItemAttentionSummary({
    itemLabel: 'Kitchen — Stove',
    itemIndex: 1,
    itemTotal: 12,
  }),
]

describe('Needs Your Attention summaries', () => {
  it('asks to review an invoice before approving the cost', () => {
    expect(
      invoiceAttentionSummary({ vendorName: 'Apex Plumbing', amountLabel: '$240' }),
    ).toBe('Apex Plumbing submitted a $240 invoice. Review and approve the cost.')
  })

  it('uses the lease example', () => {
    expect(leaseInfoAttentionSummary()).toBe(
      'Resident asked about their lease. No details on file; property team notified.',
    )
  })

  it('stays within two short sentences', () => {
    for (const summary of summaries) {
      expect(attentionSummarySentenceCount(summary)).toBeGreaterThanOrEqual(1)
      expect(attentionSummarySentenceCount(summary)).toBeLessThanOrEqual(2)
      expect(attentionSummaryWordCount(summary)).toBeLessThanOrEqual(20)
    }
  })

  it('does not guess a trade from a missing category', () => {
    expect(responseTimeNoVendorSummary(null)).not.toMatch(/plumb|hvac|electric/i)
    expect(rosterGapAttentionSummary('general')).toBe(
      'No vendor on the roster can take this. Assign one.',
    )
  })

  it('names the inspection item without a work-order id or address', () => {
    const summary = inspectionItemAttentionSummary({
      itemLabel: 'Kitchen — Stove',
      itemIndex: 1,
      itemTotal: 12,
    })
    expect(summary).toBe(
      'Item 1 of 12 on the inspection: Kitchen — Stove. Review it.',
    )
    expect(summary).not.toMatch(/WO-|HQS|563/)
  })
})
