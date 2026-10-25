import { describe, expect, it } from 'vitest'
import {
  finishInvoiceApproval,
  formatInvoiceAmount,
  invoiceApprovedCopy,
  invoiceAttentionCard,
  invoiceReviewActionPlan,
  invoiceReviewLocation,
  propertyLabelForInvoice,
  propertyTypeForInvoice,
  startInvoiceApproval,
} from './invoiceApprovalFlow'

const sfh = {
  id: 'prop-sfh',
  name: '123 Main',
  streetAddress: '123 Main',
  propertyType: 'single_family',
}

describe('invoice approval flow', () => {
  it('names the card and asks for a review before approval', () => {
    expect(invoiceAttentionCard({ vendorName: 'Apex Plumbing', amount: 240 })).toEqual({
      title: 'Invoice needs approval',
      summary: 'Apex Plumbing submitted a $240 invoice. Review and approve the cost.',
      actionLabel: 'Review invoice',
    })
  })

  it('opens review when payments are disabled and hides pay actions', () => {
    const plan = invoiceReviewActionPlan({
      paymentsEnabled: false,
      saving: false,
      amount: 240,
    })
    expect(plan.showPayNow).toBe(false)
    expect(plan.showPaymentSteps).toBe(false)
    expect(plan.approveLabel).toBe('Approve $240')
    expect(plan.approveDisabled).toBe(false)
  })

  it('uses the property street when the ticket has no building, and still omits unit 1', () => {
    expect(propertyLabelForInvoice([sfh], 'prop-sfh', null)).toBe('123 Main')
    const location = invoiceReviewLocation({
      building: propertyLabelForInvoice([sfh], 'prop-sfh', null),
      unit: '1',
      propertyType: propertyTypeForInvoice([sfh], 'prop-sfh', null),
      residentName: 'Sam',
    })
    expect(location).toBe('123 Main · Sam')
    expect(location).not.toMatch(/Unit 1|Home/)
  })

  it('omits an invented unit on a single-family property', () => {
    const propertyType = propertyTypeForInvoice([sfh], 'prop-sfh', '123 Main')
    const location = invoiceReviewLocation({
      building: '123 Main',
      unit: '1',
      propertyType,
      residentName: 'Sam',
    })
    expect(location).toBe('123 Main · Sam')
    expect(location).not.toMatch(/Unit 1|Home/)
  })

  it('keeps the unit on a multifamily property', () => {
    expect(
      invoiceReviewLocation({
        building: 'Maple Court',
        unit: '2',
        propertyType: 'multifamily',
      }),
    ).toBe('Maple Court · Unit 2')
  })

  it('records approval only after success and says no payment was made', () => {
    expect(finishInvoiceApproval(true)).toBe('approved')
    const copy = invoiceApprovedCopy('Apex Plumbing', formatInvoiceAmount(240))
    expect(copy).toEqual({
      title: 'Invoice approved',
      message: "You approved Apex Plumbing's $240 invoice. No payment was made.",
      button: 'Done',
    })
    expect(copy.message).not.toMatch(/Resolved|workflow|decision queue|Payment Sent/i)
  })

  it('keeps the invoice on failure', () => {
    expect(finishInvoiceApproval(false)).toBe('failed')
    const retry = startInvoiceApproval('failed')
    expect(retry).toEqual({ phase: 'submitting', submit: true })
  })

  it('ignores a second click while approval is in flight and after it succeeds', () => {
    const first = startInvoiceApproval('idle')
    expect(first).toEqual({ phase: 'submitting', submit: true })
    expect(startInvoiceApproval(first.phase)).toEqual({ phase: 'submitting', submit: false })
    expect(startInvoiceApproval('approved')).toEqual({ phase: 'approved', submit: false })
  })
})